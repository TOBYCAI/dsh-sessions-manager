// 3.8.1 底座换轨：官方持久投影缓存（ctx.sessionProjectionCache）的读取助手。
//
// 这层是「提示」不是「权威」：缓存可能过期但永不超前，所以
//   - title 只认非空字符串，其余一律 null（未知，调用方继续走预热）；
//   - blank 只做单向预筛：false ⇒ 必有内容；true 仍要事件精判；
//   - 服务缺失 / 形状不认识 / 抛异常 → null，行为与 3.8.0 逐字节等同。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cachedTitleOf, hintsFromValues, readCachedHints } from '../src/projection-hints.js'

const HEADER = { id: 's1', version: 4, createdAt: 1000, cwd: '/w', isSeeded: false }

test('hintsFromValues reads title and blank, keeping missing fields null', () => {
  assert.deepEqual(
    hintsFromValues({ title: '标题', sessionListMetadata: { blank: false, lastPromptAt: 5 } }),
    { title: '标题', blank: false, fromPredecessor: false },
  )
  // blank 与 title 各自独立：只有其中一个也算提示。
  assert.deepEqual(hintsFromValues({ sessionListMetadata: { blank: true } }), { title: null, blank: true, fromPredecessor: false })
  assert.deepEqual(hintsFromValues({ title: 'x' }), { title: 'x', blank: null, fromPredecessor: false })
})

test('hintsFromValues never fabricates an answer from junk', () => {
  // 空串 / 非字符串标题 = 未知（不是「真的没有标题」）。
  assert.equal(hintsFromValues({ title: '' }), null)
  assert.equal(hintsFromValues({ title: 42 }), null)
  assert.equal(hintsFromValues({ title: null }), null)
  // 畸形 metadata 不参与判定。
  assert.equal(hintsFromValues({ sessionListMetadata: { blank: 'false' } }), null)
  assert.equal(hintsFromValues({ sessionListMetadata: null }), null)
  assert.equal(hintsFromValues(null), null)
  assert.equal(hintsFromValues(undefined), null)
  assert.equal(hintsFromValues('nope'), null)
})

test('readCachedHints prefers the current lifecycle, then the predecessor title', () => {
  const calls = []
  const cache = {
    cachedSnapshot: (header, keys) => {
      calls.push(['snapshot', header.id, keys])
      return header.id === 'current' ? { asOfSeq: 7, values: { title: '现在', sessionListMetadata: { blank: false } } } : undefined
    },
    cachedPredecessorTitle: (header) => {
      calls.push(['predecessor', header.id])
      return header.id === 'old' ? { asOfSeq: 3, values: { title: '前代标题' } } : undefined
    },
  }
  const registry = { summaryKeys: () => new Set(['title', 'sessionListMetadata']) }

  assert.deepEqual(readCachedHints(cache, registry, { id: 'current' }), { title: '现在', blank: false, fromPredecessor: false })
  // 前代标题只能当标题用：blank 拿不到 ⇒ null ⇒ 仍走精判。
  assert.deepEqual(readCachedHints(cache, registry, { id: 'old' }), { title: '前代标题', blank: null, fromPredecessor: true })
  assert.equal(readCachedHints(cache, registry, { id: 'missing' }), null)
  // 键选择直接透传官方的 summary 集合（同一实例，不复制、不缓存）。
  const keyArg = calls.find((c) => c[0] === 'snapshot' && c[1] === 'current')[2]
  assert.ok(keyArg instanceof Set)
  assert.ok(keyArg.has('sessionListMetadata'))
})

test('readCachedHints degrades to null without the service (0.1.7 / 0.2.0 early)', () => {
  assert.equal(readCachedHints(null, null, HEADER), null)
  assert.equal(readCachedHints(undefined, undefined, HEADER), null)
  assert.equal(readCachedHints({}, null, HEADER), null)
  assert.equal(readCachedHints({ cachedSnapshot: 'not-a-function' }, null, HEADER), null)
  // 没有 header（live-only 会话）也不该炸。
  assert.equal(readCachedHints({ cachedSnapshot: () => ({ asOfSeq: 1, values: { title: 'x' } }) }, null, null), null)
})

test('without summaryKeys the reader asks for a bounded key set, never "all keys"', () => {
  // 0.2.1 一代没有 summaryKeys()：不能传 undefined（那会让官方把每个注册了 wire
  // 的投影都 parse 一遍，可能有整段消息日志）。只问我们要的两个键。
  let seen = null
  const cache = { cachedSnapshot: (header, keys) => { seen = keys; return undefined } }
  readCachedHints(cache, null, HEADER)
  assert.ok(Array.isArray(seen) || seen instanceof Set)
  const set = seen instanceof Set ? seen : new Set(seen)
  assert.deepEqual([...set].sort(), ['sessionListMetadata', 'title'])
})

test('readCachedHints swallows a broken service instead of failing the listing', () => {
  const throwing = {
    cachedSnapshot: () => { throw new Error('boom') },
    cachedPredecessorTitle: () => { throw new Error('boom') },
  }
  assert.equal(readCachedHints(throwing, null, HEADER), null)
  const noPredecessor = { cachedSnapshot: () => undefined }
  assert.equal(readCachedHints(noPredecessor, null, HEADER), null)
})

test('cachedTitleOf returns only a usable title string', () => {
  const cache = {
    cachedSnapshot: () => ({ asOfSeq: 4, values: { title: 'T', sessionListMetadata: { blank: true } } }),
  }
  assert.equal(cachedTitleOf(cache, null, HEADER), 'T')
  assert.equal(cachedTitleOf({ cachedSnapshot: () => ({ asOfSeq: 4, values: { title: '' } }) }, null, HEADER), null)
  assert.equal(cachedTitleOf(null, null, HEADER), null)
})
