// src/index.js
import { mkdir as mkdir2, realpath, rename as rename2, stat, unlink, writeFile as writeFile2 } from "node:fs/promises";
import { basename, dirname, isAbsolute, join as join2 } from "node:path";
import { readFileSync as readFileSync3 } from "node:fs";
import { homedir as homedir2 } from "node:os";

// src/zstd-frame.js
import zlib from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
var ZSTD_MAGIC = 4247762216;
var CHECKSUM_OPTS = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } };
function findZstdFrameStarts(buf) {
  const starts = [];
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf.readUInt32LE(i) !== ZSTD_MAGIC) continue;
    try {
      const out = zlib.zstdDecompressSync(buf.subarray(i, i + Math.min(buf.length - i, 1e6)));
      if (out.length > 0) starts.push(i);
    } catch (_) {
    }
  }
  return starts;
}
function rewriteFrame0Cwd(filePath, newCwd) {
  const buf = readFileSync(filePath);
  const starts = findZstdFrameStarts(buf);
  if (starts.length === 0) throw new Error("\u4F1A\u8BDD\u65E5\u5FD7\u683C\u5F0F\u5F02\u5E38\uFF08\u65E0 zstd \u5E27\uFF09");
  const end0 = starts.length > 1 ? starts[1] : buf.length;
  const frame0 = buf.subarray(starts[0], end0);
  const text = zlib.zstdDecompressSync(frame0).toString("utf8");
  const nl = text.indexOf("\n");
  const line = nl >= 0 ? text.slice(0, nl) : text;
  const obj = JSON.parse(line);
  if (obj.type !== "session") {
    throw new Error(`\u4F1A\u8BDD\u65E5\u5FD7\u683C\u5F0F\u5F02\u5E38\uFF08\u5E270 \u4E0D\u662F session header\uFF0C\u5B9E\u9645 type=${obj.type}\uFF09`);
  }
  if (obj.cwd === newCwd) return;
  obj.cwd = newCwd;
  const newFrame0 = zlib.zstdCompressSync(JSON.stringify(obj) + "\n", CHECKSUM_OPTS);
  const rest = buf.subarray(end0);
  writeFileSync(filePath, Buffer.concat([newFrame0, rest]));
}

// src/markdown.js
var MAX_TOOL_ARG = 200;
function isoTime(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}
function yamlString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n")}"`;
}
function blocksOf(value) {
  return Array.isArray(value) ? value.filter((b) => b && typeof b === "object") : [];
}
function textFromBlocks(blocks) {
  const parts = [];
  for (const block of blocks) {
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n\n").trim();
}
function imageCountOf(blocks) {
  let count = 0;
  for (const block of blocks) if (block.type === "image") count++;
  return count;
}
function reasoningFromBlocks(blocks) {
  const parts = [];
  for (const block of blocks) {
    if (block.type === "reasoning" && typeof block.text === "string" && block.text.trim()) parts.push(block.text.trim());
  }
  return parts.join("\n\n");
}
function summarizeToolArguments(name2, rawArguments) {
  let parsed = null;
  if (typeof rawArguments === "string") {
    try {
      parsed = JSON.parse(rawArguments);
    } catch {
      parsed = null;
    }
  } else if (rawArguments && typeof rawArguments === "object") {
    parsed = rawArguments;
  }
  if (parsed === null) return typeof rawArguments === "string" ? rawArguments.slice(0, MAX_TOOL_ARG) : "";
  if (typeof parsed !== "object") return String(parsed).slice(0, MAX_TOOL_ARG);
  const preferred = ["command", "file_path", "path", "query", "url", "pattern"];
  for (const key of preferred) {
    if (typeof parsed[key] === "string" && parsed[key].trim()) return parsed[key];
  }
  const keys = Object.keys(parsed);
  if (keys.length === 0) return "";
  const rest = {};
  for (const key of keys.slice(0, 6)) {
    const value = parsed[key];
    rest[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return JSON.stringify(rest).slice(0, MAX_TOOL_ARG);
}
function renderSessionMarkdown(meta, events, options = {}) {
  const includeReasoning = options.includeReasoning === true;
  const includeToolResults = options.includeToolResults === true;
  const header = meta && typeof meta === "object" ? meta : {};
  const list = Array.isArray(events) ? events : [];
  let title = typeof header.title === "string" && header.title.trim() ? header.title.trim() : null;
  for (const ev of list) {
    const data = ev && ev.data;
    if (ev && ev.type === "session/title" && data && typeof data.title === "string" && data.title.trim()) {
      title = data.title.trim();
    }
  }
  const front = ["---"];
  if (title) front.push(`title: ${yamlString(title)}`);
  if (typeof header.id === "string" && header.id) front.push(`sessionId: ${yamlString(header.id)}`);
  if (typeof header.cwd === "string" && header.cwd) front.push(`cwd: ${yamlString(header.cwd)}`);
  const created = isoTime(header.createdAt);
  if (created) front.push(`createdAt: ${created}`);
  const exported = isoTime(options.exportedAt);
  if (exported) front.push(`exportedAt: ${exported}`);
  front.push("---");
  const out = [front.join("\n")];
  if (title) out.push("", `# ${title}`);
  let turn = null;
  for (const ev of list) {
    if (!ev || typeof ev !== "object") continue;
    const data = ev.data && typeof ev.data === "object" ? ev.data : {};
    const type = ev.type;
    if (type === "turn/start") {
      const next = Number.isInteger(data.turn) ? data.turn : null;
      if (next !== null && next !== turn) {
        turn = next;
        out.push("", `## \u7B2C ${turn} \u8F6E`);
      }
      continue;
    }
    if (type === "user/message") {
      const blocks = blocksOf(data.content);
      const text = textFromBlocks(blocks);
      const images = imageCountOf(blocks);
      if (!text && images === 0) continue;
      out.push("", "### \u7528\u6237", "");
      if (text) out.push(text);
      for (let i = 0; i < images; i++) out.push("", `![\u56FE\u7247 ${i + 1}](attachment)`);
      continue;
    }
    if (type === "assistant/message") {
      const message = data.message && typeof data.message === "object" ? data.message : {};
      const blocks = blocksOf(message.content);
      const text = textFromBlocks(blocks);
      const reasoning = includeReasoning ? reasoningFromBlocks(blocks) : "";
      if (!text && !reasoning) continue;
      out.push("", "### \u52A9\u624B", "");
      if (reasoning) out.push("> \u601D\u8003\uFF1A" + reasoning.split("\n").join("\n> "), "");
      if (text) out.push(text);
      continue;
    }
    if (type === "tool/call") {
      const name2 = typeof data.name === "string" && data.name ? data.name : "tool";
      const summary = summarizeToolArguments(name2, data.arguments);
      out.push("", `### \u5DE5\u5177\u8C03\u7528\uFF1A\`${name2}\``, "");
      out.push(summary ? "```\n" + summary + "\n```" : "\uFF08\u65E0\u53C2\u6570\uFF09");
      continue;
    }
    if (type === "tool/result" && includeToolResults) {
      const message = data.message && typeof data.message === "object" ? data.message : {};
      const blocks = blocksOf(message.content);
      let text = "";
      for (const block of blocks) {
        if (block.type === "tool-result") text = textFromBlocks(blocksOf(block.content));
      }
      if (text) out.push("", "<details><summary>\u5DE5\u5177\u7ED3\u679C</summary>", "", "```\n" + text.slice(0, 2e3) + "\n```", "", "</details>");
    }
  }
  out.push("");
  return out.join("\n");
}

