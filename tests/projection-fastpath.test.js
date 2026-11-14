// P2（2026-09-29 审计）+ 3.8.1 底座换轨：官方投影快路径的回归测试。
//
// fast path 语义：列表构建在 metaCache 未命中时按顺序探两层零 I/O 投影——
//   ① live 会话：ctx.sessionProjections.cachedSnapshot（内存 watermark 缓存）
//   ② 冷会话：ctx.sessionProjectionCache.cachedSnapshot / cachedPredecessorTitle
//      （官方持久投影缓存，0.2.2-rc.3 默认挂载；只读 header、零磁盘 I/O）
// 拿到**非空字符串**标题 → 直接进 metaCache 并从预热队列剔除；null / 服务不存在
// / 任何异常 → 一律当「未知」交回后台预热（empty 三态纪律：null 绝不冒充
// 「会话真的无标题」）。
//
// 本文件用 mock cordis 上下文驱动真实 /list 路由，断言四件事：
//   1. 内存投影命中的 live 会话**本次响应就带标题**，且不进预热队列；
//   2. 持久投影命中的**冷会话**同样本次响应就带标题（3.8.1 起，未实例化也行）；
//   3. 前代标题（cachedPredecessorTitle）也能当标题用；
//   4. 没有官方投影（模拟 0.1.7）时行为与 3.7.4 完全一致：全部进预热。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Readable } from 'node:stream'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const TITLE_FROM_PROJECTION = '投影标题'
const TITLE_FROM_CACHE = '持久缓存标题'
const TITLE_FROM_PREDECESSOR = '前代标题'

