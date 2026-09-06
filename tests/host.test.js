import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Readable } from 'node:stream'
import { existsSync, writeFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

let root
let routes
let domainState
let sessionPath
let liveSessions
// 模拟「后端索引仍记录会话，但日志文件已被外部移走」的退化场景。
let indexStale = false

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
      // 真实后端的 list 读磁盘：日志被 unlink 后不再返回该会话。indexStale
      // 刻意让索引「记得」一个已消失的会话，用于恢复校验的错误分支。
      list: async () => (indexStale || existsSync(sessionPath) ? [header] : []),
      locate: (item) => item.id === 'known-1' ? { path: sessionPath } : null,
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

function resetSessionFixture() {
  indexStale = false
  liveSessions.set('known-1', { id: 'known-1', header: { id: 'known-1', cwd: root, title: 'Known session', createdAt: Date.now() }, events: [] })
  domainState.archivedSessionIds = []
  if (!existsSync(sessionPath)) {
    // 动态 list mock 依赖磁盘现状：先落一个最小日志文件再继续。
    writeFileSync(sessionPath, 'test')
  }
}

test('reports the runtime action capabilities used by the UI', async () => {
  const result = await call('/archived-sessions/capabilities')
  assert.equal(result.status, 200)
  assert.equal(result.body.persistence, 'legacy')
  assert.equal(result.body.actions.read.available, true)
  assert.equal(result.body.actions.purge.available, true)
  assert.equal(typeof result.body.actions.move.reason === 'string' || result.body.actions.move.available, true)
  // 新规范键名同时输出
  assert.equal(result.body.actions.physicalPurge.available, true)
  assert.equal(result.body.actions.restoreIndexedSession.available, true)
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

// ---- 回收站状态机回归（0.1.3 兼容加固）-------------------------------------

test('duplicate soft delete keeps exactly one recoverable entry', async () => {
  await call('/archived-sessions/delete', { sessionId: 'known-1' })
  const second = await call('/archived-sessions/delete', { sessionId: 'known-1' })
  assert.equal(second.status, 200)
  const trash = await call('/archived-sessions/trash/list')
  assert.equal(trash.body.items.filter((item) => item.sessionId === 'known-1').length, 1)
  await call('/archived-sessions/trash/restore', { sessionId: 'known-1' })
})

test('duplicate restore fails with an accurate 404, not a fake success', async () => {
  await call('/archived-sessions/delete', { sessionId: 'known-1' })
  const first = await call('/archived-sessions/trash/restore', { sessionId: 'known-1' })
  assert.equal(first.body.restored, true)
  const second = await call('/archived-sessions/trash/restore', { sessionId: 'known-1' })
  assert.equal(second.status, 404)
  assert.equal(second.body.code, 'DSM_TRASH_NOT_FOUND')
})

test('an externally lost session cannot be restored (index vs log divergence)', async () => {
  // 模拟重启后的世界：内存里没有 live 会话，只有磁盘与索引。
  liveSessions.clear()
  await call('/archived-sessions/delete', { sessionId: 'known-1' })
  // 场景 A：索引仍在（list 返回该会话）但日志文件被外部移走
  indexStale = true
  try { await rm(sessionPath) } catch (e) {}
  const lostLog = await call('/archived-sessions/trash/restore', { sessionId: 'known-1' })
  assert.equal(lostLog.status, 409)
  assert.equal(lostLog.body.code, 'DSM_SESSION_LOG_MISSING')
  // 回收站条目必须原样保留（校验失败绝不写状态）
  const stillThere = await call('/archived-sessions/trash/list')
  assert.equal(stillThere.body.items.some((item) => item.sessionId === 'known-1'), true)
  // 场景 B：索引也丢了（list 不再返回该会话）
  indexStale = false
  const missing = await call('/archived-sessions/trash/restore', { sessionId: 'known-1' })
  assert.equal(missing.status, 409)
  assert.equal(missing.body.code, 'DSM_SESSION_MISSING')
  // 人工修复（文件回来了）后可正常恢复 —— 错误是可恢复的，不是终局判决
  await writeFile(sessionPath, 'test')
  const healed = await call('/archived-sessions/trash/restore', { sessionId: 'known-1' })
  assert.equal(healed.body.restored, true)
})

test('a purged session cannot be restored again and reports DSM_SESSION_PURGED', async () => {
  await call('/archived-sessions/delete', { sessionId: 'known-1' })
  const purged = await call('/archived-sessions/trash/purge', { sessionId: 'known-1' })
  assert.equal(purged.body.purged, true)
  const again = await call('/archived-sessions/trash/restore', { sessionId: 'known-1' })
  assert.equal(again.status, 410)
  assert.equal(again.body.code, 'DSM_SESSION_PURGED')
})

test('hard purge detaches a live session and persists an authoritative tombstone', async () => {
  resetSessionFixture()
  await call('/archived-sessions/delete', { sessionId: 'known-1' })
  const purged = await call('/archived-sessions/trash/purge', { sessionId: 'known-1' })
  assert.equal(purged.body.purged, true)
  assert.equal(liveSessions.has('known-1'), false)
  await assert.rejects(readFile(sessionPath))
  const state = await call('/archived-sessions/sidebar-state')
  assert.equal(state.body.purgedSessionIds.includes('known-1'), true)
  assert.equal(state.body.trashedSessionIds.includes('known-1'), false)
})

test('a purged tombstone never suppresses a later session with the same id', async () => {
  resetSessionFixture()
  await call('/archived-sessions/delete', { sessionId: 'known-1' })
  const purged = await call('/archived-sessions/trash/purge', { sessionId: 'known-1' })
  assert.equal(purged.body.purged, true)
  const during = await call('/archived-sessions/sidebar-state')
  assert.equal(during.body.purgedSessionIds.includes('known-1'), true)

  // 同 id 会话重新出现（重建/重新落盘）：墓碑必须让位，不能永久压住。
  await writeFile(sessionPath, 'reborn')
  const panel = await call('/archived-sessions/sessions', {})
  assert.equal(panel.body.items.some((item) => item.sessionId === 'known-1'), true, 'recreated session must be listed again')
  const after = await call('/archived-sessions/sidebar-state')
  assert.equal(after.body.purgedSessionIds.includes('known-1'), false, 'tombstone must yield once the id is present again')
  const trashList = await call('/archived-sessions/trash/list')
  assert.equal(trashList.body.items.some((item) => item.sessionId === 'known-1'), false)
  resetSessionFixture()
})

test('restore keeps trash verification honest about unverified entries', async () => {
  const check = await call('/archived-sessions/trash/verify', {})
  assert.equal(check.status, 200)
  assert.equal(typeof check.body.healthy, 'number')
  assert.equal(typeof check.body.unverified, 'number')
})
