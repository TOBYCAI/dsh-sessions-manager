// v3.6.2 热修回归：占位三态化（#1）、live-only 不入队（#9）、回收站诚实标题
// （#7）、lineage-tree 请求路径零解码（#4）、refine 预算（分支标签延迟审计）。
//
// 契约（与 issue #8 的「请求路径零投影」叠加）：
//   1. 投影 **失败**（rejected / 异常 / 缺条）→ 绝不写 metaCache、绝不落持久索引；
//      按 id 退避重试（改日志指纹即重新武装），失败不再被固化为永久占位。
//   2. 持久索引 title:null 条目必须带 resolved 标记才可信（v1 污染自动丢弃）。
//   3. 算不出任何指纹的会话（live 未落盘）不入预热队列（杜绝每拍重复投影）。
//   4. delete 路径只消费缓存，不投影；标题未知时存 null，预热解出后补写回收站。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Readable } from 'node:stream'
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(cond, msg = 'condition not met in time', limit = 200) {
  for (let i = 0; i < limit; i++) {
    const v = await cond()
    if (v) return v
    await sleep(25)
  }
  assert.fail(msg)
}

/**
 * boot：一套可配置的可插拔假 ctx。
 *  era='legacy' —— list 返回裸 header（collectUsage 走 locate+stat，文件指纹）
 *  era='handle' —— list 返回 {header, revision, sizeBytes} 快照（rev 指纹）
 *  reject       —— 可变 Set：成员 id 的投影返回 rejected（模拟解码失败）
 *  noTitle      —— fulfilled 但无 title 事件（真·无标题）
 */
async function boot(opts = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsm-tri-'))
  const trashDir = join(root, 'trash')
  process.env.DSH_SESSIONS_MANAGER_TRASH_DIR = trashDir
  process.env.DSH_SESSIONS_MANAGER_STAR_DIR = join(root, 'state')
  process.env.DSH_SESSIONS_MANAGER_PENDING_DIR = join(root, 'pending')
  await mkdir(trashDir, { recursive: true })

  const ids = opts.ids || []
  const era = opts.era || 'legacy'
  const reject = opts.reject || new Set()
  const noTitle = !!opts.noTitle
  const live = opts.live || []
  const projected = []
  const opens = []
  const sessionsDir = join(root, 'logs')

  const headerOf = (id) => {
    const h = { id, cwd: root, createdAt: 1 }
    const extra = (opts.headers && opts.headers[id]) || {}
    return Object.assign(h, extra)
  }
  async function ensureLog(id) {
    const p = join(sessionsDir, `${id}.jsonl.zstd`)
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, 'x'.repeat(opts.logSize || 10))
    return p
  }
  for (const id of ids) await ensureLog(id)

  const ctx = {
    workspaceRegistry: { list: () => [], state: { archivedSessionIds: [] }, archiveSession: async () => {} },
    sessionPersistence: {
      list: async () => {
        if (era === 'handle') {
          // revision 保持稳定：模拟「日志未变」；变化会像真实 runtime 一样触发重投影。
          return ids.map((id) => ({ header: headerOf(id), revision: `r-${id}`, sizeBytes: opts.handleSize || 10 }))
        }
        return ids.map((id) => headerOf(id))
      },
      locate: (h) => ({ path: join(sessionsDir, `${h.id}.jsonl.zstd`) }),
      readFrom: async (id) => ({ meta: headerOf(id), events: [] }),
      // handle 世代读取面（refine/inspect 走 open+read+close）
      open: async (id) => {
        opens.push(String(id))
        return { read: async () => ({ eventState: 'shared-frozen', events: [] }), close: async () => {} }
      },
    },
    sessionQuery: {
      readTitleSnapshots: async (reqIds) => {
        projected.push(...reqIds.map(String))
        return reqIds.map((id) => {
          const key = String(id)
          if (reject.has(key)) return { status: 'rejected', reason: new Error('decode boom') }
          if (noTitle) return { status: 'fulfilled', value: { session: headerOf(key) } }
          return { status: 'fulfilled', value: { session: headerOf(key), title: { title: `T-${key}` } } }
        })
      },
    },
    storageDomain: { get: () => ({ global: { get: () => ({ archivedSessionIds: [] }), set: async () => {} } }) },
    webServer: { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
    get: (name) => (name === 'sessions' && live.length ? { list: () => live.map((s) => ({ id: s.id, header: s.header || headerOf(s.id) })) } : null),
    effect: (fn) => fn(),
  }
  const routes = new Map()
  const { apply } = await import(`../src/index.js?tri=${Date.now()}-${Math.random()}`)
  apply(ctx)
  const call = async (path, body = {}) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))])
    let status = 200
    let text = ''
    const res = { writeHead: (v) => { status = v }, end: (v) => { text += v || '' } }
    await routes.get(path)(req, res)
    return { status, body: JSON.parse(text) }
  }
  const indexPath = () => join(trashDir, 'title-index.json')
  const readIndex = async () => { try { return JSON.parse(await readFile(indexPath(), 'utf8')) } catch (e) { return null } }
  const touch = async (id) => {
    const p = join(sessionsDir, `${id}.jsonl.zstd`)
    const far = new Date(Date.now() + 120_000)
    await utimes(p, far, far)
    return p
  }
  return { root, call, projected, opens, readIndex, touch, headerOf, trashDir, ensureLog }
}

