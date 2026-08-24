// src/index.js
import { mkdir, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
var name = "dsh-sessions-manager";
var inject = ["webServer", "workspaceRegistry", "sessionPersistence", "sessionQuery", "storageDomain"];
var MAX_TITLE = 80;
var FETCH_TOOL_RE = /search|fetch|download|browse/i;
var MAX_FETCHES = 12;
var MAX_FILES = 20;
function json(res, value, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
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
  for (const v of raw) if (typeof v === "string" && v) ids.push(v);
  return ids;
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
    const state = await archivedState();
    const list = state.archivedSessionIds.map(String);
    if (!list.includes(sid)) return { ok: true, restored: false };
    await writeArchived(list.filter((x) => x !== sid));
    return { ok: true, restored: true };
  }
  async function deleteOne(sid) {
    const activeId = getActiveSessionId(ctx);
    if (activeId != null && String(activeId) === String(sid)) {
      throw new Error("\u8BE5\u4F1A\u8BDD\u662F\u5F53\u524D\u6D3B\u52A8\u4F1A\u8BDD\uFF0C\u8BF7\u5148\u5207\u6362\u5230\u522B\u7684\u4F1A\u8BDD\u518D\u5220\u9664\u3002");
    }
    let removedPath = null;
    try {
      const headers = await sp.list();
      const header = headers.find((h) => String(h.id) === sid);
      if (header) {
        const loc = sp.locate(header);
        if (loc && typeof loc.path === "string") removedPath = loc.path;
      } else {
        const r = await sp.readFrom(sid, 0);
        if (r && r.meta && r.meta.cwd) {
          const loc = sp.locate({ id: sid, cwd: r.meta.cwd });
          if (loc && typeof loc.path === "string") removedPath = loc.path;
        }
      }
    } catch (e) {
    }
    if (removedPath) {
      try {
        await unlink(removedPath);
      } catch (e) {
        if (e && e.code !== "ENOENT") throw new Error("\u5220\u9664\u65E5\u5FD7\u6587\u4EF6\u5931\u8D25\uFF1A" + String(e && e.message || e));
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
    return { ok: true, deleted: true, removedPath };
  }
  async function moveTargetWorkspace(rawPath) {
    if (typeof rawPath !== "string" || !rawPath.trim()) throw new Error("\u7F3A\u5C11\u76EE\u6807\u5DE5\u4F5C\u533A\u8DEF\u5F84");
    let p = String(rawPath).trim();
    if (p.startsWith("~/")) p = join(homedir(), p.slice(2));
    if (!isAbsolute(p)) p = join(homedir(), p);
    let canonical = null;
    try {
      canonical = await realpath(p);
    } catch (e) {
      canonical = null;
    }
    if (canonical === null) {
      await mkdir(p, { recursive: true });
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
      const oldPath = locatePath(meta);
      const newPath = locatePath(newHeader);
      if (oldPath && newPath && oldPath !== newPath) {
        const backupPath = `${oldPath}.move-backup-${Date.now()}`;
        try {
          await rename(oldPath, backupPath);
          await rename(backupPath, newPath);
        } catch (e) {
          try {
            await rename(backupPath, oldPath);
          } catch (_) {
          }
          if (e && e.code !== "ENOENT") throw new Error("\u79FB\u52A8\u4F1A\u8BDD\u65E5\u5FD7\u5931\u8D25\uFF1A" + String(e && e.message || e));
        }
      }
      try {
        const st = sp.states && sp.states.get && sp.states.get(sid);
        if (st && st.meta) st.meta = Object.assign({}, st.meta, { cwd: canonical });
      } catch (e) {
      }
    } else {
      let oldPath = null;
      let backupPath = null;
      try {
        const loc = locatePath(meta);
        if (loc && loc.path) oldPath = loc.path;
      } catch (e) {
        oldPath = null;
      }
      if (oldPath) {
        backupPath = `${oldPath}.move-backup-${Date.now()}`;
        try {
          await rename(oldPath, backupPath);
        } catch (e) {
          if (e && e.code !== "ENOENT") throw new Error("\u79FB\u52A8\u5931\u8D25\uFF1A\u65E0\u6CD5\u5907\u4EFD\u65E7\u7684\u4F1A\u8BDD\u65E5\u5FD7");
          backupPath = null;
        }
      }
      const restore = async () => {
        if (backupPath && oldPath) {
          try {
            await rename(backupPath, oldPath);
          } catch (e) {
          }
        }
      };
      if (typeof sp.create !== "function" || typeof sp.append !== "function") {
        await restore();
        throw new Error("\u5F53\u524D\u4F1A\u8BDD\u5B58\u50A8\u540E\u7AEF\u4E0D\u652F\u6301\u5B89\u5168\u79FB\u52A8\uFF0C\u5DF2\u4E2D\u6B62\u3002");
      }
      try {
        await sp.create(newHeader);
        await sp.append(sid, events);
        const check = await sp.readFrom(sid, 0);
        if (!check || !check.meta || check.meta.cwd !== canonical) {
          throw new Error("\u79FB\u52A8\u540E\u6821\u9A8C\u5931\u8D25\uFF1A\u4F1A\u8BDD\u5DE5\u4F5C\u76EE\u5F55\u672A\u6B63\u786E\u66F4\u65B0");
        }
      } catch (e) {
        await restore();
        throw new Error("\u79FB\u52A8\u4F1A\u8BDD\u65E5\u5FD7\u5931\u8D25\uFF1A" + String(e && e.message || e));
      }
      if (backupPath) {
        try {
          await unlink(backupPath);
        } catch (e) {
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
    const state = await archivedState();
    const list = state.archivedSessionIds.map(String);
    if (list.includes(sid)) return { ok: true, archived: false };
    await w.archiveSession(sid);
    return { ok: true, archived: true };
  }
  async function allSessionItems() {
    let materialized = /* @__PURE__ */ new Set();
    let live = ctx.get("sessions");
    try {
      const headers = await sp.list();
      materialized = new Set(headers.map((h) => String(h.id)));
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
    wsByPath = {};
    try {
      for (const ent of w.list()) wsByPath[ent.path] = ent;
    } catch (e) {
      wsByPath = {};
    }
    const currentArchived = new Set((await archivedState().catch(() => ({ archivedSessionIds: [] }))).archivedSessionIds || []);
    const items = [];
    const CHUNK = 6;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const res2 = await Promise.all(ids.slice(i, i + CHUNK).map(resolveOne));
      for (const it of res2) items.push({ ...it, archived: currentArchived.has(it.sessionId) });
    }
    return items;
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
          const idStrs = ids.map(String).filter((id) => materialized.has(id) || live && live.get(id));
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
          json(res, { ok: false, error: String(e && e.message || e) }, 500);
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
          json(res, { ok: false, error: String(e && e.message || e) }, 500);
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
          json(res, { sessionId: sid, ...await moveOne(sid, target) });
          try {
            await reindexRegistry();
          } catch (e) {
          }
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
