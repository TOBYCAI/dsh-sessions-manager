// dsh-sessions-manager — host half.
//
// Serves /archived-sessions/* JSON routes (list / restore / restore-many /
// delete / delete-many / sessions / workspaces / move) over the host
// `webServer`. The browser Settings sections ("归档会话" & "移动会话") talk to
// these. Reads/writes the durable workspace archive set
// (workspaceRegistry + storageDomain), folds titles/dates/workspace tags from
// session persistence, physically removes a session's log file on delete, and
// relocates a conversation (session) between workspaces on move.
import { mkdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { rewriteFrame0Cwd } from './zstd-frame.js'
import { renderSessionMarkdown } from './markdown.js'
import { createStarIndex } from './star-index.js'
import { aggregateStorage } from './storage-stats.js'
import { createAutoArchiveStore, pickInactiveCandidates } from './auto-archive.js'
import { createSessionMetaCache, fingerprintOf } from './session-meta-cache.js'
import { createTitleIndexStore } from './title-persist-index.js'


export const name = 'dsh-sessions-manager'
export const inject = ['webServer', 'workspaceRegistry', 'sessionPersistence', 'sessionQuery', 'storageDomain']

const MAX_TITLE = 80
// Recycle bin (回收站): normal deletes land here instead of being erased.
const TRASH_DIR = process.env.DSH_SESSIONS_MANAGER_TRASH_DIR || join(homedir(), '.dsh', 'sessions-manager-trash')
const TRASH_INDEX = join(TRASH_DIR, 'index.json')
const TRASH_SCHEMA_VERSION = 2
const DEFAULT_TRASH_SETTINGS = Object.freeze({ retentionDays: 0 })
// -- per-session detail aggregation (v2.0: 取 Zephyr-vibe buildDetails 精华) --
// 识别“搜索/抓取”类工具，用来收集 fetch 记录。
const FETCH_TOOL_RE = /search|fetch|download|browse/i
const MAX_FETCHES = 12   // fetch 记录上限（防响应过大）
const MAX_FILES = 20     // write/edit 文件列表上限
const MAX_STORAGE_TOP = 50 // 存储排行返回上限（防响应过大）

function json(res, value, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function errorStatus(error) {
  return error && Number.isInteger(error.status) ? error.status : 500
}

async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    chunks.push(chunk)
    total += chunk.length
    if (total > 1 << 20) return null
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

function parseIds(body) {
  const raw = body && body.sessionIds
  if (!Array.isArray(raw)) return null
  const ids = []
  for (const v of raw) if (typeof v === 'string' && isSafeSessionId(v)) ids.push(v)
  return ids
}

function isSafeSessionId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\\/\0]/.test(value) && value !== '.' && value !== '..'
}

function requireSessionId(value) {
  if (!isSafeSessionId(value)) {
    const error = new Error('无效的 sessionId')
    error.status = 400
    throw error
  }
  return value
}

// Best-effort: figure out which conversation is the host's *currently active*
// one. DSH's in-memory session store (ctx.sessions) keeps EVERY instantiated
// session alive even after you switch away in the UI, so "is it in
// ctx.sessions" is NOT the same as "is it the active conversation". We probe a
// few known accessors for the active id; if none is available we return null
// and callers should treat the session as movable (the move path is
// crash-safe via backup+rollback and re-syncs the live object afterwards).
function getActiveSessionId(context) {
  try {
    const a = context.get('activeSession')
    if (a != null) return (a && a.id != null) ? a.id : (typeof a === 'string' ? a : null)
  } catch (e) { /* no such key */ }
  try {
    const c = context.get('currentSession')
    if (c != null) return (c && c.id != null) ? c.id : (typeof c === 'string' ? c : null)
  } catch (e) { /* no such key */ }
  try {
    const store = context.get('sessions')
    if (store && store.active && store.active.id != null) return store.active.id
  } catch (e) { /* no such key */ }
  return null
}

function foldTitle(events) {
  let found = null
  let firstUser = null
  for (const ev of events) {
    if (ev.type === 'session/title' && ev.data && typeof ev.data.title === 'string' && ev.data.title.length) {
      found = ev.data.title
    }
    if (firstUser === null && ev.type === 'user/message' && ev.data && Array.isArray(ev.data.content)) {
      const txt = ev.data.content.filter((b) => b && b.type === 'text').map((b) => b.text).filter(Boolean).join(' ').trim()
      if (txt) firstUser = txt
    }
  }
  return found || firstUser || null
}