// persistDecoded 是后台浮动写：teardown 可能撞上「rmdir 时刚落盘」（本仓库
// 已知竞态，见 index.js persistDecoded 注释）。重试式清理。
async function cleanup(b) {
  for (let i = 0; i < 60; i++) {
    try { await rm(b.root, { recursive: true, force: true }); return }
    catch (e) { if (e && e.code === 'ENOTEMPTY') { await sleep(50); continue } throw e }
  }
}

// —— #1：失败固化通道必须关闭 ————————————————————————————————————————————

test('projection failures never enter the cache or the persisted index, and back off until re-armed', async () => {
  const reject = new Set(['f1'])
  const b = await boot({ ids: ['f1'], reject })
  try {
    const cold = await b.call('/archived-sessions/sessions', {})
    assert.equal(cold.body.items[0].title, null)
    assert.equal(cold.body.warmPending, true, 'queue/failed-retries in flight must report pending')
    await waitFor(() => b.projected.length >= 1)
    await sleep(80)
    assert.equal(await b.readIndex(), null, 'a failed projection must never persist an index entry')
    // 退避窗口内：后续请求不重复投影（也不是永久缓存——指纹变化会重新武装）。
    await b.call('/archived-sessions/sessions', {})
    await sleep(80)
    assert.equal(b.projected.length, 1, 'failed ids back off; no per-poll re-projection churn')
    // 改日志 → 指纹变 → 重新武装重试。
    reject.clear()
    await b.touch('f1')
    await b.call('/archived-sessions/sessions', {})
    await waitFor(() => b.projected.length >= 2)
    await waitFor(async () => (await b.readIndex())) // 成功后才允许落盘
    const warm = await b.call('/archived-sessions/sessions', {})
    assert.equal(warm.body.items[0].title, 'T-f1', 'after a successful retry the real title surfaces')
    assert.equal(warm.body.warmPending, false)
  } finally { await cleanup(b) }
})

test('a genuinely titleless session persists as resolved and is trusted across restarts', async () => {
  const b = await boot({ ids: ['n1'], noTitle: true })
  try {
    await b.call('/archived-sessions/sessions', {})
    await waitFor(() => b.projected.length >= 1)
    const stored = await waitFor(async () => {
      const i = await b.readIndex()
      return i && i.entries && Object.keys(i.entries).length ? i : null
    }, 'resolved-null entry must be persisted')
    assert.equal(stored.schemaVersion, 2)
    assert.equal(stored.entries.n1.title, null)
    assert.equal(stored.entries.n1.resolved, 1, 'resolved marker is what makes a null title trustworthy')
    // 「重启」：新实例同目录 → 冷读持久索引命中，绝不再投影。
    const before = b.projected.length
    const { apply: applyCold } = await import(`../src/index.js?cold-tri=${Date.now()}`)
    const coldRoutes = new Map()
    const header = b.headerOf('n1')
    const cctx = {
      workspaceRegistry: { list: () => [], state: {}, archiveSession: async () => {} },
      sessionPersistence: {
        list: async () => [header],
        locate: (h) => ({ path: join(b.root, 'logs', `${h.id}.jsonl.zstd`) }),
        readFrom: async () => ({ meta: header, events: [] }),
      },
      sessionQuery: { readTitleSnapshots: async () => { throw new Error('cold start must not project at all here') } },
      storageDomain: { get: () => ({ global: { get: () => ({ archivedSessionIds: [] }), set: async () => {} } }) },
      webServer: { register: (r) => { coldRoutes.set(r.path, r.handler); return () => {} } },
      get: () => null,
      effect: (fn) => fn(),
    }
    applyCold(cctx)
    const ccall = async (path, body = {}) => {
      const req = Readable.from([Buffer.from(JSON.stringify(body))])
      let st = 200; let text = ''
      const res = { writeHead: (v) => { st = v }, end: (v) => { text += v || '' } }
      await coldRoutes.get(path)(req, res)
      return { status: st, body: JSON.parse(text) }
    }
    const r1 = await ccall('/archived-sessions/sessions', {})
    assert.equal(r1.status, 200)
    assert.equal(r1.body.items[0].title, null, 'still titleless — but from the resolved index, not a projection')
    assert.equal(r1.body.warmPending, false, 'resolved-null must not re-enter the warm queue')
    assert.equal(b.projected.length, before)
  } finally { await cleanup(b) }
})

