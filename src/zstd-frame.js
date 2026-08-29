// dsh-sessions-manager — zstd frame helpers.
//
// DSH persists session logs as a sequence of concatenated zstd frames. The
// FIRST frame must be exactly one line: the session header JSON (type
// 'session'). The persistence layer enforces this on startup
// (assertZstdHeaderFrame), so any corruption of frame0 takes down the whole
// web profile.
//
// Moving a session between workspaces requires rewriting frame0's `cwd`
// without re-encoding the rest of the log. That rewrite is where a bad frame
// boundary can silently destroy a session — hence the defensive checks here.

import zlib from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'

// zstd magic bytes are 28 B5 2F FD; read as a little-endian uint32 that is
// 0xFD2FB528 (4247762216).
export const ZSTD_MAGIC = 0xFD2FB528

const CHECKSUM_OPTS = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } }

/**
 * Locate real zstd frame boundaries in a concatenated-frame buffer.
 *
 * Scanning for the 4-byte magic alone produces FALSE POSITIVES: the same byte
 * sequence can occur inside compressed data. Every candidate is therefore
 * validated by attempting decompression; only offsets that decode are kept.
 *
 * @param {Buffer} buf
 * @returns {number[]} ascending offsets of real frame starts
 */
export function findZstdFrameStarts(buf) {
  const starts = []
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf.readUInt32LE(i) !== ZSTD_MAGIC) continue
    try {
      // Two checks are needed, not just one:
      //  - a magic inside compressed data fails to decode and throws
      //  - a BARE 4-byte magic at the very end of the buffer decodes to an
      //    EMPTY result without throwing, so non-empty output is required too
      // Every real frame carries at least one JSON line, so neither case can
      // be a genuine frame start.
      const out = zlib.zstdDecompressSync(buf.subarray(i, i + Math.min(buf.length - i, 1000000)))
      if (out.length > 0) starts.push(i)
    } catch (_) {
      // Not a real frame boundary — the magic bytes occurred inside compressed data.
    }
  }
  return starts
}

/**
 * Rewrite the `cwd` field of a session log's first frame, leaving all
 * subsequent frames byte-identical.
 *
 * Refuses to write anything unless frame0 is a session header. A corrupted
 * frame0 (e.g. an `agent/inbox/spliced` event) is reported as an error rather
 * than being re-serialized back to disk — rewriting it would bake the
 * corruption in permanently and make the file unrecoverable.
 *
 * @param {string} filePath path to session.jsonl.zstd
 * @param {string} newCwd   workspace path to write into frame0
 * @throws {Error} when the log has no zstd frame or frame0 is not a session header
 */
export function rewriteFrame0Cwd(filePath, newCwd) {
  const buf = readFileSync(filePath)
  const starts = findZstdFrameStarts(buf)
  if (starts.length === 0) throw new Error('会话日志格式异常（无 zstd 帧）')
  const end0 = starts.length > 1 ? starts[1] : buf.length
  const frame0 = buf.subarray(starts[0], end0)
  const text = zlib.zstdDecompressSync(frame0).toString('utf8')
  const nl = text.indexOf('\n')
  const line = nl >= 0 ? text.slice(0, nl) : text
  const obj = JSON.parse(line)
  if (obj.type !== 'session') {
    throw new Error(`会话日志格式异常（帧0 不是 session header，实际 type=${obj.type}）`)
  }
  if (obj.cwd === newCwd) return // already correct, no rewrite needed
  obj.cwd = newCwd
  const newFrame0 = zlib.zstdCompressSync(JSON.stringify(obj) + '\n', CHECKSUM_OPTS)
  const rest = buf.subarray(end0)
  writeFileSync(filePath, Buffer.concat([newFrame0, rest]))
}

/**
 * Non-destructive variant of rewriteFrame0Cwd: returns the rewritten buffer
 * instead of touching the file on disk. Used by tests.
 *
 * @param {Buffer} buf
 * @param {string} newCwd
 * @returns {Buffer} rewritten log
 */
export function rewriteFrame0CwdInMemory(buf, newCwd) {
  const starts = findZstdFrameStarts(buf)
  if (starts.length === 0) throw new Error('会话日志格式异常（无 zstd 帧）')
  const end0 = starts.length > 1 ? starts[1] : buf.length
  const frame0 = buf.subarray(starts[0], end0)
  const text = zlib.zstdDecompressSync(frame0).toString('utf8')
  const nl = text.indexOf('\n')
  const line = nl >= 0 ? text.slice(0, nl) : text
  const obj = JSON.parse(line)
  if (obj.type !== 'session') {
    throw new Error(`会话日志格式异常（帧0 不是 session header，实际 type=${obj.type}）`)
  }
  obj.cwd = newCwd
  const newFrame0 = zlib.zstdCompressSync(JSON.stringify(obj) + '\n', CHECKSUM_OPTS)
  const rest = buf.subarray(end0)
  return Buffer.concat([newFrame0, rest])
}

/**
 * Build a multi-frame session log buffer (header frame + event frames),
 * matching the layout DSH's persistence layer writes. Used by tests.
 *
 * @param {object} header  session header (must have type: 'session')
 * @param {object[]} events subsequent records, one zstd frame each
 * @returns {Buffer}
 */
export function buildSessionLog(header, events = []) {
  const frames = [JSON.stringify(header) + '\n', ...events.map((e) => JSON.stringify(e) + '\n')]
  return Buffer.concat(frames.map((f) => zlib.zstdCompressSync(Buffer.from(f, 'utf8'), CHECKSUM_OPTS)))
}

/**
 * Read frame0 of a session log and return the parsed header line.
 *
 * @param {Buffer} buf
 * @returns {{obj: object, lineCount: number}}
 */
export function readFrame0(buf) {
  const starts = findZstdFrameStarts(buf)
  if (starts.length === 0) throw new Error('会话日志格式异常（无 zstd 帧）')
  const end0 = starts.length > 1 ? starts[1] : buf.length
  const text = zlib.zstdDecompressSync(buf.subarray(starts[0], end0)).toString('utf8')
  const lines = text.split('\n').filter((l) => l.length > 0)
  return { obj: JSON.parse(lines[0]), lineCount: lines.length }
}
