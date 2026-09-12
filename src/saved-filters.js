// Durable "saved filters" store (schema v1).
//
// Same discipline as src/star-index.js / src/tag-index.js: version field,
// per-entry defensive normalize, atomic write (tmp + rename at 0o600) and a
// single chained mutation queue. Filter payloads are OPAQUE JSON: the host
// never interprets them (the UI round-trips its own chip state); we only
// bound the serialized size so a corrupt entry can never bloat the state
// file. Lives in the plugin state directory next to tags.json.
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

// v1 is the first saved-filters schema. Unlike tags.json (which starts at v4
// to dodge star's v3) this document lives in its own file and can begin
// counting from 1.
export const FILTER_SCHEMA_VERSION = 1

// Caps: ≤20 saved filters, ≤40 code points per name (Array.from counting),
// ≤2048 characters of serialized JSON per payload.
export const MAX_FILTERS = 20
export const MAX_FILTER_NAME = 40
export const MAX_FILTER_JSON = 2048

// Same state directory (and same env override) as the star / tag indexes.
const DEFAULT_FILTER_DIR = join(homedir(), '.dsh', 'sessions-manager')

const FILTER_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

function randomSuffix() {
  const bytes = randomBytes(8)
  let out = ''
  for (const b of bytes) out += FILTER_ID_ALPHABET[b % FILTER_ID_ALPHABET.length]
  return out
}

function isSafeFilterId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 && !/[\\/\0]/.test(value)
}

function filterError(message, status, code) {
  const error = new Error(message)
  error.status = status
  if (code) error.code = code
  throw error
}

function normalizeFilterName(value) {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (!name || /[\\/\0]/.test(name)) return null
  if (Array.from(name).length > MAX_FILTER_NAME) return null
  return name
}

function nameKey(name) {
  return name.toLocaleLowerCase()
}

// Serialize an opaque payload, or null when it cannot be stored (not JSON at
// all — e.g. undefined/functions — or beyond the size cap).
function normalizeFiltersPayload(value) {
  let serialized
  try {
    serialized = JSON.stringify(value)
  } catch {
    return null
  }
  if (typeof serialized !== 'string' || serialized.length > MAX_FILTER_JSON) return null
  try {
    return JSON.parse(serialized)
  } catch {
    return null
  }
}

/**
 * Coerce anything on disk (or nothing at all) into a valid v1 store.
 * A dirty entry (bad id/name, unserializable or oversize payload, duplicate
 * id / casefold-duplicate name) is dropped whole, never partially repaired.
 */
export function normalizeFilterStore(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null
  const items = []
  const ids = new Set()
  const names = new Set()
  for (const item of (source && Array.isArray(source.items) ? source.items : [])) {
    if (!item || typeof item !== 'object') continue
    if (!isSafeFilterId(item.id) || ids.has(item.id)) continue
    const name = normalizeFilterName(item.name)
    if (name === null) continue
    const key = nameKey(name)
    if (names.has(key)) continue
    const filters = normalizeFiltersPayload(item.filters)
    if (filters === null) continue
    ids.add(item.id)
    names.add(key)
    const createdAt = Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : 0
    items.push({ id: item.id, name, filters, createdAt })
    if (items.length >= MAX_FILTERS) break
  }
  return { schemaVersion: FILTER_SCHEMA_VERSION, items }
}

/**
 * Open the saved-filters store.
 * @param {object} [options]
 * @param {string} [options.dir] - Directory holding the store (tests inject a temp dir).
 * @param {string} [options.indexPath] - Full store path, overriding `dir`.
 */
export function createSavedFilters(options = {}) {
  const dir = options.dir || process.env.DSH_SESSIONS_MANAGER_STAR_DIR || DEFAULT_FILTER_DIR
  const indexPath = options.indexPath || join(dir, 'saved-filters.json')
  let mutation = Promise.resolve()

  async function read() {
    try {
      return normalizeFilterStore(JSON.parse(readFileSync(indexPath, 'utf8')))
    } catch {
      return normalizeFilterStore(null)
    }
  }

  async function write(store) {
    await mkdir(dir, { recursive: true })
    const tmp = join(dir, `.saved-filters-${process.pid}-${Date.now()}.tmp`)
    await writeFile(tmp, JSON.stringify(normalizeFilterStore(store), null, 2), { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, indexPath)
  }

  // Serialize read-modify-write cycles (same chain semantics as the star index).
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

  function newFilterId(store) {
    for (let i = 0; i < 16; i++) {
      const id = `f_${randomSuffix()}`
      if (!store.items.some((t) => t.id === id)) return id
    }
    return filterError('无法生成筛选 id（随机碰撞异常）', 500, 'DSM_FILTER_ID_COLLISION')
  }

  /**
   * Save a named filter. `filters` is stored verbatim (opaque to the host).
   * @param {string} rawName
   * @param {*} filters
   * @returns {Promise<{id, name, filters, createdAt}>}
   * @throws 400 DSM_FILTER_NAME_INVALID | 400 DSM_FILTER_INVALID
   *         | 400 DSM_FILTER_TOO_LARGE | 409 DSM_FILTER_EXISTS | 409 DSM_FILTER_LIMIT
   */
  async function save(rawName, filters) {
    const name = normalizeFilterName(rawName)
    if (name === null) filterError(`筛选名无效（非空、不含斜杠、不超过 ${MAX_FILTER_NAME} 个字符）`, 400, 'DSM_FILTER_NAME_INVALID')
    // Bound the opaque payload before it can ever reach disk, with honest
    // codes for "not JSON at all" vs. "oversize".
    let serialized
    try {
      serialized = JSON.stringify(filters)
    } catch {
      serialized = undefined
    }
    if (typeof serialized !== 'string') filterError('筛选条件必须是可 JSON 序列化的数据', 400, 'DSM_FILTER_INVALID')
    if (serialized === 'null') filterError('筛选条件不能为 null', 400, 'DSM_FILTER_INVALID')
    if (serialized.length > MAX_FILTER_JSON) filterError(`筛选条件过大（序列化后最多 ${MAX_FILTER_JSON} 字符）`, 400, 'DSM_FILTER_TOO_LARGE')
    const payload = JSON.parse(serialized)
    const key = nameKey(name)
    return mutate((store) => {
      if (store.items.some((t) => nameKey(t.name) === key)) filterError('同名筛选已存在', 409, 'DSM_FILTER_EXISTS')
      if (store.items.length >= MAX_FILTERS) filterError(`保存的筛选已达上限（${MAX_FILTERS}）`, 409, 'DSM_FILTER_LIMIT')
      const item = { id: newFilterId(store), name, filters: payload, createdAt: Date.now() }
      store.items.push(item)
      return item
    })
  }

  /**
   * Delete saved filters by id (unknown ids are ignored).
   * @param {string[]} ids
   * @returns {Promise<number>} how many items were actually removed.
   */
  function remove(ids) {
    const wanted = new Set((Array.isArray(ids) ? ids : []).filter(isSafeFilterId).map(String))
    return mutate((store) => {
      const before = store.items.length
      store.items = store.items.filter((t) => !wanted.has(t.id))
      return before - store.items.length
    })
  }

  /**
   * @returns {Promise<Array<{id, name, filters, createdAt}>>}
   */
  async function list() {
    const store = await read()
    return store.items
  }

  return { read, write, mutate, list, save, remove, indexPath, dir }
}
