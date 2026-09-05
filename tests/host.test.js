import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Readable } from 'node:stream'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

let root
let routes
let domainState
let sessionPath
let liveSessions

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsm-test-'))
  process.env.DSH_SESSIONS_MANAGER_TRASH_DIR = join(root, 'trash')
  await mkdir(process.env.DSH_SESSIONS_MANAGER_TRASH_DIR, { recursive: true })
  await writeFile(join(process.env.DSH_SESSIONS_MANAGER_TRASH_DIR, 'index.json'), JSON.stringify([{ sessionId: 'legacy-1', title: 'Legacy', deletedAt: 1 }]))
  const { apply } = await import(`../src/index.js?test=${Date.now()}`)
  routes = new Map()
  domainState = { archivedSessionIds: [] }
  // Match DSH's real persistence layout: the session id owns a directory,
  // while the log filename itself is the generic session.jsonl.zstd.
  sessionPath = join(root, 'known-1', 'session.jsonl.zstd')
  await mkdir(dirname(sessionPath), { recursive: true })
  await writeFile(sessionPath, 'test')
  const header = { id: 'known-1', cwd: root, title: 'Known session', createdAt: Date.now() }
  const live = { id: 'known-1', header, events: [{ type: 'session/title', data: { title: 'Latest renamed title' } }] }
  liveSessions = new Map([['known-1', live]])
  const sessions = {
    get: (id) => liveSessions.get(id), list: () => [...liveSessions.values()], flush: async () => true,
    store: new Map([['known-1', { detach: () => liveSessions.delete('known-1') }]]),
  }
  const ctx = {
    workspaceRegistry: {
      list: () => [], state: domainState,
      archiveSession: async (sid) => { if (!domainState.archivedSessionIds.includes(sid)) domainState.archivedSessionIds.push(sid) },
    },
    sessionPersistence: {
      list: async () => [header], locate: (item) => item.id === 'known-1' ? { path: sessionPath } : null,
      readFrom: async (sid) => sid === 'known-1' ? { meta: header, events: [] } : Promise.reject(new Error('missing')),
    },
    sessionQuery: {
      readTitleSnapshot: async () => ({ session: header, title: { title: 'Latest renamed title' } }),
      readTitleSnapshots: async (ids) => ids.map(() => ({ status: 'fulfilled', value: { session: header, title: { title: 'Latest renamed title' } } })),
    },
    storageDomain: { get: () => ({ global: { get: () => domainState, set: async (next) => Object.assign(domainState, next) } }) },
    webServer: { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
    get: (name) => name === 'sessions' ? sessions : null,
    effect: (fn) => fn(),
  }
  apply(ctx)
})

after(async () => { await rm(root, { recursive: true, force: true }) })

async function call(path, body = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))])
  let status = 200
  let text = ''
  const res = { writeHead: (value) => { status = value }, end: (value) => { text += value || '' } }
  await routes.get(path)(req, res)
  return { status, body: JSON.parse(text) }
}

test('reports the runtime action capabilities used by the UI', async () => {
  const result = await call('/archived-sessions/capabilities')
  assert.equal(result.status, 200)
  assert.equal(result.body.persistence, 'legacy')
  assert.equal(result.body.actions.read.available, true)
  assert.equal(result.body.actions.purge.available, true)
  assert.equal(typeof result.body.actions.move.reason === 'string' || result.body.actions.move.available, true)
})

test('reads a legacy trash array through schema v2 API', async () => {
  const result = await call('/archived-sessions/trash/list')
  assert.equal(result.status, 200)
  assert.equal(result.body.schemaVersion, 2)
  assert.equal(result.body.items[0].sessionId, 'legacy-1')
  assert.deepEqual(result.body.settings, { retentionDays: 0 })
})

test('persists a supported retention policy atomically', async () => {
  const result = await call('/archived-sessions/trash/settings', { retentionDays: 30 })
  assert.equal(result.status, 200)
  assert.equal(result.body.settings.retentionDays, 30)
  const stored = JSON.parse(await readFile(join(process.env.DSH_SESSIONS_MANAGER_TRASH_DIR, 'index.json'), 'utf8'))
  assert.equal(stored.schemaVersion, 2)
  assert.equal(stored.settings.retentionDays, 30)
})

test('rejects unsafe session ids', async () => {
  const result = await call('/archived-sessions/delete', { sessionId: '../escape' })
  assert.equal(result.status, 400)
  assert.match(result.body.error, /sessionId/)
})

test('keeps activity, archive and trash transitions consistent', async () => {
  let result = await call('/archived-sessions/archive', { sessionId: 'known-1' })
  assert.equal(result.body.archived, true)
  assert.deepEqual(domainState.archivedSessionIds, ['known-1'])

  result = await call('/archived-sessions/restore', { sessionId: 'known-1' })
  assert.equal(result.body.restored, true)
  assert.deepEqual(domainState.archivedSessionIds, [])

  result = await call('/archived-sessions/delete', { sessionId: 'known-1' })
  assert.equal(result.body.trashed, true)
  result = await call('/archived-sessions/trash/restore', { sessionId: 'known-1' })
  assert.equal(result.body.restored, true)
  const trash = await call('/archived-sessions/trash/list')
  assert.equal(trash.body.items.some((item) => item.sessionId === 'known-1'), false)
  assert.deepEqual(domainState.archivedSessionIds, [])
})

test('serializes concurrent archive and restore operations without duplicate ids', async () => {
  await Promise.all([
    call('/archived-sessions/archive', { sessionId: 'known-1' }),
    call('/archived-sessions/archive', { sessionId: 'known-1' }),
  ])
  assert.deepEqual(domainState.archivedSessionIds, ['known-1'])
  await Promise.all([
    call('/archived-sessions/restore', { sessionId: 'known-1' }),
    call('/archived-sessions/restore', { sessionId: 'known-1' }),
  ])
  assert.deepEqual(domainState.archivedSessionIds, [])
})

test('restores an archived trashed session to its pre-delete archived state', async () => {
  await call('/archived-sessions/archive', { sessionId: 'known-1' })
  await call('/archived-sessions/delete', { sessionId: 'known-1' })
  const restored = await call('/archived-sessions/trash/restore', { sessionId: 'known-1' })
  assert.equal(restored.body.restored, true)
  assert.deepEqual(domainState.archivedSessionIds, ['known-1'])

  await call('/archived-sessions/restore', { sessionId: 'known-1' })
  assert.deepEqual(domainState.archivedSessionIds, [])
})

test('serves latest log-folded titles to the cold sidebar', async () => {
  const state = await call('/archived-sessions/sidebar-state')
  assert.equal(state.body.titles['known-1'], 'Latest renamed title')
})

test('hard purge detaches a live session and persists an authoritative tombstone', async () => {
  await call('/archived-sessions/delete', { sessionId: 'known-1' })
  const purged = await call('/archived-sessions/trash/purge', { sessionId: 'known-1' })
  assert.equal(purged.body.purged, true)
  assert.equal(liveSessions.has('known-1'), false)
  await assert.rejects(readFile(sessionPath))
  const state = await call('/archived-sessions/sidebar-state')
  assert.equal(state.body.purgedSessionIds.includes('known-1'), true)
  assert.equal(state.body.trashedSessionIds.includes('known-1'), false)
})
