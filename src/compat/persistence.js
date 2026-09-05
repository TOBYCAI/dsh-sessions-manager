// Compatibility boundary for the two DSH persistence generations supported by
// dsh-sessions-manager. Business code consumes normalized headers and complete
// inspections; it never needs to know whether DSH returned a legacy header or
// a handle-era SessionPersistenceSnapshot.

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
    revision: snapshot ? snapshot.revision : null,
  }
}

export function normalizePersistenceList(values) {
  if (!Array.isArray(values)) return []
  return values.map(normalizePersistenceEntry).filter(Boolean)
}

export function createPersistenceAdapter(service) {
  if (!service || typeof service.list !== 'function') throw new TypeError('sessionPersistence.list is required')

  async function listEntries(options) {
    return normalizePersistenceList(await service.list(options))
  }

  async function readSession(id, offset = 0) {
    if (typeof service.readFrom === 'function') {
      const result = await service.readFrom(id, offset)
      return {
        meta: result && result.meta ? result.meta : null,
        inheritedEventCount: result && Number.isSafeInteger(result.inheritedEventCount) ? result.inheritedEventCount : 0,
        events: result && Array.isArray(result.events) ? result.events : [],
      }
    }
    if (typeof service.open !== 'function') throw new Error('当前 DSH 持久化服务不支持读取会话')
    const handle = await service.open(id, 'read')
    if (!handle || typeof handle.read !== 'function' || typeof handle.close !== 'function') {
      try { if (handle && typeof handle.close === 'function') await handle.close() } catch {}
      throw new Error('DSH 返回了无效的 SessionHandle')
    }
    try {
      const events = await handle.read(offset)
      return {
        meta: handle.header || handle.meta || null,
        inheritedEventCount: Number.isSafeInteger(handle.inheritedEventCount) ? handle.inheritedEventCount : 0,
        events: Array.isArray(events) ? events : [...(events || [])],
      }
    } finally {
      await handle.close()
    }
  }

  function locate(header) {
    if (typeof service.locate === 'function') return service.locate(header)
    return null
  }

  const kind = typeof service.open === 'function' ? 'session-handle' : 'legacy'
  return { kind, listEntries, readSession, locate }
}
