// Durable "session tags" index (schema v4).
//
// Deliberately mirrors the star index in src/star-index.js: version field,
// per-entry defensive normalize (dirty data is dropped, never repaired by
// guessing), atomic write (tmp + rename at 0o600) and a single chained
// mutation queue so two concurrent requests can never clobber each other.
// Tags are pure user metadata: create/rename/merge/remove rewrite THIS
// document only and never touch a session (the 3.7.0 red line, plan §1.3).
// Extracted from the host bundle so it can be unit-tested directly — pass
// `dir` to point the index at a temp directory.
import { mkdir, rename as fsRename, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

// v4 is the first tag schema; it starts at 4 so it can never be confused with
// the recycle bin's v1/v2 or the star index's v3 documents even if a file is
// copied between them.
export const TAG_SCHEMA_VERSION = 4

// Caps (plan §1.3): ≤200 tag definitions globally, ≤10 tags per session,
// ≤24 code points per name. Array.from counting means one Chinese character
// (or one surrogate pair) counts as exactly 1, so the limit is honest for CJK.
export const MAX_TAGS = 200
export const MAX_TAGS_PER_SESSION = 10
export const MAX_TAG_NAME = 24

// Same state directory (and same env override) as the star index: all
// plugin-owned user marks live together in ~/.dsh/sessions-manager.
const DEFAULT_TAG_DIR = join(homedir(), '.dsh', 'sessions-manager')

// Random short ids: 't_' + 8 lowercase alphanumeric chars. Ids are minted
// once and never reused (rename only rewrites the name), so assignments can
// reference them safely. A collision (36^-8) is simply re-rolled.
const TAG_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

function randomSuffix() {
  const bytes = randomBytes(8)
  let out = ''
  for (const b of bytes) out += TAG_ID_ALPHABET[b % TAG_ID_ALPHABET.length]
  return out
}

function isSafeSessionId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\\/\0]/.test(value) && value !== '.' && value !== '..'
}

function isSafeTagId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 && !/[\\/\0]/.test(value)
}

function tagError(message, status, code) {
  const error = new Error(message)
  error.status = status
  if (code) error.code = code
  throw error
}

// Trim + shape-check a user-supplied tag name. Returns the cleaned name or
// null; the caller turns null into a 400. Slashes and NUL are rejected in
// line with this plugin's path-safety discipline for anything persisted.
export function normalizeTagName(value) {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (!name || /[\\/\0]/.test(name)) return null
  if (Array.from(name).length > MAX_TAG_NAME) return null
  return name
}

// Casefold key used for the global name-uniqueness rule.
function nameKey(name) {
  return name.toLocaleLowerCase()
}

/**
 * Coerce anything on disk (or nothing at all) into a valid v4 store.
 * Every entry is defended individually: a bad tag entry or a dangling
 * assignment (a tagId no longer defined) is dropped silently.
 */
export function normalizeTagStore(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null
  const tags = []
  const ids = new Set()
  const names = new Set()
  for (const item of (source && Array.isArray(source.tags) ? source.tags : [])) {
    if (!item || typeof item !== 'object') continue
    // Strings only: coercing a number into an id would let junk into the
    // index and mask a caller bug (same reasoning as normalizeStarStore).
    if (!isSafeTagId(item.id) || ids.has(item.id)) continue
    const name = normalizeTagName(item.name)
    if (name === null) continue
    const key = nameKey(name)
    if (names.has(key)) continue
    ids.add(item.id)
    names.add(key)
    const createdAt = Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : 0
    tags.push({ id: item.id, name, createdAt })
    if (tags.length >= MAX_TAGS) break
  }
  const assignments = {}
  const rawAssignments = source && source.assignments && typeof source.assignments === 'object' && !Array.isArray(source.assignments)
    ? source.assignments
    : null
  if (rawAssignments) {
    for (const [sid, value] of Object.entries(rawAssignments)) {
      if (!isSafeSessionId(sid) || !Array.isArray(value)) continue
      const kept = []
      const seen = new Set()
      for (const tagId of value) {
        // Unknown ids are dangling (tag deleted meanwhile, or a foreign file
        // was copied in): drop, never keep a ghost the UI could not render.
        if (!ids.has(tagId) || seen.has(tagId)) continue
        seen.add(tagId)
        kept.push(tagId)
        if (kept.length >= MAX_TAGS_PER_SESSION) break
      }
      if (kept.length) assignments[sid] = kept
    }
  }
  return { schemaVersion: TAG_SCHEMA_VERSION, tags, assignments }
}

