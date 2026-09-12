// src/index.js
import { mkdir as mkdir7, readFile as readFile4, readdir as readdir4, realpath, rename as rename7, rm as rm3, stat as stat4, unlink, writeFile as writeFile7 } from "node:fs/promises";
import { basename as basename3, dirname as dirname4, isAbsolute, join as join9 } from "node:path";
import { readFileSync as readFileSync4 } from "node:fs";
import { homedir as homedir4 } from "node:os";

// src/zstd-frame.js
import zlib from "node:zlib";
var ZSTD_MAGIC = 4247762216;
var CHECKSUM_OPTS = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } };
function scanZstdFrames(buf, maxFrames = Number.POSITIVE_INFINITY) {
  const frames = [];
  let offset = 0;
  while (offset < buf.length) {
    const start = offset;
    if (buf.length - offset < 4) return { frames, tornStart: start };
    if (buf.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`\u4F1A\u8BDD\u65E5\u5FD7\u683C\u5F0F\u5F02\u5E38\uFF08\u5B57\u8282 ${offset} \u7684 zstd magic \u65E0\u6548\uFF09`);
    }
    offset += 4;
    if (offset === buf.length) return { frames, tornStart: start };
    const descriptor = buf.readUInt8(offset++);
    if ((descriptor & 24) !== 0) throw new Error(`\u4F1A\u8BDD\u65E5\u5FD7\u683C\u5F0F\u5F02\u5E38\uFF08\u5B57\u8282 ${offset - 1} \u4F7F\u7528\u4FDD\u7559\u5E27\u5934\u4F4D\uFF09`);
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? singleSegment ? 1 : 0 : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buf.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;
    for (; ; ) {
      if (buf.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buf.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = blockHeader >>> 1 & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error(`\u4F1A\u8BDD\u65E5\u5FD7\u683C\u5F0F\u5F02\u5E38\uFF08\u5B57\u8282 ${offset - 3} \u4F7F\u7528\u4FDD\u7559\u5757\u7C7B\u578B\uFF09`);
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buf.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buf.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
    if (frames.length === maxFrames) return { frames };
  }
  return { frames };
}
function firstFrame(buf) {
  const scan = scanZstdFrames(buf, 1);
  const frame = scan.frames[0];
  if (!frame) throw new Error("\u4F1A\u8BDD\u65E5\u5FD7\u683C\u5F0F\u5F02\u5E38\uFF08\u65E0\u5B8C\u6574 zstd \u5E27\uFF09");
  return frame;
}
function rewriteFrame0CwdInMemory(buf, newCwd) {
  const frame = firstFrame(buf);
  const end0 = frame.end;
  const frame0 = buf.subarray(frame.start, end0);
  const text = zlib.zstdDecompressSync(frame0).toString("utf8");
  const nl = text.indexOf("\n");
  const line = nl >= 0 ? text.slice(0, nl) : text;
  const obj = JSON.parse(line);
  if (obj.type !== "session") {
    throw new Error(`\u4F1A\u8BDD\u65E5\u5FD7\u683C\u5F0F\u5F02\u5E38\uFF08\u5E270 \u4E0D\u662F session header\uFF0C\u5B9E\u9645 type=${obj.type}\uFF09`);
  }
  obj.cwd = newCwd;
  const newFrame0 = zlib.zstdCompressSync(JSON.stringify(obj) + "\n", CHECKSUM_OPTS);
  const rest = buf.subarray(end0);
  return Buffer.concat([newFrame0, rest]);
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
function createMarkdownFold(out, header, options) {
  const includeReasoning = options.includeReasoning === true;
  const includeToolResults = options.includeToolResults === true;
  let title = typeof header.title === "string" && header.title.trim() ? header.title.trim() : null;
  let turn = null;
  return {
    get title() {
      return title;
    },
    // The last session/title event wins — DSH may retitle a session later on.
    add(events) {
      const list = Array.isArray(events) ? events : [];
      for (const ev of list) {
        if (!ev || typeof ev !== "object") continue;
        const data = ev.data && typeof ev.data === "object" ? ev.data : {};
        const type = ev.type;
        if (type === "session/title" && data && typeof data.title === "string" && data.title.trim()) {
          title = data.title.trim();
          continue;
        }
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
    }
  };
}
function createSessionMarkdownBuilder(meta, options = {}) {
  const header = meta && typeof meta === "object" ? meta : {};
  const body = [];
  const fold = createMarkdownFold(body, header, options);
  return {
    addEvents(events) {
      fold.add(events);
    },
    finish(metaOverride) {
      const effective = metaOverride && typeof metaOverride === "object" ? metaOverride : header;
      const title = fold.title;
      const front = ["---"];
      if (title) front.push(`title: ${yamlString(title)}`);
      if (typeof effective.id === "string" && effective.id) front.push(`sessionId: ${yamlString(effective.id)}`);
      if (typeof effective.cwd === "string" && effective.cwd) front.push(`cwd: ${yamlString(effective.cwd)}`);
      const created = isoTime(effective.createdAt);
      if (created) front.push(`createdAt: ${created}`);
      const exported = isoTime(options.exportedAt);
      if (exported) front.push(`exportedAt: ${exported}`);
      front.push("---");
      const doc = [front.join("\n")];
      if (title) doc.push("", `# ${title}`);
      doc.push(...body, "");
      return doc.join("\n");
    }
  };
}

// src/star-index.js
import { mkdir, rename, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
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
      return normalizeStarStore(JSON.parse(readFileSync(indexPath, "utf8")));
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

// src/pending-moves.js
import { readFileSync as readFileSync2 } from "node:fs";
import { mkdir as mkdir2, rename as rename2, writeFile as writeFile2 } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";
var SCHEMA_VERSION = 1;
var DEFAULT_DIR = process.env.DSH_SESSIONS_MANAGER_PENDING_DIR || process.env.DSH_SESSIONS_MANAGER_STAR_DIR || join2(homedir2(), ".dsh", "sessions-manager");
var MAX_ITEMS = 50;
var MAX_ATTEMPTS = 5;
function isSafeId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}
function normalizeStore(raw) {
  const items = [];
  const seen = /* @__PURE__ */ new Set();
  const source = raw && Array.isArray(raw.items) ? raw.items : [];
  for (const item of source) {
    if (!item || !isSafeId(item.sessionId) || typeof item.targetPath !== "string" || item.targetPath.length === 0) continue;
    if (seen.has(item.sessionId)) continue;
    seen.add(item.sessionId);
    items.push({
      sessionId: String(item.sessionId),
      targetPath: String(item.targetPath),
      queuedAt: Number.isFinite(item.queuedAt) ? Number(item.queuedAt) : Date.now(),
      attempts: Number.isSafeInteger(item.attempts) && item.attempts >= 0 ? Number(item.attempts) : 0
    });
    if (items.length >= MAX_ITEMS) break;
  }
  return { schemaVersion: SCHEMA_VERSION, items };
}
function createPendingMoveStore(options = {}) {
  const dir = options.dir || DEFAULT_DIR;
  const indexPath = options.indexPath || join2(dir, "pending-moves.json");
  let mutation = Promise.resolve();
  async function read() {
    try {
      return normalizeStore(JSON.parse(readFileSync2(indexPath, "utf8")));
    } catch (e) {
      return normalizeStore(null);
    }
  }
  async function write(store) {
    await mkdir2(dir, { recursive: true });
    const tmp = join2(dir, `.pending-moves-${process.pid}-${Date.now()}.tmp`);
    await writeFile2(tmp, JSON.stringify(normalizeStore(store), null, 2), { encoding: "utf8", mode: 384 });
    await rename2(tmp, indexPath);
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
  return {
    indexPath,
    dir,
    list: async () => (await read()).items,
    has: async (sessionId) => (await read()).items.some((item) => item.sessionId === String(sessionId)),
    queue: (sessionId, targetPath) => mutate((store) => {
      if (!isSafeId(sessionId) || typeof targetPath !== "string" || targetPath.length === 0) return null;
      const existing = store.items.find((item2) => item2.sessionId === String(sessionId));
      if (existing) {
        existing.targetPath = String(targetPath);
        existing.attempts = 0;
        return existing;
      }
      const item = { sessionId: String(sessionId), targetPath: String(targetPath), queuedAt: Date.now(), attempts: 0 };
      store.items.push(item);
      if (store.items.length > MAX_ITEMS) store.items.splice(0, store.items.length - MAX_ITEMS);
      return item;
    }),
    remove: (sessionIds) => mutate((store) => {
      const drop = new Set((Array.isArray(sessionIds) ? sessionIds : [sessionIds]).filter(isSafeId).map(String));
      const before = store.items.length;
      store.items = store.items.filter((item) => !drop.has(item.sessionId));
      return before - store.items.length;
    }),
    bumpAttempts: (sessionId) => mutate((store) => {
      const item = store.items.find((entry) => entry.sessionId === String(sessionId));
      if (!item) return null;
      item.attempts += 1;
      if (item.attempts >= MAX_ATTEMPTS) {
        store.items = store.items.filter((entry) => entry.sessionId !== item.sessionId);
        return { dropped: true, attempts: item.attempts };
      }
      return { dropped: false, attempts: item.attempts };
    })
  };
}

// src/state-temp-sweep.js
import { readdir, rm, stat } from "node:fs/promises";
import { join as join3 } from "node:path";
var TEMP_NAME_RE = /^\..+-\d+-\d+\.tmp$/;
async function sweepStaleStateTemps(dirs, options = {}) {
  const maxAgeMs = Number.isSafeInteger(options.maxAgeMs) && options.maxAgeMs >= 0 ? options.maxAgeMs : 36e5;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  let removed = 0;
  for (const dir of Array.isArray(dirs) ? dirs : []) {
    if (typeof dir !== "string" || dir.length === 0) continue;
    let entries;
    try {
      entries = await readdir(dir);
    } catch (e) {
      continue;
    }
    for (const name2 of entries) {
      if (!TEMP_NAME_RE.test(name2)) continue;
      const path = join3(dir, name2);
      let info;
      try {
        info = await stat(path);
      } catch (e) {
        continue;
      }
      if (!info.isFile()) continue;
      if (now - info.mtimeMs < maxAgeMs) continue;
      try {
        await rm(path, { force: true });
        removed++;
      } catch (e) {
      }
    }
  }
  return removed;
}

// src/storage-stats.js
var UNGROUPED_KEY = "__ungrouped__";
function isFiniteSize(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function aggregateStorage(items, options = {}) {
  const topN = Number.isInteger(options.topN) && options.topN > 0 ? options.topN : 10;
  const list = Array.isArray(items) ? items : [];
  const buckets = /* @__PURE__ */ new Map();
  const sized = [];
  let totalBytes = 0;
  let unknownSessions = 0;
  let counted = 0;
  for (const item of list) {
    if (!item || item.sessionId == null) continue;
    counted++;
    const id = String(item.sessionId);
    const path = item.workspacePath ? String(item.workspacePath) : null;
    const key = path || UNGROUPED_KEY;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, path, title: item.workspaceTitle ? String(item.workspaceTitle) : null, bytes: 0, sessions: 0 };
      buckets.set(key, bucket);
    }
    bucket.sessions++;
    if (isFiniteSize(item.sizeBytes)) {
      bucket.bytes += item.sizeBytes;
      totalBytes += item.sizeBytes;
      sized.push({
        sessionId: id,
        title: item.title || null,
        workspacePath: path,
        workspaceTitle: bucket.title,
        sizeBytes: item.sizeBytes
      });
    } else {
      unknownSessions++;
    }
  }
  const workspaces = [...buckets.values()].sort((a, b) => b.bytes - a.bytes || b.sessions - a.sessions || a.key.localeCompare(b.key)).map((bucket) => ({ ...bucket, share: totalBytes > 0 ? bucket.bytes / totalBytes : 0 }));
  const top = sized.sort((a, b) => b.sizeBytes - a.sizeBytes || a.sessionId.localeCompare(b.sessionId)).slice(0, topN);
  return {
    totalBytes,
    sessionCount: counted,
    sizedSessions: sized.length,
    unknownSessions,
    workspaces,
    top
  };
}

// src/auto-archive.js
import { mkdir as mkdir3, rename as rename3, writeFile as writeFile3 } from "node:fs/promises";
import { readFileSync as readFileSync3 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { join as join4 } from "node:path";
var AUTO_ARCHIVE_SCHEMA_VERSION = 4;
var INACTIVE_DAY_OPTIONS = Object.freeze([0, 30, 60, 90]);
var DAY_MS = 864e5;
var RUN_INTERVAL_MS = DAY_MS;
var DEFAULT_DIR2 = join4(homedir3(), ".dsh", "sessions-manager");
function normalizeAutoArchiveStore(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const settings = source.settings && typeof source.settings === "object" ? source.settings : {};
  const inactiveDays = INACTIVE_DAY_OPTIONS.includes(settings.inactiveDays) ? settings.inactiveDays : 0;
  return {
    schemaVersion: AUTO_ARCHIVE_SCHEMA_VERSION,
    settings: {
      inactiveDays,
      // Starred sessions are an explicit "keep" mark, so they are skipped
      // unless the user opts out.
      skipStarred: settings.skipStarred !== false
    },
    lastRunAt: Number.isFinite(source.lastRunAt) ? source.lastRunAt : null,
    lastArchivedCount: Number.isInteger(source.lastArchivedCount) && source.lastArchivedCount >= 0 ? source.lastArchivedCount : 0
  };
}
function pickInactiveCandidates(items, options = {}) {
  const days = options.inactiveDays;
  if (!INACTIVE_DAY_OPTIONS.includes(days) || days === 0) return [];
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const cutoff = now - days * DAY_MS;
  const skipStarred = options.skipStarred !== false;
  const activeId = options.activeSessionId != null ? String(options.activeSessionId) : null;
  const list = Array.isArray(items) ? items : [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of list) {
    if (!item || item.sessionId == null) continue;
    const id = String(item.sessionId);
    if (seen.has(id)) continue;
    if (item.archived) continue;
    if (skipStarred && item.starred) continue;
    if (activeId !== null && id === activeId) continue;
    const updatedAt = Number(item.updatedAt);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) continue;
    if (updatedAt < cutoff) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
function createAutoArchiveStore(options = {}) {
  const dir = options.dir || process.env.DSH_SESSIONS_MANAGER_AUTO_ARCHIVE_DIR || DEFAULT_DIR2;
  const indexPath = options.indexPath || join4(dir, "auto-archive.json");
  let mutation = Promise.resolve();
  async function read() {
    try {
      return normalizeAutoArchiveStore(JSON.parse(readFileSync3(indexPath, "utf8")));
    } catch {
      return normalizeAutoArchiveStore(null);
    }
  }
  async function write(store) {
    await mkdir3(dir, { recursive: true });
    const tmp = join4(dir, `.auto-archive-${process.pid}-${Date.now()}.tmp`);
    await writeFile3(tmp, JSON.stringify(normalizeAutoArchiveStore(store), null, 2), { encoding: "utf8", mode: 384 });
    await rename3(tmp, indexPath);
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
  function update(patch = {}) {
    return mutate((store) => {
      if (Object.prototype.hasOwnProperty.call(patch, "inactiveDays")) {
        const days = Number(patch.inactiveDays);
        if (!INACTIVE_DAY_OPTIONS.includes(days)) {
          const error = new Error(`inactiveDays \u4EC5\u652F\u6301 ${INACTIVE_DAY_OPTIONS.join("\u3001")}`);
          error.status = 400;
          throw error;
        }
        store.settings.inactiveDays = days;
      }
      if (Object.prototype.hasOwnProperty.call(patch, "skipStarred")) {
        store.settings.skipStarred = !!patch.skipStarred;
      }
      return store.settings;
    });
  }
  function recordRun(count, at = Date.now()) {
    return mutate((store) => {
      store.lastRunAt = at;
      store.lastArchivedCount = Number.isInteger(count) && count >= 0 ? count : 0;
      return store;
    });
  }
  function isFresh2(store, now = Date.now()) {
    return Number.isFinite(store && store.lastRunAt) && now - store.lastRunAt < RUN_INTERVAL_MS;
  }
  return { read, write, mutate, update, recordRun, isFresh: isFresh2, indexPath, dir };
}

// src/session-meta-cache.js
var DEFAULT_TTL_MS = 5 * 60 * 1e3;
var DEFAULT_MAX = 4e3;
var REVISION_PREFIX = "rev:";
function fingerprintOf(stat5) {
  if (!stat5 || typeof stat5 !== "object") return null;
  if (typeof stat5.revision === "string" && stat5.revision.length > 0) {
    return REVISION_PREFIX + stat5.revision;
  }
  const mtimeMs = stat5.mtimeMs;
  const size = stat5.size;
  if (typeof mtimeMs !== "number" || !Number.isFinite(mtimeMs) || mtimeMs <= 0) return null;
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return null;
  return `${Math.floor(mtimeMs)}:${size}`;
}
function isPersistableFingerprint(fingerprint) {
  return typeof fingerprint === "string" && fingerprint !== "" && !fingerprint.startsWith(REVISION_PREFIX);
}
function persistFingerprintOf(stat5) {
  const fp = fingerprintOf(stat5);
  if (fp && isPersistableFingerprint(fp)) return fp;
  if (stat5 && Number.isFinite(stat5.sizeBytes) && stat5.sizeBytes >= 0) return `sz:${stat5.sizeBytes}`;
  return null;
}
function isFresh(entry, stat5, now, ttlMs = DEFAULT_TTL_MS) {
  if (!entry) return false;
  const fp = fingerprintOf(stat5);
  if (!fp) return false;
  if (entry.fingerprint !== fp) return false;
  if (typeof entry.at !== "number") return false;
  if (fp.startsWith(REVISION_PREFIX)) return true;
  return now - entry.at <= ttlMs;
}
function partitionByCache(ids, statsById, cache, now = Date.now(), ttlMs = DEFAULT_TTL_MS) {
  const cached = /* @__PURE__ */ new Map();
  const missing = [];
  for (const id of ids) {
    const entry = cache && cache.get(String(id));
    const stat5 = statsById && statsById.get(String(id));
    if (isFresh(entry, stat5, now, ttlMs) && entry && entry.meta) {
      cached.set(String(id), entry.meta);
    } else {
      missing.push(String(id));
    }
  }
  return { cached, missing };
}
function createSessionMetaCache(opts = {}) {
  const ttlMs = Number.isFinite(opts.ttlMs) ? opts.ttlMs : DEFAULT_TTL_MS;
  const max = Number.isInteger(opts.max) && opts.max > 0 ? opts.max : DEFAULT_MAX;
  const map = /* @__PURE__ */ new Map();
  let hits = 0;
  let misses = 0;
  return {
    // 命中返回 meta，未命中/无法校验返回 null。
    get(id, stat5) {
      const key = String(id);
      const entry = map.get(key);
      if (isFresh(entry, stat5, Date.now(), ttlMs)) {
        hits++;
        map.delete(key);
        map.set(key, entry);
        return entry.meta;
      }
      misses++;
      return null;
    },
    set(id, stat5, meta) {
      if (!meta) return null;
      const fp = fingerprintOf(stat5);
      if (!fp) return null;
      const key = String(id);
      map.delete(key);
      map.set(key, { fingerprint: fp, at: Date.now(), meta });
      if (map.size > max) {
        const oldest = map.keys().next().value;
        if (oldest !== void 0) map.delete(oldest);
      }
      return meta;
    },
    // 批量判定：一次算出「命中缓存」与「需要解码」两组，供列表构建做批量投影。
    partition(ids, statsById) {
      return partitionByCache(ids, statsById, map, Date.now(), ttlMs);
    },
    invalidate(id) {
      if (id == null) return false;
      const key = String(id);
      const had = map.has(key);
      map.delete(key);
      return had;
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    },
    stats() {
      return { size: map.size, hits, misses, ttlMs };
    }
  };
}

// src/title-persist-index.js
import { mkdir as mkdir4, readFile, rename as rename4, writeFile as writeFile4 } from "node:fs/promises";
import { dirname, join as join5 } from "node:path";
var TITLE_INDEX_SCHEMA_VERSION = 2;
var MAX_ENTRIES = 2e4;
function normalizeEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = typeof raw.title === "string" ? raw.title : null;
  const cwd = typeof raw.cwd === "string" ? raw.cwd : null;
  const createdAt = typeof raw.createdAt === "number" ? raw.createdAt : null;
  const fingerprint = typeof raw.fingerprint === "string" && raw.fingerprint ? raw.fingerprint : null;
  const updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : 0;
  const resolved = raw.resolved === true || raw.resolved === 1;
  if (!fingerprint || fingerprint.startsWith("rev:")) return null;
  if (!title && !cwd) return null;
  if (!title && !resolved) return null;
  const entry = { title, cwd, createdAt, fingerprint, updatedAt };
  if (resolved) entry.resolved = 1;
  return entry;
}
function normalizeTitleIndex(raw) {
  const entries = {};
  if (raw && typeof raw === "object" && raw.entries && typeof raw.entries === "object") {
    for (const [id, entry] of Object.entries(raw.entries)) {
      if (typeof id !== "string" || !id || id.length > 200) continue;
      const normalized = normalizeEntry(entry);
      if (normalized) entries[id] = normalized;
    }
  }
  return { schemaVersion: TITLE_INDEX_SCHEMA_VERSION, entries };
}
function mergeEntries(left, right) {
  const merged = { ...left };
  for (const [id, entry] of Object.entries(right)) merged[id] = entry;
  const ids = Object.keys(merged);
  if (ids.length > MAX_ENTRIES) {
    ids.sort((a, b) => (merged[a].updatedAt || 0) - (merged[b].updatedAt || 0));
    for (const id of ids.slice(0, ids.length - MAX_ENTRIES)) delete merged[id];
  }
  return merged;
}
function createTitleIndexStore({ dir, file }) {
  let cache = null;
  let chain = Promise.resolve();
  const path = file || join5(dir, "title-index.json");
  async function readRaw() {
    try {
      return normalizeTitleIndex(JSON.parse(await readFile(path, "utf8")));
    } catch (e) {
      return normalizeTitleIndex(null);
    }
  }
  function enqueue(mutator) {
    const operation = chain.then(async () => {
      const store = cache || (cache = (await readRaw()).entries);
      await mutator(store);
      return store;
    });
    chain = operation.catch(() => {
    });
    return operation;
  }
  return {
    // 只读：内存优先，未加载过才落盘一次。绝不抛错。
    async entries() {
      if (cache) return cache;
      cache = (await readRaw()).entries;
      return cache;
    },
    // 批量合并写入（原子替换）。失败静默：索引只是加速器，坏了下次重解码。
    async merge(batch) {
      const right = {};
      for (const [id, entry] of Object.entries(batch || {})) {
        const normalized = normalizeEntry(entry);
        if (normalized) right[String(id)] = normalized;
      }
      if (!Object.keys(right).length) return false;
      await enqueue(async (store) => {
        const next = mergeEntries(store, right);
        await mkdir4(dirname(path), { recursive: true });
        const tmp = join5(dirname(path), `.title-index-${process.pid}-${Date.now()}.tmp`);
        await writeFile4(tmp, JSON.stringify({ schemaVersion: TITLE_INDEX_SCHEMA_VERSION, entries: next }), { encoding: "utf8", mode: 384 });
        await rename4(tmp, path);
        cache = next;
      });
      return true;
    },
    async remove(ids) {
      const wanted = new Set((ids || []).map(String));
      if (!wanted.size) return false;
      await enqueue(async (store) => {
        let changed = false;
        for (const id of wanted) {
          if (id in store) {
            delete store[id];
            changed = true;
          }
        }
        if (!changed) return;
        await mkdir4(dirname(path), { recursive: true });
        const tmp = join5(dirname(path), `.title-index-${process.pid}-${Date.now()}.tmp`);
        await writeFile4(tmp, JSON.stringify({ schemaVersion: TITLE_INDEX_SCHEMA_VERSION, entries: store }), { encoding: "utf8", mode: 384 });
        await rename4(tmp, path);
      });
      return true;
    }
  };
}

// src/empty-scan-index.js
import { mkdir as mkdir5, readFile as readFile2, rename as rename5, writeFile as writeFile5 } from "node:fs/promises";
import { dirname as dirname2, join as join6 } from "node:path";
var EMPTY_SCAN_SCHEMA_VERSION = 1;
var MAX_ENTRIES2 = 2e4;
function normalizeEntry2(raw) {
  if (!raw || typeof raw !== "object") return null;
  const empty = raw.empty === 1 || raw.empty === true ? 1 : raw.empty === 0 || raw.empty === false ? 0 : null;
  const fingerprint = typeof raw.fingerprint === "string" && raw.fingerprint ? raw.fingerprint : null;
  const updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : 0;
  if (empty === null || !fingerprint || fingerprint.startsWith("rev:")) return null;
  return { empty, fingerprint, updatedAt };
}
function normalizeEmptyScanIndex(raw) {
  const entries = {};
  if (raw && typeof raw === "object" && raw.entries && typeof raw.entries === "object") {
    for (const [id, entry] of Object.entries(raw.entries)) {
      if (typeof id !== "string" || !id || id.length > 200) continue;
      const normalized = normalizeEntry2(entry);
      if (normalized) entries[id] = normalized;
    }
  }
  return { schemaVersion: EMPTY_SCAN_SCHEMA_VERSION, entries };
}
function mergeEntries2(left, right) {
  const merged = { ...left };
  for (const [id, entry] of Object.entries(right)) merged[id] = entry;
  const ids = Object.keys(merged);
  if (ids.length > MAX_ENTRIES2) {
    ids.sort((a, b) => (merged[a].updatedAt || 0) - (merged[b].updatedAt || 0));
    for (const id of ids.slice(0, ids.length - MAX_ENTRIES2)) delete merged[id];
  }
  return merged;
}
function createEmptyScanStore({ dir, file }) {
  let cache = null;
  let chain = Promise.resolve();
  const path = file || join6(dir, "empty-scan.json");
  async function readRaw() {
    try {
      return normalizeEmptyScanIndex(JSON.parse(await readFile2(path, "utf8")));
    } catch (e) {
      return normalizeEmptyScanIndex(null);
    }
  }
  function enqueue(mutator) {
    const operation = chain.then(async () => {
      const store = cache || (cache = (await readRaw()).entries);
      await mutator(store);
      return store;
    });
    chain = operation.catch(() => {
    });
    return operation;
  }
  return {
    async entries() {
      if (cache) return cache;
      cache = (await readRaw()).entries;
      return cache;
    },
    async merge(batch) {
      const right = {};
      for (const [id, entry] of Object.entries(batch || {})) {
        const normalized = normalizeEntry2(entry);
        if (normalized) right[String(id)] = normalized;
      }
      if (!Object.keys(right).length) return false;
      await enqueue(async (store) => {
        const next = mergeEntries2(store, right);
        await mkdir5(dirname2(path), { recursive: true });
        const tmp = join6(dirname2(path), `.empty-scan-${process.pid}-${Date.now()}.tmp`);
        await writeFile5(tmp, JSON.stringify({ schemaVersion: EMPTY_SCAN_SCHEMA_VERSION, entries: next }), { encoding: "utf8", mode: 384 });
        await rename5(tmp, path);
        cache = next;
      });
      return true;
    },
    async remove(ids) {
      const wanted = new Set((ids || []).map(String));
      if (!wanted.size) return false;
      await enqueue(async (store) => {
        let changed = false;
        for (const id of wanted) {
          if (id in store) {
            delete store[id];
            changed = true;
          }
        }
        if (!changed) return;
        await mkdir5(dirname2(path), { recursive: true });
        const tmp = join6(dirname2(path), `.empty-scan-${process.pid}-${Date.now()}.tmp`);
        await writeFile5(tmp, JSON.stringify({ schemaVersion: EMPTY_SCAN_SCHEMA_VERSION, entries: store }), { encoding: "utf8", mode: 384 });
        await rename5(tmp, path);
      });
      return true;
    }
  };
}

// src/handle-era-paths.js
import { readdir as readdir2, stat as stat2 } from "node:fs/promises";
import { basename, join as join7 } from "node:path";

// src/path-guard.js
function splitSegments(target) {
  return String(target).replace(/[\\/]+$/, "").split(/[\\/]/).filter((seg) => seg.length > 0);
}
function stripDriveLetter(segments) {
  return segments.length > 0 && /^[A-Za-z]:$/.test(segments[0]) ? segments.slice(1) : segments;
}
function pathOwnsSession(target, sid) {
  if (typeof target !== "string" || target.length === 0) return false;
  if (typeof sid !== "string" || sid.length === 0) return false;
  const segments = stripDriveLetter(splitSegments(target));
  if (segments.length === 0) return false;
  const file = segments[segments.length - 1];
  if (segments.length >= 2 && segments[segments.length - 2] === sid) return true;
  if (file.includes(sid)) {
    const ID_CHAR = /[A-Za-z0-9_-]/;
    let from = 0;
    while (true) {
      const at = file.indexOf(sid, from);
      if (at < 0) return false;
      const before = at > 0 ? file[at - 1] : "";
      const after = at + sid.length < file.length ? file[at + sid.length] : "";
      if (!(before && ID_CHAR.test(before)) && !(after && ID_CHAR.test(after))) return true;
      from = at + 1;
    }
  }
  return false;
}

// src/handle-era-paths.js
var GENERATION_LOG_RE = /^session(\.v\d+)?\.jsonl(\.zst(d)?)?$/;
function isSafeChar(ch) {
  return ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch);
}
function projectKeyFor(cwd) {
  const s = String(cwd);
  if (s.length === 0) throw new Error("cannot encode an empty project path");
  let readable = "";
  let separatorRun = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "/" || ch === "\\" || ch === ":") {
      if (!separatorRun) readable += "-";
      separatorRun = true;
    } else if (isSafeChar(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += "~" + s.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
      separatorRun = false;
    }
  }
  return "--" + (readable.replace(/^-+/, "") || "root").slice(0, 251) + "--";
}
function encodeSegmentFor(raw) {
  const s = String(raw);
  if (s.length === 0) throw new Error("cannot encode an empty path segment");
  if (s === ".") return "~002E";
  if (s === "..") return "~002E~002E";
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    out += isSafeChar(ch) ? ch : "~" + s.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
  }
  return out;
}
function resolveSessionRoot(sp) {
  const root = sp && typeof sp === "object" ? sp.root : void 0;
  return typeof root === "string" && root.length > 0 ? root : null;
}
function deriveSessionDir(root, cwd, id) {
  const project = cwd === void 0 || cwd === null || cwd === "" ? join7(root, "_no-cwd") : join7(root, projectKeyFor(cwd));
  return join7(project, encodeSegmentFor(id));
}
function generationVersionOf(name2) {
  return Number((String(name2).match(/^session\.v(\d+)\./) || [])[1] || 0);
}
async function locateSessionArtifacts(sp, header) {
  const root = resolveSessionRoot(sp);
  if (!root || !header || header.id == null) return null;
  const sid = String(header.id);
  let sessionDir;
  try {
    sessionDir = deriveSessionDir(root, header.cwd, sid);
  } catch (e) {
    return null;
  }
  if (basename(sessionDir) !== encodeSegmentFor(sid)) return null;
  let entries;
  try {
    const st = await stat2(sessionDir);
    if (!st.isDirectory()) return null;
    entries = await readdir2(sessionDir);
  } catch (e) {
    return null;
  }
  const generationFiles = entries.filter((name2) => GENERATION_LOG_RE.test(name2));
  if (generationFiles.length === 0) return null;
  generationFiles.sort((a, b) => generationVersionOf(b) - generationVersionOf(a));
  const logPath = join7(sessionDir, generationFiles[0]);
  if (!pathOwnsSession(logPath, sid)) return null;
  return {
    root,
    projectDir: join7(root, header.cwd === void 0 || header.cwd === null || header.cwd === "" ? "_no-cwd" : projectKeyFor(header.cwd)),
    sessionDir,
    logPath,
    generationFiles,
    // 最高代版本号：0 = legacy `session.jsonl[.zstd]`，≥1 = `session.vN.jsonl[.zstd]`。
    // 上层用它判断「另一个目录里的同 id 副本是不是被取代的旧代」。
    generationVersion: generationVersionOf(generationFiles[0])
  };
}

// src/compat/persistence.js
var DEFAULT_CHUNK = 400;
var MAX_CHUNKS = 2e4;
function normalizeReadResult(events) {
  if (events === void 0 || events === null) return [];
  if (Array.isArray(events)) return events;
  if (typeof events === "object" && Array.isArray(events.events)) return events.events;
  if (typeof events[Symbol.iterator] === "function") return [...events];
  const error = new Error(
    "DSH \u4F1A\u8BDD\u8BFB\u53D6\u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BC6\u522B\u7684\u7ED3\u6784\uFF08runtime \u63A5\u53E3\u53EF\u80FD\u5DF2\u53D8\u66F4\uFF09\uFF0C\u5DF2\u505C\u6B62\u89E3\u6790\u4EE5\u514D\u8BEF\u5224\u4E3A\u7A7A\uFF1A" + Object.prototype.toString.call(events)
  );
  error.code = "DSM_READ_SHAPE_UNKNOWN";
  throw error;
}
async function closeQuietly(handle) {
  try {
    if (handle && typeof handle.close === "function") await handle.close();
  } catch (e) {
  }
}
function asHeader(value) {
  if (!value || typeof value !== "object") return null;
  const candidate = value.header && typeof value.header === "object" ? value.header : value;
  return candidate.id == null ? null : candidate;
}
function normalizePersistenceEntry(value) {
  const header = asHeader(value);
  if (!header) return null;
  const snapshot = value && value.header === header ? value : null;
  return {
    header,
    snapshot,
    id: String(header.id),
    sizeBytes: snapshot && Number.isFinite(snapshot.sizeBytes) ? Number(snapshot.sizeBytes) : null,
    eventCount: snapshot && Number.isSafeInteger(snapshot.eventCount) ? snapshot.eventCount : null,
    revision: snapshot && typeof snapshot.revision === "string" && snapshot.revision ? snapshot.revision : null
  };
}
function normalizePersistenceList(values) {
  if (!Array.isArray(values)) return [];
  return values.map(normalizePersistenceEntry).filter(Boolean);
}
function createPersistenceAdapter(service) {
  if (!service || typeof service.list !== "function") throw new TypeError("sessionPersistence.list is required");
  const hasStat = typeof service.stat === "function";
  const kind = typeof service.open === "function" ? "session-handle" : "legacy";
  async function listEntries(options) {
    return normalizePersistenceList(await service.list(options));
  }
  async function statSession(id) {
    if (!hasStat) return null;
    const snapshot = await service.stat(id);
    return snapshot ? normalizePersistenceEntry(snapshot) : null;
  }
  async function readChunk(handle, offset, length, signal) {
    if (signal && signal.aborted) {
      const error = new Error("\u4F1A\u8BDD\u8BFB\u53D6\u5DF2\u53D6\u6D88");
      error.code = "DSM_READ_ABORTED";
      throw error;
    }
    const events = await handle.read(offset, length, signal ? { signal } : void 0);
    return normalizeReadResult(events);
  }
  async function readChunks(id, { offset = 0, chunkSize = DEFAULT_CHUNK, signal, onEvents }) {
    if (typeof service.open !== "function") throw new Error("\u5F53\u524D DSH \u6301\u4E45\u5316\u670D\u52A1\u4E0D\u652F\u6301\u8BFB\u53D6\u4F1A\u8BDD");
    const handle = await service.open(id, "read");
    if (!handle || typeof handle.read !== "function" || typeof handle.close !== "function") {
      await closeQuietly(handle);
      throw new Error("DSH \u8FD4\u56DE\u4E86\u65E0\u6548\u7684 SessionHandle");
    }
    let cursor = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
    let total = 0;
    try {
      for (let round = 0; round < MAX_CHUNKS; round++) {
        const events = await readChunk(handle, cursor, chunkSize, signal);
        if (events.length === 0) break;
        cursor += events.length;
        total += events.length;
        if (onEvents) await onEvents(events, { offset: cursor - events.length, total });
        if (events.length < chunkSize) break;
      }
    } finally {
      await closeQuietly(handle);
    }
    return {
      meta: handle.header || handle.meta || null,
      inheritedEventCount: Number.isSafeInteger(handle.inheritedEventCount) ? handle.inheritedEventCount : 0,
      eventCount: total
    };
  }
  async function inspectSession(id, opts = {}) {
    const chunkSize = Number.isSafeInteger(opts.chunkSize) && opts.chunkSize > 0 ? opts.chunkSize : DEFAULT_CHUNK;
    if (typeof service.open === "function") {
      if (opts.signal && opts.signal.aborted) {
        const error = new Error("\u4F1A\u8BDD\u8BFB\u53D6\u5DF2\u53D6\u6D88");
        error.code = "DSM_READ_ABORTED";
        throw error;
      }
      return readChunks(id, { offset: opts.offset || 0, chunkSize, signal: opts.signal, onEvents: opts.onEvents });
    }
    if (typeof service.readFrom !== "function") throw new Error("\u5F53\u524D DSH \u6301\u4E45\u5316\u670D\u52A1\u4E0D\u652F\u6301\u8BFB\u53D6\u4F1A\u8BDD");
    if (opts.signal && opts.signal.aborted) {
      const error = new Error("\u4F1A\u8BDD\u8BFB\u53D6\u5DF2\u53D6\u6D88");
      error.code = "DSM_READ_ABORTED";
      throw error;
    }
    const result = await service.readFrom(id, opts.offset || 0);
    const events = normalizeReadResult(result && result.events);
    if (opts.onEvents && events.length) await opts.onEvents(events, { offset: opts.offset || 0, total: events.length });
    return {
      meta: result && result.meta ? result.meta : null,
      inheritedEventCount: result && Number.isSafeInteger(result.inheritedEventCount) ? result.inheritedEventCount : 0,
      eventCount: events.length
    };
  }
  async function readSession(id, offset = 0) {
    if (typeof service.readFrom === "function") {
      const result = await service.readFrom(id, offset);
      return {
        meta: result && result.meta ? result.meta : null,
        inheritedEventCount: result && Number.isSafeInteger(result.inheritedEventCount) ? result.inheritedEventCount : 0,
        events: result && Array.isArray(result.events) ? result.events : []
      };
    }
    const events = [];
    const summary = await readChunks(id, { offset, onEvents: (batch) => {
      events.push(...batch);
    } });
    return {
      meta: summary.meta,
      inheritedEventCount: summary.inheritedEventCount,
      events
    };
  }
  function locate(header) {
    if (typeof service.locate === "function") return service.locate(header);
    return null;
  }
  async function locateVerified(header) {
    if (typeof service.locate === "function") {
      try {
        const loc = service.locate(header);
        if (loc && typeof loc.path === "string") return { path: loc.path, sessionDir: null };
      } catch (e) {
      }
    }
    const artifacts = await locateSessionArtifacts(service, header);
    return artifacts ? { path: artifacts.logPath, sessionDir: artifacts.sessionDir } : null;
  }
  return { kind, listEntries, readSession, inspectSession, statSession, locate, locateVerified, hasStat };
}

// src/compat/capabilities.js
function action(available, reason = null) {
  return { available: !!available, reason: available ? null : reason };
}
function detectCapabilities({ persistence, workspaceRegistry }) {
  const handleApi = !!(persistence && typeof persistence.open === "function");
  const legacyRead = !!(persistence && typeof persistence.readFrom === "function");
  const legacyLocate = !!(persistence && (typeof persistence.locate === "function" || persistence.backend && typeof persistence.backend.locate === "function"));
  const handleEraRoot = !!(handleApi && persistence && typeof persistence.root === "string" && persistence.root.length > 0);
  const canVerifyExistence = !!(handleApi || legacyRead || persistence && typeof persistence.stat === "function");
  const readOk = legacyRead || handleApi;
  const workspaceInternals = !!(workspaceRegistry && workspaceRegistry.headers && workspaceRegistry.sessionPaths && typeof workspaceRegistry.replaceHeaderIndex === "function");
  const matrix = {
    readInspection: action(readOk, "\u5F53\u524D DSH \u672A\u63D0\u4F9B\u53EF\u8BC6\u522B\u7684\u4F1A\u8BDD\u8BFB\u53D6\u63A5\u53E3"),
    archive: action(!!(workspaceRegistry && typeof workspaceRegistry.archiveSession === "function"), "\u5F53\u524D DSH \u672A\u63D0\u4F9B\u5F52\u6863\u63A5\u53E3"),
    softTrash: action(readOk, "\u5F53\u524D DSH \u65E0\u6CD5\u8BFB\u53D6\u4F1A\u8BDD\uFF0C\u4E0D\u80FD\u5B89\u5168\u79FB\u5165\u56DE\u6536\u7AD9"),
    // 恢复不再无条件宣称可用：必须能校验底层会话仍存在（stat 或 list），
    // 否则恢复只会制造一条指向已消失日志的僵尸条目。
    restoreIndexedSession: action(canVerifyExistence, "\u5F53\u524D DSH \u65E0\u6CD5\u6821\u9A8C\u5E95\u5C42\u4F1A\u8BDD\u662F\u5426\u5B58\u5728\uFF0C\u4E0D\u80FD\u5B89\u5168\u6062\u590D"),
    physicalPurge: action(
      !handleApi && legacyLocate || handleApi && handleEraRoot && canVerifyExistence,
      handleApi && !handleEraRoot ? "\u65E0\u6CD5\u4ECE\u5F53\u524D DSH \u540E\u7AEF\u786E\u8BA4\u4F1A\u8BDD\u5B58\u50A8\u6839\u76EE\u5F55\uFF0C\u5DF2\u505C\u6B62\u7269\u7406\u5220\u9664\u4EE5\u4FDD\u62A4\u6570\u636E\u5B89\u5168" : "\u5F53\u524D DSH \u7248\u672C\u5C1A\u672A\u63D0\u4F9B\u7ECF\u8FC7\u9A8C\u8BC1\u7684\u5B89\u5168\u6C38\u4E45\u5220\u9664\u80FD\u529B\uFF1B\u79FB\u5165\u56DE\u6536\u7AD9\u4E0D\u4F1A\u91CA\u653E\u78C1\u76D8\u7A7A\u95F4"
    ),
    relocateSession: action(
      !handleApi && legacyRead && legacyLocate && workspaceInternals || handleApi && handleEraRoot && readOk && workspaceInternals,
      handleApi && !workspaceInternals ? "\u5F53\u524D DSH \u672A\u63D0\u4F9B\u5DE5\u4F5C\u533A\u6CE8\u518C\u8868\u5185\u90E8\u7ED3\u6784\uFF0C\u8DE8\u5DE5\u4F5C\u533A\u79FB\u52A8\u540E\u65E0\u6CD5\u5373\u65F6\u5237\u65B0\u5206\u7EC4" : handleApi && !handleEraRoot ? "\u65E0\u6CD5\u4ECE\u5F53\u524D DSH \u540E\u7AEF\u786E\u8BA4\u4F1A\u8BDD\u5B58\u50A8\u6839\u76EE\u5F55\uFF0C\u5DF2\u505C\u6B62\u79FB\u52A8\u4EE5\u4FDD\u62A4\u6570\u636E\u5B89\u5168" : "\u5F53\u524D DSH \u7248\u672C\u5C1A\u672A\u63D0\u4F9B\u7ECF\u8FC7\u9A8C\u8BC1\u7684\u8DE8\u5DE5\u4F5C\u533A\u8FC1\u79FB\u80FD\u529B"
    )
  };
  matrix.read = matrix.readInspection;
  matrix.trash = matrix.softTrash;
  matrix.restoreTrash = matrix.restoreIndexedSession;
  matrix.purge = matrix.physicalPurge;
  matrix.move = matrix.relocateSession;
  return {
    persistence: handleApi ? "session-handle" : "legacy",
    actions: matrix
  };
}
function requireCapability(capabilities, name2) {
  const value = capabilities && capabilities.actions && capabilities.actions[name2];
  if (value && value.available) return;
  const error = new Error(value && value.reason || `\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301 ${name2}`);
  error.status = 409;
  error.code = "DSM_CAPABILITY_UNAVAILABLE";
  throw error;
}

// src/handle-era-ops.js
import { mkdir as mkdir6, readFile as readFile3, readdir as readdir3, rename as rename6, rm as rm2, stat as stat3, writeFile as writeFile6 } from "node:fs/promises";
import { basename as basename2, dirname as dirname3, join as join8 } from "node:path";
var MOVE_BATCH = 400;
var REAL_LOG_RE = /^session.*\.jsonl(\.zst(d)?)?$/;
var MOVE_TEMP_RE = /\.move-(backup|stage)-/;
var SESSION_LOCAL_JUNK_RE = /^(\.?session\.lock.*|\.lock.*|.*\.lock|.*\.tmp|.*\.stage|.*\.bak|\.DS_Store)$/;
async function cleanSiblingCopies(root, sid, keepDir, keepVersion) {
  let projects;
  try {
    projects = await readdir3(root, { withFileTypes: true });
  } catch (e) {
    return { removed: 0, superseded: [], real: [] };
  }
  let segment;
  try {
    segment = encodeSegmentFor(sid);
  } catch (e) {
    return { removed: 0, superseded: [], real: [] };
  }
  let removed = 0;
  const superseded = [];
  const real = [];
  for (const ent of projects) {
    if (!ent.isDirectory()) continue;
    const candidate = join8(root, ent.name, segment);
    if (keepDir && candidate === keepDir) continue;
    let entries;
    try {
      const st = await stat3(candidate);
      if (!st.isDirectory()) continue;
      entries = await readdir3(candidate);
    } catch (e) {
      continue;
    }
    const logs = entries.filter((name2) => REAL_LOG_RE.test(name2) && !MOVE_TEMP_RE.test(name2));
    if (logs.length === 0) {
      try {
        await rm2(candidate, { recursive: true, force: true });
        removed++;
      } catch (e) {
      }
      continue;
    }
    const highest = Math.max(...logs.map(generationVersionOf));
    const onlyLogsAndLocalJunk = entries.every((name2) => REAL_LOG_RE.test(name2) && !MOVE_TEMP_RE.test(name2) || SESSION_LOCAL_JUNK_RE.test(name2));
    if (Number.isSafeInteger(keepVersion) && highest < keepVersion && onlyLogsAndLocalJunk) {
      try {
        await rm2(candidate, { recursive: true, force: true });
        superseded.push(candidate);
      } catch (e) {
        real.push(candidate);
      }
      continue;
    }
    real.push(candidate);
  }
  return { removed, superseded, real };
}
async function removeSourceDir(sessionDir) {
  let entries;
  try {
    entries = await readdir3(sessionDir);
  } catch (e) {
    return { cleaned: true, leftover: [] };
  }
  try {
    await rm2(sessionDir, { recursive: true, force: true });
  } catch (e) {
    return { cleaned: false, leftover: entries };
  }
  return { cleaned: true, leftover: [] };
}
var BUSY_MOVE_MESSAGE = "\u4F1A\u8BDD\u6B63\u88AB DSH \u6253\u5F00\uFF0C\u6682\u65F6\u65E0\u6CD5\u79FB\u52A8\uFF1B\u8BF7\u91CD\u542F DSH \u540E\u518D\u8BD5\u3002";
var BUSY_PURGE_MESSAGE = "\u4F1A\u8BDD\u6B63\u88AB DSH \u6253\u5F00\uFF0C\u6682\u65F6\u65E0\u6CD5\u5F7B\u5E95\u5220\u9664\uFF1B\u8BF7\u91CD\u542F DSH \u540E\u518D\u8BD5\u3002";
function conflictError(message) {
  const error = new Error(message);
  error.status = 409;
  error.code = "DSM_SESSION_BUSY";
  return error;
}
function failureText(e) {
  return `${e && e.name || ""} ${e && e.message || e}`;
}
function isAlreadyOwned(e) {
  return /already owned/i.test(failureText(e));
}
function isAlreadyExists(e) {
  return /already exists/i.test(failureText(e));
}
async function closeQuietly2(handle) {
  try {
    if (handle && typeof handle.close === "function") await handle.close();
  } catch (e) {
  }
}
async function ensureNoActiveWriter(sp, sid) {
  let handle = null;
  try {
    handle = await sp.open(sid, "write");
  } catch (e) {
    if (isAlreadyOwned(e)) throw conflictError(BUSY_MOVE_MESSAGE);
    throw e;
  }
  await closeQuietly2(handle);
}
async function purgeSessionArtifacts(sp, sid, header) {
  const artifacts = await locateSessionArtifacts(sp, header);
  if (!artifacts) {
    const error = new Error("\u65E0\u6CD5\u5B9A\u4F4D\u8BE5\u4F1A\u8BDD\u7684\u7269\u7406\u65E5\u5FD7\u76EE\u5F55\uFF0C\u5DF2\u505C\u6B62\u6C38\u4E45\u5220\u9664");
    error.status = 409;
    throw error;
  }
  let writer = null;
  try {
    writer = await sp.open(sid, "write");
  } catch (e) {
    if (isAlreadyOwned(e)) throw conflictError(BUSY_PURGE_MESSAGE);
    throw e;
  }
  await closeQuietly2(writer);
  writer = null;
  try {
    await rm2(artifacts.sessionDir, { recursive: true, force: true });
  } catch (e) {
    const error = new Error("\u5220\u9664\u4F1A\u8BDD\u65E5\u5FD7\u5931\u8D25\uFF1A" + String(e && e.message || e));
    error.status = 500;
    throw error;
  }
  if (typeof sp.stat === "function") {
    const after = await sp.stat(sid).catch(() => void 0);
    if (after) {
      const error = new Error("\u5220\u9664\u540E\u5B98\u65B9 stat \u4ECD\u80FD\u770B\u5230\u8BE5\u4F1A\u8BDD\uFF0C\u5DF2\u4E2D\u6B62\uFF08\u76EE\u5F55\u53EF\u80FD\u88AB\u5E76\u53D1\u91CD\u5EFA\uFF09");
      error.status = 500;
      throw error;
    }
  }
  return artifacts;
}
async function relocateRewrittenBackup({ sid, canonical, backupLogPath, artifacts }) {
  const original = await readFile3(backupLogPath);
  const frames = scanZstdFrames(original).frames;
  if (frames.length === 0) throw new Error("\u79FB\u52A8\u524D\u6821\u9A8C\u5931\u8D25\uFF1A\u4F1A\u8BDD\u65E5\u5FD7\u6CA1\u6709\u5B8C\u6574 zstd \u5E27");
  const rewritten = rewriteFrame0CwdInMemory(original, canonical);
  const rewrittenFrames = scanZstdFrames(rewritten).frames;
  if (rewrittenFrames.length !== frames.length) throw new Error("\u79FB\u52A8\u540E\u6821\u9A8C\u5931\u8D25\uFF1A\u4F1A\u8BDD\u65E5\u5FD7\u5E27\u6570\u53D1\u751F\u53D8\u5316");
  if (!original.subarray(frames[0].end).equals(rewritten.subarray(rewrittenFrames[0].end))) {
    throw new Error("\u79FB\u52A8\u540E\u6821\u9A8C\u5931\u8D25\uFF1A\u4F1A\u8BDD\u4E8B\u4EF6\u5185\u5BB9\u53D1\u751F\u53D8\u5316");
  }
  const targetDir = deriveSessionDir(artifacts.root, canonical, sid);
  await mkdir6(targetDir, { recursive: true });
  const staged = join8(targetDir, `.move-stage-${process.pid}-${Date.now()}`);
  await writeFile6(staged, rewritten, { mode: 384 });
  await rename6(staged, join8(targetDir, artifacts.generationFiles[0]));
  return targetDir;
}
async function moveSessionToCwd({ sp, sid, header, canonical, events = [], inheritedEventCount = 0 }) {
  let probeError = null;
  try {
    await ensureNoActiveWriter(sp, sid);
  } catch (e) {
    if (e && e.status === 409) throw e;
    probeError = e;
  }
  const artifacts = await locateSessionArtifacts(sp, header);
  if (!artifacts) {
    const error = new Error("\u65E0\u6CD5\u5B9A\u4F4D\u8BE5\u4F1A\u8BDD\u7684\u7269\u7406\u65E5\u5FD7\uFF0C\u5DF2\u505C\u6B62\u79FB\u52A8");
    error.status = 409;
    throw error;
  }
  if (probeError) {
    const error = new Error("\u65E0\u6CD5\u786E\u8BA4\u8BE5\u4F1A\u8BDD\u662F\u5426\u6B63\u88AB\u5199\u5165\uFF0C\u5DF2\u505C\u6B62\u79FB\u52A8\uFF1A" + String(probeError && probeError.message || probeError));
    error.status = 409;
    throw error;
  }
  const HEADER_ONLY_MAX = 4096;
  if (events.length === 0) {
    let sourceBytes = null;
    try {
      sourceBytes = (await stat3(artifacts.logPath)).size;
    } catch (e) {
      sourceBytes = null;
    }
    if (sourceBytes !== null && sourceBytes > HEADER_ONLY_MAX) {
      const error = new Error(
        `\u79FB\u52A8\u524D\u6821\u9A8C\u5931\u8D25\uFF1A\u6E90\u65E5\u5FD7\u6709 ${sourceBytes} \u5B57\u8282\u4F46\u8BFB\u5230 0 \u6761\u4E8B\u4EF6\uFF08\u8BFB\u53D6\u94FE\u8DEF\u5F02\u5E38\uFF09\uFF0C\u5DF2\u505C\u6B62\u79FB\u52A8\u4EE5\u514D\u4E22\u5931\u4F1A\u8BDD\u5185\u5BB9\u3002`
      );
      error.status = 409;
      error.code = "DSM_MOVE_EMPTY_READ";
      throw error;
    }
  }
  const siblings = await cleanSiblingCopies(artifacts.root, sid, artifacts.sessionDir, artifacts.generationVersion);
  if (siblings.real.length > 0) {
    const error = new Error(
      "\u65E0\u6CD5\u79FB\u52A8\uFF1A\u5728\u5176\u4ED6\u5DE5\u4F5C\u533A\u76EE\u5F55\u53D1\u73B0\u540C\u4E00\u4F1A\u8BDD\u7684\u65E5\u5FD7\u526F\u672C\uFF0C\u8BF7\u5148\u786E\u8BA4\u4FDD\u7559\u54EA\u4E00\u4EFD\uFF1A\n" + siblings.real.map((p) => "\xB7 " + p).join("\n")
    );
    error.status = 409;
    error.code = "DSM_SESSION_DUP_LOG";
    throw error;
  }
  const newHeader = Object.assign({}, header, { cwd: canonical });
  const firstSeq = events.length ? Number(events[0].seq) : 0;
  const replay = firstSeq !== 0 ? events.map((event, index) => ({ ...event, seq: index })) : events;
  const createOptions = header.isSeeded && Number.isSafeInteger(inheritedEventCount) && inheritedEventCount > 0 ? { inheritedEventCount } : void 0;
  const backupRoot = join8(dirname3(artifacts.root), "sessions-manager-move-backup");
  const backupDir = join8(backupRoot, `${encodeSegmentFor(sid)}-${process.pid}-${Date.now()}`);
  await mkdir6(backupRoot, { recursive: true });
  const backupLogPath = join8(backupDir, basename2(artifacts.logPath));
  await rename6(artifacts.sessionDir, backupDir);
  let writer = null;
  try {
    try {
      writer = await sp.create(newHeader, createOptions);
      for (let i = 0; i < replay.length; i += MOVE_BATCH) {
        await writer.append(replay.slice(i, i + MOVE_BATCH));
      }
      await writer.flush();
      await writer.close();
      writer = null;
    } catch (e) {
      if (isAlreadyExists(e)) {
        await relocateRewrittenBackup({ sid, canonical, backupLogPath, artifacts });
      } else {
        throw e;
      }
    }
    if (typeof sp.stat !== "function") throw new Error("\u79FB\u52A8\u540E\u65E0\u6CD5\u6821\u9A8C\uFF1A\u540E\u7AEF\u672A\u63D0\u4F9B stat");
    const after = await sp.stat(sid);
    if (!after || !after.header || after.header.cwd !== canonical) {
      throw new Error("\u79FB\u52A8\u540E\u6821\u9A8C\u5931\u8D25\uFF1A\u4F1A\u8BDD\u5DE5\u4F5C\u76EE\u5F55\u672A\u6B63\u786E\u66F4\u65B0");
    }
    if (Number.isSafeInteger(after.eventCount) && events.length > 0 && after.eventCount !== events.length) {
      throw new Error(`\u79FB\u52A8\u540E\u6821\u9A8C\u5931\u8D25\uFF1A\u4E8B\u4EF6\u6570\u4E0D\u4E00\u81F4\uFF08\u6E90 ${events.length}\uFF0C\u526F\u672C ${after.eventCount}\uFF09`);
    }
  } catch (e) {
    await closeQuietly2(writer);
    try {
      await rm2(deriveSessionDir(artifacts.root, canonical, sid), { recursive: true, force: true });
    } catch (_) {
    }
    try {
      await mkdir6(dirname3(artifacts.sessionDir), { recursive: true });
    } catch (_) {
    }
    try {
      await rename6(backupDir, artifacts.sessionDir);
    } catch (_) {
    }
    if (e && e.status) throw e;
    const error = new Error("\u79FB\u52A8\u4F1A\u8BDD\u65E5\u5FD7\u5931\u8D25\uFF1A" + String(e && e.message || e));
    error.status = 500;
    throw error;
  }
  const sourceCleanup = await removeSourceDir(backupDir);
  return {
    sessionDir: deriveSessionDir(artifacts.root, canonical, sid),
    sourceCleanup,
    reclaimedSiblings: siblings.superseded
  };
}

// src/lineage.js
var EMPTY_DECODE_LIMIT = 8192;
var LIFECYCLE_EVENT_TYPES = /* @__PURE__ */ new Set([
  "session",
  "permission/preset",
  "sandbox/mode",
  "approval/policy"
]);
function isEmptyEventTypes(types) {
  if (!Array.isArray(types)) return false;
  for (const t of types) {
    if (typeof t !== "string" || !LIFECYCLE_EVENT_TYPES.has(t)) return false;
  }
  return true;
}
function classifyLineage(header) {
  if (!header || typeof header !== "object") return null;
  const origin = header.origin === "subagent" ? "subagent" : null;
  const parentSession = typeof header.parentSession === "string" && header.parentSession ? header.parentSession : null;
  const delegationDepth = Number.isSafeInteger(header.delegationDepth) && header.delegationDepth > 0 ? header.delegationDepth : 0;
  if (!origin && !parentSession) return null;
  return { origin, parentSession, delegationDepth, empty: null };
}
function emptyScanCandidate(sizeBytes) {
  return Number.isFinite(sizeBytes) && sizeBytes <= EMPTY_DECODE_LIMIT;
}

// src/index.js
var BUILD_STAMP = true ? "3.6.2+ffc6cf28" : "dev";
var name = "dsh-sessions-manager";
var inject = ["webServer", "workspaceRegistry", "sessionPersistence", "sessionQuery", "storageDomain"];
var MAX_TITLE = 80;
var STATE_DIR = process.env.DSH_SESSIONS_MANAGER_STAR_DIR || join9(homedir4(), ".dsh", "sessions-manager");
var TRASH_DIR = process.env.DSH_SESSIONS_MANAGER_TRASH_DIR || join9(homedir4(), ".dsh", "sessions-manager-trash");
var TRASH_INDEX = join9(TRASH_DIR, "index.json");
var TRASH_SCHEMA_VERSION = 2;
var DEFAULT_TRASH_SETTINGS = Object.freeze({ retentionDays: 0 });
var FETCH_TOOL_RE = /search|fetch|download|browse/i;
var MAX_FETCHES = 12;
var MAX_FILES = 20;
var MAX_STORAGE_TOP = 50;
function json(res, value, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}
function errorStatus(error) {
  return error && Number.isInteger(error.status) ? error.status : 500;
}
function createLimiter(max) {
  let active = 0;
  const queue = [];
  return async function run(fn) {
    if (active >= max) await new Promise((resolve) => queue.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      const next = queue.shift();
      if (next) next();
    }
  };
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
function apply(ctx) {
  const w = ctx.workspaceRegistry;
  const sp = ctx.sessionPersistence;
  const persistence = createPersistenceAdapter(sp);
  const capabilities = detectCapabilities({ persistence: sp, workspaceRegistry: w });
  const sq = ctx.sessionQuery;
  const dom = () => ctx.storageDomain.get("workspace");
  const authorityTitleCache = /* @__PURE__ */ new Map();
  const metaCache = createSessionMetaCache();
  const titleIndex = createTitleIndexStore({ dir: TRASH_DIR, file: join9(TRASH_DIR, "title-index.json") });
  const emptyIndex = createEmptyScanStore({ dir: TRASH_DIR });
  const EMPTY_VERDICT_TTL_MS = 14 * 24 * 3600 * 1e3;
  async function hydrateFromPersist(ids, statsById) {
    const hits = /* @__PURE__ */ new Map();
    if (!ids || !ids.length) return hits;
    let store;
    try {
      store = await titleIndex.entries();
    } catch (e) {
      return hits;
    }
    for (const id of ids) {
      const stat5 = statsById.get(id);
      const entry = store && store[id];
      if (!stat5 || !entry) continue;
      const fp = persistFingerprintOf(stat5);
      if (!fp) continue;
      if (entry.fingerprint === fp && (entry.title || entry.resolved)) {
        hits.set(id, { title: entry.title, cwd: entry.cwd, createdAt: entry.createdAt });
      }
    }
    return hits;
  }
  async function persistDecoded(decoded, statsById) {
    if (!decoded || !decoded.size) return;
    const batch = {};
    const now = Date.now();
    for (const [id, pack] of decoded) {
      if (!pack || !pack.resolved) continue;
      const meta = pack.meta;
      const fp = persistFingerprintOf(statsById.get(id));
      if (!fp) continue;
      batch[id] = { title: meta.title, cwd: meta.cwd, createdAt: meta.createdAt, fingerprint: fp, updatedAt: now, resolved: 1 };
    }
    if (!Object.keys(batch).length) return;
    try {
      await titleIndex.merge(batch);
    } catch (e) {
    }
  }
  function metaFromSnapshot(o) {
    let title = null, createdAt = null, cwd = null;
    if (o) {
      if (o.title && o.title.title) title = String(o.title.title);
      if (o.session) {
        cwd = o.session.cwd || null;
        createdAt = o.session.createdAt || null;
      }
    }
    return { title, cwd, createdAt };
  }
  function unwrapSnapshot(result) {
    if (!result) return null;
    if (result.status === "fulfilled") return result.value || null;
    if (result.status === "rejected") return null;
    return result;
  }
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
  function buildItem(key, meta, usage, exposeUsage) {
    const cwd = meta.cwd || null;
    const ws = cwd ? wsByPath[cwd] : void 0;
    const title = meta.title || null;
    const display = title ? String(title).length > MAX_TITLE ? String(title).slice(0, MAX_TITLE) + "\u2026" : String(title) : null;
    const base = {
      sessionId: key,
      title: display,
      createdAt: meta.createdAt || null,
      workspacePath: cwd,
      workspaceTitle: ws && ws.title ? ws.title : null,
      workspaceGone: !!(cwd && !ws),
      hasWorkspace: !!cwd
    };
    if (exposeUsage && usage) {
      if (usage.sizeById && usage.sizeById.has(key)) base.sizeBytes = usage.sizeById.get(key);
      if (usage.mtimeById && usage.mtimeById.has(key)) base.updatedAt = usage.mtimeById.get(key);
    }
    return base;
  }
  const EMPTY_META = { title: null, cwd: null, createdAt: null };
  const WARM_CHUNK = 4;
  const warmQueue = /* @__PURE__ */ new Map();
  let warmRunning = false;
  let warmKickTimer = null;
  const WARM_MAX_ATTEMPTS = 5;
  const warmFail = /* @__PURE__ */ new Map();
  function warmFpOf(stat5) {
    return fingerprintOf(stat5) || persistFingerprintOf(stat5);
  }
  function warmBlocked(id, fp) {
    const rec = warmFail.get(id);
    if (!rec) return 0;
    if (fp && rec.fp && rec.fp !== fp) {
      warmFail.delete(id);
      return 0;
    }
    const now = Date.now();
    return rec.nextAt > now ? rec.nextAt - now : 0;
  }
  function warmMarkFailure(id, stat5, header) {
    const rec = warmFail.get(id) || { count: 0, fp: null, nextAt: 0 };
    rec.count += 1;
    rec.fp = warmFpOf(stat5) || rec.fp;
    if (stat5) rec.stat = stat5;
    if (header) rec.header = header;
    const backoff = rec.count >= WARM_MAX_ATTEMPTS ? 60 * 60 * 1e3 : Math.min(5 * 60 * 1e3, 15 * 1e3 * Math.pow(2, rec.count));
    rec.nextAt = Date.now() + backoff;
    warmFail.set(id, rec);
  }
  function warmPendingNow() {
    if (!warmHasApi) return false;
    if (warmRunning || warmQueue.size) return true;
    for (const rec of warmFail.values()) if (rec.nextAt > Date.now()) return true;
    return false;
  }
  let warmRetryTimer = null;
  function scheduleWarmRetry() {
    if (warmRetryTimer) return;
    let soonest = 0;
    for (const rec of warmFail.values()) {
      const wait = rec.nextAt - Date.now();
      if (wait <= 0) {
        soonest = 1;
        break;
      }
      if (!soonest || wait < soonest) soonest = wait;
    }
    if (!soonest) return;
    warmRetryTimer = setTimeout(() => {
      warmRetryTimer = null;
      const now = Date.now();
      for (const [id, rec] of warmFail) {
        if (rec.nextAt <= now && !warmQueue.has(id)) warmQueue.set(id, { stat: rec.stat || null, header: rec.header || null });
      }
      if (warmQueue.size) scheduleWarm();
    }, soonest);
    if (typeof warmRetryTimer.unref === "function") warmRetryTimer.unref();
  }
  function scheduleWarm() {
    if (warmKickTimer || warmRunning) return;
    warmKickTimer = setTimeout(() => {
      warmKickTimer = null;
      runWarm();
    }, 25);
    if (typeof warmKickTimer.unref === "function") warmKickTimer.unref();
  }
  function enqueueWarm(ids, statsById, entryById) {
    if (!ids || !ids.length) return;
    if (!warmHasApi) return;
    for (const id of ids) {
      const key = String(id);
      const stat5 = statsById ? statsById.get(key) || null : null;
      const fp = warmFpOf(stat5);
      if (!fp) continue;
      const blockedMs = warmBlocked(key, fp);
      const entry = entryById ? entryById.get(key) : null;
      const rec = warmFail.get(key);
      if (rec) {
        rec.stat = stat5 || rec.stat;
        if (entry) rec.header = entry.header || rec.header;
      }
      if (blockedMs > 0) continue;
      warmQueue.set(key, {
        stat: stat5,
        header: entry && entry.header || null
      });
    }
    if (warmQueue.size) scheduleWarm();
    scheduleWarmRetry();
  }
  async function backfillTrashTitles(decoded) {
    if (!decoded || !decoded.size) return;
    try {
      const items = await readTrash();
      const worth = items.some((t) => !t.title && decoded.get(String(t.sessionId)) && decoded.get(String(t.sessionId)).meta && decoded.get(String(t.sessionId)).meta.title);
      if (!worth) return;
      await mutateTrash((store) => {
        for (const item of store.items) {
          if (item.title) continue;
          const pack = decoded.get(String(item.sessionId));
          const t = pack && pack.meta && pack.meta.title;
          if (t) item.title = String(t);
        }
      });
    } catch (e) {
    }
  }
  async function runWarm() {
    if (warmRunning) return;
    warmRunning = true;
    try {
      while (warmQueue.size) {
        const batch = [...warmQueue.entries()].slice(0, WARM_CHUNK);
        for (const [id] of batch) warmQueue.delete(id);
        try {
          const ids = batch.map(([id]) => id);
          const resultById = await projectTitlesStatus(ids);
          const decoded = /* @__PURE__ */ new Map();
          const statsById = /* @__PURE__ */ new Map();
          for (const [id, desc] of batch) {
            const r = resultById.get(id);
            if (!r || !r.resolved) {
              warmMarkFailure(id, desc.stat, desc.header);
              continue;
            }
            warmFail.delete(id);
            const meta = metaFromSnapshot(r.snapshot || null);
            if (desc.header) {
              if (typeof desc.header.cwd === "string") meta.cwd = desc.header.cwd;
              if (desc.header.createdAt != null) meta.createdAt = desc.header.createdAt;
            }
            metaCache.set(id, desc.stat, meta);
            statsById.set(id, desc.stat);
            decoded.set(id, { meta, resolved: true });
          }
          await persistDecoded(decoded, statsById);
          await backfillTrashTitles(decoded);
        } catch (e) {
        }
        await new Promise((resolve) => setImmediate(resolve));
      }
    } finally {
      warmRunning = false;
      if (warmQueue.size) scheduleWarm();
      scheduleWarmRetry();
    }
  }
  async function collectUsage(preloadedEntries) {
    const sizeById = /* @__PURE__ */ new Map();
    const mtimeById = /* @__PURE__ */ new Map();
    const statsById = /* @__PURE__ */ new Map();
    let entries = null;
    if (Array.isArray(preloadedEntries)) entries = preloadedEntries;
    else {
      try {
        entries = await persistence.listEntries();
      } catch (e) {
        entries = [];
      }
    }
    if (!Array.isArray(entries)) entries = [];
    const CHUNK = 8;
    for (let i = 0; i < entries.length; i += CHUNK) {
      await Promise.all(entries.slice(i, i + CHUNK).map(async (entry) => {
        const header = entry && entry.header ? entry.header : entry;
        const id = entry && entry.id != null ? String(entry.id) : header && header.id != null ? String(header.id) : null;
        if (!id) return;
        if (entry && typeof entry.revision === "string" && entry.revision) {
          if (Number.isFinite(entry.sizeBytes)) sizeById.set(id, Number(entry.sizeBytes));
          statsById.set(id, Number.isFinite(entry.sizeBytes) ? { revision: entry.revision, sizeBytes: Number(entry.sizeBytes) } : { revision: entry.revision });
          return;
        }
        if (entry && Number.isFinite(entry.sizeBytes)) sizeById.set(id, Number(entry.sizeBytes));
        try {
          const loc = persistence.locate(header);
          if (!loc || typeof loc.path !== "string" || !loc.path) return;
          const st = await stat4(loc.path);
          if (!st) return;
          if (typeof st.size === "number") sizeById.set(id, st.size);
          if (typeof st.mtimeMs === "number" && st.mtimeMs > 0) {
            mtimeById.set(id, Math.floor(st.mtimeMs));
            statsById.set(id, { mtimeMs: Math.floor(st.mtimeMs), size: typeof st.size === "number" ? st.size : void 0 });
          }
        } catch (e) {
        }
      }));
    }
    return { sizeById, mtimeById, statsById, hasActivityData: mtimeById.size > 0 };
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
      return normalizeTrashStore(JSON.parse(readFileSync4(TRASH_INDEX, "utf8")));
    } catch (e) {
      return normalizeTrashStore(null);
    }
  }
  async function readTrash() {
    return (await readTrashStore()).items;
  }
  async function writeTrashStore(store) {
    await mkdir7(TRASH_DIR, { recursive: true });
    const tmp = join9(TRASH_DIR, `.index-${process.pid}-${Date.now()}.tmp`);
    await writeFile7(tmp, JSON.stringify(normalizeTrashStore(store), null, 2), { encoding: "utf8", mode: 384 });
    await rename7(tmp, TRASH_INDEX);
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
  const pendingMoves = createPendingMoveStore();
  const autoArchive = createAutoArchiveStore();
  sweepStaleStateTemps([STATE_DIR, TRASH_DIR], {}).catch(() => {
  });
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
    let persistenceEntry = null;
    try {
      const entries = await persistence.listEntries();
      const found = entries.find((entry) => entry.id === sid) || null;
      persistenceEntry = found;
      header = found ? found.header : null;
      if (header) {
        const loc = persistence.locate(header);
        if (loc && typeof loc.path === "string") removedPath = loc.path;
        cwd = header.cwd || null;
        title = header.title || header.meta && header.meta.title || null;
      }
      if (!title) {
        try {
          const delStat = persistenceEntry && typeof persistenceEntry.revision === "string" && persistenceEntry.revision ? { revision: persistenceEntry.revision, sizeBytes: Number.isFinite(persistenceEntry.sizeBytes) ? Number(persistenceEntry.sizeBytes) : void 0 } : removedPath ? await stat4(removedPath).then((st) => ({ mtimeMs: st.mtimeMs, size: st.size })) : null;
          if (delStat) {
            const m = metaCache.get(sid, delStat) || (await hydrateFromPersist([sid], /* @__PURE__ */ new Map([[sid, delStat]]))).get(sid);
            if (m && m.title) title = String(m.title);
          }
        } catch (e) {
        }
        if (!title) {
          const at = authorityTitleCache.get(sid);
          if (at) title = String(at);
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
        // v3.6.2 #7：不再把 cwd/裸 id 冒充标题永久定格——存 null，预热解出后
        // backfillTrashTitles 补写；渲染端（t.title || t.sessionId）自然降级。
        sessionId: sid,
        title: title || null,
        cwd: cwd || null,
        header: header || null,
        originalPath: removedPath || null,
        sizeBytes: persistenceEntry && Number.isFinite(persistenceEntry.sizeBytes) ? persistenceEntry.sizeBytes : null,
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
  async function verifyTrashRestore(sid) {
    const sessions = ctx.get("sessions");
    if (sessions && sessions.get && sessions.get(sid)) {
      return { ok: true, workspaceGone: false, verified: true };
    }
    let exists = false;
    let header = null;
    try {
      const stat5 = await persistence.statSession(sid);
      if (stat5) {
        exists = true;
        header = stat5.header;
      }
    } catch (e) {
    }
    if (!exists) {
      try {
        const entries = await persistence.listEntries();
        const found = entries.find((entry2) => entry2.id === sid);
        if (found) {
          exists = true;
          header = found.header;
        }
      } catch (e) {
      }
    }
    if (!exists) {
      const store2 = await readTrashStore();
      if (store2.purgedSessionIds.map(String).includes(sid)) {
        return { ok: false, status: 410, code: "DSM_SESSION_PURGED", message: "\u8BE5\u4F1A\u8BDD\u5DF2\u5F7B\u5E95\u5220\u9664\uFF0C\u65E0\u6CD5\u4ECE\u56DE\u6536\u7AD9\u6062\u590D" };
      }
      return { ok: false, status: 409, code: "DSM_SESSION_MISSING", message: "\u5E95\u5C42\u4F1A\u8BDD\u5DF2\u4E0D\u5B58\u5728\uFF08\u53EF\u80FD\u88AB\u5916\u90E8\u5220\u9664\u6216\u91CD\u5EFA\uFF09\uFF0C\u65E0\u6CD5\u6062\u590D" };
    }
    let verified = false;
    const store = await readTrashStore();
    const entry = store.items.find((t) => String(t.sessionId) === sid);
    let originalPath = entry && typeof entry.originalPath === "string" ? entry.originalPath : null;
    if (!originalPath && header) {
      const loc = await persistence.locateVerified(header).catch(() => null);
      if (loc && typeof loc.path === "string") originalPath = loc.path;
    }
    if (originalPath) {
      const existsOnDisk = await stat4(originalPath).then(() => true).catch(() => false);
      if (!existsOnDisk) {
        return { ok: false, status: 409, code: "DSM_SESSION_LOG_MISSING", message: "\u56DE\u6536\u7AD9\u7D22\u5F15\u4ECD\u8BB0\u5F55\u8BE5\u4F1A\u8BDD\uFF0C\u4F46\u5176\u65E5\u5FD7\u6587\u4EF6\u5DF2\u6D88\u5931\uFF08\u53EF\u80FD\u88AB\u5916\u90E8\u79FB\u52A8\u6216\u5220\u9664\uFF09" };
      }
      verified = true;
    }
    let workspaceGone = false;
    const cwd = header && header.cwd || entry && entry.cwd || null;
    if (cwd) {
      try {
        workspaceGone = !w.list().some((ent) => ent.path === cwd);
      } catch (e) {
        workspaceGone = false;
      }
    }
    return { ok: true, workspaceGone, verified };
  }
  async function restoreFromTrash(sid) {
    requireSessionId(sid);
    requireCapability(capabilities, "restoreIndexedSession");
    let outcome = null;
    await mutateTrash(async (store) => {
      const entry = store.items.find((t) => String(t.sessionId) === sid);
      if (!entry) {
        if (store.purgedSessionIds.map(String).includes(sid)) {
          const error2 = new Error("\u8BE5\u4F1A\u8BDD\u5DF2\u5F7B\u5E95\u5220\u9664\uFF0C\u65E0\u6CD5\u4ECE\u56DE\u6536\u7AD9\u6062\u590D");
          error2.status = 410;
          error2.code = "DSM_SESSION_PURGED";
          throw error2;
        }
        const error = new Error("\u56DE\u6536\u7AD9\u4E2D\u627E\u4E0D\u5230\u8BE5\u4F1A\u8BDD\uFF08\u53EF\u80FD\u5DF2\u6062\u590D\u8FC7\uFF09");
        error.status = 404;
        error.code = "DSM_TRASH_NOT_FOUND";
        throw error;
      }
      const verification = await verifyTrashRestore(sid);
      if (!verification.ok) {
        const error = new Error(verification.message);
        error.status = verification.status;
        error.code = verification.code;
        throw error;
      }
      if (entry.wasArchived === false) await restoreOne(sid);
      store.items = store.items.filter((t) => String(t.sessionId) !== sid);
      store.purgedSessionIds = store.purgedSessionIds.filter((id) => id !== sid);
      outcome = { ok: true, restored: true, workspaceGone: verification.workspaceGone, verified: verification.verified };
    });
    return outcome || { ok: true, restored: true };
  }
  async function purgeFromTrash(sid) {
    requireSessionId(sid);
    requireCapability(capabilities, "purge");
    let purged = false;
    await mutateTrash(async (store) => {
      const entry = store.items.find((t) => String(t.sessionId) === sid);
      if (!entry) {
        const error = new Error("\u56DE\u6536\u7AD9\u4E2D\u627E\u4E0D\u5230\u8BE5\u4F1A\u8BDD");
        error.status = 404;
        throw error;
      }
      let target = null;
      let locatedHeader = null;
      try {
        const entries = await persistence.listEntries();
        const current = entries.find((entry2) => entry2.id === sid);
        locatedHeader = current ? current.header : null;
        const located = current ? await persistence.locateVerified(current.header) : null;
        if (located && typeof located.path === "string") target = located.path;
      } catch (e) {
      }
      if (!locatedHeader && typeof persistence.statSession === "function") {
        try {
          const snap = await persistence.statSession(sid);
          if (snap && snap.header) {
            locatedHeader = snap.header;
            const located = await persistence.locateVerified(snap.header);
            if (located && typeof located.path === "string") target = located.path;
          }
        } catch (e) {
        }
      }
      if (!target && typeof entry.originalPath === "string") target = entry.originalPath;
      if (!target) {
        const error = new Error("\u65E0\u6CD5\u786E\u8BA4\u8BE5\u4F1A\u8BDD\u7684\u7269\u7406\u65E5\u5FD7\u4F4D\u7F6E\uFF0C\u5DF2\u505C\u6B62\u6C38\u4E45\u5220\u9664");
        error.status = 409;
        throw error;
      }
      const targetOwnsSession = pathOwnsSession(target, sid);
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
      if (target && persistence.kind === "session-handle" && locatedHeader) {
        await purgeSessionArtifacts(sp, sid, locatedHeader);
      } else if (target) {
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
    try {
      await stars.removeIds([sid]);
    } catch (e) {
    }
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
    if (!capabilities.actions.purge.available) return 0;
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
    if (p.startsWith("~/")) p = join9(homedir4(), p.slice(2));
    if (!isAbsolute(p)) p = join9(homedir4(), p);
    let canonical = null;
    try {
      canonical = await realpath(p);
    } catch (e) {
      canonical = null;
    }
    if (canonical === null) {
      await mkdir7(p, { recursive: true });
      canonical = await realpath(p);
    }
    return { canonical, entity: await w.create(canonical, basename3(canonical) || "workspace") };
  }
  async function moveOne(sid, targetPath) {
    requireCapability(capabilities, "move");
    const activeId = getActiveSessionId(ctx);
    if (activeId != null && String(activeId) === String(sid)) {
      const error = new Error("\u4F1A\u8BDD\u6B63\u88AB DSH \u6253\u5F00\uFF0C\u6682\u65F6\u65E0\u6CD5\u79FB\u52A8\uFF1B\u8BF7\u91CD\u542F DSH \u540E\u518D\u8BD5\u3002");
      error.status = 409;
      error.code = "DSM_SESSION_BUSY";
      throw error;
    }
    const r = await persistence.readSession(sid, 0);
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
    const moveNotes = [];
    const live = ctx.get("sessions");
    const liveObj = live && live.get && live.get(sid);
    const isOpen = !!liveObj;
    const ALREADY_EXISTS_RE = /already exists in this backend/i;
    const relocateLog = async (header, newHeaderObj) => {
      const oldPath = locatePath(header);
      const newPath = locatePath(newHeaderObj);
      if (!oldPath || !newPath || oldPath === newPath) return false;
      const backupPath = `${oldPath}.move-backup-${Date.now()}`;
      const stagedPath = `${newPath}.move-stage-${process.pid}-${Date.now()}`;
      let destinationInstalled = false;
      try {
        await mkdir7(dirname4(newPath), { recursive: true });
        try {
          await stat4(newPath);
          throw new Error("\u79FB\u52A8\u5931\u8D25\uFF1A\u76EE\u6807\u4F4D\u7F6E\u5DF2\u5B58\u5728\u540C\u540D\u4F1A\u8BDD\u65E5\u5FD7");
        } catch (e) {
          if (e && e.code !== "ENOENT") throw e;
        }
        await rename7(oldPath, backupPath);
        const original = await readFile4(backupPath);
        const originalFrames = scanZstdFrames(original).frames;
        if (originalFrames.length === 0) throw new Error("\u79FB\u52A8\u524D\u6821\u9A8C\u5931\u8D25\uFF1A\u4F1A\u8BDD\u65E5\u5FD7\u6CA1\u6709\u5B8C\u6574 zstd \u5E27");
        const rewritten = rewriteFrame0CwdInMemory(original, canonical);
        const rewrittenFrames = scanZstdFrames(rewritten).frames;
        if (rewrittenFrames.length !== originalFrames.length) throw new Error("\u79FB\u52A8\u540E\u6821\u9A8C\u5931\u8D25\uFF1A\u4F1A\u8BDD\u65E5\u5FD7\u5E27\u6570\u53D1\u751F\u53D8\u5316");
        const originalTail = original.subarray(originalFrames[0].end);
        const rewrittenTail = rewritten.subarray(rewrittenFrames[0].end);
        if (!originalTail.equals(rewrittenTail)) throw new Error("\u79FB\u52A8\u540E\u6821\u9A8C\u5931\u8D25\uFF1A\u4F1A\u8BDD\u4E8B\u4EF6\u5185\u5BB9\u53D1\u751F\u53D8\u5316");
        await writeFile7(stagedPath, rewritten, { mode: 384 });
        await rename7(stagedPath, newPath);
        destinationInstalled = true;
        await unlink(backupPath);
        const keptInSource = await cleanupMovedSourceDir(dirname4(oldPath));
        if (keptInSource.length > 0) moveNotes.push(`\u6E90\u76EE\u5F55\u672A\u80FD\u6E05\u7406\u5E72\u51C0\uFF08\u6B8B\u7559 ${keptInSource.join("\u3001")}\uFF09\uFF0C\u82E5\u540E\u7EED\u79FB\u52A8\u62A5\u201Cduplicate\u201D\u8BF7\u624B\u52A8\u6E05\u7A7A\u8BE5\u76EE\u5F55\u3002`);
      } catch (e) {
        try {
          await unlink(stagedPath);
        } catch (_) {
        }
        if (destinationInstalled) {
          try {
            await unlink(newPath);
          } catch (_) {
          }
        }
        try {
          await rename7(backupPath, oldPath);
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
    const cleanupMovedSourceDir = async (dir) => {
      let entries = null;
      try {
        entries = await readdir4(dir);
      } catch (e) {
        return [];
      }
      try {
        await rm3(dir, { recursive: true, force: true });
      } catch (e) {
        return entries;
      }
      return [];
    };
    if (persistence.kind === "session-handle") {
      const stat1 = await persistence.statSession(sid);
      if (stat1 && stat1.revision) {
        const stat22 = await persistence.statSession(sid);
        if (stat22 && stat22.revision !== stat1.revision) {
          throw new Error("\u8BE5\u4F1A\u8BDD\u5728\u79FB\u52A8\u51C6\u5907\u671F\u95F4\u53D1\u751F\u4E86\u53D8\u5316\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002");
        }
      }
      try {
        const movedHandle = await moveSessionToCwd({ sp, sid, header: meta, canonical, events, inheritedEventCount: r.inheritedEventCount });
        if (movedHandle && Array.isArray(movedHandle.reclaimedSiblings) && movedHandle.reclaimedSiblings.length > 0) {
          moveNotes.push(`\u5DF2\u987A\u5E26\u56DE\u6536 ${movedHandle.reclaimedSiblings.length} \u5904\u88AB\u53D6\u4EE3\u7684\u65E7\u4EE3\u65E5\u5FD7\u526F\u672C\uFF08\u5386\u53F2\u79FB\u52A8\u6B8B\u7559\uFF09\uFF0C\u907F\u514D\u540C\u4E00\u4F1A\u8BDD\u5728\u591A\u76EE\u5F55\u91CD\u590D\u3002`);
        }
        if (movedHandle && movedHandle.sourceCleanup && movedHandle.sourceCleanup.cleaned === false) {
          moveNotes.push(`\u6E90\u76EE\u5F55\u672A\u80FD\u6E05\u7406\u5E72\u51C0\uFF08\u6B8B\u7559 ${movedHandle.sourceCleanup.leftover.join("\u3001")}\uFF09\uFF0C\u82E5\u540E\u7EED\u79FB\u52A8\u62A5\u201Cduplicate\u201D\u8BF7\u624B\u52A8\u6E05\u7A7A\u8BE5\u76EE\u5F55\u3002`);
        }
      } catch (e) {
        if (e && e.status) throw e;
        throw new Error("\u79FB\u52A8\u4F1A\u8BDD\u65E5\u5FD7\u5931\u8D25\uFF1A" + String(e && e.message || e));
      }
    } else if (isOpen) {
      if (!await relocateLog(meta, newHeader)) throw new Error("\u79FB\u52A8\u5931\u8D25\uFF1A\u65E0\u6CD5\u786E\u8BA4\u4F1A\u8BDD\u65E5\u5FD7\u5DF2\u8FC1\u79FB\u5230\u76EE\u6807\u5DE5\u4F5C\u533A");
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
        if (!await relocateLog(meta, newHeader)) throw new Error("\u79FB\u52A8\u5931\u8D25\uFF1A\u65E0\u6CD5\u786E\u8BA4\u4F1A\u8BDD\u65E5\u5FD7\u5DF2\u8FC1\u79FB\u5230\u76EE\u6807\u5DE5\u4F5C\u533A");
      } else {
        const backupPath = oldPath ? `${oldPath}.move-backup-${Date.now()}` : null;
        if (backupPath) {
          try {
            await rename7(oldPath, backupPath);
          } catch (e) {
            if (e && e.code !== "ENOENT") throw new Error("\u79FB\u52A8\u5931\u8D25\uFF1A\u65E0\u6CD5\u5907\u4EFD\u65E7\u7684\u4F1A\u8BDD\u65E5\u5FD7");
          }
        }
        const restore = async () => {
          if (backupPath) {
            try {
              await rename7(backupPath, oldPath);
            } catch (_) {
            }
          }
        };
        try {
          await sp.create(newHeader);
          await sp.append(sid, events);
          const check = await persistence.readSession(sid, 0);
          if (!check || !check.meta || check.meta.cwd !== canonical) {
            throw new Error("\u79FB\u52A8\u540E\u6821\u9A8C\u5931\u8D25\uFF1A\u4F1A\u8BDD\u5DE5\u4F5C\u76EE\u5F55\u672A\u6B63\u786E\u66F4\u65B0");
          }
          if (backupPath) {
            try {
              await unlink(backupPath);
            } catch (e) {
            }
          }
          if (oldPath) {
            const keptInSource = await cleanupMovedSourceDir(dirname4(oldPath));
            if (keptInSource.length > 0) moveNotes.push(`\u6E90\u76EE\u5F55\u672A\u80FD\u6E05\u7406\u5E72\u51C0\uFF08\u6B8B\u7559 ${keptInSource.join("\u3001")}\uFF09\uFF0C\u82E5\u540E\u7EED\u79FB\u52A8\u62A5\u201Cduplicate\u201D\u8BF7\u624B\u52A8\u6E05\u7A7A\u8BE5\u76EE\u5F55\u3002`);
          }
        } catch (e) {
          if (ALREADY_EXISTS_RE.test(String(e && e.message || e))) {
            await restore();
            if (!await relocateLog(meta, newHeader)) throw new Error("\u79FB\u52A8\u5931\u8D25\uFF1A\u65E0\u6CD5\u786E\u8BA4\u4F1A\u8BDD\u65E5\u5FD7\u5DF2\u8FC1\u79FB\u5230\u76EE\u6807\u5DE5\u4F5C\u533A");
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
      workspacePath: canonical,
      ...moveNotes.length > 0 ? { notes: moveNotes } : {}
    };
  }
  const QUEUE_NOTE = "\u5DF2\u6392\u961F\uFF1A\u8BE5\u4F1A\u8BDD\u6B63\u88AB DSH \u6253\u5F00\uFF08\u5199\u6240\u6709\u6743\u53EA\u5728 DSH \u9000\u51FA\u65F6\u91CA\u653E\uFF09\u3002\u91CD\u542F DSH \u65F6\u4F1A\u81EA\u52A8\u5B8C\u6210\uFF0C\u8BF7\u5148\u522B\u6253\u5F00\u5B83\u3002";
  function isBusyError(e) {
    if (!e) return false;
    if (e.code === "DSM_SESSION_BUSY") return true;
    const text = String(e && e.message || e);
    return /正被 DSH 打开|already owned/i.test(text);
  }
  async function moveOrQueue(sid, targetPath) {
    try {
      return await moveOne(sid, targetPath);
    } catch (e) {
      if (!isBusyError(e)) throw e;
      await pendingMoves.queue(sid, targetPath);
      return { ok: true, moved: false, queued: true, notes: [QUEUE_NOTE] };
    }
  }
  const BOOT_WARMUP_MS = 3e4;
  const bootedAt = Date.now();
  let queueRunning = false;
  async function runPendingMoves(reason) {
    if (queueRunning) return { ran: false, moved: 0, kept: 0 };
    queueRunning = true;
    let moved = 0;
    const notes = [];
    try {
      const items = await pendingMoves.list();
      for (const item of items) {
        try {
          await moveOne(item.sessionId, item.targetPath);
          await pendingMoves.remove([item.sessionId]);
          metaCache.invalidate(item.sessionId);
          moved++;
          notes.push(`\u6392\u961F\u4E2D\u7684\u79FB\u52A8\u5DF2\u5B8C\u6210\uFF1A${String(item.sessionId).slice(0, 18)}\u2026`);
        } catch (e) {
          if (isBusyError(e)) continue;
          if (Date.now() - bootedAt < BOOT_WARMUP_MS) continue;
          const bumped = await pendingMoves.bumpAttempts(item.sessionId);
          if (bumped && bumped.dropped) notes.push(`\u6392\u961F\u4E2D\u7684\u79FB\u52A8\u591A\u6B21\u5931\u8D25\u5DF2\u653E\u5F03\uFF1A${String(item.sessionId).slice(0, 18)}\u2026\uFF08${String(e && e.message || e)}\uFF09`);
        }
      }
      if (moved > 0) {
        try {
          await reindexRegistry();
        } catch (e) {
        }
      }
    } finally {
      queueRunning = false;
    }
    if (notes.length > 0) {
      try {
        for (const n of notes) console.warn("[dsh-sessions-manager] " + n);
      } catch (e) {
      }
    }
    void reason;
    return { ran: true, moved, kept: (await pendingMoves.list()).length };
  }
  const queueEffect = typeof ctx.effect === "function" ? ctx.effect.bind(ctx) : ((fn) => {
    fn();
  });
  if (typeof ctx.on === "function") {
    queueEffect(() => ctx.on("session/disposed", (session) => {
      const id = session && session.id != null ? String(session.id) : null;
      if (!id) return;
      pendingMoves.has(id).then((queued) => {
        if (!queued) return;
        const t = setTimeout(() => {
          runPendingMoves("session-disposed").catch(() => {
          });
        }, 500);
        if (t && typeof t.unref === "function") t.unref();
      }).catch(() => {
      });
    }));
  }
  queueEffect(() => {
    const timers = [0, 1e3, 3e3, 6e3, 12e3, 3e4].map((ms) => {
      const t = setTimeout(() => {
        runPendingMoves(ms === 0 ? "startup" : `startup+${ms}`).catch(() => {
        });
      }, ms);
      if (t && typeof t.unref === "function") t.unref();
      return t;
    });
    const tickTimer = setInterval(() => {
      pendingMoves.list().then((items) => {
        if (items.length > 0) return runPendingMoves("tick");
      }).catch(() => {
      });
    }, 12e4);
    if (tickTimer && typeof tickTimer.unref === "function") tickTimer.unref();
    return () => {
      for (const t of timers) clearTimeout(t);
      clearInterval(tickTimer);
    };
  });
  async function reindexRegistry() {
    const reg = w;
    if (!reg || typeof reg.replaceHeaderIndex !== "function") return false;
    let entries = null;
    try {
      entries = await persistence.listEntries();
    } catch (e) {
      entries = null;
    }
    if (!entries || !Array.isArray(entries)) return false;
    await reg.replaceHeaderIndex(entries.map((entry) => entry.header));
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
  const warmHasApi = typeof sq.readTitleSnapshots === "function" || typeof sq.readTitleSnapshot === "function";
  async function projectTitlesStatus(ids) {
    const out = /* @__PURE__ */ new Map();
    const markAll = (resolved) => {
      for (const id of ids) out.set(String(id), { resolved, snapshot: null });
    };
    if (!ids || !ids.length) return out;
    if (!warmHasApi) {
      markAll(false);
      return out;
    }
    if (typeof sq.readTitleSnapshots === "function") {
      let results = null;
      try {
        results = await sq.readTitleSnapshots(ids);
      } catch (e) {
        results = null;
      }
      if (Array.isArray(results)) {
        results.forEach((result, index) => {
          const id = String(ids[index]);
          if (result && result.status === "fulfilled") out.set(id, { resolved: true, snapshot: unwrapSnapshot(result) });
          else if (result && result.status === "rejected") out.set(id, { resolved: false, snapshot: null });
          else if (result) out.set(id, { resolved: true, snapshot: unwrapSnapshot(result) });
          else out.set(id, { resolved: false, snapshot: null });
        });
        for (const id of ids) if (!out.has(String(id))) out.set(String(id), { resolved: false, snapshot: null });
        return out;
      }
    }
    if (typeof sq.readTitleSnapshot === "function") {
      for (const raw of ids) {
        const id = String(raw);
        try {
          const r = await sq.readTitleSnapshot(id);
          if (r && r.status === "rejected") out.set(id, { resolved: false, snapshot: null });
          else out.set(id, { resolved: true, snapshot: unwrapSnapshot(r) });
        } catch (e) {
          out.set(id, { resolved: false, snapshot: null });
        }
      }
      return out;
    }
    markAll(false);
    return out;
  }
  async function allSessionItemsDetailed(opts = {}) {
    let entries = [];
    let headersOk = false;
    try {
      entries = await persistence.listEntries();
      headersOk = Array.isArray(entries);
      if (!headersOk) entries = [];
    } catch (e) {
      entries = [];
    }
    const entryById = new Map(entries.map((entry) => [entry.id, entry]));
    let live = ctx.get("sessions");
    const ids = entries.map((entry) => entry.id);
    if (live) {
      try {
        live.list().forEach((s) => {
          const sid = String(s.id);
          if (!ids.includes(sid)) ids.push(sid);
        });
      } catch (e) {
      }
    }
    let hiddenIds = /* @__PURE__ */ new Set();
    try {
      const store = await readTrashStore();
      const present = new Set(ids);
      hiddenIds = /* @__PURE__ */ new Set([
        ...store.items.map((t) => String(t.sessionId)),
        ...store.purgedSessionIds.map(String).filter((id) => !present.has(id))
      ]);
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
    const usage = await collectUsage(entries);
    const statsById = new Map(visibleIds.map((id) => [
      id,
      usage.statsById && usage.statsById.get(id) || { mtimeMs: usage.mtimeById.get(id), size: usage.sizeById.get(id) }
    ]));
    const { cached, missing } = metaCache.partition(visibleIds, statsById);
    const persisted = await hydrateFromPersist(missing, statsById);
    for (const [id, meta] of persisted) {
      const entry = entryById.get(id);
      const header = entry && entry.header ? entry.header : null;
      metaCache.set(id, statsById.get(id), {
        title: meta.title,
        cwd: header && typeof header.cwd === "string" && header.cwd ? header.cwd : meta.cwd,
        createdAt: header && header.createdAt != null ? header.createdAt : meta.createdAt
      });
    }
    const stillMissing = missing.filter((id) => !persisted.has(id));
    if (stillMissing.length) enqueueWarm(stillMissing, statsById, entryById);
    const items = [];
    for (const id of visibleIds) {
      let meta = metaCache.get(id, statsById.get(id)) || persisted.get(id) || null;
      if (!meta) {
        meta = { title: null, cwd: null, createdAt: null };
        const entry = entryById.get(id);
        const header = entry && entry.header ? entry.header : null;
        if (header) {
          if (typeof header.cwd === "string") meta.cwd = header.cwd;
          if (header.createdAt != null) meta.createdAt = header.createdAt;
        }
      }
      const it = buildItem(id, meta, usage, !!(opts && opts.usage));
      items.push({ ...it, archived: currentArchived.has(it.sessionId) });
    }
    if (opts && opts.onlyArchived) {
      const archivedItems = [];
      for (const it of items) {
        if (!it.archived) continue;
        const { archived: _drop, ...rest } = it;
        archivedItems.push(rest);
      }
      return { items: archivedItems, usage };
    }
    let starredSet = /* @__PURE__ */ new Set();
    try {
      starredSet = new Set((await stars.read()).starredSessionIds);
    } catch (e) {
    }
    for (const it of items) it.starred = starredSet.has(String(it.sessionId));
    if (headersOk) await gcStars(ids);
    return { items, usage };
  }
  async function allSessionItems(opts = {}) {
    return (await allSessionItemsDetailed(opts)).items;
  }
  async function buildStorage(opts = {}) {
    const items = await allSessionItems({ usage: true });
    const raw = Number(opts && opts.topN);
    const topN = Number.isInteger(raw) && raw > 0 ? Math.min(raw, MAX_STORAGE_TOP) : 10;
    return aggregateStorage(items, { topN });
  }
  async function autoArchiveSweep(opts = {}) {
    const store = await autoArchive.read();
    const days = store.settings.inactiveDays;
    if (!days) return { ok: true, skipped: "disabled", archived: 0 };
    const now = Date.now();
    if (!(opts && opts.force) && autoArchive.isFresh(store, now)) {
      return { ok: true, skipped: "throttled", archived: 0, lastRunAt: store.lastRunAt, lastArchivedCount: store.lastArchivedCount };
    }
    const { items, usage } = await allSessionItemsDetailed({ usage: true });
    if (!usage.hasActivityData) {
      return {
        ok: true,
        skipped: "no-activity-data",
        archived: 0,
        note: "\u5F53\u524D DSH \u7248\u672C\u672A\u63D0\u4F9B\u53EF\u9760\u7684\u6700\u540E\u6D3B\u8DC3\u65F6\u95F4\uFF0C\u81EA\u52A8\u5F52\u6863\u5DF2\u8DF3\u8FC7\uFF1B\u4E0D\u4F1A\u57FA\u4E8E\u731C\u6D4B\u5F52\u6863\u4EFB\u4F55\u4F1A\u8BDD\u3002"
      };
    }
    const candidates = pickInactiveCandidates(items, {
      inactiveDays: days,
      skipStarred: store.settings.skipStarred,
      activeSessionId: getActiveSessionId(ctx),
      now
    });
    let archived = 0;
    const failed = [];
    for (const sid of candidates) {
      try {
        const result = await archiveOne(sid);
        if (result && result.archived) archived++;
      } catch (e) {
        failed.push({ sessionId: sid, error: String(e && e.message || e) });
      }
    }
    await autoArchive.recordRun(archived, now);
    return { ok: true, archived, candidates: candidates.length, failed, lastRunAt: now };
  }
  async function sidebarAuthority() {
    const ids = [];
    let entries = [];
    try {
      entries = await persistence.listEntries();
    } catch (e) {
      entries = [];
    }
    if (!Array.isArray(entries)) entries = [];
    for (const entry of entries) ids.push(entry.id);
    const sessions = ctx.get("sessions");
    try {
      if (sessions) sessions.list().forEach((session) => {
        const sid = String(session.id);
        if (!ids.includes(sid)) ids.push(sid);
      });
    } catch (e) {
    }
    const store = await readTrashStore();
    const present = new Set(ids);
    const activeTombstones = store.purgedSessionIds.map(String).filter((id) => !present.has(id));
    if (ids.length) {
      const usage = await collectUsage(entries);
      const entryById = new Map(entries.map((entry) => [entry.id, entry]));
      const statsById = new Map(ids.map((id) => [
        id,
        usage.statsById && usage.statsById.get(id) || { mtimeMs: usage.mtimeById.get(id), size: usage.sizeById.get(id) }
      ]));
      const { cached, missing } = metaCache.partition(ids, statsById);
      const persisted = await hydrateFromPersist(missing, statsById);
      for (const [id, meta] of persisted) {
        const entry = entryById.get(id);
        const header = entry && entry.header ? entry.header : null;
        metaCache.set(id, statsById.get(id), {
          title: meta.title,
          cwd: header && typeof header.cwd === "string" && header.cwd ? header.cwd : meta.cwd,
          createdAt: header && header.createdAt != null ? header.createdAt : meta.createdAt
        });
      }
      const rest = missing.filter((id) => !persisted.has(id));
      if (rest.length) enqueueWarm(rest, statsById, entryById);
      for (const id of ids) {
        const meta = metaCache.get(id, statsById.get(id)) || persisted.get(id) || null;
        if (meta && meta.title) authorityTitleCache.set(id, String(meta.title));
      }
    }
    const lineage = {};
    const refineWanted = [];
    let emptyStore = null;
    try {
      emptyStore = await emptyIndex.entries();
    } catch (e) {
      emptyStore = null;
    }
    const nowTs = Date.now();
    for (const entry of entries) {
      const id = String(entry.id);
      const size = entry && Number.isFinite(entry.sizeBytes) ? entry.sizeBytes : null;
      const candidate = emptyScanCandidate(size);
      let verdict = null;
      if (!candidate) {
        if (size !== null) verdict = false;
      } else {
        const mem = emptyScanCache.get(id);
        if (mem && mem.sizeBytes === size) {
          verdict = !!mem.empty;
        } else {
          const rec = emptyStore && emptyStore[id];
          if (rec && rec.fingerprint === `sz:${size}` && nowTs - (rec.updatedAt || 0) <= EMPTY_VERDICT_TTL_MS) {
            verdict = rec.empty === 1;
            emptyScanCache.set(id, { sizeBytes: size, empty: verdict });
          }
        }
        if (verdict === null && refineCapable() && !refineQueue.has(id)) refineWanted.push({ id, sizeBytes: size });
      }
      const info = classifyLineage(entry.header);
      if (info) lineage[id] = { origin: info.origin, parentSession: info.parentSession, delegationDepth: info.delegationDepth, empty: verdict };
      else if (verdict === true) lineage[id] = { origin: null, parentSession: null, delegationDepth: 0, empty: true };
    }
    enqueueRefine(refineWanted);
    for (const key of emptyScanCache.keys()) {
      const rec = emptyScanCache.get(key);
      if (!rec || !emptyScanCandidate(rec.sizeBytes)) emptyScanCache.delete(key);
    }
    return {
      titles: Object.fromEntries(authorityTitleCache),
      trashedSessionIds: store.items.map((item) => String(item.sessionId)),
      purgedSessionIds: activeTombstones,
      lineage,
      // v3.6.2：还有预热/退避重试在途 → client 缩短轮询节拍，预热一完成就把
      // 补齐的标题送回（含面板自动刷新）。无预热 API 时恒 false，绝不假忙。
      warmPending: warmPendingNow(),
      // T1：空白精判后台队列是否还有活。无精判能力（旧 runtime 无 inspect 通道）
      // 时恒 false——永久 busy 会让 client 疯轮询，这是唯一现实的假忙陷阱。
      refinePending: refinePendingNow()
    };
  }
  const emptyScanCache = /* @__PURE__ */ new Map();
  const REFINE_CHUNK = 2;
  const refineQueue = /* @__PURE__ */ new Map();
  let refineRunning = false;
  let refineKickTimer = null;
  function refineCapable() {
    return !!persistence && typeof persistence.inspectSession === "function";
  }
  function refinePendingNow() {
    return !!(refineRunning || refineQueue.size);
  }
  function scheduleRefine() {
    if (refineKickTimer || refineRunning || !refineQueue.size) return;
    refineKickTimer = setTimeout(() => {
      refineKickTimer = null;
      runRefine();
    }, 25);
    if (typeof refineKickTimer.unref === "function") refineKickTimer.unref();
  }
  function enqueueRefine(items) {
    if (!items || !items.length || !refineCapable()) return;
    for (const { id, sizeBytes } of items) {
      if (emptyScanCache.has(id) && emptyScanCache.get(id).sizeBytes === sizeBytes) continue;
      refineQueue.set(id, { sizeBytes });
    }
    scheduleRefine();
  }
  async function runRefine() {
    if (refineRunning) return;
    refineRunning = true;
    try {
      while (refineQueue.size) {
        const batch = [...refineQueue.entries()].slice(0, REFINE_CHUNK);
        for (const [id] of batch) refineQueue.delete(id);
        const persistBatch = {};
        for (const [id, desc] of batch) {
          try {
            const types = [];
            await persistence.inspectSession(id, { onEvents: (b) => {
              for (const ev of b || []) if (types.length < 64) types.push(ev && ev.type);
            } });
            const isEmpty = isEmptyEventTypes(types);
            emptyScanCache.set(id, { sizeBytes: desc.sizeBytes, empty: isEmpty });
            persistBatch[id] = { empty: isEmpty ? 1 : 0, fingerprint: `sz:${desc.sizeBytes}`, updatedAt: Date.now() };
          } catch (e) {
            emptyScanCache.set(id, { sizeBytes: desc.sizeBytes, empty: false });
          }
        }
        if (Object.keys(persistBatch).length) {
          try {
            await emptyIndex.merge(persistBatch);
          } catch (e) {
          }
        }
        await new Promise((resolve) => setImmediate(resolve));
      }
    } finally {
      refineRunning = false;
      if (refineQueue.size) scheduleRefine();
    }
  }
  async function buildDetails(sid, signal) {
    const sessions = ctx.get("sessions");
    const live = sessions && sessions.get(sid);
    let meta = null;
    let lastTime = 0;
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
    const absorb = (ev) => {
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
    };
    if (live !== void 0) {
      meta = live && live.header || null;
      try {
        (Array.isArray(live.events) ? [...live.events] : []).forEach(absorb);
      } catch (e) {
      }
    } else {
      const summary = await persistence.inspectSession(sid, { signal, onEvents: (batch) => {
        for (const ev of batch) absorb(ev);
      } });
      if (!summary || !summary.meta) throw new Error("\u627E\u4E0D\u5230\u8BE5\u4F1A\u8BDD\u7684\u8BB0\u5F55\uFF08\u4F1A\u8BDD\u4E0D\u5B58\u5728\uFF09");
      meta = summary.meta;
    }
    stats.turns = turnSeen.size;
    stats.steps = stepSeen.size;
    let sizeBytes = null;
    if (live === void 0) {
      try {
        const stat5 = await persistence.statSession(sid);
        if (stat5 && Number.isFinite(stat5.sizeBytes)) sizeBytes = stat5.sizeBytes;
      } catch (e) {
      }
    }
    if (sizeBytes === null) {
      try {
        const loc = persistence.locate(meta);
        if (loc && typeof loc.path === "string" && loc.path) {
          const st = await stat4(loc.path);
          if (st && typeof st.size === "number") sizeBytes = st.size;
        }
      } catch (e) {
        sizeBytes = null;
      }
    }
    if (stats.fetches.length > MAX_FETCHES) stats.fetches = stats.fetches.slice(0, MAX_FETCHES);
    const fileEntries = [...fileSet.entries()].slice(0, MAX_FILES * 2);
    const exists = await Promise.all(fileEntries.map(([p]) => stat4(p).then(() => true).catch(() => false)));
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
        for (const entry of await persistence.listEntries()) {
          const h = entry.header;
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
      updatedAt: Math.max(lastTime || 0, meta && typeof meta.createdAt === "number" ? meta.createdAt : 0) || null,
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
      path: "/archived-sessions/capabilities",
      handler: async (req, res) => json(res, { ...capabilities, buildStamp: BUILD_STAMP })
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
            const entries = await persistence.listEntries();
            materialized = new Set(entries.map((entry) => entry.id));
          } catch (e) {
          }
          const trashStore = await readTrashStore();
          const present = /* @__PURE__ */ new Set([
            ...materialized,
            ...ids.map(String),
            ...live && typeof live.list === "function" ? live.list().map((s) => String(s.id)) : []
          ]);
          const tombstones = trashStore.purgedSessionIds.map(String).filter((id) => !present.has(id));
          const hidden = /* @__PURE__ */ new Set([...trashStore.items.map((item) => String(item.sessionId)), ...tombstones]);
          const idStrs = ids.map(String).filter((id) => !hidden.has(id) && (materialized.has(id) || live && live.get(id)));
          wsByPath = {};
          try {
            for (const ent of w.list()) wsByPath[ent.path] = ent;
          } catch (e) {
            wsByPath = {};
          }
          const wanted = new Set(idStrs);
          const detailed = await allSessionItemsDetailed();
          const items = detailed.items.filter((it) => wanted.has(String(it.sessionId)) && it.archived);
          for (const it of items) delete it.archived;
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
              results.push({ sessionId: sid, ok: false, code: e && e.code, error: String(e && e.message || e) });
            }
          }
          json(res, { ok: true, restored: results.filter((r) => r.ok).length, results });
        } catch (e) {
          json(res, { ok: false, code: e && e.code, error: String(e && e.message || e) }, errorStatus(e));
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
          const out = await deleteOne(sid);
          metaCache.invalidate(sid);
          json(res, out);
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
              metaCache.invalidate(sid);
            } catch (e) {
              results.push({ sessionId: sid, ok: false, error: String(e && e.message || e) });
            }
          }
          json(res, { ok: true, deleted: results.filter((r) => r.ok).length, results });
        } catch (e) {
          json(res, { ok: false, code: e && e.code, error: String(e && e.message || e) }, errorStatus(e));
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
            if (typeof item.originalPath !== "string" || !item.originalPath) {
              return { sessionId: item.sessionId, status: "unverified", originalPath: null };
            }
            const exists = await stat4(item.originalPath).then(() => true).catch(() => false);
            return { sessionId: item.sessionId, status: exists ? "ok" : "missing", originalPath: item.originalPath };
          }));
          json(res, {
            ok: true,
            healthy: results.filter((r) => r.status === "ok").length,
            missing: results.filter((r) => r.status === "missing").length,
            unverified: results.filter((r) => r.status === "unverified").length,
            results
          });
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
          const out = await restoreFromTrash(sid);
          metaCache.invalidate(sid);
          json(res, out);
        } catch (e) {
          json(res, { ok: false, code: e && e.code, error: String(e && e.message || e) }, errorStatus(e));
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
          const out = await purgeFromTrash(sid);
          metaCache.invalidate(sid);
          try {
            await titleIndex.remove([sid]);
          } catch (e) {
          }
          try {
            await emptyIndex.remove([sid]);
          } catch (e) {
          }
          json(res, out);
        } catch (e) {
          json(res, { ok: false, code: e && e.code, error: String(e && e.message || e) }, errorStatus(e));
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
              metaCache.invalidate(sid);
              await titleIndex.remove([sid]).catch(() => {
              });
              await emptyIndex.remove([sid]).catch(() => {
              });
            } catch (e) {
              results.push({ sessionId: sid, ok: false, error: String(e && e.message || e) });
            }
          }
          json(res, { ok: true, purged: results.filter((r) => r.ok).length, results });
        } catch (e) {
          json(res, { ok: false, code: e && e.code, error: String(e && e.message || e) }, errorStatus(e));
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/sessions",
      handler: async (req, res) => {
        try {
          json(res, { items: await allSessionItems(), warmPending: warmPendingNow() });
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
    const exportLimiter = createLimiter(2);
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/export-md",
      handler: async (req, res) => {
        try {
          const url = new URL(req.url, "http://localhost");
          const sid = url.searchParams.get("sessionId");
          requireSessionId(sid);
          const ac = new AbortController();
          res.on("close", () => {
            if (!res.writableEnded) ac.abort();
          });
          const md = await exportLimiter(async () => {
            const builder = createSessionMarkdownBuilder({ id: sid });
            const summary = await persistence.inspectSession(sid, {
              signal: ac.signal,
              onEvents: (batch) => builder.addEvents(batch)
            });
            if (!summary || !summary.meta) {
              const error = new Error("\u65E0\u6CD5\u8BFB\u53D6\u8BE5\u4F1A\u8BDD\u7684\u65E5\u5FD7");
              error.status = 404;
              throw error;
            }
            return builder.finish({ ...summary.meta, id: sid });
          });
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
      path: "/archived-sessions/lineage-tree",
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req);
          const rootId = body && typeof body.sessionId === "string" ? body.sessionId : "";
          if (!rootId || !isSafeSessionId2(rootId)) return json(res, { error: "missing sessionId" }, 400);
          const headerById = /* @__PURE__ */ new Map();
          const sizeById = /* @__PURE__ */ new Map();
          const trashedIds = /* @__PURE__ */ new Set();
          let purgedIds = [];
          const persistedIds = /* @__PURE__ */ new Set();
          try {
            const store = await readTrashStore();
            for (const item of store.items) trashedIds.add(String(item.sessionId));
            purgedIds = store.purgedSessionIds.map(String);
          } catch (e) {
          }
          const addHeader = (h, sizeBytes) => {
            if (!h || h.id == null) return;
            const id = String(h.id);
            if (headerById.has(id) || trashedIds.has(id)) return;
            headerById.set(id, {
              parentSession: h.parentSession != null ? String(h.parentSession) : null,
              subagent: h.origin === "subagent",
              delegationDepth: Number.isFinite(h.delegationDepth) ? h.delegationDepth : null,
              createdAt: typeof h.createdAt === "number" ? h.createdAt : null
            });
            if (Number.isFinite(sizeBytes)) sizeById.set(id, sizeBytes);
          };
          const lineageStats = /* @__PURE__ */ new Map();
          const lineageHeaders = /* @__PURE__ */ new Map();
          try {
            for (const entry of await persistence.listEntries()) {
              addHeader(entry.header, entry.sizeBytes);
              const eid = entry && entry.id != null ? String(entry.id) : null;
              if (eid) {
                lineageHeaders.set(eid, { header: entry && entry.header || null });
                if (entry && typeof entry.revision === "string" && entry.revision) {
                  lineageStats.set(eid, Number.isFinite(entry.sizeBytes) ? { revision: entry.revision, sizeBytes: Number(entry.sizeBytes) } : { revision: entry.revision });
                }
              }
              if (entry && entry.id != null) persistedIds.add(String(entry.id));
            }
          } catch (e) {
          }
          const liveIds = /* @__PURE__ */ new Set();
          const live = ctx.get("sessions");
          try {
            if (live && typeof live.list === "function") {
              live.list().forEach((s) => {
                liveIds.add(String(s.id));
                addHeader(s.header, void 0);
              });
            }
          } catch (e) {
          }
          for (const id of purgedIds) {
            if (!persistedIds.has(id)) headerById.delete(id);
          }
          const kidsOf = /* @__PURE__ */ new Map();
          for (const [id, h] of headerById) {
            if (!h.subagent || !h.parentSession) continue;
            if (!kidsOf.has(h.parentSession)) kidsOf.set(h.parentSession, []);
            kidsOf.get(h.parentSession).push(id);
          }
          const MAX_NODES = 500;
          let nodeCount = 0;
          const build = (id, depth, visited) => {
            nodeCount++;
            const h = headerById.get(id) || {};
            const childVisited = new Set(visited);
            childVisited.add(id);
            const kidIds = nodeCount >= MAX_NODES ? [] : (kidsOf.get(id) || []).filter((k) => !childVisited.has(k));
            return {
              sessionId: id,
              parentSession: h.parentSession || null,
              delegationDepth: h.delegationDepth,
              depth,
              createdAt: h.createdAt || null,
              sizeBytes: sizeById.has(id) ? sizeById.get(id) : null,
              live: liveIds.has(id),
              title: null,
              children: kidIds.map((k) => build(k, depth + 1, childVisited))
            };
          };
          const nodes = (kidsOf.get(rootId) || []).map((k) => build(k, 1, /* @__PURE__ */ new Set([rootId])));
          const allIds = [rootId];
          const walk = (n) => {
            allIds.push(n.sessionId);
            n.children.forEach(walk);
          };
          nodes.forEach(walk);
          const lineageIds = allIds.map(String);
          const { cached: lineageCached, missing: lineageMissing } = metaCache.partition(lineageIds, lineageStats);
          const lineagePersisted = await hydrateFromPersist(lineageMissing, lineageStats);
          for (const [id, meta] of lineagePersisted) metaCache.set(id, lineageStats.get(id), meta);
          const lineageRest = lineageMissing.filter((id) => !lineagePersisted.has(id));
          if (lineageRest.length) enqueueWarm(lineageRest, lineageStats, lineageHeaders);
          const truncateTitle = (t) => t ? t.length > MAX_TITLE ? t.slice(0, MAX_TITLE) + "\u2026" : t : null;
          const titleOf = (id) => {
            const key = String(id);
            const m = lineageCached.get(key) || lineagePersisted.get(key);
            return truncateTitle(m && m.title || authorityTitleCache.get(key) || null);
          };
          const fill = (n) => {
            n.title = titleOf(n.sessionId);
            n.children.forEach(fill);
          };
          nodes.forEach(fill);
          json(res, { parent: { sessionId: rootId, title: titleOf(rootId) }, nodes });
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
          const moved = await moveOrQueue(sid, target);
          if (moved.queued) return json(res, { sessionId: sid, ...moved });
          metaCache.invalidate(sid);
          try {
            await reindexRegistry();
          } catch (e) {
          }
          json(res, { sessionId: sid, ...moved });
        } catch (e) {
          json(res, { ok: false, code: e && e.code, error: String(e && e.message || e) }, errorStatus(e));
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/move-many",
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req);
          const ids = Array.isArray(body && body.sessionIds) ? [...new Set(body.sessionIds.filter((x) => typeof x === "string" && x))] : [];
          const target = body && typeof body.targetPath === "string" ? body.targetPath : null;
          if (!ids.length) return json(res, { ok: false, error: "missing sessionIds" }, 400);
          if (!target) return json(res, { ok: false, error: "missing targetPath" }, 400);
          let moved = 0;
          const failed = [];
          const queued = [];
          for (const sid of ids) {
            try {
              const r = await moveOrQueue(sid, target);
              if (r && r.queued) {
                queued.push(sid);
                continue;
              }
              metaCache.invalidate(sid);
              moved++;
            } catch (e) {
              const err = e && e.code ? { sessionId: sid, error: String(e && e.message || e), code: e.code } : { sessionId: sid, error: String(e && e.message || e) };
              failed.push(err);
            }
          }
          try {
            await reindexRegistry();
          } catch (e) {
          }
          json(res, {
            moved,
            failed,
            ...queued.length > 0 ? { queued, notes: [`${queued.length} \u4E2A\u4F1A\u8BDD\u5DF2\u6392\u961F\uFF08\u6B63\u88AB DSH \u6253\u5F00\uFF09\uFF0C\u91CD\u542F DSH \u540E\u4F1A\u81EA\u52A8\u5B8C\u6210\uFF1B\u91CD\u542F\u540E\u8BF7\u5148\u522B\u6253\u5F00\u5B83\u4EEC\u3002`] } : {}
          });
        } catch (e) {
          json(res, { ok: false, code: e && e.code, error: String(e && e.message || e) }, errorStatus(e));
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/pending-moves",
      handler: async (req, res) => {
        try {
          const items = await pendingMoves.list();
          json(res, { items: items.map((i) => ({ sessionId: i.sessionId, targetPath: i.targetPath, queuedAt: i.queuedAt, attempts: i.attempts })) });
        } catch (e) {
          json(res, { error: String(e && e.message || e) }, 500);
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/pending-moves/cancel",
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req);
          const ids = parseIds(body);
          if (!ids || ids.length === 0) return json(res, { ok: false, error: "missing sessionIds" }, 400);
          const removed = await pendingMoves.remove(ids);
          json(res, { ok: true, removed });
        } catch (e) {
          json(res, { ok: false, error: String(e && e.message || e) }, errorStatus(e));
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
          const ac = new AbortController();
          res.on("close", () => {
            if (!res.writableEnded) ac.abort();
          });
          json(res, await buildDetails(sid, ac.signal));
        } catch (e) {
          json(res, { error: String(e && e.message || e) }, e && e.status ? e.status : 500);
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/storage",
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req);
          json(res, await buildStorage({ topN: body && body.topN }));
        } catch (e) {
          json(res, { error: String(e && e.message || e) }, 500);
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/auto-archive/settings",
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req);
          const patch = {};
          if (body && Object.prototype.hasOwnProperty.call(body, "inactiveDays")) patch.inactiveDays = body.inactiveDays;
          if (body && Object.prototype.hasOwnProperty.call(body, "skipStarred")) patch.skipStarred = body.skipStarred;
          const isPatch = Object.keys(patch).length > 0;
          const settings = isPatch ? await autoArchive.update(patch) : (await autoArchive.read()).settings;
          let sweep;
          if (isPatch) {
            sweep = await autoArchiveSweep();
          } else {
            void autoArchiveSweep().catch(() => {
            });
            sweep = { triggered: true };
          }
          const store = await autoArchive.read();
          json(res, {
            ok: true,
            settings,
            lastRunAt: store.lastRunAt,
            lastArchivedCount: store.lastArchivedCount,
            sweep
          });
        } catch (e) {
          json(res, { ok: false, error: String(e && e.message || e) }, errorStatus(e));
        }
      }
    }));
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/archived-sessions/auto-archive/run",
      handler: async (req, res) => {
        try {
          const sweep = await autoArchiveSweep({ force: true });
          const store = await autoArchive.read();
          json(res, { ok: true, ...sweep, settings: store.settings, lastRunAt: store.lastRunAt, lastArchivedCount: store.lastArchivedCount });
        } catch (e) {
          json(res, { ok: false, error: String(e && e.message || e) }, 500);
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
