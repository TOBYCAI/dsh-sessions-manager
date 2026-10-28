import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aliveSessionCount, applyTagFilter, ascBranchTime, authoritativeTitleForFirstPaint, branchTimeKey, canDropOnWorkspace, collapsedVisibleTotal, countRenderedVisible, dragAutoScrollStep, effectiveTitleOf, filterShapeFromSaved, filterSnapshotOf, foldBranches, foldOrphanSubagents, foldSubagents, moveNoticeText, noticeToastPlan, openSubagentToast, overflowPlan, pathTail, remainingRows, sessionForNodes, shortId, starredOf, tagDeleteConfirm, titleBackfillDecision, TOAST_MAX_MS, TOAST_MIN_MS, toastDurationFor, workspaceForNodes } from '../src/client/logic.js'

test('authoritative title only corrects the first cold paint', () => {
  assert.equal(authoritativeTitleForFirstPaint({ firstPaint: true, rendered: '旧 header', authoritative: '最新标题' }), '最新标题')
  assert.equal(authoritativeTitleForFirstPaint({ firstPaint: false, rendered: '刚刚重命名', authoritative: '旧快照' }), null)
  assert.equal(authoritativeTitleForFirstPaint({ firstPaint: true, rendered: '最新标题', authoritative: '最新标题' }), null)
  assert.equal(authoritativeTitleForFirstPaint({ firstPaint: true, rendered: '标题', authoritative: '' }), null)
})

// ---- canDropOnWorkspace：拖拽同工作区拦截 ----------------------------------
test('blocks dropping onto the session current workspace', () => {
  const item = { sessionId: 'a', workspacePath: '/w1' }
  assert.equal(canDropOnWorkspace(item, { path: '/w1' }), false)
  assert.equal(canDropOnWorkspace(item, { path: '/w2' }), true)
})

test('allows sessions without a known workspace path (host arbitrates)', () => {
  assert.equal(canDropOnWorkspace({ sessionId: 'a', workspacePath: null }, { path: '/w1' }), true)
  assert.equal(canDropOnWorkspace({ sessionId: 'a' }, { path: '/w1' }), true)
})

test('rejects malformed dragging or target', () => {
  assert.equal(canDropOnWorkspace(null, { path: '/w1' }), false)
  assert.equal(canDropOnWorkspace({ sessionId: 'a' }, null), false)
})

// ---- sessionForNodes / workspaceForNodes：fiber 行识别 ---------------------
test('identifies a session row from an authoritative hit', () => {
  const known = new Map([['s1', { sessionId: 's1', title: 'T', workspacePath: '/w1' }]])
  const nodes = [{ foo: 1 }, { id: 's1', title: 'stale' }]
  assert.deepEqual(sessionForNodes(nodes, known), { sessionId: 's1', title: 'T', workspacePath: '/w1' })
})

test('falls back to the live row heuristic before sidebar-state sync', () => {
  const live = { id: 's2', title: 'Live', updatedAt: 1 }
  assert.deepEqual(sessionForNodes([live], new Map()), { sessionId: 's2', title: 'Live', workspacePath: null })
  // blank 占位行也按会话识别（title/updatedAt/blank 任一存在）。
  assert.deepEqual(sessionForNodes([{ id: 's3', blank: true }], new Map()), { sessionId: 's3', title: '', workspacePath: null })
})

test('never mistakes a workspace group for a session', () => {
  const group = { workspaceId: 'ws1', id: 'ws1', cwd: '/w1', label: 'W1' }
  assert.equal(sessionForNodes([group], new Map()), null)
})

test('identifies a workspace header as the drop target', () => {
  assert.deepEqual(
    workspaceForNodes([{ unrelated: 1 }, { workspaceId: 'ws1', cwd: '/w1', label: 'W1' }]),
    { workspaceId: 'ws1', path: '/w1', title: 'W1' },
  )
  // label 缺失时回退 cwd。
  assert.deepEqual(
    workspaceForNodes([{ workspaceId: 42, cwd: '/w2' }]),
    { workspaceId: '42', path: '/w2', title: '/w2' },
  )
})

test('rejects workspace nodes without a string cwd', () => {
  assert.equal(workspaceForNodes([{ workspaceId: 'ws1', cwd: null }]), null)
  assert.equal(workspaceForNodes([{ workspaceId: 'ws1' }]), null)
  assert.equal(workspaceForNodes([]), null)
})

// ---- starredOf：收藏过滤 ----------------------------------------------------

test('starredOf returns only starred items and tolerates junk', () => {
  const items = [
    { sessionId: 'a', starred: true },
    { sessionId: 'b', starred: false },
    { sessionId: 'c' },
    null,
    { sessionId: 'd', starred: true },
  ]
  assert.deepEqual(starredOf(items).map((x) => x.sessionId), ['a', 'd'])
  assert.deepEqual(starredOf(null), [])
  assert.deepEqual(starredOf(undefined), [])
})

test('starredOf is orthogonal to archive state', () => {
  const items = [
    { sessionId: 'arch-starred', archived: true, starred: true },
    { sessionId: 'arch', archived: true, starred: false },
  ]
  // star 是用户标记，归档会话同样可以出现在收藏里。
  assert.deepEqual(starredOf(items).map((x) => x.sessionId), ['arch-starred'])
})


// ---- foldSubagents：面板血缘折叠 ------------------------------------------
// 历史回归：第一版把「父会话」当成了被折叠项（topList 用 kids 的 key 过滤），
// 结果父卡片整个消失、子代理全部留在顶层，界面上看起来就是「完全没有折叠」。
// 这两个 case 锁死：父必须留在顶层，只有子代理被移出。
test('foldSubagents keeps the parent at top level and removes only subagent children', () => {
  const items = [
    { sessionId: 'parent-1' },
    { sessionId: 'sub-1' },
    { sessionId: 'sub-2' },
    { sessionId: 'plain-1' },
  ]
  const lineage = {
    'sub-1': { origin: 'subagent', parentSession: 'parent-1', delegationDepth: 1, empty: false },
    'sub-2': { origin: 'subagent', parentSession: 'parent-1', delegationDepth: 1, empty: false },
  }
  const { topList, kidsOf, foldedCount } = foldSubagents(items, lineage)
  assert.deepEqual(topList.map((x) => x.sessionId), ['parent-1', 'plain-1'])
  assert.equal(foldedCount, 2)
  assert.deepEqual((kidsOf.get('parent-1') || []).map((x) => x.sessionId), ['sub-1', 'sub-2'])
})

test('foldSubagents keeps an orphan subagent visible when its parent is filtered out', () => {
  const items = [{ sessionId: 'sub-1' }]
  const lineage = { 'sub-1': { origin: 'subagent', parentSession: 'parent-gone', delegationDepth: 1, empty: false } }
  const { topList, foldedCount } = foldSubagents(items, lineage)
  // 父不在列表：搜得到就必须看得见，不能因为折叠而消失。
  assert.deepEqual(topList.map((x) => x.sessionId), ['sub-1'])
  assert.equal(foldedCount, 0)
})