/**
 * Open the tag index.
 * @param {object} [options]
 * @param {string} [options.dir] - Directory holding the index (tests inject a temp dir).
 * @param {string} [options.indexPath] - Full index path, overriding `dir`.
 */
export function createTagIndex(options = {}) {
  const dir = options.dir || process.env.DSH_SESSIONS_MANAGER_STAR_DIR || DEFAULT_TAG_DIR
  const indexPath = options.indexPath || join(dir, 'tags.json')
  let mutation = Promise.resolve()

  async function read() {
    try {
      return normalizeTagStore(JSON.parse(readFileSync(indexPath, 'utf8')))
    } catch {
      return normalizeTagStore(null)
    }
  }

  async function write(store) {
    await mkdir(dir, { recursive: true })
    const tmp = join(dir, `.tags-${process.pid}-${Date.now()}.tmp`)
    await writeFile(tmp, JSON.stringify(normalizeTagStore(store), null, 2), { encoding: 'utf8', mode: 0o600 })
    await fsRename(tmp, indexPath)
  }

  // Serialize read-modify-write cycles: every mutator sees the store as left by
  // the previous one, and a rejected mutator still keeps the chain alive (and
  // writes nothing — the checks throw before `write` is reached).
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

  function newTagId(store) {
    for (let i = 0; i < 16; i++) {
      const id = `t_${randomSuffix()}`
      if (!store.tags.some((t) => t.id === id)) return id
    }
    // Astronomically unreachable; honest failure beats a duplicate id.
    return tagError('无法生成标签 id（随机碰撞异常）', 500, 'DSM_TAG_ID_COLLISION')
  }

  /**
   * Define a new tag.
   * @param {string} rawName
   * @returns {Promise<{id: string, name: string, createdAt: number}>}
   * @throws 400 DSM_TAG_NAME_INVALID | 409 DSM_TAG_EXISTS | 409 DSM_TAG_LIMIT
   */
  async function create(rawName) {
    const name = normalizeTagName(rawName)
    if (name === null) tagError(`标签名无效（非空、不含斜杠、不超过 ${MAX_TAG_NAME} 个字符）`, 400, 'DSM_TAG_NAME_INVALID')
    const key = nameKey(name)
    return mutate((store) => {
      if (store.tags.some((t) => nameKey(t.name) === key)) tagError('同名标签已存在', 409, 'DSM_TAG_EXISTS')
      if (store.tags.length >= MAX_TAGS) tagError(`标签总数已达上限（${MAX_TAGS}）`, 409, 'DSM_TAG_LIMIT')
      const tag = { id: newTagId(store), name, createdAt: Date.now() }
      store.tags.push(tag)
      return tag
    })
  }

  /**
   * Rename a tag. Ids never change, so assignments survive a rename untouched.
   * A rename that only differs in case is legal (it's not a "duplicate" of
   * another tag); a collision with a DIFFERENT tag is rejected.
   * (Note: this method name is why the atomic rename above is `fsRename`.)
   * @throws 400 | 404 DSM_TAG_NOT_FOUND | 409 DSM_TAG_EXISTS
   */
  async function rename(id, rawName) {
    const name = normalizeTagName(rawName)
    if (name === null) tagError(`标签名无效（非空、不含斜杠、不超过 ${MAX_TAG_NAME} 个字符）`, 400, 'DSM_TAG_NAME_INVALID')
    const key = nameKey(name)
    return mutate((store) => {
      const tag = store.tags.find((t) => t.id === id)
      if (!tag) tagError('标签不存在', 404, 'DSM_TAG_NOT_FOUND')
      if (store.tags.some((t) => t.id !== tag.id && nameKey(t.name) === key)) tagError('同名标签已存在', 409, 'DSM_TAG_EXISTS')
      tag.name = name
      return tag
    })
  }

  /**
   * Fold the source tag into the target tag: every session carrying the
   * source also carries the target (deduped; the per-session cap truncates an
   * overflow rather than failing a half-applied merge — the UI must never be
   * stuck with a source it cannot remove). The source definition and all of
   * its assignments are then dropped. Sessions themselves are never touched.
   * @throws 400 DSM_TAG_INVALID | 404 DSM_TAG_NOT_FOUND
   */
  async function merge(fromId, toId) {
    if (!isSafeTagId(fromId) || !isSafeTagId(toId) || fromId === toId) {
      tagError('合并的源/目标标签无效或相同', 400, 'DSM_TAG_INVALID')
    }
    return mutate((store) => {
      if (!store.tags.some((t) => t.id === fromId) || !store.tags.some((t) => t.id === toId)) {
        tagError('标签不存在', 404, 'DSM_TAG_NOT_FOUND')
      }
      for (const [sid, list] of Object.entries(store.assignments)) {
        if (!list.includes(fromId)) continue
        const merged = [...new Set(list.filter((x) => x !== fromId).concat(toId))]
        store.assignments[sid] = merged.slice(0, MAX_TAGS_PER_SESSION)
      }
      store.tags = store.tags.filter((t) => t.id !== fromId)
      return { merged: true }
    })
  }

  /**
   * Drop a tag definition and every assignment to it. Idempotent: an unknown
   * id is a no-op success (the UI may race itself). NEVER touches a session.
   */
  function removeTag(id) {
    return mutate((store) => {
      if (isSafeTagId(id)) {
        store.tags = store.tags.filter((t) => t.id !== id)
        for (const [sid, list] of Object.entries(store.assignments)) {
          const kept = list.filter((x) => x !== id)
          if (kept.length) store.assignments[sid] = kept
          else delete store.assignments[sid]
        }
      }
      return { removed: true }
    })
  }

  /**
   * Replace the full tag set of one session (the UI always sends the complete
   * list; "assign" and "unassign" are just set-with-one-more / set-minus-one).
   * @param {string} sessionId
   * @param {string[]} tagIds
   * @returns {Promise<object>} the full assignments map after the change.
   * @throws 400 DSM_TAG_SESSION_INVALID | 400 DSM_TAG_IDS_INVALID
   *         | 400 DSM_TAG_UNKNOWN | 409 DSM_TAG_LIMIT
   */
  async function setTags(sessionId, tagIds) {
    if (!isSafeSessionId(sessionId)) tagError('无效的 sessionId', 400, 'DSM_TAG_SESSION_INVALID')
    if (!Array.isArray(tagIds)) tagError('tagIds 必须是数组', 400, 'DSM_TAG_IDS_INVALID')
    const seen = new Set()
    const wanted = []
    for (const v of tagIds) {
      // Strings only (same reasoning as the star index): a number in the list
      // is a caller bug, not data to coerce.
      if (!isSafeTagId(v)) tagError('无效的标签 id', 400, 'DSM_TAG_UNKNOWN')
      if (seen.has(v)) continue
      seen.add(v)
      wanted.push(v)
    }
    if (wanted.length > MAX_TAGS_PER_SESSION) tagError(`单个会话最多 ${MAX_TAGS_PER_SESSION} 个标签`, 409, 'DSM_TAG_LIMIT')
    return mutate((store) => {
      const known = new Set(store.tags.map((t) => t.id))
      const unknown = wanted.filter((id) => !known.has(id))
      if (unknown.length) tagError(`未知的标签 id：${unknown.join('、')}`, 400, 'DSM_TAG_UNKNOWN')
      if (wanted.length) store.assignments[sessionId] = [...wanted]
      else delete store.assignments[sessionId]
      return store.assignments
    })
  }

  // Drop assignments once their session is gone (purged / deleted), otherwise
  // the index would grow forever with ids that can never be listed again.
  function removeIds(ids) {
    const wanted = (Array.isArray(ids) ? ids : []).filter(isSafeSessionId)
    return mutate((store) => {
      for (const sid of wanted) delete store.assignments[sid]
      return store.assignments
    })
  }

  /**
   * @returns {Promise<{tags: Array<{id,name,createdAt}>, assignments: object}>}
   */
  async function list() {
    const store = await read()
    return { tags: store.tags, assignments: store.assignments }
  }

  return { read, write, mutate, list, create, rename, merge, removeTag, setTags, removeIds, indexPath, dir }
}
