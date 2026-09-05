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
})

test('reads the legacy service shape', async () => {
  const adapter = createPersistenceAdapter({
    async list() { return [{ id: 's1' }] },
    async readFrom(id, offset) { return { meta: { id }, inheritedEventCount: 2, events: [{ seq: offset }] } },
  })
  assert.equal(adapter.kind, 'legacy')
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
