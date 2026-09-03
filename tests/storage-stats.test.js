import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aggregateStorage, UNGROUPED_KEY } from '../src/storage-stats.js'

function item(sessionId, sizeBytes, workspacePath, extra = {}) {
  return { sessionId, title: `t-${sessionId}`, workspacePath, workspaceTitle: workspacePath ? `w-${workspacePath}` : null, sizeBytes, ...extra }
}

test('aggregateStorage handles an empty list', () => {
  assert.deepEqual(aggregateStorage([]), {
    totalBytes: 0, sessionCount: 0, sizedSessions: 0, unknownSessions: 0, workspaces: [], top: [],
  })
  assert.deepEqual(aggregateStorage(null), aggregateStorage([]))
})

test('aggregateStorage totals bytes and counts sized vs unknown sessions', () => {
  const out = aggregateStorage([
    item('a', 100, '/ws/one'),
    item('b', 200, '/ws/one'),
    item('c', null, '/ws/one'),
    item('d', undefined, '/ws/two'),
  ])
  assert.equal(out.totalBytes, 300)
  assert.equal(out.sessionCount, 4)
  assert.equal(out.sizedSessions, 2)
  assert.equal(out.unknownSessions, 2)
  // The breakdown must always add up to the total, or the panel contradicts itself.
  assert.equal(out.sessionCount, out.sizedSessions + out.unknownSessions)
})

test('aggregateStorage groups per workspace and sorts by size', () => {
  const out = aggregateStorage([
    item('a', 500, '/small'),
    item('b', 100, '/big'),
    item('c', 900, '/big'),
  ])
  assert.deepEqual(out.workspaces.map((w) => w.path), ['/big', '/small'])
  assert.equal(out.workspaces[0].bytes, 1000)
  assert.equal(out.workspaces[0].sessions, 2)
  assert.equal(out.workspaces[1].bytes, 500)
})

test('aggregateStorage buckets workspace-less sessions under 未分组', () => {
  const out = aggregateStorage([item('orphan', 42, null), item('b', 10, '/ws')])
  const bucket = out.workspaces.find((w) => w.key === UNGROUPED_KEY)
  assert.ok(bucket, 'expected an ungrouped bucket')
  assert.equal(bucket.path, null)
  assert.equal(bucket.bytes, 42)
})

test('share is the fraction of total bytes (0 when nothing is sized)', () => {
  const out = aggregateStorage([item('a', 300, '/one'), item('b', 100, '/two')])
  assert.equal(out.workspaces[0].share, 0.75)
  assert.equal(out.workspaces[1].share, 0.25)

  const none = aggregateStorage([item('a', null, '/one')])
  assert.equal(none.workspaces[0].share, 0)
})

test('top is sorted largest-first and honours topN', () => {
  const items = [item('s1', 10, '/w'), item('s2', 900, '/w'), item('s3', 500, '/w'), item('s4', null, '/w')]
  const out = aggregateStorage(items, { topN: 2 })
  assert.deepEqual(out.top.map((s) => s.sessionId), ['s2', 's3'])
  // Unsized sessions never reach the leaderboard.
  assert.ok(!out.top.some((s) => s.sessionId === 's4'))
})

test('topN falls back to 10 for junk input', () => {
  const items = Array.from({ length: 12 }, (_, i) => item(`s${i}`, 1000 - i, '/w'))
  assert.equal(aggregateStorage(items).top.length, 10)
  assert.equal(aggregateStorage(items, { topN: 0 }).top.length, 10)
  assert.equal(aggregateStorage(items, { topN: -3 }).top.length, 10)
  assert.equal(aggregateStorage(items, { topN: 'x' }).top.length, 10)
  assert.equal(aggregateStorage(items, { topN: 12.5 }).top.length, 10)
})

test('top carries the workspace title for display', () => {
  const out = aggregateStorage([item('a', 10, '/ws', { workspaceTitle: 'My Project' })])
  assert.equal(out.top[0].workspaceTitle, 'My Project')
})

test('zero-byte sessions are counted as sized, not unknown', () => {
  const out = aggregateStorage([item('empty', 0, '/w')])
  assert.equal(out.sizedSessions, 1)
  assert.equal(out.unknownSessions, 0)
  assert.equal(out.totalBytes, 0)
})

test('malformed entries are skipped instead of throwing', () => {
  const out = aggregateStorage([null, undefined, {}, { sessionId: 'ok', sizeBytes: 5, workspacePath: '/w' }])
  assert.equal(out.sessionCount, 1)
  assert.equal(out.totalBytes, 5)
  assert.equal(out.sessionCount, out.sizedSessions + out.unknownSessions)
})