test('foldSubagents ignores forks and empty sessions (only subagent origin folds)', () => {
  const items = [{ sessionId: 'parent-1' }, { sessionId: 'fork-1' }]
  const lineage = { 'fork-1': { origin: null, parentSession: 'parent-1', delegationDepth: 0, empty: false } }
  const { topList, foldedCount } = foldSubagents(items, lineage)
  assert.deepEqual(topList.map((x) => x.sessionId), ['parent-1', 'fork-1'])
  assert.equal(foldedCount, 0)
})

// ---- shortId：列表短 ID ------------------------------------------------------
// 完整 UUID（36 字符）放进 meta 行会把整行撑到换行、卡片高度浮动——短 ID 是
// 「卡片定高、列表不串行」的前提。这几个 case 锁住长度上限与前缀处理。
test('shortId trims the session- prefix and caps the visible length', () => {
  assert.equal(shortId('session-da1a662a-9f2c-4b1e-8a0d-1b2c3d4e5f60'), 'da1a662a…')
  assert.equal(shortId('d4d2e04f-f6fd-4155-a4a1-e9f1a40bf7c5'), 'd4d2e04f…')
})

test('shortId keeps short ids intact and tolerates missing values', () => {
  assert.equal(shortId('d4d2e04f'), 'd4d2e04f')
  assert.equal(shortId(''), '')
  assert.equal(shortId(null), '')
  assert.equal(shortId(undefined), '')
})

// ---- openSubagentToast：打开子代理的提示 ------------------------------------
// 提示要能区分「成功 / 没接口 / 切换失败」三种结果，且失败必须给出下一步该去哪
// 里。历史上只有一句「没能直接打开，请到父会话标题栏的官方子代理目录里打开」，
// 既没说原因也没说清「父会话标题栏」在哪，可读性很差——这几个 case 锁住新文案。
test('openSubagentToast ok: panel copy tells the user to close settings', () => {
  const m = openSubagentToast('ok', '扫描代码库', 'panel')
  assert.equal(m.kind, 'ok')
  assert.ok(m.text.includes('扫描代码库'))
  assert.ok(m.text.includes('关掉设置'), 'panel 里会话区被设置弹层挡着，必须提醒关掉')
})

test('openSubagentToast ok: sidebar copy is short (no settings hint)', () => {
  const m = openSubagentToast('ok', '扫描代码库', 'sidebar')
  assert.equal(m.kind, 'ok')
  assert.ok(!m.text.includes('设置'), '侧栏没有设置弹层遮挡，不该提示关掉设置')
})

test('openSubagentToast err: no-service explains the runtime limitation', () => {
  const m = openSubagentToast('no-service', 'x', 'panel')
  assert.equal(m.kind, 'err')
  assert.ok(m.text.includes('没有开放会话切换接口'))
})

test('openSubagentToast err: fallback names the exact /N catalog entry point', () => {
  for (const where of ['panel', 'sidebar']) {
    const m = openSubagentToast('failed', 'x', where)
    assert.equal(m.kind, 'err')
    assert.ok(m.text.includes('/ N'), 'fallback 必须指出官方「/ N」子代理目录：' + m.text)
    assert.ok(m.text.includes('父会话'))
  }
})

test('openSubagentToast falls back to a generic label for unnamed subagents', () => {
  assert.ok(openSubagentToast('ok', '', 'panel').text.includes('子代理'))
  assert.ok(openSubagentToast('ok', null, 'panel').text.includes('子代理'))
})

// 提示停留时长（2026-09-10 用户反馈：固定 2.4s + 几十字文案 = 还没读完就消失）
test('toast 停留时长按字数增长，并夹在上下限之间', () => {
  // 短提示维持原来的观感（>= 2.6s）
  // 短提示仍是秒级（>= 下限，且不该接近上限）
  const short = toastDurationFor('已导出 Markdown')
  assert.ok(short >= TOAST_MIN_MS && short < 4000, 'short message should stay in the seconds range, got ' + short)
  assert.equal(toastDurationFor(''), TOAST_MIN_MS)
  assert.equal(toastDurationFor(null), TOAST_MIN_MS)
  // 越长越久，且严格单调
  const mid = toastDurationFor('已排队：该会话正被 DSH 打开，重启后自动完成。') // ~26 字
  assert.ok(mid > 4000 && mid < TOAST_MAX_MS, 'medium message must get a readable window, got ' + mid)
  assert.ok(toastDurationFor('x'.repeat(40)) < toastDurationFor('x'.repeat(80)))
  // 上限：再长也不超过上限值，避免提示一直挂在屏幕上
  assert.equal(toastDurationFor('x'.repeat(5000)), TOAST_MAX_MS)
})

test('失败类提示停得更久，且同样受上限约束', () => {
  const text = 'abcde'.repeat(3)
  assert.ok(toastDurationFor(text, 'err') > toastDurationFor(text))
  // 但同样受上限约束
  assert.equal(toastDurationFor('x'.repeat(5000), 'err'), TOAST_MAX_MS)
})

// —— v3.6.2 #2/#6：占位标题的后到回填与有效标题 ——————————————————————————

test('titleBackfillDecision: 首绘有权威用权威，无权威只记所有权', () => {
  const withAuth = titleBackfillDecision({ rendered: '冷标题', baseline: null, authoritative: '真标题' })
  assert.equal(withAuth.changed, true)
  assert.equal(withAuth.text, '真标题')
  const placeholder = titleBackfillDecision({ rendered: '冷标题', baseline: null, authoritative: '' })
  assert.equal(placeholder.changed, false)
  assert.equal(placeholder.nextBaseline.text, '冷标题')
})

test('titleBackfillDecision: 占位行在权威后到时回填；同值返回 null', () => {
  const d = titleBackfillDecision({ rendered: '冷标题', baseline: { text: '冷标题', authoritative: null }, authoritative: '真标题' })
  assert.equal(d.changed, true)
  assert.equal(d.text, '真标题')
  assert.equal(titleBackfillDecision({ rendered: '真标题', baseline: { text: '真标题', authoritative: '真标题' }, authoritative: '真标题' }), null)
})

test('titleBackfillDecision: 官方改写文本后所有权移交，绝不覆盖', () => {
  const d = titleBackfillDecision({ rendered: '用户重命名', baseline: { text: '我们写入的标题', authoritative: '我们写入的标题' }, authoritative: '别的' })
  assert.equal(d.changed, false)
  assert.equal(d.nextBaseline.text, '用户重命名')
})

