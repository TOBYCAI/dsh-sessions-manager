import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Readable } from 'node:stream'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { classifyLineage, emptyScanCandidate, isEmptyLogSize, isEmptyEventTypes, subagentDescendantsOf, EMPTY_DECODE_LIMIT } from '../src/lineage.js'

// ---- 纯函数：空白判定阈值（实测基线见 src/lineage.js 注释）------------------

test('isEmptyLogSize matches measured header-only sizes and rejects real logs', () => {
  const cwd = '/Users/someone/dev/project'
  // 官方 alpha.2 实测：header-only = 169B（cwd≈40 字符），1 事件 = 276B。
  assert.equal(isEmptyLogSize(169, cwd), true)
  assert.equal(isEmptyLogSize(190 + cwd.length, cwd), true, 'exactly at threshold is still empty')
  assert.equal(isEmptyLogSize(190 + cwd.length + 1, cwd), false)
  assert.equal(isEmptyLogSize(276, cwd), false, 'one stored event must not classify as empty')
  // 长 cwd 只按 1B/字符放宽阈值，事件增量 >= 100B，判定不受 cwd 长度影响。
  const longCwd = '/' + 'a'.repeat(400)
  assert.equal(isEmptyLogSize(169 + 400, longCwd), true)
  assert.equal(isEmptyLogSize(276 + 400, longCwd), false)
  // 防御：非法输入一律视为非空白（绝不误删）。
  assert.equal(isEmptyLogSize(null, cwd), false)
  assert.equal(isEmptyLogSize(-1, cwd), false)
  assert.equal(isEmptyLogSize(Number.NaN, cwd), false)
})

// ---- 纯函数：0.1.3 空会话事件类型判定 ---------------------------------------

test('isEmptyEventTypes classifies 0.1.3 lifecycle-only logs as empty', () => {
  // 0 条事件 = 头部之外无任何记录（alpha.2 式纯头部日志）→ 空。
  assert.equal(isEmptyEventTypes([]), true)
  // 0.1.3 实测：会话创建时恒定的三条生命周期元数据 → 空。
  assert.equal(isEmptyEventTypes(['permission/preset', 'sandbox/mode', 'approval/policy']), true)
  // inspectSession 若把头部行当事件回传（type 'session'），放行不削弱判定。
  assert.equal(isEmptyEventTypes(['session', 'permission/preset', 'sandbox/mode', 'approval/policy']), true)
  // 任何内容事件都判非空。
  assert.equal(isEmptyEventTypes(['permission/preset', 'user/message']), false)
  // 未知类型按内容处理（宁可漏判，不可错杀）。
  assert.equal(isEmptyEventTypes(['session/unknown-future']), false)
  assert.equal(isEmptyEventTypes([undefined]), false)
  // 防御：非法输入一律非空。
  assert.equal(isEmptyEventTypes(null), false)
  assert.equal(isEmptyEventTypes('user/message'), false)
  // 上限常量存在且 sane（候选解码门槛）。
  assert.ok(Number.isFinite(EMPTY_DECODE_LIMIT) && EMPTY_DECODE_LIMIT >= 4096)
})

// 0.2.2 起 DSH 新增了一批「状态/配置」事件（预设、模型、计划模式、团队模式、
// 工作目录……）。它们只记录设置，不产生消息；若不放行，任何在设置面板动过一次
// 却没发消息的会话就永远进不了「空白」分类。放行的安全前提是：本判定要求
// **全部**事件都是噪声，任何一条 user/assistant/tool 事件都仍然判非空。
test('isEmptyEventTypes treats 0.2.2 state/config events as non-content', () => {
  const stateOnly = ['agent-preset/selected', 'model/selection', 'plan/mode', 'team/mode',
    'working-directory/change', 'goal/change', 'schedule/change', 'session/end-seed', 'session/title',
    'subagent/model-selection-policy']
  assert.equal(isEmptyEventTypes(stateOnly), true)
  assert.equal(isEmptyEventTypes(['agent-preset/selected', 'permission/preset', 'sandbox/mode']), true)
  // 只要掺进一条真实内容，立刻回到非空——白名单不会把有消息的会话吃掉。
  for (const content of ['user/message', 'assistant/message', 'tool/call', 'tool/result', 'turn/start']) {
    assert.equal(isEmptyEventTypes(['agent-preset/selected', 'model/selection', content]), false, content)
  }
})

