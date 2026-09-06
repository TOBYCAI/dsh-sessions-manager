import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSessionMetaCache, fingerprintOf, isFresh, isPersistableFingerprint, partitionByCache } from '../src/session-meta-cache.js'

const STAT_A = { mtimeMs: 1000.4, size: 256 }
const STAT_A_SAME = { mtimeMs: 1000.6, size: 256 } // 同一指纹（mtime 取整）
const STAT_A_TOUCHED = { mtimeMs: 2000, size: 256 } // append 后 mtime 变
const STAT_A_GROWN = { mtimeMs: 1000, size: 512 } // size 变
const META_A = { title: 'Hello', cwd: '/tmp/w', createdAt: 123 }

test('fingerprintOf rejects unusable stats', () => {
  assert.equal(fingerprintOf(null), null)
  assert.equal(fingerprintOf({}), null)
  assert.equal(fingerprintOf({ mtimeMs: 0, size: 1 }), null)
  assert.equal(fingerprintOf({ mtimeMs: 5, size: -1 }), null)
  assert.equal(fingerprintOf({ mtimeMs: 1000, size: 256 }), '1000:256')
})

test('isFresh requires fingerprint match and TTL', () => {
  const entry = { fingerprint: '1000:256', at: 10_000, meta: META_A }
  assert.equal(isFresh(entry, STAT_A, 10_001), true)
  // 同一文件，mtime 毫秒小数差异不影响
  assert.equal(isFresh(entry, STAT_A_SAME, 10_001), true)
  assert.equal(isFresh(entry, STAT_A_TOUCHED, 10_001), false)
  assert.equal(isFresh(entry, STAT_A_GROWN, 10_001), false)
  assert.equal(isFresh(entry, null, 10_001), false)
  assert.equal(isFresh(null, STAT_A, 10_001), false)
  // 过期
  assert.equal(isFresh(entry, STAT_A, 10_000 + 5 * 60 * 1000 + 1), false)
  // 自定义 TTL（30s）：20s 内新鲜、31s 过期
  assert.equal(isFresh(entry, STAT_A, 10_000 + 20_000, 30_000), true)
  assert.equal(isFresh(entry, STAT_A, 10_000 + 31_000, 30_000), false)
})

test('partitionByCache splits hits and misses', () => {
  const cache = new Map([['s1', { fingerprint: '1000:256', at: 10_000, meta: META_A }]])
  const stats = new Map([['s1', STAT_A], ['s2', { mtimeMs: 7, size: 9 }]])
  // s2 没有缓存条目 → missing；s1 命中
  let r = partitionByCache(['s1', 's2'], stats, cache, 10_001)
  assert.equal(r.cached.get('s1'), META_A)
  assert.deepEqual(r.missing, ['s2'])
  // 指纹过期 → 也进 missing
  stats.set('s1', STAT_A_TOUCHED)
  r = partitionByCache(['s1'], stats, cache, 10_001)
  assert.deepEqual(r.missing, ['s1'])
  assert.equal(r.cached.size, 0)
  // 无法 stat 的会话绝不能按命中处理
  r = partitionByCache(['s1'], new Map(), cache, 10_001)
  assert.deepEqual(r.missing, ['s1'])
})

test('cache round-trips on identical fingerprint and misses on change', () => {
  const c = createSessionMetaCache()
  assert.equal(c.get('s1', STAT_A), null)
  assert.equal(c.set('s1', null, META_A), null) // 无 stat 不写入
  assert.equal(c.get('s1', STAT_A), null)
  assert.equal(c.set('s1', STAT_A, META_A), META_A)
  assert.equal(c.get('s1', STAT_A), META_A)
  assert.equal(c.get('s1', STAT_A_SAME), META_A) // 毫秒取整同一指纹
  assert.equal(c.get('s1', STAT_A_TOUCHED), null) // append 后未命中
})

