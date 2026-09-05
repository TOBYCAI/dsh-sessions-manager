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
  assert.equal(value.actions.purge.available, true)
  assert.equal(value.actions.move.available, true)
})

test('SessionHandle shape exposes reads but gates unverified destructive actions', () => {
  const value = detectCapabilities({ persistence: { open() {} }, workspaceRegistry: { archiveSession() {} } })
  assert.equal(value.persistence, 'session-handle')
  assert.equal(value.actions.read.available, true)
  assert.equal(value.actions.archive.available, true)
  assert.equal(value.actions.purge.available, false)
  assert.equal(value.actions.move.available, false)
  assert.match(value.actions.purge.reason, /永久删除/)
})

test('requireCapability returns a stable conflict error', () => {
  const value = detectCapabilities({ persistence: { open() {} }, workspaceRegistry: {} })
  assert.throws(() => requireCapability(value, 'move'), (error) => {
    assert.equal(error.status, 409)
    assert.equal(error.code, 'DSM_CAPABILITY_UNAVAILABLE')
    return true
  })
})