// ---- issue #18 第 5 条：插件注入上下文不算内容 -----------------------------
// 记忆插件把 profile / 指令 splice 进下一轮 inbox（agent/inbox/spliced），
// 界面上是一条空会话，却因为有「内容事件」永远进不了「空白」分类。
test('isEmptyEventTypes treats plugin-injected inbox context as empty', () => {
  const spliced = (inserted, removedCount) => ({ type: 'agent/inbox/spliced', data: { inserted, removedCount } })
  // openviking-memory 实测形状：单条注入，source.form='instructions'。
  assert.equal(isEmptyEventTypes([
    { type: 'session' },
    { type: 'permission/preset' },
    spliced([{ source: { kind: 'plugin:openviking-memory', plugin: 'openviking-memory', form: 'instructions' } }]),
  ]), true)
  // 只有 plugin: 前缀、没有 form 的注入同样算噪声。
  assert.equal(isEmptyEventTypes([spliced([{ source: { kind: 'plugin:foo' } }])]), true)
  // 空插入 / 纯删除标记：没有任何内容留下。
  assert.equal(isEmptyEventTypes([spliced([])]), true)
})

test('isEmptyEventTypes keeps real user messages and unknown payloads as content', () => {
  const spliced = (inserted, removedCount) => ({ type: 'agent/inbox/spliced', data: { inserted, removedCount } })
  // 用户自己打的消息（无 source）→ 内容，绝不能判空。
  assert.equal(isEmptyEventTypes([spliced([{ role: 'user' }, { role: 'user', source: null }])]), false)
  // 混合：真用户消息 + 注入 → 内容。
  assert.equal(isEmptyEventTypes([
    spliced([{ source: { kind: 'plugin:x', form: 'instructions' } }, { role: 'user' }]),
  ]), false)
  // 删过消息说明原本有内容。
  assert.equal(isEmptyEventTypes([spliced([], 2)]), false)
  // 载荷缺失/畸形一律按内容处理（保守方向）。
  assert.equal(isEmptyEventTypes([{ type: 'agent/inbox/spliced' }]), false)
  assert.equal(isEmptyEventTypes([{ type: 'agent/inbox/spliced', data: { inserted: 'nope' } }]), false)
})

// ---- 纯函数：血缘分类 ------------------------------------------------------

test('classifyLineage reports structure only; empty is always null (unknown) since T1', () => {
  // 子代理：官方 origin 标记 + 父会话 + 递归深度；empty=null 等后台精判。
  assert.deepEqual(
    classifyLineage({ id: 's1', origin: 'subagent', parentSession: 'p1', delegationDepth: 2 }),
    { origin: 'subagent', parentSession: 'p1', delegationDepth: 2, empty: null },
  )
  // fork 分支：有 parentSession 但 origin 不是 subagent。
  assert.deepEqual(
    classifyLineage({ id: 's2', parentSession: 'p0' }),
    { origin: null, parentSession: 'p0', delegationDepth: 0, empty: null },
  )
  // T1 关键变化：体积法不再发布空白结论——小日志的普通会话返回 null，
  // 空白条目只能由后台 refine 的**真解码判定**创建（误隐藏在结构上不可能）。
  assert.equal(classifyLineage({ id: 's3', cwd: '/w' }), null)
  assert.equal(classifyLineage({ id: 's4', cwd: '/w' }), null)
  // 异常输入不抛错。
  assert.equal(classifyLineage(null), null)
  assert.equal(classifyLineage('x'), null)
  // 非法 delegationDepth 归零而不是透传。
  assert.deepEqual(
    classifyLineage({ id: 's5', origin: 'subagent', delegationDepth: -3 }),
    { origin: 'subagent', parentSession: null, delegationDepth: 0, empty: null },
  )
  // 候选门槛：legacy 无 sizeBytes → 永不候选（行为与 3.6.2 前一致）。
  assert.equal(emptyScanCandidate(150), true)
  assert.equal(emptyScanCandidate(EMPTY_DECODE_LIMIT), true)
  assert.equal(emptyScanCandidate(EMPTY_DECODE_LIMIT + 1), false)
  assert.equal(emptyScanCandidate(null), false)
})

// ---- 集成：sidebar-state 路由透出 lineage（handle-era 快照形态）--------------