test('effectiveTitleOf: 列表值优先，占位回落权威，都没有给空串', () => {
  const map = new Map([['s1', '权威标题']])
  assert.equal(effectiveTitleOf({ sessionId: 's1', title: '列表标题' }, map), '列表标题')
  assert.equal(effectiveTitleOf({ sessionId: 's1', title: null }, map), '权威标题')
  assert.equal(effectiveTitleOf({ sessionId: 's2', title: null }, map), '')
  assert.equal(effectiveTitleOf(null, map), '')
})

// —— T2：排队移动终局通知的文案与投递计划 ——

test('pathTail/moveNoticeText：路径尾段与两种终局文案', () => {
  assert.equal(pathTail('/a/b/'), 'b')
  assert.equal(pathTail('C:\\x\\y'), 'y')
  assert.equal(pathTail(null), '')
  const moved = moveNoticeText({ kind: 'moved', sessionId: 'session-abcdef0123456789', targetPath: '/ws/新项目' })
  assert.ok(moved.includes('已完成') && moved.includes('新项目'), moved)
  const gone = moveNoticeText({ kind: 'abandoned', sessionId: 's', attempts: 5, reason: '首行原因\n堆栈' })
  assert.ok(gone.includes('已放弃') && gone.includes('首行原因') && !gone.includes('堆栈'), gone)
})

test('noticeToastPlan：seen 过滤、展示最新 2 条、省略句合并、只 ack 已展示', () => {
  const mk = (id, kind, at) => ({ id, kind, sessionId: 's-' + id, targetPath: '/a/b-' + id, at })
  const raw = [mk('n1', 'moved', 1), mk('n2', 'abandoned', 2), mk('n3', 'moved', 3)]
  const plan = noticeToastPlan(raw, new Set(['n1']), 2)
  assert.deepEqual(plan.ackIds, ['n2', 'n3'])
  assert.equal(plan.kind, 'err')
  assert.ok(plan.text.includes('已放弃') && plan.text.includes('b-n3'), plan.text)
  assert.ok(!plan.text.includes('b-n1'), 'seen 过的不得再出现')
  const many = Array.from({ length: 5 }, (_, i) => mk('m' + i, 'moved', i + 1))
  const p2 = noticeToastPlan(many, new Set(), 2)
  assert.equal(p2.ackIds.length, 2)
  assert.ok(p2.text.includes('另有 3 条'), '溢出并入省略句，未展示项留在服务端')
  assert.equal(noticeToastPlan(undefined, new Set()).text, null)
  assert.equal(noticeToastPlan([{ id: 'x', kind: 'weird', sessionId: 's' }], new Set()).text, null)
  assert.equal(noticeToastPlan([{ id: 'y', kind: 'moved' }], new Set()).text, null, '缺 sessionId 的畸形条目丢弃')
})

// —— T3（3.7.0）：foldBranches / branchTimeKey / ascBranchTime 分支聚拢 ————
// 由 reports/search-b1-evidence 的已验证草稿（foldBranches.draft.mjs + t2.mjs
// 断言族）收编而来。核心不变量是「守恒律」：任何一次调用，topList 中非合成
// 行数 + foldedCount 必须等于输入 items.length——聚拢只许搬家，不许丢行。
// 每族用例都跑一遍该断言。

// 通用守恒断言：非合成行 = topList 里不带 syntheticRoot 标记的行（畸形占位行也算）。
function assertConserved(r, items, label) {
  const realTop = r.topList.filter((i) => !(i && i.syntheticRoot)).length
  assert.equal(realTop + r.foldedCount, (items || []).length, '守恒律被破坏: ' + label)
}
// 便捷血缘表构造：{id: parentSession} → {id:{origin:null,parentSession,...}}
function lin(rows) {
  const out = {}
  for (const [id, parent] of Object.entries(rows)) {
    out[id] = typeof parent === 'string' ? { origin: null, parentSession: parent, delegationDepth: 1, empty: false } : parent
  }
  return out
}

// ---- A 族：基本分组 ---------------------------------------------------------

test('A1: 同父两分支聚一组，父行留原位，组内按时间升序', () => {
  const items = [{ sessionId: 'P' }, { sessionId: 'b1', createdAt: 2 }, { sessionId: 'x' }, { sessionId: 'b2', createdAt: 1 }]
  const r = foldBranches(items, lin({ b1: 'P', b2: 'P' }))
  assert.deepEqual(r.topList.map((i) => i.sessionId), ['P', 'x'])
  assert.deepEqual(r.branchGroupsOf.get('P').map((i) => i.sessionId), ['b2', 'b1'])
  assert.equal(r.foldedCount, 2)
  assert.equal(r.groupCount, 1)
  assertConserved(r, items, 'A1')
})

test('A2: 子代理绝不入组（foldSubagents 已先跑，本函数再锁一层）', () => {
  const items = [{ sessionId: 'P' }, { sessionId: 's1' }]
  const r = foldBranches(items, { s1: { origin: 'subagent', parentSession: 'P', delegationDepth: 1, empty: false } })
  assert.deepEqual(r.topList.map((i) => i.sessionId), ['P', 's1'])
  assert.equal(r.foldedCount, 0)
  assert.equal(r.groupCount, 0)
  assertConserved(r, items, 'A2')
})

test('A3: 空/null 输入与畸形 lineage 一律宽容、不抛错', () => {
  for (const bad of [null, undefined]) {
    const r = foldBranches(bad, bad)
    assert.deepEqual(r.topList, [])
    assert.equal(r.branchGroupsOf.size, 0)
    assert.equal(r.foldedCount, 0)
    assert.equal(r.groupCount, 0)
    assertConserved(r, bad, 'A3/空')
  }
  // 数组含洞 / 非对象行：原样留在顶层，行不丢。
  const items = [null, { sessionId: 'a' }, 42, undefined, { sessionId: 'b1' }]
  const r = foldBranches(items, lin({ b1: 'GONE' }))
  assert.equal(r.foldedCount, 1)
  assertConserved(r, items, 'A3/洞')
  // lineage 非对象（字符串/数组/数字/Map）：什么都不聚。
  for (const junk of ['nope', [{ origin: null, parentSession: 'zz' }], 42, new Map()]) {
    const r2 = foldBranches([{ sessionId: 'a' }], junk)
    assert.deepEqual(r2.topList.map((i) => i.sessionId), ['a'])
    assert.equal(r2.foldedCount, 0)
  }
})

test('A4: 无分支时不产出任何（哪怕空的）组', () => {
  const items = [{ sessionId: 'b1' }, { sessionId: 'b2' }]
  const r = foldBranches(items, {}) // lineage 迟到：全顶层
  assert.deepEqual(r.topList.map((i) => i.sessionId), ['b1', 'b2'])
  assert.equal(r.groupCount, 0)
  assert.equal(r.branchGroupsOf.size, 0)
  const r2 = foldBranches(items, lin({ b1: null, b2: null })) // parentSession 缺失也不算分支
  assert.equal(r2.groupCount, 0)
  assertConserved(r2, items, 'A4')
})

