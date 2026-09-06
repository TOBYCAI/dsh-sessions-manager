import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pathOwnsSession } from '../src/path-guard.js'

// 彻底删除前的路径归属校验：POSIX 与 Windows 两种分隔符、两种历史布局，
// 并拒绝 id 子串误匹配（abc ≠ abcdef）与一切无关路径。

test('accepts the official per-session directory layout (POSIX)', () => {
  assert.equal(pathOwnsSession('/Users/x/.dsh/sessions/proj/sid-1/session.jsonl.zstd', 'sid-1'), true)
})

test('accepts the legacy flat layout where the filename contains the id', () => {
  assert.equal(pathOwnsSession('/Users/x/.dsh/sessions/proj/sid-1.jsonl.zstd', 'sid-1'), true)
  // 扩展名点号不是 id 粘连
  assert.equal(pathOwnsSession('/w/sid-1.zstd', 'sid-1'), true)
})

test('accepts Windows separators and drive letters', () => {
  assert.equal(pathOwnsSession('C:\\Users\\you\\.dsh\\sessions\\proj\\sid-1\\session.jsonl.zstd', 'sid-1'), true)
  assert.equal(pathOwnsSession('C:\\Users\\you\\sessions\\sid-1.jsonl.zstd', 'sid-1'), true)
  assert.equal(pathOwnsSession('\\\\?\\C:\\data\\sid-1\\session.jsonl.zstd', 'sid-1'), true)
})

test('rejects ids embedded in a longer id (substring collision)', () => {
  assert.equal(pathOwnsSession('/w/sid-11/session.jsonl.zstd', 'sid-1'), false)
  assert.equal(pathOwnsSession('/w/sid-1abc.jsonl.zstd', 'sid-1'), false)
  assert.equal(pathOwnsSession('/w/xsid-1.jsonl.zstd', 'sid-1'), false)
})

test('rejects unrelated paths and junk input', () => {
  assert.equal(pathOwnsSession('/w/other/session.jsonl.zstd', 'sid-1'), false)
  assert.equal(pathOwnsSession('', 'sid-1'), false)
  assert.equal(pathOwnsSession(null, 'sid-1'), false)
  assert.equal(pathOwnsSession('/w/sid-1/session.jsonl.zstd', ''), false)
  // 尾部斜杠不影响
  assert.equal(pathOwnsSession('/w/sid-1/session.jsonl.zstd\\', 'sid-1'), true)
})
