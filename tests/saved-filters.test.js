// 保存筛选（schema v1，src/saved-filters.js）的存储层回归。
// 与标签同型：原子写 / 链式串行 / normalize 逐条防御；filters 为不透明 JSON，
// host 只验可序列化性与体积（>2048 字符丢条 / save 拒绝）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createSavedFilters,
  normalizeFilterStore,
  FILTER_SCHEMA_VERSION,
  MAX_FILTERS,
  MAX_FILTER_JSON,
} from '../src/saved-filters.js'

async function tempStore() {
  const dir = await mkdtemp(join(tmpdir(), 'dsm-filters-'))
  return { store: createSavedFilters({ dir }), dir, file: join(dir, 'saved-filters.json') }
}

const payload = { workspaces: ['/ws/a'], tags: ['t_x'], archived: 'any' }

// —— normalize —— //

test('normalizeFilterStore fabricates a valid v1 store from nothing', () => {
  assert.deepEqual(normalizeFilterStore(null), { schemaVersion: FILTER_SCHEMA_VERSION, items: [] })
  assert.deepEqual(normalizeFilterStore({ junk: 1 }), { schemaVersion: FILTER_SCHEMA_VERSION, items: [] })
  assert.deepEqual(normalizeFilterStore([]), { schemaVersion: FILTER_SCHEMA_VERSION, items: [] })
})

test('normalizeFilterStore drops dirty entries one by one', () => {
  const big = 'x'.repeat(MAX_FILTER_JSON + 1)
  const store = normalizeFilterStore({
    items: [
      { id: 'f_a', name: '常用', filters: payload, createdAt: 7 },
      { id: 'f_a', name: '重复 id', filters: payload },
      { id: 42, name: '数字 id', filters: payload },
      { id: 'f_b', name: '  ', filters: payload },          // 空白名 → 丢
      { id: 'f_c', name: '超长大名'.repeat(12), filters: payload }, // >40 码点 → 丢
      { id: 'f_d', name: '常用', filters: payload },        // casefold 同名 → 丢
      { id: 'f_e', name: 'null 载荷', filters: null },       // null 不可辨 → 丢
      { id: 'f_f', name: '缺载荷', createdAt: 1 },              // filters 缺失 → 丢
      { id: 'f_g', name: '超大载荷', filters: big },            // 序列化 >2048 字符 → 丢
      null,
      { id: 'f_h', name: '标量也合法', filters: 42 },            // 不透明 JSON：标量可存
    ],
  })
  assert.deepEqual(store.items.map((i) => i.id), ['f_a', 'f_h'])
  assert.equal(store.items[0].createdAt, 7)
  assert.equal(store.items[1].createdAt, 0) // 缺失 → 0
  assert.deepEqual(store.items[0].filters, payload)
})

test('normalizeFilterStore caps items at MAX_FILTERS', () => {
  const raw = { items: Array.from({ length: MAX_FILTERS + 5 }, (_, i) => ({ id: `f_${i}`, name: `n${i}`, filters: {} })) }
  assert.equal(normalizeFilterStore(raw).items.length, MAX_FILTERS)
})

// —— save / remove —— //

test('save persists an f_-prefixed item with opaque filters', async () => {
  const { store, file } = await tempStore()
  const item = await store.save('  未归档重点  ', payload)
  assert.match(item.id, /^f_[a-z0-9]{8}$/)
  assert.equal(item.name, '未归档重点')
  assert.deepEqual(item.filters, payload)
  const raw = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(raw.schemaVersion, FILTER_SCHEMA_VERSION)
  assert.deepEqual(raw.items, [item])
  // list 与磁盘一致；不透明：字段序/嵌套原样保留。
  assert.deepEqual((await store.list())[0].filters, payload)
})

