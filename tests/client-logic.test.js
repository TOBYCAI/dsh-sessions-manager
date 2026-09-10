import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authoritativeTitleForFirstPaint, canDropOnWorkspace, dotStateFor, foldSubagents, openSubagentToast, sessionForNodes, shortId, starredOf, TOAST_MAX_MS, TOAST_MIN_MS, toastDurationFor, workspaceForNodes } from '../src/client/logic.js'

// ---- dotStateFor：状态点语义 ----------------------------------------------
// 历史回归：DSH 把 running 报成 ongoing（9766476）；done 在当前行上不能亮绿
// （否则点开闪绿）。这两个 case 锁死。
test('dot states map DSH data-state onto the plugin scheme', () => {
  assert.equal(dotStateFor({ dataState: 'running' }), 'running')
  assert.equal(dotStateFor({ dataState: 'ongoing' }), 'running')
  assert.equal(dotStateFor({ dataState: 'warning' }), 'feedback')
  assert.equal(dotStateFor({ dataState: 'error' }), 'error')
  assert.equal(dotStateFor({ dataState: 'done' }), 'done')
})

test('done dot is suppressed on the active row (no green flash on open)', () => {
  assert.equal(dotStateFor({ dataState: 'done', isActive: true }), null)
  assert.equal(dotStateFor({ dataState: 'done', isActive: false }), 'done')
})

test('manual unread wins over every DSH state', () => {
  assert.equal(dotStateFor({ manualUnread: true, dataState: 'running' }), 'manual')
  assert.equal(dotStateFor({ manualUnread: true, dataState: 'error' }), 'manual')
  assert.equal(dotStateFor({ manualUnread: true, dataState: 'done', isActive: true }), 'manual')
})

test('unknown or missing states yield no dot', () => {
  assert.equal(dotStateFor({}), null)
  assert.equal(dotStateFor({ dataState: '' }), null)
  assert.equal(dotStateFor({ dataState: 'idle' }), null)
  assert.equal(dotStateFor({ dataState: 'paused' }), null)
})

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
