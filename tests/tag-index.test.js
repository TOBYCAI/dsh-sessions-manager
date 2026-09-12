// 标签索引（schema v4，src/tag-index.js）的存储层回归。
// 严格对齐 tests/star-index.test.js 的覆盖面，外加标签特有的：
// 名称上限/casefold 去重、全局 200 / 单会话 10 上限、merge、
// removeTag 只动元数据不碰会话、悬空 assignment 丢弃、原子写权限。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createTagIndex,
  normalizeTagStore,
  normalizeTagName,
  TAG_SCHEMA_VERSION,
  MAX_TAGS,
  MAX_TAGS_PER_SESSION,
} from '../src/tag-index.js'

async function tempIndex() {
  const dir = await mkdtemp(join(tmpdir(), 'dsm-tags-'))
  return { index: createTagIndex({ dir }), dir, file: join(dir, 'tags.json') }
}

// —— normalize：脏数据逐条丢弃，绝不猜 —— //

test('normalizeTagStore fabricates a valid v4 store from nothing', () => {
  assert.deepEqual(normalizeTagStore(null), { schemaVersion: TAG_SCHEMA_VERSION, tags: [], assignments: {} })
  assert.deepEqual(normalizeTagStore(undefined), { schemaVersion: TAG_SCHEMA_VERSION, tags: [], assignments: {} })
  assert.deepEqual(normalizeTagStore('junk'), { schemaVersion: TAG_SCHEMA_VERSION, tags: [], assignments: {} })
  assert.deepEqual(normalizeTagStore([]), { schemaVersion: TAG_SCHEMA_VERSION, tags: [], assignments: {} })
})

test('normalizeTagStore drops dirty tag entries but keeps the healthy ones', () => {
  const store = normalizeTagStore({
    tags: [
      { id: 't_a1', name: '重要', createdAt: 5 },
      { id: 't_a1', name: '重复 id', createdAt: 6 }, // 同 id → 丢
      { id: 42, name: '数字 id', createdAt: 7 },     // 非字符串 id → 丢
      { id: 't/../evil', name: '路径 id', createdAt: 8 },
      { id: 't_a2', name: '  ', createdAt: 9 },      // 空白名 → 丢
      { id: 't_a3', name: 'x'.repeat(25), createdAt: 10 }, // 超长名（>24 码点）→ 丢
      { id: 't_a4', name: '重要', createdAt: 11 },   // casefold 同名 → 丢
      { id: 't_a5', name: '待办', createdAt: 12 },
      null,
      { id: 't_a6', name: 'Alpha' },                 // createdAt 缺失 → 0
      { id: 't_a7', name: 'alpha' },                 // 与 Alpha casefold 撞名 → 丢
    ],
  })
  assert.deepEqual(store.tags.map((t) => [t.id, t.name]), [['t_a1', '重要'], ['t_a5', '待办'], ['t_a6', 'Alpha']])
  assert.equal(store.tags[0].createdAt, 5)
  assert.equal(store.tags[2].createdAt, 0)
})

test('normalizeTagStore trims names and counts code points, not UTF-16 units', () => {
  // 24 码点（代理对按 1 字符）恰好合法；25 码点非法。
  const ok = '😀'.repeat(24)
  assert.equal(normalizeTagName(`  ${ok}  `), ok)
  assert.equal(normalizeTagName('😀'.repeat(25)), null)
  assert.equal(normalizeTagName('a/b'), null)
  assert.equal(normalizeTagName('a\u0000b'), null)
})

test('normalizeTagStore drops dangling assignment entries and over-cap tails', () => {
  const store = normalizeTagStore({
    tags: [{ id: 't_a', name: 'A' }, { id: 't_b', name: 'B' }],
    assignments: {
      's-1': ['t_a', 't_ghost', 't_a', 't_b'], // 悬空 + 重复 → 清洗
      's/..': ['t_a'],                          // 不安全会话 id → 丢
      '': ['t_a'],                              // 空 id → 丢
      's-2': 't_a',                             // 非数组 → 丢
      's-3': ['t_ghost'],                       // 全悬空 → 键整个消失
      's-4': Array.from({ length: 30 }, (_, i) => (i < 2 ? 't_a' : `t_x${i}`)), // 前 2 合法
    },
  })
  assert.deepEqual(store.assignments['s-1'], ['t_a', 't_b'])
  assert.equal('s/..' in store.assignments, false)
  assert.equal('' in store.assignments, false)
  assert.equal('s-2' in store.assignments, false)
  assert.equal('s-3' in store.assignments, false)
  assert.deepEqual(store.assignments['s-4'], ['t_a'])
})

