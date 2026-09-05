import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTitleIndexStore, mergeEntries, normalizeEntry, normalizeTitleIndex, TITLE_INDEX_SCHEMA_VERSION } from '../src/title-persist-index.js'

const ENTRY = { title: 'T', cwd: '/w', createdAt: 1, fingerprint: '100:5', updatedAt: 10 }

test('normalizeEntry keeps only usable, serializable fields', () => {
  assert.deepEqual(normalizeEntry(ENTRY), ENTRY)
  assert.equal(normalizeEntry(null), null)
  assert.equal(normalizeEntry({}), null)
  // 无指纹的条目无法失效，绝不能收
  assert.equal(normalizeEntry({ title: 'T', cwd: '/w' }), null)
  // 既无标题也无工作区的条目没有价值
  assert.equal(normalizeEntry({ fingerprint: '1:1' }), null)
  assert.equal(normalizeEntry({ title: 'T', fingerprint: '1:1' }).title, 'T')
})

test('normalizeTitleIndex survives garbage input', () => {
  for (const junk of [null, undefined, 42, 'x', {}, { entries: 'nope' }]) {
    const out = normalizeTitleIndex(junk)
    assert.equal(out.schemaVersion, TITLE_INDEX_SCHEMA_VERSION)
    assert.deepEqual(out.entries, {})
  }
  // 合法条目保留，非法条目（'junk'）丢弃。
  const out = normalizeTitleIndex({ entries: { a: 'junk', b: ENTRY } })
  assert.equal(out.entries.b.fingerprint, '100:5')
  assert.equal('a' in out.entries, false)
})

test('mergeEntries overlays right over left and caps size keeping newest', () => {
  const merged = mergeEntries({ a: { ...ENTRY, title: 'old' } }, { a: { ...ENTRY, title: 'new' }, b: { ...ENTRY } })
  assert.equal(merged.a.title, 'new')
  assert.equal(merged.b.title, 'T')

  const many = {}
  for (let i = 0; i < 20005; i++) many['s' + i] = { ...ENTRY, updatedAt: i }
  const capped = mergeEntries({}, many)
  assert.equal(Object.keys(capped).length, 20000)
  // 最旧的 5 条被淘汰
  for (let i = 0; i < 5; i++) assert.equal(('s' + i) in capped, false)
  assert.equal('s20004' in capped, true)
})

test('store round-trips merge and remove with atomic writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsm-title-'))
  try {
    const store = createTitleIndexStore({ dir, file: join(dir, 'title-index.json') })
    // 空索引：不抛错
    assert.deepEqual(await store.entries(), {})

    await store.merge({ s1: { ...ENTRY, title: 'first' } })
    const onDisk = JSON.parse(await readFile(join(dir, 'title-index.json'), 'utf8'))
    assert.equal(onDisk.schemaVersion, TITLE_INDEX_SCHEMA_VERSION)
    assert.equal(onDisk.entries.s1.title, 'first')

    // 第二个实例（模拟重启）读到同一份
    const reloaded = createTitleIndexStore({ dir, file: join(dir, 'title-index.json') })
    assert.equal((await reloaded.entries()).s1.title, 'first')

    await reloaded.merge({ s1: { ...ENTRY, title: 'second' }, s2: { ...ENTRY } })
    // store 是单实例内存缓存（一个进程一个插件实例）；跨实例以落盘内容为准。
    const onDisk2 = JSON.parse(await readFile(join(dir, 'title-index.json'), 'utf8'))
    assert.equal(onDisk2.entries.s1.title, 'second')
    assert.equal(onDisk2.entries.s2.fingerprint, '100:5')

    await reloaded.remove(['s1', 'missing'])
    const finalOnDisk = JSON.parse(await readFile(join(dir, 'title-index.json'), 'utf8'))
    assert.equal('s1' in finalOnDisk.entries, false)
    assert.equal('s2' in finalOnDisk.entries, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('store serializes concurrent merges without losing entries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsm-title-race-'))
  try {
    const store = createTitleIndexStore({ dir, file: join(dir, 'title-index.json') })
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.merge({ ['s' + i]: { ...ENTRY, title: 't' + i } })))
    const entries = await store.entries()
    assert.equal(Object.keys(entries).length, 20)
    const onDisk = JSON.parse(await readFile(join(dir, 'title-index.json'), 'utf8'))
    assert.equal(Object.keys(onDisk.entries).length, 20)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
