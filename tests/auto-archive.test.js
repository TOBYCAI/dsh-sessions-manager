import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AUTO_ARCHIVE_SCHEMA_VERSION,
  INACTIVE_DAY_OPTIONS,
  RUN_INTERVAL_MS,
  createAutoArchiveStore,
  normalizeAutoArchiveStore,
  pickInactiveCandidates,
} from '../src/auto-archive.js'

const DAY = 86400000
const NOW = 1_800_000_000_000

async function tempStore() {
  const dir = await mkdtemp(join(tmpdir(), 'dsm-autoarchive-'))
  return { store: createAutoArchiveStore({ dir }), dir, file: join(dir, 'auto-archive.json') }
}

function session(sessionId, updatedAt, extra = {}) {
  return { sessionId, updatedAt, archived: false, starred: false, ...extra }
}

// ---- normalizeAutoArchiveStore -------------------------------------------

test('normalizeAutoArchiveStore defaults to disabled and star-safe', () => {
  for (const raw of [null, undefined, {}, [], 'junk', 42]) {
    const store = normalizeAutoArchiveStore(raw)
    assert.equal(store.schemaVersion, AUTO_ARCHIVE_SCHEMA_VERSION)
    assert.deepEqual(store.settings, { inactiveDays: 0, skipStarred: true })
    assert.equal(store.lastRunAt, null)
    assert.equal(store.lastArchivedCount, 0)
  }
})

test('normalizeAutoArchiveStore rejects day values outside the whitelist', () => {
  for (const days of [1, 7, -30, 365, '30', null, NaN, Infinity]) {
    assert.equal(normalizeAutoArchiveStore({ settings: { inactiveDays: days } }).settings.inactiveDays, 0)
  }
  for (const days of INACTIVE_DAY_OPTIONS) {
    assert.equal(normalizeAutoArchiveStore({ settings: { inactiveDays: days } }).settings.inactiveDays, days)
  }
})

test('normalizeAutoArchiveStore keeps skipStarred=false but defaults it to true', () => {
  assert.equal(normalizeAutoArchiveStore({ settings: { skipStarred: false } }).settings.skipStarred, false)
  assert.equal(normalizeAutoArchiveStore({ settings: {} }).settings.skipStarred, true)
})

test('normalizeAutoArchiveStore scrubs junk run bookkeeping', () => {
  const store = normalizeAutoArchiveStore({ lastRunAt: 'yesterday', lastArchivedCount: -5 })
  assert.equal(store.lastRunAt, null)
  assert.equal(store.lastArchivedCount, 0)
})

// ---- pickInactiveCandidates ----------------------------------------------

test('pickInactiveCandidates archives sessions idle past the window', () => {
  const items = [
    session('old', NOW - 40 * DAY),
    session('recent', NOW - 5 * DAY),
  ]
  const picked = pickInactiveCandidates(items, { inactiveDays: 30, now: NOW })
  assert.deepEqual(picked, ['old'])
})

test('pickInactiveCandidates returns nothing when disabled', () => {
  const items = [session('old', NOW - 400 * DAY)]
  assert.deepEqual(pickInactiveCandidates(items, { inactiveDays: 0, now: NOW }), [])
  assert.deepEqual(pickInactiveCandidates(items, { now: NOW }), [])
  // Values outside the whitelist can never schedule a sweep.
  assert.deepEqual(pickInactiveCandidates(items, { inactiveDays: 1, now: NOW }), [])
})

test('pickInactiveCandidates treats the window as strictly older-than', () => {
  // Exactly on the cutoff is still "inside the window" → keep it.
  const items = [session('edge', NOW - 30 * DAY)]
  assert.deepEqual(pickInactiveCandidates(items, { inactiveDays: 30, now: NOW }), [])
  assert.deepEqual(pickInactiveCandidates([session('edge', NOW - 30 * DAY - 1)], { inactiveDays: 30, now: NOW }), ['edge'])
})

test('pickInactiveCandidates skips already-archived sessions', () => {
  const items = [session('a', NOW - 90 * DAY, { archived: true }), session('b', NOW - 90 * DAY)]
  assert.deepEqual(pickInactiveCandidates(items, { inactiveDays: 30, now: NOW }), ['b'])
})

test('pickInactiveCandidates protects starred sessions by default', () => {
  const items = [session('star', NOW - 90 * DAY, { starred: true }), session('plain', NOW - 90 * DAY)]
  assert.deepEqual(pickInactiveCandidates(items, { inactiveDays: 30, now: NOW }), ['plain'])
  // Opting out lets stars be swept too.
  assert.deepEqual(
    pickInactiveCandidates(items, { inactiveDays: 30, skipStarred: false, now: NOW }).sort(),
    ['plain', 'star'],
  )
})

test('pickInactiveCandidates never archives the session currently open', () => {
  const items = [session('open', NOW - 90 * DAY), session('other', NOW - 90 * DAY)]
  assert.deepEqual(pickInactiveCandidates(items, { inactiveDays: 30, activeSessionId: 'open', now: NOW }), ['other'])
})

