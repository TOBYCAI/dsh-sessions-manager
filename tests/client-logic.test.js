import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canDropOnWorkspace, dotStateFor, sessionForNodes, workspaceForNodes } from '../src/client/logic.js'

// ---- dotStateFor：状态点语义 ----------------------------------------------
// 历史回归：DSH 把 running 报成 ongoing（9766476）；done 在当前行上不能亮绿
// （否则点开闪绿）。这两个 case 锁死。
test('dot states map DSH data-state onto the plugin scheme', () => {
  assert.equal(dotStateFor({ dataState: 'running' }), 'running')
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
  // 上游枚举变化（如 ongoing 事件重演）必须落到"无点"而不是抛错。
  assert.equal(dotStateFor({ dataState: 'ongoing' }), null)
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