test('save rejects bad names, bad payloads, duplicates and the global cap', async () => {
  const { store } = await tempStore()
  await store.save('Alpha', payload)
  await assert.rejects(() => store.save('  alpha ', payload), (e) => e.status === 409 && e.code === 'DSM_FILTER_EXISTS')
  await assert.rejects(() => store.save('', payload), (e) => e.status === 400 && e.code === 'DSM_FILTER_NAME_INVALID')
  await assert.rejects(() => store.save('x'.repeat(41), payload), (e) => e.status === 400 && e.code === 'DSM_FILTER_NAME_INVALID')
  await assert.rejects(() => store.save('bad', undefined), (e) => e.status === 400 && e.code === 'DSM_FILTER_INVALID')
  await assert.rejects(() => store.save('bad', null), (e) => e.status === 400 && e.code === 'DSM_FILTER_INVALID')
  // {x: fn} 被 JSON.stringify 静默降级为 {}，属合法不透明载荷；真正非法的是循环引用。
  const okDropped = await store.save('dropped', { x: () => 1 })
  assert.deepEqual(okDropped.filters, {})
  const cyclic = {}; cyclic.self = cyclic
  await assert.rejects(() => store.save('bad', cyclic), (e) => e.status === 400 && e.code === 'DSM_FILTER_INVALID')
  await assert.rejects(() => store.save('big', 'x'.repeat(MAX_FILTER_JSON + 1)), (e) => e.status === 400 && e.code === 'DSM_FILTER_TOO_LARGE')
  for (let i = 0; (await store.list()).length < MAX_FILTERS; i++) await store.save(`n-${i}`, { i })
  await assert.rejects(() => store.save('one too many', payload), (e) => e.status === 409 && e.code === 'DSM_FILTER_LIMIT')
  assert.equal((await store.read()).items.length, MAX_FILTERS)
})

test('remove deletes by id, ignores unknowns, returns the count', async () => {
  const { store } = await tempStore()
  const a = await store.save('A', payload)
  const b = await store.save('B', payload)
  assert.equal(await store.remove([a.id, 'f_ghost']), 1)
  assert.deepEqual((await store.list()).map((i) => i.id), [b.id])
  assert.equal(await store.remove(['nope']), 0)
  assert.equal(await store.remove('not-an-array'), 0)
})

// —— 持久化（同型原子写） —— //

test('a restarted store reuses the same directory', async () => {
  const { store, dir } = await tempStore()
  const a = await store.save('A', payload)
  const reopened = createSavedFilters({ dir })
  assert.deepEqual((await reopened.list()).map((i) => i.id), [a.id])
})

test('atomic write: 0o600, no temp leftovers, corrupt file self-heals', async () => {
  const { store, dir, file } = await tempStore()
  await store.save('A', payload)
  assert.deepEqual(await readdir(dir), ['saved-filters.json'])
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  await writeFile(file, 'not json at all', 'utf8')
  assert.deepEqual(await store.list(), [])
  await store.save('B', payload)
  assert.equal((await store.list()).length, 1)
  assert.deepEqual(await readdir(dir), ['saved-filters.json'])
})

test('concurrent saves are serialized; a failing mutator keeps the chain', async () => {
  const { store } = await tempStore()
  await Promise.all([store.save('a', { n: 1 }), store.save('b', { n: 2 }), store.save('c', { n: 3 })])
  assert.equal((await store.list()).length, 3)
  await store.mutate(() => { throw new Error('boom') }).catch(() => {})
  const d = await store.save('d', { n: 4 })
  assert.ok(d.id)
})

test('dir default comes from DSH_SESSIONS_MANAGER_STAR_DIR (injection point)', () => {
  const saved = process.env.DSH_SESSIONS_MANAGER_STAR_DIR
  process.env.DSH_SESSIONS_MANAGER_STAR_DIR = '/tmp/dsm-filters-env-dir'
  try {
    const store = createSavedFilters()
    assert.equal(store.dir, '/tmp/dsm-filters-env-dir')
    assert.equal(store.indexPath, join('/tmp/dsm-filters-env-dir', 'saved-filters.json'))
  } finally {
    if (saved === undefined) delete process.env.DSH_SESSIONS_MANAGER_STAR_DIR
    else process.env.DSH_SESSIONS_MANAGER_STAR_DIR = saved
  }
})