test('normalizeTagStore caps the tag list at MAX_TAGS', () => {
  const raw = { tags: Array.from({ length: MAX_TAGS + 10 }, (_, i) => ({ id: `t_${i}`, name: `tag${i}` })) }
  assert.equal(normalizeTagStore(raw).tags.length, MAX_TAGS)
})

// —— CRUD 语义 —— //

test('create mints t_-prefixed 8-char lowercase ids and persists them', async () => {
  const { index, file } = await tempIndex()
  const tag = await index.create('  重要  ')
  assert.match(tag.id, /^t_[a-z0-9]{8}$/)
  assert.equal(tag.name, '重要')
  assert.ok(Number.isInteger(tag.createdAt) && tag.createdAt > 0)
  const raw = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(raw.schemaVersion, TAG_SCHEMA_VERSION)
  assert.deepEqual(raw.tags, [tag])
  assert.deepEqual(raw.assignments, {})
})

test('create rejects duplicates casefold-insensitively, and caps globally', async () => {
  const { index } = await tempIndex()
  await index.create('Alpha')
  await assert.rejects(() => index.create('  alpha '), (e) => e.status === 409 && e.code === 'DSM_TAG_EXISTS')
  await assert.rejects(() => index.create(''), (e) => e.status === 400 && e.code === 'DSM_TAG_NAME_INVALID')
  await assert.rejects(() => index.create('x'.repeat(25)), (e) => e.status === 400 && e.code === 'DSM_TAG_NAME_INVALID')
  for (let i = 0; i < MAX_TAGS - 1; i++) await index.create(`tag-${i}`)
  await assert.rejects(() => index.create('one too many'), (e) => e.status === 409 && e.code === 'DSM_TAG_LIMIT')
  assert.equal((await index.read()).tags.length, MAX_TAGS)
})

test('rename keeps ids stable, rejects collisions with OTHER tags; case-only rename is legal', async () => {
  const { index } = await tempIndex()
  const a = await index.create('Alpha')
  const b = await index.create('Beta')
  const renamed = await index.rename(a.id, 'ALPHA')
  assert.equal(renamed.id, a.id, 'id 永不复用/永不改变 → assignments 零改动')
  assert.equal(renamed.name, 'ALPHA')
  await assert.rejects(() => index.rename(a.id, ' beta '), (e) => e.status === 409 && e.code === 'DSM_TAG_EXISTS')
  await assert.rejects(() => index.rename('t_missing', 'x'), (e) => e.status === 404 && e.code === 'DSM_TAG_NOT_FOUND')
  // rename 不触碰 assignments 结构：会话侧引用原样。
  await index.setTags('s-1', [a.id])
  await index.rename(b.id, 'Gamma')
  assert.deepEqual((await index.read()).assignments['s-1'], [a.id])
})

test('merge folds source into target: deduped, source gone, cap truncates overflow', async () => {
  const { index } = await tempIndex()
  const ids = []
  for (let i = 0; i < MAX_TAGS_PER_SESSION + 1; i++) ids.push((await index.create(`m-${i}`)).id)
  const [src, dst] = ids
  const rest = ids.slice(2) // 9 个：src 换成 dst 后恰好 10（slice 上限分支是纯防御，merge 本身去一补一永不超）
  await index.setTags('s-1', rest.concat(src))
  await index.setTags('s-2', [src])
  await index.merge(src, dst)
  const store = await index.read()
  assert.equal(store.tags.some((t) => t.id === src), false)
  assert.ok(store.tags.some((t) => t.id === dst))
  // s-1: 原有 src 换成 dst，去重后仍 ≤10。
  const s1 = store.assignments['s-1']
  assert.equal(s1.includes(src), false)
  assert.equal(s1.includes(dst), true)
  assert.ok(s1.length <= MAX_TAGS_PER_SESSION)
  // s-2: 只剩 dst。
  assert.deepEqual(store.assignments['s-2'], [dst])
})

test('merge rejects unknown ids and self-merge', async () => {
  const { index } = await tempIndex()
  const a = await index.create('A')
  await assert.rejects(() => index.merge(a.id, 't_missing'), (e) => e.status === 404 && e.code === 'DSM_TAG_NOT_FOUND')
  await assert.rejects(() => index.merge(a.id, a.id), (e) => e.status === 400 && e.code === 'DSM_TAG_INVALID')
})