test('legacy poisoned entries (null title, no resolved flag) are dropped and re-warmed', async () => {
  const b = await boot({ ids: ['p1'] })
  try {
    const st = await stat(join(b.root, 'logs', 'p1.jsonl.zstd'))
    const fp = `${Math.floor(st.mtimeMs)}:${st.size}`
    await writeFile(join(b.trashDir, 'title-index.json'), JSON.stringify({
      schemaVersion: 2,
      entries: { p1: { title: null, cwd: b.root, createdAt: 1, fingerprint: fp, updatedAt: 1 } },
    }))
    const cold = await b.call('/archived-sessions/sessions', {})
    assert.equal(cold.body.items[0].title, null)
    await waitFor(() => b.projected.length >= 1, 'poisoned entry must trigger a re-warm')
    const warm = await b.call('/archived-sessions/sessions', {})
    assert.equal(warm.body.items[0].title, 'T-p1')
    await waitFor(async () => {
      const i = await b.readIndex()
      return i && i.entries.p1 && i.entries.p1.title === 'T-p1' ? i : null
    }, 'healed entry must replace the poisoned one')
    const stored = await b.readIndex()
    assert.equal(stored.entries.p1.resolved, 1)
  } finally { await cleanup(b) }
})

// —— #9：无指纹会话不得入队（churn 防护） ————————————————————————————————

test('live-only sessions without any fingerprint never enter the warm queue', async () => {
  const b = await boot({ ids: [], live: [{ id: 'lv1' }] })
  try {
    const r = await b.call('/archived-sessions/sessions', {})
    assert.equal(r.status, 200)
    assert.equal(r.body.items[0].sessionId, 'lv1')
    await sleep(120)
    assert.deepEqual(b.projected, [], 'a session whose result can never be cached must not be projected at all')
    const r2 = await b.call('/archived-sessions/sessions', {})
    assert.equal(r2.body.warmPending, false, 'uncacheable ids are skipped, not churned')
  } finally { await cleanup(b) }
})

// —— #7：回收站诚实标题 + 预热后补写 ——————————————————————————————————————

test('delete stores an honest null title (no cwd/id faking) and later warm backfills it', async () => {
  const reject = new Set(['d1'])
  const b = await boot({ ids: ['d1'], reject })
  try {
    // 预热会失败 → 缓存里永远没有标题 → delete 只能存 null。
    await b.call('/archived-sessions/sessions', {})
    await waitFor(() => b.projected.length >= 1)
    const del = await b.call('/archived-sessions/delete', { sessionId: 'd1' })
    assert.equal(del.body.trashed, true)
    assert.equal(b.projected.length, 1, 'the delete path itself must not project')
    let list = await b.call('/archived-sessions/trash/list', {})
    assert.equal(list.body.items[0].title, null, 'unknown title is stored as null, never as cwd or the raw id')
    // 修好投影 + 换指纹重新武装 → sidebar-state（含回收站 id，走全量预热）补写。
    reject.clear()
    await b.touch('d1')
    await b.call('/archived-sessions/sidebar-state', {})
    await waitFor(() => b.projected.length >= 2)
    await waitFor(async () => { const l = await b.call('/archived-sessions/trash/list', {}); return l.body.items[0] && l.body.items[0].title === 'T-d1' })
    list = await b.call('/archived-sessions/trash/list', {})
    assert.equal(list.body.items[0].title, 'T-d1')
  } finally { await cleanup(b) }
})