export function apply(ctx) {
  const w = ctx.workspaceRegistry
  const sp = ctx.sessionPersistence
  const sq = ctx.sessionQuery
  const dom = () => ctx.storageDomain.get('workspace')
  const authorityTitleCache = new Map()
  // 会话原始元数据缓存（title / cwd / createdAt），按日志文件 (mtime, size) 指纹校验。
  // 见 src/session-meta-cache.js 的说明：列表构建原本每条会话都要整本解压日志，
  // 这个缓存让「日志没变」的会话直接跳过解码。
  const metaCache = createSessionMetaCache()
  // 持久标题索引（冷启动加速）：metaCache 是进程内的，重启即空——第一次列表
  // 仍要全库解码。索引按同样的 (mtime, size) 指纹存解码结果，指纹没变的会话
  // 重启后也直接复用。见 src/title-persist-index.js。
  const titleIndex = createTitleIndexStore({ dir: TRASH_DIR, file: join(TRASH_DIR, 'title-index.json') })

  // P4：对「内存缓存未命中」的会话查持久索引，指纹一致才可信。
  // 返回 Map<id, meta>；调用方应把命中条目回填 metaCache 并从 missing 里剔除。
  async function hydrateFromPersist(ids, statsById) {
    const hits = new Map()
    if (!ids || !ids.length) return hits
    let store
    try { store = await titleIndex.entries() } catch (e) { return hits }
    for (const id of ids) {
      const stat = statsById.get(id)
      const entry = store && store[id]
      if (!stat || !entry) continue
      const fp = fingerprintOf(stat)
      if (fp && entry.fingerprint === fp) {
        hits.set(id, { title: entry.title, cwd: entry.cwd, createdAt: entry.createdAt })
      }
    }
    return hits
  }

  // 把本批真正解码出的元数据异步回写持久索引（fire-and-forget：索引只是
  // 加速器，写失败不影响响应，队列内部已串行化 + 原子替换）。
  function persistDecoded(decoded, statsById) {
    if (!decoded || !decoded.size) return
    const batch = {}
    const now = Date.now()
    for (const [id, meta] of decoded) {
      const fp = fingerprintOf(statsById.get(id))
      if (!fp) continue
      batch[id] = { title: meta.title, cwd: meta.cwd, createdAt: meta.createdAt, fingerprint: fp, updatedAt: now }
    }
    if (!Object.keys(batch).length) return
    titleIndex.merge(batch).catch(() => {})
  }

  // 从投影快照里抽出元数据；快照缺失/异常时返回零值 meta（调用方决定兜底）。
  function metaFromSnapshot(o) {
    let title = null, createdAt = null, cwd = null
    if (o) {
      if (o.title && o.title.title) title = String(o.title.title)
      if (o.session) { cwd = o.session.cwd || null; createdAt = o.session.createdAt || null }
    }
    return { title, cwd, createdAt }
  }

  // 投影快照的两种返回形态都兼容：新版 runtime 返回 settled 结果
  // （{ status: 'fulfilled', value }），老版本直接返回快照本身。
  function unwrapSnapshot(result) {
    if (!result) return null
    if (result.status === 'fulfilled') return result.value || null
    if (result.status === 'rejected') return null
    return result
  }

  async function archivedState() {
    const d = dom()
    if (!d) throw new Error('workspace domain is not open')
    return d.global.get()
  }

  async function writeArchived(nextIds) {
    const d = dom()
    if (!d) throw new Error('workspace domain is not open')
    const cur = d.global.get()
    const next = Object.assign({}, cur, { archivedSessionIds: nextIds })
    await d.global.set(next)
    // Keep the registry's in-memory cache in sync so the live sidebar refreshes.
    if (w && 'state' in w) { try { w.state = next } catch (e) { /* best-effort */ } }
    return next
  }

  let archiveMutation = Promise.resolve()
  function mutateArchived(mutator) {
    const operation = archiveMutation.then(async () => {
      const state = await archivedState()
      const list = (state.archivedSessionIds || []).map(String)
      const result = await mutator(list)
      if (result.next) await writeArchived(result.next)
      return result.value
    })
    archiveMutation = operation.catch(() => {})
    return operation
  }

  let wsByPath = {}

  // 把原始元数据渲染成列表项。缓存命中与解码两条路径共用，保证输出一致。
  function buildItem(key, meta, usage, exposeUsage) {
    const cwd = meta.cwd || null
    const ws = cwd ? wsByPath[cwd] : undefined
    const title = meta.title || null
    const display = title ? (String(title).length > MAX_TITLE ? String(title).slice(0, MAX_TITLE) + '…' : String(title)) : null
    const base = {
      sessionId: key,
      title: display,
      createdAt: meta.createdAt || null,
      workspacePath: cwd,
      workspaceTitle: (ws && ws.title) ? ws.title : null,
      workspaceGone: !!(cwd && !ws),
      hasWorkspace: !!cwd,
    }
    // sizeBytes / updatedAt 只在需要的路由（存储分析 / 自动归档）里带上：
    // 它们本就来自 usage，附带输出对列表渲染无益。
    if (exposeUsage && usage) {
      if (usage.sizeById && usage.sizeById.has(key)) base.sizeBytes = usage.sizeById.get(key)
      if (usage.mtimeById && usage.mtimeById.has(key)) base.updatedAt = usage.mtimeById.get(key)
    }
    return base
  }

  // Resolve one session's display metadata.
  //
  // 成本模型（issue #1）：下面的解码路径会把整本 .jsonl.zstd 逐帧解压、逐行
  // JSON.parse，只为折叠出标题——大库上一次全表要几秒阻塞式 CPU。日志的
  // (mtime, size) 没变就意味着内容没变，折叠结果也不可能变，所以命中缓存时
  // 直接复用上次的元数据，跳过整本解码。
  //
  // opts.preloaded：批量投影（sq.readTitleSnapshots）已经拿到的快照；传了就不再
  // 对同一条日志做第二次单例投影——issue 里「一条日志在单次列表里被解码两次」
  // 正是这么来的。
  async function resolveOne(id, usage, opts = {}) {
    const key = String(id)
    const statInfo = usage ? { mtimeMs: usage.mtimeById.get(key), size: usage.sizeById.get(key) } : null
    const cached = metaCache.get(key, statInfo)
    if (cached) return buildItem(key, cached, usage, opts.exposeUsage)

    let meta = { title: null, cwd: null, createdAt: null }
    if (opts.preloaded !== undefined) {
      meta = metaFromSnapshot(unwrapSnapshot(opts.preloaded))
    } else if (typeof sq.readTitleSnapshot === 'function') {
      try { meta = metaFromSnapshot(await sq.readTitleSnapshot(id)) } catch (e) { /* fall back to raw log */ }
    }
    // 兜底：投影没给出标题或 cwd 时，才回退到整本解码（这条路径本身就贵，
    // 且结果同样会进缓存，下一次列表就不会再走一遍）。
    if (!meta.title || !meta.cwd) {
      try {
        const r = await sp.readFrom(id, 0)
        if (r.meta) {
          if (!meta.cwd) meta.cwd = r.meta.cwd || null
          if (!meta.createdAt) meta.createdAt = r.meta.createdAt || null
        }
        if (!meta.title && Array.isArray(r.events)) meta.title = foldTitle(r.events)
      } catch (e2) { /* keep what we have */ }
    }
    metaCache.set(key, statInfo, meta)
    // 本条是「真解码」出来的：交给调用方回写持久标题索引（P4 冷启动加速）。
    if (opts.collectDecoded && statInfo) opts.collectDecoded(key, meta)
    return buildItem(key, meta, usage, opts.exposeUsage)
  }

  // Disk usage + last-write time for every session, in one pass.
  //
  // sp.locate(header) resolves the log file behind a session header; a single
  // stat() then yields both its size and its mtime. mtime doubles as the
  // session's last-activity time — appending an event rewrites the log, so the
  // file's last write tracks the conversation's last turn. It errs safe: a log
  // we relocated (move) gets a fresh mtime and therefore looks *more* active
  // than it is, which can only delay an auto-archive, never cause a wrong one.
  // headers 可由调用方传入复用（列表构建里已经 sp.list() 过一次，避免重复列目录）。
  async function collectUsage(preloadedHeaders) {
    const sizeById = new Map()
    const mtimeById = new Map()
    let headers = null
    if (Array.isArray(preloadedHeaders)) headers = preloadedHeaders
    else { try { headers = await sp.list() } catch (e) { headers = [] } }
    if (!Array.isArray(headers)) headers = []
    const CHUNK = 8
    for (let i = 0; i < headers.length; i += CHUNK) {
      await Promise.all(headers.slice(i, i + CHUNK).map(async (header) => {
        const id = header && header.id != null ? String(header.id) : null
        if (!id) return
        try {
          const loc = sp.locate(header)
          if (!loc || typeof loc.path !== 'string' || !loc.path) return
          const st = await stat(loc.path)
          if (!st) return
          if (typeof st.size === 'number') sizeById.set(id, st.size)
          if (typeof st.mtimeMs === 'number' && st.mtimeMs > 0) mtimeById.set(id, Math.floor(st.mtimeMs))
        } catch (e) { /* best-effort: an unreadable log just stays unknown */ }
      }))
    }
    return { sizeById, mtimeById }
  }

  // Restore (unarchive) one session; throws on failure.
  async function restoreOne(sid) {
    requireSessionId(sid)
    return mutateArchived((list) => list.includes(sid)
      ? { next: list.filter((x) => x !== sid), value: { ok: true, restored: true } }
      : { next: null, value: { ok: true, restored: false } })
  }

  // ---- Recycle bin (回收站) helpers ----------------------------------------
  let trashMutation = Promise.resolve()
  function normalizeTrashStore(raw) {
    if (Array.isArray(raw)) return { schemaVersion: TRASH_SCHEMA_VERSION, settings: { ...DEFAULT_TRASH_SETTINGS }, items: raw, purgedSessionIds: [] }
    const settings = raw && typeof raw.settings === 'object' ? raw.settings : {}
    const retentionDays = Number.isInteger(settings.retentionDays) && settings.retentionDays >= 0 ? settings.retentionDays : 0
    return {
      schemaVersion: TRASH_SCHEMA_VERSION,
      settings: { retentionDays },
      items: raw && Array.isArray(raw.items) ? raw.items : [],
      purgedSessionIds: raw && Array.isArray(raw.purgedSessionIds) ? [...new Set(raw.purgedSessionIds.filter(isSafeSessionId).map(String))] : [],
    }
  }
  async function readTrashStore() {
    try { return normalizeTrashStore(JSON.parse(readFileSync(TRASH_INDEX, 'utf8'))) } catch (e) { return normalizeTrashStore(null) }
  }
  async function readTrash() { return (await readTrashStore()).items }
  async function writeTrashStore(store) {
    await mkdir(TRASH_DIR, { recursive: true })
    const tmp = join(TRASH_DIR, `.index-${process.pid}-${Date.now()}.tmp`)
    await writeFile(tmp, JSON.stringify(normalizeTrashStore(store), null, 2), { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, TRASH_INDEX)
  }
  function mutateTrash(mutator) {
    const operation = trashMutation.then(async () => {
      const store = await readTrashStore()
      const result = await mutator(store)
      await writeTrashStore(store)
      return result
    })
    trashMutation = operation.catch(() => {})
    return operation
  }

  // ---- Starred sessions (收藏, schema v3) -----------------------------------
  // User marks, kept in the plugin's own index (never touches DSH logs). Stars
  // survive archive & soft-delete — both are reversible — and are dropped only
  // when the session is really gone (purge, or externally removed; the latter
  // is caught by gcStars during list builds).
  const stars = createStarIndex()
  // Auto-archive settings live in their own schema-v4 store, off by default.
  const autoArchive = createAutoArchiveStore()

  async function gcStars(validIds) {
    try {
      const store = await stars.read()
      const valid = new Set(validIds.map(String))
      const gone = store.starredSessionIds.filter((id) => !valid.has(id))
      if (gone.length) await stars.removeIds(gone)
    } catch (e) { /* best-effort */ }
  }

  // Soft-delete one session: record it in the recycle-bin index but KEEP its
  // log in the original workspace directory. Moving the file out (and detaching
  // it from the workspace) orphaned the session into DSH's "未分组" group and
  // made restore land in 未分组 instead of the original workspace — so we leave
  // the file where it is and let the sidebar DOM shim hide the row instead.
  async function deleteOne(sid) {
    requireSessionId(sid)
    // Soft-delete is always allowed — including the currently-active conversation.
    // The log file stays in its original workspace dir (recorded in the 回收站
    // index below), so the live session is unaffected and the entry stays
    // recoverable from 回收站. (Move, by contrast, physically relocates the file
    // and still guards the active session in moveTargetWorkspace.)
    let header = null
    let cwd = null
    let title = null
    let removedPath = null
    try {
      const headers = await sp.list()
      header = headers.find((h) => String(h.id) === sid) || null
      if (header) {
        const loc = sp.locate(header)
        if (loc && typeof loc.path === 'string') removedPath = loc.path
        cwd = header.cwd || null
        title = header.title || (header.meta && header.meta.title) || null
      }
      if (!title) {
        const r = await sp.readFrom(sid, 0)
        if (r && r.meta) { if (!cwd) cwd = r.meta.cwd; title = foldTitle(r.events) }
      }
    } catch (e) { /* best-effort */ }
    // Record in the trash index only — the log stays in its workspace dir.
    if (!header && !removedPath) {
      const error = new Error('找不到该会话')
      error.status = 404
      throw error
    }
    const archived = await mutateArchived((list) => ({ next: null, value: list.includes(sid) })).catch(() => false)
    await mutateTrash((store) => {
      const entry = {
        sessionId: sid, title: title || cwd || sid, cwd: cwd || null,
        header: header || null, originalPath: removedPath || null,
        sizeBytes: header && typeof header.size === 'number' ? header.size : null,
        wasArchived: archived, deletedAt: Date.now(),
      }
      const at = store.items.findIndex((t) => String(t.sessionId) === sid)
      if (at >= 0) store.items[at] = entry
      else store.items.push(entry)
      store.purgedSessionIds = store.purgedSessionIds.filter((id) => id !== sid)
    })
    return { ok: true, trashed: true }
  }

  // Restore a trashed session: the log never left its original workspace dir,
  // so we just drop it from the recycle-bin index and the sidebar reveals it in
  // its original workspace (no move / no re-attach needed).
  async function restoreFromTrash(sid) {
    requireSessionId(sid)
    await mutateTrash(async (store) => {
      const entry = store.items.find((t) => String(t.sessionId) === sid)
      if (!entry) { const error = new Error('回收站中找不到该会话'); error.status = 404; throw error }
      // Restore the pre-delete archive state before removing the durable trash
      // entry. If this fails, mutateTrash does not write and the item remains
      // recoverable instead of disappearing into an inconsistent state.
      if (entry.wasArchived === false) await restoreOne(sid)
      store.items = store.items.filter((t) => String(t.sessionId) !== sid)
      store.purgedSessionIds = store.purgedSessionIds.filter((id) => id !== sid)
    })
    return { ok: true, restored: true }
  }

  // Permanently erase a trashed session: physically delete its log (still in
  // the original workspace dir) and detach it from any workspace so DSH drops it.
  async function purgeFromTrash(sid) {
    requireSessionId(sid)
    let purged = false
    await mutateTrash(async (store) => {
      const entry = store.items.find((t) => String(t.sessionId) === sid)
      if (!entry) { const error = new Error('回收站中找不到该会话'); error.status = 404; throw error }
      let target = null
      try {
        const headers = await sp.list()
        const current = headers.find((h) => String(h.id) === sid)
        const located = current && sp.locate(current)
        if (located && typeof located.path === 'string') target = located.path
      } catch (e) {}
      if (!target && typeof entry.originalPath === 'string') target = entry.originalPath
      // JSONL persistence stores logs as
      //   .../<sessionId>/session.jsonl.zstd
      // Older backends may instead include the id in the filename itself.
      // Accept both layouts, but reject every unrelated path before unlink.
      const targetOwnsSession = target && (basename(dirname(target)) === sid || basename(target).includes(sid))
      if (target && !targetOwnsSession) {
        const error = new Error('日志路径与会话 ID 不匹配，已停止永久删除')
        error.status = 409
        throw error
      }
      // Persist the tombstone before any irreversible work. A crash after this
      // point may leave the trash item retryable, but can never resurrect the
      // session in a later list baseline.
      if (!store.purgedSessionIds.includes(sid)) store.purgedSessionIds.push(sid)
      await writeTrashStore(store)
      // A freshly-created or recently-opened Session can remain resident after
      // its file is unlinked. Flush once, then use SessionStore's entered-record
      // detach capability so DSH emits host/session-removed and the client list
      // drops the row instead of resurrecting it from live memory.
      try {
        const sessions = ctx.get('sessions')
        const liveSession = sessions && sessions.get && sessions.get(sid)
        if (liveSession && typeof sessions.flush === 'function') await sessions.flush(liveSession)
        const entered = sessions && sessions.store && sessions.store.get && sessions.store.get(sid)
        if (liveSession && (!entered || typeof entered.detach !== 'function')) throw new Error('宿主未提供 live Session detach 能力')
        if (entered && typeof entered.detach === 'function') entered.detach()
        // session/disposed starts an asynchronous persistence retirement. Wait
        // for it before unlinking, otherwise its final drain can race the file
        // deletion and briefly (or permanently) republish an orphan that the
        // official sidebar groups under “未分组”.
        const retirement = sp && sp.retirements && sp.retirements.get && sp.retirements.get(sid)
        if (retirement && typeof retirement.then === 'function') await retirement
      } catch (e) {
        const error = new Error('无法从宿主内存移除会话，已停止永久删除：' + String((e && e.message) || e))
        error.status = 409
        throw error
      }
      if (target) {
        try { await unlink(target) } catch (e) { if (e && e.code !== 'ENOENT') throw new Error('删除文件失败：' + String((e && e.message) || e)) }
      }
      try { for (const ent of w.list()) { if (ent.sessionIds.includes(sid)) { try { await ent.detachSession(sid) } catch (e) {} } } } catch (e) {}
      try { if (w.sessionPaths && w.sessionPaths.delete) w.sessionPaths.delete(sid) } catch (e) {}
      try { if (w.headers && w.headers.delete) w.headers.delete(sid) } catch (e) {}
      await restoreOne(sid)
      // Rebuild from the post-unlink disk baseline before reporting success.
      // Merely deleting the two Maps above does not notify/rebuild Workspace
      // entities, leaving the client with an orphaned “未分组” snapshot.
      try { await reindexRegistry() } catch (e) { /* tombstone still prevents resurrection */ }
      store.items = store.items.filter((t) => String(t.sessionId) !== sid)
      purged = true
    })
    if (!purged) throw new Error('彻底删除失败')
    stars.removeIds([sid]).catch(() => {})
    return { ok: true, purged: true }
  }

  async function trashSettings(next) {
    if (next === undefined) return (await readTrashStore()).settings
    const days = Number(next.retentionDays)
    if (!Number.isInteger(days) || ![0, 7, 30, 90].includes(days)) {
      const error = new Error('retentionDays 仅支持 0、7、30、90')
      error.status = 400
      throw error
    }
    await mutateTrash((store) => { store.settings = { retentionDays: days } })
    return (await readTrashStore()).settings
  }

  async function cleanupExpiredTrash() {
    const store = await readTrashStore()
    const days = store.settings.retentionDays
    if (!days) return 0
    const cutoff = Date.now() - days * 86400000
    const ids = store.items.filter((item) => Number(item.deletedAt) > 0 && Number(item.deletedAt) < cutoff).map((item) => String(item.sessionId))
    let count = 0
    for (const sid of ids) { try { await purgeFromTrash(sid); count++ } catch (e) {} }
    return count
  }

  // ---- "move conversation between workspaces" helper -----------------------
  // DSH binds a conversation to the workspace whose canonical directory path
  // equals the session's stored cwd. Moving it therefore means: (1) adopt the
  // target path as a workspace (create if needed), (2) durably relocate the
  // session's log so its header carries the new cwd, and (3) reassign the
  // workspace membership (detach everywhere, attach to target). The log
  // relocation goes through the persistence service's own encoder (handles the
  // zstd artifact encoding) with a backup + rollback so a failure never leaves
  // the session half-moved.

  async function moveTargetWorkspace(rawPath) {
    if (typeof rawPath !== 'string' || !rawPath.trim()) throw new Error('缺少目标工作区路径')
    let p = String(rawPath).trim()
    if (p.startsWith('~/')) p = join(homedir(), p.slice(2))
    if (!isAbsolute(p)) p = join(homedir(), p)
    let canonical = null
    try { canonical = await realpath(p) } catch (e) { canonical = null }
    if (canonical === null) {
      await mkdir(p, { recursive: true })
      canonical = await realpath(p)
    }
    return { canonical, entity: await w.create(canonical, basename(canonical) || 'workspace') }
  }

  async function moveOne(sid, targetPath) {
    // Only block the *active* conversation. ctx.sessions keeps instantiated
    // sessions alive after you switch away, so the old check (sessions.get(sid))
    // wrongly rejected every opened session — you could never move one you'd
    // merely looked at. When the host exposes no active-session accessor we
    // can't prove activeness, so we allow the move; the relocation below is
    // crash-safe (backup + rollback) and re-syncs the live object.
    const activeId = getActiveSessionId(ctx)
    if (activeId != null && String(activeId) === String(sid)) {
      throw new Error('该会话当前处于打开状态，请先切换到别的会话再移动。')
    }
    const r = await sp.readFrom(sid, 0)
    if (!r || !r.meta) throw new Error('无法读取该会话的日志')
    const meta = r.meta
    const events = r.events
    const oldCwd = meta.cwd || null

    const { canonical, entity: target } = await moveTargetWorkspace(targetPath)

    if (oldCwd) {
      let oldCanon = null
      try { oldCanon = await realpath(oldCwd) } catch (e) { oldCanon = null }
      if (oldCanon === canonical) {
        return { ok: true, already: true, workspaceId: target.id, workspaceTitle: target.title }
      }
    }

    const newHeader = Object.assign({}, meta, { cwd: canonical })

    // 1) Decide relocation strategy. `sessionPersistence.create()` rejects
    // ("already exists in this backend") for ANY session the host has
    // instantiated into its in-memory `states` — and DSH instantiates *every*
    // session it can find on disk at startup, including ARCHIVED ones. So a
    // supposedly "closed" archived session is NOT safe for the create()+append()
    // path; create() will throw. The only universally safe move is to physically
    // relocate the on-disk log (rewriting frame0's cwd) and redirect the live
    // object + persistence state. We still attempt create()+append() as the
    // fast path for genuinely-virgin session ids, but on an already-exists
    // collision we fall back to the relocate path. That covers live, archived,
    // and restored sessions alike.
    const live = ctx.get('sessions')
    const liveObj = live && live.get && live.get(sid)
    const isOpen = !!liveObj

    const ALREADY_EXISTS_RE = /already exists in this backend/i

    // Physically relocate a session's on-disk log to `newHeader`'s cwd,
    // rewriting frame0's cwd so sp.list()/reindex attribute it correctly.
    // Returns true if a relocation actually happened.
    const relocateLog = async (header, newHeaderObj) => {
      const oldPath = locatePath(header)
      const newPath = locatePath(newHeaderObj)
      if (!oldPath || !newPath || oldPath === newPath) return false
      const backupPath = `${oldPath}.move-backup-${Date.now()}`
      try {
        // Ensure the destination project directory exists (rename does not
        // create it). Without this, the rename silently no-ops on ENOENT and
        // the log stays put while workspace.json is wrongly updated.
        await mkdir(dirname(newPath), { recursive: true })
        await rename(oldPath, backupPath)             // current log to safety
        await rewriteFrame0Cwd(backupPath, canonical) // frame0 cwd -> newPath
        await rename(backupPath, newPath)             // relocate to the new workspace dir
      } catch (e) {
        try { await rename(backupPath, oldPath) } catch (_) {}
        if (e && e.code !== 'ENOENT') throw e
        return false
      }
      return true
    }

    const locatePath = (header) => {
      let fn = null
      try { if (typeof sp.locate === 'function') fn = sp.locate.bind(sp) } catch (e) {}
      if (!fn && sp.backend && typeof sp.backend.locate === 'function') fn = sp.backend.locate.bind(sp.backend)
      if (!fn) return null
      try {
        const loc = fn(header)
        if (loc && typeof loc.path === 'string') return loc.path
        if (typeof loc === 'string') return loc
      } catch (e) {}
      return null
    }

    // Rewriting frame0's cwd now lives in src/zstd-frame.js so it can be
    // regression-tested directly. See that module for why frame boundaries are
    // validated by decompression and why a non-session frame0 is rejected
    // instead of rewritten.

    if (isOpen) {
      // Live session: relocate the on-disk log (rewriting frame0's cwd to the
      // new path) and redirect the live object + persistence state. We must
      // rewrite frame0, not just rename: sp.list() reads frame0's cwd from
      // disk, and WorkspaceEntity.sessionIds filters by that exact cwd. A bare
      // rename would leave frame0 pointing at the old workspace, so reindex /
      // restart would keep attributing the session to the wrong workspace.
      await relocateLog(meta, newHeader)
      // Redirect the persistence state's cwd so future appends land in newPath.
      try {
        const st = sp.states && sp.states.get && sp.states.get(sid)
        if (st && st.meta) st.meta = Object.assign({}, st.meta, { cwd: canonical })
      } catch (e) { /* best-effort */ }
    } else {
      // Closed session: try the fast create()+append() path first. But DSH
      // instantiates *all* on-disk sessions (including archived ones) into its
      // in-memory states at startup, so create() usually throws
      // "already exists in this backend". On that collision we fall back to a
      // physical relocate of the existing log (rewriting frame0's cwd), which
      // is safe and needs no create().
      let oldPath = null
      try {
        const loc = locatePath(meta)
        if (loc && typeof loc === 'string') oldPath = loc
        else if (loc && loc.path) oldPath = loc.path
      } catch (e) { oldPath = null }

      if (typeof sp.create !== 'function' || typeof sp.append !== 'function') {
        // No create primitive: must relocate the existing log directly.
        await relocateLog(meta, newHeader)
      } else {
        const backupPath = oldPath ? `${oldPath}.move-backup-${Date.now()}` : null
        if (backupPath) { try { await rename(oldPath, backupPath) } catch (e) { if (e && e.code !== 'ENOENT') throw new Error('移动失败：无法备份旧的会话日志') } }
        const restore = async () => { if (backupPath) { try { await rename(backupPath, oldPath) } catch (_) {} } }
        try {
          await sp.create(newHeader)
          await sp.append(sid, events)
          const check = await sp.readFrom(sid, 0)
          if (!check || !check.meta || check.meta.cwd !== canonical) {
            throw new Error('移动后校验失败：会话工作目录未正确更新')
          }
          if (backupPath) { try { await unlink(backupPath) } catch (e) {} }
        } catch (e) {
          if (ALREADY_EXISTS_RE.test(String((e && e.message) || e))) {
            // Collision: the session is already materialized in states (archived
            // or previously opened). Fall back to physically relocating the log.
            await restore()
            await relocateLog(meta, newHeader)
          } else {
            await restore()
            throw new Error('移动会话日志失败：' + String((e && e.message) || e))
          }
        }
      }
    }

    // Keep the live (in-memory) session object consistent with the relocated
    // log so the host doesn't keep appending to the old path. This MUST happen
    // before attachSession(): WorkspaceEntity.attachSession() validates the
    // session by reading live.header first, and if it still carries the old cwd
    // the realpath check will fail on the old (now missing) directory.
    try {
      if (liveObj) {
        if ('header' in liveObj) liveObj.header = newHeader
        if ('cwd' in liveObj) liveObj.cwd = canonical
        if ('meta' in liveObj) liveObj.meta = newHeader
      }
    } catch (e) { /* best-effort */ }

    // 2) Reassign workspace membership (durable records + in-memory index).
    for (const ent of w.list()) {
      try { await ent.detachSession(sid) } catch (e) { /* ignore */ }
    }
    if (w.headers && typeof w.headers.set === 'function') w.headers.set(sid, newHeader)
    if (w.sessionPaths && typeof w.sessionPaths.set === 'function') w.sessionPaths.set(sid, canonical)
    await target.attachSession(sid)

    // Verify the membership actually landed on the target workspace. DSH's
    // WorkspaceEntity.attachSession persists asynchronously; if it silently
    // no-ops (e.g. the session's durable cwd still points elsewhere) the UI
    // would show "moved" while the sidebar keeps the old grouping. Fail loud
    // instead of returning a fake success.
    const verified = (() => {
      try { return target.sessionIds.includes(sid) } catch (e) { return false }
    })()
    if (!verified) {
      throw new Error('移动后校验失败：会话未出现在目标工作区，请重试或重启 DSH。')
    }

    return {
      ok: true,
      moved: true,
      workspaceId: target.id,
      workspaceTitle: target.title,
      workspacePath: canonical,
    }
  }

  // Force the host's WorkspaceRegistry to rebuild its in-memory sessionPath
  // index from the durable persistence headers. DSH's WorkspaceEntity.sessionIds
  // is a *getter* that filters record.sessionIds by `host.sessionPath(id) ===
  // record.path`; that sessionPath Map is only repopulated at startup (bootstrap
  // + indexHeaders). So even after a successful move writes the durable cwd,
  // the running process keeps attributing the session to its OLD workspace until
  // a restart — unless we reindex here. Calling this right after move makes the
  // sidebar reflect the new grouping with NO restart required.
  async function reindexRegistry() {
    const reg = w
    if (!reg || typeof reg.replaceHeaderIndex !== 'function') return false
    let headers = null
    try { headers = await sp.list() } catch (e) { headers = null }
    if (!headers || !Array.isArray(headers)) return false
    await reg.replaceHeaderIndex(headers)
    if (typeof reg.rebuildEntities === 'function') reg.rebuildEntities()
    return true
  }

  async function listWorkspaces() {
    const out = []
    try {
      for (const ent of w.list()) out.push({ workspaceId: ent.id, title: ent.title, path: ent.path })
    } catch (e) { /* ignore */ }
    return out
  }

  // Archive (hide) one session: adds its id to the durable archive set so it
  // is dropped out of the sidebar. DSH requires the session to exist (live or
  // persisted) — a genuine miss surfaces as an error.
  async function archiveOne(sid) {
    requireSessionId(sid)
    return mutateArchived(async (list) => {
      if (list.includes(sid)) return { next: null, value: { ok: true, archived: false } }
      await w.archiveSession(sid)
      // archiveSession owns the durable write; keep this operation serialized
      // with restoreOne so two requests cannot overwrite each other's state.
      return { next: null, value: { ok: true, archived: true } }
    })
  }

  // 批量投影：一次调用把多条会话的标题/header 拿出来，避免逐条触发整本解码。
  // 老 runtime 没有 readTitleSnapshots 时返回空 Map，调用方自然回退到逐条投影
  // （功能不受影响，只是少了这层优化——插件不能假设对方的 runtime 版本）。
  async function projectTitles(ids) {
    const out = new Map()
    if (!ids || !ids.length) return out
    if (typeof sq.readTitleSnapshots !== 'function') return out
    try {
      const results = await sq.readTitleSnapshots(ids)
      if (!Array.isArray(results)) return out
      results.forEach((result, index) => {
        const id = String(ids[index])
        out.set(id, unwrapSnapshot(result))
      })
    } catch (e) { /* 批量失败：逐条回退 */ }
    return out
  }

  // opts.usage: expose sizeBytes + updatedAt on each item (storage analysis and
  // the auto-archive sweep need them; the panel list does not).
  //
  // 性能要点（issue #1）：
  //   1. sp.list() 只调一次（原先列了两遍目录）
  //   2. 无条件做一遍 stat——一次 stat 是微秒级，而它算出的 (mtime, size) 指纹
  //      是元数据缓存能否跳过整本解码的前提，收益远大于成本
  //   3. 未命中缓存的会话走**一次**批量投影（sq.readTitleSnapshots），而不是逐条
  async function allSessionItems(opts = {}) {
    let headers = []
    let headersOk = false
    try {
      headers = await sp.list()
      headersOk = Array.isArray(headers)
      if (!headersOk) headers = []
    } catch (e) { headers = [] }
    let live = ctx.get('sessions')
    const ids = headers.map((h) => String(h.id))
    if (live) { try { live.list().forEach((s) => { const sid = String(s.id); if (!ids.includes(sid)) ids.push(sid) }) } catch (e) { /* ignore */ } }
    // Exclude sessions already moved to the recycle bin (软删除): they live in
    // 回收站, not in 会话管理, so the panel won't re-list them after a delete.
    let hiddenIds = new Set()
    try {
      const store = await readTrashStore()
      hiddenIds = new Set([...store.items.map((t) => String(t.sessionId)), ...store.purgedSessionIds.map(String)])
    } catch (e) {}
    const visibleIds = ids.filter((id) => !hiddenIds.has(id))
    wsByPath = {}
    try { for (const ent of w.list()) wsByPath[ent.path] = ent } catch (e) { wsByPath = {} }
    const currentArchived = new Set((await archivedState().catch(() => ({ archivedSessionIds: [] }))).archivedSessionIds || [])
    const items = []
    const usage = await collectUsage(headers)
    // 先按指纹把「缓存命中」与「需要解码」分开，只对后者做批量投影。
    const statsById = new Map(visibleIds.map((id) => [id, { mtimeMs: usage.mtimeById.get(id), size: usage.sizeById.get(id) }]))
    const { cached, missing } = metaCache.partition(visibleIds, statsById)
    // P4：missing 里先查持久标题索引（冷启动跳过整本解码），命中的回填内存缓存。
    const persisted = await hydrateFromPersist(missing, statsById)
    for (const [id, meta] of persisted) metaCache.set(id, statsById.get(id), meta)
    const stillMissing = missing.filter((id) => !persisted.has(id))
    const snapshotById = await projectTitles(stillMissing)
    const decoded = new Map()
    const collectDecoded = (id, meta) => { decoded.set(id, meta) }
    const CHUNK = 6
    for (let i = 0; i < visibleIds.length; i += CHUNK) {
      // Arrow wrapper on purpose: Array#map passes (value, index, array), and
      // resolveOne's second and third arguments are fixed here.
      const res2 = await Promise.all(visibleIds.slice(i, i + CHUNK).map((id) => resolveOne(id, usage, {
        exposeUsage: !!(opts && opts.usage),
        preloaded: snapshotById.has(id) ? snapshotById.get(id) : undefined,
        collectDecoded,
      })))
      for (const it of res2) items.push({ ...it, archived: currentArchived.has(it.sessionId) })
    }
    persistDecoded(decoded, statsById)
    // Annotate stars; GC only when we have a trustworthy id baseline, so a
    // failing sp.list() can never wipe the whole index.
    let starredSet = new Set()
    try { starredSet = new Set((await stars.read()).starredSessionIds) } catch (e) {}
    for (const it of items) it.starred = starredSet.has(String(it.sessionId))
    if (headersOk) await gcStars(ids)
    return items
  }

  // ---- Storage usage + auto-archive ---------------------------------------

  // Read-only rollup: per-workspace totals plus the largest sessions. The
  // aggregation itself is a pure function (src/storage-stats.js).
  async function buildStorage(opts = {}) {
    const items = await allSessionItems({ usage: true })
    const raw = Number(opts && opts.topN)
    const topN = Number.isInteger(raw) && raw > 0 ? Math.min(raw, MAX_STORAGE_TOP) : 10
    return aggregateStorage(items, { topN })
  }

  // Archive conversations that have been idle past the configured window.
  //
  // Deliberately lazy — there is no timer. The sweep runs when the panel reads
  // its settings (and on demand), at most once a day: a background interval
  // would keep the host process alive and would archive conversations while
  // nobody is looking at the panel.
  async function autoArchiveSweep(opts = {}) {
    const store = await autoArchive.read()
    const days = store.settings.inactiveDays
    if (!days) return { ok: true, skipped: 'disabled', archived: 0 }
    const now = Date.now()
    if (!(opts && opts.force) && autoArchive.isFresh(store, now)) {
      return { ok: true, skipped: 'throttled', archived: 0, lastRunAt: store.lastRunAt, lastArchivedCount: store.lastArchivedCount }
    }
    const items = await allSessionItems({ usage: true })
    const candidates = pickInactiveCandidates(items, {
      inactiveDays: days,
      skipStarred: store.settings.skipStarred,
      activeSessionId: getActiveSessionId(ctx),
      now,
    })
    let archived = 0
    const failed = []
    for (const sid of candidates) {
      try {
        const result = await archiveOne(sid)
        if (result && result.archived) archived++
      } catch (e) {
        failed.push({ sessionId: sid, error: String((e && e.message) || e) })
      }
    }
    await autoArchive.recordRun(archived, now)
    return { ok: true, archived, candidates: candidates.length, failed, lastRunAt: now }
  }

  // 侧栏权威数据：标题 + 回收站 id 集合。
  //
  // 标题原先「首次调用算一次就永久缓存」，日志之后再变也不会更新——标题会陈旧。
  // 现在复用 metaCache：每次调用只 stat 一遍，日志没变直接取缓存，变了才重解码，
  // 既不会陈旧也不会回到「每次全量解码」。
  async function sidebarAuthority() {
    const ids = []
    let headers = []
    try { headers = await sp.list() } catch (e) { headers = [] }
    if (!Array.isArray(headers)) headers = []
    for (const header of headers) ids.push(String(header.id))
    const sessions = ctx.get('sessions')
    try { if (sessions) sessions.list().forEach((session) => { const sid = String(session.id); if (!ids.includes(sid)) ids.push(sid) }) } catch (e) {}
    const store = await readTrashStore()
    if (ids.length) {
      const usage = await collectUsage(headers)
      const statsById = new Map(ids.map((id) => [id, { mtimeMs: usage.mtimeById.get(id), size: usage.sizeById.get(id) }]))
      const { cached, missing } = metaCache.partition(ids, statsById)
      // P4：与列表构建共用持久标题索引，冷启动零解码。
      const persisted = await hydrateFromPersist(missing, statsById)
      for (const [id, meta] of persisted) metaCache.set(id, statsById.get(id), meta)
      const rest = missing.filter((id) => !persisted.has(id))
      const snapshotById = await projectTitles(rest)
      const decoded = new Map()
      const collectDecoded = (id, meta) => { decoded.set(id, meta) }
      for (const id of ids) {
        let meta = cached.get(id) || persisted.get(id) || null
        if (!meta) {
          const snapshot = snapshotById.has(id)
            ? snapshotById.get(id)
            : (typeof sq.readTitleSnapshot === 'function' ? await sq.readTitleSnapshot(id).catch(() => null) : null)
          const next = metaFromSnapshot(snapshot)
          metaCache.set(id, statsById.get(id), next)
          if (statsById.get(id)) collectDecoded(id, next)
          meta = next
        }
        if (meta && meta.title) authorityTitleCache.set(id, String(meta.title))
      }
      persistDecoded(decoded, statsById)
    }
    return {
      titles: Object.fromEntries(authorityTitleCache),
      trashedSessionIds: store.items.map((item) => String(item.sessionId)),
      purgedSessionIds: store.purgedSessionIds.map(String),
    }
  }

  // 聚合一条会话的详情（磁盘占用 / 轮次·步数·消息数 / 工具统计 / fetch /
  // write/edit 文件 / 血统 parent/children/subagents）。live 与持久化会话都可读。
  // 所有统计对未知事件类型容错；fetch 与 files 做上限截断，files 用 stat 过滤
  // 磁盘上已不存在的路径，避免详情面板列出已删除文件。
  async function buildDetails(sid) {
    const sessions = ctx.get('sessions')
    const live = sessions && sessions.get(sid)
    let meta = null
    let events = []
    if (live !== void 0) {
      meta = (live && live.header) || null
      try { events = Array.isArray(live.events) ? [...live.events] : [] } catch (e) { events = [] }
    } else {
      const r = await sp.readFrom(sid, 0)
      if (!r || !r.meta) throw new Error('找不到该会话的记录（会话不存在）')
      meta = r.meta
      events = Array.isArray(r.events) ? r.events : []
    }
    let sizeBytes = null
    try {
      // rc.8 的 sessionPersistence 后端没有 artifactInfo；用 locate(meta) 拿日志
      // 文件真实路径后 stat 出字节数（磁盘占用）。
      const loc = sp.locate(meta)
      if (loc && typeof loc.path === 'string' && loc.path) {
        const st = await stat(loc.path)
        if (st && typeof st.size === 'number') sizeBytes = st.size
      }
    } catch (e) { sizeBytes = null }
    let lastTime = typeof meta && typeof meta.createdAt === 'number' ? meta.createdAt : 0
    const fileSet = new Map()
    const stats = {
      turns: 0, steps: 0, userMessages: 0, assistantMessages: 0,
      toolCalls: 0, attachments: 0, toolCounts: {}, fetches: [],
    }
    const turnSeen = new Set()
    const stepSeen = new Set()
    for (const ev of events) {
      if (ev && typeof ev.time === 'number' && ev.time > lastTime) lastTime = ev.time
      const d = (ev && ev.data && typeof ev.data === 'object') ? ev.data : {}
      const type = ev && ev.type
      switch (type) {
        case 'turn/start':
          if (typeof d.turn === 'number') turnSeen.add(d.turn)
          break
        case 'step/start':
          if (typeof d.step === 'number') stepSeen.add(d.step)
          break
        case 'user/message':
          stats.userMessages++
          if (Array.isArray(d.content)) for (const b of d.content) if (b && b.type === 'image') stats.attachments++
          break
        case 'assistant/message':
          stats.assistantMessages++
          break
        case 'tool/call': {
          stats.toolCalls++
          const tn = typeof d.name === 'string' && d.name ? d.name : 'tool'
          stats.toolCounts[tn] = (stats.toolCounts[tn] || 0) + 1
          if (FETCH_TOOL_RE.test(tn)) {
            let query
            try {
              const a = typeof d.arguments === 'string' ? JSON.parse(d.arguments) : d.arguments
              query = typeof a?.query === 'string' ? a.query : typeof a?.url === 'string' ? a.url : typeof a?.q === 'string' ? a.q : undefined
            } catch (e) { query = undefined }
            stats.fetches.push({ tool: tn, ...(query && query !== '' ? { query } : {}) })
          }
          if (tn === 'write' || tn === 'edit') {
            let argsJ
            try { argsJ = typeof d.arguments === 'string' ? JSON.parse(d.arguments) : d.arguments } catch (e) { break }
            const fp = argsJ && typeof argsJ.file_path === 'string' && argsJ.file_path ? argsJ.file_path : undefined
            if (fp !== undefined && !fileSet.has(fp)) fileSet.set(fp, tn)
          }
          break
        }
      }
    }
    stats.turns = turnSeen.size
    stats.steps = stepSeen.size
    if (stats.fetches.length > MAX_FETCHES) stats.fetches = stats.fetches.slice(0, MAX_FETCHES)
    const fileEntries = [...fileSet.entries()].slice(0, MAX_FILES * 2)
    const exists = await Promise.all(fileEntries.map(([p]) => stat(p).then(() => true).catch(() => false)))
    const files = fileEntries
      .filter((_, i) => exists[i])
      .map(([path, tool]) => ({ path, tool }))
      .slice(0, MAX_FILES)
    // lineage：分叉子会话（非 subagent）与子代理（origin==='subagent'），source 去重。
    const lineage = {
      parentSessionId: (meta && typeof meta.parentSession === 'string') ? meta.parentSession : null,
      children: [],
      subagents: [],
    }
    const childrenSet = new Set()
    const subagentSet = new Set()
    try {
      if (typeof sp.list === 'function') {
        for (const h of await sp.list()) {
          if (String(h.parentSession) !== String(sid)) continue
          if (h.origin === 'subagent') subagentSet.add(h.id); else childrenSet.add(h.id)
        }
      }
    } catch (e) { /* best-effort */ }
    if (sessions) {
      try {
        sessions.list().forEach((s) => {
          if (String(s.header.parentSession) !== String(sid)) return
          if (s.header.origin === 'subagent') subagentSet.add(s.id); else childrenSet.add(s.id)
        })
      } catch (e) { /* best-effort */ }
    }
    lineage.children = [...childrenSet]
    lineage.subagents = [...subagentSet]
    return {
      sessionId: sid,
      sizeBytes,
      createdAt: (meta && typeof meta.createdAt === 'number') ? meta.createdAt : null,
      updatedAt: lastTime || null,
      files,
      stats,
      lineage,
    }
  }

  ctx.effect(() => {
    const disposers = []

    if (typeof ctx.on === 'function') disposers.push(ctx.on('session/event', (session, event) => {
      if (event && event.type === 'session/title' && event.data && typeof event.data.title === 'string') {
        authorityTitleCache.set(String(session.id), event.data.title)
      }
    }))

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/list',
      handler: async (req, res) => {
        try {
          const state = await archivedState()
          const ids = state.archivedSessionIds || []
          // Only surface archived ids that still exist (materialized log or live).
          // Deleted sessions keep a hidden archive id but no log, so they drop out here.
          let materialized = new Set()
          let live = ctx.get('sessions')
          try {
            const headers = await sp.list()
            materialized = new Set(headers.map((h) => String(h.id)))
          } catch (e) { /* best-effort */ }
          const trashStore = await readTrashStore()
          const hidden = new Set([...trashStore.items.map((item) => String(item.sessionId)), ...trashStore.purgedSessionIds.map(String)])
          const idStrs = ids.map(String).filter((id) => !hidden.has(id) && (materialized.has(id) || (live && live.get(id))))
          wsByPath = {}
          try { for (const ent of w.list()) wsByPath[ent.path] = ent } catch (e) { wsByPath = {} }
          const items = []
          const CHUNK = 6
          for (let i = 0; i < idStrs.length; i += CHUNK) {
            const res2 = await Promise.all(idStrs.slice(i, i + CHUNK).map((id) => resolveOne(id)))
            items.push.apply(items, res2)
          }
          json(res, { items })
        } catch (e) {
          json(res, { error: String((e && e.message) || e) }, 500)
        }
      },
    }))

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/restore',
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req)
          const sid = body && typeof body.sessionId === 'string' ? body.sessionId : null
          if (!sid) return json(res, { ok: false, error: 'missing sessionId' }, 400)
          json(res, await restoreOne(sid))
        } catch (e) {
          json(res, { ok: false, error: String((e && e.message) || e) }, errorStatus(e))
        }
      },
    }))

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/restore-many',
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req)
          const ids = parseIds(body)
          if (!ids || ids.length === 0) return json(res, { ok: false, error: 'missing sessionIds' }, 400)
          const results = []
          for (const sid of ids) {
            try { results.push({ sessionId: sid, ok: true, ...(await restoreOne(sid)) }) }
            catch (e) { results.push({ sessionId: sid, ok: false, error: String((e && e.message) || e) }) }
          }
          json(res, { ok: true, restored: results.filter((r) => r.ok).length, results })
        } catch (e) {
          json(res, { ok: false, error: String((e && e.message) || e) }, 500)
        }
      },
    }))

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/delete',
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req)
          const sid = body && typeof body.sessionId === 'string' ? body.sessionId : null
          if (!sid) return json(res, { ok: false, error: 'missing sessionId' }, 400)
          const out = await deleteOne(sid)
          // 日志被搬进回收站（文件已不在原处）：丢弃缓存条目，避免下次 stat 失败
          // 时残留旧元数据。
          metaCache.invalidate(sid)
          json(res, out)
        } catch (e) {
          json(res, { ok: false, error: String((e && e.message) || e) }, errorStatus(e))
        }
      },
    }))

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/delete-many',
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req)
          const ids = parseIds(body)
          if (!ids || ids.length === 0) return json(res, { ok: false, error: 'missing sessionIds' }, 400)
          const results = []
          for (const sid of ids) {
            try { results.push({ sessionId: sid, ok: true, ...(await deleteOne(sid)) }); metaCache.invalidate(sid) }
            catch (e) { results.push({ sessionId: sid, ok: false, error: String((e && e.message) || e) }) }
          }
          json(res, { ok: true, deleted: results.filter((r) => r.ok).length, results })
        } catch (e) {
          json(res, { ok: false, error: String((e && e.message) || e) }, 500)
        }
      },
    }))

    // ---- Recycle bin (回收站) routes ----------------------------------------
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/trash/list',
      handler: async (req, res) => {
        try {
          await cleanupExpiredTrash()
          const list = await readTrash()
          list.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0))
          const store = await readTrashStore()
          json(res, { schemaVersion: store.schemaVersion, settings: store.settings, purgedSessionIds: store.purgedSessionIds, items: list })
        } catch (e) {
          json(res, { ok: false, error: String((e && e.message) || e) }, errorStatus(e))
        }
      },
    }))

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/trash/settings',
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req)
          const settings = body && Object.prototype.hasOwnProperty.call(body, 'retentionDays')
            ? await trashSettings({ retentionDays: body.retentionDays })
            : await trashSettings()
          json(res, { ok: true, settings })
        } catch (e) {
          json(res, { ok: false, error: String((e && e.message) || e) }, errorStatus(e))
        }
      },
    }))

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/trash/verify',
      handler: async (req, res) => {
        try {
          const items = await readTrash()
          const results = await Promise.all(items.map(async (item) => {
            let exists = false
            if (typeof item.originalPath === 'string') exists = await stat(item.originalPath).then(() => true).catch(() => false)
            return { sessionId: item.sessionId, status: exists ? 'ok' : 'missing', originalPath: item.originalPath || null }
          }))
          json(res, { ok: true, healthy: results.filter((r) => r.status === 'ok').length, missing: results.filter((r) => r.status === 'missing').length, results })
        } catch (e) {
          json(res, { ok: false, error: String((e && e.message) || e) }, errorStatus(e))
        }
      },
    }))

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/trash/restore',
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req)
          const sid = body && typeof body.sessionId === 'string' ? body.sessionId : null
          if (!sid) return json(res, { ok: false, error: 'missing sessionId' }, 400)
          const out = await restoreFromTrash(sid)
          metaCache.invalidate(sid)
          json(res, out)
        } catch (e) {
          json(res, { ok: false, error: String((e && e.message) || e) }, 500)
        }
      },
    }))

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/trash/purge',
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req)
          const sid = body && typeof body.sessionId === 'string' ? body.sessionId : null
          if (!sid) return json(res, { ok: false, error: 'missing sessionId' }, 400)
          const out = await purgeFromTrash(sid)
          metaCache.invalidate(sid)
          // 彻底删除：持久标题索引里的条目一并清掉（issue #1 P4）。
          titleIndex.remove([sid]).catch(() => {})
          json(res, out)
        } catch (e) {
          json(res, { ok: false, error: String((e && e.message) || e) }, 500)
        }
      },
    }))

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/trash/purge-many',
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req)
          const ids = parseIds(body)
          if (!ids || ids.length === 0) return json(res, { ok: false, error: 'missing sessionIds' }, 400)
          const results = []
          for (const sid of ids) {
            try { results.push({ sessionId: sid, ok: true, ...(await purgeFromTrash(sid)) }); metaCache.invalidate(sid); titleIndex.remove([sid]).catch(() => {}) }
            catch (e) { results.push({ sessionId: sid, ok: false, error: String((e && e.message) || e) }) }
          }
          json(res, { ok: true, purged: results.filter((r) => r.ok).length, results })
        } catch (e) {
          json(res, { ok: false, error: String((e && e.message) || e) }, 500)
        }
      },
    }))

    // All conversations (for the "移动会话" panel).
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/sessions',
      handler: async (req, res) => {
        try {
          json(res, { items: await allSessionItems() })
        } catch (e) {
          json(res, { error: String((e && e.message) || e) }, 500)
        }
      },
    }))

    // Star / unstar one or many sessions (收藏, schema v3).
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/star/set',
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req)
          const starred = !!(body && body.starred)
          let ids = parseIds(body)
          if ((!ids || ids.length === 0) && body && typeof body.sessionId === 'string') {
            ids = isSafeSessionId(body.sessionId) ? [body.sessionId] : null
          }
          if (!ids || ids.length === 0) return json(res, { ok: false, error: 'missing sessionId' }, 400)
          const starredSessionIds = await stars.setStarred(ids, starred)
          json(res, { ok: true, starredSessionIds })
        } catch (e) {
          json(res, { ok: false, error: String((e && e.message) || e) }, errorStatus(e))
        }
      },
    }))

    // Human-readable Markdown export (one session). Raw-log ZIP export is
    // dsh's own GET /api/session.export — we deliberately do not duplicate it
    // (see reports/HANDOFF-dsh-sessions-manager-roadmap.md §2.4).
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/export-md',
      handler: async (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost')
          const sid = url.searchParams.get('sessionId')
          requireSessionId(sid)
          const r = await sp.readFrom(sid, 0)
          if (!r || !r.meta) {
            const error = new Error('无法读取该会话的日志')
            error.status = 404
            throw error
          }
          const md = renderSessionMarkdown({ ...r.meta, id: sid }, r.events || [])
          res.writeHead(200, {
            'content-type': 'text/markdown; charset=utf-8',
            'content-disposition': `attachment; filename="dsh-session-${sid}.md"`,
            'cache-control': 'no-store',
          })
          res.end(md)
        } catch (e) {
          json(res, { error: String((e && e.message) || e) }, errorStatus(e))
        }
      },
    }))

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/sidebar-state',
      handler: async (req, res) => {
        try {
          json(res, await sidebarAuthority())
        } catch (e) {
          json(res, { error: String((e && e.message) || e) }, errorStatus(e))
        }
      },
    }))

    // Available target workspaces (for the move picker).
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/workspaces',
      handler: async (req, res) => {
        try {
          json(res, { items: await listWorkspaces() })
        } catch (e) {
          json(res, { error: String((e && e.message) || e) }, 500)
        }
      },
    }))

    // Move one conversation to a target workspace (existing path or a new one).
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/move',
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req)
          const sid = body && typeof body.sessionId === 'string' ? body.sessionId : null
          const target = body && typeof body.targetPath === 'string' ? body.targetPath : null
          if (!sid) return json(res, { ok: false, error: 'missing sessionId' }, 400)
          if (!target) return json(res, { ok: false, error: 'missing targetPath' }, 400)
          const moved = await moveOne(sid, target)
          // 移动会改写日志 frame0 的 cwd：元数据（cwd）已变，主动丢弃缓存条目，
          // 不等 mtime 指纹自然失效（Windows 上 mtime 精度较粗，指纹可能不变）。
          metaCache.invalidate(sid)
          // Reindex the host's in-memory sessionPath index so the sidebar
          // reflects the new grouping immediately (no DSH restart needed).
          // Do this before replying: drag/drop and menu clients treat a 2xx
          // response as the commit point and must never announce success while
          // the sidebar still holds the old workspace index.
          try { await reindexRegistry() } catch (e) { /* best-effort */ }
          json(res, { sessionId: sid, ...moved })
        } catch (e) {
          json(res, { ok: false, error: String((e && e.message) || e) }, 500)
        }
      },
    }))

    // Archive (hide) one session.
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/archive',
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req)
          const sid = body && typeof body.sessionId === 'string' ? body.sessionId : null
          if (!sid) return json(res, { ok: false, error: 'missing sessionId' }, 400)
          json(res, { sessionId: sid, ...(await archiveOne(sid)) })
        } catch (e) {
          json(res, { ok: false, error: String((e && e.message) || e) }, 500)
        }
      },
    }))

    // Archive (hide) many sessions.
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/archive-many',
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req)
          const ids = parseIds(body)
          if (!ids || ids.length === 0) return json(res, { ok: false, error: 'missing sessionIds' }, 400)
          const results = []
          for (const sid of ids) {
            try { results.push({ sessionId: sid, ok: true, ...(await archiveOne(sid)) }) }
            catch (e) { results.push({ sessionId: sid, ok: false, error: String((e && e.message) || e) }) }
          }
          json(res, { ok: true, archived: results.filter((r) => r.ok).length, results })
        } catch (e) {
          json(res, { ok: false, error: String((e && e.message) || e) }, 500)
        }
      },
    }))

    // Per-session details (v2.0): disk usage, turn/step/message counts, tool
    // usage, fetch records, write/edit files, and lineage.
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/details',
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req)
          const sid = body && typeof body.sessionId === 'string' ? body.sessionId : null
          if (!sid) return json(res, { ok: false, error: 'missing sessionId' }, 400)
          json(res, await buildDetails(sid))
        } catch (e) {
          json(res, { error: String((e && e.message) || e) }, (e && e.status) ? e.status : 500)
        }
      },
    }))

    // Storage usage rollup (read-only): per-workspace totals + largest sessions.
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/storage',
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req)
          json(res, await buildStorage({ topN: body && body.topN }))
        } catch (e) {
          json(res, { error: String((e && e.message) || e) }, 500)
        }
      },
    }))

    // Auto-archive settings. A plain read (no patch keys) doubles as the lazy
    // sweep trigger — that is how the once-a-day cleanup gets a chance to run
    // without a background timer. The sweep runs in the background so opening
    // the panel never waits on it (P5, issue #1): the sweep itself already
    // reuses the metadata caches, and this keeps the settings read latency
    // independent of library size.
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/auto-archive/settings',
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req)
          const patch = {}
          if (body && Object.prototype.hasOwnProperty.call(body, 'inactiveDays')) patch.inactiveDays = body.inactiveDays
          if (body && Object.prototype.hasOwnProperty.call(body, 'skipStarred')) patch.skipStarred = body.skipStarred
          const isPatch = Object.keys(patch).length > 0
          const settings = isPatch
            ? await autoArchive.update(patch)
            : (await autoArchive.read()).settings
          let sweep
          if (isPatch) {
            // 显式保存设置：保持「保存即生效」的同步 sweep（含刚启用时的首次归档）。
            sweep = await autoArchiveSweep()
          } else {
            // 面板打开的纯读取：sweep 转后台执行，打开延迟与库大小解耦
            //（P5，issue #1）。sweep 本身已复用元数据缓存 + 持久标题索引。
            void autoArchiveSweep().catch(() => {})
            sweep = { triggered: true }
          }
          const store = await autoArchive.read()
          json(res, {
            ok: true,
            settings,
            lastRunAt: store.lastRunAt,
            lastArchivedCount: store.lastArchivedCount,
            sweep,
          })
        } catch (e) {
          json(res, { ok: false, error: String((e && e.message) || e) }, errorStatus(e))
        }
      },
    }))

    // Run the auto-archive sweep right now, ignoring the once-a-day throttle.
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/auto-archive/run',
      handler: async (req, res) => {
        try {
          const sweep = await autoArchiveSweep({ force: true })
          const store = await autoArchive.read()
          json(res, { ok: true, ...sweep, settings: store.settings, lastRunAt: store.lastRunAt, lastArchivedCount: store.lastArchivedCount })
        } catch (e) {
          json(res, { ok: false, error: String((e && e.message) || e) }, 500)
        }
      },
    }))

    return () => { for (const d of disposers) d() }
  }, 'dsh-sessions-manager: routes')
}