let root
let call
// live 会话表（可从用例内注入，模拟 ctx.sessions.list 的内存会话）。
const liveList = []

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsm-lineage-'))
  process.env.DSH_SESSIONS_MANAGER_TRASH_DIR = join(root, 'trash')
  process.env.DSH_SESSIONS_MANAGER_STAR_DIR = join(root, 'state')
  process.env.DSH_SESSIONS_MANAGER_PENDING_DIR = join(root, 'pending')
  await mkdir(process.env.DSH_SESSIONS_MANAGER_TRASH_DIR, { recursive: true })
  await writeFile(join(process.env.DSH_SESSIONS_MANAGER_TRASH_DIR, 'index.json'), '[]')
  const { apply } = await import(`../src/index.js?lineage=${Date.now()}`)
  const routes = new Map()
  // handle-era 快照形态：list 返回带 snapshot 字段的完整条目。
  const mk = (id, extra = {}, sizeBytes = 900) => ({
    header: { id, cwd: root, createdAt: Date.now(), isSeeded: false, delegationDepth: 0, ...extra },
    revision: `rev-${id}`,
    sizeBytes,
  })
  const subagent = mk('sub-1', { origin: 'subagent', parentSession: 'parent-1', delegationDepth: 1 }, 900)
  const grandsub = mk('sub-2', { origin: 'subagent', parentSession: 'sub-1', delegationDepth: 2 }, 900)
  const fork = mk('fork-1', { parentSession: 'parent-1', isSeeded: true }, 900)
  const empty = mk('empty-1', {}, 150)
  const normal = mk('parent-1')
  // 0.1.3 空会话：体积法漏判（> 190+cwd 阈值）但事件类型只有生命周期元数据。
  const ghostEmpty = mk('ghost-empty', {}, 400)
  // 体积法假阳性：长 cwd 抬高阈值，把 276B 单事件日志误判成空，精判须纠正。
  const falsePositive = mk('fp-1', { cwd: 'x'.repeat(300) }, 276)
  const snapshots = [subagent, grandsub, fork, empty, normal, ghostEmpty, falsePositive]
  // 每个会话的官方事件流（inspectSession 回传）：空会话只有生命周期元数据。
  const mockEvents = {
    'empty-1': ['permission/preset', 'sandbox/mode', 'approval/policy'],
    'ghost-empty': ['permission/preset', 'sandbox/mode', 'approval/policy'],
    'fp-1': ['user/message'],
  }
  const sessions = { get: () => undefined, list: () => liveList, flush: async () => true, store: new Map() }
  const ctx = {
    workspaceRegistry: { list: () => [], state: { archivedSessionIds: [] }, archiveSession: async () => {} },
    sessionPersistence: {
      list: async () => snapshots,
      // 精判走官方读取通道：适配器 inspectSession → open('read') 句柄分块读。
      // 句柄一次性吐出该会话的事件批次，第二次 read 返回 [] 结束。
      open: async (id) => {
        const types = mockEvents[String(id)] || ['user/message']
        let consumed = false
        return {
          read: async () => { if (consumed) return []; consumed = true; return types.map((type) => ({ type })) },
          close: async () => {},
        }
      },
      stat: async () => undefined,
    },
    sessionQuery: { readTitleSnapshots: async () => [], readTitleSnapshot: async () => null },
    storageDomain: { get: () => ({ global: { get: () => ({ archivedSessionIds: [] }), set: async () => {} } }) },
    webServer: { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
    get: (name) => name === 'sessions' ? sessions : null,
    effect: (fn) => fn(),
  }
  apply(ctx)
  call = async (path, body = {}) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))])
    let status = 200
    let text = ''
    const res = { writeHead: (value) => { status = value }, end: (value) => { text += value || '' } }
    await routes.get(path)(req, res)
    return { status, body: JSON.parse(text) }
  }
})

after(async () => { await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }) })