// —— #4：lineage-tree 请求路径零解码，暖后标题浮现 ————————————————————————

test('lineage-tree never decodes on the request path; titles appear after warm', async () => {
  const b = await boot({
    era: 'handle',
    ids: ['p1', 's1'],
    headers: { s1: { origin: 'subagent', parentSession: 'p1', delegationDepth: 1 } },
    handleSize: 20000, // 远离 refine 的 ≤8KB 候选区，行为可归因
  })
  try {
    // 先让全量预热把标题喂进缓存（sidebarAuthority 的 enqueue 路径）。
    await b.call('/archived-sessions/sidebar-state', {})
    await waitFor(() => b.projected.length >= 2)
    const before = b.projected.length
    const tree = await b.call('/archived-sessions/lineage-tree', { sessionId: 'p1' })
    assert.equal(tree.status, 200)
    assert.equal(tree.body.nodes.length, 1)
    assert.equal(tree.body.nodes[0].sessionId, 's1')
    assert.equal(tree.body.nodes[0].title, 'T-s1', 'title comes from the cache/authority, not a decode')
    assert.equal(tree.body.parent.title, 'T-p1')
    assert.equal(b.projected.length, before, 'lineage-tree must not project synchronously (issue #8 pattern)')
  } finally { await cleanup(b) }
})

test('lineage-tree on a cold cache returns null titles and enqueues background warm', async () => {
  const b = await boot({
    era: 'handle',
    ids: ['p2', 's2'],
    headers: { s2: { origin: 'subagent', parentSession: 'p2', delegationDepth: 1 } },
    handleSize: 20000,
  })
  try {
    const tree = await b.call('/archived-sessions/lineage-tree', { sessionId: 'p2' })
    assert.equal(tree.body.nodes[0].title, null, 'cold: honest placeholder this round')
    await waitFor(() => b.projected.length >= 2, 'the miss must have enqueued background warm')
    const again = await b.call('/archived-sessions/lineage-tree', { sessionId: 'p2' })
    assert.equal(again.body.nodes[0].title, 'T-s2')
  } finally { await cleanup(b) }
})

// —— refine 预算：sidebar-state 不被串行小日志解码挡在 return 前 ————————————

test('refineEmptyLineage caps per-request decodes to the budget and converges progressively', async () => {
  const ids = Array.from({ length: 45 }, (_, i) => `r${i}`)
  const b = await boot({ era: 'handle', ids, handleSize: 200 })
  try {
    const first = await b.call('/archived-sessions/sidebar-state', {})
    assert.equal(first.status, 200)
    assert.ok(b.opens.length <= 40, `first pass must respect the refine budget, decoded ${b.opens.length}`)
    assert.ok(b.opens.length >= 1, 'budget>0: some refinement does happen')
    const mid = b.opens.length
    await b.call('/archived-sessions/sidebar-state', {})
    assert.ok(b.opens.length > mid, 'the next pass keeps refining the remainder')
    assert.ok(b.opens.length <= 80)
  } finally { await cleanup(b) }
})

// —— 单元：normalizeEntry 的 resolved 规则 —————————————————————————————————

test('normalizeEntry: null titles require the resolved flag; real titles survive without it', async () => {
  const { normalizeEntry } = await import('../src/title-persist-index.js')
  const base = { cwd: '/x', createdAt: 1, fingerprint: 'sz:10', updatedAt: 1 }
  assert.equal(normalizeEntry({ ...base, title: null }), null)
  assert.deepEqual(normalizeEntry({ ...base, title: null, resolved: 1 }), { ...base, title: null, resolved: 1 })
  assert.ok(normalizeEntry({ ...base, title: 'real' }))
})

// —— 单元：sidebar-state / sessions 的 warmPending 是布尔 ———————————————————

test('warmPending is a boolean on both list routes and settles false', async () => {
  const b = await boot({ ids: ['w1'] })
  try {
    const s = await b.call('/archived-sessions/sidebar-state', {})
    assert.equal(typeof s.body.warmPending, 'boolean')
    await waitFor(() => b.projected.length >= 1)
    await sleep(80)
    const done = await b.call('/archived-sessions/sidebar-state', {})
    assert.equal(done.body.warmPending, false)
    assert.ok(done.body.titles.w1, 'title is authoritative after warm')
  } finally { await cleanup(b) }
})
