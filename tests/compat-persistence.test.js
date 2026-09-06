import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPersistenceAdapter, normalizePersistenceList } from '../src/compat/persistence.js'

test('normalizes legacy headers and handle-era snapshots', () => {
  const legacy = { id: 'old', cwd: '/old' }
  const header = { id: 'new', cwd: '/new' }
  const entries = normalizePersistenceList([
    legacy,
    { header, revision: 'r1', sizeBytes: 42, eventCount: 3 },
    null,
    {},
  ])
  assert.deepEqual(entries.map((entry) => entry.id), ['old', 'new'])
  assert.equal(entries[0].header, legacy)
  assert.equal(entries[0].snapshot, null)
  assert.equal(entries[1].header, header)
  assert.equal(entries[1].sizeBytes, 42)
  assert.equal(entries[1].eventCount, 3)
  assert.equal(entries[1].revision, 'r1')
})

test('snapshot without a revision normalizes to a null revision', () => {
  const entries = normalizePersistenceList([{ header: { id: 'x' }, sizeBytes: 10 }])
  assert.equal(entries[0].revision, null)
})

test('reads the legacy service shape', async () => {
  const adapter = createPersistenceAdapter({
    async list() { return [{ id: 's1' }] },
    async readFrom(id, offset) { return { meta: { id }, inheritedEventCount: 2, events: [{ seq: offset }] } },
  })
  assert.equal(adapter.kind, 'legacy')
  assert.equal(adapter.hasStat, false)
  assert.deepEqual(await adapter.readSession('s1', 4), {
    meta: { id: 's1' }, inheritedEventCount: 2, events: [{ seq: 4 }],
  })
})

test('reads and always closes a SessionHandle', async () => {
  let closed = 0
  const adapter = createPersistenceAdapter({
    async list() { return [] },
    async open(id, access) {
      assert.equal(access, 'read')
      return {
        header: { id }, inheritedEventCount: 7,
        async read(offset) { return [{ seq: offset }] },
        async close() { closed++ },
      }
    },
  })
  assert.equal(adapter.kind, 'session-handle')
  assert.deepEqual(await adapter.readSession('s2', 5), {
    meta: { id: 's2' }, inheritedEventCount: 7, events: [{ seq: 5 }],
  })
  assert.equal(closed, 1)
})

test('closes a SessionHandle when reading fails', async () => {
  let closed = 0
  const adapter = createPersistenceAdapter({
    async list() { return [] },
    async open() {
      return { async read() { throw new Error('broken') }, async close() { closed++ } }
    },
  })
  await assert.rejects(adapter.readSession('s3'), /broken/)
  assert.equal(closed, 1)
})

// ---- 有界 / 分段读取（SessionHandle.read(offset, length)）------------------

function chunkedHandle({ events, chunkSize, closed, failOn }) {
  return {
    header: { id: 'big' },
    inheritedEventCount: 0,
    async read(offset, length) {
      if (failOn && offset >= failOn) throw new Error('mid-chunk failure')
      return events.slice(offset, offset + (length ?? chunkSize))
    },
    async close() { closed.count++ },
  }
}

test('inspectSession folds a large log in bounded chunks and closes once', async () => {
  const closed = { count: 0 }
  const events = Array.from({ length: 7 }, (_, i) => ({ seq: i }))
  const calls = []
  const adapter = createPersistenceAdapter({
    async list() { return [] },
    async open() {
      return {
        header: { id: 'big' }, inheritedEventCount: 0,
        async read(offset, length) { calls.push([offset, length]); return events.slice(offset, offset + length) },
        async close() { closed.count++ },
      }
    },
  })
  const batches = []
  const summary = await adapter.inspectSession('big', {
    chunkSize: 3,
    onEvents: (batch, info) => batches.push({ batch, info }),
  })
  // 官方契约：read 返回「至多 length」；短读意味着已到日志末尾，无需再发空尾读。
  assert.deepEqual(calls, [[0, 3], [3, 3], [6, 3]], 'reads advance by offset+length and stop at the short tail')
  assert.equal(summary.eventCount, 7)
  assert.equal(summary.meta.id, 'big')
  assert.equal(closed.count, 1)
  assert.deepEqual(batches.map((b) => b.batch.length), [3, 3, 1])
  assert.deepEqual(batches.map((b) => b.info.offset), [0, 3, 6])
})