// src/star-index.js
import { mkdir, rename, writeFile } from "node:fs/promises";
import { readFileSync as readFileSync2 } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
var STAR_SCHEMA_VERSION = 3;
var DEFAULT_STAR_DIR = join(homedir(), ".dsh", "sessions-manager");
function isSafeSessionId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\\/\0]/.test(value) && value !== "." && value !== "..";
}
function normalizeStarStore(raw) {
  const legacy = Array.isArray(raw) ? raw : null;
  const source = legacy || (raw && typeof raw === "object" ? raw : null);
  const ids = source && Array.isArray(source.starredSessionIds) ? source.starredSessionIds : legacy || [];
  const clean = [];
  const seen = /* @__PURE__ */ new Set();
  for (const id of ids) {
    if (!isSafeSessionId(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    clean.push(id);
  }
  return { schemaVersion: STAR_SCHEMA_VERSION, starredSessionIds: clean };
}
function createStarIndex(options = {}) {
  const dir = options.dir || process.env.DSH_SESSIONS_MANAGER_STAR_DIR || DEFAULT_STAR_DIR;
  const indexPath = options.indexPath || join(dir, "star.json");
  let mutation = Promise.resolve();
  async function read() {
    try {
      return normalizeStarStore(JSON.parse(readFileSync2(indexPath, "utf8")));
    } catch {
      return normalizeStarStore(null);
    }
  }
  async function write(store) {
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, `.star-${process.pid}-${Date.now()}.tmp`);
    await writeFile(tmp, JSON.stringify(normalizeStarStore(store), null, 2), { encoding: "utf8", mode: 384 });
    await rename(tmp, indexPath);
  }
  function mutate(mutator) {
    const operation = mutation.then(async () => {
      const store = await read();
      const result = await mutator(store);
      await write(store);
      return result;
    });
    mutation = operation.catch(() => {
    });
    return operation;
  }
  function setStarred(ids, starred) {
    const wanted = (Array.isArray(ids) ? ids : []).filter(isSafeSessionId).map(String);
    return mutate((store) => {
      const set = new Set(store.starredSessionIds);
      for (const id of wanted) {
        if (starred) set.add(id);
        else set.delete(id);
      }
      store.starredSessionIds = [...set];
      return store.starredSessionIds;
    });
  }
  function removeIds(ids) {
    return setStarred(ids, false);
  }
  return { read, write, mutate, setStarred, removeIds, indexPath, dir };
}

// src/index.js
var name = "dsh-sessions-manager";
var inject = ["webServer", "workspaceRegistry", "sessionPersistence", "sessionQuery", "storageDomain"];
var MAX_TITLE = 80;
var TRASH_DIR = process.env.DSH_SESSIONS_MANAGER_TRASH_DIR || join2(homedir2(), ".dsh", "sessions-manager-trash");
var TRASH_INDEX = join2(TRASH_DIR, "index.json");
var TRASH_SCHEMA_VERSION = 2;
var DEFAULT_TRASH_SETTINGS = Object.freeze({ retentionDays: 0 });
var FETCH_TOOL_RE = /search|fetch|download|browse/i;
var MAX_FETCHES = 12;
var MAX_FILES = 20;
function json(res, value, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}
function errorStatus(error) {
  return error && Number.isInteger(error.status) ? error.status : 500;
}
async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    chunks.push(chunk);
    total += chunk.length;
    if (total > 1 << 20) return null;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}