test('A5: 链拍平——分支的分支全部进同一组（锚=链顶真实父）', () => {
  const items = [{ sessionId: 'A' }, { sessionId: 'B', createdAt: 2 }, { sessionId: 'C', createdAt: 1 }]
  const r = foldBranches(items, lin({ B: 'A', C: 'B' }))
  assert.deepEqual(r.topList.map((i) => i.sessionId), ['A']) // 真实锚位置纹丝不动
  assert.deepEqual(r.branchGroupsOf.get('A').map((i) => i.sessionId), ['C', 'B'])
  assert.equal(r.groupCount, 1)
  assertConserved(r, items, 'A5')
})

test('A6: 10 级深链整条拍平成单组，组内升序', () => {
  const ids = Array.from({ length: 10 }, (_, i) => 'x' + i) // x9→x8→…→x0→ROOT
  const items = [{ sessionId: 'ROOT' }, ...ids.map((id, i) => ({ sessionId: id, createdAt: i + 1 }))]
  const table = lin(Object.fromEntries(ids.map((id, i) => [id, i === 0 ? 'ROOT' : ids[i - 1]])))
  const r = foldBranches(items, table)
  assert.deepEqual(r.topList.map((i) => i.sessionId), ['ROOT'])
  assert.equal(r.groupCount, 1)
  assert.equal(r.foldedCount, 10)
  assert.deepEqual(r.branchGroupsOf.get('ROOT').map((i) => i.sessionId), ids.slice().sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))))
  assertConserved(r, items, 'A6')
})

test('A7: 自指不算分支（parentSession===自身 id 不聚）', () => {
  const items = [{ sessionId: 'A' }]
  const r = foldBranches(items, lin({ A: 'A' }))
  assert.equal(r.foldedCount, 0)
  assert.deepEqual(r.topList.map((i) => i.sessionId), ['A'])
  assertConserved(r, items, 'A7')
})

// ---- B 族：组内排序 ----------------------------------------------------------

test('B1: 组内恒升序，与调用方主排序方向无关（输入降序也一样）', () => {
  const items = [
    { sessionId: 'P' },
    { sessionId: 'new', createdAt: 100 },
    { sessionId: 'mid', createdAt: 50 },
    { sessionId: 'old', createdAt: 1 },
  ]
  const r = foldBranches(items, lin({ new: 'P', mid: 'P', old: 'P' }))
  assert.deepEqual(r.branchGroupsOf.get('P').map((i) => i.sessionId), ['old', 'mid', 'new'])
  assert.deepEqual(r.topList.map((i) => i.sessionId), ['P'])
  assertConserved(r, items, 'B1')
})

test('B2: updatedAt 回退 + 双缺以 sessionId 决胜；乱序输入组内输出逐位相等', () => {
  // branchTimeKey：createdAt>0 优先 → updatedAt>0 → 0；非法值宽容。
  assert.equal(branchTimeKey({ createdAt: 7, updatedAt: 3 }), 7)
  assert.equal(branchTimeKey({ createdAt: 0, updatedAt: 3 }), 3)
  assert.equal(branchTimeKey({ createdAt: -5, updatedAt: 9 }), 9)
  assert.equal(branchTimeKey({ updatedAt: null }), 0)
  assert.equal(branchTimeKey({}), 0)
  assert.equal(branchTimeKey(null), 0)
  assert.equal(branchTimeKey({ createdAt: 'not-a-number', updatedAt: 'also' }), 0)
  // ascBranchTime：时间差优先，决胜 sessionId.localeCompare；双缺时纯 id 序。
  assert.ok(ascBranchTime({ sessionId: 'x' }, { sessionId: 'x2' }) < 0, '双缺时间 → sessionId 决胜')
  const rows = [
    { sessionId: 'u10', updatedAt: 10 },
    { sessionId: 'c5', createdAt: 5 },
    { sessionId: 'c10', createdAt: 10 },
  ]
  assert.deepEqual(rows.slice().sort(ascBranchTime).map((x) => x.sessionId), ['c5', 'c10', 'u10'], 'updatedAt 回退键参与升序；回退键与 createdAt 同值时按 sessionId 决胜')
  // 乱序输入两次输出逐位相等（成员序 + 顶层序 + 计数全部稳定）。
  const table = lin({ b1: 'P', b2: 'P', b3: 'P' })
  const itemsA = [{ sessionId: 'b3', createdAt: 3 }, { sessionId: 'b1', createdAt: 1 }, { sessionId: 'P' }, { sessionId: 'b2', createdAt: 2 }]
  const itemsB = [{ sessionId: 'b2', createdAt: 2 }, { sessionId: 'P' }, { sessionId: 'b3', createdAt: 3 }, { sessionId: 'b1', createdAt: 1 }]
  const rA = foldBranches(itemsA, table)
  const rB = foldBranches(itemsB, table)
  assert.deepEqual(rA.branchGroupsOf.get('P').map((i) => i.sessionId), ['b1', 'b2', 'b3'])
  assert.deepEqual(rB.branchGroupsOf.get('P').map((i) => i.sessionId), rA.branchGroupsOf.get('P').map((i) => i.sessionId))
  assert.deepEqual(rB.topList.map((i) => i.sessionId), rA.topList.map((i) => i.sessionId), '全员入组时顶层只剩真实锚，两次输出逐位相等')
  assert.equal(rA.foldedCount, rB.foldedCount)
  assertConserved(rA, itemsA, 'B2/A')
  assertConserved(rB, itemsB, 'B2/B')
})

test('B3: 同毫秒靠 sessionId 决胜，组内序确定可复现', () => {
  const items = [{ sessionId: 'P' }, { sessionId: 'z9', createdAt: 5 }, { sessionId: 'a1', createdAt: 5 }, { sessionId: 'm5', createdAt: 5 }]
  const r = foldBranches(items, lin({ z9: 'P', a1: 'P', m5: 'P' }))
  assert.deepEqual(r.branchGroupsOf.get('P').map((i) => i.sessionId), ['a1', 'm5', 'z9'])
  assertConserved(r, items, 'B3')
})

// ---- C 族：父缺失（合成锚） ---------------------------------------------------

test('C1: 两分支孤儿——合成头进 topList，成员全部移出，守恒', () => {
  const items = [{ sessionId: 'z' }, { sessionId: 'b1', createdAt: 5 }, { sessionId: 'b2', createdAt: 3 }]
  const r = foldBranches(items, lin({ b1: 'GONE', b2: 'GONE' }))
  assert.deepEqual(r.topList.map((i) => i.sessionId), ['z', 'dsm-src:GONE'])
  assert.equal(r.topList[1].syntheticRoot, 'GONE')
  assert.deepEqual(r.branchGroupsOf.get('GONE').map((i) => i.sessionId), ['b2', 'b1'])
  assert.equal(r.groupCount, 1)
  assertConserved(r, items, 'C1')
})

