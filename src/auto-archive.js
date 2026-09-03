// Durable "auto-archive" settings (schema v4) + the pure candidate rule.
//
// Auto-archive hides conversations that have been idle for N days. It is OFF
// by default: archiving rewrites durable workspace state, so the plugin must
// never touch a conversation the user has not asked it to.
//
// Deliberately mirrors the star index (src/star-index.js): version field,
// defensive coercion of whatever is on disk, atomic write (tmp + rename) and a
// single chained mutation queue. The candidate rule lives here as a pure
// function so it can be tested without a DSH host.
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// v4 keeps clear of the recycle bin's v1/v2 and the star index's v3, so a
// copied or mixed-up file can never be silently accepted as another store.
export const AUTO_ARCHIVE_SCHEMA_VERSION = 4

// Allowed idle windows. 0 = disabled. Deliberately coarse: a free-form number
// would let a typo schedule archiving "tomorrow" for every conversation.
export const INACTIVE_DAY_OPTIONS = Object.freeze([0, 30, 60, 90])

const DAY_MS = 86400000
// Re-run at most once per day: the sweep is triggered by panel reads, and a
// user flipping settings back and forth must not archive in a loop.
export const RUN_INTERVAL_MS = DAY_MS

const DEFAULT_DIR = join(homedir(), '.dsh', 'sessions-manager')

/**
 * Coerce anything on disk (or nothing at all) into a valid v4 store.
 */
export function normalizeAutoArchiveStore(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const settings = source.settings && typeof source.settings === 'object' ? source.settings : {}
  const inactiveDays = INACTIVE_DAY_OPTIONS.includes(settings.inactiveDays) ? settings.inactiveDays : 0
  return {
    schemaVersion: AUTO_ARCHIVE_SCHEMA_VERSION,
    settings: {
      inactiveDays,
      // Starred sessions are an explicit "keep" mark, so they are skipped
      // unless the user opts out.
      skipStarred: settings.skipStarred !== false,
    },
    lastRunAt: Number.isFinite(source.lastRunAt) ? source.lastRunAt : null,
    lastArchivedCount: Number.isInteger(source.lastArchivedCount) && source.lastArchivedCount >= 0 ? source.lastArchivedCount : 0,
  }
}

/**
 * Which sessions should be auto-archived right now? Pure — no I/O, no host.
 *
 * The rule is intentionally conservative: anything we cannot prove is idle
 * (unknown last-activity, already archived, starred, currently open) is left
 * alone. A wrong archive is a visible regression; a missed one is invisible.
 *
 * @param {Array<{sessionId: string, archived?: boolean, starred?: boolean,
 *   updatedAt?: number|null}>} items
 * @param {object} options
 * @param {number} options.inactiveDays - Idle window in days (0 disables).
 * @param {number} [options.now] - Reference timestamp (tests inject it).
 * @param {boolean} [options.skipStarred=true] - Keep starred sessions.
 * @param {string|null} [options.activeSessionId] - Never archive the open one.
 * @returns {string[]} Session ids to archive.
 */
export function pickInactiveCandidates(items, options = {}) {
  const days = options.inactiveDays
  if (!INACTIVE_DAY_OPTIONS.includes(days) || days === 0) return []
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const cutoff = now - days * DAY_MS
  const skipStarred = options.skipStarred !== false
  const activeId = options.activeSessionId != null ? String(options.activeSessionId) : null
  const list = Array.isArray(items) ? items : []

  const out = []
  const seen = new Set()
  for (const item of list) {
    if (!item || item.sessionId == null) continue
    const id = String(item.sessionId)
    if (seen.has(id)) continue
    if (item.archived) continue
    if (skipStarred && item.starred) continue
    if (activeId !== null && id === activeId) continue
    const updatedAt = Number(item.updatedAt)
    // No usable timestamp → cannot prove it is idle → leave it alone.
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) continue
    if (updatedAt < cutoff) { seen.add(id); out.push(id) }
  }
  return out
}

/**
 * Open the auto-archive settings store.
 * @param {object} [options]
 * @param {string} [options.dir] - Directory holding the index (tests inject a temp dir).
 * @param {string} [options.indexPath] - Full index path, overriding `dir`.
 */
export function createAutoArchiveStore(options = {}) {
  const dir = options.dir || process.env.DSH_SESSIONS_MANAGER_AUTO_ARCHIVE_DIR || DEFAULT_DIR
  const indexPath = options.indexPath || join(dir, 'auto-archive.json')
  let mutation = Promise.resolve()

  async function read() {
    try {
      return normalizeAutoArchiveStore(JSON.parse(readFileSync(indexPath, 'utf8')))
    } catch {
      return normalizeAutoArchiveStore(null)
    }
  }

  async function write(store) {
    await mkdir(dir, { recursive: true })
    const tmp = join(dir, `.auto-archive-${process.pid}-${Date.now()}.tmp`)
    await writeFile(tmp, JSON.stringify(normalizeAutoArchiveStore(store), null, 2), { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, indexPath)
  }

  function mutate(mutator) {
    const operation = mutation.then(async () => {
      const store = await read()
      const result = await mutator(store)
      await write(store)
      return result
    })
    mutation = operation.catch(() => {})
    return operation
  }

  /**
   * Merge a partial settings patch.
   * @param {{inactiveDays?: number, skipStarred?: boolean}} patch
   * @returns {Promise<object>} The store's settings after the change.
   */
  function update(patch = {}) {
    return mutate((store) => {
      if (Object.prototype.hasOwnProperty.call(patch, 'inactiveDays')) {
        const days = Number(patch.inactiveDays)
        if (!INACTIVE_DAY_OPTIONS.includes(days)) {
          const error = new Error(`inactiveDays 仅支持 ${INACTIVE_DAY_OPTIONS.join('、')}`)
          error.status = 400
          throw error
        }
        store.settings.inactiveDays = days
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'skipStarred')) {
        store.settings.skipStarred = !!patch.skipStarred
      }
      return store.settings
    })
  }

  /** Record that a sweep ran, so the once-a-day throttle can skip the next one. */
  function recordRun(count, at = Date.now()) {
    return mutate((store) => {
      store.lastRunAt = at
      store.lastArchivedCount = Number.isInteger(count) && count >= 0 ? count : 0
      return store
    })
  }

  /** True when a sweep already ran within RUN_INTERVAL_MS. */
  function isFresh(store, now = Date.now()) {
    return Number.isFinite(store && store.lastRunAt) && (now - store.lastRunAt) < RUN_INTERVAL_MS
  }

  return { read, write, mutate, update, recordRun, isFresh, indexPath, dir }
}
