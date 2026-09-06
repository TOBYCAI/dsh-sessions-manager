// Compatibility boundary for the two DSH persistence generations supported by
// dsh-sessions-manager. Business code consumes normalized headers and complete
// inspections; it never needs to know whether DSH returned a legacy header or
// a handle-era SessionPersistenceSnapshot.
//
// Handle-era notes (official contract, dsh-v0.1.3-alpha.1):
//   - `SessionHandle.read(offset?, length?, options?)` returns a bounded slice
//     of the valid contiguous log; an offset at/past the end returns [].
//   - Every handle is single-owner state: `close()` MUST run exactly once on
//     every path, including throws and aborts (the contract exposes
//     `SessionHandleClosedError` for operations after close).
//   - `stat(id)` → `SessionPersistenceSnapshot | undefined`; `snapshot.revision`
//     is an opaque change token valid ONLY within one service instance and one
//     session id (see src/session-meta-cache.js).

const DEFAULT_CHUNK = 400
// 防御上限：一次 inspect 的分块循环绝不能无限自旋（后端 read 行为异常时快速失败）。
const MAX_CHUNKS = 20000

function normalizeReadResult(events) {
  if (Array.isArray(events)) return events
  if (events && typeof events[Symbol.iterator] === 'function') return [...events]
  return []
}

async function closeQuietly(handle) {
  try { if (handle && typeof handle.close === 'function') await handle.close() } catch (e) { /* close 是幂等兜底，二次失败忽略 */ }
}

function asHeader(value) {
  if (!value || typeof value !== 'object') return null
  const candidate = value.header && typeof value.header === 'object' ? value.header : value
  return candidate.id == null ? null : candidate
}

export function normalizePersistenceEntry(value) {
  const header = asHeader(value)
  if (!header) return null
  const snapshot = value && value.header === header ? value : null
  return {
    header,
    snapshot,
    id: String(header.id),
    sizeBytes: snapshot && Number.isFinite(snapshot.sizeBytes) ? Number(snapshot.sizeBytes) : null,
    eventCount: snapshot && Number.isSafeInteger(snapshot.eventCount) ? snapshot.eventCount : null,
    revision: snapshot && typeof snapshot.revision === 'string' && snapshot.revision ? snapshot.revision : null,
  }
}

export function normalizePersistenceList(values) {
  if (!Array.isArray(values)) return []
  return values.map(normalizePersistenceEntry).filter(Boolean)
}

