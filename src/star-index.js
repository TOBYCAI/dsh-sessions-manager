// Durable "starred sessions" index (schema v3).
//
// Deliberately mirrors the recycle-bin index in src/index.js: version field,
// automatic upgrade of older shapes, atomic write (tmp + rename) and a single
// chained mutation queue so two concurrent requests can never clobber each
// other. Extracted from the host bundle so it can be unit-tested directly —
// pass `dir` to point the index at a temp directory.
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// v3 is the first star schema; it starts at 3 so it can never be confused with
// the recycle bin's v1/v2 documents even if a file is copied between them.
export const STAR_SCHEMA_VERSION = 3

const DEFAULT_STAR_DIR = join(homedir(), '.dsh', 'sessions-manager')

function isSafeSessionId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\\/\0]/.test(value) && value !== '.' && value !== '..'
}

/**
 * Coerce anything on disk (or nothing at all) into a valid v3 store.
 * Accepts a bare array of ids (the pre-schema shape) and upgrades it.
 */
export function normalizeStarStore(raw) {
  const legacy = Array.isArray(raw) ? raw : null
  const source = legacy || (raw && typeof raw === 'object' ? raw : null)
  const ids = source && Array.isArray(source.starredSessionIds) ? source.starredSessionIds : (legacy || [])
  const clean = []
  const seen = new Set()
  for (const id of ids) {
    // Strings only: silently coercing a number into an id would let junk into
    // the index and mask a caller bug.
    if (!isSafeSessionId(id)) continue
    if (seen.has(id)) continue
    seen.add(id)
    clean.push(id)
  }
  return { schemaVersion: STAR_SCHEMA_VERSION, starredSessionIds: clean }
}

/**
 * Open the star index.
 * @param {object} [options]
 * @param {string} [options.dir] - Directory holding the index (tests inject a temp dir).
 * @param {string} [options.indexPath] - Full index path, overriding `dir`.
 */
export function createStarIndex(options = {}) {
  const dir = options.dir || process.env.DSH_SESSIONS_MANAGER_STAR_DIR || DEFAULT_STAR_DIR
  const indexPath = options.indexPath || join(dir, 'star.json')
  let mutation = Promise.resolve()

  async function read() {
    try {
      return normalizeStarStore(JSON.parse(readFileSync(indexPath, 'utf8')))
    } catch {
      return normalizeStarStore(null)
    }
  }

  async function write(store) {
    await mkdir(dir, { recursive: true })
    const tmp = join(dir, `.star-${process.pid}-${Date.now()}.tmp`)
    await writeFile(tmp, JSON.stringify(normalizeStarStore(store), null, 2), { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, indexPath)
  }

  // Serialize read-modify-write cycles: every mutator sees the store as left by
  // the previous one, and a rejected mutator still keeps the chain alive.
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
   * Star or unstar sessions.
   * @param {string[]} ids - Session ids to change.
   * @param {boolean} starred - true to star, false to unstar.
   * @returns {Promise<string[]>} The full starred set after the change.
   */
  function setStarred(ids, starred) {
    const wanted = (Array.isArray(ids) ? ids : []).filter(isSafeSessionId).map(String)
    return mutate((store) => {
      const set = new Set(store.starredSessionIds)
      for (const id of wanted) {
        if (starred) set.add(id)
        else set.delete(id)
      }
      store.starredSessionIds = [...set]
      return store.starredSessionIds
    })
  }

  // Drop ids once their session is gone (purged / deleted), otherwise the index
  // would grow forever with ids that can never be listed again.
  function removeIds(ids) {
    return setStarred(ids, false)
  }

  return { read, write, mutate, setStarred, removeIds, indexPath, dir }
}
