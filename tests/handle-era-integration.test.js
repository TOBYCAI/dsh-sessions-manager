// handle 世代（dsh-v0.1.3-alpha.1 形状）的 host 级集成回归。
//
// 模拟官方 0.1.3 公共契约的宿主形态：
//   - sessionPersistence 只有 create/open/flush/stat/list（无 readFrom/locate）
//   - list() 返回 SessionPersistenceSnapshot（header/revision/sizeBytes）
//   - SessionHandle.read(offset, length) 有界分页
//
// 断言（2026-09-06 兼容优化 → issue #8 契约升级）：
//   1. 请求路径零投影、零整本日志解码：未缓存标题以占位返回，缺失会话交后台
//      预热（分批 + 让步），预热结果由后续轮询自然拿到
//   2. revision 相同的重复列表完全命中缓存（零投影、零 handle 打开）
//   3. revision 变化只重投影该会话（增量刷新，仍在后台）
//   4. revision 指纹绝不落盘；handle 世代改用 sz:sizeBytes 跨重启指纹持久化
//      （issue #8 之前 handle 世代从不写持久索引，每次重启全量重新解码）
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Readable } from 'node:stream'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let root
let routes
let projectedIds
let openCount
let revision
let events

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsm-handle-'))
  process.env.DSH_SESSIONS_MANAGER_TRASH_DIR = join(root, 'trash')
  process.env.DSH_SESSIONS_MANAGER_STAR_DIR = join(root, 'state')
  process.env.DSH_SESSIONS_MANAGER_PENDING_DIR = join(root, 'pending')
  await mkdir(process.env.DSH_SESSIONS_MANAGER_TRASH_DIR, { recursive: true })
  const { apply } = await import(`../src/index.js?handle=${Date.now()}`)
  routes = new Map()
  projectedIds = []
  openCount = 0
  revision = 'rev-1'
  events = [
    { type: 'session/title', data: { title: 'Handle era session' } },
    { type: 'user/message', data: { content: [{ type: 'text', text: 'hi' }] } },
  ]
  const header = { id: 'h-1', cwd: root, createdAt: 1 }
  const sessionsById = new Map([['h-1', { header, revision: () => revision, events }]])
  const sp = {
    async list() {
      return [...sessionsById.values()].map((s) => ({ header: s.header, revision: s.revision(), sizeBytes: 123 }))
    },
    async stat(id) {
      const s = sessionsById.get(id)
      return s ? { header: s.header, revision: s.revision(), sizeBytes: 123 } : undefined
    },
    async open(id, access) {
      assert.equal(access, 'read')
      openCount++
      const s = sessionsById.get(id)
      return {
        header: s.header,
        inheritedEventCount: 0,
        async read(offset, length) { return events.slice(offset, offset + length) },
        async close() {},
      }
    },
  }
  const ctx = {
    workspaceRegistry: { list: () => [], state: { archivedSessionIds: [] }, archiveSession: async () => {} },
    sessionPersistence: sp,
    sessionQuery: {
      readTitleSnapshots: async (ids) => {
        projectedIds.push(...ids.map(String))
        return ids.map(() => ({ status: 'fulfilled', value: { session: header, title: { title: 'Handle era session' } } }))
      },
    },
    storageDomain: { get: () => ({ global: { get: () => ({ archivedSessionIds: [] }), set: async () => {} } }) },
    webServer: { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
    get: () => null,
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForProjection(expectedLength) {
  for (let i = 0; i < 200; i++) {
    if (projectedIds.length >= expectedLength) return
    await sleep(25)
  }
  assert.fail(`expected ${expectedLength} projections, got ${projectedIds.length}: ${JSON.stringify(projectedIds)}`)
}

test('cold list serves placeholders with zero log reads; titles arrive via background warm (issue #8)', async () => {
  const first = await call('/archived-sessions/sessions', {})
  assert.equal(first.status, 200)
  assert.deepEqual(projectedIds, [], 'the request path must not project synchronously')
  assert.equal(openCount, 0, 'listing must never open a SessionHandle / decode the log')
  assert.equal(first.body.items[0].title, null, 'uncached title is a placeholder until warm finishes')
  assert.equal(first.body.items[0].workspacePath, root, 'cwd comes from snapshot.header even before titles arrive')
  await waitForProjection(1)
  const warm = await call('/archived-sessions/sessions', {})
  assert.equal(warm.body.items[0].title, 'Handle era session')
  assert.equal(warm.body.items[0].sessionId, 'h-1')
})

test('an unchanged revision fully hits the cache (no re-projection, no handle)', async () => {
  const beforeIds = [...projectedIds]
  const beforeOpen = openCount
  await call('/archived-sessions/sessions', {})
  assert.deepEqual(projectedIds, beforeIds)
  assert.equal(openCount, beforeOpen)
})

test('a revision bump re-projects only that session — in the background, still zero log reads', async () => {
  revision = 'rev-2'
  const again = await call('/archived-sessions/sessions', {})
  assert.equal(again.status, 200)
  assert.equal(openCount, 0, 'revision bumps never trigger a log read in the request path')
  await waitForProjection(2)
  assert.deepEqual(projectedIds, ['h-1', 'h-1'])
  const warm = await call('/archived-sessions/sessions', {})
  assert.equal(warm.body.items[0].title, 'Handle era session')
})

test('handle-era fingerprints persist as sz:sizeBytes, never rev: (issue #8)', async () => {
  await waitForProjection(2)
  const stored = JSON.parse(await readFile(join(process.env.DSH_SESSIONS_MANAGER_TRASH_DIR, 'title-index.json'), 'utf8'))
  const entry = stored.entries['h-1']
  assert.ok(entry, 'handle-era metadata must now be persisted across restarts (issue #8)')
  assert.equal(entry.fingerprint, 'sz:123', 'sizeBytes is the cross-restart change token on the handle era')
  assert.doesNotMatch(entry.fingerprint, /^rev:/, 'revision is instance-scoped and must never be persisted')
})
