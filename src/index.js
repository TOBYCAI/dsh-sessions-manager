// dsh-sessions-manager — host half.
//
// Serves /archived-sessions/* JSON routes (list / restore / restore-many /
// delete / delete-many / sessions / workspaces / move) over the host
// `webServer`. The browser Settings sections ("归档会话" & "移动会话") talk to
// these. Reads/writes the durable workspace archive set
// (workspaceRegistry + storageDomain), folds titles/dates/workspace tags from
// session persistence, physically removes a session's log file on delete, and
// relocates a conversation (session) between workspaces on move.
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { rewriteFrame0CwdInMemory, scanZstdFrames } from './zstd-frame.js'
import { createSessionMarkdownBuilder } from './markdown.js'
import { createStarIndex } from './star-index.js'
import { aggregateStorage } from './storage-stats.js'
import { createAutoArchiveStore, pickInactiveCandidates } from './auto-archive.js'
import { createSessionMetaCache, fingerprintOf, isPersistableFingerprint } from './session-meta-cache.js'
import { createTitleIndexStore } from './title-persist-index.js'
import { createPersistenceAdapter } from './compat/persistence.js'
import { detectCapabilities, requireCapability } from './compat/capabilities.js'
import { pathOwnsSession } from './path-guard.js'
import { purgeSessionArtifacts, moveSessionToCwd } from './handle-era-ops.js'


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