test('C2: 合成头占「组内最早成员」在原列表中的下标（不是第一个碰到的成员）', () => {
  // 原列表按主排序降序：late(9) 在前、early(3) 在后，中间隔着无关行 x。
  const items = [{ sessionId: 'late', createdAt: 9 }, { sessionId: 'x' }, { sessionId: 'early', createdAt: 3 }]
  const r = foldBranches(items, lin({ late: 'G', early: 'G' }))
  assert.deepEqual(r.topList.map((i) => i.sessionId), ['x', 'dsm-src:G'], '头必须落在 early 原来的位置，而非首个成员 late 的位置')
  assert.equal(r.topList[1].syntheticRoot, 'G')
  assert.deepEqual(r.branchGroupsOf.get('G').map((i) => i.sessionId), ['early', 'late'])
  assertConserved(r, items, 'C2')
})

test('C3: 单孤儿也出合成头（成员≥1 统一规则）', () => {
  const items = [{ sessionId: 'solo', createdAt: 1 }]
  const r = foldBranches(items, lin({ solo: 'GONE' }))
  assert.deepEqual(r.topList.map((i) => i.sessionId), ['dsm-src:GONE'])
  assert.deepEqual(r.branchGroupsOf.get('GONE').map((i) => i.sessionId), ['solo'])
  assert.equal(r.foldedCount, 1)
  assert.equal(r.groupCount, 1)
  assertConserved(r, items, 'C3')
})

test('C4: 父是子代理、已被 foldSubagents 折走 → 分支按父缺失走合成头', () => {
  const items = [{ sessionId: 'c1', createdAt: 1 }]
  const table = { c1: { origin: null, parentSession: 'P-sub' }, 'P-sub': { origin: 'subagent', parentSession: 'REAL' } }
  const r = foldBranches(items, table)
  assert.deepEqual(r.topList.map((i) => i.sessionId), ['dsm-src:P-sub'])
  assert.deepEqual(r.branchGroupsOf.get('P-sub').map((i) => i.sessionId), ['c1'])
  assertConserved(r, items, 'C4')
})

test('C5: 链缺中间父（A缺失→B在→C）→ 合成锚 A，B、C 同组', () => {
  const items = [{ sessionId: 'B', createdAt: 2 }, { sessionId: 'C', createdAt: 1 }]
  const r = foldBranches(items, lin({ B: 'A', C: 'B' }))
  assert.deepEqual(r.topList.map((i) => i.sessionId), ['dsm-src:A'])
  assert.deepEqual(r.branchGroupsOf.get('A').map((i) => i.sessionId), ['C', 'B'])
  assertConserved(r, items, 'C5')
})

// ---- D 族：环与病态血缘 --------------------------------------------------------

test('D1: 互指环 A↔B 不聚拢，全留顶层', () => {
  const items = [{ sessionId: 'A' }, { sessionId: 'B' }]
  const r = foldBranches(items, lin({ A: 'B', B: 'A' }))
  assert.deepEqual(r.topList.map((i) => i.sessionId), ['A', 'B'])
  assert.equal(r.foldedCount, 0)
  assert.equal(r.groupCount, 0)
  assertConserved(r, items, 'D1')
})

test('D2: 环上的依附链（D→A，A↔B）也不聚，行不丢、顶层无重复', () => {
  const items = [{ sessionId: 'A' }, { sessionId: 'B' }, { sessionId: 'D', createdAt: 1 }]
  const r = foldBranches(items, lin({ A: 'B', B: 'A', D: 'A' }))
  assert.equal(new Set(r.topList.map((i) => i.sessionId)).size, r.topList.length)
  assertConserved(r, items, 'D2')
  assert.equal(r.foldedCount, 0, '成环整链不聚：D 也留在顶层（原地保 chip）')
})

test('D3: 深链含尾部跳回环 → 判环不聚（visited+步数上限双保险）', () => {
  // c0→c1→c2→c3→c0（c3 跳回 c0 成环），全在列表。
  const items = [0, 1, 2, 3].map((i) => ({ sessionId: 'c' + i }))
  const r = foldBranches(items, lin({ c0: 'c1', c1: 'c2', c2: 'c3', c3: 'c0' }))
  assert.equal(r.foldedCount, 0)
  assert.deepEqual(r.topList.map((i) => i.sessionId), ['c0', 'c1', 'c2', 'c3'])
  assertConserved(r, items, 'D3')
})

// ---- E 族：收敛与迟到 ---------------------------------------------------------

test('E1: 成员删光（不再出现在 items）→ 组与合成头一起消失', () => {
  const items = [{ sessionId: 'x' }]
  const r = foldBranches(items, lin({ gone1: 'GONE', gone2: 'GONE' }))
  assert.deepEqual(r.topList.map((i) => i.sessionId), ['x'])
  assert.equal(r.branchGroupsOf.size, 0)
  assert.equal(r.groupCount, 0)
  assertConserved(r, items, 'E1')
})

test('E2: 组里剩 1 个成员 → 组保留、foldedCount 记 1', () => {
  const items = [{ sessionId: 'b2', createdAt: 3 }]
  const r = foldBranches(items, lin({ b1: 'GONE', b2: 'GONE' }))
  assert.deepEqual(r.branchGroupsOf.get('GONE').map((i) => i.sessionId), ['b2'])
  assert.equal(r.foldedCount, 1)
  assert.equal(r.groupCount, 1)
  assert.deepEqual(r.topList.map((i) => i.sessionId), ['dsm-src:GONE'])
  assertConserved(r, items, 'E2')
})

test('E3: lineage 迟到——第一次空表、第二次全表，两次都守恒且行为正确', () => {
  const items = [{ sessionId: 'P' }, { sessionId: 'b1', createdAt: 2 }, { sessionId: 'b2', createdAt: 1 }]
  const r1 = foldBranches(items, {})
  assert.deepEqual(r1.topList.map((i) => i.sessionId), ['P', 'b1', 'b2'])
  assert.equal(r1.foldedCount, 0)
  assertConserved(r1, items, 'E3/迟到前')
  const r2 = foldBranches(items, lin({ b1: 'P', b2: 'P' }))
  assert.deepEqual(r2.topList.map((i) => i.sessionId), ['P'])
  assert.deepEqual(r2.branchGroupsOf.get('P').map((i) => i.sessionId), ['b2', 'b1'])
  assertConserved(r2, items, 'E3/到齐后')
})

// —— T4（3.7.0）：applyTagFilter / 筛选快照 / 标签删除确认文案 ————

// ---- applyTagFilter：标签筛选（单选）--------------------------------------

