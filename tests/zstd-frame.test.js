// Regression tests for the session-log zstd frame rewrite.
//
// Background: moving a session between workspaces rewrites frame0's `cwd`.
// Locating frame boundaries by scanning for the 4-byte zstd magic alone
// produces false positives (the same bytes can occur inside compressed data),
// which corrupts frame0 and takes down the whole web profile on next start —
// the persistence layer requires frame0 to be exactly one session-header line.
//
// These tests pin both halves of the fix:
//   1. frame boundaries are validated by decompression
//   2. a non-session frame0 is rejected, never rewritten

import assert from 'node:assert/strict'
import { test } from 'node:test'
import zlib from 'node:zlib'
import {
  ZSTD_MAGIC,
  buildSessionLog,
  findZstdFrameStarts,
  readFrame0,
  rewriteFrame0CwdInMemory,
} from '../src/zstd-frame.js'

// zstd magic bytes in file order (28 B5 2F FD) — the little-endian uint32
// 0xFD2FB528 is what readUInt32LE yields.
const MAGIC_BYTES = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

const sessionHeader = (cwd = '/workspaces/alpha') => ({
  type: 'session',
  id: 'sess-1',
  cwd,
  title: 'Test session',
  createdAt: 1700000000000,
})

test('findZstdFrameStarts: locates every frame of a well-formed log', () => {
  const log = buildSessionLog(sessionHeader(), [
    { type: 'session/title', data: { title: 'Renamed' } },
    { type: 'agent/inbox/spliced', seq: 4 },
    { type: 'agent/message', seq: 5 },
  ])
  const starts = findZstdFrameStarts(log)
  assert.equal(starts.length, 4, 'header + 3 event frames')
  assert.equal(starts[0], 0, 'first frame starts at offset 0')
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b), 'offsets ascending')
})

test('findZstdFrameStarts: ignores a magic followed by undecodable data', () => {
  // Regression: the old implementation accepted every 4-byte magic match, so a
  // magic sequence occurring inside a frame's payload was treated as the start
  // of the next frame — slicing frame0 wrong and corrupting the log.
  const realFrame = zlib.zstdCompressSync(Buffer.from(JSON.stringify(sessionHeader()) + '\n'))
  const buf = Buffer.concat([realFrame, Buffer.from('not a zstd frame at all'), MAGIC_BYTES, Buffer.from('tail')])

  assert.deepEqual(
    findZstdFrameStarts(buf),
    [0],
    'only the real frame is recognised; the undecodable magic is filtered out',
  )
})

test('findZstdFrameStarts: ignores a bare trailing magic', () => {
  // Edge case: a 4-byte magic at the very end of the buffer does NOT throw when
  // decompressed — Node returns an empty buffer. Accepting it would mark a
  // phantom frame boundary, so empty output must be rejected too.
  const realFrame = zlib.zstdCompressSync(Buffer.from(JSON.stringify(sessionHeader()) + '\n'))
  const buf = Buffer.concat([realFrame, MAGIC_BYTES])
  assert.equal(buf.length, realFrame.length + 4, 'bare magic sits at the very end')

  assert.deepEqual(findZstdFrameStarts(buf), [0], 'the bare trailing magic is not treated as a frame')
})

test('findZstdFrameStarts: returns empty for a buffer with no decodable frame', () => {
  const starts = findZstdFrameStarts(Buffer.concat([MAGIC_BYTES, Buffer.from('corrupt payload')]))
  assert.deepEqual(starts, [])
})

test('rewriteFrame0Cwd: updates cwd and preserves every subsequent frame byte-for-byte', () => {
  const events = [{ type: 'session/title', data: { title: 'Renamed' } }, { type: 'agent/message', seq: 9 }]
  const log = buildSessionLog(sessionHeader('/workspaces/alpha'), events)

  const next = rewriteFrame0CwdInMemory(log, '/workspaces/beta')

  // frame0 reflects the new cwd and is still exactly one line
  const { obj, lineCount } = readFrame0(next)
  assert.equal(obj.type, 'session')
  assert.equal(obj.cwd, '/workspaces/beta')
  assert.equal(lineCount, 1, 'frame0 must stay a single header line')

  // Header fields other than cwd are untouched
  assert.equal(obj.id, 'sess-1')
  assert.equal(obj.title, 'Test session')

  // Everything after frame0 is preserved verbatim
  const starts = findZstdFrameStarts(log)
  const nextStarts = findZstdFrameStarts(next)
  assert.equal(nextStarts.length, starts.length, 'frame count unchanged')
  assert.deepEqual(
    next.subarray(nextStarts[1]),
    log.subarray(starts[1]),
    'trailing frames are byte-identical',
  )
})

test('rewriteFrame0Cwd: rejects a corrupted frame0 instead of baking it in', () => {
  // Regression: this is the exact shape of the file that broke `dsm web` —
  // frame0 held an event record, not a session header. The old code would have
  // parsed it, set `cwd`, and written it back as frame0, making the corruption
  // permanent and unrecoverable.
  const corrupted = buildSessionLog(
    { type: 'agent/inbox/spliced', seq: 4 },
    [{ type: 'session/title', data: { title: 'Orphaned' } }],
  )

  assert.throws(
    () => rewriteFrame0CwdInMemory(corrupted, '/workspaces/beta'),
    /帧0 不是 session header/,
    'must refuse to rewrite a non-session frame0',
  )
})

test('rewriteFrame0Cwd: rejects a log with no decodable zstd frame', () => {
  assert.throws(
    () => rewriteFrame0CwdInMemory(Buffer.from('plain text, not zstd'), '/workspaces/beta'),
    /无 zstd 帧/,
  )
})

test('buildSessionLog + readFrame0: round-trip matches DSH persistence layout', () => {
  const header = sessionHeader('/workspaces/gamma')
  const log = buildSessionLog(header, [{ type: 'agent/message', seq: 2 }])

  // The persistence layer's frame0 reader requires the first frame to decode to
  // exactly one line terminated by a newline (assertZstdHeaderFrame).
  const starts = findZstdFrameStarts(log)
  const end0 = starts.length > 1 ? starts[1] : log.length
  const plaintext = zlib.zstdDecompressSync(log.subarray(starts[0], end0)).toString('utf8')

  assert.equal(plaintext.indexOf('\n'), plaintext.length - 1, 'frame0 is one line + trailing newline')
  const { obj } = readFrame0(log)
  assert.deepEqual(obj, header)
})

test('ZSTD_MAGIC constant matches the on-disk byte order', () => {
  const buf = Buffer.alloc(4)
  buf.writeUInt32LE(ZSTD_MAGIC, 0)
  assert.deepEqual(buf, MAGIC_BYTES)
})