test('sidebar-state answers with unknown empties first and refines them in the background (T1)', async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const first = await call('/archived-sessions/sidebar-state')
  assert.equal(first.status, 200)
  // 首拍：结构条目立刻在场（这是本任务的全部意义——分支/子代理信息不再等解码），
  // empty 一律 null（未知）。
  assert.deepEqual(first.body.lineage['sub-1'], { origin: 'subagent', parentSession: 'parent-1', delegationDepth: 1, empty: null })
  assert.deepEqual(first.body.lineage['sub-2'], { origin: 'subagent', parentSession: 'sub-1', delegationDepth: 2, empty: null })
  assert.deepEqual(first.body.lineage['fork-1'], { origin: null, parentSession: 'parent-1', delegationDepth: 0, empty: null })
  // 普通会话（空白与否都）未判定前不产生条目；精判能力在场时报忙。
  assert.equal(first.body.lineage['empty-1'], undefined)
  assert.equal(first.body.lineage['fp-1'], undefined)
  assert.equal(first.body.lineage['parent-1'], undefined)
  assert.equal(first.body.refinePending, true)
  assert.ok('titles' in first.body && 'trashedSessionIds' in first.body && 'purgedSessionIds' in first.body)
  // 收敛轮询；核心不变量：**任何一拍 fp-1（有内容的长 cwd 小日志）都从未被判空**
  // ——体积法假阳性误隐藏整行的历史必须不可能回归。
  let last = first.body
  let sawFpEmpty = false
  for (let i = 0; i < 120; i++) {
    last = (await call('/archived-sessions/sidebar-state')).body
    const f = last.lineage['fp-1']
    if (f && f.empty === true) sawFpEmpty = true
    if (last.lineage['empty-1'] && !last.refinePending) break
    await sleep(25)
  }
  assert.equal(sawFpEmpty, false, 'fp-1 must never surface as empty in any beat')
  assert.deepEqual(last.lineage['empty-1'], { origin: null, parentSession: null, delegationDepth: 0, empty: true }, '0.1.3 空白（体积法漏判）由精判捞回')
  assert.deepEqual(last.lineage['ghost-empty'], { origin: null, parentSession: null, delegationDepth: 0, empty: true })
  assert.deepEqual(last.lineage['sub-1'], { origin: 'subagent', parentSession: 'parent-1', delegationDepth: 1, empty: false })
  assert.equal(last.lineage['fp-1'], undefined, '体积法假阳性纠正后不建条目')
  assert.equal(last.lineage['parent-1'], undefined)
  assert.equal(last.refinePending, false)
})

test('lineage-tree returns the recursive subagent-only tree and excludes forks', async () => {
  const { status, body } = await call('/archived-sessions/lineage-tree', { sessionId: 'parent-1' })
  assert.equal(status, 200)
  assert.equal(body.parent.sessionId, 'parent-1')
  // 只收 origin==='subagent' 的直接子代理：fork 分支不入树。
  assert.equal(body.nodes.length, 1)
  const sub1 = body.nodes[0]
  assert.equal(sub1.sessionId, 'sub-1')
  assert.equal(sub1.depth, 1)
  assert.equal(sub1.delegationDepth, 1)
  assert.equal(sub1.live, false)
  assert.equal(sub1.sizeBytes, 900)
  // 嵌套委派递归展开：sub-1 的子代理 sub-2 挂在 children 里，深度 +1。
  assert.equal(sub1.children.length, 1)
  assert.equal(sub1.children[0].sessionId, 'sub-2')
  assert.equal(sub1.children[0].depth, 2)
  assert.equal(sub1.children[0].parentSession, 'sub-1')
  // fork 与普通会话绝不进子代理树。
  assert.ok(!JSON.stringify(body).includes('"fork-1"'))
  assert.ok(!JSON.stringify(body).includes('"empty-1"'))
})

// 历史回归：删除子代理后它在侧栏不消失（回收站里的会话仍被血缘树列出）。
test('lineage-tree excludes trashed subagents (deleted rows must disappear)', async () => {
  const idx = join(process.env.DSH_SESSIONS_MANAGER_TRASH_DIR, 'index.json')
  const { readFile } = await import('node:fs/promises')
  const backup = await readFile(idx, 'utf8')
  const { body: trash } = await call('/archived-sessions/trash/list')
  try {
    await writeFile(idx, JSON.stringify({
      schemaVersion: trash.schemaVersion,
      settings: trash.settings,
      items: [{ sessionId: 'sub-2', title: 'gone', deletedAt: Date.now() }],
      purgedSessionIds: [],
    }))
    const { status, body } = await call('/archived-sessions/lineage-tree', { sessionId: 'parent-1' })
    assert.equal(status, 200)
    // 回收站里的子代理（软删除）绝不能留在血缘树里。
    assert.ok(!JSON.stringify(body).includes('"sub-2"'))
    assert.equal(body.nodes.length, 1)
    assert.equal(body.nodes[0].sessionId, 'sub-1')
    assert.equal(body.nodes[0].children.length, 0)
  } finally {
    await writeFile(idx, backup)
  }
})