test('pickInactiveCandidates leaves sessions with an unusable timestamp alone', () => {
  const items = [
    session('no-time', null),
    session('zero', 0),
    session('nan', NaN),
    session('string', '2026-01-01'),
    session('good', NOW - 90 * DAY),
  ]
  // Cannot prove they are idle → do not touch them.
  assert.deepEqual(pickInactiveCandidates(items, { inactiveDays: 30, now: NOW }), ['good'])
})

test('pickInactiveCandidates de-duplicates and ignores junk entries', () => {
  const items = [
    session('dup', NOW - 90 * DAY),
    session('dup', NOW - 90 * DAY),
    null,
    undefined,
    {},
    { updatedAt: NOW - 90 * DAY },
  ]
  assert.deepEqual(pickInactiveCandidates(items, { inactiveDays: 30, now: NOW }), ['dup'])
})

test('pickInactiveCandidates handles a null list', () => {
  assert.deepEqual(pickInactiveCandidates(null, { inactiveDays: 30, now: NOW }), [])
  assert.deepEqual(pickInactiveCandidates(undefined, { inactiveDays: 30, now: NOW }), [])
})

// ---- createAutoArchiveStore ----------------------------------------------

test('read fabricates defaults when the file is absent', async () => {
  const { store } = await tempStore()
  assert.deepEqual(await store.read(), {
    schemaVersion: AUTO_ARCHIVE_SCHEMA_VERSION,
    settings: { inactiveDays: 0, skipStarred: true },
    lastRunAt: null,
    lastArchivedCount: 0,
  })
})

test('update persists settings and rejects out-of-whitelist windows', async () => {
  const { store } = await tempStore()
  assert.deepEqual(await store.update({ inactiveDays: 30, skipStarred: false }), { inactiveDays: 30, skipStarred: false })
  assert.deepEqual((await store.read()).settings, { inactiveDays: 30, skipStarred: false })

  await assert.rejects(() => store.update({ inactiveDays: 7 }), (e) => {
    assert.equal(e.status, 400)
    return true
  })
  // The rejected patch must not have touched the stored window.
  assert.equal((await store.read()).settings.inactiveDays, 30)
})

test('update ignores unknown keys and leaves other settings intact', async () => {
  const { store } = await tempStore()
  await store.update({ inactiveDays: 60 })
  await store.update({ nonsense: true })
  assert.deepEqual((await store.read()).settings, { inactiveDays: 60, skipStarred: true })
})

test('recordRun stores the sweep result; isFresh throttles the next one', async () => {
  const { store } = await tempStore()
  assert.equal(store.isFresh(await store.read(), NOW), false)

  await store.recordRun(3, NOW)
  const after = await store.read()
  assert.equal(after.lastRunAt, NOW)
  assert.equal(after.lastArchivedCount, 3)

  assert.equal(store.isFresh(after, NOW + 1000), true)
  assert.equal(store.isFresh(after, NOW + RUN_INTERVAL_MS - 1), true)
  assert.equal(store.isFresh(after, NOW + RUN_INTERVAL_MS), false)
})

test('atomic write leaves no temp files behind', async () => {
  const { store, dir } = await tempStore()
  await store.update({ inactiveDays: 90 })
  assert.deepEqual(await readdir(dir), ['auto-archive.json'])
})

test('on-disk document carries the schema version', async () => {
  const { store, file } = await tempStore()
  await store.update({ inactiveDays: 30 })
  const raw = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(raw.schemaVersion, AUTO_ARCHIVE_SCHEMA_VERSION)
  assert.equal(raw.settings.inactiveDays, 30)
})

test('concurrent mutations are serialized, none lost', async () => {
  const { store } = await tempStore()
  await Promise.all([
    store.update({ inactiveDays: 30 }),
    store.update({ skipStarred: false }),
    store.recordRun(1, NOW),
  ])
  const after = await store.read()
  assert.equal(after.settings.inactiveDays, 30)
  assert.equal(after.settings.skipStarred, false)
  assert.equal(after.lastRunAt, NOW)
})

test('a failing mutator does not break the chain', async () => {
  const { store } = await tempStore()
  await store.mutate(() => { throw new Error('boom') }).catch(() => {})
  await store.update({ inactiveDays: 30 })
  assert.equal((await store.read()).settings.inactiveDays, 30)
})

test('a corrupt file is repaired on the next write', async () => {
  const { store, file, dir } = await tempStore()
  await writeFile(file, '{ not json', 'utf8')
  assert.deepEqual((await store.read()).settings, { inactiveDays: 0, skipStarred: true })
  await store.update({ inactiveDays: 60 })
  assert.equal((await store.read()).settings.inactiveDays, 60)
  assert.deepEqual(await readdir(dir), ['auto-archive.json'])
})