// 极简并发闸：整本日志读取（详情 / 导出）同时最多 max 个在跑，排队等待。
// 防止批量导出把宿主 CPU/内存打满（SessionHandle 世代逐块解码仍是 CPU 活）。
function createLimiter(max) {
  let active = 0
  const queue = []
  return async function run(fn) {
    if (active >= max) await new Promise((resolve) => queue.push(resolve))
    active++
    try { return await fn() } finally {
      active--
      const next = queue.shift()
      if (next) next()
    }
  }
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
  const persistence = createPersistenceAdapter(sp)
  const capabilities = detectCapabilities({ persistence: sp, workspaceRegistry: w })
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
  // revision 指纹（SessionHandle 世代）跳过持久索引：跨进程无意义。
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
      if (!isPersistableFingerprint(fp)) continue
      if (fp && entry.fingerprint === fp) {
        hits.set(id, { title: entry.title, cwd: entry.cwd, createdAt: entry.createdAt })
      }
    }
    return hits
  }

  // 把本批真正解码出的元数据异步回写持久索引（fire-and-forget：索引只是
  // 加速器，写失败不影响响应，队列内部已串行化 + 原子替换）。
  // ⚠️ revision 指纹（SessionHandle 世代）绝不落盘：它只在当前 service
  // 实例内有意义，跨进程比较无意义，误用会把陈旧数据当新鲜数据。
  function persistDecoded(decoded, statsById) {
    if (!decoded || !decoded.size) return
    const batch = {}
    const now = Date.now()
    for (const [id, meta] of decoded) {
      const fp = fingerprintOf(statsById.get(id))
      if (!isPersistableFingerprint(fp)) continue
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
  // JSON.parse，只为折叠出标题——大库上一次全表要几秒阻塞式 CPU。日志内容没变
  // 就意味着折叠结果不可能变（legacy 用 (mtime, size) 文件指纹；SessionHandle
  // 世代用官方 snapshot.revision），命中即直接复用，跳过整本解码。
  //
  // 0.1.3-alpha 兼容（避免放大官方已知的历史会话加载性能回退）：
  //   - cwd/createdAt 优先来自 list() 快照的 snapshot.header；
  //   - 标题优先来自批量 readTitleSnapshots；
  //   - **标题缺失绝不单独触发整本日志解码**——无标题就显示「(无标题)」。
  //     只有在拿不到 cwd（工作区归属失效）或 runtime 完全没有标题投影能力时
  //     才回退到日志解码，且该解码走 inspectSession 分块折叠，不做整本驻留。
  async function resolveOne(id, usage, opts = {}) {
    const key = String(id)
    const statInfo = usage ? (usage.statsById ? usage.statsById.get(key) : null)
      || { mtimeMs: usage.mtimeById && usage.mtimeById.get(key), size: usage.sizeById && usage.sizeById.get(key) } : null
    const cached = metaCache.get(key, statInfo)
    if (cached) return buildItem(key, cached, usage, opts.exposeUsage)

    let meta = { title: null, cwd: null, createdAt: null }
    // 第一来源：list() 返回的 SessionPersistenceSnapshot.header（0.1.3+ 官方
    // 契约里 header 携带 cwd/createdAt，无需任何日志读取）。
    if (opts.listHeader) {
      if (typeof opts.listHeader.cwd === 'string') meta.cwd = opts.listHeader.cwd
      if (opts.listHeader.createdAt != null) meta.createdAt = opts.listHeader.createdAt
    }
    if (opts.preloaded !== undefined) {
      const projected = metaFromSnapshot(unwrapSnapshot(opts.preloaded))
      if (projected.title) meta.title = projected.title
      if (!meta.cwd && projected.cwd) meta.cwd = projected.cwd
      if (!meta.createdAt && projected.createdAt) meta.createdAt = projected.createdAt
    } else if (typeof sq.readTitleSnapshot === 'function') {
      try {
        const projected = metaFromSnapshot(await sq.readTitleSnapshot(id))
        if (projected.title) meta.title = projected.title
        if (!meta.cwd && projected.cwd) meta.cwd = projected.cwd
        if (!meta.createdAt && projected.createdAt) meta.createdAt = projected.createdAt
      } catch (e) { /* fall through */ }
    }
    // cwd 缺失 → 工作区归属失效，值得一次解码兜底（cwd 在 header 里，通常
    // 快照已带回，这里只在快照缺 cwd 时发生）。runtime 完全没有标题投影能力
    // 时（老后端无 readTitleSnapshot），解码同时兜底标题。
    const projectionAvailable = typeof sq.readTitleSnapshot === 'function' || typeof sq.readTitleSnapshots === 'function'
    if (!meta.cwd || (!meta.title && !projectionAvailable)) {
      try {
        let foldedTitle = null
        const summary = await persistence.inspectSession(key, {
          onEvents: (events) => { if (!foldedTitle) foldedTitle = foldTitle(events) },
        })
        if (summary && summary.meta) {
          if (!meta.cwd) meta.cwd = summary.meta.cwd || null
          if (!meta.createdAt) meta.createdAt = summary.meta.createdAt || null
        }
        if (!meta.title && foldedTitle) meta.title = foldedTitle
      } catch (e2) { /* keep what we have */ }
    }
    metaCache.set(key, statInfo, meta)
    // 本条是「真解码」出来的：交给调用方回写持久标题索引（P4 冷启动加速）。
    if (opts.collectDecoded && statInfo) opts.collectDecoded(key, meta)
    return buildItem(key, meta, usage, opts.exposeUsage)
  }

  // Disk usage + last-write time for every session, in one pass. Also produces
  // the per-id change token (`statsById`) that drives the metadata cache:
  //   - SessionHandle 世代（0.1.3+）：公共服务不再暴露 locate/raw 路径，
  //     snapshot.revision（list 一次就带回）就是官方唯一变更令牌；
  //   - legacy：沿用 sp.locate + 一次 stat 的 (mtime, size) 文件指纹。
  // mtime doubles as the session's last-activity time — appending an event
  // rewrites the log, so the file's last write tracks the conversation's last
  // turn. It errs safe: a log we relocated (move) gets a fresh mtime and
  // therefore looks *more* active than it is, which can only delay an
  // auto-archive, never cause a wrong one. Handle-era runtimes provide no
  // activity timestamp at all; auto-archive must then skip instead of guessing
  // (see autoArchiveSweep).
  // entries 可由调用方传入复用（列表构建里已经 sp.list() 过一次，避免重复列目录）。
  async function collectUsage(preloadedEntries) {
    const sizeById = new Map()
    const mtimeById = new Map()
    const statsById = new Map()
    let entries = null
    if (Array.isArray(preloadedEntries)) entries = preloadedEntries
    else { try { entries = await persistence.listEntries() } catch (e) { entries = [] } }
    if (!Array.isArray(entries)) entries = []
    const CHUNK = 8
    for (let i = 0; i < entries.length; i += CHUNK) {
      await Promise.all(entries.slice(i, i + CHUNK).map(async (entry) => {
        const header = entry && entry.header ? entry.header : entry
        const id = entry && entry.id != null ? String(entry.id) : (header && header.id != null ? String(header.id) : null)
        if (!id) return
        // SessionHandle 世代：snapshot（header/revision/sizeBytes）是权威轻量
        // 观察，绝不再绕道私有磁盘路径补 stat。
        if (entry && typeof entry.revision === 'string' && entry.revision) {
          if (Number.isFinite(entry.sizeBytes)) sizeById.set(id, Number(entry.sizeBytes))
          statsById.set(id, { revision: entry.revision })
          return
        }
        if (entry && Number.isFinite(entry.sizeBytes)) sizeById.set(id, Number(entry.sizeBytes))
        try {
          const loc = persistence.locate(header)
          if (!loc || typeof loc.path !== 'string' || !loc.path) return
          const st = await stat(loc.path)
          if (!st) return
          if (typeof st.size === 'number') sizeById.set(id, st.size)
          if (typeof st.mtimeMs === 'number' && st.mtimeMs > 0) {
            mtimeById.set(id, Math.floor(st.mtimeMs))
            statsById.set(id, { mtimeMs: Math.floor(st.mtimeMs), size: typeof st.size === 'number' ? st.size : undefined })
          }
        } catch (e) { /* best-effort: an unreadable log just stays unknown */ }
      }))
    }
    return { sizeById, mtimeById, statsById, hasActivityData: mtimeById.size > 0 }
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
    let persistenceEntry = null
    try {
      const entries = await persistence.listEntries()
      const found = entries.find((entry) => entry.id === sid) || null
      persistenceEntry = found
      header = found ? found.header : null
      if (header) {
        const loc = persistence.locate(header)
        if (loc && typeof loc.path === 'string') removedPath = loc.path
        cwd = header.cwd || null
        title = header.title || (header.meta && header.meta.title) || null
      }
      if (!title) {
        // 标题兜底优先走单会话标题投影（快照级，不读日志）；投影也没有时才
        // 分块解码日志折叠标题（inspectSession 分块，不整本驻留内存）。
        if (typeof sq.readTitleSnapshot === 'function') {
          try {
            const snap = unwrapSnapshot(await sq.readTitleSnapshot(sid))
            if (snap && snap.title && snap.title.title) title = String(snap.title.title)
            if (snap && snap.session) { if (!cwd) cwd = snap.session.cwd || null }
          } catch (e) { /* fall through */ }
        }
      }
      if (!title) {
        try {
          let folded = null
          const summary = await persistence.inspectSession(sid, {
            onEvents: (events) => { if (!folded) folded = foldTitle(events) },
          })
          if (summary && summary.meta && !cwd) cwd = summary.meta.cwd || null
          title = folded
        } catch (e) { /* best-effort */ }
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
        sizeBytes: persistenceEntry && Number.isFinite(persistenceEntry.sizeBytes) ? persistenceEntry.sizeBytes : null,
        wasArchived: archived, deletedAt: Date.now(),
      }
      const at = store.items.findIndex((t) => String(t.sessionId) === sid)
      if (at >= 0) store.items[at] = entry
      else store.items.push(entry)
      store.purgedSessionIds = store.purgedSessionIds.filter((id) => id !== sid)
    })
    return { ok: true, trashed: true }
  }

  // 恢复前的底层校验（0.1.3 契约下 restoreIndexedSession 不再无条件可用）：
  //   1. 底层 stored session 仍存在（live / stat / list 三级判定）；
  //   2. 日志文件仍在原处（软删除不动文件，originalPath 丢失即外部破坏）；
  //   3. 工作区丢失不算失败——会话仍可恢复，UI 以 workspaceGone 提示。
  // 返回 { ok:true, workspaceGone, verified } 或 { ok:false, status, code, message }。
  // verified=false 表示无法核验日志文件（SessionHandle 世代无 locate），按
  // 索引为准放行，但绝不假装校验过。
  async function verifyTrashRestore(sid) {
    const sessions = ctx.get('sessions')
    if (sessions && sessions.get && sessions.get(sid)) {
      return { ok: true, workspaceGone: false, verified: true }
    }
    let exists = false
    let header = null
    try {
      const stat = await persistence.statSession(sid)
      if (stat) { exists = true; header = stat.header }
    } catch (e) { /* stat 缺失或失败：落入 legacy 判定 */ }
    if (!exists) {
      try {
        const entries = await persistence.listEntries()
        const found = entries.find((entry) => entry.id === sid)
        if (found) { exists = true; header = found.header }
      } catch (e) { /* list 失败：继续走错误分支 */ }
    }
    if (!exists) {
      const store = await readTrashStore()
      if (store.purgedSessionIds.map(String).includes(sid)) {
        return { ok: false, status: 410, code: 'DSM_SESSION_PURGED', message: '该会话已彻底删除，无法从回收站恢复' }
      }
      return { ok: false, status: 409, code: 'DSM_SESSION_MISSING', message: '底层会话已不存在（可能被外部删除或重建），无法恢复' }
    }
    // 软删除把日志留在原工作区目录；originalPath 消失 = 外部破坏。
    // 无法核验（无 locate / 无记录）时放行但如实标注。
    let verified = false
    const store = await readTrashStore()
    const entry = store.items.find((t) => String(t.sessionId) === sid)
    let originalPath = entry && typeof entry.originalPath === 'string' ? entry.originalPath : null
    if (!originalPath && header) {
      const loc = persistence.locate(header)
      if (loc && typeof loc.path === 'string') originalPath = loc.path
    }
    if (originalPath) {
      const existsOnDisk = await stat(originalPath).then(() => true).catch(() => false)
      if (!existsOnDisk) {
        return { ok: false, status: 409, code: 'DSM_SESSION_LOG_MISSING', message: '回收站索引仍记录该会话，但其日志文件已消失（可能被外部移动或删除）' }
      }
      verified = true
    }
    let workspaceGone = false
    const cwd = (header && header.cwd) || (entry && entry.cwd) || null
    if (cwd) {
      try { workspaceGone = !w.list().some((ent) => ent.path === cwd) } catch (e) { workspaceGone = false }
    }
    return { ok: true, workspaceGone, verified }
  }

  // Restore a trashed session: the log never left its original workspace dir,
  // so we just drop it from the recycle-bin index and the sidebar reveals it in
  // its original workspace (no move / no re-attach needed). Repeated restores
  // fail with an accurate 404 — there is no second entry to restore.
  async function restoreFromTrash(sid) {
    requireSessionId(sid)
    requireCapability(capabilities, 'restoreIndexedSession')
    let outcome = null
    await mutateTrash(async (store) => {
      const entry = store.items.find((t) => String(t.sessionId) === sid)
      if (!entry) {
        if (store.purgedSessionIds.map(String).includes(sid)) {
          const error = new Error('该会话已彻底删除，无法从回收站恢复')
          error.status = 410
          error.code = 'DSM_SESSION_PURGED'
          throw error
        }
        const error = new Error('回收站中找不到该会话（可能已恢复过）')
        error.status = 404
        error.code = 'DSM_TRASH_NOT_FOUND'
        throw error
      }
      // Verify BEFORE removing the durable entry: if verification fails the
      // mutator throws, mutateTrash does not write, and the item remains
      // recoverable instead of disappearing into an inconsistent state.
      const verification = await verifyTrashRestore(sid)
      if (!verification.ok) {
        const error = new Error(verification.message)
        error.status = verification.status
        error.code = verification.code
        throw error
      }
      // Restore the pre-delete archive state before removing the durable trash
      // entry. If this fails, mutateTrash does not write and the item remains
      // recoverable instead of disappearing into an inconsistent state.
      if (entry.wasArchived === false) await restoreOne(sid)
      store.items = store.items.filter((t) => String(t.sessionId) !== sid)
      store.purgedSessionIds = store.purgedSessionIds.filter((id) => id !== sid)
      outcome = { ok: true, restored: true, workspaceGone: verification.workspaceGone, verified: verification.verified }
    })
    return outcome || { ok: true, restored: true }
  }

  // Permanently erase a trashed session: physically delete its log (still in
  // the original workspace dir) and detach it from any workspace so DSH drops it.
  async function purgeFromTrash(sid) {
    requireSessionId(sid)
    requireCapability(capabilities, 'purge')
    let purged = false
    await mutateTrash(async (store) => {
      const entry = store.items.find((t) => String(t.sessionId) === sid)
      if (!entry) { const error = new Error('回收站中找不到该会话'); error.status = 404; throw error }
      let target = null
      let locatedHeader = null
      try {
        const entries = await persistence.listEntries()
        const current = entries.find((entry) => entry.id === sid)
        locatedHeader = current ? current.header : null
        const located = current && persistence.locate(current.header)
        if (located && typeof located.path === 'string') target = located.path
      } catch (e) {}
      if (!target && typeof entry.originalPath === 'string') target = entry.originalPath
      if (!target) {
        const error = new Error('无法确认该会话的物理日志位置，已停止永久删除')
        error.status = 409
        throw error
      }
      // JSONL persistence stores logs as
      //   .../<sessionId>/session.jsonl.zstd
      // Older backends may instead include the id in the filename itself.
      // pathOwnsSession accepts both layouts on POSIX and Windows separators
      // and rejects every unrelated path (including id-substring collisions)
      // before any unlink.
      const targetOwnsSession = pathOwnsSession(target, sid)
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
      if (target && persistence.kind === 'session-handle' && locatedHeader) {
        // handle 时代：写所有权探测（活跃写者 409）→ 整目录删除 → 官方 stat 复核。
        // 内部复用与移动同一套路径守卫；删除失败会带 status 冒泡。
        await purgeSessionArtifacts(sp, sid, locatedHeader)
      } else if (target) {
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
    if (!capabilities.actions.purge.available) return 0
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
    requireCapability(capabilities, 'move')
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
    const r = await persistence.readSession(sid, 0)
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
      const stagedPath = `${newPath}.move-stage-${process.pid}-${Date.now()}`
      let destinationInstalled = false
      try {
        // Ensure the destination project directory exists (rename does not
        // create it). Without this, the rename silently no-ops on ENOENT and
        // the log stays put while workspace.json is wrongly updated.
        await mkdir(dirname(newPath), { recursive: true })
        try {
          await stat(newPath)
          throw new Error('移动失败：目标位置已存在同名会话日志')
        } catch (e) {
          if (e && e.code !== 'ENOENT') throw e
        }
        await rename(oldPath, backupPath) // keep the original byte-identical until verification succeeds
        const original = await readFile(backupPath)
        const originalFrames = scanZstdFrames(original).frames
        if (originalFrames.length === 0) throw new Error('移动前校验失败：会话日志没有完整 zstd 帧')
        const rewritten = rewriteFrame0CwdInMemory(original, canonical)
        const rewrittenFrames = scanZstdFrames(rewritten).frames
        if (rewrittenFrames.length !== originalFrames.length) throw new Error('移动后校验失败：会话日志帧数发生变化')
        const originalTail = original.subarray(originalFrames[0].end)
        const rewrittenTail = rewritten.subarray(rewrittenFrames[0].end)
        if (!originalTail.equals(rewrittenTail)) throw new Error('移动后校验失败：会话事件内容发生变化')
        await writeFile(stagedPath, rewritten, { mode: 0o600 })
        await rename(stagedPath, newPath)
        destinationInstalled = true
        await unlink(backupPath)
      } catch (e) {
        try { await unlink(stagedPath) } catch (_) {}
        if (destinationInstalled) { try { await unlink(newPath) } catch (_) {} }
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

    if (persistence.kind === 'session-handle') {
      // 读事件之后的双 revision 校验：两次采样之间 revision 仍在变，说明日志
      // 还在被写入，中止而不是复制出分叉副本（读取期间的写入由 ops 内的
      // rename-aside + 官方写所有权探测兜底）。
      const stat1 = await persistence.statSession(sid)
      if (stat1 && stat1.revision) {
        const stat2 = await persistence.statSession(sid)
        if (stat2 && stat2.revision !== stat1.revision) {
          throw new Error('该会话在移动准备期间发生了变化，请稍后重试。')
        }
      }
      try {
        await moveSessionToCwd({ sp, sid, header: meta, canonical, events, inheritedEventCount: r.inheritedEventCount })
      } catch (e) {
        if (e && e.status) throw e
        throw new Error('移动会话日志失败：' + String((e && e.message) || e))
      }
    } else if (isOpen) {
      // Live session: relocate the on-disk log (rewriting frame0's cwd to the
      // new path) and redirect the live object + persistence state. We must
      // rewrite frame0, not just rename: sp.list() reads frame0's cwd from
      // disk, and WorkspaceEntity.sessionIds filters by that exact cwd. A bare
      // rename would leave frame0 pointing at the old workspace, so reindex /
      // restart would keep attributing the session to the wrong workspace.
      if (!await relocateLog(meta, newHeader)) throw new Error('移动失败：无法确认会话日志已迁移到目标工作区')
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
        if (!await relocateLog(meta, newHeader)) throw new Error('移动失败：无法确认会话日志已迁移到目标工作区')
      } else {
        const backupPath = oldPath ? `${oldPath}.move-backup-${Date.now()}` : null
        if (backupPath) { try { await rename(oldPath, backupPath) } catch (e) { if (e && e.code !== 'ENOENT') throw new Error('移动失败：无法备份旧的会话日志') } }
        const restore = async () => { if (backupPath) { try { await rename(backupPath, oldPath) } catch (_) {} } }
        try {
          await sp.create(newHeader)
          await sp.append(sid, events)
          const check = await persistence.readSession(sid, 0)
          if (!check || !check.meta || check.meta.cwd !== canonical) {
            throw new Error('移动后校验失败：会话工作目录未正确更新')
          }
          if (backupPath) { try { await unlink(backupPath) } catch (e) {} }
        } catch (e) {
          if (ALREADY_EXISTS_RE.test(String((e && e.message) || e))) {
            // Collision: the session is already materialized in states (archived
            // or previously opened). Fall back to physically relocating the log.
            await restore()
            if (!await relocateLog(meta, newHeader)) throw new Error('移动失败：无法确认会话日志已迁移到目标工作区')
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
    let entries = null
    try { entries = await persistence.listEntries() } catch (e) { entries = null }
    if (!entries || !Array.isArray(entries)) return false
    await reg.replaceHeaderIndex(entries.map((entry) => entry.header))
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
  // 性能要点（issue #1 + 0.1.3-alpha 适配）：
  //   1. sp.list() 只调一次（原先列了两遍目录）
  //   2. 变更令牌优先来自 list 快照：legacy 走 locate+stat，SessionHandle 世代
  //      直接用 snapshot.revision（无 locate 可用，也绝不绕私有路径补 stat）
  //   3. 未命中缓存的会话走**一次**批量投影（sq.readTitleSnapshots），而不是逐条
  async function allSessionItemsDetailed(opts = {}) {
    let entries = []
    let headersOk = false
    try {
      entries = await persistence.listEntries()
      headersOk = Array.isArray(entries)
      if (!headersOk) entries = []
    } catch (e) { entries = [] }
    const entryById = new Map(entries.map((entry) => [entry.id, entry]))
    let live = ctx.get('sessions')
    const ids = entries.map((entry) => entry.id)
    if (live) { try { live.list().forEach((s) => { const sid = String(s.id); if (!ids.includes(sid)) ids.push(sid) }) } catch (e) { /* ignore */ } }
    // Exclude sessions already moved to the recycle bin (软删除): they live in
    // 回收站, not in 会话管理, so the panel won't re-list them after a delete.
    // purged tombstone 只对「当前不存在的 id」继续隐藏：若同 id 会话后来重新
    // 出现（重建/换绑定），墓碑必须让位，不能永久压住新会话。
    let hiddenIds = new Set()
    try {
      const store = await readTrashStore()
      const present = new Set(ids)
      hiddenIds = new Set([
        ...store.items.map((t) => String(t.sessionId)),
        ...store.purgedSessionIds.map(String).filter((id) => !present.has(id)),
      ])
    } catch (e) {}
    const visibleIds = ids.filter((id) => !hiddenIds.has(id))
    wsByPath = {}
    try { for (const ent of w.list()) wsByPath[ent.path] = ent } catch (e) { wsByPath = {} }
    const currentArchived = new Set((await archivedState().catch(() => ({ archivedSessionIds: [] }))).archivedSessionIds || [])
    const items = []
    const usage = await collectUsage(entries)
    // 先按指纹把「缓存命中」与「需要解码」分开，只对后者做批量投影。
    const statsById = new Map(visibleIds.map((id) => [
      id,
      (usage.statsById && usage.statsById.get(id)) || { mtimeMs: usage.mtimeById.get(id), size: usage.sizeById.get(id) },
    ]))
    const { missing } = metaCache.partition(visibleIds, statsById)
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
      const res2 = await Promise.all(visibleIds.slice(i, i + CHUNK).map((id) => {
        const entry = entryById.get(id)
        return resolveOne(id, usage, {
          exposeUsage: !!(opts && opts.usage),
          listHeader: entry ? entry.header : null,
          preloaded: snapshotById.has(id) ? snapshotById.get(id) : undefined,
          collectDecoded,
        })
      }))
      for (const it of res2) items.push({ ...it, archived: currentArchived.has(it.sessionId) })
    }
    persistDecoded(decoded, statsById)
    // Annotate stars; GC only when we have a trustworthy id baseline, so a
    // failing sp.list() can never wipe the whole index.
    let starredSet = new Set()
    try { starredSet = new Set((await stars.read()).starredSessionIds) } catch (e) {}
    for (const it of items) it.starred = starredSet.has(String(it.sessionId))
    if (headersOk) await gcStars(ids)
    return { items, usage }
  }

  async function allSessionItems(opts = {}) {
    return (await allSessionItemsDetailed(opts)).items
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
    const { items, usage } = await allSessionItemsDetailed({ usage: true })
    // SessionHandle 世代没有可靠的「最后活跃时间」（无 locate/mtime，快照也不
    // 携带事件时间）。无法证明会话闲置 → 一律跳过，绝不猜测（宁可漏归档，
    // 不能错归档）。UI 会如实展示该降级。
    if (!usage.hasActivityData) {
      return {
        ok: true, skipped: 'no-activity-data', archived: 0,
        note: '当前 DSH 版本未提供可靠的最后活跃时间，自动归档已跳过；不会基于猜测归档任何会话。',
      }
    }
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
    let entries = []
    try { entries = await persistence.listEntries() } catch (e) { entries = [] }
    if (!Array.isArray(entries)) entries = []
    for (const entry of entries) ids.push(entry.id)
    const sessions = ctx.get('sessions')
    try { if (sessions) sessions.list().forEach((session) => { const sid = String(session.id); if (!ids.includes(sid)) ids.push(sid) }) } catch (e) {}
    const store = await readTrashStore()
    // 墓碑只对「当前不存在」的 id 继续输出；同 id 会话重新出现时必须让位。
    const present = new Set(ids)
    const activeTombstones = store.purgedSessionIds.map(String).filter((id) => !present.has(id))
    if (ids.length) {
      const usage = await collectUsage(entries)
      const statsById = new Map(ids.map((id) => [
        id,
        (usage.statsById && usage.statsById.get(id)) || { mtimeMs: usage.mtimeById.get(id), size: usage.sizeById.get(id) },
      ]))
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
          const entry = entries.find((e) => e.id === id)
          const snapshot = snapshotById.has(id)
            ? snapshotById.get(id)
            : (typeof sq.readTitleSnapshot === 'function' ? await sq.readTitleSnapshot(id).catch(() => null) : null)
          const next = metaFromSnapshot(snapshot)
          if (entry && entry.header) {
            if (!next.cwd && typeof entry.header.cwd === 'string') next.cwd = entry.header.cwd
            if (!next.createdAt && entry.header.createdAt != null) next.createdAt = entry.header.createdAt
          }
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
      purgedSessionIds: activeTombstones,
    }
  }

  // 聚合一条会话的详情（磁盘占用 / 轮次·步数·消息数 / 工具统计 / fetch /
  // write/edit 文件 / 血统 parent/children/subagents）。live 与持久化会话都可读。
  // 所有统计对未知事件类型容错；fetch 与 files 做上限截断，files 用 stat 过滤
  // 磁盘上已不存在的路径，避免详情面板列出已删除文件。
  // 持久化会话走 inspectSession 分块折叠：大日志不再整本驻留内存（0.1.3-alpha
  // 已知历史会话加载性能回退，这里避免放大它）。
  async function buildDetails(sid, signal) {
    const sessions = ctx.get('sessions')
    const live = sessions && sessions.get(sid)
    let meta = null
    let lastTime = 0
    const fileSet = new Map()
    const stats = {
      turns: 0, steps: 0, userMessages: 0, assistantMessages: 0,
      toolCalls: 0, attachments: 0, toolCounts: {}, fetches: [],
    }
    const turnSeen = new Set()
    const stepSeen = new Set()

    const absorb = (ev) => {
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

    if (live !== void 0) {
      meta = (live && live.header) || null
      try { (Array.isArray(live.events) ? [...live.events] : []).forEach(absorb) } catch (e) { /* empty */ }
    } else {
      const summary = await persistence.inspectSession(sid, { signal, onEvents: (batch) => { for (const ev of batch) absorb(ev) } })
      if (!summary || !summary.meta) throw new Error('找不到该会话的记录（会话不存在）')
      meta = summary.meta
    }
    stats.turns = turnSeen.size
    stats.steps = stepSeen.size
    let sizeBytes = null
    if (live === void 0) {
      // SessionHandle 世代：快照直接带 sizeBytes（官方 JSONL 后端廉价提供）；
      // 拿不到再退回 locate + stat（legacy）。绝不伪造 0。
      try {
        const stat = await persistence.statSession(sid)
        if (stat && Number.isFinite(stat.sizeBytes)) sizeBytes = stat.sizeBytes
      } catch (e) { /* fall through */ }
    }
    if (sizeBytes === null) {
      try {
        // rc.8 的 sessionPersistence 后端没有 artifactInfo；用 locate(meta) 拿日志
        // 文件真实路径后 stat 出字节数（磁盘占用）。
        const loc = persistence.locate(meta)
        if (loc && typeof loc.path === 'string' && loc.path) {
          const st = await stat(loc.path)
          if (st && typeof st.size === 'number') sizeBytes = st.size
        }
      } catch (e) { sizeBytes = null }
    }
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
        for (const entry of await persistence.listEntries()) {
          const h = entry.header
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
      updatedAt: Math.max(lastTime || 0, (meta && typeof meta.createdAt === 'number' ? meta.createdAt : 0)) || null,
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
      path: '/archived-sessions/capabilities',
      handler: async (req, res) => json(res, capabilities),
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
            const entries = await persistence.listEntries()
            materialized = new Set(entries.map((entry) => entry.id))
          } catch (e) { /* best-effort */ }
          const trashStore = await readTrashStore()
          // 墓碑只对「当前不存在」的 id 生效；同 id 会话重新出现时让位。
          const present = new Set([
            ...materialized,
            ...ids.map(String),
            ...(live && typeof live.list === 'function' ? live.list().map((s) => String(s.id)) : []),
          ])
          const tombstones = trashStore.purgedSessionIds.map(String).filter((id) => !present.has(id))
          const hidden = new Set([...trashStore.items.map((item) => String(item.sessionId)), ...tombstones])
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
            catch (e) { results.push({ sessionId: sid, ok: false, code: e && e.code, error: String((e && e.message) || e) }) }
          }
          json(res, { ok: true, restored: results.filter((r) => r.ok).length, results })
        } catch (e) {
          json(res, { ok: false, code: e && e.code, error: String((e && e.message) || e) }, errorStatus(e))
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
          json(res, { ok: false, code: e && e.code, error: String((e && e.message) || e) }, errorStatus(e))
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
            if (typeof item.originalPath !== 'string' || !item.originalPath) {
              return { sessionId: item.sessionId, status: 'unverified', originalPath: null }
            }
            const exists = await stat(item.originalPath).then(() => true).catch(() => false)
            return { sessionId: item.sessionId, status: exists ? 'ok' : 'missing', originalPath: item.originalPath }
          }))
          json(res, {
            ok: true,
            healthy: results.filter((r) => r.status === 'ok').length,
            missing: results.filter((r) => r.status === 'missing').length,
            unverified: results.filter((r) => r.status === 'unverified').length,
            results,
          })
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
          json(res, { ok: false, code: e && e.code, error: String((e && e.message) || e) }, errorStatus(e))
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
          json(res, { ok: false, code: e && e.code, error: String((e && e.message) || e) }, errorStatus(e))
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
          json(res, { ok: false, code: e && e.code, error: String((e && e.message) || e) }, errorStatus(e))
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
    //
    // 0.1.3 兼容：日志经 inspectSession 分块读取（SessionHandle.read 的
    // offset/length 有界切片），流式渲染 Markdown，客户端断开即取消（signal），
    // 并受全局并发闸约束——大日志不再一次性整本驻留内存。
    const exportLimiter = createLimiter(2)
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/export-md',
      handler: async (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost')
          const sid = url.searchParams.get('sessionId')
          requireSessionId(sid)
          const ac = new AbortController()
          res.on('close', () => { if (!res.writableEnded) ac.abort() })
          const md = await exportLimiter(async () => {
            const builder = createSessionMarkdownBuilder({ id: sid })
            const summary = await persistence.inspectSession(sid, {
              signal: ac.signal,
              onEvents: (batch) => builder.addEvents(batch),
            })
            if (!summary || !summary.meta) {
              const error = new Error('无法读取该会话的日志')
              error.status = 404
              throw error
            }
            // meta 在流结束后才权威（header 来自 open 回包）；finish 覆写 front matter。
            return builder.finish({ ...summary.meta, id: sid })
          })
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
          json(res, { ok: false, code: e && e.code, error: String((e && e.message) || e) }, errorStatus(e))
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
          // 客户端断开时取消分块读取，避免为已离开的请求继续解码整本日志。
          const ac = new AbortController()
          res.on('close', () => { if (!res.writableEnded) ac.abort() })
          json(res, await buildDetails(sid, ac.signal))
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