test('applyTagFilter: 空 tagId（\'\'/null/undefined/缺省）原样返回同一数组', () => {
  const list = [{ sessionId: 'a', tags: ['t1'] }, { sessionId: 'b', tags: [] }]
  assert.equal(applyTagFilter(list, ''), list, '空串须原样返回（同一引用，不做拷贝）')
  assert.equal(applyTagFilter(list, null), list)
  assert.equal(applyTagFilter(list, undefined), list)
  assert.equal(applyTagFilter(list), list, '缺省参数等同不筛')
})

test('applyTagFilter: 命中子集；id 比较字符串化防类型漂移', () => {
  const list = [
    { sessionId: 'a', tags: ['t1', 't2'] },
    { sessionId: 'b', tags: ['t2'] },
    { sessionId: 'c', tags: [] },
    { sessionId: 'd' },
  ]
  assert.deepEqual(applyTagFilter(list, 't2').map((i) => i.sessionId), ['a', 'b'])
  assert.deepEqual(applyTagFilter(list, 't1').map((i) => i.sessionId), ['a'])
  assert.equal(applyTagFilter(list, 7).length, 0)
  // 数字 id vs 字符串 tagId：字符串化后仍命中（host/本地类型漂移不得漏判）。
  assert.deepEqual(applyTagFilter([{ sessionId: 'x', tags: [7] }], '7').map((i) => i.sessionId), ['x'])
})

test('applyTagFilter: 畸形输入一律宽容不抛错，非数组 tags 视为不匹配', () => {
  assert.deepEqual(applyTagFilter(null, 't1'), [])
  assert.deepEqual(applyTagFilter(undefined, 't1'), [])
  assert.deepEqual(applyTagFilter('not-a-list', 't1'), [])
  const junk = [null, undefined, {}, { sessionId: 'ok', tags: 'not-array' }, { sessionId: 'hit', tags: ['t1'] }]
  assert.deepEqual(applyTagFilter(junk, 't1').map((i) => i.sessionId), ['hit'])
  // 未知 tagId → 空表（诚实的 0 结果，绝不抛错）。
  assert.deepEqual(applyTagFilter([{ sessionId: 'a', tags: ['t1'] }], 'gone'), [])
})

// ---- 标签删除确认文案（copy-guard 的纯函数替身）---------------------------

test('tagDeleteConfirm: 含删除红线关键词与会话名，未命名兜底', () => {
  const t = tagDeleteConfirm('重要项目')
  assert.ok(t.includes('重要项目'), '文案必须点名被删标签')
  assert.ok(t.includes('只删标签，不会删除会话'), '红线：必须明说不会删除会话（防用户以为会话丢）')
  assert.ok(t.includes('删除标签'), '必须以删除标签开头表意')
  assert.ok(tagDeleteConfirm('').includes('(未命名)'), '空名兜底')
  assert.ok(tagDeleteConfirm(null).includes('(未命名)'), 'null 兜底')
})

// ---- 已存筛选：快照落盘 / 读回 / 往返 / 脏数据 ----------------------------

test('filterSnapshotOf: 合法值原样抓取；非法/缺省回落默认', () => {
  assert.deepEqual(
    filterSnapshotOf({ filter: 'archived', workspaceFilter: '/tmp/w', sortBy: 'title', tagFilter: 't1' }),
    { view: 'archived', workspace: '/tmp/w', sort: 'title', tag: 't1' },
  )
  assert.deepEqual(filterSnapshotOf(), { view: 'all', workspace: 'all', sort: 'newest', tag: '' })
  assert.deepEqual(
    filterSnapshotOf({ filter: 'nope', workspaceFilter: '', sortBy: 42, tagFilter: null }),
    { view: 'all', workspace: 'all', sort: 'newest', tag: '' },
  )
  // 'all' 视图/工作区是合法域内值，原样保留（不回落）。
  assert.deepEqual(
    filterSnapshotOf({ filter: 'all', workspaceFilter: 'all', sortBy: 'oldest', tagFilter: '' }),
    { view: 'all', workspace: 'all', sort: 'oldest', tag: '' },
  )
})

test('filterShapeFromSaved ↔ filterSnapshotOf: 往返等值且 degraded 全空', () => {
  const states = [
    { filter: 'all', workspaceFilter: 'all', sortBy: 'newest', tagFilter: '' },
    { filter: 'archived', workspaceFilter: '/Users/x/proj', sortBy: 'title', tagFilter: 't_abc' },
    { filter: 'trash', workspaceFilter: '', sortBy: 'oldest', tagFilter: '' },
    { filter: 'starred', workspaceFilter: '/p', sortBy: 'newest', tagFilter: 't_zzz' },
  ]
  for (const s of states) {
    const saved = { id: 'f_1', name: 'n', createdAt: 1, filters: filterSnapshotOf(s) }
    const back = filterShapeFromSaved(saved)
    assert.equal(back.view, s.filter || 'all')
    assert.equal(back.workspace, s.workspaceFilter || 'all')
    assert.equal(back.sort, s.sortBy)
    assert.equal(back.tag, s.tagFilter)
    assert.deepEqual(back.degraded, [], '干净快照读回不得标任何 degraded: ' + JSON.stringify(s))
  }
})

test('filterShapeFromSaved: 非法字段逐项回落默认并在 degraded 标注', () => {
  const r = filterShapeFromSaved({ filters: { view: 'bogus', workspace: 42, sort: 'date', tag: { evil: 1 } } })
  assert.equal(r.view, 'all')
  assert.equal(r.workspace, 'all')
  assert.equal(r.sort, 'newest')
  assert.equal(r.tag, '')
  assert.deepEqual(r.degraded.sort(), ['sort', 'tag', 'view', 'workspace'])
})

test('filterShapeFromSaved: 脏数据宽容——null/数组/缺字段统统不抛错', () => {
  for (const junk of [null, undefined, {}, 'str', [], { filters: null }, { filters: [] }, { filters: 'x' }, { filters: 42 }]) {
    const r = filterShapeFromSaved(junk)
    assert.equal(r.view, 'all')
    assert.equal(r.workspace, 'all')
    assert.equal(r.sort, 'newest')
    assert.equal(r.tag, '')
    assert.equal(r.degraded.length, 4, '整条皆脏 = 四字段全部标注回落: ' + JSON.stringify(junk))
  }
  // 部分缺字段：只标缺的那个；'' 的 tag 是合法值（=全部标签），不标注。
  const partial = filterShapeFromSaved({ filters: { view: 'empty', workspace: '/p', sort: 'newest', tag: '' } })
  assert.deepEqual(partial, { view: 'empty', workspace: '/p', sort: 'newest', tag: '', degraded: [] })
  const noTag = filterShapeFromSaved({ filters: { view: 'all', workspace: 'all', sort: 'all' } })
  assert.equal(noTag.sort, 'newest')
  assert.deepEqual(noTag.degraded, ['sort', 'tag'], 'sort 非法值 + tag 缺失 → 各标一项')
})