test('invalidate drops exactly one entry', () => {
  const c = createSessionMetaCache()
  c.set('s1', STAT_A, META_A)
  c.set('s2', STAT_A, META_A)
  assert.equal(c.invalidate('s1'), true)
  assert.equal(c.invalidate('s1'), false)
  assert.equal(c.get('s1', STAT_A), null)
  assert.equal(c.get('s2', STAT_A), META_A)
  assert.equal(c.invalidate(null), false)
})

test('evicts least-recently-used beyond capacity', () => {
  const c = createSessionMetaCache({ max: 2 })
  const stat = (n) => ({ mtimeMs: n, size: 1 })
  c.set('a', stat(1), { title: 'a' })
  c.set('b', stat(2), { title: 'b' })
  c.get('a', stat(1)) // a 变为最近使用
  c.set('c', stat(3), { title: 'c' }) // 淘汰 b
  assert.equal(c.get('b', stat(2)), null)
  assert.deepEqual(c.get('a', stat(1)), { title: 'a' })
  assert.deepEqual(c.get('c', stat(3)), { title: 'c' })
  assert.equal(c.size, 2)
})

test('stats reports hits, misses and size', () => {
  const c = createSessionMetaCache({ ttlMs: 1234 })
  c.set('s1', STAT_A, META_A)
  c.get('s1', STAT_A)
  c.get('s2', STAT_A)
  assert.deepEqual(c.stats(), { size: 1, hits: 1, misses: 1, ttlMs: 1234 })
})

// ---- revision 指纹（SessionHandle 世代，0.1.3+）----------------------------
// 官方契约：revision 是不透明令牌，只在同一 service 实例 + 同一 session id 内
// 可比较；相等可视为日志未变。绝不能写入跨进程持久缓存。

const REV_A = { revision: 'opaque-1' }
const REV_B = { revision: 'opaque-2' }

test('revision stats produce rev-prefixed, non-persistable fingerprints', () => {
  assert.equal(fingerprintOf(REV_A), 'rev:opaque-1')
  assert.equal(fingerprintOf({ revision: '' }), null)
  // revision 优先于 mtime/size 字段
  assert.equal(fingerprintOf({ revision: 'r', mtimeMs: 1, size: 1 }), 'rev:r')
  assert.equal(isPersistableFingerprint('rev:opaque-1'), false)
  assert.equal(isPersistableFingerprint('1000:256'), true)
  assert.equal(isPersistableFingerprint(null), false)
})

test('revision entries never expire via TTL (contract: equal revision = unchanged)', () => {
  const entry = { fingerprint: 'rev:opaque-1', at: 10_000, meta: META_A }
  // 远超任何 TTL：相等 revision 仍然权威
  assert.equal(isFresh(entry, REV_A, 10_000 + 60 * 60 * 1000), true)
  assert.equal(isFresh(entry, REV_B, 10_001), false)
  // mtime 条目与 revision 条目不能互相匹配
  assert.equal(isFresh(entry, STAT_A, 10_001), false)
})

test('cache round-trips on revision and misses on revision change', () => {
  const c = createSessionMetaCache()
  assert.equal(c.set('s1', REV_A, META_A), META_A)
  assert.equal(c.get('s1', REV_A), META_A)
  assert.equal(c.get('s1', REV_B), null) // 日志变了（revision 变化）→ 重投影
  assert.equal(c.get('s1', STAT_A), null) // 指纹类型不匹配 → 重投影
})

test('revision partitions separate from mtime fingerprints', () => {
  const cache = new Map([['s1', { fingerprint: 'rev:opaque-1', at: 10_000, meta: META_A }]])
  const stats = new Map([['s1', REV_A], ['s2', REV_B], ['s3', STAT_A]])
  const r = partitionByCache(['s1', 's2', 's3'], stats, cache, 10_001)
  assert.equal(r.cached.get('s1'), META_A)
  assert.deepEqual(r.missing, ['s2', 's3'])
})
