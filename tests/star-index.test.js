import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStarIndex, normalizeStarStore, STAR_SCHEMA_VERSION } from '../src/star-index.js'

async function tempIndex() {
  const dir = await mkdtemp(join(tmpdir(), 'dsm-star-'))
  return { index: createStarIndex({ dir }), dir, file: join(dir, 'star.json') }
}

test('normalizeStarStore fabricates a valid store from nothing', () => {
  assert.deepEqual(normalizeStarStore(null), { schemaVersion: STAR_SCHEMA_VERSION, starredSessionIds: [] })
  assert.deepEqual(normalizeStarStore(undefined), { schemaVersion: STAR_SCHEMA_VERSION, starredSessionIds: [] })
  assert.deepEqual(normalizeStarStore({ junk: 1 }), { schemaVersion: STAR_SCHEMA_VERSION, starredSessionIds: [] })
})

test('normalizeStarStore upgrades a legacy bare array', () => {
  const store = normalizeStarStore(['a', 'b'])
  assert.equal(store.schemaVersion, STAR_SCHEMA_VERSION)
  assert.deepEqual(store.starredSessionIds, ['a', 'b'])
})

test('normalizeStarStore drops duplicates and unsafe ids', () => {
  const store = normalizeStarStore({
    schemaVersion: 1,
    starredSessionIds: ['a', 'a', 'b/../../etc', '', null, 42, '.', '..', 'c'],
  })
  assert.deepEqual(store.starredSessionIds, ['a', 'c'])
})

test('read returns an empty store when the file is absent', async () => {
  const { index } = await tempIndex()
  assert.deepEqual(await index.read(), { schemaVersion: STAR_SCHEMA_VERSION, starredSessionIds: [] })
})

test('write then read round-trips', async () => {
  const { index } = await tempIndex()
  await index.setStarred(['s1', 's2'], true)
  assert.deepEqual((await index.read()).starredSessionIds.sort(), ['s1', 's2'])
})

test('setStarred(false) unstars', async () => {
  const { index } = await tempIndex()
  await index.setStarred(['s1', 's2'], true)
  await index.setStarred(['s1'], false)
  assert.deepEqual((await index.read()).starredSessionIds, ['s2'])
})

test('removeIds drops ids of gone sessions', async () => {
  const { index } = await tempIndex()
  await index.setStarred(['keep', 'gone'], true)
  await index.removeIds(['gone'])
  assert.deepEqual((await index.read()).starredSessionIds, ['keep'])
})

test('atomic write leaves no temp files behind', async () => {
  const { index, dir } = await tempIndex()
  await index.setStarred(['s1'], true)
  const entries = await readdir(dir)
  assert.deepEqual(entries, ['star.json'])
})

test('on-disk document carries the schema version', async () => {
  const { index, file } = await tempIndex()
  await index.setStarred(['s1'], true)
  const raw = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(raw.schemaVersion, STAR_SCHEMA_VERSION)
  assert.deepEqual(raw.starredSessionIds, ['s1'])
})

test('concurrent mutations are serialized, none lost', async () => {
  const { index } = await tempIndex()
  await Promise.all([
    index.setStarred(['a'], true),
    index.setStarred(['b'], true),
    index.setStarred(['c'], true),
  ])
  assert.deepEqual((await index.read()).starredSessionIds.sort(), ['a', 'b', 'c'])
})

test('a failing mutator does not break the chain', async () => {
  const { index } = await tempIndex()
  await index.mutate(() => { throw new Error('boom') }).catch(() => {})
  await index.setStarred(['after'], true)
  assert.deepEqual((await index.read()).starredSessionIds, ['after'])
})

test('a corrupt file is repaired on the next write', async () => {
  const { index, file, dir } = await tempIndex()
  const { writeFile } = await import('node:fs/promises')
  await writeFile(file, '{ this is not json', 'utf8')
  assert.deepEqual((await index.read()).starredSessionIds, [])
  await index.setStarred(['s1'], true)
  assert.deepEqual((await index.read()).starredSessionIds, ['s1'])
  assert.deepEqual(await readdir(dir), ['star.json'])
})