// ---- remainingRows / overflowPlan：issue #16「展开其余 N 个」计数虚高 --------
// 上游 N 是「水位线之外还没渲染的行数」，插件隐藏数是「整组被藏起来的行数」，
// 两个口径不重叠 → 不能相减。真正要显示的是「本组可见总数 − 已渲染可见数」。
// 下面这组数字直接取自 issue #16 的实测：24 行、回收站 13、可见 11、
// 点击前 DOM 12 行里 4 行可见、点击后 DOM 17 行里仍是 4 行可见。
test('remaining rows never go negative when the group hides most of its rows', () => {
  const visibleTotal = 24 - 13 // 上游会列出、且插件不会藏的会话
  // 点击前：12 行已渲染，其中 4 行可见、8 行是被插件藏起来的回收站行
  const before = countRenderedVisible(
    [
      ...Array.from({ length: 4 }, (_, i) => ({ id: 'live-' + i, pluginHidden: false })),
      ...Array.from({ length: 8 }, (_, i) => ({ id: 'trash-' + i, pluginHidden: true })),
    ],
    new Set(Array.from({ length: visibleTotal }, (_, i) => 'live-' + i)),
  )
  assert.equal(before, 4)
  assert.equal(remainingRows(visibleTotal, before), 7)
  // 点击后：17 行已渲染，新露出的 5 行全是被藏起来的回收站行 → 可见的仍是 4 行
  const after = countRenderedVisible(
    [
      ...Array.from({ length: 4 }, (_, i) => ({ id: 'live-' + i, pluginHidden: false })),
      ...Array.from({ length: 13 }, (_, i) => ({ id: 'trash-' + i, pluginHidden: true })),
    ],
    new Set(Array.from({ length: visibleTotal }, (_, i) => 'live-' + i)),
  )
  assert.equal(after, 4)
  assert.equal(remainingRows(visibleTotal, after), 7)
  // 旧口径「N − 整组隐藏数」= 12 − 13 = −1，会把按钮藏掉、会话不可达：
  // 新口径在同样的数据下必须是正数（按钮保留）。
  assert.ok(remainingRows(visibleTotal, before) > 0)
})

test('collapsed groups derive their tally from sessionCount minus that workspace trash', () => {
  // 折叠态上游把 group.sessions 收回成空数组 —— 而这正是展开按钮出现的时刻。
  // 旧实现在这里走「空集保护」直接 return，展开计数永远得不到校准（#16 的
  // 「点开没反应 / 数字不动」）。折叠态改用 sessionCount − 本工作区回收站条数。
  assert.equal(collapsedVisibleTotal(24, 13), 11)
  assert.equal(collapsedVisibleTotal(7, 4), 3)
  // 回收站比组内总数还多（数据短暂不一致）：夹到 0，不写负数。
  assert.equal(collapsedVisibleTotal(3, 9), 0)
  // 一个都没进回收站 → 总数原样。
  assert.equal(collapsedVisibleTotal(5, 0), 5)
  // 拿不到任一侧就返回 null，调用方据此保持上游原文案，绝不猜数字。
  assert.equal(collapsedVisibleTotal(null, 3), null)
  assert.equal(collapsedVisibleTotal(5, null), null)
  assert.equal(collapsedVisibleTotal(NaN, 3), null)
})

test('rendered visible rows share the same vocabulary as the visible total', () => {
  const ids = new Set(['a', 'b'])
  // 空白会话（不在 ids 里）即使渲染出来也不算「已渲染的可见行」。
  assert.equal(countRenderedVisible([{ id: 'blank', pluginHidden: false }], ids), 0)
  // 回收站/空白行带插件标记，不计。
  assert.equal(countRenderedVisible([{ id: 'a', pluginHidden: true }], ids), 0)
  assert.equal(countRenderedVisible([{ id: 'a', pluginHidden: false }, { id: 'b', pluginHidden: false }], ids), 2)
  assert.equal(countRenderedVisible([], ids), 0)
  assert.equal(countRenderedVisible(null, ids), 0)
  assert.equal(countRenderedVisible([{ id: 'a' }], null), 0)
})

test('remaining rows clamps bad input instead of inventing rows', () => {
  assert.equal(remainingRows(0, 0), 0)
  assert.equal(remainingRows(5, 9), 0) // DOM 比数据层多（口径短暂不一致）→ 0，不写负数
  assert.equal(remainingRows(5, -3), 5)
  assert.equal(remainingRows(null, 2), null) // 未知就是未知，交由调用方保持原样
  assert.equal(remainingRows(undefined, 2), null)
  assert.equal(remainingRows('abc', 2), null)
})

test('overflow plan writes the remaining count into the label', () => {
  const zh = overflowPlan('展开其余 12 个会话', 7)
  assert.equal(zh.hide, false)
  assert.equal(zh.base, 12)
  assert.equal(zh.more, 7)
  assert.equal(zh.changed, true)
  assert.equal(zh.text, '展开其余 7 个会话')

  const en = overflowPlan('Show 12 more sessions', 5)
  assert.equal(en.text, 'Show 5 more sessions')
  assert.equal(en.more, 5)
})

test('overflow plan hides the button only when nothing would appear', () => {
  const done = overflowPlan('展开其余 12 个会话', 0)
  assert.equal(done.hide, true)
  assert.equal(done.more, 0)
  // 同数字不重写，避免无谓的文本写入（会触发 characterData 观察）。
  const same = overflowPlan('展开其余 7 个会话', 7)
  assert.equal(same.hide, false)
  assert.equal(same.changed, false)
})

test('overflow plan leaves unknown counts and count-less labels untouched', () => {
  // 拿不到数据层：不改文案也不藏按钮（DOM 兜底在数学上不成立）。
  const unknown = overflowPlan('展开其余 12 个会话', null)
  assert.equal(unknown.hide, false)
  assert.equal(unknown.changed, false)
  assert.equal(unknown.text, '展开其余 12 个会话')
  assert.equal(unknown.more, null)

  // 展开态「收起」没有数字：不能据此隐藏按钮，否则用户收不回去。
  const collapse = overflowPlan('收起', 0)
  assert.equal(collapse.hide, false)
  assert.equal(collapse.changed, false)
  assert.equal(collapse.text, '收起')
  assert.equal(collapse.base, null)

  const empty = overflowPlan('', 3)
  assert.equal(empty.hide, false)
  assert.equal(empty.text, '')
})

test('overflow plan tolerates thousand separators and never counts backwards', () => {
  const thousands = overflowPlan('展开其余 1,200 个会话', 200)
  assert.equal(thousands.base, 1200)
  assert.equal(thousands.more, 200)
  assert.equal(thousands.text, '展开其余 200 个会话')

  // 负数一律按 0（= 没有可展开的）处理，绝不反向加数。
  assert.equal(overflowPlan('展开其余 5 个会话', -3).more, 0)
  assert.equal(overflowPlan('展开其余 5 个会话', 'abc').more, null)
})

