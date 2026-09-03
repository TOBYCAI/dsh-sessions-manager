// End-to-end coverage for the storage rollup and the auto-archive sweep,
// driven through the real host routes against a mock cordis context.
//
// The two sessions are real files on a temp disk and their mtime is what does
// the work: that is exactly the signal auto-archive reads in production, so a
// green run here proves the rule fires on the right session — not merely that
// the route answers.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Readable } from 'node:stream'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const DAY = 86400000
let root
let routes
let domainState
let logPaths
let liveSessions
let activeId = null

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsm-storage-'))
  // Every durable store this plugin owns is redirected to the temp dir — the
  // sweep and the star index must never touch the real ~/.dsh state.
  process.env.DSH_SESSIONS_MANAGER_TRASH_DIR = join(root, 'trash')
  process.env.DSH_SESSIONS_MANAGER_STAR_DIR = join(root, 'stars')
  process.env.DSH_SESSIONS_MANAGER_AUTO_ARCHIVE_DIR = join(root, 'aa')
  await mkdir(process.env.DSH_SESSIONS_MANAGER_TRASH_DIR, { recursive: true })

  logPaths = {
    'old-1': join(root, 'old-1', 'session.jsonl.zstd'),
    'new-1': join(root, 'new-1', 'session.jsonl.zstd'),
  }
  for (const p of Object.values(logPaths)) {
    await mkdir(dirname(p), { recursive: true })
  }
  await writeFile(logPaths['old-1'], 'x'.repeat(1000), 'utf8')
  await writeFile(logPaths['new-1'], 'y'.repeat(3000), 'utf8')
  // mtime is the last-activity signal: old-1 froze 100 days ago, new-1 is now.
  const frozen = (Date.now() - 100 * DAY) / 1000
  await utimes(logPaths['old-1'], frozen, frozen)

  const wsPath = join(root, 'ws-a')
  const headers = [
    { id: 'old-1', cwd: wsPath, title: 'Old conversation', createdAt: Date.now() - 100 * DAY },
    { id: 'new-1', cwd: wsPath, title: 'New conversation', createdAt: Date.now() },
  ]
  liveSessions = new Map(headers.map((h) => [h.id, { id: h.id, header: h, events: [] }]))
  const sessions = {
    get: (id) => liveSessions.get(id),
    list: () => [...liveSessions.values()],
    flush: async () => true,
    store: new Map(),
  }
  const wsEntries = [{ id: 'ws-a', path: wsPath, title: 'Project A', sessionIds: ['old-1', 'new-1'], detachSession: async () => {} }]
  domainState = { archivedSessionIds: [] }
  routes = new Map()

  const ctx = {
    workspaceRegistry: {
      list: () => wsEntries,
      state: domainState,
      archiveSession: async (sid) => {
        if (!domainState.archivedSessionIds.includes(sid)) domainState.archivedSessionIds.push(sid)
      },
    },
    sessionPersistence: {
      list: async () => headers,
      locate: (item) => (item && logPaths[item.id] ? { path: logPaths[item.id] } : null),
      readFrom: async (sid) => ({ meta: headers.find((h) => h.id === sid) || null, events: [] }),
    },
    sessionQuery: {
      readTitleSnapshot: async (sid) => {
        const h = headers.find((x) => x.id === sid)
        return h ? { session: h, title: { title: h.title } } : null
      },
      readTitleSnapshots: async (ids) => ids.map((sid) => {
        const h = headers.find((x) => x.id === sid)
        return { status: 'fulfilled', value: h ? { session: h, title: { title: h.title } } : null }
      }),
    },
    storageDomain: { get: () => ({ global: { get: () => domainState, set: async (next) => Object.assign(domainState, next) } }) },
    webServer: { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
    get: (name) => {
      if (name === 'sessions') return sessions
      if (name === 'activeSession' && activeId) return activeId
      return null
    },
    effect: (fn) => fn(),
  }
  const { apply } = await import(`../src/index.js?storage=${Date.now()}`)
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

async function resetArchived() { domainState.archivedSessionIds = [] }

test('storage rolls bytes up per workspace and ranks the largest sessions', async () => {
  const result = await call('/archived-sessions/storage', { topN: 5 })
  assert.equal(result.status, 200)
  // Both logs are on disk and sized, so the total is the sum of both files.
  assert.equal(result.body.totalBytes, 4000)
  assert.equal(result.body.sessionCount, 2)
  assert.equal(result.body.sizedSessions, 2)
  assert.equal(result.body.unknownSessions, 0)
  assert.equal(result.body.workspaces.length, 1)
  assert.equal(result.body.workspaces[0].title, 'Project A')
  assert.equal(result.body.workspaces[0].bytes, 4000)
  assert.equal(result.body.workspaces[0].sessions, 2)
  assert.equal(result.body.workspaces[0].share, 1)
  // new-1 is 3000 B, old-1 is 1000 B.
  assert.deepEqual(result.body.top.map((s) => s.sessionId), ['new-1', 'old-1'])
})

test('storage honours a smaller topN', async () => {
  const result = await call('/archived-sessions/storage', { topN: 1 })
  assert.equal(result.body.top.length, 1)
  assert.equal(result.body.top[0].sessionId, 'new-1')
})

test('auto-archive does nothing until it is enabled', async () => {
  await resetArchived()
  const result = await call('/archived-sessions/auto-archive/settings', {})
  assert.equal(result.status, 200)
  assert.equal(result.body.settings.inactiveDays, 0)
  assert.equal(result.body.sweep.skipped, 'disabled')
  assert.deepEqual(domainState.archivedSessionIds, [])
})

test('auto-archive rejects a window outside the whitelist', async () => {
  await resetArchived()
  const result = await call('/archived-sessions/auto-archive/settings', { inactiveDays: 7 })
  assert.equal(result.status, 400)
  assert.match(result.body.error, /inactiveDays/)
})

test('enabling auto-archive sweeps only sessions idle past the window', async () => {
  await resetArchived()
  const applied = await call('/archived-sessions/auto-archive/settings', { inactiveDays: 30 })
  assert.equal(applied.body.settings.inactiveDays, 30)
  // Turning it on is itself a sweep (the lazy trigger), so the idle session is
  // already gone by the time the settings call returns: old-1 froze 100 days
  // ago while new-1 was written moments ago.
  assert.deepEqual(domainState.archivedSessionIds, ['old-1'])
  assert.equal(applied.body.sweep.archived, 1)

  // A second pass finds nothing new: archiving is idempotent.
  const second = await call('/archived-sessions/auto-archive/run', {})
  assert.equal(second.body.archived, 0)
  assert.equal(second.body.candidates, 0)
  assert.deepEqual(domainState.archivedSessionIds, ['old-1'])
})

test('an auto-archived session stays restorable — nothing is deleted', async () => {
  await resetArchived()
  await call('/archived-sessions/auto-archive/run', {})
  assert.deepEqual(domainState.archivedSessionIds, ['old-1'])
  const restored = await call('/archived-sessions/restore', { sessionId: 'old-1' })
  assert.equal(restored.body.restored, true)
  assert.deepEqual(domainState.archivedSessionIds, [])
})

test('the session currently open is never auto-archived', async () => {
  await resetArchived()
  activeId = 'old-1'
  try {
    const result = await call('/archived-sessions/auto-archive/run', {})
    assert.equal(result.body.archived, 0)
    assert.deepEqual(domainState.archivedSessionIds, [])
  } finally {
    activeId = null
  }
})

test('starred sessions survive the sweep', async () => {
  await resetArchived()
  await call('/archived-sessions/star/set', { sessionId: 'old-1', starred: true })
  try {
    const result = await call('/archived-sessions/auto-archive/run', {})
    assert.equal(result.body.archived, 0)
    assert.deepEqual(domainState.archivedSessionIds, [])
  } finally {
    await call('/archived-sessions/star/set', { sessionId: 'old-1', starred: false })
  }
})

test('opting out of the star guard lets starred sessions be swept', async () => {
  await resetArchived()
  await call('/archived-sessions/star/set', { sessionId: 'old-1', starred: true })
  await call('/archived-sessions/auto-archive/settings', { skipStarred: false })
  try {
    const result = await call('/archived-sessions/auto-archive/run', {})
    assert.equal(result.body.archived, 1)
    assert.deepEqual(domainState.archivedSessionIds, ['old-1'])
  } finally {
    await call('/archived-sessions/auto-archive/settings', { skipStarred: true })
    await call('/archived-sessions/star/set', { sessionId: 'old-1', starred: false })
    await resetArchived()
  }
})

test('the lazy sweep is throttled to once a day', async () => {
  await resetArchived()
  // A forced run records lastRunAt; the next plain read must skip the sweep.
  const forced = await call('/archived-sessions/auto-archive/run', {})
  assert.equal(forced.body.archived, 1)
  const read = await call('/archived-sessions/auto-archive/settings', {})
  assert.equal(read.body.sweep.skipped, 'throttled')
  assert.equal(read.body.lastArchivedCount, 1)
  // force still overrides the throttle.
  const again = await call('/archived-sessions/auto-archive/run', {})
  assert.equal(again.body.candidates, 0)
})

test('disabling auto-archive stops every sweep', async () => {
  await resetArchived()
  await call('/archived-sessions/auto-archive/settings', { inactiveDays: 0 })
  const result = await call('/archived-sessions/auto-archive/run', {})
  assert.equal(result.body.skipped, 'disabled')
  assert.deepEqual(domainState.archivedSessionIds, [])
})