test('removeTag deletes the definition + every assignment row, never a session', async () => {
  const { index } = await tempIndex()
  const a = await index.create('A')
  const b = await index.create('B')
  await index.setTags('s-1', [a.id, b.id])
  await index.setTags('s-2', [a.id])
  await index.removeTag(a.id)
  const store = await index.read()
  assert.deepEqual(store.tags.map((t) => t.id), [b.id])
  assert.deepEqual(store.assignments['s-1'], [b.id], '只从行里摘掉 a，其余保留')
  assert.equal('s-2' in store.assignments, false, '空行整个删除')
  // store 的形状本身就是"绝不触碰会话"的证据：文档里只有标签数据。
  assert.deepEqual(Object.keys(store).sort(), ['assignments', 'schemaVersion', 'tags'])
  // 幂等：再删一次（含未知 id）不炸。
  await index.removeTag(a.id)
  await index.removeTag('t_whatever')
  assert.equal((await index.read()).tags.length, 1)
})

test('setTags replaces the full set; unknown ids and unsafe session rejected', async () => {
  const { index } = await tempIndex()
  const a = await index.create('A')
  const b = await index.create('B')
  const all = await index.setTags('s-1', [a.id, b.id, a.id])
  assert.deepEqual(all['s-1'], [a.id, b.id])
  assert.deepEqual(await index.setTags('s-1', []), {})
  await assert.rejects(() => index.setTags('s-1', ['t_ghost']), (e) => e.status === 400 && e.code === 'DSM_TAG_UNKNOWN')
  await assert.rejects(() => index.setTags('s-1', 42), (e) => e.status === 400 && e.code === 'DSM_TAG_IDS_INVALID')
  await assert.rejects(() => index.setTags('s-1', [123]), (e) => e.status === 400 && e.code === 'DSM_TAG_UNKNOWN')
  await assert.rejects(() => index.setTags('../escape', [a.id]), (e) => e.status === 400 && e.code === 'DSM_TAG_SESSION_INVALID')
  const many = []
  for (let i = 0; i < MAX_TAGS_PER_SESSION + 2; i++) many.push((await index.create(`cap-${i}`)).id)
  await assert.rejects(() => index.setTags('s-1', many.slice(0, MAX_TAGS_PER_SESSION + 1)), (e) => e.status === 409 && e.code === 'DSM_TAG_LIMIT')
})

test('removeIds drops rows for gone sessions only', async () => {
  const { index } = await tempIndex()
  const a = await index.create('A')
  await index.setTags('keep', [a.id])
  await index.setTags('gone', [a.id])
  await index.removeIds(['gone', 'also-gone'])
  assert.deepEqual(Object.keys((await index.read()).assignments), ['keep'])
})

test('list returns exactly {tags, assignments}', async () => {
  const { index } = await tempIndex()
  const a = await index.create('A')
  await index.setTags('s-1', [a.id])
  const out = await index.list()
  assert.deepEqual(Object.keys(out).sort(), ['assignments', 'tags'])
  assert.deepEqual(out.assignments['s-1'], [a.id])
})

// —— 持久化（与 star-index 同型的原子写） —— //

test('a restarted index reuses the same directory', async () => {
  const { index, dir } = await tempIndex()
  const a = await index.create('A')
  await index.setTags('s-1', [a.id])
  const reopened = createTagIndex({ dir })
  const store = await reopened.read()
  assert.deepEqual(store.tags.map((t) => t.id), [a.id])
  assert.deepEqual(store.assignments['s-1'], [a.id])
})

test('atomic write: 0o600 mode, no temp leftovers, corrupt file self-heals', async () => {
  const { index, dir, file } = await tempIndex()
  await index.create('A')
  assert.deepEqual(await readdir(dir), ['tags.json'])
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  await writeFile(file, '{ this is not json', 'utf8')
  assert.deepEqual((await index.read()).tags, [])
  await index.create('B')
  assert.equal((await index.read()).tags.length, 1)
  assert.deepEqual(await readdir(dir), ['tags.json'])
})

test('concurrent mutations are serialized; a failing mutator keeps the chain', async () => {
  const { index } = await tempIndex()
  await Promise.all([index.create('a'), index.create('b'), index.setTags('s', []).catch(() => {})])
  assert.equal((await index.read()).tags.length, 2)
  await index.mutate(() => { throw new Error('boom') }).catch(() => {})
  const c = await index.create('c')
  assert.ok(c.id)
})

test('dir default comes from DSH_SESSIONS_MANAGER_STAR_DIR (injection point)', () => {
  const saved = process.env.DSH_SESSIONS_MANAGER_STAR_DIR
  process.env.DSH_SESSIONS_MANAGER_STAR_DIR = '/tmp/dsm-tags-env-dir'
  try {
    const index = createTagIndex()
    assert.equal(index.dir, '/tmp/dsm-tags-env-dir')
    assert.equal(index.indexPath, join('/tmp/dsm-tags-env-dir', 'tags.json'))
  } finally {
    if (saved === undefined) delete process.env.DSH_SESSIONS_MANAGER_STAR_DIR
    else process.env.DSH_SESSIONS_MANAGER_STAR_DIR = saved
  }
})
