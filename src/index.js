// dsh-sessions-manager — host half.
//
// Serves /archived-sessions/* JSON routes (list / restore / restore-many /
// delete / delete-many / sessions / workspaces / move) over the host
// `webServer`. The browser Settings sections ("归档会话" & "移动会话") talk to
// these. Reads/writes the durable workspace archive set
// (workspaceRegistry + storageDomain), folds titles/dates/workspace tags from
// session persistence, physically removes a session's log file on delete, and
// relocates a conversation (session) between workspaces on move.
import { mkdir, realpath, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import zlib from 'node:zlib'
import { homedir } from 'node:os'

export const name = 'dsh-sessions-manager'
export const inject = ['webServer', 'workspaceRegistry', 'sessionPersistence', 'sessionQuery', 'storageDomain']

const MAX_TITLE = 80
// Recycle bin (回收站): normal deletes land here instead of being erased.
const TRASH_DIR = join(homedir(), '.dsh', 'sessions-manager-trash')
const TRASH_INDEX = join(TRASH_DIR, 'index.json')
// -- per-session detail aggregation (v2.0: 取 Zephyr-vibe buildDetails 精华) --
// 识别“搜索/抓取”类工具，用来收集 fetch 记录。
const FETCH_TOOL_RE = /search|fetch|download|browse/i
const MAX_FETCHES = 12   // fetch 记录上限（防响应过大）
const MAX_FILES = 20     // write/edit 文件列表上限

function json(res, value, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
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
  for (const v of raw) if (typeof v === 'string' && v) ids.push(v)
  return ids
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

  let wsByPath = {}

  async function resolveOne(id) {
    let title = null, createdAt = null, cwd = null
    try {
      const o = await sq.readTitleSnapshot(id)
      if (o) {
        if (o.title && o.title.title) title = String(o.title.title)
        if (o.session) { cwd = o.session.cwd || null; createdAt = o.session.createdAt || null }
      }
    } catch (e) { /* fall back to raw log */ }
    if (!title || !cwd) {
      try {
        const r = await sp.readFrom(id, 0)
        if (r.meta) {
          if (!cwd) cwd = r.meta.cwd || null
          if (!createdAt) createdAt = r.meta.createdAt || null
        }
        if (!title && Array.isArray(r.events)) title = foldTitle(r.events)
      } catch (e2) { /* keep what we have */ }
    }
    const ws = cwd ? wsByPath[cwd] : undefined
    const workspaceGone = !!(cwd && !ws)
    const display = title ? (String(title).length > MAX_TITLE ? String(title).slice(0, MAX_TITLE) + '…' : String(title)) : null
    return {
      sessionId: id,
      title: display,
      createdAt: createdAt || null,
      workspacePath: cwd || null,
      workspaceTitle: (ws && ws.title) ? ws.title : null,
      workspaceGone: workspaceGone ? true : false,
      hasWorkspace: !!cwd,
    }
  }

  // Restore (unarchive) one session; throws on failure.
  async function restoreOne(sid) {
    const state = await archivedState()
    const list = state.archivedSessionIds.map(String)
    if (!list.includes(sid)) return { ok: true, restored: false }
    await writeArchived(list.filter((x) => x !== sid))
    return { ok: true, restored: true }
  }

  // ---- Recycle bin (回收站) helpers ----------------------------------------
  const trashPathFor = (sid) => join(TRASH_DIR, sid + '.jsonl')
  async function readTrash() {
    try { return JSON.parse(readFileSync(TRASH_INDEX, 'utf8')) || [] } catch (e) { return [] }
  }
  async function writeTrash(list) {
    await mkdir(TRASH_DIR, { recursive: true })
    writeFileSync(TRASH_INDEX, JSON.stringify(list, null, 2))
  }

  // Soft-delete one session: record it in the recycle-bin index but KEEP its
  // log in the original workspace directory. Moving the file out (and detaching
  // it from the workspace) orphaned the session into DSH's "未分组" group and
  // made restore land in 未分组 instead of the original workspace — so we leave
  // the file where it is and let the sidebar DOM shim hide the row instead.
  async function deleteOne(sid) {
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
    const list = await readTrash()
    const entry = {
      sessionId: sid,
      title: title || cwd || sid,
      cwd: cwd || null,
      header: header || null,
      originalPath: removedPath || null,
      deletedAt: Date.now(),
    }
    const next = list.some((t) => t.sessionId === sid)
      ? list.map((t) => (t.sessionId === sid ? entry : t))
      : list.concat(entry)
    await writeTrash(next)
    return { ok: true, trashed: true }
  }

  // Restore a trashed session: the log never left its original workspace dir,
  // so we just drop it from the recycle-bin index and the sidebar reveals it in
  // its original workspace (no move / no re-attach needed).
  async function restoreFromTrash(sid) {
    const list = await readTrash()
    const entry = list.find((t) => t.sessionId === sid)
    if (!entry) throw new Error('回收站中找不到该会话')
    await writeTrash(list.filter((t) => t.sessionId !== sid))
    return { ok: true, restored: true }
  }

  // Permanently erase a trashed session: physically delete its log (still in
  // the original workspace dir) and detach it from any workspace so DSH drops it.
  async function purgeFromTrash(sid) {
    const list = await readTrash()
    const entry = list.find((t) => t.sessionId === sid)
    if (entry) {
      const target = entry.originalPath || (entry.cwd ? join(entry.cwd, sid + '.jsonl') : null)
      if (target) {
        try { await unlink(target) } catch (e) { if (e && e.code !== 'ENOENT') throw new Error('删除文件失败：' + String((e && e.message) || e)) }
      }
      try { for (const ent of w.list()) { if (ent.sessionIds.includes(sid)) { try { await ent.detachSession(sid) } catch (e) {} } } } catch (e) {}
      try { if (w.sessionPaths && w.sessionPaths.delete) w.sessionPaths.delete(sid) } catch (e) {}
      try { if (w.headers && w.headers.delete) w.headers.delete(sid) } catch (e) {}
    }
    await writeTrash(list.filter((t) => t.sessionId !== sid))
    return { ok: true, purged: true }
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

    // Rewrite only the first zstd frame's cwd to `newCwd`. DSH stores each
    // session as concatenated independent zstd frames; frame0 is exactly
    // `JSON.stringify(headerLineObj) + "\n"`. We slice frame0 by its trailing
    // magic boundary, decode, mutate cwd, recompress with the same checksum
    // flag, and concatenate the remaining frames untouched. This keeps the log
    // valid for the persistence layer's frame0 reader while moving it to the
    // new workspace without a full re-encode.
    const ZSTD_MAGIC = 4247762216
    const CHECKSUM_OPTS = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } }
    function rewriteFrame0Cwd(filePath, newCwd) {
      const buf = readFileSync(filePath)
      const starts = []
      for (let i = 0; i + 4 <= buf.length; i++) {
        if (buf.readUInt32LE(i) === ZSTD_MAGIC) starts.push(i)
      }
      if (starts.length === 0) throw new Error('会话日志格式异常（无 zstd 帧）')
      const end0 = starts.length > 1 ? starts[1] : buf.length
      const frame0 = buf.subarray(starts[0], end0)
      const text = zlib.zstdDecompressSync(frame0).toString('utf8')
      const nl = text.indexOf('\n')
      const line = nl >= 0 ? text.slice(0, nl) : text
      const obj = JSON.parse(line)
      if (obj.cwd === newCwd) return  // already correct, no rewrite needed
      obj.cwd = newCwd
      const newFrame0 = zlib.zstdCompressSync(JSON.stringify(obj) + '\n', CHECKSUM_OPTS)
      const rest = buf.subarray(end0)
      writeFileSync(filePath, Buffer.concat([newFrame0, rest]))
    }

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
    const state = await archivedState()
    const list = state.archivedSessionIds.map(String)
    if (list.includes(sid)) return { ok: true, archived: false }
    await w.archiveSession(sid)
    return { ok: true, archived: true }
  }

  async function allSessionItems() {
    let materialized = new Set()
    let live = ctx.get('sessions')
    try {
      const headers = await sp.list()
      materialized = new Set(headers.map((h) => String(h.id)))
    } catch (e) { /* best-effort */ }
    const ids = []
    try { for (const header of await sp.list()) ids.push(String(header.id)) } catch (e) { /* ignore */ }
    if (live) { try { live.list().forEach((s) => { if (!ids.includes(String(s.id))) ids.push(String(s.id)) }) } catch (e) { /* ignore */ } }
    // Exclude sessions already moved to the recycle bin (软删除): they live in
    // 回收站, not in 会话管理, so the panel won't re-list them after a delete.
    let trashedIds = new Set()
    try { trashedIds = new Set((await readTrash()).map((t) => String(t.sessionId))) } catch (e) {}
    const visibleIds = ids.filter((id) => !trashedIds.has(id))
    wsByPath = {}
    try { for (const ent of w.list()) wsByPath[ent.path] = ent } catch (e) { wsByPath = {} }
    const currentArchived = new Set((await archivedState().catch(() => ({ archivedSessionIds: [] }))).archivedSessionIds || [])
    const items = []
    const CHUNK = 6
    for (let i = 0; i < visibleIds.length; i += CHUNK) {
      const res2 = await Promise.all(visibleIds.slice(i, i + CHUNK).map(resolveOne))
      for (const it of res2) items.push({ ...it, archived: currentArchived.has(it.sessionId) })
    }
    return items
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
          const idStrs = ids.map(String).filter((id) => materialized.has(id) || (live && live.get(id)))
          wsByPath = {}
          try { for (const ent of w.list()) wsByPath[ent.path] = ent } catch (e) { wsByPath = {} }
          const items = []
          const CHUNK = 6
          for (let i = 0; i < idStrs.length; i += CHUNK) {
            const res2 = await Promise.all(idStrs.slice(i, i + CHUNK).map(resolveOne))
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
          json(res, { ok: false, error: String((e && e.message) || e) }, 500)
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
          json(res, await deleteOne(sid))
        } catch (e) {
          json(res, { ok: false, error: String((e && e.message) || e) }, 500)
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
            try { results.push({ sessionId: sid, ok: true, ...(await deleteOne(sid)) }) }
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
          const list = await readTrash()
          list.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0))
          json(res, { items: list })
        } catch (e) {
          json(res, { ok: false, error: String((e && e.message) || e) }, 500)
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
          json(res, await restoreFromTrash(sid))
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
          json(res, await purgeFromTrash(sid))
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
            try { results.push({ sessionId: sid, ok: true, ...(await purgeFromTrash(sid)) }) }
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
          json(res, { sessionId: sid, ...(await moveOne(sid, target)) })
          // Reindex the host's in-memory sessionPath index so the sidebar
          // reflects the new grouping immediately (no DSH restart needed).
          try { await reindexRegistry() } catch (e) { /* best-effort */ }
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

    return () => { for (const d of disposers) d() }
  }, 'dsh-sessions-manager: routes')
}
