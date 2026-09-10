// 待移动队列（活跃会话排队移动）的存储层回归。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createPendingMoveStore, normalizeStore, MAX_ITEMS } from '../src/pending-moves.js'

async function freshStore() {
  const dir = await mkdtemp(join(tmpdir(), 'dsm-pending-'))
  return { store: createPendingMoveStore({ dir }), dir }
}

test('queues, dedupes and lists pending moves', async () => {
  const { store } = await freshStore()
  assert.deepEqual(await store.list(), [])

  await store.queue('s-1', '/ws/a')
  await store.queue('s-2', '/ws/a')
  let items = await store.list()
  assert.equal(items.length, 2)
  assert.equal(items[0].sessionId, 's-1')
  assert.equal(items[0].attempts, 0)
  assert.equal(await store.has('s-1'), true)

  // 同一会话重复排队 = 更新目标路径并重置尝试计数（不产生第二条）。
  await store.queue('s-1', '/ws/b')
  items = await store.list()
  assert.equal(items.length, 2)
  assert.equal(items.find((i) => i.sessionId === 's-1').targetPath, '/ws/b')

  assert.equal(await store.remove(['s-1', 'nope']), 1)
  assert.deepEqual((await store.list()).map((i) => i.sessionId), ['s-2'])
})

test('rejects malformed entries and caps the queue', async () => {
  const normalized = normalizeStore({
    items: [
      { sessionId: 'ok', targetPath: '/w' },
      { sessionId: '', targetPath: '/w' },
      { sessionId: 'no-target' },
      null,
      { sessionId: 'ok', targetPath: '/w2' }, // 重复 id → 丢弃
    ],
  })
  assert.deepEqual(normalized.items.map((i) => i.sessionId), ['ok'])

  const store = createPendingMoveStore({ dir: await mkdtemp(join(tmpdir(), 'dsm-pending-cap-')) })
  for (let i = 0; i < MAX_ITEMS + 5; i++) await store.queue(`s-${i}`, '/w')
  const items = await store.list()
  assert.equal(items.length, MAX_ITEMS)
  assert.equal(items[items.length - 1].sessionId, `s-${MAX_ITEMS + 4}`)
})

test('bumpAttempts drops an item that keeps failing', async () => {
  const { store } = await freshStore()
  await store.queue('s-x', '/w')
  const results = []
  for (let i = 0; i < 5; i++) results.push(await store.bumpAttempts('s-x'))
  assert.deepEqual(results.slice(0, 4).map((r) => r.dropped), [false, false, false, false])
  assert.equal(results[4].dropped, true)
  assert.deepEqual(await store.list(), [])
  // 已丢弃的 id 再记账 → null（调用方据此不再重试）
  assert.equal(await store.bumpAttempts('s-x'), null)
})

test('persisted file is a versioned document', async () => {
  const { store, dir } = await freshStore()
  await store.queue('s-1', '/ws/a')
  const raw = JSON.parse(await readFile(join(dir, 'pending-moves.json'), 'utf8'))
  assert.equal(raw.schemaVersion, 1)
  assert.equal(raw.items.length, 1)
  assert.equal(raw.items[0].sessionId, 's-1')
})