// ---- aliveSessionCount：空分组判定（0.1.7+ 顶层分组无 role，靠工作区行定位）---
// 只有数据层能证明「组内一条都留不下」时，才允许把分组标题一起藏掉。
test('alive count ignores blank sessions and every plugin-hidden id', () => {
  const sessions = [
    { id: 'a' },            // 正常可见
    { id: 'b', blank: true }, // 空白会话：上游从不计入可展开数
    { id: 'c' },            // 回收站
    { id: 'd' },            // 已彻底删除
    { id: 'e' },            // 空白血缘
    { id: 'f' },            // 正常可见
  ]
  const hidden = new Set(['c', 'd', 'e'])
  assert.equal(aliveSessionCount(sessions, hidden), 2)
})

test('alive count is zero only when nothing can ever reappear', () => {
  const hidden = new Set(['c', 'd'])
  assert.equal(aliveSessionCount([{ id: 'c' }, { id: 'd' }], hidden), 0)
  // 只剩空白会话 = 组里没有可显示的内容（插件一律隐藏空白行）。
  assert.equal(aliveSessionCount([{ id: 'x', blank: true }], hidden), 0)
})

test('alive count reports unknown instead of empty for missing or empty data', () => {
  // 拿不到数据层 / 组还没加载出会话：一律按「不知道」处理，调用方据此保持
  // 显示——宁可留一个空标题，也不能把还有会话的组藏掉（会话会不可达）。
  assert.equal(aliveSessionCount(null, new Set()), null)
  assert.equal(aliveSessionCount(undefined, new Set()), null)
  assert.equal(aliveSessionCount([], new Set()), null)
  assert.equal(aliveSessionCount('nope', new Set()), null)
  // 没有一条带 id（结构不认识）→ 同样是「不知道」，不是「组空」。
  assert.equal(aliveSessionCount([{ id: null }, { nope: 1 }], new Set()), null)
})

// ---- foldOrphanSubagents：父会话不在列表的子代理（issue #18 第 1 条）--------
// 这些行先前平铺成上百个「(无标题)」，现在是单独的「未归属子代理」卡片。
test('foldOrphanSubagents moves parentless subagents out of the top-level rows', () => {
  const items = [
    { sessionId: 'p1' },
    { sessionId: 'k1' },
    { sessionId: 'k2' },
    { sessionId: 'plain' },
  ]
  const lineage = {
    k1: { origin: 'subagent', parentSession: 'gone' },
    k2: { origin: 'subagent', parentSession: 'gone' },
  }
  const { rows, orphans } = foldOrphanSubagents(items, lineage)
  assert.deepEqual(rows.map((x) => x.sessionId), ['p1', 'plain'])
  assert.deepEqual(orphans.map((x) => x.sessionId), ['k1', 'k2'])
})

test('foldOrphanSubagents keeps fork branches and ordinary sessions in place', () => {
  const items = [{ sessionId: 'a' }, { sessionId: 'b' }, { sessionId: 'c' }]
  const lineage = {
    // 分叉分支有 parentSession 但 origin 不是 subagent：它是独立会话，留在列表里。
    a: { origin: null, parentSession: 'root' },
    b: { origin: 'subagent', parentSession: 'root' },
    c: {},
  }
  const { rows, orphans } = foldOrphanSubagents(items, lineage)
  assert.deepEqual(rows.map((x) => x.sessionId), ['a', 'c'])
  assert.deepEqual(orphans.map((x) => x.sessionId), ['b'])
})

test('foldOrphanSubagents tolerates malformed input', () => {
  assert.deepEqual(foldOrphanSubagents(null, null), { rows: [], orphans: [] })
  assert.deepEqual(foldOrphanSubagents([null, { nope: 1 }, { sessionId: 'x' }], null).rows.length, 3)
  // lineage 里没有对应条目 = 普通会话（保持原位），绝不误判成子代理。
  assert.deepEqual(foldOrphanSubagents([{ sessionId: 'x' }], {}).orphans, [])
})

test('dragAutoScrollStep ramps up inside the top and bottom edge bands', () => {
  const box = { top: 100, bottom: 1100 } // 1000px 高的列表 → 感应带 64px
  // 光标在容器上边界之外：满速向上，不会因为超出量无限放大。
  assert.equal(dragAutoScrollStep({ y: -50, ...box }), -20)
  // 感应带正中：半速（ceil(20 * 0.5)）。
  assert.equal(dragAutoScrollStep({ y: 100 + 32, ...box }), -10)
  // 刚进感应带：最慢一档。
  assert.equal(dragAutoScrollStep({ y: 100 + 63, ...box }), -1)
  // 中间死区：不动。
  assert.equal(dragAutoScrollStep({ y: 600, ...box }), 0)
  // 底部对称。
  assert.equal(dragAutoScrollStep({ y: 1100 - 63, ...box }), 1)
  assert.equal(dragAutoScrollStep({ y: 1100 - 32, ...box }), 10)
  assert.equal(dragAutoScrollStep({ y: 1200, ...box }), 20)
})

test('dragAutoScrollStep keeps a dead zone even at the very top and bottom edges', () => {
  const box = { top: 0, bottom: 1000 }
  // 正好落在上边界 / 下边界上时方向唯一，不会两边同时命中。
  assert.ok(dragAutoScrollStep({ y: 0, ...box }) < 0)
  assert.ok(dragAutoScrollStep({ y: 1000, ...box }) > 0)
  // 感应带不会超过容器高度的一半：矮容器（40px）中点仍然不动。
  const short = { top: 200, bottom: 240 }
  assert.equal(dragAutoScrollStep({ y: 220, ...short }), 0)
  assert.ok(dragAutoScrollStep({ y: 200, ...short }) < 0)
  assert.ok(dragAutoScrollStep({ y: 240, ...short }) > 0)
})

test('dragAutoScrollStep tolerates broken geometry and disabled limits', () => {
  assert.equal(dragAutoScrollStep(), 0)
  assert.equal(dragAutoScrollStep({ y: NaN, top: 0, bottom: 100 }), 0)
  assert.equal(dragAutoScrollStep({ y: 10, top: 100, bottom: 0 }), 0) // 反向 rect
  assert.equal(dragAutoScrollStep({ y: 10, top: 0, bottom: 100, maxStep: 0 }), 0)
  assert.equal(dragAutoScrollStep({ y: 10, top: 0, bottom: 100, edge: 0 }), 0)
  // maxStep 变小，满速跟着变小（常量是可调的）。
  assert.equal(dragAutoScrollStep({ y: -50, top: 0, bottom: 100, maxStep: 6 }), -6)
})
