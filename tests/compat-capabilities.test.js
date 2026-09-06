import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectCapabilities, requireCapability } from '../src/compat/capabilities.js'

const legacyWorkspace = () => ({
  archiveSession() {}, headers: new Map(), sessionPaths: new Map(), replaceHeaderIndex() {},
})

test('legacy JSONL shape keeps the verified destructive actions', () => {
  const value = detectCapabilities({
    persistence: { readFrom() {}, locate() {} }, workspaceRegistry: legacyWorkspace(),
  })
  assert.equal(value.persistence, 'legacy')
  // 新规范键名
  assert.equal(value.actions.physicalPurge.available, true)
  assert.equal(value.actions.relocateSession.available, true)
  assert.equal(value.actions.restoreIndexedSession.available, true)
  assert.equal(value.actions.softTrash.available, true)
  assert.equal(value.actions.readInspection.available, true)
  assert.equal(value.actions.archive.available, true)
  // 旧键名别名仍存在（client/路由过渡期兼容）
  assert.equal(value.actions.purge.available, true)
  assert.equal(value.actions.move.available, true)
  assert.equal(value.actions.restoreTrash.available, true)
})

test('SessionHandle shape: root derivable enables purge/move, otherwise degrade with reason', () => {
  // 无 root 实例字段：整体降级，理由说明「无法确认存储根目录」。
  const gated = detectCapabilities({ persistence: { open() {}, stat() {} }, workspaceRegistry: { archiveSession() {} } })
  assert.equal(gated.persistence, 'session-handle')
  assert.equal(gated.actions.readInspection.available, true)
  assert.equal(gated.actions.archive.available, true)
  assert.equal(gated.actions.softTrash.available, true)
  assert.equal(gated.actions.physicalPurge.available, false)
  assert.equal(gated.actions.relocateSession.available, false)
  assert.match(gated.actions.physicalPurge.reason, /存储根目录/)
  // restore 不再无条件宣称可用，但 stat 存在 → 可校验 → 可用
  assert.equal(gated.actions.restoreIndexedSession.available, true)

  // root 可推导 + workspaceRegistry 内部结构在位：物理删除与移动恢复可用
  // （2026-09-06 用户决策：沿用 legacy 半官方路线，守卫见 handle-era-paths.js）。
  const enabled = detectCapabilities({
    persistence: { open() {}, stat() {}, root: '/tmp/dsh-sessions' },
    workspaceRegistry: legacyWorkspace(),
  })
  assert.equal(enabled.actions.physicalPurge.available, true)
  assert.equal(enabled.actions.relocateSession.available, true)
  assert.equal(enabled.actions.purge.available, true)
  assert.equal(enabled.actions.move.available, true)

  // root 可推导但缺 workspaceRegistry 内部结构：移动降级、删除仍可用。
  const noRegistry = detectCapabilities({
    persistence: { open() {}, stat() {}, root: '/tmp/dsh-sessions' },
    workspaceRegistry: { archiveSession() {} },
  })
  assert.equal(noRegistry.actions.physicalPurge.available, true)
  assert.equal(noRegistry.actions.relocateSession.available, false)
  assert.match(noRegistry.actions.relocateSession.reason, /工作区注册表/)
})

test('restoreIndexedSession is unavailable when existence cannot be verified', () => {
  const value = detectCapabilities({ persistence: {}, workspaceRegistry: {} })
  assert.equal(value.actions.restoreIndexedSession.available, false)
  assert.match(value.actions.restoreIndexedSession.reason, /校验/)
  assert.equal(value.actions.softTrash.available, false)
})

test('legacy restore requires at least one existence-check path', () => {
  const value = detectCapabilities({ persistence: { locate() {} }, workspaceRegistry: legacyWorkspace() })
  // 无 readFrom 也无 stat：无法校验底层会话 → 恢复必须降级
  assert.equal(value.actions.restoreIndexedSession.available, false)
  assert.equal(value.actions.physicalPurge.available, true, 'purge 只依赖 locate')
})

test('requireCapability returns a stable conflict error', () => {
  const value = detectCapabilities({ persistence: { open() {} }, workspaceRegistry: {} })
  assert.throws(() => requireCapability(value, 'relocateSession'), (error) => {
    assert.equal(error.status, 409)
    assert.equal(error.code, 'DSM_CAPABILITY_UNAVAILABLE')
    return true
  })
  assert.throws(() => requireCapability(value, 'move'), (error) => {
    assert.equal(error.code, 'DSM_CAPABILITY_UNAVAILABLE')
    return true
  })
})