function parseIds(body) {
  const raw = body && body.sessionIds;
  if (!Array.isArray(raw)) return null;
  const ids = [];
  for (const v of raw) if (typeof v === "string" && isSafeSessionId2(v)) ids.push(v);
  return ids;
}
function isSafeSessionId2(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\\/\0]/.test(value) && value !== "." && value !== "..";
}
function requireSessionId(value) {
  if (!isSafeSessionId2(value)) {
    const error = new Error("\u65E0\u6548\u7684 sessionId");
    error.status = 400;
    throw error;
  }
  return value;
}
function getActiveSessionId(context) {
  try {
    const a = context.get("activeSession");
    if (a != null) return a && a.id != null ? a.id : typeof a === "string" ? a : null;
  } catch (e) {
  }
  try {
    const c = context.get("currentSession");
    if (c != null) return c && c.id != null ? c.id : typeof c === "string" ? c : null;
  } catch (e) {
  }
  try {
    const store = context.get("sessions");
    if (store && store.active && store.active.id != null) return store.active.id;
  } catch (e) {
  }
  return null;
}
function foldTitle(events) {
  let found = null;
  let firstUser = null;
  for (const ev of events) {
    if (ev.type === "session/title" && ev.data && typeof ev.data.title === "string" && ev.data.title.length) {
      found = ev.data.title;
    }
    if (firstUser === null && ev.type === "user/message" && ev.data && Array.isArray(ev.data.content)) {
      const txt = ev.data.content.filter((b) => b && b.type === "text").map((b) => b.text).filter(Boolean).join(" ").trim();
      if (txt) firstUser = txt;
    }
  }
  return found || firstUser || null;
}
function apply(ctx) {
  const w = ctx.workspaceRegistry;
  const sp = ctx.sessionPersistence;
  const sq = ctx.sessionQuery;
  const dom = () => ctx.storageDomain.get("workspace");
  const authorityTitleCache = /* @__PURE__ */ new Map();
  let authorityTitlesLoaded = false;
  async function archivedState() {
    const d = dom();
    if (!d) throw new Error("workspace domain is not open");
    return d.global.get();
  }
  async function writeArchived(nextIds) {
    const d = dom();
    if (!d) throw new Error("workspace domain is not open");
    const cur = d.global.get();
    const next = Object.assign({}, cur, { archivedSessionIds: nextIds });
    await d.global.set(next);
    if (w && "state" in w) {
      try {
        w.state = next;
      } catch (e) {
      }
    }
    return next;
  }
  let archiveMutation = Promise.resolve();
  function mutateArchived(mutator) {
    const operation = archiveMutation.then(async () => {
      const state = await archivedState();
      const list = (state.archivedSessionIds || []).map(String);
      const result = await mutator(list);
      if (result.next) await writeArchived(result.next);
      return result.value;
    });
    archiveMutation = operation.catch(() => {
    });
    return operation;
  }
  let wsByPath = {};
  async function resolveOne(id) {
    let title = null, createdAt = null, cwd = null;
    try {
      const o = await sq.readTitleSnapshot(id);
      if (o) {
        if (o.title && o.title.title) title = String(o.title.title);
        if (o.session) {
          cwd = o.session.cwd || null;
          createdAt = o.session.createdAt || null;
        }
      }
    } catch (e) {
    }
    if (!title || !cwd) {
      try {
        const r = await sp.readFrom(id, 0);
        if (r.meta) {
          if (!cwd) cwd = r.meta.cwd || null;
          if (!createdAt) createdAt = r.meta.createdAt || null;
        }
        if (!title && Array.isArray(r.events)) title = foldTitle(r.events);
      } catch (e2) {
      }
    }
    const ws = cwd ? wsByPath[cwd] : void 0;
    const workspaceGone = !!(cwd && !ws);
    const display = title ? String(title).length > MAX_TITLE ? String(title).slice(0, MAX_TITLE) + "\u2026" : String(title) : null;
    return {
      sessionId: id,
      title: display,
      createdAt: createdAt || null,
      workspacePath: cwd || null,
      workspaceTitle: ws && ws.title ? ws.title : null,
      workspaceGone: workspaceGone ? true : false,
      hasWorkspace: !!cwd
    };
  }
  async function restoreOne(sid) {
    requireSessionId(sid);
    return mutateArchived((list) => list.includes(sid) ? { next: list.filter((x) => x !== sid), value: { ok: true, restored: true } } : { next: null, value: { ok: true, restored: false } });
  }
  let trashMutation = Promise.resolve();
  function normalizeTrashStore(raw) {
    if (Array.isArray(raw)) return { schemaVersion: TRASH_SCHEMA_VERSION, settings: { ...DEFAULT_TRASH_SETTINGS }, items: raw, purgedSessionIds: [] };
    const settings = raw && typeof raw.settings === "object" ? raw.settings : {};
    const retentionDays = Number.isInteger(settings.retentionDays) && settings.retentionDays >= 0 ? settings.retentionDays : 0;
    return {
      schemaVersion: TRASH_SCHEMA_VERSION,
      settings: { retentionDays },
      items: raw && Array.isArray(raw.items) ? raw.items : [],
      purgedSessionIds: raw && Array.isArray(raw.purgedSessionIds) ? [...new Set(raw.purgedSessionIds.filter(isSafeSessionId2).map(String))] : []
    };
  }
  async function readTrashStore() {
    try {
      return normalizeTrashStore(JSON.parse(readFileSync3(TRASH_INDEX, "utf8")));
    } catch (e) {
      return normalizeTrashStore(null);
    }
  }
  async function readTrash() {
    return (await readTrashStore()).items;
  }
  async function writeTrashStore(store) {
    await mkdir2(TRASH_DIR, { recursive: true });
    const tmp = join2(TRASH_DIR, `.index-${process.pid}-${Date.now()}.tmp`);
    await writeFile2(tmp, JSON.stringify(normalizeTrashStore(store), null, 2), { encoding: "utf8", mode: 384 });
    await rename2(tmp, TRASH_INDEX);
  }
  function mutateTrash(mutator) {
    const operation = trashMutation.then(async () => {
      const store = await readTrashStore();
      const result = await mutator(store);
      await writeTrashStore(store);
      return result;
    });
    trashMutation = operation.catch(() => {
    });
    return operation;
  }
  const stars = createStarIndex();
  async function gcStars(validIds) {
    try {
      const store = await stars.read();
      const valid = new Set(validIds.map(String));
      const gone = store.starredSessionIds.filter((id) => !valid.has(id));
      if (gone.length) await stars.removeIds(gone);
    } catch (e) {
    }
  }
  async function deleteOne(sid) {
    requireSessionId(sid);
    let header = null;
    let cwd = null;
    let title = null;
    let removedPath = null;
    try {
      const headers = await sp.list();
      header = headers.find((h) => String(h.id) === sid) || null;
      if (header) {
        const loc = sp.locate(header);
        if (loc && typeof loc.path === "string") removedPath = loc.path;
        cwd = header.cwd || null;
        title = header.title || header.meta && header.meta.title || null;
      }
      if (!title) {
        const r = await sp.readFrom(sid, 0);
        if (r && r.meta) {
          if (!cwd) cwd = r.meta.cwd;
          title = foldTitle(r.events);
        }
      }
    } catch (e) {
    }
    if (!header && !removedPath) {
      const error = new Error("\u627E\u4E0D\u5230\u8BE5\u4F1A\u8BDD");
      error.status = 404;
      throw error;
    }
    const archived = await mutateArchived((list) => ({ next: null, value: list.includes(sid) })).catch(() => false);
    await mutateTrash((store) => {
      const entry = {
        sessionId: sid,
        title: title || cwd || sid,
        cwd: cwd || null,
        header: header || null,
        originalPath: removedPath || null,
        sizeBytes: header && typeof header.size === "number" ? header.size : null,
        wasArchived: archived,
        deletedAt: Date.now()
      };
      const at = store.items.findIndex((t) => String(t.sessionId) === sid);
      if (at >= 0) store.items[at] = entry;
      else store.items.push(entry);
      store.purgedSessionIds = store.purgedSessionIds.filter((id) => id !== sid);
    });
    return { ok: true, trashed: true };
  }
  async function restoreFromTrash(sid) {
    requireSessionId(sid);
    await mutateTrash(async (store) => {
      const entry = store.items.find((t) => String(t.sessionId) === sid);
      if (!entry) {
        const error = new Error("\u56DE\u6536\u7AD9\u4E2D\u627E\u4E0D\u5230\u8BE5\u4F1A\u8BDD");
        error.status = 404;
        throw error;
      }
      if (entry.wasArchived === false) await restoreOne(sid);
      store.items = store.items.filter((t) => String(t.sessionId) !== sid);
      store.purgedSessionIds = store.purgedSessionIds.filter((id) => id !== sid);
    });
    return { ok: true, restored: true };
  }
  async function purgeFromTrash(sid) {
    requireSessionId(sid);
    let purged = false;
    await mutateTrash(async (store) => {
      const entry = store.items.find((t) => String(t.sessionId) === sid);
      if (!entry) {
        const error = new Error("\u56DE\u6536\u7AD9\u4E2D\u627E\u4E0D\u5230\u8BE5\u4F1A\u8BDD");
        error.status = 404;
        throw error;
      }
      let target = null;
      try {
        const headers = await sp.list();
        const current = headers.find((h) => String(h.id) === sid);
        const located = current && sp.locate(current);
        if (located && typeof located.path === "string") target = located.path;
      } catch (e) {
      }
      if (!target && typeof entry.originalPath === "string") target = entry.originalPath;
      const targetOwnsSession = target && (basename(dirname(target)) === sid || basename(target).includes(sid));
      if (target && !targetOwnsSession) {
        const error = new Error("\u65E5\u5FD7\u8DEF\u5F84\u4E0E\u4F1A\u8BDD ID \u4E0D\u5339\u914D\uFF0C\u5DF2\u505C\u6B62\u6C38\u4E45\u5220\u9664");
        error.status = 409;
        throw error;
      }
      if (!store.purgedSessionIds.includes(sid)) store.purgedSessionIds.push(sid);
      await writeTrashStore(store);
      try {
        const sessions = ctx.get("sessions");
        const liveSession = sessions && sessions.get && sessions.get(sid);
        if (liveSession && typeof sessions.flush === "function") await sessions.flush(liveSession);
        const entered = sessions && sessions.store && sessions.store.get && sessions.store.get(sid);
        if (liveSession && (!entered || typeof entered.detach !== "function")) throw new Error("\u5BBF\u4E3B\u672A\u63D0\u4F9B live Session detach \u80FD\u529B");
        if (entered && typeof entered.detach === "function") entered.detach();
        const retirement = sp && sp.retirements && sp.retirements.get && sp.retirements.get(sid);
        if (retirement && typeof retirement.then === "function") await retirement;
      } catch (e) {
        const error = new Error("\u65E0\u6CD5\u4ECE\u5BBF\u4E3B\u5185\u5B58\u79FB\u9664\u4F1A\u8BDD\uFF0C\u5DF2\u505C\u6B62\u6C38\u4E45\u5220\u9664\uFF1A" + String(e && e.message || e));
        error.status = 409;
        throw error;
      }
      if (target) {
        try {
          await unlink(target);
        } catch (e) {
          if (e && e.code !== "ENOENT") throw new Error("\u5220\u9664\u6587\u4EF6\u5931\u8D25\uFF1A" + String(e && e.message || e));
        }
      }
      try {
        for (const ent of w.list()) {
          if (ent.sessionIds.includes(sid)) {
            try {
              await ent.detachSession(sid);
            } catch (e) {
            }
          }
        }
      } catch (e) {
      }
      try {
        if (w.sessionPaths && w.sessionPaths.delete) w.sessionPaths.delete(sid);
      } catch (e) {
      }
      try {
        if (w.headers && w.headers.delete) w.headers.delete(sid);
      } catch (e) {
      }
      await restoreOne(sid);
      try {
        await reindexRegistry();
      } catch (e) {
      }
      store.items = store.items.filter((t) => String(t.sessionId) !== sid);
      purged = true;
    });
    if (!purged) throw new Error("\u5F7B\u5E95\u5220\u9664\u5931\u8D25");
    stars.removeIds([sid]).catch(() => {
    });
    return { ok: true, purged: true };
  }
  async function trashSettings(next) {
    if (next === void 0) return (await readTrashStore()).settings;
    const days = Number(next.retentionDays);
    if (!Number.isInteger(days) || ![0, 7, 30, 90].includes(days)) {
      const error = new Error("retentionDays \u4EC5\u652F\u6301 0\u30017\u300130\u300190");
      error.status = 400;
      throw error;
    }
    await mutateTrash((store) => {
      store.settings = { retentionDays: days };
    });
    return (await readTrashStore()).settings;
  }
  async function cleanupExpiredTrash() {
    const store = await readTrashStore();
    const days = store.settings.retentionDays;
    if (!days) return 0;
    const cutoff = Date.now() - days * 864e5;
    const ids = store.items.filter((item) => Number(item.deletedAt) > 0 && Number(item.deletedAt) < cutoff).map((item) => String(item.sessionId));
    let count = 0;
    for (const sid of ids) {
      try {
        await purgeFromTrash(sid);
        count++;
      } catch (e) {
      }
    }
    return count;
  }
  async function moveTargetWorkspace(rawPath) {
    if (typeof rawPath !== "string" || !rawPath.trim()) throw new Error("\u7F3A\u5C11\u76EE\u6807\u5DE5\u4F5C\u533A\u8DEF\u5F84");
    let p = String(rawPath).trim();
    if (p.startsWith("~/")) p = join2(homedir2(), p.slice(2));
    if (!isAbsolute(p)) p = join2(homedir2(), p);
    let canonical = null;
    try {
      canonical = await realpath(p);
    } catch (e) {
      canonical = null;
    }
    if (canonical === null) {
      await mkdir2(p, { recursive: true });
      canonical = await realpath(p);
    }
    return { canonical, entity: await w.create(canonical, basename(canonical) || "workspace") };
  }
  async function moveOne(sid, targetPath) {
    const activeId = getActiveSessionId(ctx);
    if (activeId != null && String(activeId) === String(sid)) {
      throw new Error("\u8BE5\u4F1A\u8BDD\u5F53\u524D\u5904\u4E8E\u6253\u5F00\u72B6\u6001\uFF0C\u8BF7\u5148\u5207\u6362\u5230\u522B\u7684\u4F1A\u8BDD\u518D\u79FB\u52A8\u3002");
    }
    const r = await sp.readFrom(sid, 0);
    if (!r || !r.meta) throw new Error("\u65E0\u6CD5\u8BFB\u53D6\u8BE5\u4F1A\u8BDD\u7684\u65E5\u5FD7");
    const meta = r.meta;
    const events = r.events;
    const oldCwd = meta.cwd || null;
    const { canonical, entity: target } = await moveTargetWorkspace(targetPath);
    if (oldCwd) {
      let oldCanon = null;
      try {
        oldCanon = await realpath(oldCwd);
      } catch (e) {
        oldCanon = null;
      }
      if (oldCanon === canonical) {
        return { ok: true, already: true, workspaceId: target.id, workspaceTitle: target.title };
      }
    }
    const newHeader = Object.assign({}, meta, { cwd: canonical });
    const live = ctx.get("sessions");
    const liveObj = live && live.get && live.get(sid);
    const isOpen = !!liveObj;
    const ALREADY_EXISTS_RE = /already exists in this backend/i;
    const relocateLog = async (header, newHeaderObj) => {
      const oldPath = locatePath(header);
      const newPath = locatePath(newHeaderObj);
      if (!oldPath || !newPath || oldPath === newPath) return false;
      const backupPath = `${oldPath}.move-backup-${Date.now()}`;
      try {
        await mkdir2(dirname(newPath), { recursive: true });
        await rename2(oldPath, backupPath);
        await rewriteFrame0Cwd(backupPath, canonical);
        await rename2(backupPath, newPath);
      } catch (e) {
        try {
          await rename2(backupPath, oldPath);
        } catch (_) {
        }
        if (e && e.code !== "ENOENT") throw e;
        return false;
      }
      return true;
    };
    const locatePath = (header) => {
      let fn = null;
      try {
        if (typeof sp.locate === "function") fn = sp.locate.bind(sp);
      } catch (e) {
      }
      if (!fn && sp.backend && typeof sp.backend.locate === "function") fn = sp.backend.locate.bind(sp.backend);
      if (!fn) return null;
      try {
        const loc = fn(header);
        if (loc && typeof loc.path === "string") return loc.path;
        if (typeof loc === "string") return loc;
      } catch (e) {
      }
      return null;
    };
    if (isOpen) {
      await relocateLog(meta, newHeader);
      try {
        const st = sp.states && sp.states.get && sp.states.get(sid);
        if (st && st.meta) st.meta = Object.assign({}, st.meta, { cwd: canonical });
      } catch (e) {
      }
    } else {
      let oldPath = null;
      try {
        const loc = locatePath(meta);
        if (loc && typeof loc === "string") oldPath = loc;
        else if (loc && loc.path) oldPath = loc.path;
      } catch (e) {
        oldPath = null;
      }
      if (typeof sp.create !== "function" || typeof sp.append !== "function") {
        await relocateLog(meta, newHeader);
      } else {
        const backupPath = oldPath ? `${oldPath}.move-backup-${Date.now()}` : null;
        if (backupPath) {
          try {
            await rename2(oldPath, backupPath);
          } catch (e) {
            if (e && e.code !== "ENOENT") throw new Error("\u79FB\u52A8\u5931\u8D25\uFF1A\u65E0\u6CD5\u5907\u4EFD\u65E7\u7684\u4F1A\u8BDD\u65E5\u5FD7");
          }
        }
        const restore = async () => {
          if (backupPath) {
            try {
              await rename2(backupPath, oldPath);
            } catch (_) {
            }
          }
        };
        try {
          await sp.create(newHeader);
          await sp.append(sid, events);
          const check = await sp.readFrom(sid, 0);
          if (!check || !check.meta || check.meta.cwd !== canonical) {
            throw new Error("\u79FB\u52A8\u540E\u6821\u9A8C\u5931\u8D25\uFF1A\u4F1A\u8BDD\u5DE5\u4F5C\u76EE\u5F55\u672A\u6B63\u786E\u66F4\u65B0");
          }
          if (backupPath) {
            try {
              await unlink(backupPath);
            } catch (e) {
            }
          }
        } catch (e) {
          if (ALREADY_EXISTS_RE.test(String(e && e.message || e))) {
            await restore();
            await relocateLog(meta, newHeader);
          } else {
            await restore();
            throw new Error("\u79FB\u52A8\u4F1A\u8BDD\u65E5\u5FD7\u5931\u8D25\uFF1A" + String(e && e.message || e));
          }
        }
      }
    }
    try {
      if (liveObj) {
        if ("header" in liveObj) liveObj.header = newHeader;
        if ("cwd" in liveObj) liveObj.cwd = canonical;
        if ("meta" in liveObj) liveObj.meta = newHeader;
      }
    } catch (e) {
    }
    for (const ent of w.list()) {
      try {
        await ent.detachSession(sid);
      } catch (e) {
      }
    }
    if (w.headers && typeof w.headers.set === "function") w.headers.set(sid, newHeader);
    if (w.sessionPaths && typeof w.sessionPaths.set === "function") w.sessionPaths.set(sid, canonical);
    await target.attachSession(sid);
    const verified = (() => {
      try {
        return target.sessionIds.includes(sid);
      } catch (e) {
        return false;
      }
    })();
    if (!verified) {
      throw new Error("\u79FB\u52A8\u540E\u6821\u9A8C\u5931\u8D25\uFF1A\u4F1A\u8BDD\u672A\u51FA\u73B0\u5728\u76EE\u6807\u5DE5\u4F5C\u533A\uFF0C\u8BF7\u91CD\u8BD5\u6216\u91CD\u542F DSH\u3002");
    }
    return {
      ok: true,
      moved: true,
      workspaceId: target.id,
      workspaceTitle: target.title,
      workspacePath: canonical
    };
  }
  async function reindexRegistry() {
    const reg = w;
    if (!reg || typeof reg.replaceHeaderIndex !== "function") return false;
    let headers = null;
    try {
      headers = await sp.list();
    } catch (e) {
      headers = null;
    }
    if (!headers || !Array.isArray(headers)) return false;
    await reg.replaceHeaderIndex(headers);
    if (typeof reg.rebuildEntities === "function") reg.rebuildEntities();
    return true;
  }
  async function listWorkspaces() {
    const out = [];
    try {
      for (const ent of w.list()) out.push({ workspaceId: ent.id, title: ent.title, path: ent.path });
    } catch (e) {
    }
    return out;
  }
  async function archiveOne(sid) {
    requireSessionId(sid);
    return mutateArchived(async (list) => {
      if (list.includes(sid)) return { next: null, value: { ok: true, archived: false } };
      await w.archiveSession(sid);
      return { next: null, value: { ok: true, archived: true } };
    });
  }
  async function allSessionItems() {
    let materialized = /* @__PURE__ */ new Set();
    let live = ctx.get("sessions");
    let headersOk = false;
    try {
      const headers = await sp.list();
      materialized = new Set(headers.map((h) => String(h.id)));
      headersOk = true;
    } catch (e) {
    }
    const ids = [];
    try {
      for (const header of await sp.list()) ids.push(String(header.id));
    } catch (e) {
    }
    if (live) {
      try {
        live.list().forEach((s) => {
          if (!ids.includes(String(s.id))) ids.push(String(s.id));
        });
      } catch (e) {
      }
    }
    let hiddenIds = /* @__PURE__ */ new Set();
    try {
      const store = await readTrashStore();
      hiddenIds = /* @__PURE__ */ new Set([...store.items.map((t) => String(t.sessionId)), ...store.purgedSessionIds.map(String)]);
    } catch (e) {
    }
    const visibleIds = ids.filter((id) => !hiddenIds.has(id));
    wsByPath = {};
    try {
      for (const ent of w.list()) wsByPath[ent.path] = ent;
    } catch (e) {
      wsByPath = {};
    }
    const currentArchived = new Set((await archivedState().catch(() => ({ archivedSessionIds: [] }))).archivedSessionIds || []);
    const items = [];
    const CHUNK = 6;
    for (let i = 0; i < visibleIds.length; i += CHUNK) {
      const res2 = await Promise.all(visibleIds.slice(i, i + CHUNK).map(resolveOne));
      for (const it of res2) items.push({ ...it, archived: currentArchived.has(it.sessionId) });
    }
    let starredSet = /* @__PURE__ */ new Set();
    try {
      starredSet = new Set((await stars.read()).starredSessionIds);
    } catch (e) {
    }
    for (const it of items) it.starred = starredSet.has(String(it.sessionId));
    if (headersOk) await gcStars(ids);
    return items;
  }
  async function sidebarAuthority() {
    const ids = [];
    try {
      for (const header of await sp.list()) ids.push(String(header.id));
    } catch (e) {
    }
    const sessions = ctx.get("sessions");
    try {
      if (sessions) sessions.list().forEach((session) => {
        if (!ids.includes(String(session.id))) ids.push(String(session.id));
      });
    } catch (e) {
    }
    const store = await readTrashStore();
    if (!authorityTitlesLoaded && ids.length && typeof sq.readTitleSnapshots === "function") {
      const results = await sq.readTitleSnapshots(ids);
      results.forEach((result, index) => {
        if (result && result.status === "fulfilled" && result.value && result.value.title && typeof result.value.title.title === "string") {
          authorityTitleCache.set(ids[index], result.value.title.title);
        }
      });
      authorityTitlesLoaded = true;
    } else if (!authorityTitlesLoaded) {
      for (const sid of ids) {
        try {
          const snapshot = await sq.readTitleSnapshot(sid);
          if (snapshot && snapshot.title && typeof snapshot.title.title === "string") authorityTitleCache.set(sid, snapshot.title.title);
        } catch (e) {
        }
      }
      authorityTitlesLoaded = true;
    }
    return {
      titles: Object.fromEntries(authorityTitleCache),
      trashedSessionIds: store.items.map((item) => String(item.sessionId)),
      purgedSessionIds: store.purgedSessionIds.map(String)
    };
  }
  async function buildDetails(sid) {
    const sessions = ctx.get("sessions");
    const live = sessions && sessions.get(sid);
    let meta = null;
    let events = [];
    if (live !== void 0) {
      meta = live && live.header || null;
      try {
        events = Array.isArray(live.events) ? [...live.events] : [];
      } catch (e) {
        events = [];
      }
    } else {
      const r = await sp.readFrom(sid, 0);
      if (!r || !r.meta) throw new Error("\u627E\u4E0D\u5230\u8BE5\u4F1A\u8BDD\u7684\u8BB0\u5F55\uFF08\u4F1A\u8BDD\u4E0D\u5B58\u5728\uFF09");
      meta = r.meta;
      events = Array.isArray(r.events) ? r.events : [];
    }
    let sizeBytes = null;
    try {
      const loc = sp.locate(meta);
      if (loc && typeof loc.path === "string" && loc.path) {
        const st = await stat(loc.path);
        if (st && typeof st.size === "number") sizeBytes = st.size;
      }
    } catch (e) {
      sizeBytes = null;
    }
    let lastTime = typeof meta.createdAt === "number" ? meta.createdAt : 0;
    const fileSet = /* @__PURE__ */ new Map();
    const stats = {
      turns: 0,
      steps: 0,
      userMessages: 0,
      assistantMessages: 0,
      toolCalls: 0,
      attachments: 0,
      toolCounts: {},
      fetches: []
    };
    const turnSeen = /* @__PURE__ */ new Set();
    const stepSeen = /* @__PURE__ */ new Set();
    for (const ev of events) {
      if (ev && typeof ev.time === "number" && ev.time > lastTime) lastTime = ev.time;
      const d = ev && ev.data && typeof ev.data === "object" ? ev.data : {};
      const type = ev && ev.type;
      switch (type) {
        case "turn/start":
          if (typeof d.turn === "number") turnSeen.add(d.turn);
          break;
        case "step/start":
          if (typeof d.step === "number") stepSeen.add(d.step);
          break;
        case "user/message":
          stats.userMessages++;
          if (Array.isArray(d.content)) {
            for (const b of d.content) if (b && b.type === "image") stats.attachments++;
          }
          break;
        case "assistant/message":
          stats.assistantMessages++;
          break;
        case "tool/call": {
          stats.toolCalls++;
          const tn = typeof d.name === "string" && d.name ? d.name : "tool";
          stats.toolCounts[tn] = (stats.toolCounts[tn] || 0) + 1;
          if (FETCH_TOOL_RE.test(tn)) {
            let query;
            try {
              const a = typeof d.arguments === "string" ? JSON.parse(d.arguments) : d.arguments;
              query = typeof a?.query === "string" ? a.query : typeof a?.url === "string" ? a.url : typeof a?.q === "string" ? a.q : void 0;
            } catch (e) {
              query = void 0;
            }
            stats.fetches.push({ tool: tn, ...query && query !== "" ? { query } : {} });
          }
          if (tn === "write" || tn === "edit") {
            let argsJ;
            try {
              argsJ = typeof d.arguments === "string" ? JSON.parse(d.arguments) : d.arguments;
            } catch (e) {
              break;
            }
            const fp = argsJ && typeof argsJ.file_path === "string" && argsJ.file_path ? argsJ.file_path : void 0;
            if (fp !== void 0 && !fileSet.has(fp)) fileSet.set(fp, tn);
          }
          break;
        }
      }
    }
    stats.turns = turnSeen.size;
    stats.steps = stepSeen.size;
    if (stats.fetches.length > MAX_FETCHES) stats.fetches = stats.fetches.slice(0, MAX_FETCHES);
    const fileEntries = [...fileSet.entries()].slice(0, MAX_FILES * 2);
    const exists = await Promise.all(fileEntries.map(([p]) => stat(p).then(() => true).catch(() => false)));
    const files = fileEntries.filter((_, i) => exists[i]).map(([path, tool]) => ({ path, tool })).slice(0, MAX_FILES);
    const lineage = {
      parentSessionId: meta && typeof meta.parentSession === "string" ? meta.parentSession : null,
      children: [],
      subagents: []
    };
    const childrenSet = /* @__PURE__ */ new Set();
    const subagentSet = /* @__PURE__ */ new Set();
    try {
      if (typeof sp.list === "function") {
        for (const h of await sp.list()) {
          if (String(h.parentSession) !== String(sid)) continue;
          if (h.origin === "subagent") subagentSet.add(h.id);
          else childrenSet.add(h.id);
        }
      }
    } catch (e) {
    }
    if (sessions) {
      try {
        sessions.list().forEach((s) => {
          if (String(s.header.parentSession) !== String(sid)) return;
          if (s.header.origin === "subagent") subagentSet.add(s.id);
          else childrenSet.add(s.id);
        });
      } catch (e) {
      }
    }
    lineage.children = [...childrenSet];
    lineage.subagents = [...subagentSet];
    return {
      sessionId: sid,
      sizeBytes,
      createdAt: meta && typeof meta.createdAt === "number" ? meta.createdAt : null,
      updatedAt: lastTime || null,
      files,
      stats,
      lineage
    };
  }
  ctx.effect(() => {
    const disposers = [];
    if (typeof ctx.on === "function") disposers.push(ctx.on("session/event", (session, event) => {
      if (event && event.type === "session/title" && event.data && typeof event.data.title === "string") {
        authorityTitleCache.set(String(session.id), event.data.title);
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/list",
      handler: async (req, res) => {
        try {
          const state = await archivedState();
          const ids = state.archivedSessionIds || [];
          let materialized = /* @__PURE__ */ new Set();
          let live = ctx.get("sessions");
          try {
            const headers = await sp.list();
            materialized = new Set(headers.map((h) => String(h.id)));
          } catch (e) {
          }
          const trashStore = await readTrashStore();
          const hidden = /* @__PURE__ */ new Set([...trashStore.items.map((item) => String(item.sessionId)), ...trashStore.purgedSessionIds.map(String)]);
          const idStrs = ids.map(String).filter((id) => !hidden.has(id) && (materialized.has(id) || live && live.get(id)));
          wsByPath = {};
          try {
            for (const ent of w.list()) wsByPath[ent.path] = ent;
          } catch (e) {
            wsByPath = {};
          }
          const items = [];
          const CHUNK = 6;
          for (let i = 0; i < idStrs.length; i += CHUNK) {
            const res2 = await Promise.all(idStrs.slice(i, i + CHUNK).map(resolveOne));
            items.push.apply(items, res2);
          }
          json(res, { items });
        } catch (e) {
          json(res, { error: String(e && e.message || e) }, 500);
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/restore",
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req);
          const sid = body && typeof body.sessionId === "string" ? body.sessionId : null;
          if (!sid) return json(res, { ok: false, error: "missing sessionId" }, 400);
          json(res, await restoreOne(sid));
        } catch (e) {
          json(res, { ok: false, error: String(e && e.message || e) }, errorStatus(e));
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/restore-many",
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req);
          const ids = parseIds(body);
          if (!ids || ids.length === 0) return json(res, { ok: false, error: "missing sessionIds" }, 400);
          const results = [];
          for (const sid of ids) {
            try {
              results.push({ sessionId: sid, ok: true, ...await restoreOne(sid) });
            } catch (e) {
              results.push({ sessionId: sid, ok: false, error: String(e && e.message || e) });
            }
          }
          json(res, { ok: true, restored: results.filter((r) => r.ok).length, results });
        } catch (e) {
          json(res, { ok: false, error: String(e && e.message || e) }, 500);
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/delete",
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req);
          const sid = body && typeof body.sessionId === "string" ? body.sessionId : null;
          if (!sid) return json(res, { ok: false, error: "missing sessionId" }, 400);
          json(res, await deleteOne(sid));
        } catch (e) {
          json(res, { ok: false, error: String(e && e.message || e) }, errorStatus(e));
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/delete-many",
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req);
          const ids = parseIds(body);
          if (!ids || ids.length === 0) return json(res, { ok: false, error: "missing sessionIds" }, 400);
          const results = [];
          for (const sid of ids) {
            try {
              results.push({ sessionId: sid, ok: true, ...await deleteOne(sid) });
            } catch (e) {
              results.push({ sessionId: sid, ok: false, error: String(e && e.message || e) });
            }
          }
          json(res, { ok: true, deleted: results.filter((r) => r.ok).length, results });
        } catch (e) {
          json(res, { ok: false, error: String(e && e.message || e) }, 500);
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/trash/list",
      handler: async (req, res) => {
        try {
          await cleanupExpiredTrash();
          const list = await readTrash();
          list.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
          const store = await readTrashStore();
          json(res, { schemaVersion: store.schemaVersion, settings: store.settings, purgedSessionIds: store.purgedSessionIds, items: list });
        } catch (e) {
          json(res, { ok: false, error: String(e && e.message || e) }, errorStatus(e));
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/trash/settings",
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req);
          const settings = body && Object.prototype.hasOwnProperty.call(body, "retentionDays") ? await trashSettings({ retentionDays: body.retentionDays }) : await trashSettings();
          json(res, { ok: true, settings });
        } catch (e) {
          json(res, { ok: false, error: String(e && e.message || e) }, errorStatus(e));
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/trash/verify",
      handler: async (req, res) => {
        try {
          const items = await readTrash();
          const results = await Promise.all(items.map(async (item) => {
            let exists = false;
            if (typeof item.originalPath === "string") exists = await stat(item.originalPath).then(() => true).catch(() => false);
            return { sessionId: item.sessionId, status: exists ? "ok" : "missing", originalPath: item.originalPath || null };
          }));
          json(res, { ok: true, healthy: results.filter((r) => r.status === "ok").length, missing: results.filter((r) => r.status === "missing").length, results });
        } catch (e) {
          json(res, { ok: false, error: String(e && e.message || e) }, errorStatus(e));
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/trash/restore",
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req);
          const sid = body && typeof body.sessionId === "string" ? body.sessionId : null;
          if (!sid) return json(res, { ok: false, error: "missing sessionId" }, 400);
          json(res, await restoreFromTrash(sid));
        } catch (e) {
          json(res, { ok: false, error: String(e && e.message || e) }, 500);
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/trash/purge",
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req);
          const sid = body && typeof body.sessionId === "string" ? body.sessionId : null;
          if (!sid) return json(res, { ok: false, error: "missing sessionId" }, 400);
          json(res, await purgeFromTrash(sid));
        } catch (e) {
          json(res, { ok: false, error: String(e && e.message || e) }, 500);
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/trash/purge-many",
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req);
          const ids = parseIds(body);
          if (!ids || ids.length === 0) return json(res, { ok: false, error: "missing sessionIds" }, 400);
          const results = [];
          for (const sid of ids) {
            try {
              results.push({ sessionId: sid, ok: true, ...await purgeFromTrash(sid) });
            } catch (e) {
              results.push({ sessionId: sid, ok: false, error: String(e && e.message || e) });
            }
          }
          json(res, { ok: true, purged: results.filter((r) => r.ok).length, results });
        } catch (e) {
          json(res, { ok: false, error: String(e && e.message || e) }, 500);
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/sessions",
      handler: async (req, res) => {
        try {
          json(res, { items: await allSessionItems() });
        } catch (e) {
          json(res, { error: String(e && e.message || e) }, 500);
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/star/set",
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req);
          const starred = !!(body && body.starred);
          let ids = parseIds(body);
          if ((!ids || ids.length === 0) && body && typeof body.sessionId === "string") {
            ids = isSafeSessionId2(body.sessionId) ? [body.sessionId] : null;
          }
          if (!ids || ids.length === 0) return json(res, { ok: false, error: "missing sessionId" }, 400);
          const starredSessionIds = await stars.setStarred(ids, starred);
          json(res, { ok: true, starredSessionIds });
        } catch (e) {
          json(res, { ok: false, error: String(e && e.message || e) }, errorStatus(e));
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/export-md",
      handler: async (req, res) => {
        try {
          const url = new URL(req.url, "http://localhost");
          const sid = url.searchParams.get("sessionId");
          requireSessionId(sid);
          const r = await sp.readFrom(sid, 0);
          if (!r || !r.meta) {
            const error = new Error("\u65E0\u6CD5\u8BFB\u53D6\u8BE5\u4F1A\u8BDD\u7684\u65E5\u5FD7");
            error.status = 404;
            throw error;
          }
          const md = renderSessionMarkdown({ ...r.meta, id: sid }, r.events || []);
          res.writeHead(200, {
            "content-type": "text/markdown; charset=utf-8",
            "content-disposition": `attachment; filename="dsh-session-${sid}.md"`,
            "cache-control": "no-store"
          });
          res.end(md);
        } catch (e) {
          json(res, { error: String(e && e.message || e) }, errorStatus(e));
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/sidebar-state",
      handler: async (req, res) => {
        try {
          json(res, await sidebarAuthority());
        } catch (e) {
          json(res, { error: String(e && e.message || e) }, errorStatus(e));
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/workspaces",
      handler: async (req, res) => {
        try {
          json(res, { items: await listWorkspaces() });
        } catch (e) {
          json(res, { error: String(e && e.message || e) }, 500);
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/move",
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req);
          const sid = body && typeof body.sessionId === "string" ? body.sessionId : null;
          const target = body && typeof body.targetPath === "string" ? body.targetPath : null;
          if (!sid) return json(res, { ok: false, error: "missing sessionId" }, 400);
          if (!target) return json(res, { ok: false, error: "missing targetPath" }, 400);
          const moved = await moveOne(sid, target);
          try {
            await reindexRegistry();
          } catch (e) {
          }
          json(res, { sessionId: sid, ...moved });
        } catch (e) {
          json(res, { ok: false, error: String(e && e.message || e) }, 500);
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/archive",
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req);
          const sid = body && typeof body.sessionId === "string" ? body.sessionId : null;
          if (!sid) return json(res, { ok: false, error: "missing sessionId" }, 400);
          json(res, { sessionId: sid, ...await archiveOne(sid) });
        } catch (e) {
          json(res, { ok: false, error: String(e && e.message || e) }, 500);
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/archive-many",
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req);
          const ids = parseIds(body);
          if (!ids || ids.length === 0) return json(res, { ok: false, error: "missing sessionIds" }, 400);
          const results = [];
          for (const sid of ids) {
            try {
              results.push({ sessionId: sid, ok: true, ...await archiveOne(sid) });
            } catch (e) {
              results.push({ sessionId: sid, ok: false, error: String(e && e.message || e) });
            }
          }
          json(res, { ok: true, archived: results.filter((r) => r.ok).length, results });
        } catch (e) {
          json(res, { ok: false, error: String(e && e.message || e) }, 500);
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/details",
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req);
          const sid = body && typeof body.sessionId === "string" ? body.sessionId : null;
          if (!sid) return json(res, { ok: false, error: "missing sessionId" }, 400);
          json(res, await buildDetails(sid));
        } catch (e) {
          json(res, { error: String(e && e.message || e) }, e && e.status ? e.status : 500);
        }
      }
    }));
    return () => {
      for (const d of disposers) d();
    };
  }, "dsh-sessions-manager: routes");
}
export {
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