test('inspectSession closes the handle when a mid-stream chunk fails', async () => {
  const closed = { count: 0 }
  const events = Array.from({ length: 10 }, (_, i) => ({ seq: i }))
  const adapter = createPersistenceAdapter({
    async list() { return [] },
    async open() { return chunkedHandle({ events, closed, failOn: 4 }) },
  })
  await assert.rejects(adapter.inspectSession('big', { chunkSize: 2 }), /mid-chunk failure/)
  assert.equal(closed.count, 1)
})

test('inspectSession honors an AbortSignal and still closes the handle', async () => {
  const closed = { count: 0 }
  const events = Array.from({ length: 10 }, (_, i) => ({ seq: i }))
  const adapter = createPersistenceAdapter({
    async list() { return [] },
    async open() { return chunkedHandle({ events, closed }) },
  })
  // 预先取消：open 之前就该拒绝，handle 根本不被打开
  const preAborted = new AbortController()
  preAborted.abort()
  await assert.rejects(adapter.inspectSession('big', { chunkSize: 2, signal: preAborted.signal }), (e) => e.code === 'DSM_READ_ABORTED')

  // 流中途取消：onEvents 里 abort，下一块前停止
  const ac = new AbortController()
  let closedCount = 0
  const adapter2 = createPersistenceAdapter({
    async list() { return [] },
    async open() {
      return {
        header: { id: 'big' }, inheritedEventCount: 0,
        async read(offset, length) { return events.slice(offset, offset + length) },
        async close() { closedCount++ },
      }
    },
  })
  await assert.rejects(adapter2.inspectSession('big', {
    chunkSize: 2,
    signal: ac.signal,
    onEvents: (batch, info) => { if (info.offset >= 4) ac.abort() },
  }), (e) => e.code === 'DSM_READ_ABORTED')
  assert.equal(closedCount, 1, 'mid-stream abort must still close the handle')
  assert.equal(closed.count, 0, 'pre-aborted run never opened a handle')
})

test('inspectSession normalizes iterable (non-array) read results', async () => {
  let closed = 0
  const adapter = createPersistenceAdapter({
    async list() { return [] },
    async open() {
      return {
        header: { id: 'it' }, inheritedEventCount: 0,
        async read(offset, length) { return offset === 0 ? new Set([{ seq: 0 }]).values() : [] },
        async close() { closed++ },
      }
    },
  })
  const summary = await adapter.inspectSession('it', { chunkSize: 1 })
  assert.equal(summary.eventCount, 1)
  assert.equal(closed, 1)
})

test('readSession on handle-era service still returns the complete list', async () => {
  const events = Array.from({ length: 5 }, (_, i) => ({ seq: i }))
  const adapter = createPersistenceAdapter({
    async list() { return [] },
    async open() {
      return {
        header: { id: 'full' }, inheritedEventCount: 3,
        async read(offset, length) { return events.slice(offset, offset + length) },
        async close() {},
      }
    },
  })
  const r = await adapter.readSession('full', 0)
  assert.deepEqual(r.events, events)
  assert.equal(r.inheritedEventCount, 3)
})

test('statSession exposes the official lightweight observation', async () => {
  const snapshot = { header: { id: 'a', cwd: '/w' }, revision: 'r9', sizeBytes: 11, eventCount: 2 }
  const withStat = createPersistenceAdapter({ list: async () => [], stat: async (id) => id === 'a' ? snapshot : undefined })
  assert.deepEqual(await withStat.statSession('a'), normalizePersistenceList([snapshot])[0])
  assert.equal(await withStat.statSession('ghost'), null)
  const withoutStat = createPersistenceAdapter({ list: async () => [] })
  assert.equal(await withoutStat.statSession('a'), null)
})

test('rejects an invalid handle and closes what it got', async () => {
  let closed = 0
  const adapter = createPersistenceAdapter({
    async list() { return [] },
    async open() { return { header: { id: 'x' }, async close() { closed++ } } }, // no read
  })
  await assert.rejects(adapter.inspectSession('x'), /无效的 SessionHandle/)
  assert.equal(closed, 1)
})