export function createPersistenceAdapter(service) {
  if (!service || typeof service.list !== 'function') throw new TypeError('sessionPersistence.list is required')

  const hasStat = typeof service.stat === 'function'
  const kind = typeof service.open === 'function' ? 'session-handle' : 'legacy'

  async function listEntries(options) {
    return normalizePersistenceList(await service.list(options))
  }

  // Handle-era only: the official lightweight observation. Returns the
  // normalized snapshot entry, or null when the session does not exist.
  // Never falls back to reading the log — callers use it for existence
  // checks and revision-based cache validation only.
  async function statSession(id) {
    if (!hasStat) return null
    const snapshot = await service.stat(id)
    return snapshot ? normalizePersistenceEntry(snapshot) : null
  }

  // Read one bounded slice through a SessionHandle. The caller owns the
  // handle lifecycle; this helper only guarantees close on read failure —
  // the surrounding try/finally in the chunk drivers below is authoritative.
  async function readChunk(handle, offset, length, signal) {
    if (signal && signal.aborted) {
      const error = new Error('会话读取已取消')
      error.code = 'DSM_READ_ABORTED'
      throw error
    }
    const events = await handle.read(offset, length, signal ? { signal } : undefined)
    return normalizeReadResult(events)
  }

  // Sequential chunk driver shared by inspectSession / readSession. Opens the
  // handle itself so every code path (success, mid-chunk throw, abort) closes
  // it exactly once in `finally`.
  async function readChunks(id, { offset = 0, chunkSize = DEFAULT_CHUNK, signal, onEvents }) {
    if (typeof service.open !== 'function') throw new Error('当前 DSH 持久化服务不支持读取会话')
    const handle = await service.open(id, 'read')
    if (!handle || typeof handle.read !== 'function' || typeof handle.close !== 'function') {
      await closeQuietly(handle)
      throw new Error('DSH 返回了无效的 SessionHandle')
    }
    let cursor = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0
    let total = 0
    try {
      for (let round = 0; round < MAX_CHUNKS; round++) {
        const events = await readChunk(handle, cursor, chunkSize, signal)
        if (events.length === 0) break
        cursor += events.length
        total += events.length
        if (onEvents) await onEvents(events, { offset: cursor - events.length, total })
        if (events.length < chunkSize) break
      }
    } finally {
      await closeQuietly(handle)
    }
    return {
      meta: handle.header || handle.meta || null,
      inheritedEventCount: Number.isSafeInteger(handle.inheritedEventCount) ? handle.inheritedEventCount : 0,
      eventCount: total,
    }
  }

  // Streamed full inspection: folds the log chunk-by-chunk through `onEvents`
  // so 详情 / 导出 never materialize a whole large log in memory. `signal`
  // (AbortSignal) cancels before the next chunk; the handle closes on every
  // path. Legacy runtimes have no bounded read — readFrom already returns the
  // complete log, which becomes a single onEvents batch.
  async function inspectSession(id, opts = {}) {
    const chunkSize = Number.isSafeInteger(opts.chunkSize) && opts.chunkSize > 0 ? opts.chunkSize : DEFAULT_CHUNK
    if (typeof service.open === 'function') {
      // 取消发生在 open 之前：连 handle 都不去开。
      if (opts.signal && opts.signal.aborted) {
        const error = new Error('会话读取已取消')
        error.code = 'DSM_READ_ABORTED'
        throw error
      }
      return readChunks(id, { offset: opts.offset || 0, chunkSize, signal: opts.signal, onEvents: opts.onEvents })
    }
    if (typeof service.readFrom !== 'function') throw new Error('当前 DSH 持久化服务不支持读取会话')
    if (opts.signal && opts.signal.aborted) {
      const error = new Error('会话读取已取消')
      error.code = 'DSM_READ_ABORTED'
      throw error
    }
    const result = await service.readFrom(id, opts.offset || 0)
    const events = normalizeReadResult(result && result.events)
    if (opts.onEvents && events.length) await opts.onEvents(events, { offset: opts.offset || 0, total: events.length })
    return {
      meta: result && result.meta ? result.meta : null,
      inheritedEventCount: result && Number.isSafeInteger(result.inheritedEventCount) ? result.inheritedEventCount : 0,
      eventCount: events.length,
    }
  }

  // Complete read (legacy convenience shape). Internally chunked; callers that
  // stream should prefer inspectSession so large logs never buffer whole.
  async function readSession(id, offset = 0) {
    if (typeof service.readFrom === 'function') {
      const result = await service.readFrom(id, offset)
      return {
        meta: result && result.meta ? result.meta : null,
        inheritedEventCount: result && Number.isSafeInteger(result.inheritedEventCount) ? result.inheritedEventCount : 0,
        events: result && Array.isArray(result.events) ? result.events : [],
      }
    }
    const events = []
    const summary = await readChunks(id, { offset, onEvents: (batch) => { events.push(...batch) } })
    return {
      meta: summary.meta,
      inheritedEventCount: summary.inheritedEventCount,
      events,
    }
  }

  function locate(header) {
    if (typeof service.locate === 'function') return service.locate(header)
    return null
  }

  // 落盘校验版定位：legacy 走官方 locate；handle 时代官方收走了 locate，改由
  // handle-era-paths 的三层守卫推导（root 实例字段 → 目录结构 → id 归属），
  // 任一层失败返回 null，调用方安全降级。返回 { path, sessionDir|null }。
  async function locateVerified(header) {
    if (typeof service.locate === 'function') {
      try {
        const loc = service.locate(header)
        if (loc && typeof loc.path === 'string') return { path: loc.path, sessionDir: null }
      } catch (e) { /* 落到推导 */ }
    }
    const artifacts = await locateSessionArtifacts(service, header)
    return artifacts ? { path: artifacts.logPath, sessionDir: artifacts.sessionDir } : null
  }

  return { kind, listEntries, readSession, inspectSession, statSession, locate, locateVerified, hasStat }
}
