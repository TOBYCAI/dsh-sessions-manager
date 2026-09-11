// dsh-sessions-manager — host half.
//
// Serves /archived-sessions/* JSON routes (list / restore / restore-many /
// delete / delete-many / sessions / workspaces / move) over the host
// `webServer`. The browser Settings sections ("归档会话" & "移动会话") talk to
// these. Reads/writes the durable workspace archive set
// (workspaceRegistry + storageDomain), folds titles/dates/workspace tags from
// session persistence, physically removes a session's log file on delete, and
// relocates a conversation (session) between workspaces on move.
import { mkdir, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { rewriteFrame0CwdInMemory, scanZstdFrames } from './zstd-frame.js'
import { createSessionMarkdownBuilder } from './markdown.js'
import { createStarIndex } from './star-index.js'
import { createPendingMoveStore } from './pending-moves.js'
import { sweepStaleStateTemps } from './state-temp-sweep.js'
import { aggregateStorage } from './storage-stats.js'
import { createAutoArchiveStore, pickInactiveCandidates } from './auto-archive.js'
import { createSessionMetaCache, persistFingerprintOf } from './session-meta-cache.js'
import { createTitleIndexStore } from './title-persist-index.js'
import { createPersistenceAdapter } from './compat/persistence.js'
import { detectCapabilities, requireCapability } from './compat/capabilities.js'
import { pathOwnsSession } from './path-guard.js'
import { purgeSessionArtifacts, moveSessionToCwd } from './handle-era-ops.js'
import { classifyLineage, isEmptyEventTypes, EMPTY_DECODE_LIMIT } from './lineage.js'

// 构建指纹：build.mjs 以 define 在编译期注入；直接以源码运行（测试）时为 'dev'。
// 用途：capabilities 带出 buildStamp，一眼判断「运行中的 host 是不是这份构建」——
// 插件 host 端只在宿主启动时加载一次，改完 lib 不重启宿主等于白改。
const BUILD_STAMP = typeof __BUILD_STAMP__ !== 'undefined' ? __BUILD_STAMP__ : 'dev'


export const name = 'dsh-sessions-manager'
export const inject = ['webServer', 'workspaceRegistry', 'sessionPersistence', 'sessionQuery', 'storageDomain']

const MAX_TITLE = 80
// 插件自有状态目录（星标 / 自动归档 / 标题索引共用）。与 star-index.js、auto-archive.js
// 的默认目录保持一致，环境变量同名，便于测试注入。
const STATE_DIR = process.env.DSH_SESSIONS_MANAGER_STAR_DIR || join(homedir(), '.dsh', 'sessions-manager')
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
      // 持久索引只认可跨重启的指纹（legacy 的文件指纹 / handle 世代的 sz 指纹，
      // 见 session-meta-cache.persistFingerprintOf——issue #8 之前 handle 世代
      // 从不落盘，导致每次重启都全量重新解码）。
      const fp = persistFingerprintOf(stat)
      if (!fp) continue
      if (fp && entry.fingerprint === fp) {
        hits.set(id, { title: entry.title, cwd: entry.cwd, createdAt: entry.createdAt })
      }
    }
    return hits
  }

  // 把本批真正解码出的元数据回写持久索引（索引只是加速器：写失败不影响响应，
  // 队列内部已串行化 + 原子替换）。**必须 await** —— 它是持久写入，浮动写入会在
  // 调用方/测试 teardown 已开始清理状态目录时落地（`ENOTEMPTY: rmdir .../state`），
  // 且"响应已返回但索引没落盘"时进程若恰好退出就会丢条目。
  // 指纹用 persistFingerprintOf：legacy 文件指纹 + handle 世代 sz(sizeBytes) 指纹
  // 都可跨重启；rev: 指纹仍被排除（实例内 opaque token，issue #8）。
  async function persistDecoded(decoded, statsById) {
    if (!decoded || !decoded.size) return
    const batch = {}
    const now = Date.now()
    for (const [id, meta] of decoded) {
      const fp = persistFingerprintOf(statsById.get(id))
      if (!fp) continue
      batch[id] = { title: meta.title, cwd: meta.cwd, createdAt: meta.createdAt, fingerprint: fp, updatedAt: now }
    }
    if (!Object.keys(batch).length) return
    try { await titleIndex.merge(batch) } catch (e) { /* 索引写失败不影响本次响应 */ }
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
  // 成本模型（issue #1 → issue #8）：runtime 的标题投影（readTitleSnapshots）
  // 在 0.1.x 上对每条非 live 会话都是**整本日志解码**（SessionCorpus.projectMany
  // → inspectPersisted）。列表构建绝不能在请求路径上同步触发它——issue #8 实测：
  // 87 本日志 / 249MB 的库，一次冷启动全量投影把宿主打满 ~90s CPU。
  //
  // 因此请求路径只消费两级缓存（metaCache 内存缓存 → titleIndex 持久索引），
  // 缺失的会话交给后台预热队列分批补齐（见 enqueueWarm/runWarm）；侧栏高频
  // 轮询 + 管理面板刷新会让补齐结果自然浮现。
  const EMPTY_META = { title: null, cwd: null, createdAt: null }

  // —— 冷启动后台预热（issue #8）—————————————————————————————————————
  // 单飞队列：请求路径发现缓存未命中的会话，把 { stat, header } 快照丢进
  // warmQueue，由 runWarm 以小批次消费。每批之间 setImmediate 让步事件循环，
  // 绝不独占宿主主线程；结果写 metaCache + 持久标题索引。stat 是入队时刻的
  // 快照——若日志在预热期间又变了，下次请求的指纹比对会再次判未命中并重新
  // 入队，天然自愈。
  const WARM_CHUNK = 4
  const warmQueue = new Map()
  let warmRunning = false
  let warmKickTimer = null

  function scheduleWarm() {
    if (warmKickTimer || warmRunning) return
    warmKickTimer = setTimeout(() => { warmKickTimer = null; runWarm() }, 25)
    // unref：预热绝不反过来把宿主进程钉住（与 autoArchive「无定时器」同一原则）。
    if (typeof warmKickTimer.unref === 'function') warmKickTimer.unref()
  }

  function enqueueWarm(ids, statsById, entryById) {
    if (!ids || !ids.length) return
    for (const id of ids) {
      const key = String(id)
      const entry = entryById ? entryById.get(key) : null
      warmQueue.set(key, {
        stat: statsById ? (statsById.get(key) || null) : null,
        header: (entry && entry.header) || null,
      })
    }
    scheduleWarm()
  }

  async function runWarm() {
    if (warmRunning) return
    warmRunning = true
    try {
      while (warmQueue.size) {
        const batch = [...warmQueue.entries()].slice(0, WARM_CHUNK)
        for (const [id] of batch) warmQueue.delete(id)
        try {
          const ids = batch.map(([id]) => id)
          const snapshotById = await projectTitles(ids)
          const decoded = new Map()
          const statsById = new Map()
          for (const [id, desc] of batch) {
            const snapshot = snapshotById.has(id) ? snapshotById.get(id) : null
            const meta = metaFromSnapshot(snapshot)
            // cwd/createdAt 永远以最新 list header 为权威（投影的 session 头可能
            // 陈旧；移动会话后尤其如此），投影只负责标题。
            if (desc.header) {
              if (typeof desc.header.cwd === 'string') meta.cwd = desc.header.cwd
              if (desc.header.createdAt != null) meta.createdAt = desc.header.createdAt
            }
            metaCache.set(id, desc.stat, meta)
            statsById.set(id, desc.stat)
            if (desc.stat) decoded.set(id, meta)
          }
          await persistDecoded(decoded, statsById)
        } catch (e) { /* 单批失败不影响后续批次：索引/缓存只是加速器 */ }
        // 批间让步：保证宿主事件循环（RPC/心跳/其他插件）始终可调度。
        await new Promise((resolve) => setImmediate(resolve))
      }
    } finally {
      warmRunning = false
      // 预热期间又有新请求入队 → 再排一轮。
      if (warmQueue.size) scheduleWarm()
    }
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
        // 观察，绝不再绕道私有磁盘路径补 stat。revision 进内存缓存指纹；
        // sizeBytes 供 persistFingerprintOf 派生跨重启的 sz 持久指纹（issue #8）。
        if (entry && typeof entry.revision === 'string' && entry.revision) {
          if (Number.isFinite(entry.sizeBytes)) sizeById.set(id, Number(entry.sizeBytes))
          statsById.set(id, Number.isFinite(entry.sizeBytes)
            ? { revision: entry.revision, sizeBytes: Number(entry.sizeBytes) }
            : { revision: entry.revision })
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
  // 待移动队列：会话被占用（DSH 打开中）时登记，等它释放后自动完成移动。
  // 见 src/pending-moves.js 的模块注释（0.1.5 单写者锁没有公共释放 API）。
  const pendingMoves = createPendingMoveStore()
  // Auto-archive settings live in their own schema-v4 store, off by default.
  const autoArchive = createAutoArchiveStore()
  // 启动清扫：进程在「写临时文件 → rename」之间被杀会留下 .<name>-<pid>-<ts>.tmp
  // 孤儿（实测一次累积 153 个）。这里把 1 小时前的旧临时文件收掉，不碰正在写的。
  sweepStaleStateTemps([STATE_DIR, TRASH_DIR], {}).catch(() => {})

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
      // handle 时代官方收走了 locate，用守卫式推导（root → 目录结构 → id 归属）
      // 代替：推导成功且文件在盘 = 真核验通过，而不是标注 unverified 放行。
      const loc = await persistence.locateVerified(header).catch(() => null)
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
        // locateVerified：legacy 走官方 locate；handle 时代官方收走了 locate，
        // 改由三层守卫推导（root → 目录结构 → id 归属），失败返回 null。
        // 比仅靠回收站条目里的 originalPath 更可靠：originalPath 过期或缺失时
        // 仍能从当前存储布局重新推导。
        const located = current ? await persistence.locateVerified(current.header) : null
        if (located && typeof located.path === 'string') target = located.path
      } catch (e) {}
      // 幽灵记录兜底：会话不在 list 里（后端索引滞后/索引缺失）但日志仍在盘上。
      // 用 statSession 拿官方 header，再走守卫推导，避免退化成「只删单文件」
      // 或直接 409 拒绝。
      if (!locatedHeader && typeof persistence.statSession === 'function') {
        try {
          const snap = await persistence.statSession(sid)
          if (snap && snap.header) {
            locatedHeader = snap.header
            const located = await persistence.locateVerified(snap.header)
            if (located && typeof located.path === 'string') target = located.path
          }
        } catch (e) {}
      }
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
    // 星标清理必须 await。原先这里是浮动写入（`stars.removeIds([sid]).catch(...)`）：
    // 删除结果先返回、星标文件随后才落地，正好会撞上调用方（或测试 teardown）已开始的
    // 状态目录清理 → `ENOTEMPTY: rmdir .../state`（全量测试里约 1/4 概率偶发失败）。
    // 而且"删除成功"不该早于状态落盘：进程恰好在此刻退出就会留下指向已删会话的星标。
    try { await stars.removeIds([sid]) } catch (e) { /* 星标清理失败不阻塞删除结果 */ }
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
      const error = new Error('会话正被 DSH 打开，暂时无法移动；请重启 DSH 后再试。')
      error.status = 409
      error.code = 'DSM_SESSION_BUSY'
      throw error
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

  // 移动过程的非致命提示（如源目录仍有旧代日志未能清理），随成功结果一并
  // 回报给客户端展示。
  const moveNotes = []

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
        const keptInSource = await cleanupMovedSourceDir(dirname(oldPath))
        if (keptInSource.length > 0) moveNotes.push(`源目录未能清理干净（残留 ${keptInSource.join('、')}），若后续移动报“duplicate”请手动清空该目录。`)
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

    // 移动成功后的源目录收尾（legacy 路径）：**整体移除**。目标侧已写入校验通过的
    // 权威日志，源目录只要还留着任何一代日志（legacy 旧代 session.jsonl.zstd 或
    // session.vN.jsonl.zstd），就会让同 id 出现在两个项目目录，后端 list/create
    // 立刻报 duplicate。返回未能清理时的残留文件名（供如实回报）。
    const cleanupMovedSourceDir = async (dir) => {
      let entries = null
      try { entries = await readdir(dir) } catch (e) { return [] }
      try { await rm(dir, { recursive: true, force: true }) } catch (e) { return entries }
      return []
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
        const movedHandle = await moveSessionToCwd({ sp, sid, header: meta, canonical, events, inheritedEventCount: r.inheritedEventCount })
        if (movedHandle && Array.isArray(movedHandle.reclaimedSiblings) && movedHandle.reclaimedSiblings.length > 0) {
          moveNotes.push(`已顺带回收 ${movedHandle.reclaimedSiblings.length} 处被取代的旧代日志副本（历史移动残留），避免同一会话在多目录重复。`)
        }
        if (movedHandle && movedHandle.sourceCleanup && movedHandle.sourceCleanup.cleaned === false) {
          moveNotes.push(`源目录未能清理干净（残留 ${movedHandle.sourceCleanup.leftover.join('、')}），若后续移动报“duplicate”请手动清空该目录。`)
        }
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
          if (oldPath) {
            const keptInSource = await cleanupMovedSourceDir(dirname(oldPath))
            if (keptInSource.length > 0) moveNotes.push(`源目录未能清理干净（残留 ${keptInSource.join('、')}），若后续移动报“duplicate”请手动清空该目录。`)
          }
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
      ...(moveNotes.length > 0 ? { notes: moveNotes } : {}),
    }
  }

  // ---- 待移动队列（活跃 / 被占用的会话）-----------------------------------
  // 0.1.5 的单写者锁由持有写句柄的进程掌控，插件既拿不到句柄也没有释放它的公共
  // API；在占用期硬搬目录会让在写者继续写旧 inode 并在旧路径重建空壳。因此占用时
  // 只登记排队，等宿主释放（session/disposed）或下次插件
  // 启动时（会话尚未被打开）自动完成。
  const QUEUE_NOTE = '已排队：该会话正被 DSH 打开（写所有权只在 DSH 退出时释放）。重启 DSH 时会自动完成，请先别打开它。'

  function isBusyError(e) {
    if (!e) return false
    if (e.code === 'DSM_SESSION_BUSY') return true
    const text = String((e && e.message) || e)
    return /正被 DSH 打开|already owned/i.test(text)
  }

  // 移动入口：占用 → 排队；其它错误照旧抛出。返回成功结果或排队结果。
  async function moveOrQueue(sid, targetPath) {
    try {
      return await moveOne(sid, targetPath)
    } catch (e) {
      if (!isBusyError(e)) throw e
      await pendingMoves.queue(sid, targetPath)
      return { ok: true, moved: false, queued: true, notes: [QUEUE_NOTE] }
    }
  }

  // 启动后的「学步期」：这段时间内 moveOne 的非占用类失败只当环境未就绪，不计入
  // 「多次失败即放弃」的计数（否则 boot 竞态会把用户的排队项白白丢掉）。
  const BOOT_WARMUP_MS = 30000
  const bootedAt = Date.now()

  let queueRunning = false
  async function runPendingMoves(reason) {
    if (queueRunning) return { ran: false, moved: 0, kept: 0 }
    queueRunning = true
    let moved = 0
    const notes = []
    try {
      const items = await pendingMoves.list()
      for (const item of items) {
        try {
          await moveOne(item.sessionId, item.targetPath)
          await pendingMoves.remove([item.sessionId])
          metaCache.invalidate(item.sessionId)
          moved++
          notes.push(`排队中的移动已完成：${String(item.sessionId).slice(0, 18)}…`)
        } catch (e) {
          if (isBusyError(e)) continue // 仍被占用：留在队列里，等下一次触发
          if (Date.now() - bootedAt < BOOT_WARMUP_MS) continue // boot 期未就绪：不记失败
          const bumped = await pendingMoves.bumpAttempts(item.sessionId)
          if (bumped && bumped.dropped) notes.push(`排队中的移动多次失败已放弃：${String(item.sessionId).slice(0, 18)}…（${String((e && e.message) || e)}）`)
        }
      }
      if (moved > 0) { try { await reindexRegistry() } catch (e) { /* best-effort */ } }
    } finally {
      queueRunning = false
    }
    if (notes.length > 0) {
      try { for (const n of notes) console.warn('[dsh-sessions-manager] ' + n) } catch (e) { /* ignore */ }
    }
    void reason
    return { ran: true, moved, kept: (await pendingMoves.list()).length }
  }

  // 排队项的补跑时机。**关键前提**：0.1.5 的单写者所有权一经 open 就持有到**进程退出**
  // 为止——官方没有任何「关闭会话 / 释放所有权」的公开入口（`dsh-commands` 只有
  // compact/feedback/goal；宿主无 unloadSession/closeSession/evict），而浏览器一连上就会
  // 自动打开/新建会话，一旦被打开就再也搬不动。所以唯一可靠窗口是**宿主刚起来、浏览器
  // 还没连上**的那一两秒 ⇒ 启动后立刻试，并在前 30s 内密集重试；之后每 120s 兜底；
  // 会话真被释放（session/disposed）时 500ms 后再试一次。
  const queueEffect = typeof ctx.effect === 'function' ? ctx.effect.bind(ctx) : ((fn) => { fn() })
  if (typeof ctx.on === 'function') {
    queueEffect(() => ctx.on('session/disposed', (session) => {
      const id = session && session.id != null ? String(session.id) : null
      if (!id) return
      pendingMoves.has(id).then((queued) => {
        if (!queued) return
        const t = setTimeout(() => { runPendingMoves('session-disposed').catch(() => {}) }, 500)
        if (t && typeof t.unref === 'function') t.unref()
      }).catch(() => {})
    }))
  }
  queueEffect(() => {
    // 每个启动补跑定时器都要 unref：宿主自己不会闲下来无所谓，但测试里未 unref 的
    // 30s 定时器会让 node:test 多等 30s 才退出（整套测试被无谓拖长，实测见报告）。
    const timers = [0, 1000, 3000, 6000, 12000, 30000].map((ms) => {
      const t = setTimeout(() => {
        runPendingMoves(ms === 0 ? 'startup' : `startup+${ms}`).catch(() => {})
      }, ms)
      if (t && typeof t.unref === 'function') t.unref()
      return t
    })
    // 轻量周期重试：只在队列非空时干活（队列空 = 一次本地 JSON 读取）。
    const tickTimer = setInterval(() => {
      pendingMoves.list().then((items) => { if (items.length > 0) return runPendingMoves('tick') }).catch(() => {})
    }, 120000)
    if (tickTimer && typeof tickTimer.unref === 'function') tickTimer.unref()
    return () => { for (const t of timers) clearTimeout(t); clearInterval(tickTimer) }
  })

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
  //   3. 缓存未命中的会话**绝不在请求路径上同步投影**（issue #8：runtime 的
  //      readTitleSnapshots 每条都是整本解码）——入队后台预热，先以占位元数据返回
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
    const usage = await collectUsage(entries)
    // 先按指纹把「缓存命中」与「需要补齐」分开。
    const statsById = new Map(visibleIds.map((id) => [
      id,
      (usage.statsById && usage.statsById.get(id)) || { mtimeMs: usage.mtimeById.get(id), size: usage.sizeById.get(id) },
    ]))
    const { cached, missing } = metaCache.partition(visibleIds, statsById)
    // P4：missing 里先查持久标题索引（冷启动跳过整本解码），命中的回填内存缓存。
    // cwd/createdAt 回填时以最新 list header 为权威——持久条目里的 cwd 可能因
    // 移动会话而陈旧（sz 指纹对 cwd 无感知），标题才是索引的产出物。
    const persisted = await hydrateFromPersist(missing, statsById)
    for (const [id, meta] of persisted) {
      const entry = entryById.get(id)
      const header = entry && entry.header ? entry.header : null
      metaCache.set(id, statsById.get(id), {
        title: meta.title,
        cwd: (header && typeof header.cwd === 'string' && header.cwd) ? header.cwd : meta.cwd,
        createdAt: (header && header.createdAt != null) ? header.createdAt : meta.createdAt,
      })
    }
    const stillMissing = missing.filter((id) => !persisted.has(id))
    // issue #8：缺失部分交后台预热（分批 + 让步），请求路径零投影、零日志解码。
    if (stillMissing.length) enqueueWarm(stillMissing, statsById, entryById)
    const items = []
    for (const id of visibleIds) {
      // metaCache 优先：persisted 命中已带 header 权威 cwd/createdAt 回填进
      // metaCache（persisted.get 里的 cwd 可能因移动会话而陈旧）。
      // 完全未命中的会话也不能丢 cwd/createdAt——它们来自 list header，零成本
      // 且是工作区归属/创建时间的权威来源；只有标题允许占位等后台预热（issue #8）。
      let meta = metaCache.get(id, statsById.get(id)) || persisted.get(id) || null
      if (!meta) {
        meta = { title: null, cwd: null, createdAt: null }
        const entry = entryById.get(id)
        const header = entry && entry.header ? entry.header : null
        if (header) {
          if (typeof header.cwd === 'string') meta.cwd = header.cwd
          if (header.createdAt != null) meta.createdAt = header.createdAt
        }
      }
      const it = buildItem(id, meta, usage, !!(opts && opts.usage))
      items.push({ ...it, archived: currentArchived.has(it.sessionId) })
    }
    if (opts && opts.onlyArchived) {
      // /archived-sessions/list 的语义：只返回归档集里仍然存在的会话，
      // 且不带 archived 布尔注记（旧路由的输出形状）。
      const archivedItems = []
      for (const it of items) {
        if (!it.archived) continue
        const { archived: _drop, ...rest } = it
        archivedItems.push(rest)
      }
      return { items: archivedItems, usage }
    }
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
      const entryById = new Map(entries.map((entry) => [entry.id, entry]))
      const statsById = new Map(ids.map((id) => [
        id,
        (usage.statsById && usage.statsById.get(id)) || { mtimeMs: usage.mtimeById.get(id), size: usage.sizeById.get(id) },
      ]))
      const { cached, missing } = metaCache.partition(ids, statsById)
      // P4：与列表构建共用持久标题索引，冷启动零解码。
      const persisted = await hydrateFromPersist(missing, statsById)
      for (const [id, meta] of persisted) {
        const entry = entryById.get(id)
        const header = entry && entry.header ? entry.header : null
        metaCache.set(id, statsById.get(id), {
          title: meta.title,
          cwd: (header && typeof header.cwd === 'string' && header.cwd) ? header.cwd : meta.cwd,
          createdAt: (header && header.createdAt != null) ? header.createdAt : meta.createdAt,
        })
      }
      const rest = missing.filter((id) => !persisted.has(id))
      // issue #8：缺失标题不在请求路径上同步投影（runtime 投影 = 逐条整本解码），
      // 交后台预热补齐；侧栏高频轮询会让补齐结果自然浮现。
      if (rest.length) enqueueWarm(rest, statsById, entryById)
      for (const id of ids) {
        const meta = metaCache.get(id, statsById.get(id)) || persisted.get(id) || null
        if (meta && meta.title) authorityTitleCache.set(id, String(meta.title))
      }
    }
    // 血缘分类（issue #6）：结构分类（子代理 / fork 分支）来自 list snapshot
    // 的 header，零解码；空白判定见下方 refineEmptyLineage（0.1.3 起体积法
    // 失效，改为事件类型精判）。普通顶层非空会话不产生条目，payload 最小。
    const lineage = {}
    for (const entry of entries) {
      const info = classifyLineage(entry.header, entry.sizeBytes)
      if (info) lineage[entry.id] = info
    }
    await refineEmptyLineage(lineage, entries)
    return {
      titles: Object.fromEntries(authorityTitleCache),
      trashedSessionIds: store.items.map((item) => String(item.sessionId)),
      purgedSessionIds: activeTombstones,
      lineage,
    }
  }

  // 空会话判定缓存：id → { sizeBytes, empty }。日志没变（sizeBytes 相同）
  // 就不重复解码——authority 会被侧栏高频轮询，缓存让它保持在近零成本。
  const emptyScanCache = new Map()

  // 0.1.3 空会话精判（事件类型法，见 lineage.js）：体积阈值对新格式失效
  // （头部扩容 + 恒存生命周期帧），改为对「压缩体积 ≤ EMPTY_DECODE_LIMIT」
  // 的候选走官方 inspectSession 解码，按事件类型判定。超过上限的日志必有
  // 内容，直接跳过（维持体积法/结构分类的结果）。解码失败按「非空」处理：
  // 宁可漏判一个空会话，不能把有内容的会话错标成空。
  async function refineEmptyLineage(lineage, entries) {
    if (!persistence || typeof persistence.inspectSession !== 'function') return
    for (const entry of entries) {
      const size = entry && Number.isFinite(entry.sizeBytes) ? entry.sizeBytes : null
      if (size === null || size > EMPTY_DECODE_LIMIT) continue
      const id = String(entry.id)
      let scanned = emptyScanCache.get(id)
      if (!scanned || scanned.sizeBytes !== size) {
        let isEmpty = false
        try {
          const types = []
          await persistence.inspectSession(id, { onEvents: (batch) => {
            for (const ev of batch || []) if (types.length < 64) types.push(ev && ev.type)
          } })
          isEmpty = isEmptyEventTypes(types)
        } catch (e) { isEmpty = false }
        scanned = { sizeBytes: size, empty: isEmpty }
        emptyScanCache.set(id, scanned)
      }
      if (scanned.empty) {
        // 结构分类没建条目的普通会话也要补上（0.1.3 空会话 header 无血缘字段，
        // classifyLineage 对它们返回 null）。
        const info = lineage[id] || (lineage[id] = { origin: null, parentSession: null, delegationDepth: 0, empty: false })
        info.empty = true
      } else if (lineage[id]) {
        // 旧体积法在小日志上的假阳性（如 alpha.2 单事件日志）在这里纠正；
        // 纠正后若无任何血缘结构，条目整个撤掉，维持「普通会话不产生条目」。
        const info = lineage[id]
        info.empty = false
        if (!info.origin && !info.parentSession) delete lineage[id]
      }
    }
    // 缓存只保留「本轮仍参与判定」的会话：已彻底删除或日志膨胀超过解码
    // 上限的条目不再有用，淘汰掉防止 Map 随历史会话无限增长。
    const live = new Set()
    for (const entry of entries) {
      const size = entry && Number.isFinite(entry.sizeBytes) ? entry.sizeBytes : null
      if (size !== null && size <= EMPTY_DECODE_LIMIT) live.add(String(entry.id))
    }
    for (const key of emptyScanCache.keys()) {
      if (!live.has(key)) emptyScanCache.delete(key)
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
      handler: async (req, res) => json(res, { ...capabilities, buildStamp: BUILD_STAMP }),
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
          // issue #8：归档列表也复用「缓存直读 + 后台预热」的统一管线。
          // 旧实现逐条 resolveOne(id)（无 header、无指纹）——冷启动对每条归档
          // 会话整本解码，且连进程内缓存都永远命中不了。
          const wanted = new Set(idStrs)
          const detailed = await allSessionItemsDetailed()
          const items = detailed.items.filter((it) => wanted.has(String(it.sessionId)) && it.archived)
          for (const it of items) delete it.archived
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
          try { await titleIndex.remove([sid]) } catch (e) { /* 索引清理失败不阻塞删除结果 */ }
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
            try { results.push({ sessionId: sid, ok: true, ...(await purgeFromTrash(sid)) }); metaCache.invalidate(sid); await titleIndex.remove([sid]).catch(() => {}) }
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

    // 子代理血缘树（管理视图数据面）：给定父会话，返回 origin==='subagent'
    // 的递归子树。DSH 原生目录（ui-subagent）只读，这里补管理能力的数据来源。
    // 只读官方 header 血缘字段（parentSession/origin/delegationDepth/createdAt），
    // 标题走既有批量投影（readTitleSnapshots），零整本日志解码。
    // live 标记 = 会话在内存里活着（正在运行或已打开）：批量清理必须跳过。
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/lineage-tree',
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req)
          const rootId = body && typeof body.sessionId === 'string' ? body.sessionId : ''
          if (!rootId || !isSafeSessionId(rootId)) return json(res, { error: 'missing sessionId' }, 400)
          const headerById = new Map()
          const sizeById = new Map()
          // 与会话列表同源的可见性判定：回收站项目一律不参与血缘树。
          const trashedIds = new Set()
          let purgedIds = []
          const persistedIds = new Set()
          try {
            const store = await readTrashStore()
            for (const item of store.items) trashedIds.add(String(item.sessionId))
            purgedIds = store.purgedSessionIds.map(String)
          } catch (e) { /* best-effort */ }
          const addHeader = (h, sizeBytes) => {
            if (!h || h.id == null) return
            const id = String(h.id)
            // 回收站里的会话（软删除后日志已搬走）不能出现在血缘树里，否则
            // 会出现「删掉了侧栏还在」。彻底删除的墓碑在下面按「当前已不存在」
            // 统一剔除，避免压住后来同 id 重建的会话。
            if (headerById.has(id) || trashedIds.has(id)) return
            headerById.set(id, {
              parentSession: h.parentSession != null ? String(h.parentSession) : null,
              subagent: h.origin === 'subagent',
              delegationDepth: Number.isFinite(h.delegationDepth) ? h.delegationDepth : null,
              createdAt: typeof h.createdAt === 'number' ? h.createdAt : null,
            })
            if (Number.isFinite(sizeBytes)) sizeById.set(id, sizeBytes)
          }
          try {
            for (const entry of await persistence.listEntries()) {
              addHeader(entry.header, entry.sizeBytes)
              if (entry && entry.id != null) persistedIds.add(String(entry.id))
            }
          } catch (e) { /* best-effort */ }
          const liveIds = new Set()
          const live = ctx.get('sessions')
          try {
            if (live && typeof live.list === 'function') {
              live.list().forEach((s) => { liveIds.add(String(s.id)); addHeader(s.header, undefined) })
            }
          } catch (e) { /* best-effort */ }
          // 墓碑只对「持久层里确实没了」的 id 生效：同 id 会话后来重新出现时
          // 必须让位，不能永久压住新会话（与会话列表同一套规则）。
          for (const id of purgedIds) {
            if (!persistedIds.has(id)) headerById.delete(id)
          }
          // 子代理索引：parentSession → 直接子代理 id 列表（只收 origin==='subagent'）。
          const kidsOf = new Map()
          for (const [id, h] of headerById) {
            if (!h.subagent || !h.parentSession) continue
            if (!kidsOf.has(h.parentSession)) kidsOf.set(h.parentSession, [])
            kidsOf.get(h.parentSession).push(id)
          }
          // 递归展开：visited 防环，节点总数封顶防病态数据。
          const MAX_NODES = 500
          let nodeCount = 0
          const build = (id, depth, visited) => {
            nodeCount++
            const h = headerById.get(id) || {}
            const childVisited = new Set(visited)
            childVisited.add(id)
            const kidIds = nodeCount >= MAX_NODES ? [] : (kidsOf.get(id) || []).filter((k) => !childVisited.has(k))
            return {
              sessionId: id,
              parentSession: h.parentSession || null,
              delegationDepth: h.delegationDepth,
              depth,
              createdAt: h.createdAt || null,
              sizeBytes: sizeById.has(id) ? sizeById.get(id) : null,
              live: liveIds.has(id),
              title: null,
              children: kidIds.map((k) => build(k, depth + 1, childVisited)),
            }
          }
          const nodes = (kidsOf.get(rootId) || []).map((k) => build(k, 1, new Set([rootId])))
          const allIds = [rootId]
          const walk = (n) => { allIds.push(n.sessionId); n.children.forEach(walk) }
          nodes.forEach(walk)
          const titles = await projectTitles(allIds)
          const titleOf = (id) => {
            const snap = titles.get(id)
            const m = snap ? metaFromSnapshot(snap) : null
            return (m && m.title) || null
          }
          const fill = (n) => { n.title = titleOf(n.sessionId); n.children.forEach(fill) }
          nodes.forEach(fill)
          json(res, { parent: { sessionId: rootId, title: titleOf(rootId) }, nodes })
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
          const moved = await moveOrQueue(sid, target)
          if (moved.queued) return json(res, { sessionId: sid, ...moved })
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

    // Move many conversations to one target workspace (issue #7). Sequential
    // on purpose: each move rewrites frame0 (file IO), and one bad session
    // must not block the rest. Single reindex at the end covers all moves.
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/move-many',
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req)
          const ids = Array.isArray(body && body.sessionIds)
            ? [...new Set(body.sessionIds.filter((x) => typeof x === 'string' && x))]
            : []
          const target = body && typeof body.targetPath === 'string' ? body.targetPath : null
          if (!ids.length) return json(res, { ok: false, error: 'missing sessionIds' }, 400)
          if (!target) return json(res, { ok: false, error: 'missing targetPath' }, 400)
          let moved = 0
          const failed = []
          const queued = []
          for (const sid of ids) {
            try {
              const r = await moveOrQueue(sid, target)
              if (r && r.queued) { queued.push(sid); continue }
              // frame0 的 cwd 被改写：与单移动同理由，主动丢缓存不等指纹失效。
              metaCache.invalidate(sid)
              moved++
            } catch (e) {
              const err = e && e.code ? { sessionId: sid, error: String((e && e.message) || e), code: e.code } : { sessionId: sid, error: String((e && e.message) || e) }
              failed.push(err)
            }
          }
          try { await reindexRegistry() } catch (e) { /* best-effort */ }
          json(res, {
            moved,
            failed,
            ...(queued.length > 0 ? { queued, notes: [`${queued.length} 个会话已排队（正被 DSH 打开），重启 DSH 后会自动完成；重启后请先别打开它们。`] } : {}),
          })
        } catch (e) {
          json(res, { ok: false, code: e && e.code, error: String((e && e.message) || e) }, errorStatus(e))
        }
      },
    }))

    // 待移动队列：查看 / 取消（会话被占用时排队，释放后自动完成）。
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/pending-moves',
      handler: async (req, res) => {
        try {
          const items = await pendingMoves.list()
          json(res, { items: items.map((i) => ({ sessionId: i.sessionId, targetPath: i.targetPath, queuedAt: i.queuedAt, attempts: i.attempts })) })
        } catch (e) {
          json(res, { error: String((e && e.message) || e) }, 500)
        }
      },
    }))
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/archived-sessions/pending-moves/cancel',
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req)
          const ids = parseIds(body)
          if (!ids || ids.length === 0) return json(res, { ok: false, error: 'missing sessionIds' }, 400)
          const removed = await pendingMoves.remove(ids)
          json(res, { ok: true, removed })
        } catch (e) {
          json(res, { ok: false, error: String((e && e.message) || e) }, errorStatus(e))
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