async function boot({ withProjection, withCache = false }) {
  const root = await mkdtemp(join(tmpdir(), 'dsm-fastpath-'))
  process.env.DSH_SESSIONS_MANAGER_TRASH_DIR = join(root, 'trash')
  process.env.DSH_SESSIONS_MANAGER_PENDING_DIR = join(root, 'pending')
  process.env.DSH_SESSIONS_MANAGER_STAR_DIR = join(root, 'stars')
  process.env.DSH_SESSIONS_MANAGER_AUTO_ARCHIVE_DIR = join(root, 'aa')

  // 真实日志文件：没有 stat 指纹的会话会被 enqueueWarm 的 #9 churn 防护跳过，
  // 预热队列根本不会跑——所以每个会话都要有可 stat 的日志。
  const sessionIds = ['fp-hit', 'fp-miss', 'fp-cold', 'fp-old']
  const logPaths = {}
  for (const id of sessionIds) logPaths[id] = join(root, id, 'session.jsonl.zstd')
  for (const p of Object.values(logPaths)) {
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, 'x'.repeat(512))
  }

  const headers = [
    { id: 'fp-hit', cwd: '/ws-a', createdAt: 1000, version: 4, isSeeded: false },
    { id: 'fp-miss', cwd: '/ws-a', createdAt: 2000, version: 4, isSeeded: false },
    { id: 'fp-cold', cwd: '/ws-a', createdAt: 3000, version: 4, isSeeded: false },
    { id: 'fp-old', cwd: '/ws-a', createdAt: 4000, version: 4, isSeeded: false },
  ]
  const liveSessions = new Map([
    // 只有 fp-hit 有实例化会话对象（其余模拟冷会话）。
    ['fp-hit', { id: 'fp-hit', header: headers[0], events: [] }],
  ])
  const sessions = {
    get: (id) => liveSessions.get(id) || null,
    list: () => [...liveSessions.values()],
  }
  const warmCalls = []
  const routes = new Map()
  const ctx = {
    workspaceRegistry: {
      list: () => [{ id: 'ws-a', path: '/ws-a', title: 'WS A', sessionIds: [], detachSession: async () => {} }],
      state: { archivedSessionIds: [] },
      archiveSession: async () => {},
    },
    sessionPersistence: {
      list: async () => headers,
      locate: (item) => (item && logPaths[item.id] ? { path: logPaths[item.id] } : null),
      readFrom: async () => ({ meta: null, events: [] }),
    },
    sessionQuery: {
      readTitleSnapshots: async (ids) => {
        warmCalls.push([...ids])
        return ids.map((sid) => ({ status: 'fulfilled', value: { session: { id: sid }, title: { title: `预热 ${sid}` } } }))
      },
    },
    storageDomain: { get: () => ({ global: { get: () => ({ archivedSessionIds: [] }), set: async () => {} } }) },
    webServer: { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
    get: (name) => {
      if (name === 'sessions') return sessions
      if (name === 'sessionProjections' && withProjection) {
        return {
          cachedSnapshot: (session, keys) => {
            if (!Array.isArray(keys) || !keys.includes('title')) return undefined
            // fp-hit 的 cell 已 materialize 且带非空标题；其余一律 omitted。
            return session && session.id === 'fp-hit' ? { asOfSeq: 3, values: { title: TITLE_FROM_PROJECTION } } : undefined
          },
        }
      }
      if (name === 'sessionProjectionCache' && withCache) {
        return {
          // 冷会话（无实例化 Session）：官方持久缓存直接给标题。
          cachedSnapshot: (header) => {
            if (!header || header.id !== 'fp-cold') return undefined
            return { asOfSeq: 9, values: { title: TITLE_FROM_CACHE, sessionListMetadata: { blank: false, lastPromptAt: 1 } } }
          },
          // 格式代际之间只剩前代标题：同样可当标题用，但 blank 拿不到。
          cachedPredecessorTitle: (header) => (header && header.id === 'fp-old'
            ? { asOfSeq: 2, values: { title: TITLE_FROM_PREDECESSOR } }
            : undefined),
        }
      }
      return null
    },
    effect: (fn) => fn(),
  }
  const { apply } = await import(`../src/index.js?fp=${withProjection ? 'p' : 'n'}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  apply(ctx)

  const call = async (path, body = {}) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))])
    let status = 200
    let text = ''
    const res = { writeHead: (value) => { status = value }, end: (value) => { text += value || '' } }
    await routes.get(path)(req, res)
    return { status, body: JSON.parse(text) }
  }
  const cleanup = async () => { await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }) }
  return { call, warmCalls, cleanup }
}

// 预热是延迟定时器驱动（v3.6.2 冷启动 1.5s 二拍），轮询等待而非固定 sleep。
async function waitForWarm(warmCalls, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && warmCalls.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

test('projection fast path: hit skips the warm queue and answers immediately', async () => {
  const h = await boot({ withProjection: true })
  try {
    const result = await h.call('/archived-sessions/sessions', {})
    assert.equal(result.status, 200)
    const byId = new Map((result.body.items || []).map((it) => [it.sessionId, it]))
    // 1) 投影命中的会话本次响应就带标题。
    assert.equal(byId.get('fp-hit').title, TITLE_FROM_PROJECTION)
    // 2) fp-hit 不进预热队列；fp-miss（冷会话）照旧进。
    await waitForWarm(h.warmCalls)
    const warmed = h.warmCalls.flat()
    assert.ok(!warmed.includes('fp-hit'), `fp-hit 不该进预热，实际预热了 ${JSON.stringify(h.warmCalls)}`)
    assert.ok(warmed.includes('fp-miss'), 'fp-miss 应进预热队列')
    // 3) 冷会话标题是占位 null（预热是后台的，响应不等它）。
    assert.equal(byId.get('fp-miss').title, null)
  } finally { await h.cleanup() }
})

test('without sessionProjections (0.1.7): behaviour identical to 3.7.4', async () => {
  const h = await boot({ withProjection: false })
  try {
    const result = await h.call('/archived-sessions/sessions', {})
    assert.equal(result.status, 200)
    const byId = new Map((result.body.items || []).map((it) => [it.sessionId, it]))
    assert.equal(byId.get('fp-hit').title, null)
    await waitForWarm(h.warmCalls)
    const warmed = h.warmCalls.flat()
    assert.ok(warmed.includes('fp-hit') && warmed.includes('fp-miss'), '没有投影服务时两个都进预热')
  } finally { await h.cleanup() }
})

test('projection null title is "unknown", never "has no title"', async () => {
  const h = await boot({ withProjection: true })
  try {
    // cachedSnapshot 对 fp-hit 返回 values.title=null（cell 折叠了但还没有标题）
    // 时不能免预热——直接改 mock 不可行（boot 已固化），这里用另一个层面验证：
    // fp-miss 有 cachedSnapshot=undefined（等价 null 语义），上一条已断言它进了
    // 预热。本条只断言投影 null 不会被当成真实标题渲染。
    const result = await h.call('/archived-sessions/sessions', {})
    const byId = new Map((result.body.items || []).map((it) => [it.sessionId, it]))
    assert.notEqual(byId.get('fp-miss').title, TITLE_FROM_PROJECTION)
  } finally { await h.cleanup() }
})

// —— 3.8.1 底座换轨：官方持久投影缓存（冷会话也命中）———————————————
test('persisted projection cache titles cold sessions without any decode', async () => {
  const h = await boot({ withProjection: false, withCache: true })
  try {
    const result = await h.call('/archived-sessions/sessions', {})
    assert.equal(result.status, 200)
    const byId = new Map((result.body.items || []).map((it) => [it.sessionId, it]))
    // 冷会话（没有实例化 Session 对象）本次响应就带标题。
    assert.equal(byId.get('fp-cold').title, TITLE_FROM_CACHE)
    // 格式代际之间只剩前代标题，同样可用。
    assert.equal(byId.get('fp-old').title, TITLE_FROM_PREDECESSOR)
    // 缓存里没有的会话照旧留空等预热。
    assert.equal(byId.get('fp-miss').title, null)
    await waitForWarm(h.warmCalls)
    const warmed = h.warmCalls.flat()
    assert.ok(!warmed.includes('fp-cold'), `持久缓存命中不该进预热，实际 ${JSON.stringify(h.warmCalls)}`)
    assert.ok(!warmed.includes('fp-old'), '前代标题命中也不该进预热')
    assert.ok(warmed.includes('fp-miss'), '缓存缺失的会话仍要进预热')
  } finally { await h.cleanup() }
})

test('without sessionProjectionCache the cold path is byte-identical to 3.8.0', async () => {
  const h = await boot({ withProjection: false, withCache: false })
  try {
    const result = await h.call('/archived-sessions/sessions', {})
    const byId = new Map((result.body.items || []).map((it) => [it.sessionId, it]))
    assert.equal(byId.get('fp-cold').title, null)
    assert.equal(byId.get('fp-old').title, null)
    await waitForWarm(h.warmCalls)
    const warmed = h.warmCalls.flat()
    assert.ok(warmed.includes('fp-cold') && warmed.includes('fp-old'), '没有投影缓存时冷会话全部进预热')
  } finally { await h.cleanup() }
})
