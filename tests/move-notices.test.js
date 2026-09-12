// 3.7.0 T2：排队移动终局通知。store 单元 + sidebar-state/ack 路由契约。
// 注：runPendingMoves 的两个 append 点（成功/放弃）依赖启动密集重试或
// session/disposed 触发，路由级不可确定性注入——其语义由「预置通知文件 →
// 带出 → ack 清除」的投递链覆盖，append 本身由 store 单测覆盖。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Readable } from 'node:stream'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMoveNoticeStore, normalizeNotice, MAX_NOTICES, NOTICE_MAX_AGE_MS } from '../src/move-notices.js'

const fresh = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsm-mn-'))
  return { dir, store: createMoveNoticeStore({ dir }) }
}
const N = (over = {}) => ({ kind: 'moved', sessionId: 's1', targetPath: '/ws/b', at: Date.now(), ...over })

test('store: append/list/ack 幂等，坏数据宽容，TTL 过期不投递', async () => {
  const { dir, store } = await fresh()
  try {
    const first = N()
    assert.ok(await store.append(first))
    assert.ok(await store.append({ ...first }), '同 id 幂等不报错')
    const dup = (await store.list()).filter((n) => n.sessionId === 's1')
    assert.equal(dup.length, 1, '同 id 重复 append 只留一条')
    assert.equal(await store.append({ kind: 'bogus', sessionId: 'x', at: 1 }), null)
    assert.equal(await store.append({ kind: 'moved', sessionId: '', at: 1 }), null)
    assert.equal(await store.append({ kind: 'moved', sessionId: 'ok', at: 0 }), null, '无时刻不成通知')
    // 过期项：list 过滤掉（服务端 TTL 兜底「用户从不开页面」）。
    await store.append(N({ sessionId: 'old', at: Date.now() - NOTICE_MAX_AGE_MS - 10 }))
    assert.ok(!(await store.list()).some((n) => n.sessionId === 'old'))
    // ack：只清已展示项，幂等。
    const ids = (await store.list()).map((n) => n.id)
    assert.equal(await store.ack(ids), ids.length)
    assert.equal(await store.ack(ids), 0)
    // 损坏文件当空集合。
    await writeFile(join(dir, 'move-notices.json'), 'nope{')
    assert.deepEqual(await store.list(), [])
    // 落盘 0600。
    const st = await readFile(join(dir, 'move-notices.json')) && await (await import('node:fs/promises')).stat(join(dir, 'move-notices.json'))
    assert.equal(st.mode & 0o777, 0o600)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('store: 超 MAX_NOTICES 截断保留最新', async () => {
  const { dir, store } = await fresh()
  try {
    const base = Date.now() - 1000 * 1000
    for (let i = 0; i < MAX_NOTICES + 5; i++) await store.append(N({ sessionId: `s${i}`, at: base + i }))
    const list = await store.list()
    assert.equal(list.length, MAX_NOTICES)
    assert.equal(list[list.length - 1].sessionId, `s${MAX_NOTICES + 4}`, '最新一条必须存活')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('normalizeNotice: 缺省 id 可推导，畸形字段安全降级', () => {
  const n = normalizeNotice({ kind: 'abandoned', sessionId: 'zz', at: 5, attempts: 5, reason: 'boom\nstack' })
  assert.equal(n.id, 'zz:abandoned:5')
  assert.equal(n.attempts, 5)
  assert.ok(n.reason.length <= 300)
  assert.equal(normalizeNotice({ kind: 'moved', sessionId: 'a', at: 'nope' }), null)
})

// —— 路由契约：预置通知文件 → sidebar-state 带出 → ack 清除 → 空则省略字段 ——
async function bootRoutes() {
  const root = await mkdtemp(join(tmpdir(), 'dsm-mn-route-'))
  process.env.DSH_SESSIONS_MANAGER_TRASH_DIR = join(root, 'trash')
  process.env.DSH_SESSIONS_MANAGER_STAR_DIR = join(root, 'state')
  process.env.DSH_SESSIONS_MANAGER_PENDING_DIR = join(root, 'pending')
  await mkdir(process.env.DSH_SESSIONS_MANAGER_TRASH_DIR, { recursive: true })
  const routes = new Map()
  const ctx = {
    workspaceRegistry: { list: () => [], state: { archivedSessionIds: [] }, archiveSession: async () => {} },
    sessionPersistence: { list: async () => [], locate: () => null, readFrom: async () => ({ events: [] }) },
    sessionQuery: { readTitleSnapshots: async () => [], readTitleSnapshot: async () => null },
    storageDomain: { get: () => ({ global: { get: () => ({ archivedSessionIds: [] }), set: async () => {} } }) },
    webServer: { register: (r) => { routes.set(r.path, r.handler); return () => {} } },
    get: () => null,
    effect: (fn) => fn(),
  }
  const { apply } = await import(`../src/index.js?mn=${Date.now()}`)
  apply(ctx)
  const call = async (path, body = {}) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))])
    let status = 200
    let text = ''
    const res = { writeHead: (v) => { status = v }, end: (v) => { text += v || '' } }
    await routes.get(path)(req, res)
    return { status, body: JSON.parse(text) }
  }
  return { root, call }
}

test('sidebar-state carries notices until acked; empty omits the field; ack route validates input', async () => {
  const { root, call } = await bootRoutes()
  try {
    // 无通知：字段整体省略（旧载荷语义零变化）。
    const bare = await call('/archived-sessions/sidebar-state', {})
    assert.equal('moveNotices' in bare.body, false, JSON.stringify(bare.body))
    // 预置两条终局（模拟 runPendingMoves 的两个 append 点已发生）。
    const store = createMoveNoticeStore({ dir: process.env.DSH_SESSIONS_MANAGER_PENDING_DIR })
    await store.append({ kind: 'moved', sessionId: 'mv-a', targetPath: '/ws/新项目', at: Date.now() })
    await store.append({ kind: 'abandoned', sessionId: 'mv-b', targetPath: '/ws/x', at: Date.now() - 5, attempts: 5, reason: 'disk gone' })
    const carried = await call('/archived-sessions/sidebar-state', {})
    assert.equal(carried.body.moveNotices.length, 2)
    assert.ok(carried.body.moveNotices.some((n) => n.kind === 'abandoned' && n.reason === 'disk gone'))
    // ack 只清已展示的。注意投递按 at 升序：abandoned（更早）在前。
    const movedId = carried.body.moveNotices.find((n) => n.kind === 'moved').id
    const ack = await call('/archived-sessions/pending-moves/notices/ack', { ids: [movedId] })
    assert.equal(ack.body.removed, 1)
    const rest = await call('/archived-sessions/sidebar-state', {})
    assert.equal(rest.body.moveNotices.length, 1)
    assert.equal(rest.body.moveNotices[0].kind, 'abandoned')
    // 入参防御：缺 ids / 非数组 → 400。
    assert.equal((await call('/archived-sessions/pending-moves/notices/ack', {})).status, 400)
    assert.equal((await call('/archived-sessions/pending-moves/notices/ack', { ids: [] })).status, 400)
    await store.ack(rest.body.moveNotices.map((n) => n.id))
    const done = await call('/archived-sessions/sidebar-state', {})
    assert.equal('moveNotices' in done.body, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