test('lineage-tree flags sessions live from ctx.sessions and guards missing params', async () => {
  // 注入一个内存中的 live 子代理（正在运行），随后清理避免影响其他用例。
  liveList.push({ id: 'sub-2', header: { id: 'sub-2', origin: 'subagent', parentSession: 'sub-1', delegationDepth: 2 } })
  try {
    const { status, body } = await call('/archived-sessions/lineage-tree', { sessionId: 'parent-1' })
    assert.equal(status, 200)
    const sub2 = body.nodes[0].children[0]
    assert.equal(sub2.sessionId, 'sub-2')
    assert.equal(sub2.live, true, 'in-memory session must be flagged live')
    // 非法请求：缺 sessionId / 不安全 id 一律 400。
    assert.equal((await call('/archived-sessions/lineage-tree', {})).status, 400)
    assert.equal((await call('/archived-sessions/lineage-tree', { sessionId: '../etc' })).status, 400)
  } finally {
    liveList.length = 0
  }
})

// ---- issue #18 第 4 条：子代理级联删除的后代收集 ---------------------------
// 删除父会话时按官方 header 的 origin/parentSession 收集整棵子树；分叉（fork）
// 分支不是子代理，生命周期独立，绝不能被父会话的删除带走。
test('subagentDescendantsOf walks the whole subagent subtree', () => {
  const headers = [
    { id: 'p' },
    { id: 'a', origin: 'subagent', parentSession: 'p' },
    { id: 'b', origin: 'subagent', parentSession: 'p' },
    { id: 'c', origin: 'subagent', parentSession: 'a', delegationDepth: 2 },
    { id: 'd', origin: 'subagent', parentSession: 'c', delegationDepth: 3 },
  ]
  assert.deepEqual(subagentDescendantsOf(headers, 'p'), ['a', 'b', 'c', 'd'])
  // 从中间节点算起：只拿它下面的子树。
  assert.deepEqual(subagentDescendantsOf(headers, 'a'), ['c', 'd'])
  // 叶子没有后代。
  assert.deepEqual(subagentDescendantsOf(headers, 'd'), [])
})

test('subagentDescendantsOf leaves fork branches and unrelated sessions alone', () => {
  const headers = [
    { id: 'p' },
    // 分叉分支：有 parentSession 但 origin 不是 subagent → 独立会话，不能删。
    { id: 'fork', parentSession: 'p' },
    { id: 'other' },
    { id: 'kid', origin: 'subagent', parentSession: 'p' },
  ]
  assert.deepEqual(subagentDescendantsOf(headers, 'p'), ['kid'])
})

test('subagentDescendantsOf tolerates malformed headers, self-parents and cycles', () => {
  const headers = [
    { id: 'p' },
    { id: 'self', origin: 'subagent', parentSession: 'self' },
    { id: 'noparent', origin: 'subagent' },
    { id: 'a', origin: 'subagent', parentSession: 'p' },
    { id: 'b', origin: 'subagent', parentSession: 'a' },
    // a/b 互相指也不影响：visited 已挡住重复。
    null, 'nope', { origin: 'subagent' }, { id: 'c', origin: 'subagent', parentSession: 'b' },
  ]
  assert.deepEqual(subagentDescendantsOf(headers, 'p'), ['a', 'b', 'c'])
  // 非法输入：一律空数组，绝不抛错（删除路径不能被血缘数据拖垮）。
  assert.deepEqual(subagentDescendantsOf(null, 'p'), [])
  assert.deepEqual(subagentDescendantsOf(headers, ''), [])
  assert.deepEqual(subagentDescendantsOf(headers, null), [])
})

test('subagentDescendantsOf caps pathological trees', () => {
  const headers = [{ id: 'p' }]
  for (let i = 0; i < 10; i++) headers.push({ id: 'k' + i, origin: 'subagent', parentSession: 'p' })
  assert.equal(subagentDescendantsOf(headers, 'p', 4).length, 4)
  // 0 / 负数 / NaN 一律回落到默认上限，不会变成「不删任何后代」。
  assert.equal(subagentDescendantsOf(headers, 'p', 0).length, 10)
  assert.equal(subagentDescendantsOf(headers, 'p', -5).length, 10)
})
