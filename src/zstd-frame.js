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
 * Parse complete concatenated Zstandard frames without decompressing them.
 * Invalid complete structure rejects; EOF inside the final frame is reported
 * as torn rather than guessed from magic bytes occurring in compressed data.
 *
 * @param {Buffer} buf
 * @param {number} maxFrames
 * @returns {{frames: Array<{start:number,end:number}>, tornStart?: number}}
 */
export function scanZstdFrames(buf, maxFrames = Number.POSITIVE_INFINITY) {
  const frames = []
  let offset = 0
  while (offset < buf.length) {
    const start = offset
    if (buf.length - offset < 4) return { frames, tornStart: start }
    if (buf.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`会话日志格式异常（字节 ${offset} 的 zstd magic 无效）`)
    }
    offset += 4
    if (offset === buf.length) return { frames, tornStart: start }

    const descriptor = buf.readUInt8(offset++)
    if ((descriptor & 0x18) !== 0) throw new Error(`会话日志格式异常（字节 ${offset - 1} 使用保留帧头位）`)
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buf.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes

    for (;;) {
      if (buf.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buf.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) throw new Error(`会话日志格式异常（字节 ${offset - 3} 使用保留块类型）`)
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buf.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buf.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
    if (frames.length === maxFrames) return { frames }
  }
  return { frames }
}

/** Backward-compatible frame-start view used by diagnostics and tests. */
export function findZstdFrameStarts(buf) {
  return scanZstdFrames(buf).frames.map((frame) => frame.start)
}

function firstFrame(buf) {
  const scan = scanZstdFrames(buf, 1)
  const frame = scan.frames[0]
  if (!frame) throw new Error('会话日志格式异常（无完整 zstd 帧）')
  return frame
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
  const frame = firstFrame(buf)
  const end0 = frame.end
  const frame0 = buf.subarray(frame.start, end0)
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
  const frame = firstFrame(buf)
  const end0 = frame.end
  const frame0 = buf.subarray(frame.start, end0)
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
  const frame = firstFrame(buf)
  const text = zlib.zstdDecompressSync(buf.subarray(frame.start, frame.end)).toString('utf8')
  const lines = text.split('\n').filter((l) => l.length > 0)
  return { obj: JSON.parse(lines[0]), lineCount: lines.length }
}
