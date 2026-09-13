window.__ModuleLoader__.load({ id: 'dsh-sessions-manager', factory: (require) => { var module = { exports: {} }; var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.jsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react = __toESM(require("react"), 1);

// src/client/logic.js
function dotStateFor({ manualUnread = false, dataState = "", isActive = false } = {}) {
  if (manualUnread) return "manual";
  switch (dataState) {
    case "ongoing":
    case "running":
      return "running";
    case "warning":
    case "waiting":
    case "needs-attention":
      return "feedback";
    case "error":
      return "error";
    case "done":
      return isActive ? null : "done";
    default:
      return null;
  }
}
function titleBackfillDecision({ rendered = "", baseline = null, authoritative = "" } = {}) {
  const auth = authoritative || "";
  if (!baseline) {
    const next = auth || rendered;
    return { text: next, changed: !!auth && auth !== rendered, nextBaseline: { text: next, authoritative: auth || null } };
  }
  if (rendered !== baseline.text) {
    return { changed: false, nextBaseline: { text: rendered, authoritative: baseline.authoritative || null } };
  }
  if (!auth || auth === baseline.authoritative) return null;
  return { text: auth, changed: true, nextBaseline: { text: auth, authoritative: auth } };
}
function effectiveTitleOf(item, authoritativeTitles) {
  if (!item) return "";
  if (item.title) return String(item.title);
  const id = String(item.sessionId);
  const auth = authoritativeTitles && authoritativeTitles.get(id);
  return auth ? String(auth) : "";
}
function canDropOnWorkspace(item, target) {
  if (!item || !target) return false;
  if (item.workspacePath && target.path === item.workspacePath) return false;
  return true;
}
function sessionForNodes(nodes, knownSessions) {
  for (const node of nodes || []) {
    const id = node && node.id != null ? String(node.id) : "";
    if (knownSessions.has(id)) return knownSessions.get(id);
    if (id && node.workspaceId == null && (node.title != null || node.updatedAt != null || node.blank != null)) {
      return { sessionId: id, title: node.title || "", workspacePath: null };
    }
  }
  return null;
}
function workspaceForNodes(nodes) {
  for (const group of nodes || []) {
    if (group && group.workspaceId != null && typeof group.cwd === "string" && group.cwd) {
      return { workspaceId: String(group.workspaceId), path: group.cwd, title: group.label || group.cwd };
    }
  }
  return null;
}
function starredOf(items) {
  return (items || []).filter((item) => item && item.starred);
}
function foldSubagents(items, lineage) {
  const list = items || [];
  const table = lineage || {};
  const kidsOf = /* @__PURE__ */ new Map();
  const foldedIds = /* @__PURE__ */ new Set();
  const byId = /* @__PURE__ */ new Map();
  for (const item of list) byId.set(String(item.sessionId), item);
  for (const item of list) {
    const id = String(item.sessionId);
    const info = table[id];
    const parentId = info && info.origin === "subagent" && info.parentSession ? String(info.parentSession) : null;
    if (!parentId || parentId === id || !byId.has(parentId)) continue;
    if (!kidsOf.has(parentId)) kidsOf.set(parentId, []);
    kidsOf.get(parentId).push(item);
    foldedIds.add(id);
  }
  return {
    topList: foldedIds.size ? list.filter((item) => !foldedIds.has(String(item.sessionId))) : list,
    kidsOf,
    foldedCount: foldedIds.size
  };
}
function shortId(id) {
  const raw = String(id == null ? "" : id);
  const tail = raw.startsWith("session-") ? raw.slice(8) : raw;
  if (!tail) return "";
  return tail.length <= 10 ? tail : tail.slice(0, 8) + "\u2026";
}
function openSubagentToast(result, name, where) {
  const label = name || "\u5B50\u4EE3\u7406";
  if (result === "ok") {
    return {
      kind: "ok",
      text: where === "sidebar" ? `\u5DF2\u6253\u5F00\u300C${label}\u300D` : `\u5DF2\u6253\u5F00\u300C${label}\u300D\u2014 \u5173\u6389\u8BBE\u7F6E\u5373\u53EF\u770B\u5230`
    };
  }
  if (result === "no-service") {
    return { kind: "err", text: "\u8FD9\u4E2A DSH \u7248\u672C\u6CA1\u6709\u5F00\u653E\u4F1A\u8BDD\u5207\u6362\u63A5\u53E3\uFF0C\u8BF7\u5728\u4FA7\u8FB9\u680F\u624B\u52A8\u5207\u6362" };
  }
  return {
    kind: "err",
    text: where === "sidebar" ? "\u6253\u4E0D\u5F00\u8FD9\u4E2A\u5B50\u4EE3\u7406\uFF1A\u8BF7\u9009\u4E2D\u5B83\u7684\u7236\u4F1A\u8BDD\uFF0C\u70B9\u6807\u9898\u680F\u7684\u300C/ N\u300D\u5B50\u4EE3\u7406\u76EE\u5F55" : "\u6253\u4E0D\u5F00\uFF1A\u8BF7\u5728\u4FA7\u8FB9\u680F\u9009\u4E2D\u5B83\u7684\u7236\u4F1A\u8BDD\uFF0C\u70B9\u6807\u9898\u680F\u7684\u300C/ N\u300D\u5B50\u4EE3\u7406\u76EE\u5F55"
  };
}
var TOAST_MIN_MS = 2600;
var TOAST_MAX_MS = 11e3;
function toastDurationFor(text, kind) {
  const chars = String(text == null ? "" : text).length;
  const readingMs = Math.round(chars / 6 * 1e3 * 1.4);
  const scaled = kind === "err" ? Math.round(readingMs * 1.25) : readingMs;
  return Math.min(TOAST_MAX_MS, Math.max(TOAST_MIN_MS, scaled));
}
function pathTail(p) {
  const parts = String(p == null ? "" : p).split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}
function moveNoticeText(n) {
  const id = shortId(n && n.sessionId);
  if (n && n.kind === "moved") {
    const where = pathTail(n.targetPath);
    return `\u6392\u961F\u4E2D\u7684\u79FB\u52A8\u5DF2\u5B8C\u6210\uFF1A${id}${where ? ` \u2192 \u300C${where}\u300D` : ""}`;
  }
  const reason = String(n && n.reason || "").split("\n")[0].slice(0, 120);
  return `\u6392\u961F\u4E2D\u7684\u79FB\u52A8\u591A\u6B21\u5931\u8D25\u5DF2\u653E\u5F03\uFF1A${id}${reason ? `\uFF08${reason}\uFF09` : ""}\uFF0C\u53EF\u5728 \u8BBE\u7F6E \u2192 \u4F1A\u8BDD\u7BA1\u7406 \u2192 \u5F85\u79FB\u52A8\u961F\u5217 \u91CD\u65B0\u53D1\u8D77\u79FB\u52A8`;
}
function noticeToastPlan(raw, seenIds, max = 2) {
  const list = (Array.isArray(raw) ? raw : []).filter((n) => n && typeof n.id === "string" && typeof n.sessionId === "string" && (n.kind === "moved" || n.kind === "abandoned") && !seenIds.has(String(n.id))).sort((a, b) => (a.at || 0) - (b.at || 0));
  if (!list.length) return { text: null, kind: "ok", ackIds: [] };
  const shown = list.slice(Math.max(0, list.length - Math.max(1, max)));
  const parts = shown.map(moveNoticeText);
  if (list.length > shown.length) parts.push(`\u53E6\u6709 ${list.length - shown.length} \u6761\u6392\u961F\u79FB\u52A8\u7684\u7ED3\u679C\uFF0C\u89C1 \u8BBE\u7F6E \u2192 \u4F1A\u8BDD\u7BA1\u7406 \u2192 \u5F85\u79FB\u52A8\u961F\u5217`);
  return {
    text: parts.join("\uFF1B"),
    kind: shown.some((n) => n.kind === "abandoned") ? "err" : "ok",
    ackIds: shown.map((n) => String(n.id))
  };
}
function branchTimeKey(item) {
  const c = Number(item && item.createdAt);
  if (Number.isFinite(c) && c > 0) return c;
  const u = Number(item && item.updatedAt);
  if (Number.isFinite(u) && u > 0) return u;
  return 0;
}
function ascBranchTime(a, b) {
  const ta = String((a && a.sessionId) ?? "");
  const tb = String((b && b.sessionId) ?? "");
  return branchTimeKey(a) - branchTimeKey(b) || ta.localeCompare(tb);
}
function branchParentOf(id, table) {
  const info = table[id];
  if (!info || typeof info !== "object") return null;
  if (info.origin === "subagent") return null;
  const p = info.parentSession ? String(info.parentSession) : null;
  if (!p || p === id) return null;
  return p;
}
function foldBranches(items, lineage) {
  const list = Array.isArray(items) ? items : [];
  const table = lineage && typeof lineage === "object" ? lineage : {};
  const byId = /* @__PURE__ */ new Map();
  for (const it of list) {
    if (it == null || it.sessionId == null) continue;
    byId.set(String(it.sessionId), it);
  }
  const maxWalk = Object.keys(table).length + list.length + 2;
  const anchorMemo = /* @__PURE__ */ new Map();
  function resolveAnchor(id) {
    if (anchorMemo.has(id)) return anchorMemo.get(id);
    const seen = /* @__PURE__ */ new Set([id]);
    let cur = id;
    let steps = 0;
    let anchor = null;
    while (true) {
      const p = branchParentOf(cur, table);
      if (!p) {
        anchor = steps === 0 ? null : cur;
        break;
      }
      if (seen.has(p)) break;
      seen.add(p);
      steps++;
      if (byId.has(p)) {
        if (!branchParentOf(p, table)) {
          anchor = p;
          break;
        }
        cur = p;
        if (steps > maxWalk) break;
        continue;
      }
      if (!branchParentOf(p, table)) {
        anchor = p;
        break;
      }
      cur = p;
      if (steps > maxWalk) break;
    }
    anchorMemo.set(id, anchor);
    return anchor;
  }
  const groupsOf = /* @__PURE__ */ new Map();
  const anchorOfRow = /* @__PURE__ */ new Map();
  let foldedCount = 0;
  for (const it of list) {
    if (it == null || it.sessionId == null) continue;
    const id = String(it.sessionId);
    if (!branchParentOf(id, table)) continue;
    const anchor = resolveAnchor(id);
    if (!anchor || anchor === id) continue;
    if (!groupsOf.has(anchor)) groupsOf.set(anchor, []);
    groupsOf.get(anchor).push(it);
    anchorOfRow.set(it, anchor);
    foldedCount++;
  }
  const earliest = /* @__PURE__ */ new Set();
  for (const [anchor, members] of groupsOf) {
    members.sort(ascBranchTime);
    if (!byId.has(anchor)) earliest.add(members[0]);
  }
  const topList = [];
  const emitted = /* @__PURE__ */ new Set();
  for (const it of list) {
    const anchor = it == null ? void 0 : anchorOfRow.get(it);
    if (anchor === void 0) {
      topList.push(it);
      continue;
    }
    if (!byId.has(anchor) && !emitted.has(anchor) && earliest.has(it)) {
      emitted.add(anchor);
      topList.push({ syntheticRoot: anchor, sessionId: "dsm-src:" + anchor });
    }
  }
  for (const [anchor, members] of groupsOf) {
    if (!members.length) groupsOf.delete(anchor);
  }
  return { topList, branchGroupsOf: groupsOf, foldedCount, groupCount: groupsOf.size };
}
function applyTagFilter(list, tagId) {
  const items = Array.isArray(list) ? list : [];
  if (!tagId) return items;
  const want = String(tagId);
  return items.filter((item) => {
    const tags = item && item.tags;
    return Array.isArray(tags) && tags.some((t) => String(t) === want);
  });
}
function tagDeleteConfirm(name) {
  return `\u5220\u9664\u6807\u7B7E\u300C${String(name == null ? "" : name) || "(\u672A\u547D\u540D)"}\u300D\uFF1F\u53EA\u5220\u6807\u7B7E\uFF0C\u4E0D\u4F1A\u5220\u9664\u4F1A\u8BDD\uFF1B\u6253\u8FC7\u8FD9\u4E2A\u6807\u7B7E\u7684\u4F1A\u8BDD\u53EA\u662F\u5931\u53BB\u5B83\u3002`;
}
var SAVED_VIEWS = ["all", "active", "archived", "starred", "empty", "trash"];
var SAVED_SORTS = ["newest", "oldest", "title"];
function filterSnapshotOf({ filter = "all", workspaceFilter = "all", sortBy = "newest", tagFilter = "" } = {}) {
  return {
    view: SAVED_VIEWS.includes(filter) ? filter : "all",
    workspace: typeof workspaceFilter === "string" && workspaceFilter ? workspaceFilter : "all",
    sort: SAVED_SORTS.includes(sortBy) ? sortBy : "newest",
    tag: typeof tagFilter === "string" ? tagFilter : ""
  };
}
function filterShapeFromSaved(item) {
  const f = item && item.filters && typeof item.filters === "object" && !Array.isArray(item.filters) ? item.filters : {};
  const degraded = [];
  let view = typeof f.view === "string" && SAVED_VIEWS.includes(f.view) ? f.view : "all";
  if (view === "all" && f.view !== "all") degraded.push("view");
  let workspace = typeof f.workspace === "string" && f.workspace ? f.workspace : "all";
  if (workspace === "all" && f.workspace !== "all") degraded.push("workspace");
  let sort = typeof f.sort === "string" && SAVED_SORTS.includes(f.sort) ? f.sort : "newest";
  if (sort === "newest" && f.sort !== "newest") degraded.push("sort");
  let tag = typeof f.tag === "string" ? f.tag : "";
  if (tag === "" && f.tag !== "") degraded.push("tag");
  return { view, workspace, sort, tag, degraded };
}

// src/client/index.jsx
var import_jsx_runtime = require("react/jsx-runtime");
var inject = ["slots"];
var PANEL_PREFS_KEY = "dsm-panel-prefs-v1";
function loadPanelPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PANEL_PREFS_KEY) || "{}") || {};
  } catch (e) {
    return {};
  }
}
var CSS = `
.archv{--dsm-radius-tag:9px;--dsm-radius-ctl:9px;--dsm-radius-sheet:10px;--dsm-radius-card:12px;display:flex;flex-direction:column;gap:4px;max-width:800px;padding:8px 2px 28px}
.archv-head{display:flex;align-items:center;gap:10px;margin:0 0 2px}
.archv-title{font-size:16px;font-weight:650;color:var(--dsw-alias-label-primary);letter-spacing:-0.01em;margin:0}
.archv-stamp{font-size:11px;font-weight:500;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-fill-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 8px;white-space:nowrap;cursor:default}
.archv-count{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-fill-subtle);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:1px 8px;flex:none}
.archv-sub{font-size:12px;line-height:1.55;color:var(--dsw-alias-label-tertiary);margin:0 0 12px;max-width:64ch}
.archv-err{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);border-radius:var(--dsm-radius-sheet);color:var(--dsw-alias-state-error-primary);font-size:12px;margin-bottom:10px}
.archv-errretry{appearance:none;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent);background:transparent;color:inherit;border-radius:8px;padding:4px 10px;font-size:11px;cursor:pointer;flex:none}
.sess-fwrap{margin:0 0 12px}
.sess-filter{display:flex;align-items:center;gap:6px}
/* \u4F4E\u9891\u5206\u7C7B\uFF08\u5DF2\u6536\u85CF/\u7A7A\u767D/\u56DE\u6536\u7AD9\uFF09\u6A2A\u5411\u6536\u7EB3\uFF1A\u9ED8\u8BA4 max-width:0 \u9690\u85CF\uFF0C\u70B9\u6309\u7BAD\u5934
   \uFF08sess-fmore-open\uFF09\u6216\u4F4E\u9891\u5206\u7C7B\u5904\u4E8E\u9009\u4E2D\u6001\uFF08sess-fsec-on\uFF09\u65F6\u5411\u53F3\u5C55\u5F00\uFF1B
   max-width \u8FC7\u6E21\u505A\u6A2A\u5411\u6ED1\u51FA\u52A8\u753B\uFF0Coverflow \u88C1\u526A\u56DE\u7F29\u8FC7\u7A0B\u3002 */
.sess-fmore{display:inline-flex;align-items:center;gap:6px;max-width:0;opacity:0;overflow:hidden;white-space:nowrap;transform:translateX(-8px);visibility:hidden;transition:max-width .22s ease,opacity .18s ease,transform .22s ease,visibility 0s .22s}
.sess-fwrap.sess-fmore-open .sess-fmore,.sess-fwrap.sess-fsec-on .sess-fmore{max-width:30em;opacity:1;transform:none;visibility:visible;transition:max-width .22s ease,opacity .18s ease,transform .22s ease}
.sess-farrow{appearance:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;padding:0;opacity:0;pointer-events:none;transition:opacity .18s ease,color .18s ease}
/* \u7BAD\u5934\u9ED8\u8BA4\u7D27\u8DDF\u4E09\u4E2A\u4E3B tab \u53F3\u8FB9\uFF08\u60AC\u505C\u7B5B\u9009\u884C\u624D\u6D6E\u73B0\uFF09\uFF1B\u5C55\u5F00\u7EC4\u6491\u5F00\u540E\u628A\u5B83\u63A8\u5230
   \u884C\u5C3E\u3002\u65E0\u5916\u5708\u5E95\u8272\uFF0C\u53EA\u6E32\u67D3 svg \u672C\u4F53\u3002\u9690\u85CF\u6001\u7528 pointer-events:none \u6321\u4F4F
   \u8BEF\u70B9\uFF1B\u5C55\u5F00\u6001\uFF08\u542B\u9009\u4E2D\u4F4E\u9891\u5206\u7C7B\u7684\u515C\u5E95\uFF09\u5E38\u9A7B\u2014\u2014\u6536\u8D77\u5165\u53E3\u4E0D\u80FD\u6D88\u5931\u3002 */
.sess-fwrap:hover .sess-farrow,.sess-fwrap.sess-fmore-open .sess-farrow,.sess-fwrap.sess-fsec-on .sess-farrow{opacity:1;pointer-events:auto}
.sess-farrow:hover{color:var(--dsw-alias-label-primary)}
.sess-farrow svg{display:block;transition:transform .22s ease}
.sess-fwrap.sess-fmore-open .sess-farrow svg,.sess-fwrap.sess-fsec-on .sess-farrow svg{transform:rotate(180deg)}
.sess-fbtn{appearance:none;min-height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-subtle);color:var(--dsw-alias-label-secondary);border-radius:999px;font-size:12px;font-weight:500;cursor:pointer}
.sess-fbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.sess-fbtn-on{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}
.sess-tools{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin:0 0 8px}
.sess-tools-4{grid-template-columns:repeat(auto-fit,minmax(132px,1fr))}
/* T4 \u8D77\u641C\u7D22\u884C\u6709 5 \u4E2A\u5B57\u6BB5\uFF08\u641C\u7D22/\u5DE5\u4F5C\u533A/\u6807\u7B7E/\u6392\u5E8F/\u5206\u7EC4\uFF09\uFF1A\u6536\u7A84\u4E0B\u9650\u4FDD\u8BC1 800px \u5185\u4E00\u884C\u6392\u6EE1\u3002 */
.sess-tools-5{grid-template-columns:repeat(auto-fit,minmax(124px,1fr))}
.dsm-kids{display:flex;flex-direction:column;gap:6px;margin:10px 0 2px;margin-left:43px;padding-left:10px;border-left:2px solid var(--dsw-alias-border-l3)}
.dsm-kid .dsm-kids{margin-left:8px;margin-top:6px}
.dsm-kids-toggle{appearance:none;min-height:22px;padding:0 9px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);color:var(--dsw-alias-state-business-primary);border-radius:var(--dsm-radius-tag);font:inherit;font-size:11px;font-weight:500;cursor:pointer;flex:none;white-space:nowrap}
.dsm-kids-toggle:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,transparent)}
.dsm-src-head{display:flex;align-items:center;gap:8px;padding:5px 9px;border:1px dashed var(--dsw-alias-border-l3);border-radius:var(--dsm-radius-ctl);font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsm-src-head .dsm-src-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-kid{display:flex;flex-direction:column;gap:6px;min-width:0}
.dsm-kid-row{display:flex;align-items:center;gap:8px;min-width:0}
.dsm-kid-name{flex:1 1 auto;min-width:0;font-size:12px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-kid-meta{font-size:11px;color:var(--dsw-alias-label-tertiary);flex:none;white-space:nowrap}
.dsm-kid-acts{display:flex;align-items:center;gap:6px;flex:none;margin-left:auto}
.dsm-kid-acts .archv-btn{min-height:26px;padding:0 9px;font-size:11px}
.sess-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.sess-field label{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.sess-field input,.sess-field select{box-sizing:border-box;width:100%;min-height:36px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsm-radius-ctl);background:var(--dsw-alias-fill-elevated);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
.sess-results{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-tertiary);margin:0 0 4px}
/* T4 \u540E\u8BA1\u6570\u884C\u53F3\u4FA7\u6302\u4E86\u300C\u4FDD\u5B58\u7B5B\u9009\u300D\u63A7\u4EF6\u7EC4\uFF0C\u6B63\u6587\u72EC\u5360\u5DE6\u4FA7\u53EF\u6536\u7F29\u3002 */
.sess-results-main{flex:1 1 auto;min-width:0}
.archv button:focus-visible,.archv input:focus-visible,.archv select:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.sess-batch{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 2px 4px;margin-bottom:4px}
/* issue #7\uFF1A\u52FE\u9009\u540E\u6279\u91CF\u64CD\u4F5C\u680F\u5438\u9876\u2014\u2014\u5217\u8868\u518D\u957F\uFF0C\u64CD\u4F5C\u6309\u94AE\u4E5F\u4E00\u76F4\u5728\u624B\u8FB9\u3002 */
.sess-batch-pin{position:sticky;top:0;z-index:30;margin:0 -2px 4px;padding:8px 4px 6px;background:var(--dsw-alias-bg-layer-1);border-bottom:1px solid var(--dsw-alias-border-l2);box-shadow:0 6px 14px rgb(0 0 0/.08)}
.sess-btntext{font-size:12px;color:var(--dsw-alias-label-tertiary);flex:none}
.archv-list{display:flex;flex-direction:column;gap:8px}
.archv-card{display:flex;flex-direction:column;align-items:stretch;gap:0;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsm-radius-card);background:var(--dsw-alias-fill-elevated);transition:border-color .15s ease,background-color .15s ease}
.archv-card:hover{border-color:var(--dsw-alias-border-l4)}
.archv-card-exp{border-color:var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-1)}
.archv-row{display:flex;align-items:center;gap:14px;width:100%;min-width:0}
.archv-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
.archv-titlerow{display:flex;align-items:center;gap:8px;min-width:0}
.archv-name{font-size:13px;font-weight:550;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1 auto}
.archv-meta{display:flex;align-items:center;gap:7px;flex-wrap:nowrap;min-width:0;overflow:hidden}
.archv-wtag{display:inline-flex;align-items:center;gap:4px;min-width:0;flex:0 1 auto;font-size:11px;font-weight:500;line-height:1;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-fill-subtle);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsm-radius-tag);padding:3px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.archv-wgone{border-style:dashed;color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 7%,transparent)}
.archv-active{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 8%,transparent)}
.archv-date{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none}
.dsm-branch-chip{display:inline-flex;align-items:center;flex:none;min-height:22px;padding:0 9px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary) 45%,transparent);border-radius:var(--dsm-radius-tag);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary);font-size:11px;font-weight:500;line-height:1;white-space:nowrap}
.dsm-empty-chip{display:inline-flex;align-items:center;flex:none;min-height:22px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsm-radius-tag);background:var(--dsw-alias-fill-subtle);color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:500;line-height:1;white-space:nowrap}
/* 3.7.0 T4 \u6807\u7B7E chip \u7CFB\uFF1A\u5361\u7247\u6807\u9898\u884C\u5185\u3001\u5206\u652F/\u7A7A\u767D chip \u4E4B\u540E\u3002\u8B66\u793A\u8272\u7CFB\u533A\u522B\u4E8E
   \u5206\u652F\uFF08\u7EFF\uFF09/\u7A7A\u767D\uFF08\u7070\uFF09\uFF0C\u540D\u5B57\u8D85\u957F\u7701\u7565\u53F7\uFF1B+N \u8BA1\u6570 chip \u4E2D\u6027\u8272\u3002 */
.dsm-tagchip{display:inline-flex;align-items:center;flex:none;max-width:9em;min-height:22px;padding:0 8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary,#EAB308) 45%,transparent);border-radius:var(--dsm-radius-tag);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#EAB308) 10%,transparent);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:500;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsm-tagchip-more{max-width:none;color:var(--dsw-alias-label-tertiary);border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-subtle)}
.archv-id{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;color:var(--dsw-alias-label-tertiary);flex:none;margin-left:auto;white-space:nowrap}
.archv-dot{color:var(--dsw-alias-border-l3);flex:none}
.archv-check{width:15px;height:15px;accent-color:var(--dsw-alias-state-business-primary);flex:none;cursor:pointer}
.archv-star{appearance:none;width:22px;height:22px;flex:none;display:inline-flex;align-items:center;justify-content:center;border:none;background:0 0;padding:0;line-height:0;color:var(--dsw-alias-label-tertiary);cursor:pointer;border-radius:50%;transition:color .15s ease,transform .12s ease}
.archv-star:hover{background:0 0;color:var(--dsw-alias-label-secondary);transform:scale(1.12)}
.archv-star:active{transform:scale(.92)}
.archv-star svg{fill:none;stroke:currentColor;stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round;display:block}
.archv-star-on,.archv-star-on:hover{color:var(--dsw-alias-state-business-primary)}
.archv-star-on svg{fill:currentColor}
.archv-body{flex:1;min-width:0;display:flex;align-items:center;gap:12px}
.archv-actions{display:flex;gap:8px;flex:none;flex-wrap:nowrap;justify-content:flex-end}
.archv-btn{appearance:none;min-height:32px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-subtle);color:var(--dsw-alias-label-secondary);border-radius:var(--dsm-radius-ctl);font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:6px;text-align:center;transition:background-color .15s ease,border-color .15s ease,color .15s ease}
.archv-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.archv-btn:disabled{opacity:.5;cursor:default}
.archv-del{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}
.archv-del:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}
.archv-go{color:var(--dsw-alias-state-business-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 45%,transparent)}
.archv-go:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);color:var(--dsw-alias-state-business-primary)}
.archv-empty{display:flex;align-items:center;gap:10px;padding:20px 14px;border:1px dashed var(--dsw-alias-border-l3);border-radius:var(--dsm-radius-card);color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.archv-skel{display:flex;flex-direction:column;gap:8px}
.archv-skel-card{height:58px;border-radius:var(--dsm-radius-card);background:var(--dsw-alias-fill-subtle);position:relative;overflow:hidden}
.archv-skel-card::after{content:'';position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--dsw-alias-fill-elevated) 75%,transparent),transparent);animation:archv-shimmer 1.4s infinite}
.archv-status{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:2147483601;background:linear-gradient(var(--dsw-alias-fill-elevated),var(--dsw-alias-fill-elevated)),var(--dsw-alias-bg-layer-1,Canvas);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);padding:9px 16px;border-radius:999px;font-size:12px;line-height:1.5;text-align:center;box-shadow:0 8px 24px rgb(0 0 0/.25);display:flex;align-items:center;gap:8px;animation:archv-pop .18s ease-out;max-width:min(92vw,480px);cursor:pointer}
.archv-status-long{border-radius:14px;text-align:left}
.archv-spin{width:12px;height:12px;border:2px solid color-mix(in srgb,var(--dsw-alias-label-secondary) 35%,transparent);border-top-color:var(--dsw-alias-label-secondary);border-radius:50%;animation:archv-rot .8s linear infinite;flex:none}
@keyframes archv-shimmer{100%{transform:translateX(100%)}}
@keyframes archv-rot{to{transform:rotate(360deg)}}
@keyframes archv-pop{from{opacity:0;transform:translateX(-50%) translateY(10px)}}
/* \u5931\u8D25\u63D0\u793A\u7528\u8B66\u793A\u8272 + \u52A0\u7C97\uFF0C\u5E76\u505C\u7559\u66F4\u4E45\uFF08\u9700\u8981\u7528\u6237\u8BFB\u5B8C\u53BB\u505A\u4E0B\u4E00\u6B65\u64CD\u4F5C\uFF09\u3002 */
.archv-status-err{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);font-weight:500}
@media (prefers-reduced-motion:reduce){.archv-skel-card::after{animation:none}.archv-card,.archv-btn,.archv-star{transition:none}.archv-star:hover,.archv-star:active{transform:none}.archv-status,.archv-spin{animation:none}}
@media (max-width:640px){.archv-card{flex-direction:column;align-items:stretch;gap:10px}.archv-actions{justify-content:flex-end}.sess-tools,.sess-tools-4,.sess-tools-5{grid-template-columns:1fr}.sess-fbtn,.archv-btn{min-height:40px}.archv-star{width:30px;height:30px}.archv-star svg{width:22px;height:22px}.dsm-kids{margin-left:10px}.archv-titlerow{flex-wrap:wrap}.dsm-kid-row{flex-wrap:wrap}.dsm-kid-acts{margin-left:0}}
.mv-sheet{width:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:12px;margin-top:12px;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsm-radius-sheet);background:var(--dsw-alias-fill-subtle)}
.mv-sheet-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.mv-sheet-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);margin:0}
.mv-sheet-close{appearance:none;width:26px;height:26px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:7px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:16px;line-height:1}
.mv-sheet-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.mv-seg{display:flex;gap:2px;padding:2px;background:var(--dsw-alias-fill-elevated);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsm-radius-sheet);width:100%}
.mv-segbtn{appearance:none;flex:1;min-height:30px;padding:0 12px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.mv-segbtn:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.mv-segbtn-on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgb(0 0 0/.08)}
.mv-field{display:flex;flex-direction:column;gap:6px}
.mv-field label.mv-field-label{font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.mv-field select,.mv-field input[type=text]{box-sizing:border-box;appearance:none;width:100%;min-height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsm-radius-ctl);background:var(--dsw-alias-fill-elevated);color:var(--dsw-alias-label-primary);font-size:12px;font-family:inherit}
.mv-field select:focus-visible,.mv-field input[type=text]:focus-visible,.mv-sheet-close:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.mv-browse-row{display:flex;align-items:center;gap:8px}
.mv-browse-row input[type=text]{flex:1;min-width:0}
.mv-foot{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:2px}
@media (max-width:640px){.archv-row{flex-wrap:wrap}.mv-sheet{padding:12px}}
.dtl-sheet{margin-top:12px;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsm-radius-sheet);background:var(--dsw-alias-fill-subtle)}
.dtl-sheet-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.dtl-sheet-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);margin:0}
.dtl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin-top:10px}
.dtl-cell{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-fill-elevated);min-width:0}
.dtl-k{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dtl-v{font-size:12px;color:var(--dsw-alias-label-primary);word-break:break-all}
.dtl-sec{margin-top:12px}
.dtl-export{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dtl-export .archv-btn{text-decoration:none}
.dtl-note{margin-top:8px;font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.5}
.dtl-sec-t{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.03em;margin-bottom:6px}
.dtl-tags{display:flex;flex-wrap:wrap;gap:6px}
.dtl-tag{display:inline-flex;font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-fill-elevated);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsm-radius-tag);padding:2px 8px}
.dtl-list{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:3px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.dtl-list code,.dtl-paths code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-primary);word-break:break-all}
.dtl-filetool{color:var(--dsw-alias-label-tertiary)}
.dtl-paths{display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:var(--dsw-alias-label-secondary);word-break:break-all}
.more-wrap{position:relative;flex:none}
.more-btn{appearance:none;width:28px;height:28px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;line-height:1}
.more-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.more-menu{position:absolute;top:calc(100% + 4px);right:0;z-index:60;min-width:160px;padding:5px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsm-radius-sheet);box-shadow:0 10px 32px rgb(0 0 0/.24);display:flex;flex-direction:column;gap:1px}
.more-item{appearance:none;display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:none;background:transparent;color:var(--dsw-alias-label-primary);border-radius:7px;font-size:12.5px;cursor:pointer;white-space:nowrap;text-align:left}
.more-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.more-item-danger{color:var(--dsw-alias-state-error-primary)}
.more-item-danger:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}
.dlg-backdrop{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px}
.dlg{width:min(420px,92vw);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l3);border-radius:14px;padding:18px;box-shadow:0 16px 48px rgb(0 0 0/.28);display:flex;flex-direction:column;gap:12px}
.dlg-title{font-size:15px;font-weight:650;color:var(--dsw-alias-label-primary);margin:0}
.dlg-text{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary);margin:0;word-break:break-all}
.dlg-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:2px}
/* ---- T4 \u6807\u7B7E\u7F16\u8F91/\u7BA1\u7406 sheet \u4E0E\u7B5B\u9009\u4FDD\u5B58\u63A7\u4EF6\uFF08\u5168\u90E8\u8D70 --dsw token\uFF09 ---- */
.dsm-taglist{display:flex;flex-direction:column;gap:2px;max-height:240px;overflow:auto}
.dsm-tagcheck{display:flex;align-items:center;gap:8px;min-width:0;padding:5px 2px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:7px}
.dsm-tagcheck:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsm-tagcheck input{width:15px;height:15px;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer;flex:none}
.dsm-tagcheck-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-tagrow{display:flex;align-items:center;gap:8px;min-width:0;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsm-tagrow:last-child{border-bottom:none}
.dsm-tag-name{flex:0 1 auto;min-width:0;font-size:12.5px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-tag-input{box-sizing:border-box;flex:1 1 auto;min-width:0;min-height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsm-radius-ctl);background:var(--dsw-alias-fill-elevated);color:var(--dsw-alias-label-primary);font-size:12px;font-family:inherit}
.dsm-tag-input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dsm-tag-acts{display:flex;align-items:center;gap:6px;flex:none;margin-left:auto}
.dsm-tag-acts .archv-btn{min-height:26px;padding:0 9px;font-size:11px}
.dsm-tag-acts select{appearance:none;min-height:26px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsm-radius-ctl);background:var(--dsw-alias-fill-elevated);color:var(--dsw-alias-label-secondary);font-size:11px;font-family:inherit;max-width:10em}
.dsm-fbar{display:flex;align-items:center;gap:6px;flex:none;margin-left:auto;flex-wrap:wrap}
.dsm-fbar .archv-btn{min-height:24px;padding:0 8px;font-size:11px}
.dsm-fbar select{appearance:none;min-height:24px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsm-radius-ctl);background:var(--dsw-alias-fill-elevated);color:var(--dsw-alias-label-secondary);font-size:11px;font-family:inherit;max-width:12em}
.dsm-fbar input{box-sizing:border-box;min-width:9em;min-height:24px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsm-radius-ctl);background:var(--dsw-alias-fill-elevated);color:var(--dsw-alias-label-primary);font-size:11px;font-family:inherit}
@media (max-width:640px){.dsm-fbar{margin-left:0;width:100%;justify-content:flex-end}.dsm-tag-acts{margin-left:auto;flex-wrap:wrap;justify-content:flex-end}}
`;
function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
  } catch {
    return String(iso);
  }
}
function fmtBytes(n) {
  if (!n && n !== 0) return null;
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n;
  let u = -1;
  do {
    v /= 1024;
    u++;
  } while (v >= 1024 && u < units.length - 1);
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[u]}`;
}
function pathName(p) {
  if (!p) return null;
  const parts = String(p).replace(/\\+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || p;
}
var BUSY_CODE = "DSM_SESSION_BUSY";
async function postJSON(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body || {})
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    const error = new Error(data && (data.error || data.message) || `request failed (${res.status})`);
    if (data && data.code) error.code = data.code;
    throw error;
  }
  return data;
}
var dsmClientCtx = null;
function dsmSessionsService() {
  try {
    return dsmClientCtx && typeof dsmClientCtx.get === "function" ? dsmClientCtx.get("sessions") : null;
  } catch (e) {
    return null;
  }
}
function dsmCurrentSessionId(svc) {
  try {
    const snap = svc && svc.list && typeof svc.list.getSnapshot === "function" ? svc.list.getSnapshot() : null;
    return snap && snap.current != null ? String(snap.current) : null;
  } catch (e) {
    return null;
  }
}
async function dsmOpenSessionById(childId, directParentId) {
  const sid = String(childId || "");
  if (!sid) return "failed";
  const svc = dsmSessionsService();
  if (!svc) return "no-service";
  const parent = directParentId ? String(directParentId) : null;
  if (typeof svc.open === "function") {
    try {
      svc.open(sid);
      await new Promise((r) => setTimeout(r, 350));
      if (dsmCurrentSessionId(svc) === sid) return "ok";
    } catch (e) {
    }
  }
  if (parent && typeof svc.openSubagent === "function") {
    try {
      if (typeof svc.refreshSubagents === "function") await svc.refreshSubagents(parent);
      svc.openSubagent({ parentSessionId: parent, childSessionId: sid, mode: "continuable" });
      await new Promise((r) => setTimeout(r, 350));
      if (dsmCurrentSessionId(svc) === sid) return "ok";
      return "ok";
    } catch (e) {
    }
  }
  return "failed";
}
var NAV_CSS = `
[data-dsh-nav-sessions] > svg:first-child { display: none; }
[data-dsh-nav-sessions]::before {
  content: ''; flex: none; width: 16px; height: 16px; background: currentColor;
  -webkit-mask: url("data:image/svg+xml,%3Csvg%20xmlns%3D'http://www.w3.org/2000/svg'%20width%3D'24'%20height%3D'24'%20viewBox%3D'0%200%2024%2024'%20fill%3D'none'%20stroke%3D'black'%20stroke-width%3D'2'%20stroke-linecap%3D'round'%20stroke-linejoin%3D'round'%3E%3Cpath%20d%3D'M21%208v13H3V8'/%3E%3Cpath%20d%3D'M1%203h22v5H1z'/%3E%3Cpath%20d%3D'M10%2012h4'/%3E%3C/svg%3E") center / contain no-repeat;
  mask: url("data:image/svg+xml,%3Csvg%20xmlns%3D'http://www.w3.org/2000/svg'%20width%3D'24'%20height%3D'24'%20viewBox%3D'0%200%2024%2024'%20fill%3D'none'%20stroke%3D'black'%20stroke-width%3D'2'%20stroke-linecap%3D'round'%20stroke-linejoin%3D'round'%3E%3Cpath%20d%3D'M21%208v13H3V8'/%3E%3Cpath%20d%3D'M1%203h22v5H1z'/%3E%3Cpath%20d%3D'M10%2012h4'/%3E%3C/svg%3E") center / contain no-repeat;
}
`;
function markSettingsNav() {
  const LABEL = "\u4F1A\u8BDD\u7BA1\u7406";
  let disposed = false;
  let frame = 0;
  const run = () => {
    frame = 0;
    if (disposed) return;
    if (!document.querySelector('[role="dialog"]')) return;
    const buttons = document.querySelectorAll('[role="dialog"] nav button');
    for (const b of buttons) {
      const t = (b.textContent || "").trim();
      if (t === LABEL) b.setAttribute("data-dsh-nav-sessions", "");
      else b.removeAttribute("data-dsh-nav-sessions");
    }
  };
  const sync = () => {
    if (!frame && !disposed) frame = requestAnimationFrame(run);
  };
  run();
  const obs = new MutationObserver(sync);
  obs.observe(document.body, { childList: true, subtree: true });
  return () => {
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    obs.disconnect();
    document.querySelectorAll("[data-dsh-nav-sessions]").forEach((e) => e.removeAttribute("data-dsh-nav-sessions"));
  };
}
function installSettingsNavIcons(ctx) {
  const styleEl = document.createElement("style");
  styleEl.textContent = NAV_CSS;
  document.head.appendChild(styleEl);
  const dispose = markSettingsNav();
  ctx.effect(() => () => {
    dispose();
    if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
  });
}
function SessionPanel({ workspacesSvc }) {
  const [sessions, setSessions] = (0, import_react.useState)(null);
  const [workspaces, setWorkspaces] = (0, import_react.useState)([]);
  const [capabilities, setCapabilities] = (0, import_react.useState)(null);
  const initialPrefs = (0, import_react.useRef)(loadPanelPrefs()).current;
  const [filter, setFilter] = (0, import_react.useState)(() => ["all", "active", "archived", "starred", "empty", "trash"].includes(initialPrefs.filter) ? initialPrefs.filter : "all");
  const [moreOpen, setMoreOpen] = (0, import_react.useState)(() => ["starred", "empty", "trash"].includes(initialPrefs.filter));
  const [query, setQuery] = (0, import_react.useState)("");
  const [workspaceFilter, setWorkspaceFilter] = (0, import_react.useState)(() => initialPrefs.workspaceFilter || "all");
  const [sortBy, setSortBy] = (0, import_react.useState)(() => ["newest", "oldest", "title"].includes(initialPrefs.sortBy) ? initialPrefs.sortBy : "newest");
  const [selected, setSelected] = (0, import_react.useState)({});
  const [delTarget, setDelTarget] = (0, import_react.useState)(null);
  const [confirmBatch, setConfirmBatch] = (0, import_react.useState)(false);
  const [batchMoveOpen, setBatchMoveOpen] = (0, import_react.useState)(false);
  const [busy, setBusy] = (0, import_react.useState)(null);
  const [openMove, setOpenMove] = (0, import_react.useState)(null);
  const [moveMode, setMoveMode] = (0, import_react.useState)("existing");
  const [targetWs, setTargetWs] = (0, import_react.useState)("");
  const [newPath, setNewPath] = (0, import_react.useState)("");
  const [error, setError] = (0, import_react.useState)(null);
  const [retry, setRetry] = (0, import_react.useState)(null);
  const [toast, setToast] = (0, import_react.useState)(null);
  const [picking, setPicking] = (0, import_react.useState)(false);
  const [trash, setTrash] = (0, import_react.useState)([]);
  const [pendingQueue, setPendingQueue] = (0, import_react.useState)([]);
  const cancelQueuedMove = async (sid) => {
    try {
      await postJSON("/archived-sessions/pending-moves/cancel", { sessionIds: [sid] });
      showToast("\u5DF2\u53D6\u6D88\u6392\u961F\uFF0C\u4F1A\u8BDD\u7559\u5728\u539F\u5DE5\u4F5C\u533A", "ok");
      setPendingQueue((q) => q.filter((x) => String(x.sessionId) !== String(sid)));
    } catch (e) {
      showToast("\u53D6\u6D88\u5931\u8D25\uFF1A" + String(e && e.message || e), "err");
    }
  };
  const [trashBusy, setTrashBusy] = (0, import_react.useState)(null);
  const [trashSettings, setTrashSettings] = (0, import_react.useState)({ retentionDays: 0 });
  const [trashCheck, setTrashCheck] = (0, import_react.useState)(null);
  const [purgeTarget, setPurgeTarget] = (0, import_react.useState)(null);
  const [details, setDetails] = (0, import_react.useState)({});
  const detailsAt = (0, import_react.useRef)({});
  const [openDetails, setOpenDetails] = (0, import_react.useState)(null);
  const [detailsLoading, setDetailsLoading] = (0, import_react.useState)(null);
  const [mdBusy, setMdBusy] = (0, import_react.useState)(null);
  const [zipOk, setZipOk] = (0, import_react.useState)(true);
  const [storage, setStorage] = (0, import_react.useState)(null);
  const [storageBusy, setStorageBusy] = (0, import_react.useState)(false);
  const [storageOpen, setStorageOpen] = (0, import_react.useState)(false);
  const [storageError, setStorageError] = (0, import_react.useState)(null);
  const [aa, setAa] = (0, import_react.useState)({ settings: { inactiveDays: 0, skipStarred: true }, lastRunAt: null, lastArchivedCount: 0 });
  const [aaOpen, setAaOpen] = (0, import_react.useState)(false);
  const [aaBusy, setAaBusy] = (0, import_react.useState)(false);
  const zipChecked = (0, import_react.useRef)(false);
  const [openMenu, setOpenMenu] = (0, import_react.useState)(null);
  const timer = (0, import_react.useRef)(null);
  const storageDirty = (0, import_react.useRef)(false);
  const menuRef = (0, import_react.useRef)(null);
  const dialogRef = (0, import_react.useRef)(null);
  const [lineage, setLineage] = (0, import_react.useState)({});
  const [openKids, setOpenKids] = (0, import_react.useState)({});
  const [openBranches, setOpenBranches] = (0, import_react.useState)(() => {
    try {
      const v = JSON.parse(localStorage.getItem("dsm-branch-open-v1") || "[]");
      const o = {};
      for (const k of Array.isArray(v) ? v : []) if (typeof k === "string") o[k] = true;
      return o;
    } catch (e) {
      return {};
    }
  });
  const toggleBranch = (rootId) => setOpenBranches((prev) => {
    const next = Object.assign({}, prev);
    if (next[rootId]) delete next[rootId];
    else next[rootId] = true;
    try {
      localStorage.setItem("dsm-branch-open-v1", JSON.stringify(Object.keys(next)));
    } catch (e) {
    }
    return next;
  });
  const [groupByLineage, setGroupByLineage] = (0, import_react.useState)(() => initialPrefs.groupByLineage !== false);
  const [tagDefs, setTagDefs] = (0, import_react.useState)([]);
  const [assignments, setAssignments] = (0, import_react.useState)({});
  const [tagsState, setTagsState] = (0, import_react.useState)("loading");
  const tagsReady = tagsState === "ready";
  const [tagFilter, setTagFilter] = (0, import_react.useState)("");
  const [savedFilters, setSavedFilters] = (0, import_react.useState)([]);
  const [openTags, setOpenTags] = (0, import_react.useState)(null);
  const [openTagMgr, setOpenTagMgr] = (0, import_react.useState)(false);
  const [tagBusy, setTagBusy] = (0, import_react.useState)(null);
  const [mgrBusy, setMgrBusy] = (0, import_react.useState)(false);
  const [cardTagName, setCardTagName] = (0, import_react.useState)("");
  const [mgrTagName, setMgrTagName] = (0, import_react.useState)("");
  const [renamingTagId, setRenamingTagId] = (0, import_react.useState)(null);
  const [renameTagValue, setRenameTagValue] = (0, import_react.useState)("");
  const [mergeTarget, setMergeTarget] = (0, import_react.useState)({});
  const [saveFilterOpen, setSaveFilterOpen] = (0, import_react.useState)(false);
  const [saveFilterName, setSaveFilterName] = (0, import_react.useState)("");
  const [appliedSavedId, setAppliedSavedId] = (0, import_react.useState)("");
  const tagFilterRef = (0, import_react.useRef)("");
  tagFilterRef.current = tagFilter;
  const tagMap = (0, import_react.useMemo)(() => new Map(tagDefs.map((t) => [String(t.id), String(t.name)])), [tagDefs]);
  const tagUsage = (0, import_react.useMemo)(() => {
    const m = {};
    for (const ids of Object.values(assignments)) for (const id of Array.isArray(ids) ? ids : []) m[String(id)] = (m[String(id)] || 0) + 1;
    return m;
  }, [assignments]);
  const tagsBlockedTitle = tagsState === "failed" ? "\u6807\u7B7E\u6570\u636E\u672A\u80FD\u52A0\u8F7D\uFF0C\u6682\u65F6\u65E0\u6CD5\u4F7F\u7528\u6807\u7B7E\u529F\u80FD\uFF08\u91CD\u65B0\u6253\u5F00\u8BBE\u7F6E\u9762\u677F\u53EF\u91CD\u8BD5\uFF09" : "\u6807\u7B7E\u6570\u636E\u52A0\u8F7D\u4E2D\uFF0C\u7A0D\u5019\u5373\u53EF\u4F7F\u7528";
  const loadTags = () => postJSON("/archived-sessions/tags/list", {}).then((r) => {
    const defs = r && Array.isArray(r.tags) ? r.tags : [];
    setTagDefs(defs);
    setAssignments(r && r.assignments && typeof r.assignments === "object" && !Array.isArray(r.assignments) ? r.assignments : {});
    setTagsState("ready");
    const cur = tagFilterRef.current;
    if (cur && !defs.some((t) => String(t.id) === cur)) setTagFilter("");
  }).catch(() => {
    setTagDefs([]);
    setAssignments({});
    setTagsState("failed");
    if (tagFilterRef.current) setTagFilter("");
  });
  const loadSavedFilters = () => postJSON("/archived-sessions/filters/list", {}).then((r) => setSavedFilters(r && Array.isArray(r.items) ? r.items : [])).catch(() => setSavedFilters([]));
  const setSessionTags = async (sid, nextIds) => {
    const key = String(sid);
    const prev = Array.isArray(assignments[key]) ? assignments[key].slice() : [];
    if (prev.length === nextIds.length && prev.every((t, i) => String(t) === String(nextIds[i]))) return;
    const writeLocal = (ids) => {
      setAssignments((a) => {
        const n = Object.assign({}, a);
        if (ids.length) n[key] = ids;
        else delete n[key];
        return n;
      });
      setSessions((s) => s && s.map((x) => String(x.sessionId) === key ? Object.assign({}, x, { tags: ids }) : x));
    };
    writeLocal(nextIds);
    setTagBusy(key);
    try {
      const r = await postJSON("/archived-sessions/tags/set", { sessionId: sid, tagIds: nextIds });
      const row = r && r.assignments && Array.isArray(r.assignments[key]) ? r.assignments[key].map(String) : nextIds.map(String);
      writeLocal(row);
    } catch (e) {
      writeLocal(prev);
      showToast("\u6807\u7B7E\u8BBE\u7F6E\u5931\u8D25\uFF1A" + String(e && e.message || e), "err");
    } finally {
      setTagBusy(null);
    }
  };
  const toggleTagFor = (sid, tagId) => {
    if (tagBusy !== null) return;
    const key = String(sid);
    const cur = Array.isArray(assignments[key]) ? assignments[key] : [];
    const has = cur.some((t) => String(t) === String(tagId));
    const next = has ? cur.filter((t) => String(t) !== String(tagId)) : cur.concat(String(tagId));
    setSessionTags(sid, next);
  };
  const createTagAndAttach = async (sid) => {
    const name = cardTagName.trim();
    if (!name || tagBusy !== null) return;
    setTagBusy(String(sid));
    let fresh = null;
    try {
      const r = await postJSON("/archived-sessions/tags/create", { name });
      if (r && r.tag && r.tag.id != null) fresh = r.tag;
      else throw new Error("\u670D\u52A1\u7AEF\u672A\u8FD4\u56DE\u65B0\u6807\u7B7E");
    } catch (e) {
      showToast("\u65B0\u5EFA\u6807\u7B7E\u5931\u8D25\uFF1A" + String(e && e.message || e), "err");
    }
    if (!fresh) {
      setTagBusy(null);
      return;
    }
    setTagDefs((d) => d.some((t) => String(t.id) === String(fresh.id)) ? d : d.concat(fresh));
    const cur = Array.isArray(assignments[String(sid)]) ? assignments[String(sid)].slice() : [];
    setCardTagName("");
    await setSessionTags(sid, cur.concat(String(fresh.id)));
  };
  const createTag = async () => {
    const name = mgrTagName.trim();
    if (!name || mgrBusy) return;
    setMgrBusy(true);
    try {
      const r = await postJSON("/archived-sessions/tags/create", { name });
      if (r && r.tag && r.tag.id != null) {
        const fresh = r.tag;
        setTagDefs((d) => d.some((t) => String(t.id) === String(fresh.id)) ? d : d.concat(fresh));
        setMgrTagName("");
      }
    } catch (e) {
      showToast("\u65B0\u5EFA\u6807\u7B7E\u5931\u8D25\uFF1A" + String(e && e.message || e), "err");
    } finally {
      setMgrBusy(false);
    }
  };
  const commitTagRename = async (tag) => {
    const name = renameTagValue.trim();
    if (!name || mgrBusy) {
      setRenamingTagId(null);
      return;
    }
    if (name === tag.name) {
      setRenamingTagId(null);
      return;
    }
    setMgrBusy(true);
    try {
      await postJSON("/archived-sessions/tags/rename", { id: tag.id, name });
      setTagDefs((d) => d.map((t) => String(t.id) === String(tag.id) ? Object.assign({}, t, { name }) : t));
      setRenamingTagId(null);
    } catch (e) {
      showToast("\u91CD\u547D\u540D\u5931\u8D25\uFF1A" + String(e && e.message || e), "err");
    } finally {
      setMgrBusy(false);
    }
  };
  const deleteTag = async (tag) => {
    if (mgrBusy) return;
    if (!window.confirm(tagDeleteConfirm(tag.name))) return;
    setMgrBusy(true);
    try {
      await postJSON("/archived-sessions/tags/delete", { id: tag.id });
      const gone = String(tag.id);
      setTagDefs((d) => d.filter((t) => String(t.id) !== gone));
      setAssignments((a) => {
        const n = {};
        for (const [sid, ids] of Object.entries(a)) {
          const kept = (Array.isArray(ids) ? ids : []).filter((id) => String(id) !== gone);
          if (kept.length) n[sid] = kept;
        }
        return n;
      });
      setSessions((s) => s && s.map((x) => {
        const curT = Array.isArray(x.tags) ? x.tags : [];
        if (!curT.some((id) => String(id) === gone)) return x;
        return Object.assign({}, x, { tags: curT.filter((id) => String(id) !== gone) });
      }));
      if (tagFilterRef.current === gone) setTagFilter("");
      setMergeTarget((m) => {
        const n = Object.assign({}, m);
        delete n[gone];
        return n;
      });
    } catch (e) {
      showToast("\u5220\u9664\u6807\u7B7E\u5931\u8D25\uFF1A" + String(e && e.message || e), "err");
    } finally {
      setMgrBusy(false);
    }
  };
  const mergeTag = async (from) => {
    const toId = mergeTarget[String(from.id)];
    if (!toId || mgrBusy) return;
    setMgrBusy(true);
    try {
      await postJSON("/archived-sessions/tags/merge", { fromId: from.id, toId });
      const gone = String(from.id);
      setTagDefs((d) => d.filter((t) => String(t.id) !== gone));
      setAssignments((a) => {
        const n = {};
        for (const [sid, ids] of Object.entries(a)) {
          const kept = [];
          const seen = /* @__PURE__ */ new Set();
          for (const id of Array.isArray(ids) ? ids : []) {
            const v = String(id) === gone ? String(toId) : String(id);
            if (seen.has(v)) continue;
            seen.add(v);
            kept.push(v);
          }
          if (kept.length) n[sid] = kept;
        }
        return n;
      });
      if (tagFilterRef.current === gone) setTagFilter(String(toId));
      setMergeTarget((m) => {
        const n = Object.assign({}, m);
        delete n[gone];
        return n;
      });
      setSessions((s) => s && s.map((x) => {
        const curT = Array.isArray(x.tags) ? x.tags : [];
        if (!curT.some((id) => String(id) === gone)) return x;
        const nextT = [];
        const seenT = /* @__PURE__ */ new Set();
        for (const id of curT) {
          const v = String(id) === gone ? String(toId) : String(id);
          if (seenT.has(v)) continue;
          seenT.add(v);
          nextT.push(v);
        }
        return Object.assign({}, x, { tags: nextT });
      }));
      showToast(`\u5DF2\u5E76\u5165\u300C${tagMap.get(String(toId)) || "\u76EE\u6807\u6807\u7B7E"}\u300D`);
    } catch (e) {
      showToast("\u5408\u5E76\u6807\u7B7E\u5931\u8D25\uFF1A" + String(e && e.message || e), "err");
    } finally {
      setMgrBusy(false);
    }
  };
  const saveCurrentFilter = async () => {
    const name = saveFilterName.trim();
    if (!name || mgrBusy) return;
    setMgrBusy(true);
    try {
      const r = await postJSON("/archived-sessions/filters/save", {
        name,
        filters: filterSnapshotOf({ filter, workspaceFilter, sortBy, tagFilter })
      });
      if (r && r.item) setSavedFilters((l) => l.some((x) => String(x.id) === String(r.item.id)) ? l : l.concat(r.item));
      setSaveFilterOpen(false);
      setSaveFilterName("");
      showToast(`\u5DF2\u4FDD\u5B58\u7B5B\u9009\u300C${r && r.item && r.item.name || name}\u300D`);
    } catch (e) {
      showToast("\u4FDD\u5B58\u7B5B\u9009\u5931\u8D25\uFF1A" + String(e && e.message || e), "err");
    } finally {
      setMgrBusy(false);
    }
  };
  const applySavedFilter = (id) => {
    const key = String(id);
    setAppliedSavedId(key);
    if (!key) return;
    const item = savedFilters.find((x) => String(x.id) === key);
    if (!item) return;
    const shape = filterShapeFromSaved(item);
    const tagUnavailable = !!shape.tag && (!tagsReady || !tagMap.has(shape.tag));
    const degraded = shape.degraded.slice();
    if (tagUnavailable) degraded.push("tag");
    setFilter(shape.view);
    clearSel();
    setConfirmBatch(false);
    if (shape.view === "starred" || shape.view === "empty" || shape.view === "trash") setMoreOpen(true);
    setWorkspaceFilter(shape.workspace);
    setSortBy(shape.sort);
    setTagFilter(tagUnavailable ? "" : shape.tag);
    if (degraded.length) {
      const labels = { view: "\u89C6\u56FE", workspace: "\u5DE5\u4F5C\u533A", sort: "\u6392\u5E8F", tag: "\u6807\u7B7E" };
      showToast(`\u5DF2\u5E94\u7528\u7B5B\u9009\u300C${item.name}\u300D\uFF0C\u4F46\u5176\u4E2D ${[...new Set(degraded)].map((k) => labels[k] || k).join("\u3001")} \u6761\u4EF6\u5DF2\u5931\u6548\u5E76\u56DE\u843D\u9ED8\u8BA4`, "err");
    }
  };
  const deleteSavedFilter = async (id) => {
    if (mgrBusy) return;
    setMgrBusy(true);
    try {
      await postJSON("/archived-sessions/filters/delete", { ids: [id] });
      setSavedFilters((l) => l.filter((x) => String(x.id) !== String(id)));
      if (String(appliedSavedId) === String(id)) setAppliedSavedId("");
    } catch (e) {
      showToast("\u5220\u9664\u5DF2\u5B58\u7B5B\u9009\u5931\u8D25\uFF1A" + String(e && e.message || e), "err");
    } finally {
      setMgrBusy(false);
    }
  };
  const loadLineage = () => postJSON("/archived-sessions/sidebar-state", {}).then((r) => setLineage(r && r.lineage || {})).catch(() => {
  });
  const showToast = (msg, kind) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ msg, kind: kind === "err" ? "err" : "ok" });
    timer.current = setTimeout(() => setToast(null), toastDurationFor(msg, kind));
  };
  const refresh = () => {
    setError(null);
    Promise.all([
      postJSON("/archived-sessions/sessions", {}),
      postJSON("/archived-sessions/workspaces", {}),
      postJSON("/archived-sessions/capabilities", {})
    ]).then(([s, works, caps]) => {
      const purged = dsmLoadPurged();
      const visible = (s.items || []).filter((x) => !purged.has(String(x.sessionId)));
      setSessions(visible);
      setWorkspaces(works.items || []);
      setCapabilities(caps || null);
      if (caps && caps.buildStamp) console.info("[dsh-sessions-manager] host build:", caps.buildStamp);
      setSelected({});
      setDelTarget(null);
      setConfirmBatch(false);
      loadLineage();
      if (!targetWs && works.items && works.items.length) setTargetWs(works.items[0].workspaceId);
      loadTrash();
      loadTags();
      loadSavedFilters();
      postJSON("/archived-sessions/pending-moves", {}).then((q) => setPendingQueue(q && q.items || [])).catch(() => {
      });
      if (storageOpen) loadStorage();
      else storageDirty.current = true;
    }).catch((e) => setError(String(e && e.message || e)));
  };
  (0, import_react.useEffect)(() => {
    refresh();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  const refreshRef = (0, import_react.useRef)(null);
  refreshRef.current = refresh;
  (0, import_react.useEffect)(() => dsmOnWarmDone(() => {
    if (refreshRef.current) refreshRef.current();
  }), []);
  (0, import_react.useEffect)(() => dsmOnNotice((text, kind) => showToast(text, kind)), []);
  (0, import_react.useEffect)(() => {
    try {
      localStorage.setItem(PANEL_PREFS_KEY, JSON.stringify({ filter, workspaceFilter, sortBy, groupByLineage }));
    } catch (e) {
    }
  }, [filter, workspaceFilter, sortBy, groupByLineage]);
  (0, import_react.useEffect)(() => {
    loadAutoArchive();
  }, []);
  const toggleStar = async (it) => {
    const next = !it.starred;
    setSessions((s) => s && s.map((x) => x.sessionId === it.sessionId ? { ...x, starred: next } : x));
    try {
      await postJSON("/archived-sessions/star/set", { sessionId: it.sessionId, starred: next });
    } catch (e) {
      setSessions((s) => s && s.map((x) => x.sessionId === it.sessionId ? { ...x, starred: !next } : x));
      showToast("\u6536\u85CF\u5931\u8D25\uFF1A" + String(e && e.message || e));
    }
  };
  const exportMarkdown = async (it) => {
    if (mdBusy) return;
    setMdBusy(it.sessionId);
    try {
      const res = await fetch("/archived-sessions/export-md?sessionId=" + encodeURIComponent(it.sessionId));
      if (!res.ok) throw new Error("HTTP " + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "dsh-session-" + it.sessionId + ".md";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast("\u5DF2\u5BFC\u51FA Markdown");
    } catch (e) {
      showToast("\u5BFC\u51FA\u5931\u8D25\uFF1A" + String(e && e.message || e));
    } finally {
      setMdBusy(null);
    }
  };
  (0, import_react.useEffect)(() => {
    if (openDetails === null || zipChecked.current) return;
    zipChecked.current = true;
    fetch("/api/session.export?sessionId=probe&includeDescendants=false", { method: "HEAD" }).then((res) => setZipOk(res.status !== 501)).catch(() => setZipOk(true));
  }, [openDetails]);
  (0, import_react.useEffect)(() => {
    if (openMenu === null) return;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpenMenu(null);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);
  (0, import_react.useEffect)(() => {
    if (!delTarget && !purgeTarget) return;
    const previous = document.activeElement;
    const onKey = (e) => {
      if (e.key === "Escape") {
        setDelTarget(null);
        setPurgeTarget(null);
      }
    };
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(() => dialogRef.current && dialogRef.current.querySelector("button")?.focus());
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previous && typeof previous.focus === "function") previous.focus();
    };
  }, [delTarget, purgeTarget]);
  const wsPath = (id) => {
    const w = workspaces.find((x) => x.workspaceId === id);
    return w ? w.path : "";
  };
  const actionCapability = (name, legacy) => {
    const source = capabilities && capabilities.actions;
    return source && (source[name] || legacy && source[legacy]) || { available: false, reason: "\u6B63\u5728\u68C0\u67E5\u5F53\u524D DSH \u7684\u517C\u5BB9\u80FD\u529B\u2026" };
  };
  const canPurge = actionCapability("physicalPurge", "purge");
  const canMove = actionCapability("relocateSession", "move");
  const canRestoreTrash = actionCapability("restoreIndexedSession", "restoreTrash");
  const archivedList = sessions ? sessions.filter((x) => x.archived) : [];
  const activeList = sessions ? sessions.filter((x) => !x.archived) : [];
  const starredList = starredOf(sessions);
  const emptyList = (0, import_react.useMemo)(() => {
    if (!sessions) return [];
    return sessions.filter((x) => {
      const li = lineage[String(x.sessionId)];
      return !!(li && li.empty);
    });
  }, [sessions, lineage]);
  const list = (0, import_react.useMemo)(() => {
    if (filter === "trash") return [];
    const base = filter === "archived" ? archivedList : filter === "active" ? activeList : filter === "starred" ? starredList : filter === "empty" ? emptyList : sessions || [];
    const tagPassed = applyTagFilter(base, tagsReady ? tagFilter : "");
    const needle = query.trim().toLocaleLowerCase();
    const filtered = tagPassed.filter((item) => {
      if (workspaceFilter !== "all" && (item.workspacePath || "") !== workspaceFilter) return false;
      if (!needle) return true;
      return [effectiveTitleOf(item, dsmAuthoritativeTitles), item.sessionId, item.workspaceTitle, item.workspacePath].some((value) => String(value || "").toLocaleLowerCase().includes(needle));
    });
    return [...filtered].sort((a, b) => {
      if (sortBy === "oldest") return Number(a.createdAt || 0) - Number(b.createdAt || 0);
      if (sortBy === "title") return effectiveTitleOf(a, dsmAuthoritativeTitles).localeCompare(effectiveTitleOf(b, dsmAuthoritativeTitles), "zh-CN");
      return Number(b.createdAt || 0) - Number(a.createdAt || 0);
    });
  }, [sessions, filter, query, workspaceFilter, sortBy, emptyList, starredList, tagFilter, tagsReady]);
  const selIds = Object.keys(selected).filter((k) => selected[k]);
  const showSessionList = filter !== "trash";
  const { topList, kidsOf, foldedCount, branchGroupsOf, branchFolded, branchGroupCount } = (0, import_react.useMemo)(() => {
    if (!groupByLineage) return { topList: list, kidsOf: /* @__PURE__ */ new Map(), foldedCount: 0, branchGroupsOf: /* @__PURE__ */ new Map(), branchFolded: 0, branchGroupCount: 0 };
    const kids = foldSubagents(list, lineage);
    const br = foldBranches(kids.topList, lineage);
    return { topList: br.topList, kidsOf: kids.kidsOf, foldedCount: kids.foldedCount, branchGroupsOf: br.branchGroupsOf, branchFolded: br.foldedCount, branchGroupCount: br.groupCount };
  }, [list, lineage, groupByLineage]);
  const matchIds = (0, import_react.useMemo)(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return null;
    return new Set((sessions || []).filter((item) => [effectiveTitleOf(item, dsmAuthoritativeTitles), item.sessionId, item.workspaceTitle, item.workspacePath].some((v) => String(v || "").toLocaleLowerCase().includes(needle))).map((i) => String(i.sessionId)));
  }, [sessions, query]);
  const kidsHit = (parentId) => !!(matchIds && (kidsOf.get(String(parentId)) || []).some((k) => matchIds.has(String(k.sessionId))));
  const branchHit = (rootId) => !!(matchIds && (branchGroupsOf.get(String(rootId)) || []).some((m) => matchIds.has(String(m.sessionId))));
  const syntheticCount = groupByLineage ? topList.reduce((n, it) => n + (it && it.syntheticRoot ? 1 : 0), 0) : 0;
  const kidsBadge = (sessionId) => {
    if (!groupByLineage) return null;
    const kids = kidsOf.get(String(sessionId)) || [];
    if (!kids.length) return null;
    const open = !!openKids[sessionId] || kidsHit(sessionId);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        className: "dsm-kids-toggle",
        "aria-expanded": open,
        title: (open ? "\u6536\u8D77" : "\u5C55\u5F00") + " " + kids.length + " \u4E2A\u5B50\u4EE3\u7406\u4F1A\u8BDD",
        onClick: () => setOpenKids((s) => ({ ...s, [sessionId]: !s[sessionId] })),
        children: [
          open ? "\u25BE" : "\u25B8",
          " ",
          kids.length,
          " \u5B50\u4EE3\u7406"
        ]
      }
    );
  };
  const sessionsById = (0, import_react.useMemo)(() => new Map((sessions || []).map((x) => [String(x.sessionId), x])), [sessions]);
  const branchBadge = (sessionId) => {
    const li = lineage[String(sessionId)];
    if (!li || li.origin === "subagent" || !li.parentSession) return null;
    const parent = sessionsById.get(String(li.parentSession));
    const label = parent && parent.title ? `\u5206\u652F\u4E8E\uFF1A${parent.title}` : `\u5206\u652F\u4F1A\u8BDD\uFF08\u6765\u6E90\uFF1A${shortId(li.parentSession)}\uFF09`;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsm-branch-chip", title: label, children: "\u2442 \u5206\u652F" });
  };
  const emptyBadge = (sessionId) => {
    const li = lineage[String(sessionId)];
    if (!li || !li.empty) return null;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsm-empty-chip", title: "\u65E0\u5185\u5BB9\u7684\u7A7A\u767D\u4F1A\u8BDD", children: "\u7A7A\u767D" });
  };
  const tagChips = (sessionId) => {
    if (!tagsReady) return null;
    const ids = Array.isArray(assignments[String(sessionId)]) ? assignments[String(sessionId)] : [];
    const names = [];
    for (const id of ids) {
      const n = tagMap.get(String(id));
      if (n) names.push(n);
    }
    if (!names.length) return null;
    const shown = names.slice(0, 3);
    const rest = names.slice(3);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      shown.map((n, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsm-tagchip", title: "\u6807\u7B7E\uFF1A" + n, children: n }, i)),
      rest.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsm-tagchip dsm-tagchip-more", title: "\u53E6\u6709\u6807\u7B7E\uFF1A" + rest.join("\u3001"), children: [
        "+",
        rest.length
      ] })
    ] });
  };
  const renderKids = (parentId, depth) => {
    const kids = kidsOf.get(String(parentId)) || [];
    if (!kids.length || !(openKids[parentId] || kidsHit(parentId))) return null;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsm-kids", children: kids.map((k) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsm-kid", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsm-kid-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsm-kid-name", title: k.title || k.sessionId, children: k.title || "(\u65E0\u6807\u9898)" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsm-kid-meta", children: [
          k.archived ? "\u5DF2\u5F52\u6863" : "\u6D3B\u52A8",
          fmtDate(k.createdAt) ? ` \xB7 ${fmtDate(k.createdAt)}` : ""
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsm-kid-acts", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", disabled: busy !== null, title: "\u5207\u6362\u5230\u8FD9\u4E2A\u5B50\u4EE3\u7406\u4F1A\u8BDD\uFF08\u8BBE\u7F6E\u9762\u677F\u6321\u7740\u4F1A\u8BDD\u533A\uFF0C\u5173\u6389\u5373\u53EF\u770B\u5230\uFF09", onClick: async () => {
            const name = k.title || String(k.sessionId).slice(0, 8) + "\u2026";
            const res = await dsmOpenSessionById(k.sessionId, parentId);
            const msg = openSubagentToast(res, name, "panel");
            showToast(msg.text, msg.kind);
          }, children: "\u6253\u5F00" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", disabled: busy !== null, onClick: () => act(k.archived ? "restore" : "archive", k), children: k.archived ? "\u6062\u590D" : "\u5F52\u6863" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn archv-del", disabled: busy !== null, title: "\u79FB\u5165\u56DE\u6536\u7AD9\uFF0C\u53EF\u5728\u56DE\u6536\u7AD9\u6062\u590D", onClick: () => setDelTarget(k), children: "\u5220\u9664" })
        ] })
      ] }),
      (depth || 0) < 4 && renderKids(k.sessionId, (depth || 0) + 1)
    ] }, k.sessionId)) });
  };
  const branchGroupBadge = (sessionId) => {
    if (!groupByLineage) return null;
    const members = branchGroupsOf.get(String(sessionId)) || [];
    if (!members.length) return null;
    const open = !!openBranches[sessionId] || branchHit(sessionId);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        className: "dsm-kids-toggle",
        "aria-expanded": open,
        title: (open ? "\u6536\u8D77 " : "\u5C55\u5F00 ") + members.length + " \u4E2A\u5206\u652F\u4F1A\u8BDD",
        onClick: () => toggleBranch(sessionId),
        children: [
          open ? "\u25BE" : "\u25B8",
          " ",
          members.length,
          " \u5206\u652F"
        ]
      }
    );
  };
  const renderBranchGroup = (rootId) => {
    const members = branchGroupsOf.get(String(rootId)) || [];
    if (!members.length || !(openBranches[rootId] || branchHit(rootId))) return null;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsm-kids", "aria-label": "\u5206\u652F\u4F1A\u8BDD", children: members.map((k) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsm-kid", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsm-kid-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsm-kid-name", title: k.title || k.sessionId, children: k.title || "(\u65E0\u6807\u9898)" }),
        branchBadge(k.sessionId),
        emptyBadge(k.sessionId),
        kidsBadge(k.sessionId),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsm-kid-meta", children: [
          k.archived ? "\u5DF2\u5F52\u6863" : "\u6D3B\u52A8",
          fmtDate(k.createdAt) ? ` \xB7 ${fmtDate(k.createdAt)}` : ""
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsm-kid-acts", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", disabled: busy !== null, title: "\u5207\u6362\u5230\u8FD9\u4E2A\u5206\u652F\u4F1A\u8BDD\uFF08\u8BBE\u7F6E\u9762\u677F\u6321\u7740\u4F1A\u8BDD\u533A\uFF0C\u5173\u6389\u5373\u53EF\u770B\u5230\uFF09", onClick: async () => {
            const name = k.title || String(k.sessionId).slice(0, 8) + "\u2026";
            const li = lineage[String(k.sessionId)];
            const res = await dsmOpenSessionById(k.sessionId, li && li.parentSession || rootId);
            const msg = openSubagentToast(res, name, "panel");
            showToast(msg.text, msg.kind);
          }, children: "\u6253\u5F00" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", disabled: busy !== null, onClick: () => act(k.archived ? "restore" : "archive", k), children: k.archived ? "\u6062\u590D" : "\u5F52\u6863" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn archv-del", disabled: busy !== null, title: "\u79FB\u5165\u56DE\u6536\u7AD9\uFF0C\u53EF\u5728\u56DE\u6536\u7AD9\u6062\u590D", onClick: () => setDelTarget(k), children: "\u5220\u9664" })
        ] })
      ] }),
      renderKids(k.sessionId, 1)
    ] }, k.sessionId)) });
  };
  const toggle = (id) => setSelected((s) => ({ ...s, [id]: !s[id] }));
  const clearSel = () => setSelected({});
  const selectAll = () => {
    const o = {};
    list.forEach((x) => {
      o[x.sessionId] = true;
    });
    setSelected(o);
  };
  const act = (action, it) => {
    if (busy) return;
    setBusy(it.sessionId);
    postJSON("/archived-sessions/" + action, { sessionId: it.sessionId }).then(() => {
      setBusy(null);
      const n = it.title || it.sessionId;
      showToast(action === "archive" ? `\u5DF2\u5F52\u6863\u300C${n}\u300D` : `\u5DF2\u6062\u590D\u300C${n}\u300D`);
      setSessions((s) => s && s.map((x) => x.sessionId === it.sessionId ? { ...x, archived: action === "archive" } : x));
    }).catch((e) => {
      setBusy(null);
      setError(String(e && e.message || e));
    });
  };
  const doDeleteConfirmed = () => {
    if (!delTarget || busy) return;
    setBusy(delTarget.sessionId);
    postJSON("/archived-sessions/delete", { sessionId: delTarget.sessionId }).then(() => {
      setBusy(null);
      const n = delTarget.title || delTarget.sessionId;
      showToast(`\u5DF2\u5220\u9664 ${n}\uFF08\u5DF2\u79FB\u5165\u56DE\u6536\u7AD9\uFF09`);
      const sid = String(delTarget.sessionId);
      setDelTarget(null);
      setSessions((s) => s && s.filter((x) => String(x.sessionId) !== sid));
      loadTrash();
      dsmLoadTrashIds();
    }).catch((e) => {
      setBusy(null);
      setDelTarget(null);
      setError(String(e && e.message || e));
    });
  };
  const loadTrash = () => {
    postJSON("/archived-sessions/trash/list", {}).then((r) => {
      setTrash(r.items || []);
      setTrashSettings(r.settings || { retentionDays: 0 });
    }).catch(() => {
    });
  };
  const updateRetention = (days) => {
    setTrashBusy("__settings");
    postJSON("/archived-sessions/trash/settings", { retentionDays: Number(days) }).then((r) => {
      setTrashBusy(null);
      setTrashSettings(r.settings);
      showToast("\u5DF2\u66F4\u65B0\u81EA\u52A8\u6E05\u7406\u7B56\u7565");
    }).catch((e) => {
      setTrashBusy(null);
      setError(String(e && e.message || e));
    });
  };
  const verifyTrash = () => {
    setTrashBusy("__verify");
    postJSON("/archived-sessions/trash/verify", {}).then((r) => {
      setTrashBusy(null);
      setTrashCheck(r);
      if (r.missing) showToast(`\u53D1\u73B0 ${r.missing} \u6761\u65E5\u5FD7\u7F3A\u5931`);
      else if (r.unverified) showToast(`${r.unverified} \u6761\u65E5\u5FD7\u4F4D\u7F6E\u7531\u5F53\u524D Runtime \u7BA1\u7406\uFF0C\u65E0\u6CD5\u76F4\u63A5\u6838\u9A8C`);
      else showToast("\u56DE\u6536\u7AD9\u6821\u9A8C\u901A\u8FC7");
    }).catch((e) => {
      setTrashBusy(null);
      setError(String(e && e.message || e));
    });
  };
  const loadStorage = () => {
    setStorageBusy(true);
    setStorageError(null);
    postJSON("/archived-sessions/storage", { topN: 10 }).then((r) => {
      setStorageBusy(false);
      setStorage(r);
      storageDirty.current = false;
    }).catch((e) => {
      setStorageBusy(false);
      setStorageError(String(e && e.message || e));
    });
  };
  const applyAa = (r) => setAa({ settings: r.settings || { inactiveDays: 0, skipStarred: true }, lastRunAt: r.lastRunAt ?? null, lastArchivedCount: r.lastArchivedCount || 0 });
  const loadAutoArchive = () => {
    postJSON("/archived-sessions/auto-archive/settings", {}).then(applyAa).catch(() => {
    });
  };
  const updateAutoArchive = (patch) => {
    if (aaBusy) return;
    setAaBusy(true);
    postJSON("/archived-sessions/auto-archive/settings", patch).then((r) => {
      setAaBusy(false);
      applyAa(r);
      showToast("\u5DF2\u66F4\u65B0\u81EA\u52A8\u5F52\u6863\u7B56\u7565");
    }).catch((e) => {
      setAaBusy(false);
      setError(String(e && e.message || e));
    });
  };
  const runAutoArchive = () => {
    if (aaBusy) return;
    setAaBusy(true);
    postJSON("/archived-sessions/auto-archive/run", {}).then((r) => {
      setAaBusy(false);
      applyAa(r);
      const n = r.archived || 0;
      if (r.skipped === "disabled") showToast("\u81EA\u52A8\u5F52\u6863\u672A\u542F\u7528");
      else {
        showToast(`\u5DF2\u81EA\u52A8\u5F52\u6863 ${n} \u4E2A\u4F1A\u8BDD`);
        if (n > 0) refresh();
      }
    }).catch((e) => {
      setAaBusy(false);
      setError(String(e && e.message || e));
    });
  };
  const restoreTrash = (sid) => {
    if (trashBusy) return;
    setTrashBusy(sid);
    postJSON("/archived-sessions/trash/restore", { sessionId: sid }).then((r) => {
      setTrashBusy(null);
      showToast(r && r.workspaceGone ? "\u5DF2\u6062\u590D\u4F1A\u8BDD\uFF08\u539F\u5DE5\u4F5C\u533A\u5DF2\u5220\u9664\uFF0C\u4F1A\u8BDD\u6682\u5F52\u300C\u672A\u5206\u7EC4\u300D\uFF09" : "\u5DF2\u6062\u590D\u4F1A\u8BDD");
      loadTrash();
      refresh();
    }).catch((e) => {
      setTrashBusy(null);
      setError(String(e && e.message || e));
    });
  };
  const purgeTrash = (sid) => {
    if (trashBusy) return;
    setTrashBusy(sid);
    postJSON("/archived-sessions/trash/purge", { sessionId: sid }).then(() => {
      setTrashBusy(null);
      showToast("\u5DF2\u5F7B\u5E95\u5220\u9664");
      dsmMarkPurged([sid]);
      dsmLoadTrashIds();
      loadTrash();
    }).catch((e) => {
      setTrashBusy(null);
      setError(String(e && e.message || e));
    });
  };
  const purgeAllTrash = () => {
    if (trashBusy || !trash.length) return;
    setTrashBusy("__all");
    const all = trash.map((t) => t.sessionId);
    postJSON("/archived-sessions/trash/purge-many", { sessionIds: all }).then((result) => {
      setTrashBusy(null);
      const rows = result.results || [];
      const succeeded = rows.filter((item) => item.ok).map((item) => item.sessionId);
      const failed = rows.filter((item) => !item.ok);
      if (succeeded.length) dsmMarkPurged(succeeded);
      dsmLoadTrashIds();
      loadTrash();
      if (failed.length) {
        const first = failed[0];
        setError(`\u6E05\u7406\u5B8C\u6210 ${succeeded.length} \u6761\uFF0C\u5931\u8D25 ${failed.length} \u6761\uFF1A${first.error || first.sessionId}`);
      } else showToast("\u5DF2\u6E05\u7A7A\u56DE\u6536\u7AD9");
    }).catch((e) => {
      setTrashBusy(null);
      setError(String(e && e.message || e));
    });
  };
  const doMove = (it) => {
    if (!canMove.available) {
      setError(canMove.reason || "\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u8DE8\u5DE5\u4F5C\u533A\u79FB\u52A8");
      return;
    }
    const targetPath = moveMode === "new" ? newPath.trim() : wsPath(targetWs);
    if (!targetPath) {
      setError("\u8BF7\u9009\u62E9\u5DF2\u6709\u5DE5\u4F5C\u533A\u6216\u8F93\u5165\u65B0\u7684\u76EE\u6807\u76EE\u5F55\u8DEF\u5F84");
      return;
    }
    setBusy(it.sessionId);
    setError(null);
    postJSON("/archived-sessions/move", { sessionId: it.sessionId, targetPath }).then((r) => {
      setBusy(null);
      setOpenMove(null);
      setMoveMode("existing");
      setNewPath("");
      if (r && r.queued) {
        showToast(r.notes && r.notes.length ? r.notes.join(" ") : "\u4F1A\u8BDD\u6B63\u88AB DSH \u6253\u5F00\uFF0C\u5DF2\u6392\u961F\u5F85\u79FB\u52A8\u3002", "err");
        setRetry(null);
        refresh();
        return;
      }
      showToast(`\u5DF2\u628A\u300C${it.title || it.sessionId}\u300D\u79FB\u5230 ${r.workspaceTitle || targetPath}`);
      if (Array.isArray(r.notes) && r.notes.length > 0) showToast(r.notes.join(" "), "err");
      setSessions((s) => s && s.map((x) => x.sessionId === it.sessionId ? { ...x, workspacePath: r.workspacePath || targetPath, workspaceTitle: r.workspaceTitle || targetPath } : x));
      setRetry(null);
    }).catch((e) => {
      setBusy(null);
      setError(String(e && e.message || e));
      setRetry(e && e.code === BUSY_CODE ? { run: () => doMove(it) } : null);
    });
  };
  const doBatch = (action) => {
    if (!selIds.length || busy) return;
    if (action === "delete-many") {
      if (!confirmBatch) {
        setConfirmBatch(true);
        return;
      }
      setConfirmBatch(false);
    }
    setBusy("__batch__");
    postJSON("/archived-sessions/" + action, { sessionIds: selIds }).then((r) => {
      setBusy(null);
      const n = r && (r.archived || r.restored || r.deleted) || selIds.length;
      showToast(`\u5DF2\u5904\u7406 ${n} \u4E2A\u4F1A\u8BDD`);
      refresh();
    }).catch((e) => {
      setBusy(null);
      setConfirmBatch(false);
      setError(String(e && e.message || e));
    });
  };
  const doBatchMove = (retryIds) => {
    const ids = Array.isArray(retryIds) && retryIds.length ? retryIds : selIds;
    if (!ids.length || busy) return;
    if (!canMove.available) {
      setError(canMove.reason || "\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u8DE8\u5DE5\u4F5C\u533A\u79FB\u52A8");
      return;
    }
    const targetPath = moveMode === "new" ? newPath.trim() : wsPath(targetWs);
    if (!targetPath) {
      setError("\u8BF7\u9009\u62E9\u5DF2\u6709\u5DE5\u4F5C\u533A\u6216\u8F93\u5165\u65B0\u7684\u76EE\u6807\u76EE\u5F55\u8DEF\u5F84");
      return;
    }
    setBusy("__batch__");
    setError(null);
    setRetry(null);
    postJSON("/archived-sessions/move-many", { sessionIds: ids, targetPath }).then((r) => {
      setBusy(null);
      setBatchMoveOpen(false);
      setMoveMode("existing");
      setNewPath("");
      const moved = r && r.moved || 0;
      const failed = r && Array.isArray(r.failed) ? r.failed : [];
      const queued = r && Array.isArray(r.queued) ? r.queued : [];
      if (queued.length) {
        showToast(`${queued.length} \u4E2A\u4F1A\u8BDD\u5DF2\u6392\u961F\uFF08\u6B63\u88AB DSH \u6253\u5F00\uFF09\uFF0C\u91CD\u542F DSH \u540E\u81EA\u52A8\u5B8C\u6210\uFF1B\u8BF7\u5148\u522B\u6253\u5F00\u5B83\u4EEC\u3002`, "err");
      }
      if (failed.length) {
        const firstReason = failed[0] && failed[0].error ? `\uFF0C\u9996\u4E2A\u539F\u56E0\uFF1A${failed[0].error.split("\n")[0]}` : "";
        setError(`\u5DF2\u79FB\u52A8 ${moved} \u4E2A\u4F1A\u8BDD\uFF0C${failed.length} \u4E2A\u5931\u8D25\uFF08${failed.map((f) => shortId(f.sessionId)).join("\u3001")}\uFF09${firstReason}`);
        const busyIds = failed.filter((f) => f.code === BUSY_CODE).map((f) => f.sessionId);
        setRetry(busyIds.length ? { run: () => doBatchMove(busyIds) } : null);
      } else if (moved > 0) {
        showToast(`\u5DF2\u628A ${moved} \u4E2A\u4F1A\u8BDD\u79FB\u5230 ${targetPath}`);
        setRetry(null);
      } else {
        setRetry(null);
      }
      clearSel();
      refresh();
    }).catch((e) => {
      setBusy(null);
      setError(String(e && e.message || e));
      setRetry(e && e.code === BUSY_CODE ? { run: () => doBatchMove(ids) } : null);
    });
  };
  const openMoveFor = (it) => {
    if (!canMove.available) {
      setError(canMove.reason || "\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u8DE8\u5DE5\u4F5C\u533A\u79FB\u52A8");
      return;
    }
    if (openMove === it.sessionId) {
      setOpenMove(null);
      return;
    }
    setOpenTags(null);
    setTargetWs(workspaces.length ? targetWs || workspaces[0].workspaceId : "");
    setMoveMode("existing");
    setNewPath("");
    setOpenMove(it.sessionId);
  };
  const pickDirectory = async () => {
    if (!workspacesSvc || picking) return;
    setPicking(true);
    try {
      const p = await workspacesSvc.pickDirectory();
      if (p) {
        setNewPath(p);
        setMoveMode("new");
      }
    } catch (e) {
      setError(String(e && e.message || e));
    } finally {
      setPicking(false);
    }
  };
  const toggleDetails = (it) => {
    if (openDetails === it.sessionId) {
      setOpenDetails(null);
      return;
    }
    if (details[it.sessionId]) {
      setOpenDetails(it.sessionId);
      const at = detailsAt.current[it.sessionId] || 0;
      if (Date.now() - at > 3e4) {
        postJSON("/archived-sessions/details", { sessionId: it.sessionId }).then((d) => {
          detailsAt.current[it.sessionId] = Date.now();
          setDetails((m) => ({ ...m, [it.sessionId]: d }));
        }).catch(() => {
        });
      }
      return;
    }
    setDetailsLoading(it.sessionId);
    postJSON("/archived-sessions/details", { sessionId: it.sessionId }).then((d) => {
      detailsAt.current[it.sessionId] = Date.now();
      setDetails((m) => ({ ...m, [it.sessionId]: d }));
      setDetailsLoading(null);
      setOpenDetails(it.sessionId);
    }).catch((e) => {
      setDetailsLoading(null);
      setError(String(e && e.message || e));
    });
  };
  const workspaceTag = (it) => {
    if (it.hasWorkspace && it.workspaceGone) {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "archv-wtag archv-wgone", title: (it.workspacePath || "") + "\uFF08\u539F\u5DE5\u4F5C\u533A\u5DF2\u5220\u9664\uFF09", children: [
        "\u5DE5\u4F5C\u533A\u5DF2\u5220 \xB7 ",
        pathName(it.workspacePath) || "?"
      ] });
    }
    const wName = it.workspaceTitle || pathName(it.workspacePath);
    if (wName) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "archv-wtag", title: it.workspacePath || "", children: wName });
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "archv-wtag", children: "\u672A\u5206\u7EC4" });
  };
  const openTagsFor = (it) => {
    if (!tagsReady) {
      showToast(tagsState === "failed" ? "\u6807\u7B7E\u6570\u636E\u672A\u80FD\u52A0\u8F7D\uFF0C\u6682\u65F6\u65E0\u6CD5\u7F16\u8F91\u6807\u7B7E\uFF1B\u91CD\u65B0\u6253\u5F00\u8BBE\u7F6E\u9762\u677F\u53EF\u91CD\u8BD5" : "\u6807\u7B7E\u6570\u636E\u8FD8\u5728\u52A0\u8F7D\u4E2D\uFF0C\u7A0D\u5019\u518D\u8BD5", "err");
      return;
    }
    if (openTags === it.sessionId) {
      setOpenTags(null);
      return;
    }
    setOpenMove(null);
    setCardTagName("");
    setOpenTags(it.sessionId);
  };
  const runMenu = (id, it) => {
    setOpenMenu(null);
    if (id === "restore") act("restore", it);
    else if (id === "archive") act("archive", it);
    else if (id === "delete") setDelTarget(it);
    else if (id === "move") openMoveFor(it);
    else if (id === "tags") openTagsFor(it);
    else if (id === "details") toggleDetails(it);
  };
  const rowMenu = (it) => {
    const items = it.archived ? [
      ["restore", "\u6062\u590D"],
      ["move", openMove === it.sessionId ? "\u6536\u8D77\u79FB\u52A8" : "\u79FB\u52A8"],
      ["tags", "\u6807\u7B7E"],
      ["details", openDetails === it.sessionId ? "\u6536\u8D77\u8BE6\u60C5" : "\u8BE6\u60C5"],
      ["delete", "\u5220\u9664"]
    ] : [["archive", "\u5F52\u6863"], ["move", "\u79FB\u52A8"], ["tags", openTags === it.sessionId ? "\u6536\u8D77\u6807\u7B7E" : "\u6807\u7B7E"], ["details", "\u8BE6\u60C5"], ["delete", "\u5220\u9664"]];
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { ref: openMenu === it.sessionId ? menuRef : null, className: "more-wrap", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: "more-btn",
          "aria-label": "\u66F4\u591A\u64CD\u4F5C",
          "aria-haspopup": "true",
          "aria-expanded": openMenu === it.sessionId,
          onClick: (e) => {
            e.stopPropagation();
            setOpenMenu(openMenu === it.sessionId ? null : it.sessionId);
          },
          children: "\u22EF"
        }
      ),
      openMenu === it.sessionId && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "more-menu", role: "menu", children: items.map(([id, label]) => {
        const blocked = id === "move" && !canMove.available || id === "tags" && !tagsReady;
        const blockedTitle = id === "move" ? canMove.reason : id === "tags" ? tagsBlockedTitle : void 0;
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            role: "menuitem",
            className: "more-item" + (id === "delete" ? " more-item-danger" : ""),
            disabled: blocked,
            title: blocked ? blockedTitle : void 0,
            onClick: () => runMenu(id, it),
            children: label
          },
          id
        );
      }) })
    ] });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "archv", role: "region", "aria-label": "\u4F1A\u8BDD\u7BA1\u7406", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: CSS }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "archv-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { className: "archv-title", children: "\u4F1A\u8BDD\u7BA1\u7406" }),
      capabilities && capabilities.buildStamp ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "archv-stamp", title: capabilities.buildStamp, onClick: () => navigator.clipboard && navigator.clipboard.writeText(capabilities.buildStamp).catch(() => {
      }), children: capabilities.buildStamp }) : null,
      sessions !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "archv-count", "aria-label": `${sessions.length} \u4E2A\u4F1A\u8BDD`, children: sessions.length })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "archv-sub", children: "\u7EDF\u4E00\u7BA1\u7406\u5168\u90E8\u4F1A\u8BDD\uFF1A\u5F52\u6863 / \u6062\u590D / \u79FB\u52A8\u5230\u5176\u4ED6\u5DE5\u4F5C\u533A / \u4F1A\u8BDD\u8BE6\u60C5 / \u6279\u91CF\u64CD\u4F5C\uFF0C\u5220\u9664\u4F1A\u5148\u8FDB\u5165\u56DE\u6536\u7AD9\uFF0C\u53EF\u5728\u56DE\u6536\u7AD9\u5185\u6062\u590D\u6216\u5F7B\u5E95\u6E05\u7406\u3002" }),
    error && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "archv-err", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: error }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: "archv-errretry",
          title: retry ? "\u628A\u521A\u624D\u5931\u8D25\u7684\u64CD\u4F5C\u539F\u6837\u518D\u505A\u4E00\u6B21\uFF08\u4F8B\u5982\u5148\u5207\u8D70\u88AB\u5360\u7528\u7684\u4F1A\u8BDD\u540E\u91CD\u8BD5\uFF09" : "\u91CD\u65B0\u52A0\u8F7D\u4F1A\u8BDD\u5217\u8868",
          onClick: () => {
            const run = retry && retry.run;
            setRetry(null);
            if (run) run();
            else refresh();
          },
          children: "\u91CD\u8BD5"
        }
      )
    ] }),
    sessions === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "archv-skel", "aria-label": "\u52A0\u8F7D\u4E2D", children: [0, 1, 2].map((i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "archv-skel-card" }, i)) }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "sess-fwrap" + (moreOpen ? " sess-fmore-open" : "") + (filter === "starred" || filter === "empty" || filter === "trash" ? " sess-fsec-on" : ""), children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "sess-filter", role: "tablist", "aria-label": "\u4F1A\u8BDD\u7B5B\u9009", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", role: "tab", "aria-selected": filter === "all", className: "sess-fbtn" + (filter === "all" ? " sess-fbtn-on" : ""), onClick: () => {
          setFilter("all");
          clearSel();
          setConfirmBatch(false);
        }, children: [
          "\u5168\u90E8 (",
          sessions.length,
          ")"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", role: "tab", "aria-selected": filter === "active", className: "sess-fbtn" + (filter === "active" ? " sess-fbtn-on" : ""), onClick: () => {
          setFilter("active");
          clearSel();
          setConfirmBatch(false);
        }, children: [
          "\u6D3B\u52A8 (",
          activeList.length,
          ")"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", role: "tab", "aria-selected": filter === "archived", className: "sess-fbtn" + (filter === "archived" ? " sess-fbtn-on" : ""), onClick: () => {
          setFilter("archived");
          clearSel();
          setConfirmBatch(false);
        }, children: [
          "\u5DF2\u5F52\u6863 (",
          archivedList.length,
          ")"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "sess-fmore", role: "tablist", "aria-label": "\u66F4\u591A\u4F1A\u8BDD\u7B5B\u9009", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", role: "tab", "aria-selected": filter === "starred", className: "sess-fbtn" + (filter === "starred" ? " sess-fbtn-on" : ""), onClick: () => {
            setFilter("starred");
            clearSel();
            setConfirmBatch(false);
          }, children: [
            "\u5DF2\u6536\u85CF (",
            starredList.length,
            ")"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", role: "tab", "aria-selected": filter === "empty", className: "sess-fbtn" + (filter === "empty" ? " sess-fbtn-on" : ""), onClick: () => {
            setFilter("empty");
            clearSel();
            setConfirmBatch(false);
          }, children: [
            "\u7A7A\u767D (",
            emptyList.length,
            ")"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", role: "tab", "aria-selected": filter === "trash", className: "sess-fbtn" + (filter === "trash" ? " sess-fbtn-on" : ""), onClick: () => {
            setFilter("trash");
            clearSel();
            setConfirmBatch(false);
          }, children: [
            "\u56DE\u6536\u7AD9 (",
            trash.length,
            ")"
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "sess-farrow", "aria-expanded": moreOpen, "aria-label": moreOpen ? "\u6536\u8D77\u66F4\u591A\u7B5B\u9009" : "\u5C55\u5F00\u66F4\u591A\u7B5B\u9009", title: moreOpen ? "\u6536\u8D77\u66F4\u591A\u7B5B\u9009" : "\u5C55\u5F00\u66F4\u591A\u7B5B\u9009\uFF08\u5DF2\u6536\u85CF / \u7A7A\u767D / \u56DE\u6536\u7AD9\uFF09", onClick: () => setMoreOpen(!moreOpen), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: "12", height: "12", viewBox: "0 0 12 12", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4 2l4 4-4 4", fill: "none", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round" }) }) })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "maint-bar", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "archv-btn", "aria-expanded": storageOpen, onClick: () => {
          const next = !storageOpen;
          setStorageOpen(next);
          if (next && (!storage || storageDirty.current) && !storageBusy) loadStorage();
        }, children: [
          "\u5B58\u50A8\u5360\u7528",
          storage ? ` \xB7 ${fmtBytes(storage.totalBytes) || "0 B"}` : ""
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "button",
          {
            type: "button",
            className: "archv-btn",
            "aria-expanded": openTagMgr,
            disabled: !tagsReady && !openTagMgr,
            title: tagsReady ? "\u65B0\u5EFA / \u91CD\u547D\u540D / \u5408\u5E76 / \u5220\u9664\u6807\u7B7E" : tagsBlockedTitle,
            onClick: () => {
              setOpenTagMgr(!openTagMgr);
              setRenamingTagId(null);
            },
            children: [
              "\u6807\u7B7E\u7BA1\u7406",
              tagsReady && tagDefs.length ? ` (${tagDefs.length})` : ""
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "archv-btn" + (aa.settings.inactiveDays ? " archv-go" : ""), "aria-expanded": aaOpen, onClick: () => setAaOpen(!aaOpen), children: [
          "\u81EA\u52A8\u5F52\u6863",
          aa.settings.inactiveDays ? `\uFF1A${aa.settings.inactiveDays} \u5929\u672A\u6D3B\u8DC3` : "\uFF1A\u672A\u542F\u7528"
        ] }),
        aa.lastRunAt ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "maint-note", children: [
          "\u4E0A\u6B21\u68C0\u67E5 ",
          fmtDate(aa.lastRunAt),
          "\uFF0C\u5F52\u6863 ",
          aa.lastArchivedCount,
          " \u4E2A"
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "maint-note", children: "\u5C1A\u672A\u68C0\u67E5" })
      ] }),
      openTagMgr && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-sheet", "aria-label": "\u6807\u7B7E\u7BA1\u7406", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-sheet-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h3", { className: "mv-sheet-title", children: [
            "\u6807\u7B7E\u7BA1\u7406 \xB7 ",
            tagDefs.length
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "mv-sheet-close", "aria-label": "\u5173\u95ED", onClick: () => {
            setOpenTagMgr(false);
            setRenamingTagId(null);
          }, children: "\xD7" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "mv-field-label", htmlFor: "dsm-tag-new", children: "\u65B0\u5EFA\u6807\u7B7E" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-browse-row", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                id: "dsm-tag-new",
                type: "text",
                value: mgrTagName,
                disabled: mgrBusy,
                maxLength: 24,
                placeholder: "\u6807\u7B7E\u540D\uFF08\u4E0D\u80FD\u542B\u659C\u6760\uFF0C\u6700\u957F 24 \u5B57\uFF09",
                onChange: (e) => setMgrTagName(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    createTag();
                  }
                }
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", disabled: mgrBusy || !mgrTagName.trim(), onClick: createTag, children: "\u65B0\u5EFA" })
          ] })
        ] }),
        tagDefs.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dtl-note", children: "\u8FD8\u6CA1\u6709\u6807\u7B7E\u3002\u5728\u4E0A\u65B9\u8F93\u5165\u540D\u5B57\u5373\u53EF\u521B\u5EFA\uFF1B\u7ED9\u4F1A\u8BDD\u8D34\u6807\u7B7E\u4E5F\u53EF\u4EE5\u5728\u4F1A\u8BDD\u5361\u7247\u7684\u300C\u22EF \u2192 \u6807\u7B7E\u300D\u91CC\u8FDB\u884C\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: tagDefs.map((t) => {
          const others = tagDefs.filter((o) => String(o.id) !== String(t.id));
          return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsm-tagrow", children: renamingTagId === String(t.id) ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                className: "dsm-tag-input",
                type: "text",
                value: renameTagValue,
                disabled: mgrBusy,
                maxLength: 24,
                "aria-label": "\u91CD\u547D\u540D\u6807\u7B7E " + t.name,
                autoFocus: true,
                onChange: (e) => setRenameTagValue(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitTagRename(t);
                  }
                  if (e.key === "Escape") setRenamingTagId(null);
                }
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsm-tag-acts", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn archv-go", disabled: mgrBusy || !renameTagValue.trim(), onClick: () => commitTagRename(t), children: "\u4FDD\u5B58" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", disabled: mgrBusy, onClick: () => setRenamingTagId(null), children: "\u53D6\u6D88" })
            ] })
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsm-tag-name", title: t.name, children: t.name }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "maint-note", children: [
              tagUsage[String(t.id)] || 0,
              " \u4E2A\u4F1A\u8BDD"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsm-tag-acts", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", disabled: mgrBusy || renamingTagId !== null, title: "\u91CD\u547D\u540D\u8FD9\u4E2A\u6807\u7B7E", onClick: () => {
                setRenamingTagId(String(t.id));
                setRenameTagValue(t.name);
              }, children: "\u91CD\u547D\u540D" }),
              others.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                  "select",
                  {
                    "aria-label": "\u628A\u6807\u7B7E\u300C" + t.name + "\u300D\u5E76\u5165",
                    value: mergeTarget[String(t.id)] || "",
                    disabled: mgrBusy,
                    title: "\u628A\u8FD9\u4E2A\u6807\u7B7E\u7684\u6240\u6709\u4F1A\u8BDD\u5E76\u5165\u53E6\u4E00\u4E2A\u6807\u7B7E\uFF08\u5E76\u5165\u540E\u672C\u6807\u7B7E\u5220\u9664\uFF09",
                    onChange: (e) => setMergeTarget((m) => Object.assign({}, m, { [String(t.id)]: e.target.value })),
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: "\u5E76\u5165\u2026" }),
                      others.map((o) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: String(o.id), children: o.name }, String(o.id)))
                    ]
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", disabled: mgrBusy || !mergeTarget[String(t.id)], title: mergeTarget[String(t.id)] ? "\u786E\u8BA4\u5E76\u5165\u6240\u9009\u6807\u7B7E" : "\u5148\u5728\u5DE6\u4FA7\u9009\u62E9\u5E76\u5165\u7684\u76EE\u6807\u6807\u7B7E", onClick: () => mergeTag(t), children: "\u786E\u8BA4" })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn archv-del", disabled: mgrBusy, title: "\u5220\u9664\u6807\u7B7E\uFF08\u53EA\u5220\u6807\u7B7E\uFF0C\u4E0D\u4F1A\u5220\u9664\u4F1A\u8BDD\uFF09", onClick: () => deleteTag(t), children: "\u5220\u9664" })
            ] })
          ] }) }, String(t.id));
        }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dtl-note", children: "\u6807\u7B7E\u662F\u4F1A\u8BDD\u7684\u81EA\u5B9A\u4E49\u6807\u8BB0\uFF1A\u65B0\u5EFA\u3001\u91CD\u547D\u540D\u3001\u5408\u5E76\u3001\u5220\u9664\u90FD\u53EA\u6539\u6807\u8BB0\u672C\u8EAB\uFF0C\u4E0D\u4F1A\u5220\u9664\u6216\u79FB\u52A8\u4EFB\u4F55\u4F1A\u8BDD\u3002\u5355\u4E2A\u4F1A\u8BDD\u7684\u6807\u7B7E\u6570\u91CF\u4E0E\u6807\u7B7E\u603B\u6570\u90FD\u6709\u670D\u52A1\u7AEF\u4E0A\u9650\uFF0C\u8D85\u9650\u65F6\u4F1A\u63D0\u793A\u5E76\u81EA\u52A8\u56DE\u9000\u672C\u5730\u6539\u52A8\u3002" })
      ] }),
      pendingQueue.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-sheet", "aria-label": "\u5F85\u79FB\u52A8\u961F\u5217", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "mv-sheet-head", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h3", { className: "mv-sheet-title", children: [
          "\u5F85\u79FB\u52A8\u961F\u5217 \xB7 ",
          pendingQueue.length
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dtl-note", children: "\u8FD9\u4E9B\u4F1A\u8BDD\u6B63\u88AB DSH \u6253\u5F00\u7740\uFF0C\u5B98\u65B9\u53EA\u5728\u8FDB\u7A0B\u9000\u51FA\u65F6\u91CA\u653E\u5199\u6743\u9650\uFF1B\u91CA\u653E\u540E\u63D2\u4EF6\u4F1A\u81EA\u52A8\u5B8C\u6210\u79FB\u52A8\uFF0C\u4E5F\u53EF\u91CD\u542F DSH \u8BA9\u5B83\u5728\u542F\u52A8\u5934\u51E0\u79D2\u62A2\u5148\u8865\u8DD1\u3002" }),
        pendingQueue.map((q) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsm-kid-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsm-kid-name", title: `${q.sessionId} \u2192 ${q.targetPath || ""}`, children: [
            shortId(q.sessionId),
            "\u2026 \u2192 ",
            pathTail(q.targetPath) || "\u76EE\u6807\u5DE5\u4F5C\u533A"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsm-kid-acts", children: [
            Number.isSafeInteger(q.attempts) && q.attempts > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "maint-note", children: [
              "\u5DF2\u5931\u8D25 ",
              q.attempts,
              " \u6B21"
            ] }) : null,
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", onClick: () => cancelQueuedMove(q.sessionId), children: "\u53D6\u6D88" })
          ] })
        ] }, String(q.sessionId)))
      ] }),
      aaOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-sheet", "aria-label": "\u81EA\u52A8\u5F52\u6863\u8BBE\u7F6E", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-sheet-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: "mv-sheet-title", children: "\u81EA\u52A8\u5F52\u6863" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "mv-sheet-close", "aria-label": "\u5173\u95ED", onClick: () => setAaOpen(false), children: "\xD7" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "mv-field-label", htmlFor: "dsm-aa-days", children: "\u5C06\u591A\u4E45\u672A\u6D3B\u8DC3\u7684\u4F1A\u8BDD\u81EA\u52A8\u5F52\u6863" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { id: "dsm-aa-days", value: aa.settings.inactiveDays, disabled: aaBusy, onChange: (e) => updateAutoArchive({ inactiveDays: Number(e.target.value) }), children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "0", children: "\u4E0D\u81EA\u52A8\u5F52\u6863" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "30", children: "30 \u5929\u672A\u6D3B\u8DC3" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "60", children: "60 \u5929\u672A\u6D3B\u8DC3" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "90", children: "90 \u5929\u672A\u6D3B\u8DC3" })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "aa-check", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: aa.settings.skipStarred !== false, disabled: aaBusy, onChange: (e) => updateAutoArchive({ skipStarred: e.target.checked }) }),
          "\u8DF3\u8FC7\u5DF2\u6536\u85CF\u7684\u4F1A\u8BDD"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "mv-foot", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", disabled: aaBusy || !aa.settings.inactiveDays, onClick: runAutoArchive, children: aaBusy ? "\u68C0\u67E5\u4E2D\u2026" : "\u7ACB\u5373\u68C0\u67E5" }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dtl-note", children: "\u81EA\u52A8\u5F52\u6863\u53EA\u662F\u628A\u4F1A\u8BDD\u6536\u8FDB\u300C\u5DF2\u5F52\u6863\u300D\uFF0C\u4E0D\u5220\u9664\u4EFB\u4F55\u6570\u636E\uFF0C\u968F\u65F6\u53EF\u6062\u590D\u3002\u5F53\u524D\u6B63\u5728\u4F7F\u7528\u7684\u4F1A\u8BDD\u6C38\u8FDC\u4E0D\u4F1A\u88AB\u81EA\u52A8\u5F52\u6863\u3002\u68C0\u67E5\u5728\u6253\u5F00\u672C\u9762\u677F\u65F6\u89E6\u53D1\uFF0C\u6BCF\u5929\u6700\u591A\u4E00\u6B21\u3002" })
      ] }),
      storageOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-sheet", "aria-label": "\u5B58\u50A8\u5360\u7528", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-sheet-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: "mv-sheet-title", children: "\u5B58\u50A8\u5360\u7528" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-sheet-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", disabled: storageBusy, onClick: loadStorage, children: storageBusy ? "\u7EDF\u8BA1\u4E2D\u2026" : "\u91CD\u65B0\u7EDF\u8BA1" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "mv-sheet-close", "aria-label": "\u5173\u95ED", onClick: () => setStorageOpen(false), children: "\xD7" })
          ] })
        ] }),
        storageError ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "archv-err", role: "alert", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: storageError }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-errretry", onClick: loadStorage, children: "\u91CD\u8BD5" })
        ] }) : !storage ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "archv-empty", children: "\u7EDF\u8BA1\u4E2D\u2026" }) : storage.sessionCount === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "archv-empty", children: "\u6682\u65E0\u4F1A\u8BDD\uFF0C\u6CA1\u6709\u53EF\u7EDF\u8BA1\u7684\u5B58\u50A8\u5360\u7528\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsm-storage-sum", children: [
            "\u5171 ",
            fmtBytes(storage.totalBytes) || "0 B",
            " \xB7 ",
            storage.sessionCount,
            " \u4E2A\u4F1A\u8BDD",
            storage.unknownSessions ? ` \xB7 ${storage.unknownSessions} \u4E2A\u5927\u5C0F\u672A\u77E5` : ""
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsm-storage-list", children: storage.workspaces.map((w) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsm-storage-row", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsm-storage-name", title: w.path || "\u672A\u5206\u7EC4", children: w.title || (w.path ? pathName(w.path) : "\u672A\u5206\u7EC4") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsm-storage-bar", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsm-storage-fill", style: { width: `${Math.round((w.share || 0) * 100)}%` } }) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsm-storage-size", children: fmtBytes(w.bytes) || "\u2014" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsm-storage-count", children: [
              w.sessions,
              " \u4E2A"
            ] })
          ] }, w.key)) }),
          storage.top.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dtl-sec", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dtl-sec-t", children: "\u5360\u7528\u6700\u5927\u7684\u4F1A\u8BDD" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsm-storage-list", children: storage.top.map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsm-storage-row", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsm-storage-name", title: s.sessionId, children: s.title || s.sessionId }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsm-storage-size", children: fmtBytes(s.sizeBytes) || "\u2014" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsm-storage-count", children: s.workspaceTitle || (s.workspacePath ? pathName(s.workspacePath) : "\u672A\u5206\u7EC4") })
            ] }, s.sessionId)) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dtl-note", children: "\u7EDF\u8BA1\u7684\u662F\u4F1A\u8BDD\u65E5\u5FD7\u6587\u4EF6\u7684\u78C1\u76D8\u5360\u7528\uFF08\u538B\u7F29\u540E\u7684\u5B9E\u9645\u5927\u5C0F\uFF09\uFF0C\u53EA\u8BFB\uFF0C\u4E0D\u4FEE\u6539\u4EFB\u4F55\u6570\u636E\u3002" })
        ] })
      ] }),
      showSessionList && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "sess-tools sess-tools-5", "aria-label": "\u67E5\u627E\u548C\u6574\u7406\u4F1A\u8BDD", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "sess-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { htmlFor: "dsm-search", children: "\u641C\u7D22\u4F1A\u8BDD" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "dsm-search", type: "search", value: query, onChange: (e) => setQuery(e.target.value), placeholder: "\u6807\u9898\u3001\u4F1A\u8BDD ID \u6216\u5DE5\u4F5C\u533A" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "sess-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { htmlFor: "dsm-workspace-filter", children: "\u5DE5\u4F5C\u533A" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { id: "dsm-workspace-filter", value: workspaceFilter, onChange: (e) => setWorkspaceFilter(e.target.value), children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "all", children: "\u5168\u90E8\u5DE5\u4F5C\u533A" }),
              workspaces.map((w) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: w.path, children: w.title }, w.workspaceId)),
              workspaceFilter !== "all" && !workspaces.some((w) => w.path === workspaceFilter) && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", { value: workspaceFilter, children: [
                "\u5DF2\u5220\u5DE5\u4F5C\u533A \xB7 ",
                pathName(workspaceFilter) || "?"
              ] })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "sess-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { htmlFor: "dsm-tag-filter", children: "\u6807\u7B7E" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
              "select",
              {
                id: "dsm-tag-filter",
                value: tagFilter,
                disabled: !tagsReady,
                title: !tagsReady ? tagsBlockedTitle : tagFilter ? "\u5F53\u524D\u6309\u300C" + (tagMap.get(tagFilter) || "\u6240\u9009\u6807\u7B7E") + "\u300D\u7B5B\u9009\uFF1B\u591A\u9009\u7EC4\u5408\u53EF\u7528\u300C\u4FDD\u5B58\u5F53\u524D\u7B5B\u9009\u300D\u56FA\u5316" : "\u6309\u6807\u7B7E\u7B5B\u9009\uFF08\u5355\u9009\uFF09",
                onChange: (e) => setTagFilter(e.target.value),
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: "\u5168\u90E8\u6807\u7B7E" }),
                  tagDefs.map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: t.id, children: t.name }, t.id)),
                  tagFilter && !tagMap.has(tagFilter) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: tagFilter, children: "\uFF08\u5DF2\u5220\u6807\u7B7E\uFF09" })
                ]
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "sess-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { htmlFor: "dsm-sort", children: "\u6392\u5E8F" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { id: "dsm-sort", value: sortBy, onChange: (e) => setSortBy(e.target.value), children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "newest", children: "\u6700\u65B0\u521B\u5EFA" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "oldest", children: "\u6700\u65E9\u521B\u5EFA" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "title", children: "\u6807\u9898 A\u2013Z" })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "sess-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { htmlFor: "dsm-group", children: "\u5206\u7EC4" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { id: "dsm-group", value: groupByLineage ? "lineage" : "flat", onChange: (e) => setGroupByLineage(e.target.value === "lineage"), title: "\u8840\u7F18\u5206\u7EC4\uFF1A\u5B50\u4EE3\u7406\u6298\u53E0\u3001\u5206\u652F\u805A\u62E2\u6210\u7EC4\uFF1B\u5E73\u94FA\uFF1A\u4E0E DSH \u539F\u751F\u4E00\u81F4\uFF0C\u5168\u90E8\u5E76\u5217", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "lineage", children: "\u8840\u7F18\uFF08\u6298\u53E0\u5206\u7EC4\uFF09" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "flat", children: "\u5E73\u94FA\uFF08\u5168\u90E8\u5E76\u5217\uFF09" })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "sess-results", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "sess-results-main", role: "status", children: [
            "\u663E\u793A ",
            topList.length - syntheticCount,
            " \u4E2A\u4F1A\u8BDD",
            foldedCount || branchFolded ? `\uFF0C\u53E6\u6709 ${[foldedCount ? `${foldedCount} \u4E2A\u5B50\u4EE3\u7406\u6298\u53E0\u5728\u7236\u4F1A\u8BDD\u4E0B` : "", branchFolded ? `${branchFolded} \u4E2A\u5206\u652F\u805A\u6210 ${branchGroupCount} \u7EC4` : ""].filter(Boolean).join("\u3001")}` : query || workspaceFilter !== "all" || tagFilter ? `\uFF0C\u5171 ${filter === "archived" ? archivedList.length : filter === "active" ? activeList.length : filter === "starred" ? starredList.length : filter === "empty" ? emptyList.length : sessions.length} \u4E2A` : topList.length !== list.length ? `\uFF0C\u5171 ${list.length} \u4E2A` : ""
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsm-fbar", children: [
            saveFilterOpen ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "input",
                {
                  type: "text",
                  value: saveFilterName,
                  maxLength: 40,
                  placeholder: "\u7B5B\u9009\u540D\u79F0",
                  "aria-label": "\u4E3A\u5F53\u524D\u7B5B\u9009\u547D\u540D",
                  autoFocus: true,
                  disabled: mgrBusy,
                  onChange: (e) => setSaveFilterName(e.target.value),
                  onKeyDown: (e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveCurrentFilter();
                    }
                    if (e.key === "Escape") {
                      setSaveFilterOpen(false);
                      setSaveFilterName("");
                    }
                  }
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn archv-go", disabled: mgrBusy || !saveFilterName.trim(), onClick: saveCurrentFilter, children: "\u4FDD\u5B58" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", disabled: mgrBusy, onClick: () => {
                setSaveFilterOpen(false);
                setSaveFilterName("");
              }, children: "\u53D6\u6D88" })
            ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                className: "archv-btn",
                title: "\u628A\u5F53\u524D\u89C6\u56FE / \u5DE5\u4F5C\u533A / \u6807\u7B7E / \u6392\u5E8F\u5B58\u4E3A\u4E00\u4E2A\u53EF\u590D\u7528\u7684\u7B5B\u9009",
                onClick: () => {
                  setSaveFilterOpen(true);
                  setSaveFilterName("");
                },
                children: "\u4FDD\u5B58\u5F53\u524D\u7B5B\u9009"
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
              "select",
              {
                "aria-label": "\u5DF2\u5B58\u7B5B\u9009",
                value: savedFilters.some((f) => String(f.id) === appliedSavedId) ? appliedSavedId : "",
                disabled: !savedFilters.length || mgrBusy,
                title: !savedFilters.length ? "\u8FD8\u6CA1\u6709\u5DF2\u5B58\u7B5B\u9009\uFF1B\u70B9\u5DE6\u4FA7\u300C\u4FDD\u5B58\u5F53\u524D\u7B5B\u9009\u300D\u521B\u5EFA" : "\u9009\u62E9\u4E00\u4E2A\u5DF2\u5B58\u7B5B\u9009\u5E76\u7ACB\u5373\u5E94\u7528\uFF1B\u9009\u4E2D\u540E\u53F3\u4FA7\u53EF\u5220\u9664",
                onChange: (e) => applySavedFilter(e.target.value),
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: savedFilters.length ? "\u5DF2\u5B58\u7B5B\u9009\u2026" : "\u65E0\u5DF2\u5B58\u7B5B\u9009" }),
                  savedFilters.map((f) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: f.id, children: f.name }, f.id))
                ]
              }
            ),
            appliedSavedId && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                className: "archv-btn archv-del",
                disabled: mgrBusy,
                title: "\u5220\u9664\u5DF2\u5B58\u7B5B\u9009\u300C" + ((savedFilters.find((f) => String(f.id) === appliedSavedId) || {}).name || appliedSavedId) + "\u300D\uFF08\u53EA\u5220\u8FD9\u6761\u4FDD\u5B58\u7684\u7B5B\u9009\uFF0C\u4E0D\u52A8\u4F1A\u8BDD\uFF09",
                onClick: () => deleteSavedFilter(appliedSavedId),
                children: "\u5220\u9664"
              }
            )
          ] })
        ] })
      ] }),
      showSessionList && list.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "sess-batch" + (selIds.length > 0 ? " sess-batch-pin" : ""), children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "sess-btntext", children: selIds.length ? `\u5DF2\u9009 ${selIds.length} \u9879` : filter === "archived" ? `\u5171 ${archivedList.length} \u4E2A\u5F52\u6863\u4F1A\u8BDD` : filter === "starred" ? `\u5171 ${starredList.length} \u4E2A\u6536\u85CF\u4F1A\u8BDD` : `\u5171 ${sessions.length} \u4E2A\u4F1A\u8BDD\uFF08\u6D3B\u52A8 ${activeList.length} / \u5DF2\u5F52\u6863 ${archivedList.length}\uFF09` }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", disabled: list.length === 0, onClick: selectAll, children: "\u5168\u9009" }),
        selIds.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          filter === "archived" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", disabled: busy !== null, onClick: () => doBatch("restore-many"), children: "\u6062\u590D\u6240\u9009" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn archv-del", disabled: busy !== null, onClick: () => doBatch("delete-many"), children: confirmBatch ? "\u786E\u8BA4\u5220\u9664\u6240\u9009?" : "\u5220\u9664\u6240\u9009" })
          ] }),
          filter !== "archived" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", disabled: busy !== null, onClick: () => doBatch("archive-many"), children: "\u5F52\u6863\u6240\u9009" }),
          canMove.available && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              className: "archv-btn",
              disabled: busy !== null,
              "aria-expanded": batchMoveOpen,
              onClick: () => setBatchMoveOpen(!batchMoveOpen),
              children: "\u79FB\u52A8\u6240\u9009\u2026"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", onClick: clearSel, children: "\u53D6\u6D88\u9009\u62E9" })
        ] }),
        selIds.length > 0 && batchMoveOpen && canMove.available && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-sheet", role: "region", "aria-label": "\u6279\u91CF\u79FB\u52A8\u5230\u5DE5\u4F5C\u533A", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-sheet-head", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h3", { className: "mv-sheet-title", children: [
              "\u6279\u91CF\u79FB\u52A8 ",
              selIds.length,
              " \u4E2A\u4F1A\u8BDD"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "mv-sheet-close", "aria-label": "\u5173\u95ED", onClick: () => setBatchMoveOpen(false), children: "\xD7" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-seg", role: "tablist", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", role: "tab", "aria-selected": moveMode === "existing", className: "mv-segbtn" + (moveMode === "existing" ? " mv-segbtn-on" : ""), onClick: () => setMoveMode("existing"), children: "\u5DF2\u6709\u5DE5\u4F5C\u533A" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", role: "tab", "aria-selected": moveMode === "new", className: "mv-segbtn" + (moveMode === "new" ? " mv-segbtn-on" : ""), onClick: () => setMoveMode("new"), children: "\u65B0\u5EFA\u76EE\u5F55" })
          ] }),
          moveMode === "existing" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "mv-field-label", htmlFor: "mv-batch-ws", children: "\u76EE\u6807\u5DE5\u4F5C\u533A" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { id: "mv-batch-ws", value: targetWs, onChange: (e) => setTargetWs(e.target.value), children: [
              workspaces.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: "\uFF08\u6682\u65E0\u5DE5\u4F5C\u533A\uFF09" }),
              workspaces.map((w) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", { value: w.workspaceId, children: [
                w.title,
                " \xB7 ",
                w.path
              ] }, w.workspaceId))
            ] })
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "mv-field-label", htmlFor: "mv-batch-path", children: "\u65B0\u5DE5\u4F5C\u533A\u76EE\u5F55\u8DEF\u5F84" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-browse-row", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "input",
                {
                  id: "mv-batch-path",
                  type: "text",
                  value: newPath,
                  onChange: (e) => setNewPath(e.target.value),
                  placeholder: "\u4F8B\u5982 /Users/you/Projects/demo \u6216 ~/demo"
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "button",
                {
                  type: "button",
                  className: "archv-btn",
                  onClick: pickDirectory,
                  disabled: busy !== null || picking || !workspacesSvc,
                  title: !workspacesSvc ? "\u5F53\u524D\u8FD0\u884C\u73AF\u5883\u4E0D\u652F\u6301\u7CFB\u7EDF\u76EE\u5F55\u9009\u62E9" : "\u6253\u5F00\u7CFB\u7EDF\u76EE\u5F55\u9009\u62E9\u7A97\u53E3",
                  children: picking ? "\u9009\u62E9\u4E2D\u2026" : "\u6D4F\u89C8\u2026"
                }
              )
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-foot", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", onClick: () => setBatchMoveOpen(false), children: "\u53D6\u6D88" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "archv-btn archv-go", disabled: busy !== null, onClick: () => doBatchMove(), children: [
              busy === "__batch__" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "archv-spin", "aria-hidden": "true" }),
              "\u786E\u8BA4\u79FB\u52A8"
            ] })
          ] })
        ] })
      ] }),
      showSessionList && list.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "archv-empty", children: query || workspaceFilter !== "all" || tagFilter ? "\u6CA1\u6709\u5339\u914D\u7684\u4F1A\u8BDD\u3002\u8BF7\u8C03\u6574\u641C\u7D22\u8BCD\u3001\u6807\u7B7E\u6216\u5DE5\u4F5C\u533A\u7B5B\u9009\u3002" : filter === "archived" ? "\u76EE\u524D\u6CA1\u6709\u5F52\u6863\u4F1A\u8BDD\u3002\u5728\u201C\u5168\u90E8\u201D\u91CC\u9009\u4E2D\u4F1A\u8BDD\u70B9\u201C\u5F52\u6863\u201D\u5373\u53EF\u6536\u7EB3\u8FDB\u6765\u3002" : filter === "active" ? "\u76EE\u524D\u6CA1\u6709\u6D3B\u52A8\u4F1A\u8BDD\u3002" : filter === "starred" ? "\u8FD8\u6CA1\u6709\u6536\u85CF\u7684\u4F1A\u8BDD\u3002\u70B9\u51FB\u4F1A\u8BDD\u5DE6\u4FA7\u7684\u661F\u6807\u5373\u53EF\u6536\u85CF\u3002" : filter === "empty" ? "\u6CA1\u6709\u7A7A\u767D\u4F1A\u8BDD\u3002\u65B0\u5F00\u4F1A\u8BDD\u8FD8\u6CA1\u4EA7\u751F\u5185\u5BB9\u65F6\u4F1A\u5F52\u5230\u8FD9\u91CC\uFF0C\u4FA7\u680F\u4F1A\u81EA\u52A8\u9690\u85CF\u5B83\u4EEC\u3002" : "\u6682\u65E0\u53EF\u7BA1\u7406\u7684\u4F1A\u8BDD\u3002" }) : showSessionList ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "archv-list", role: "list", children: topList.map((it) => {
        if (it && it.syntheticRoot) {
          const root = String(it.syntheticRoot);
          const members = branchGroupsOf.get(root) || [];
          const open = !!openBranches[root] || branchHit(root);
          const srcTitle = dsmAuthoritativeTitles.get(root);
          return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsm-src-head", role: "listitem", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
              "button",
              {
                type: "button",
                className: "dsm-kids-toggle",
                "aria-expanded": open,
                title: (open ? "\u6536\u8D77 " : "\u5C55\u5F00 ") + members.length + " \u4E2A\u5206\u652F\u4F1A\u8BDD\uFF08\u6765\u6E90\u4F1A\u8BDD\u4E0D\u5728\u5F53\u524D\u5217\u8868\uFF09",
                onClick: () => toggleBranch(root),
                children: [
                  open ? "\u25BE" : "\u25B8",
                  " ",
                  members.length,
                  " \u5206\u652F"
                ]
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsm-src-name", title: root, children: "\u6765\u6E90\uFF1A" + (srcTitle || shortId(root)) })
          ] }, it.sessionId);
        }
        const date = fmtDate(it.createdAt);
        const expanded = openMove === it.sessionId || openTags === it.sessionId;
        return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "archv-card" + (expanded ? " archv-card-exp" : ""), role: "listitem", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "archv-row", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                type: "checkbox",
                className: "archv-check",
                checked: !!selected[it.sessionId],
                onChange: () => toggle(it.sessionId),
                "aria-label": "\u9009\u62E9 " + (it.title || it.sessionId)
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                className: "archv-star" + (it.starred ? " archv-star-on" : ""),
                "aria-pressed": !!it.starred,
                "aria-label": (it.starred ? "\u53D6\u6D88\u6536\u85CF " : "\u6536\u85CF ") + (it.title || it.sessionId),
                title: it.starred ? "\u53D6\u6D88\u6536\u85CF" : "\u6536\u85CF",
                onClick: (e) => {
                  e.stopPropagation();
                  toggleStar(it);
                },
                children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { viewBox: "0 0 24 24", width: "18", height: "18", "aria-hidden": "true", focusable: "false", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 2.5l2.9 5.9 6.6.9-4.8 4.6 1.2 6.5-5.9-3.1-5.9 3.1 1.2-6.5L2.5 9.3l6.6-.9z" }) })
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "archv-body", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "archv-main", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "archv-titlerow", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "archv-name", title: it.title || "", children: it.title || "(\u65E0\u6807\u9898)" }),
                  branchBadge(it.sessionId),
                  emptyBadge(it.sessionId),
                  tagChips(it.sessionId),
                  kidsBadge(it.sessionId),
                  branchGroupBadge(it.sessionId),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "archv-id", title: it.sessionId, children: shortId(it.sessionId) })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "archv-meta", children: [
                  it.archived ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "archv-wtag archv-wgone", children: "\u5DF2\u5F52\u6863" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "archv-wtag archv-active", children: "\u6D3B\u52A8" }),
                  workspaceTag(it),
                  date && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "archv-dot", children: "\xB7" }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "archv-date", children: date })
                  ] })
                ] })
              ] }),
              rowMenu(it)
            ] })
          ] }),
          groupByLineage && renderKids(it.sessionId, 0),
          groupByLineage && renderBranchGroup(it.sessionId),
          expanded && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-sheet", role: "region", "aria-label": "\u79FB\u52A8\u5230\u5DE5\u4F5C\u533A", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-sheet-head", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: "mv-sheet-title", children: "\u79FB\u52A8\u5230\u5DE5\u4F5C\u533A" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "mv-sheet-close", "aria-label": "\u5173\u95ED", onClick: () => setOpenMove(null), children: "\xD7" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-seg", role: "tablist", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", role: "tab", "aria-selected": moveMode === "existing", className: "mv-segbtn" + (moveMode === "existing" ? " mv-segbtn-on" : ""), onClick: () => setMoveMode("existing"), children: "\u5DF2\u6709\u5DE5\u4F5C\u533A" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", role: "tab", "aria-selected": moveMode === "new", className: "mv-segbtn" + (moveMode === "new" ? " mv-segbtn-on" : ""), onClick: () => setMoveMode("new"), children: "\u65B0\u5EFA\u76EE\u5F55" })
            ] }),
            moveMode === "existing" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-field", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "mv-field-label", htmlFor: "mv-target-ws", children: "\u76EE\u6807\u5DE5\u4F5C\u533A" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { id: "mv-target-ws", value: targetWs, onChange: (e) => setTargetWs(e.target.value), children: [
                workspaces.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: "\uFF08\u6682\u65E0\u5DE5\u4F5C\u533A\uFF09" }),
                workspaces.map((w) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", { value: w.workspaceId, children: [
                  w.title,
                  " \xB7 ",
                  w.path
                ] }, w.workspaceId))
              ] })
            ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-field", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "mv-field-label", htmlFor: "mv-new-path", children: "\u65B0\u5DE5\u4F5C\u533A\u76EE\u5F55\u8DEF\u5F84" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-browse-row", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "input",
                  {
                    id: "mv-new-path",
                    type: "text",
                    value: newPath,
                    onChange: (e) => setNewPath(e.target.value),
                    placeholder: "\u4F8B\u5982 /Users/you/Projects/demo \u6216 ~/demo"
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "button",
                  {
                    type: "button",
                    className: "archv-btn",
                    onClick: pickDirectory,
                    disabled: busy !== null || picking || !workspacesSvc,
                    title: !workspacesSvc ? "\u5F53\u524D\u8FD0\u884C\u73AF\u5883\u4E0D\u652F\u6301\u7CFB\u7EDF\u76EE\u5F55\u9009\u62E9" : "\u6253\u5F00\u7CFB\u7EDF\u76EE\u5F55\u9009\u62E9\u7A97\u53E3",
                    children: picking ? "\u9009\u62E9\u4E2D\u2026" : "\u6D4F\u89C8\u2026"
                  }
                )
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-foot", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", onClick: () => setOpenMove(null), children: "\u53D6\u6D88" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "archv-btn archv-go", disabled: busy !== null, onClick: () => doMove(it), children: [
                busy === it.sessionId && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "archv-spin", "aria-hidden": "true" }),
                "\u786E\u8BA4\u79FB\u52A8"
              ] })
            ] })
          ] }),
          openTags === it.sessionId && (() => {
            const cur = Array.isArray(assignments[String(it.sessionId)]) ? assignments[String(it.sessionId)] : [];
            const locked = tagBusy !== null || !tagsReady;
            return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-sheet", role: "region", "aria-label": "\u4F1A\u8BDD\u6807\u7B7E", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-sheet-head", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h3", { className: "mv-sheet-title", children: [
                  "\u4F1A\u8BDD\u6807\u7B7E \xB7 ",
                  it.title || shortId(it.sessionId)
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "mv-sheet-close", "aria-label": "\u5173\u95ED", onClick: () => setOpenTags(null), children: "\xD7" })
              ] }),
              tagDefs.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dtl-note", children: "\u8FD8\u6CA1\u6709\u6807\u7B7E\uFF0C\u5728\u4E0B\u65B9\u65B0\u5EFA\u7B2C\u4E00\u4E2A\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsm-taglist", children: tagDefs.map((t) => {
                const checked = cur.some((id) => String(id) === String(t.id));
                return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "dsm-tagcheck", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked, disabled: locked, onChange: () => toggleTagFor(it.sessionId, t.id) }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsm-tagcheck-name", title: t.name, children: t.name })
                ] }, String(t.id));
              }) }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-field", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "mv-field-label", htmlFor: "dsm-tag-attach-" + String(it.sessionId), children: "\u65B0\u5EFA\u6807\u7B7E\u5E76\u8D34\u4E0A" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mv-browse-row", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "input",
                    {
                      id: "dsm-tag-attach-" + String(it.sessionId),
                      type: "text",
                      value: cardTagName,
                      disabled: locked,
                      maxLength: 24,
                      placeholder: "\u6807\u7B7E\u540D\uFF08\u4E0D\u80FD\u542B\u659C\u6760\uFF0C\u6700\u957F 24 \u5B57\uFF09",
                      onChange: (e) => setCardTagName(e.target.value),
                      onKeyDown: (e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          createTagAndAttach(it.sessionId);
                        }
                      }
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", disabled: locked || !cardTagName.trim(), title: locked && !tagsReady ? "\u6807\u7B7E\u6570\u636E\u672A\u80FD\u52A0\u8F7D\uFF0C\u6682\u65F6\u65E0\u6CD5\u65B0\u5EFA\u6807\u7B7E" : "\u65B0\u5EFA\u8FD9\u4E2A\u6807\u7B7E\u5E76\u7ACB\u5373\u8D34\u5230\u5F53\u524D\u4F1A\u8BDD", onClick: () => createTagAndAttach(it.sessionId), children: "\u8D34\u4E0A" })
                ] })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dtl-note", children: "\u52FE\u9009\u5373\u65F6\u751F\u6548\uFF1B\u5355\u4E2A\u4F1A\u8BDD\u7684\u6807\u7B7E\u6570\u91CF\u4EE5\u670D\u52A1\u7AEF\u4E0A\u9650\u4E3A\u51C6\uFF0C\u8D85\u65F6\u4F1A\u63D0\u793A\u5E76\u56DE\u9000\u3002" })
            ] });
          })(),
          openDetails === it.sessionId && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dtl-sheet", role: "region", "aria-label": "\u4F1A\u8BDD\u8BE6\u60C5", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dtl-sheet-head", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: "dtl-sheet-title", children: "\u4F1A\u8BDD\u8BE6\u60C5" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "mv-sheet-close", "aria-label": "\u5173\u95ED\u8BE6\u60C5", onClick: () => setOpenDetails(null), children: "\xD7" })
            ] }),
            detailsLoading === it.sessionId ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "archv-skel", "aria-label": "\u52A0\u8F7D\u4E2D", children: [0, 1].map((i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "archv-skel-card" }, i)) }) : (() => {
              const d = details[it.sessionId];
              if (!d) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dtl-paths", children: "\u6682\u65E0\u8BE6\u60C5" });
              const st = d.stats || {};
              const tools = st.toolCounts ? Object.entries(st.toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 10) : [];
              return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dtl-grid", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dtl-cell", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dtl-k", children: "\u78C1\u76D8\u5360\u7528" }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dtl-v", children: fmtBytes(d.sizeBytes) || "\u2014" })
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dtl-cell", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dtl-k", children: "\u8F6E\u6B21 / \u6B65\u9AA4" }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dtl-v", children: [
                      st.turns ?? 0,
                      " / ",
                      st.steps ?? 0
                    ] })
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dtl-cell", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dtl-k", children: "\u7528\u6237 / \u52A9\u624B" }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dtl-v", children: [
                      st.userMessages ?? 0,
                      " / ",
                      st.assistantMessages ?? 0
                    ] })
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dtl-cell", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dtl-k", children: "\u5DE5\u5177\u8C03\u7528" }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dtl-v", children: st.toolCalls ?? 0 })
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dtl-cell", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dtl-k", children: "\u56FE\u7247\u9644\u4EF6" }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dtl-v", children: st.attachments ?? 0 })
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dtl-cell", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dtl-k", children: "\u521B\u5EFA / \u66F4\u65B0" }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dtl-v", children: [
                      fmtDate(d.createdAt) || "\u2014",
                      " \xB7 ",
                      fmtDate(d.updatedAt) || "\u2014"
                    ] })
                  ] })
                ] }),
                tools.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dtl-sec", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dtl-sec-t", children: "\u5DE5\u5177\u4F7F\u7528" }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dtl-tags", children: tools.map(([t, c]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dtl-tag", children: [
                    t,
                    " \xD7",
                    c
                  ] }, t)) })
                ] }),
                st.fetches && st.fetches.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dtl-sec", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dtl-sec-t", children: "\u641C\u7D22 / \u6293\u53D6" }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "dtl-list", children: st.fetches.map((f, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
                    f.tool,
                    f.query ? ` \u300C${f.query}\u300D` : ""
                  ] }, i)) })
                ] }),
                d.files && d.files.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dtl-sec", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dtl-sec-t", children: [
                    "\u5199\u8FC7\u7684\u6587\u4EF6\uFF08",
                    d.files.length,
                    "\uFF09"
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "dtl-list", children: d.files.map((f, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: f.path }),
                    " ",
                    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dtl-filetool", children: [
                      "(",
                      f.tool,
                      ")"
                    ] })
                  ] }, i)) })
                ] }),
                d.lineage && (d.lineage.parentSessionId || d.lineage.children && d.lineage.children.length > 0 || d.lineage.subagents && d.lineage.subagents.length > 0) && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dtl-sec", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dtl-sec-t", children: "\u8840\u7F18" }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dtl-paths", children: [
                    d.lineage.parentSessionId && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                      "\u7236\u4F1A\u8BDD: ",
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: d.lineage.parentSessionId })
                    ] }),
                    d.lineage.children && d.lineage.children.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                      "\u5B50\u4F1A\u8BDD (",
                      d.lineage.children.length,
                      "): ",
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: d.lineage.children.join(", ") })
                    ] }),
                    d.lineage.subagents && d.lineage.subagents.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                      "\u5B50\u4EE3\u7406 (",
                      d.lineage.subagents.length,
                      "): ",
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: d.lineage.subagents.join(", ") })
                    ] })
                  ] })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dtl-sec", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dtl-sec-t", children: "\u5BFC\u51FA" }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dtl-export", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                      "a",
                      {
                        className: "archv-btn",
                        href: `/api/session.export?sessionId=${encodeURIComponent(it.sessionId)}&includeDescendants=true`,
                        onClick: (e) => e.stopPropagation(),
                        style: zipOk ? void 0 : { pointerEvents: "none", opacity: 0.45 },
                        title: zipOk ? "\u542B\u5B50\u4F1A\u8BDD\u4E0E\u9644\u4EF6\uFF0C\u7531 DSH \u63D0\u4F9B" : "\u5F53\u524D\u6301\u4E45\u5316\u540E\u7AEF\u4E0D\u652F\u6301\u539F\u59CB\u65E5\u5FD7\u5BFC\u51FA",
                        children: "\u4E0B\u8F7D\u539F\u59CB\u65E5\u5FD7 (ZIP)"
                      }
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", disabled: mdBusy === it.sessionId, onClick: () => exportMarkdown(it), children: mdBusy === it.sessionId ? "\u751F\u6210\u4E2D\u2026" : "\u5BFC\u51FA Markdown" })
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dtl-note", children: "ZIP \u542B\u5B50\u4F1A\u8BDD\u4E0E\u9644\u4EF6\uFF0C\u7531 DSH \u63D0\u4F9B \xB7 Markdown \u4E3A\u672C\u63D2\u4EF6\u751F\u6210\u7684\u53EF\u8BFB\u5BF9\u8BDD\u8BB0\u5F55" })
                ] })
              ] });
            })()
          ] })
        ] }, it.sessionId);
      }) }) : null
    ] }),
    toast && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "archv-status" + (toast.kind === "err" ? " archv-status-err" : "") + (String(toast.msg).length > 28 ? " archv-status-long" : ""), role: "status", title: "\u70B9\u51FB\u5173\u95ED", onClick: () => setToast(null), children: toast.msg }),
    delTarget && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dlg-backdrop", onClick: () => setDelTarget(null), children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { ref: dialogRef, className: "dlg", role: "alertdialog", "aria-modal": "true", "aria-label": "\u5220\u9664\u4F1A\u8BDD", onClick: (e) => e.stopPropagation(), children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: "dlg-title", children: "\u5220\u9664\u4F1A\u8BDD" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "dlg-text", children: [
        "\u786E\u8BA4\u5220\u9664\u300C",
        delTarget.title || delTarget.sessionId,
        "\u300D\uFF1F\u5C06\u79FB\u5165\u56DE\u6536\u7AD9\uFF0C\u53EF\u5728\u672C\u9875\u5E95\u90E8\u300C\u56DE\u6536\u7AD9\u300D\u4E2D\u6062\u590D\u6216\u5F7B\u5E95\u5220\u9664\u3002"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlg-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", disabled: busy !== null, onClick: () => setDelTarget(null), children: "\u53D6\u6D88" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn archv-del", disabled: busy !== null, onClick: doDeleteConfirmed, children: "\u79FB\u5165\u56DE\u6536\u7AD9" })
      ] })
    ] }) }),
    filter === "trash" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsm-trash", "aria-label": "\u56DE\u6536\u7AD9", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsm-trash-h", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "\u56DE\u6536\u7AD9" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsm-trash-count", children: trash.length ? `\uFF08${trash.length} \u4E2A\u5F85\u6E05\u7406\uFF09` : "\uFF08\u7A7A\uFF09" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "sess-tools", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "sess-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { htmlFor: "dsm-retention", children: "\u81EA\u52A8\u6E05\u7406" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { id: "dsm-retention", value: trashSettings.retentionDays || 0, disabled: trashBusy !== null, onChange: (e) => updateRetention(e.target.value), children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "0", children: "\u4E0D\u81EA\u52A8\u6E05\u7406" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "7", children: "\u4FDD\u7559 7 \u5929" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "30", children: "\u4FDD\u7559 30 \u5929" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "90", children: "\u4FDD\u7559 90 \u5929" })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "sess-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { children: "\u6570\u636E\u68C0\u67E5" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", disabled: trashBusy !== null, onClick: verifyTrash, children: trashBusy === "__verify" ? "\u6821\u9A8C\u4E2D\u2026" : "\u6821\u9A8C\u65E5\u5FD7\u5B8C\u6574\u6027" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "sess-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { children: "\u6C38\u4E45\u6E05\u7406" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn archv-del", disabled: trashBusy !== null || !trash.length || !canPurge.available, "aria-disabled": !canPurge.available, title: !canPurge.available ? canPurge.reason : "\u7269\u7406\u5220\u9664\u8FD9\u4E9B\u65E5\u5FD7\uFF0C\u91CA\u653E\u78C1\u76D8\u7A7A\u95F4", onClick: () => setPurgeTarget("__all"), children: "\u6E05\u7A7A\u56DE\u6536\u7AD9" })
        ] })
      ] }),
      !canPurge.available && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "archv-empty", role: "status", children: [
        canPurge.reason,
        "\u3002\u56DE\u6536\u7AD9\u6761\u76EE\u4F1A\u4E00\u76F4\u4FDD\u7559\uFF0C\u53EF\u968F\u65F6\u6062\u590D\uFF1B\u5F53\u524D DSH \u7248\u672C\u4E0B\u79FB\u5165\u56DE\u6536\u7AD9",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "\u4E0D\u4F1A\u91CA\u653E\u78C1\u76D8\u7A7A\u95F4" }),
        "\uFF0C\u4F1A\u8BDD\u65E5\u5FD7\u4ECD\u5B8C\u6574\u4FDD\u7559\u5728\u539F\u5DE5\u4F5C\u533A\u76EE\u5F55\u3002"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dtl-note", children: "\u56DE\u6536\u7AD9\u662F\u8F6F\u5220\u9664\uFF1A\u65E5\u5FD7\u4ECD\u7559\u5728\u539F\u5DE5\u4F5C\u533A\u76EE\u5F55\uFF0C\u300C\u5F7B\u5E95\u5220\u9664\u300D\u624D\u662F\u771F\u6B63\u91CA\u653E\u78C1\u76D8\u7A7A\u95F4\u7684\u4E00\u6B65\uFF08\u5F53\u524D\u7248\u672C\u672A\u652F\u6301\u65F6\u4F1A\u4FDD\u6301\u7981\u7528\uFF09\u3002" }),
      trashCheck && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: trashCheck.missing ? "archv-err" : "archv-empty", role: "status", children: [
        "\u6821\u9A8C\u5B8C\u6210\uFF1A",
        trashCheck.healthy,
        " \u6761\u6B63\u5E38\uFF0C",
        trashCheck.missing,
        " \u6761\u65E5\u5FD7\u7F3A\u5931\uFF0C",
        trashCheck.unverified || 0,
        " \u6761\u65E0\u6CD5\u76F4\u63A5\u6838\u9A8C\u3002"
      ] }),
      trash.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsm-trash-empty", children: "\u56DE\u6536\u7AD9\u4E3A\u7A7A\u3002\u5220\u9664\u7684\u4F1A\u8BDD\u4F1A\u5148\u8FDB\u5165\u8FD9\u91CC\uFF0C\u53EF\u6062\u590D\u6216\u5F7B\u5E95\u5220\u9664\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsm-trash-list", children: trash.map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsm-trash-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsm-trash-name", title: t.sessionId, children: t.title || t.sessionId }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsm-trash-date", children: fmtDate(t.deletedAt) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsm-trash-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", disabled: trashBusy !== null || !canRestoreTrash.available, title: !canRestoreTrash.available ? canRestoreTrash.reason : "\u6062\u590D\u5230\u5220\u9664\u524D\u7684\u4F4D\u7F6E\u4E0E\u5F52\u6863\u72B6\u6001", onClick: () => restoreTrash(t.sessionId), children: "\u6062\u590D" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn archv-del", disabled: trashBusy !== null || !canPurge.available, title: !canPurge.available ? canPurge.reason : void 0, onClick: () => setPurgeTarget(t.sessionId), children: "\u5F7B\u5E95\u5220\u9664" })
        ] })
      ] }, t.sessionId)) })
    ] }),
    purgeTarget && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dlg-backdrop", onClick: () => setPurgeTarget(null), children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { ref: dialogRef, className: "dlg", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "dsm-purge-title", onClick: (e) => e.stopPropagation(), children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h3", { id: "dsm-purge-title", className: "dlg-title", children: [
        "\u6C38\u4E45\u5220\u9664",
        purgeTarget === "__all" ? "\u5168\u90E8\u56DE\u6536\u7AD9\u4F1A\u8BDD" : "\u8FD9\u4E2A\u4F1A\u8BDD",
        "\uFF1F"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dlg-text", children: "\u6B64\u64CD\u4F5C\u4F1A\u7269\u7406\u5220\u9664\u65E5\u5FD7\u5E76\u91CA\u653E\u78C1\u76D8\u7A7A\u95F4\uFF0C\u65E0\u6CD5\u6062\u590D\u3002\u5F52\u6863\u3001\u7B5B\u9009\u548C\u91CD\u65B0\u5B89\u88C5\u63D2\u4EF6\u90FD\u4E0D\u80FD\u627E\u56DE\u8FD9\u4E9B\u6570\u636E\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlg-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", onClick: () => setPurgeTarget(null), children: "\u53D6\u6D88" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn archv-del", onClick: () => {
          const target = purgeTarget;
          setPurgeTarget(null);
          target === "__all" ? purgeAllTrash() : purgeTrash(target);
        }, children: "\u786E\u8BA4\u6C38\u4E45\u5220\u9664" })
      ] })
    ] }) })
  ] });
}
var SIDEBAR_AUG_CSS = `
.dsm-backdrop{position:fixed;inset:0;z-index:2147483600;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px}
.dsm-dlg{width:min(420px,92vw);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l3);border-radius:14px;padding:18px;box-shadow:0 16px 48px rgb(0 0 0/.28);display:flex;flex-direction:column;gap:12px}
.dsm-title{font-size:15px;font-weight:650;color:var(--dsw-alias-label-primary);margin:0}
.dsm-text{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary);margin:0;word-break:break-all}
.dsm-body{display:flex;flex-direction:column;gap:4px;max-height:280px;overflow:auto}
.dsm-loading,.dsm-empty{font-size:12px;color:var(--dsw-alias-label-tertiary);padding:4px 2px}
.dsm-err{font-size:12px;color:var(--dsw-alias-state-error-primary);padding:4px 2px}
.dsm-opt{appearance:none;display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:9px 11px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-elevated);color:var(--dsw-alias-label-primary);border-radius:9px;font-size:12.5px;cursor:pointer;text-align:left}
.dsm-opt:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l4)}
.dsm-opt:disabled{opacity:.55;cursor:default}
.dsm-opt-cur{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 45%,transparent);color:var(--dsw-alias-state-business-primary)}
.dsm-opt-name{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
.dsm-opt-sub{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none;margin-left:8px}
.dsm-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:2px}
.dsm-btn{appearance:none;min-height:32px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-subtle);color:var(--dsw-alias-label-secondary);border-radius:9px;font-size:12px;font-weight:500;cursor:pointer}
.dsm-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsm-del{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}
.dsm-del:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}
.dsm-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:2147483601;background:Canvas;color:CanvasText;border:1px solid color-mix(in srgb,CanvasText 25%,transparent);padding:9px 16px;border-radius:999px;font-size:12px;box-shadow:0 8px 24px rgb(0 0 0/.25);max-width:min(92vw,460px);cursor:pointer}
.dsm-toast-long{border-radius:14px;text-align:left;line-height:18px}
.dsm-toast-err{background:#4A1D1D;color:#FFD9D9;border:1px solid var(--dsw-alias-state-error-primary)}
.dsm-sub{position:fixed;z-index:1100;box-sizing:border-box;min-width:190px;max-width:320px;padding:4px;display:flex;flex-direction:column;gap:0;background:var(--dsw-specific-menu);border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;box-shadow:var(--dsw-shadow-lv3)}
.dsm-sub-loading,.dsm-sub-empty{font-size:12px;color:var(--dsw-alias-label-tertiary);padding:6px 10px}
.dsm-sub-err{font-size:12px;color:var(--dsw-alias-state-error-primary);padding:6px 10px}
.dsm-sub-item{display:flex;align-items:center;gap:8px;width:100%;min-height:36px;padding:6px 10px;border:none;border-radius:8px;background:transparent;cursor:pointer;font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary);text-align:left}
.dsm-sub-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsm-sub-item:disabled{opacity:.5;cursor:default}
.dsm-sub-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-sub-cur{font-size:11px;color:var(--dsw-alias-state-business-primary);flex:none;margin-left:8px}
.dsm-dot{position:absolute;left:6px;top:50%;transform:translateY(-50%);width:8px;height:8px;border-radius:50%;box-sizing:border-box;cursor:pointer;pointer-events:auto;z-index:1}
.dsm-dot-unread-manual{background:var(--dsw-alias-state-business-primary)}
.dsm-dot-waiting{background:var(--dsw-alias-state-warn-primary,#F59E0B)}
.dsm-dot-unread{background:var(--dsw-alias-state-success-primary)}
.dsm-drag-source{opacity:.48}
.dsm-drop-target{position:relative;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent)!important;outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px;border-radius:8px}
.dsm-drop-target::after{content:'\u79FB\u52A8\u5230\u8FD9\u91CC';position:absolute;right:8px;top:50%;transform:translateY(-50%);padding:1px 6px;border-radius:4px;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-inverted);font-size:10px;font-weight:600;line-height:16px;pointer-events:none}
.dsm-drag-busy{cursor:progress!important}
.dsm-trash{margin-top:18px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:14px}
.dsm-trash-h{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
.dsm-trash-h h3{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);margin:0}
.dsm-trash-count{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dsm-trash-list{display:flex;flex-direction:column;gap:6px;max-height:260px;overflow:auto}
.dsm-trash-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-fill-elevated)}
.dsm-trash-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;color:var(--dsw-alias-label-primary)}
.dsm-trash-date{font-size:11px;color:var(--dsw-alias-label-tertiary);flex:none;white-space:nowrap}
.dsm-trash-actions{display:flex;gap:6px;flex:none}.dsm-trash-actions .archv-btn{min-width:72px}
.dsm-trash-empty{font-size:12px;color:var(--dsw-alias-label-tertiary);padding:6px 2px}
.dsm-storage-sum{font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:10px}
.dsm-storage-list{display:flex;flex-direction:column;gap:6px}
.dsm-storage-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-fill-elevated)}
.dsm-storage-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;color:var(--dsw-alias-label-primary)}
.dsm-storage-bar{flex:0 0 96px;height:6px;border-radius:999px;background:var(--dsw-alias-fill-subtle);overflow:hidden}
.dsm-storage-fill{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-state-business-primary)}
.dsm-storage-size{font-size:12px;color:var(--dsw-alias-label-secondary);flex:none;white-space:nowrap}
.dsm-storage-count{font-size:11px;color:var(--dsw-alias-label-tertiary);flex:none;white-space:nowrap;max-width:32%;overflow:hidden;text-overflow:ellipsis}
.maint-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 8px}
.maint-note{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.mv-sheet-actions{display:flex;align-items:center;gap:6px}
.aa-check{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.aa-check input{width:15px;height:15px;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer;flex:none}
/* ---- \u8840\u7F18\u5206\u5C42\u62AB\u9732\uFF08issue #6\uFF09\uFF1A\u884C\u5185\u5FBD\u6807 ---- */
.dsm-lineage-pick{display:flex;flex-direction:column;gap:6px;margin:8px 0}
.dsm-lineage-pick-btn{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:8px;background:transparent;color:inherit;cursor:pointer;font-size:12px;text-align:left}
.dsm-lineage-pick-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08))}
.dsm-lineage-sum{font-size:12px;opacity:.75;margin:6px 0;display:flex;align-items:center;gap:6px;overflow:hidden}
.dsm-lineage-tree{display:flex;flex-direction:column;gap:2px;margin:8px 0;max-height:340px;overflow:auto}
.dsm-lineage-row{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:8px;font-size:12px;min-height:28px}
.dsm-lineage-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08))}
.dsm-lineage-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-lineage-kids,.dsm-lineage-size{font-size:11px;opacity:.65;white-space:nowrap}
.dsm-lineage-livechip{font-size:10px;padding:1px 6px;border-radius:999px;background:rgba(234,179,8,.18);color:#A16207;white-space:nowrap}
.dsm-lineage-acts{display:flex;gap:4px}
.dsm-kids-badge{appearance:none;display:inline-flex;align-items:center;gap:3px;margin-left:auto;padding:1px 7px;border:none;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);color:var(--dsw-alias-state-business-primary);font-size:10px;font-weight:600;line-height:15px;cursor:pointer;flex:none;pointer-events:auto}
.dsm-subs{display:flex;flex-direction:column;gap:2px;padding:2px 0 6px 26px;pointer-events:auto}
.dsm-sub-row{display:flex;align-items:center;gap:8px;min-height:24px;padding-right:6px;border-radius:7px;font-size:11.5px;color:var(--dsw-alias-label-secondary);position:relative}
.dsm-sub-row::before{content:'';position:absolute;left:0;top:0;bottom:0;width:1px;background:var(--dsw-alias-border-l2)}
.dsm-sub-row:hover{background:var(--dsw-alias-interactive-bg-hover);cursor:pointer}
.dsm-sub-row:hover .dsm-sub-name{color:var(--dsw-alias-label-primary)}
.dsm-sub-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-sub-meta{flex:none;font-size:10.5px;opacity:.8}
.dsm-sub-live .dsm-sub-meta{color:var(--dsw-alias-state-warning-primary);opacity:1;font-weight:600}
.dsm-sub-acts{display:none;align-items:center;gap:4px;flex:none}
.dsm-sub-row:hover .dsm-sub-acts,.dsm-sub-row:focus-within .dsm-sub-acts{display:inline-flex}
.dsm-sub-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-elevated);color:var(--dsw-alias-label-secondary);border-radius:6px;padding:1px 6px;font:inherit;font-size:10.5px;line-height:16px;cursor:pointer}
.dsm-sub-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}
.dsm-sub-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent)}
.dsm-sub-note{font-size:11px;color:var(--dsw-alias-label-tertiary);padding:2px 0}
.dsm-kids-badge:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,transparent)}
.dsm-row-sub{transform:translateX(calc(10px + var(--dsm-indent,0px)));transition:transform .15s ease}
.dsm-row-sub::before{content:'';position:absolute;left:calc(-6px - var(--dsm-indent,0px));top:0;bottom:0;width:2px;border-radius:1px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 30%,transparent);pointer-events:none}
.dsm-tag{display:inline-flex;align-items:center;margin-left:auto;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-fill-subtle);color:var(--dsw-alias-label-tertiary);font-size:10px;font-weight:500;line-height:15px;flex:none;pointer-events:auto;border:none;cursor:default}
.dsm-tag-fork{cursor:pointer;background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);color:var(--dsw-alias-state-success-primary);font-weight:600}
.dsm-tag-fork:hover{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 20%,transparent)}
.dsm-row-flash{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px;border-radius:8px;transition:outline-color .6s ease}
/* \u5FBD\u6807/\u6807\u7B7E\u7EDF\u4E00\u663E\u9690\uFF08\u5BF9\u9F50\u300C\u5B50\u4EE3\u7406\u6298\u53E0\u300D\u7684\u8282\u594F\uFF09\uFF1A\u9ED8\u8BA4\u4E00\u5F8B\u9690\u85CF\uFF0C\u7EF4\u6301 DSH
   \u539F\u751F\u884C\u5916\u89C2\uFF1B\u884C\u88AB\u9009\u4E2D\uFF08dsm-row-active\uFF0Cpaint \u6309 activeId \u5237\u65B0\uFF09\u3001\u9F20\u6807\u60AC
   \u505C\u3001\u952E\u76D8\u805A\u7126\u6216\u5DF2\u5C55\u5F00\u5B50\u4EE3\u7406\u5217\u8868\uFF08dsm-row-open\uFF09\u65F6\u624D\u51FA\u73B0\u3002display \u5207\u6362
   \u4E0D\u5360\u4F4D\uFF1A\u9690\u85CF\u65F6\u6807\u9898\u62FF\u5168\u5BBD\uFF0C\u60AC\u505C\u65F6\u624D\u8BA9\u4F4D\u7ED9\u5FBD\u6807\u3002 */
[role="treeitem"]>.dsm-kids-badge,[role="treeitem"]>.dsm-tag{display:none}
[role="treeitem"]:hover>.dsm-kids-badge,[role="treeitem"]:hover>.dsm-tag,
[role="treeitem"].dsm-row-active>.dsm-kids-badge,[role="treeitem"].dsm-row-active>.dsm-tag,
[role="treeitem"].dsm-row-open>.dsm-kids-badge,
[role="treeitem"]:focus-within>.dsm-kids-badge,[role="treeitem"]:focus-within>.dsm-tag{display:inline-flex}
@media (prefers-reduced-motion:reduce){.dsm-row-sub{transition:none}.dsm-row-flash{transition:none}}
@media (max-width:640px){.dsm-storage-bar{display:none}.dsm-storage-count{max-width:40%}}
`;
var DSM_KEY_MANUAL = "dsm-manual-unread-v1";
var dsmManualUnread = null;
var dsmRepaintDots = null;
function dsmLoadManual() {
  if (dsmManualUnread) return dsmManualUnread;
  try {
    dsmManualUnread = new Set(JSON.parse(localStorage.getItem(DSM_KEY_MANUAL) || "[]"));
  } catch (e) {
    dsmManualUnread = /* @__PURE__ */ new Set();
  }
  return dsmManualUnread;
}
function dsmSaveManual() {
  try {
    localStorage.setItem(DSM_KEY_MANUAL, JSON.stringify([...dsmLoadManual()]));
  } catch (e) {
  }
}
function dsmToggleManual(id) {
  const s = dsmLoadManual();
  if (s.has(id)) s.delete(id);
  else s.add(id);
  dsmSaveManual();
  if (dsmRepaintDots) dsmRepaintDots();
}
var dsmTrashIds = null;
var dsmServerPurgedIds = /* @__PURE__ */ new Set();
var dsmAuthoritativeTitles = /* @__PURE__ */ new Map();
var dsmTrashTick = 0;
var dsmCapabilities = null;
var dsmLineage = /* @__PURE__ */ new Map();
var dsmWarmPending = false;
var dsmRefinePending = false;
var dsmTrashRetryTimer = null;
var dsmWarmDoneHooks = /* @__PURE__ */ new Set();
function dsmOnWarmDone(fn) {
  dsmWarmDoneHooks.add(fn);
  return () => dsmWarmDoneHooks.delete(fn);
}
var DSM_KEY_SEEN_NOTICES = "dsm-move-notices-seen-v1";
var dsmSeenNotices = null;
function dsmLoadSeenNotices() {
  if (dsmSeenNotices) return dsmSeenNotices;
  try {
    dsmSeenNotices = new Set(JSON.parse(localStorage.getItem(DSM_KEY_SEEN_NOTICES) || "[]").map(String));
  } catch (e) {
    dsmSeenNotices = /* @__PURE__ */ new Set();
  }
  return dsmSeenNotices;
}
function dsmSaveSeenNotices(set) {
  try {
    localStorage.setItem(DSM_KEY_SEEN_NOTICES, JSON.stringify([...set].slice(-200)));
  } catch (e) {
  }
}
var dsmNotifySink = null;
var dsmNoticeHooks = /* @__PURE__ */ new Set();
function dsmNotify(text, kind) {
  if (!text) return;
  if (dsmNotifySink && !sidebarAdapter.disabled) {
    try {
      dsmNotifySink(text, kind);
      return;
    } catch (e) {
    }
  }
  let done = false;
  try {
    for (const fn of dsmNoticeHooks) {
      fn(text, kind);
      done = true;
    }
  } catch (e) {
  }
  if (!done) {
    try {
      console.warn("[dsh-sessions-manager] " + text);
    } catch (e) {
    }
  }
}
function dsmOnNotice(fn) {
  dsmNoticeHooks.add(fn);
  return () => dsmNoticeHooks.delete(fn);
}
async function dsmLoadCapabilities() {
  try {
    dsmCapabilities = await postJSON("/archived-sessions/capabilities", {});
  } catch (e) {
  }
  return dsmCapabilities;
}
function dsmActionCapability(name, legacy) {
  const source = dsmCapabilities && dsmCapabilities.actions;
  return source ? source[name] || legacy && source[legacy] || null : null;
}
async function dsmLoadTrashIds() {
  try {
    const r = await postJSON("/archived-sessions/sidebar-state", {});
    dsmTrashIds = new Set((r && r.trashedSessionIds || []).map(String));
    dsmServerPurgedIds = new Set((r && r.purgedSessionIds || []).map(String));
    for (const id of [...dsmPendingPurged]) {
      if (dsmServerPurgedIds.has(id)) dsmPendingPurged.delete(id);
    }
    dsmAuthoritativeTitles = new Map(Object.entries(r && r.titles || {}).map(([id, title]) => [String(id), String(title)]));
    dsmLineage.clear();
    for (const [id, info] of Object.entries(r && r.lineage || {})) {
      if (info && typeof info === "object") dsmLineage.set(String(id), info);
    }
    const wasBusy = dsmWarmPending || dsmRefinePending;
    dsmWarmPending = !!(r && r.warmPending);
    dsmRefinePending = !!(r && r.refinePending);
    if (wasBusy && !(dsmWarmPending || dsmRefinePending)) {
      try {
        for (const fn of dsmWarmDoneHooks) fn();
      } catch (e) {
      }
    }
    {
      const plan = noticeToastPlan(r && r.moveNotices, dsmLoadSeenNotices(), 2);
      if (plan.ackIds.length) {
        const seen = dsmLoadSeenNotices();
        for (const id of plan.ackIds) seen.add(id);
        dsmSaveSeenNotices(seen);
        dsmNotify(plan.text, plan.kind);
        postJSON("/archived-sessions/pending-moves/notices/ack", { ids: plan.ackIds }).catch(() => {
        });
      }
    }
    if (dsmRepaintDots) dsmRepaintDots();
  } catch (e) {
    if (dsmTrashRetryTimer == null) {
      dsmTrashRetryTimer = setTimeout(() => {
        dsmTrashRetryTimer = null;
        dsmLoadTrashIds();
      }, 2e3);
      if (typeof dsmTrashRetryTimer.unref === "function") dsmTrashRetryTimer.unref();
    }
  }
  return dsmTrashIds;
}
var dsmPendingPurged = /* @__PURE__ */ new Set();
function dsmLoadPurged() {
  return /* @__PURE__ */ new Set([...dsmServerPurgedIds, ...dsmPendingPurged]);
}
function dsmMarkPurged(ids) {
  ids.forEach((id) => dsmPendingPurged.add(String(id)));
  if (dsmRepaintDots) dsmRepaintDots();
}
var SIDEBAR_ADAPTER_VERSION = 3;
var SIDEBAR_ADAPTER_MAX_MISSES = 200;
function dsmTeardownSidebarAug() {
  if (typeof document === "undefined") return;
  const selectors = ["[data-dsm-dot]", "[data-dsm-kids]", "[data-dsm-subs]", "[data-dsm-tag]"];
  for (const sel of selectors) {
    try {
      document.querySelectorAll(sel).forEach((el) => el.remove());
    } catch (e) {
    }
  }
  try {
    document.querySelectorAll("[data-dsm-group-hidden]").forEach((owner) => {
      owner.style.display = owner.dataset.dsmPrevDisplay || "";
      owner.removeAttribute("data-dsm-group-hidden");
      delete owner.dataset.dsmPrevDisplay;
    });
  } catch (e) {
  }
}
function createSidebarAdapter() {
  let disabled = false;
  let misses = 0;
  const findFiber = (el) => {
    const k = Object.keys(el).find((kk) => kk.startsWith("__reactFiber") || kk.startsWith("__reactInternalInstance"));
    return k ? el[k] : null;
  };
  const recognize = (row) => {
    const out = { node: null, group: null };
    if (disabled || !row || typeof row !== "object") return out;
    let f = findFiber(row);
    let guard = 0;
    while (f && guard++ < 300) {
      const props = f.memoizedProps;
      if (props && props.node && typeof props.node === "object") out.node = props.node;
      if (props && props.group && typeof props.group === "object") out.group = props.group;
      f = f.return;
    }
    if (!out.node && !out.group) {
      if (++misses >= SIDEBAR_ADAPTER_MAX_MISSES && !disabled) {
        disabled = true;
        dsmTeardownSidebarAug();
        try {
          console.warn("[dsh-sessions-manager] \u4FA7\u680F\u6CE8\u5165 adapter v" + SIDEBAR_ADAPTER_VERSION + " \u5DF2\u505C\u7528\uFF1A\u672A\u8BC6\u522B\u5230\u5DF2\u77E5\u7684 DSH \u4FA7\u680F\u8282\u70B9\u7ED3\u6784\uFF08\u4E0A\u6E38\u53EF\u80FD\u5DF2\u6539\u7248\uFF09");
        } catch (e) {
        }
      }
    } else if (misses > 0) {
      misses = 0;
    }
    return out;
  };
  return {
    version: SIDEBAR_ADAPTER_VERSION,
    get disabled() {
      return disabled;
    },
    findFiber,
    recognize
  };
}
var sidebarAdapter = createSidebarAdapter();
var sidebarMenuAugInstalled = false;
function installSidebarSessionMenuAug() {
  if (typeof document === "undefined") return;
  if (sidebarMenuAugInstalled) return;
  sidebarMenuAugInstalled = true;
  const AUG = "data-dsm-aug";
  let styleInjected = false;
  let activeSubClose = null;
  let hoverTimer = null;
  const sessionInfoFromMenu = (menuEl) => {
    let f = sidebarAdapter.findFiber(menuEl);
    let guard = 0;
    while (f && guard++ < 300) {
      const p = f.memoizedProps;
      if (p && p.node && typeof p.node.id === "string" && p.node.id) {
        return { id: p.node.id, cwd: p.node.cwd || p.node.workspacePath || null };
      }
      f = f.return;
    }
    return null;
  };
  const closeMenu = () => {
    try {
      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    } catch (e) {
    }
    try {
      document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    } catch (e) {
    }
  };
  const escapeHtml = (s) => {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  };
  const toast = (msg) => {
    const t = document.createElement("div");
    const text = String(msg == null ? "" : msg);
    t.className = "dsm-toast" + (text.length > 28 ? " dsm-toast-long" : "");
    t.textContent = text;
    t.title = "\u70B9\u51FB\u5173\u95ED";
    t.setAttribute("role", "status");
    document.body.appendChild(t);
    let killTimer = null;
    const kill = () => {
      if (killTimer) clearTimeout(killTimer);
      t.remove();
    };
    killTimer = setTimeout(kill, toastDurationFor(text));
    t.addEventListener("click", kill);
  };
  const ensureStyle = () => {
    if (styleInjected) return;
    const s = document.createElement("style");
    s.dataset.dsm = "aug";
    s.textContent = SIDEBAR_AUG_CSS;
    document.head.appendChild(s);
    styleInjected = true;
  };
  const closeMoveSubmenu = () => {
    if (activeSubClose) {
      const f = activeSubClose;
      activeSubClose = null;
      f();
    }
  };
  const openMoveSubmenu = (moveBtn, info) => {
    ensureStyle();
    closeMoveSubmenu();
    const sub = document.createElement("div");
    sub.className = "dsm-sub";
    sub.setAttribute("role", "menu");
    sub.setAttribute("data-dsm-sub", "");
    sub.innerHTML = '<div class="dsm-sub-loading">\u52A0\u8F7D\u5DE5\u4F5C\u533A\u2026</div>';
    const r = moveBtn.getBoundingClientRect();
    const placeSub = () => {
      sub.style.top = Math.max(8, Math.min(Math.round(r.top - 4), window.innerHeight - sub.offsetHeight - 8)) + "px";
      sub.style.left = Math.max(8, Math.min(Math.round(r.right + 10), window.innerWidth - sub.offsetWidth - 8)) + "px";
    };
    document.body.appendChild(sub);
    placeSub();
    const closeSub = () => {
      activeSubClose = null;
      if (sub.parentNode) sub.remove();
      document.removeEventListener("mousedown", onDocDown, true);
      window.removeEventListener("blur", closeSub);
    };
    const onDocDown = (e) => {
      if (sub.contains(e.target) || moveBtn.contains(e.target)) return;
      closeSub();
    };
    sub.addEventListener("mousedown", (e) => e.stopPropagation());
    sub.addEventListener("mouseenter", () => {
      if (hoverTimer) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
      }
    });
    sub.addEventListener("mouseleave", () => {
      hoverTimer = setTimeout(() => closeSub(), 160);
    });
    setTimeout(() => document.addEventListener("mousedown", onDocDown, true), 0);
    window.addEventListener("blur", closeSub);
    activeSubClose = closeSub;
    Promise.all([
      postJSON("/archived-sessions/workspaces", {}),
      postJSON("/archived-sessions/sessions", {})
    ]).then(([ws, sess]) => {
      const items = ws.items || [];
      const cur = (sess.items || []).find((x) => x.sessionId === info.id);
      const curPath = cur ? cur.workspacePath : info.cwd || null;
      if (!items.length) {
        sub.innerHTML = '<div class="dsm-sub-empty">\uFF08\u6682\u65E0\u53EF\u7528\u5DE5\u4F5C\u533A\uFF09</div>';
        placeSub();
        return;
      }
      sub.innerHTML = "";
      items.forEach((w) => {
        const isCur = !!curPath && w.path === curPath;
        const b = document.createElement("button");
        b.type = "button";
        b.className = "dsm-sub-item";
        b.setAttribute("role", "menuitem");
        b.disabled = isCur;
        const name = document.createElement("span");
        name.className = "dsm-sub-name";
        name.textContent = w.title || pathName(w.path) || w.workspaceId;
        b.appendChild(name);
        if (isCur) {
          const c = document.createElement("span");
          c.className = "dsm-sub-cur";
          c.textContent = "\u5F53\u524D";
          b.appendChild(c);
        }
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          closeSub();
          closeMenu();
          postJSON("/archived-sessions/move", { sessionId: info.id, targetPath: w.path }).then((r2) => {
            const label = w.title || pathName(w.path) || "\u76EE\u6807\u5DE5\u4F5C\u533A";
            if (r2 && r2.queued) {
              toast(r2.notes && r2.notes.length ? r2.notes.join(" ") : "\u4F1A\u8BDD\u6B63\u88AB DSH \u6253\u5F00\uFF0C\u5DF2\u6392\u961F\u5F85\u79FB\u52A8\uFF1B\u91CD\u542F DSH \u540E\u4F1A\u81EA\u52A8\u5B8C\u6210\uFF08\u8BF7\u5148\u522B\u6253\u5F00\u5B83\uFF09\u3002");
              return;
            }
            toast(r2 && r2.already ? `\u5DF2\u5728\u300C${label}\u300D` : `\u5DF2\u79FB\u5230\u300C${label}\u300D`);
          }).catch((ee) => toast("\u79FB\u52A8\u5931\u8D25\uFF1A" + String(ee && ee.message || ee)));
        });
        sub.appendChild(b);
      });
      placeSub();
    }).catch((e) => {
      sub.innerHTML = '<div class="dsm-sub-err">' + escapeHtml(String(e && e.message || e)) + "</div>";
      placeSub();
    });
  };
  const openDeleteConfirm = (id) => {
    ensureStyle();
    const backdrop = document.createElement("div");
    backdrop.className = "dsm-backdrop";
    const dlg = document.createElement("div");
    dlg.className = "dsm-dlg";
    dlg.innerHTML = '<h3 class="dsm-title">\u5220\u9664\u4F1A\u8BDD</h3><p class="dsm-text">\u786E\u8BA4\u5C06\u8BE5\u4F1A\u8BDD\u79FB\u5165\u56DE\u6536\u7AD9\uFF1F\u53EF\u5728\u300C\u8BBE\u7F6E \u2192 \u4F1A\u8BDD\u7BA1\u7406 \u2192 \u56DE\u6536\u7AD9\u300D\u4E2D\u6062\u590D\u6216\u5F7B\u5E95\u5220\u9664\u3002</p><div class="dsm-actions"><button type="button" class="dsm-btn" data-role="cancel">\u53D6\u6D88</button><button type="button" class="dsm-btn dsm-del" data-role="ok">\u79FB\u5165\u56DE\u6536\u7AD9</button></div>';
    backdrop.appendChild(dlg);
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close();
    });
    dlg.querySelector("[data-role=cancel]").addEventListener("click", close);
    dlg.querySelector("[data-role=ok]").addEventListener("click", () => {
      close();
      postJSON("/archived-sessions/delete", { sessionId: id }).then(() => {
        if (dsmTrashIds) dsmTrashIds.add(String(id));
        if (dsmRepaintDots) dsmRepaintDots();
        toast("\u5DF2\u79FB\u5165\u56DE\u6536\u7AD9");
      }).catch((e) => toast("\u5220\u9664\u5931\u8D25\uFF1A" + String(e && e.message || e)));
    });
  };
  const augmentMenu = (menuEl, info) => {
    if (menuEl.querySelector("[" + AUG + "]")) return;
    const viewport = menuEl.querySelector('[role="presentation"]') || menuEl.firstElementChild;
    if (!viewport) return;
    const proto = menuEl.querySelector('[role="menuitem"]');
    if (!proto) return;
    const protoWrap = proto.parentElement;
    const protoCls = proto.className;
    const protoWrapCls = protoWrap ? protoWrap.className : "";
    const ICON_MOVE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v4"/><path d="M10 13l2 2 2-2"/></svg>';
    const ICON_DEL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M9 7V4h6v3"/></svg>';
    const ICON_UNREAD = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>';
    const mk = (label, svg, danger) => {
      const wrap = protoWrap ? protoWrap.cloneNode(false) : document.createElement("div");
      if (protoWrapCls) wrap.className = protoWrapCls;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "menuitem");
      btn.className = protoCls;
      const icon = document.createElement("span");
      icon.style.cssText = "display:inline-flex;flex:none;width:16px;height:16px;align-items:center;justify-content:center;color:" + (danger ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-label-tertiary)");
      icon.innerHTML = svg;
      const lab = document.createElement("span");
      lab.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      lab.textContent = label;
      btn.appendChild(icon);
      btn.appendChild(lab);
      if (danger) btn.style.color = "var(--dsw-alias-state-error-primary)";
      btn.setAttribute(AUG, "");
      wrap.appendChild(btn);
      return { wrap, btn };
    };
    const move = mk("\u79FB\u52A8\u4F1A\u8BDD", ICON_MOVE, false);
    const del = mk("\u5220\u9664\u4F1A\u8BDD", ICON_DEL, true);
    const mark = mk(dsmLoadManual().has(info.id) ? "\u6807\u8BB0\u5DF2\u8BFB" : "\u6807\u8BB0\u672A\u8BFB", ICON_UNREAD, false);
    const moveCapability = dsmActionCapability("relocateSession") || dsmActionCapability("move");
    if (!moveCapability || !moveCapability.available) {
      move.btn.disabled = true;
      move.btn.title = moveCapability && moveCapability.reason || "\u6B63\u5728\u68C0\u67E5\u5F53\u524D\u7248\u672C\u7684\u79FB\u52A8\u80FD\u529B";
    }
    if (mark.btn.firstChild) mark.btn.firstChild.style.color = "var(--dsw-alias-state-business-primary)";
    const chev = document.createElement("span");
    chev.style.cssText = "margin-left:auto;flex:none;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:1";
    chev.textContent = "\u203A";
    move.btn.appendChild(chev);
    move.btn.addEventListener("mouseenter", () => {
      if (!document.querySelector("[data-dsm-sub]")) openMoveSubmenu(move.btn, info);
    });
    move.btn.addEventListener("mouseleave", () => {
      hoverTimer = setTimeout(() => closeMoveSubmenu(), 160);
    });
    move.btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
    });
    del.btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      closeMoveSubmenu();
      openDeleteConfirm(info.id);
    });
    mark.btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      closeMoveSubmenu();
      dsmToggleManual(info.id);
      closeMenu();
    });
    viewport.appendChild(move.wrap);
    viewport.appendChild(del.wrap);
    viewport.insertBefore(mark.wrap, viewport.firstElementChild);
    window.dispatchEvent(new Event("resize"));
  };
  const seen = /* @__PURE__ */ new WeakSet();
  const obs = new MutationObserver(() => {
    if (sidebarAdapter.disabled) return;
    const menus = document.querySelectorAll('body > [role="menu"]');
    menus.forEach((menuEl) => {
      if (seen.has(menuEl)) return;
      const info = sessionInfoFromMenu(menuEl);
      if (!info) return;
      seen.add(menuEl);
      try {
        augmentMenu(menuEl, info);
      } catch (e) {
      }
    });
  });
  obs.observe(document.body, { childList: true, subtree: false });
}
function installSidebarStatusDots() {
  if (typeof document === "undefined") return;
  const DOT = "data-dsm-dot";
  if (!document.querySelector("style[data-dsm=aug]")) {
    const s = document.createElement("style");
    s.dataset.dsm = "aug";
    s.textContent = SIDEBAR_AUG_CSS;
    document.head.appendChild(s);
  }
  const rowNode = (row) => sidebarAdapter.recognize(row).node;
  const rowId = (row) => {
    const node = rowNode(row);
    return node ? node.id : null;
  };
  let curActive = null;
  const activeRowId = () => {
    const sel = document.querySelector('[role="treeitem"][aria-selected="true"]');
    return sel ? rowId(sel) : null;
  };
  const COLOR = {
    manual: "var(--dsw-alias-state-business-primary)",
    // 蓝 手动标记未读
    running: "#EAB308",
    // 黄 工作中 (DSH running)
    feedback: "var(--dsw-alias-state-warn-primary, #F59E0B)",
    // 琥珀 需用户反馈 (DSH warning)
    done: "var(--dsw-alias-state-success-primary)",
    // 绿 完成后未读 (DSH done)
    error: "var(--dsw-alias-state-error-primary)"
    // 红 出错/需关注 (DSH error)
  };
  const manualUnread = dsmLoadManual();
  const titleBaselines = /* @__PURE__ */ new WeakMap();
  function dsmSyncEmptyGroups() {
    let groups = null;
    try {
      groups = document.querySelectorAll('[role="group"]');
    } catch (e) {
      return;
    }
    if (!groups || !groups.length) return;
    groups.forEach((g) => {
      const items = g.querySelectorAll('[role="treeitem"]');
      if (!items.length) return;
      let visible = 0;
      items.forEach((it) => {
        if (it.style.display !== "none") visible++;
      });
      const owner = g.closest('[role="treeitem"]') || g;
      if (visible === 0) {
        if (!owner.hasAttribute("data-dsm-group-hidden")) {
          owner.dataset.dsmPrevDisplay = owner.style.display || "";
          owner.setAttribute("data-dsm-group-hidden", "");
        }
        if (owner.style.display !== "none") owner.style.display = "none";
      } else if (owner.hasAttribute("data-dsm-group-hidden")) {
        const prev = owner.dataset.dsmPrevDisplay || "";
        if (owner.style.display !== prev) owner.style.display = prev;
        owner.removeAttribute("data-dsm-group-hidden");
        delete owner.dataset.dsmPrevDisplay;
      }
    });
  }
  const paint = () => {
    if (sidebarAdapter.disabled) return;
    const activeId = activeRowId();
    if (activeId !== curActive && activeId && manualUnread.has(activeId)) {
      manualUnread.delete(activeId);
      dsmSaveManual();
    }
    curActive = activeId;
    const purgedNow = dsmLoadPurged();
    const kidsByParent = (() => {
      const m = /* @__PURE__ */ new Map();
      for (const [id, info] of dsmLineage.entries()) {
        if (info.origin !== "subagent" || !info.parentSession) continue;
        if (dsmTrashIds && dsmTrashIds.has(id) || purgedNow.has(id)) continue;
        m.set(info.parentSession, (m.get(info.parentSession) || 0) + 1);
      }
      return m;
    })();
    const rows = document.querySelectorAll('[role="treeitem"]');
    document.querySelectorAll("[data-dsm-subs]").forEach((box) => {
      const pid = box.getAttribute("data-dsm-subs");
      const prev = box.previousElementSibling;
      if (!prev || rowId(prev) !== pid) box.remove();
    });
    rows.forEach((row) => {
      const id = rowId(row);
      if (!id) return;
      const purged = purgedNow;
      if (dsmTrashIds && dsmTrashIds.has(id) || purged.has(id)) {
        if (row.style.display !== "none") row.style.display = "none";
        const d = row.querySelector("[" + DOT + "]");
        if (d) d.remove();
        dsmDropSubList(row, id);
        return;
      }
      const li = dsmLineage.get(id);
      const isSub = !!(li && li.origin === "subagent");
      const isEmpty = !!(li && li.empty);
      row.classList.remove("dsm-row-sub");
      row.classList.toggle("dsm-row-active", id === activeId);
      row.style.removeProperty("--dsm-indent");
      let hideLineage = false;
      if (li && isSub) {
        row.classList.add("dsm-row-sub");
        if (getComputedStyle(row).position === "static") row.style.position = "relative";
        const depth = Math.max(0, (li.delegationDepth || 1) - 1);
        if (depth > 0) row.style.setProperty("--dsm-indent", String(depth * 10) + "px");
      } else if (li && isEmpty) {
        hideLineage = true;
      }
      if (hideLineage) {
        if (row.style.display !== "none") row.style.display = "none";
        const d = row.querySelector("[" + DOT + "]");
        if (d) d.remove();
        dsmDropSubList(row, id);
        return;
      }
      if (row.style.display === "none") row.style.display = "";
      if (!isEmpty && li && li.parentSession && li.origin !== "subagent") {
        const parentTitle = dsmAuthoritativeTitles.get(li.parentSession);
        const tip = parentTitle ? "\u5206\u652F\u4E8E\uFF1A" + parentTitle : "\u5206\u652F\u4F1A\u8BDD\uFF08\u70B9\u51FB\u67E5\u770B\u6765\u6E90\u4F1A\u8BDD\uFF09";
        let fork = row.querySelector('[data-dsm-tag="fork"]');
        if (!fork) {
          fork = document.createElement("button");
          fork.type = "button";
          fork.dataset.dsmTag = "fork";
          fork.className = "dsm-tag dsm-tag-fork";
          fork.textContent = "\u2442 \u5206\u652F";
          fork.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            const target = e.currentTarget.dataset.dsmForkParent || "";
            const rows2 = document.querySelectorAll('[role="treeitem"]');
            for (const other of rows2) {
              if (rowId(other) === target) {
                other.scrollIntoView({ block: "center", behavior: "smooth" });
                other.classList.add("dsm-row-flash");
                setTimeout(() => other.classList.remove("dsm-row-flash"), 1200);
                break;
              }
            }
          });
          row.appendChild(fork);
        }
        if (fork.dataset.dsmForkParent !== li.parentSession) fork.dataset.dsmForkParent = String(li.parentSession);
        if (fork.title !== tip) {
          fork.title = tip;
          fork.setAttribute("aria-label", tip);
        }
      } else {
        const staleFork = row.querySelector('[data-dsm-tag="fork"]');
        if (staleFork) staleFork.remove();
      }
      if (!isEmpty && !isSub) {
        const kids = kidsByParent.get(id);
        const existingKids = row.querySelector("[data-dsm-kids]");
        const open = dsmSubsOpen.has(id);
        row.classList.toggle("dsm-row-open", open);
        if (kids) {
          const text = (open ? "\u25BE " : "\u25B8 ") + kids + " \u5B50\u4EE3\u7406";
          let badge = existingKids;
          if (!badge) {
            badge = document.createElement("button");
            badge.type = "button";
            badge.dataset.dsmKids = "";
            badge.className = "dsm-kids-badge";
            badge.addEventListener("click", (e) => {
              e.stopPropagation();
              e.preventDefault();
              dsmToggleSubs(badge);
            });
            row.appendChild(badge);
          }
          if (badge.dataset.dsmParentId !== id) badge.dataset.dsmParentId = id;
          if (badge.textContent !== text) badge.textContent = text;
          const label = (open ? "\u6536\u8D77" : "\u5C55\u5F00") + "\u8BE5\u4F1A\u8BDD\u7684 " + kids + " \u4E2A\u5B50\u4EE3\u7406";
          if (badge.getAttribute("aria-label") !== label) {
            badge.setAttribute("aria-label", label);
            badge.title = label;
          }
          if (badge.getAttribute("aria-expanded") !== String(open)) badge.setAttribute("aria-expanded", String(open));
          if (open) dsmSyncSubList(row, id);
          else dsmDropSubList(row, id);
        } else {
          if (existingKids) existingKids.remove();
          dsmDropSubList(row, id);
        }
      } else {
        row.classList.remove("dsm-row-open");
        const staleKids = row.querySelector("[data-dsm-kids]");
        if (staleKids) staleKids.remove();
      }
      const authoritativeTitle = dsmAuthoritativeTitles.get(id);
      {
        const base = titleBaselines.get(row);
        if (!base || base.id !== id || authoritativeTitle && authoritativeTitle !== base.authoritative) {
          const node = rowNode(row) || {};
          const expected = new Set([node.title, node.displayTitle, node.name].filter((value) => typeof value === "string"));
          const spans = [...row.children].filter((el) => el.tagName === "SPAN" && !el.querySelector("[data-state]") && (el.textContent || "").trim());
          let titleEl = null;
          if (base && base.id === id) {
            titleEl = spans.find((el) => (el.textContent || "") === base.text) || spans.find((el) => expected.has((el.textContent || "").trim())) || null;
          } else {
            titleEl = spans.find((el) => expected.has((el.textContent || "").trim())) || spans[0] || null;
          }
          if (titleEl) {
            const d = titleBackfillDecision({
              rendered: titleEl.textContent || "",
              baseline: base && base.id === id ? { text: base.text, authoritative: base.authoritative } : null,
              authoritative: authoritativeTitle || ""
            });
            if (d) {
              if (d.changed && titleEl.textContent !== d.text) titleEl.textContent = d.text;
              titleBaselines.set(row, { id, text: d.nextBaseline.text, authoritative: d.nextBaseline.authoritative });
            }
          }
        }
      }
      const sd = row.querySelector("[data-state]");
      if (sd) sd.style.display = "none";
      let dot = row.querySelector("[" + DOT + "]");
      const state = dotStateFor({ manualUnread: manualUnread.has(id), dataState: sd ? sd.getAttribute("data-state") : "", isActive: activeId === id });
      const color = state ? COLOR[state] : null;
      if (!color) {
        if (dot) dot.remove();
        return;
      }
      if (!dot) {
        dot = document.createElement("span");
        dot.setAttribute(DOT, "");
        dot.className = "dsm-dot";
        if (!row.hasAttribute("data-dsm-pos")) {
          if (getComputedStyle(row).position === "static") row.style.position = "relative";
          row.setAttribute("data-dsm-pos", "");
        }
        dot.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          dsmToggleManual(id);
        });
        row.insertBefore(dot, row.firstChild);
      }
      dot.style.background = color;
    });
    dsmSyncEmptyGroups();
  };
  dsmRepaintDots = paint;
  const paintToast = (msg, kind) => {
    const t = document.createElement("div");
    t.className = "dsm-toast" + (kind === "err" ? " dsm-toast-err" : "");
    t.textContent = msg;
    t.setAttribute("role", "status");
    t.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:80%;padding:8px 14px;border-radius:8px;background:#2C2C2A;color:#F1EFE8;font-size:12px;line-height:1.5;z-index:9999;cursor:pointer";
    t.addEventListener("click", () => t.remove());
    document.body.appendChild(t);
    setTimeout(() => t.remove(), toastDurationFor(msg, kind));
  };
  dsmNotifySink = paintToast;
  const DSM_KEY_SUBS = "dsm-subs-open-v1";
  const dsmSubsOpen = /* @__PURE__ */ new Set();
  try {
    for (const id of JSON.parse(localStorage.getItem(DSM_KEY_SUBS) || "[]")) if (typeof id === "string") dsmSubsOpen.add(id);
  } catch (e) {
  }
  const dsmSaveSubsOpen = () => {
    try {
      localStorage.setItem(DSM_KEY_SUBS, JSON.stringify([...dsmSubsOpen]));
    } catch (e) {
    }
  };
  const dsmSubTrees = /* @__PURE__ */ new Map();
  const SUB_TTL_MS = 15e3;
  async function dsmFetchSubTree(pid) {
    const cached = dsmSubTrees.get(pid);
    if (cached && Date.now() - cached.ts < SUB_TTL_MS) return cached;
    dsmSubTrees.set(pid, { ts: Date.now(), status: "loading", nodes: cached && cached.nodes || [] });
    try {
      const r = await postJSON("/archived-sessions/lineage-tree", { sessionId: pid });
      dsmSubTrees.set(pid, { ts: Date.now(), status: "ready", nodes: r && r.nodes || [] });
    } catch (e) {
      dsmSubTrees.set(pid, { ts: Date.now(), status: "error", nodes: [], error: String(e && e.message || e) });
    }
    if (dsmRepaintDots) dsmRepaintDots();
    return dsmSubTrees.get(pid);
  }
  async function dsmSubAction(sid, kind) {
    try {
      await postJSON("/archived-sessions/delete", { sessionId: sid });
      if (kind === "purge") {
        await postJSON("/archived-sessions/trash/purge", { sessionId: sid });
        dsmMarkPurged([sid]);
        paintToast("\u5DF2\u5F7B\u5E95\u5220\u9664\u8BE5\u5B50\u4EE3\u7406");
      } else {
        paintToast("\u5DF2\u79FB\u5165\u56DE\u6536\u7AD9");
      }
      dsmDropSubagentFromTrees(sid);
      for (const pid of [...dsmSubTrees.keys()]) dsmFetchSubTree(pid);
      dsmLoadTrashIds();
      if (dsmRepaintDots) dsmRepaintDots();
    } catch (e) {
      paintToast("\u64CD\u4F5C\u5931\u8D25\uFF1A" + String(e && e.message || e));
    }
  }
  function dsmDropSubagentFromTrees(sid) {
    const target = String(sid);
    const prune = (nodes) => (nodes || []).filter((n) => String(n.sessionId) !== target).map((n) => ({ ...n, children: prune(n.children) }));
    for (const [pid, rec] of dsmSubTrees) {
      if (!rec || !Array.isArray(rec.nodes)) continue;
      dsmSubTrees.set(pid, { ...rec, nodes: prune(rec.nodes) });
    }
  }
  function dsmToggleSubs(badge) {
    const pid = badge && badge.dataset ? badge.dataset.dsmParentId : null;
    if (!pid) return;
    if (sidebarAdapter.disabled) {
      paintToast("\u4FA7\u680F\u9002\u914D\u5668\u5DF2\u505C\u7528\uFF08\u4E0A\u6E38\u7ED3\u6784\u53D8\u5316\uFF09\uFF0C\u8BF7\u6539\u4ECE \u8BBE\u7F6E \u2192 \u4F1A\u8BDD\u7BA1\u7406 \u67E5\u770B\u5B50\u4EE3\u7406");
      return;
    }
    if (dsmSubsOpen.has(pid)) {
      dsmSubsOpen.delete(pid);
      dsmSubTrees.delete(pid);
    } else {
      dsmSubsOpen.add(pid);
    }
    dsmSaveSubsOpen();
    if (dsmRepaintDots) dsmRepaintDots();
  }
  function dsmDropSubList(row, pid) {
    const parent = row.parentNode;
    if (!parent) return;
    for (const el of parent.children) {
      if (el.getAttribute && el.getAttribute("data-dsm-subs") === pid) {
        el.remove();
        break;
      }
    }
  }
  function dsmSyncSubList(row, pid) {
    const parent = row.parentNode;
    if (!parent) return;
    const open = dsmSubsOpen.has(pid);
    let box = null;
    for (const el of parent.children) {
      if (el.getAttribute && el.getAttribute("data-dsm-subs") === pid) {
        box = el;
        break;
      }
    }
    if (!open) {
      if (box) box.remove();
      return;
    }
    const rec = dsmSubTrees.get(pid);
    if (!rec) {
      dsmFetchSubTree(pid);
      return;
    }
    if (!box) {
      box = document.createElement("div");
      box.setAttribute("data-dsm-subs", pid);
      box.className = "dsm-subs";
      parent.insertBefore(box, row.nextSibling);
    } else if (box.nextElementSibling !== row.nextSibling && box.previousElementSibling !== row) {
      parent.insertBefore(box, row.nextSibling);
    }
    const flat = [];
    const walk = (nodes, depth) => {
      for (const n of nodes || []) {
        flat.push([n, depth]);
        if (depth < 4) walk(n.children, depth + 1);
      }
    };
    walk(rec.nodes, 0);
    const effTitle = (n) => n.title || dsmAuthoritativeTitles.get(String(n.sessionId)) || "";
    const sig = rec.status + "|" + flat.map(([n, d]) => [n.sessionId, effTitle(n), n.live ? 1 : 0, n.sizeBytes, d].join(":")).join(";");
    if (box.dataset.dsmSig === sig) return;
    box.dataset.dsmSig = sig;
    box.textContent = "";
    if (rec.status === "loading" && !flat.length) {
      const p = document.createElement("div");
      p.className = "dsm-sub-note";
      p.textContent = "\u52A0\u8F7D\u5B50\u4EE3\u7406\u2026";
      box.appendChild(p);
      return;
    }
    if (rec.status === "error") {
      const p = document.createElement("div");
      p.className = "dsm-sub-note";
      p.textContent = "\u5B50\u4EE3\u7406\u52A0\u8F7D\u5931\u8D25\uFF1A" + (rec.error || "\u672A\u77E5\u9519\u8BEF");
      box.appendChild(p);
      return;
    }
    if (!flat.length) {
      const p = document.createElement("div");
      p.className = "dsm-sub-note";
      p.textContent = "\u8BE5\u4F1A\u8BDD\u6CA1\u6709\u5B50\u4EE3\u7406";
      box.appendChild(p);
      return;
    }
    const canPurgeSub = dsmActionCapability("physicalPurge", "purge");
    for (const [n, depth] of flat) {
      const r = document.createElement("div");
      r.className = "dsm-sub-row" + (n.live ? " dsm-sub-live" : "");
      r.style.paddingLeft = String(14 + depth * 12) + "px";
      r.title = "\u6253\u5F00\u8FD9\u4E2A\u5B50\u4EE3\u7406\u4F1A\u8BDD";
      r.addEventListener("click", async () => {
        const res = await dsmOpenSessionById(n.sessionId, n.parentSession || pid);
        if (res === "ok") return;
        const msg = openSubagentToast(res, n.title, "sidebar");
        paintToast(msg.text, msg.kind);
      });
      const name = document.createElement("span");
      name.className = "dsm-sub-name";
      name.textContent = effTitle(n) || String(n.sessionId).slice(0, 8) + "\u2026";
      name.title = n.sessionId;
      r.appendChild(name);
      const meta = document.createElement("span");
      meta.className = "dsm-sub-meta";
      meta.textContent = n.live ? "\u8FD0\u884C\u4E2D" : fmtBytes(n.sizeBytes) || "\u5DF2\u7ED3\u675F";
      r.appendChild(meta);
      const acts = document.createElement("span");
      acts.className = "dsm-sub-acts";
      const del = document.createElement("button");
      del.type = "button";
      del.className = "dsm-sub-btn";
      del.textContent = "\u5220\u9664";
      del.title = "\u79FB\u5165\u56DE\u6536\u7AD9\uFF0C\u53EF\u5728\u56DE\u6536\u7AD9\u6062\u590D";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        dsmSubAction(n.sessionId, "delete");
      });
      acts.appendChild(del);
      r.appendChild(acts);
      box.appendChild(r);
    }
  }
  let raf = 0;
  const schedulePaint = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      paint();
    });
  };
  const FALLBACK_TICK_MS = 4e3;
  const tick = () => {
    if (typeof document !== "undefined" && document.hidden) return;
    const cadence = dsmWarmPending || dsmRefinePending ? 1 : 8;
    if (++dsmTrashTick % cadence === 0) dsmLoadTrashIds();
    paint();
  };
  tick();
  dsmLoadTrashIds();
  const coldSecondBeat = setTimeout(() => dsmLoadTrashIds(), 1500);
  paint();
  const obs = new MutationObserver(schedulePaint);
  obs.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-state", "aria-selected", "class", "style"],
    characterData: true
  });
  const tickTimer = setInterval(tick, FALLBACK_TICK_MS);
  return () => {
    clearInterval(tickTimer);
    clearTimeout(coldSecondBeat);
    obs.disconnect();
    dsmNotifySink = null;
    dsmTeardownSidebarAug();
  };
}
var sidebarDragInstalled = false;
function installSidebarWorkspaceDrag() {
  if (typeof document === "undefined") return;
  if (sidebarDragInstalled) return;
  sidebarDragInstalled = true;
  let sessions = /* @__PURE__ */ new Map();
  let dragging = null;
  let moving = false;
  const sessionForRow = (row) => {
    const { node, group } = sidebarAdapter.recognize(row);
    return sessionForNodes(group ? [node, group].filter(Boolean) : [node], sessions);
  };
  const workspaceForRow = (row) => {
    if (sessionForRow(row)) return null;
    const { group } = sidebarAdapter.recognize(row);
    return group ? workspaceForNodes([group]) : null;
  };
  const eventRow = (event) => {
    for (const item of event.composedPath ? event.composedPath() : []) {
      if (item instanceof Element && item.getAttribute("role") === "treeitem") return item;
    }
    return event.target instanceof Element ? event.target.closest('[role="treeitem"]') : null;
  };
  const toast = (message) => {
    const el = document.createElement("div");
    el.className = "dsm-toast";
    el.setAttribute("role", "status");
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), toastDurationFor(message));
  };
  const clearVisuals = () => {
    document.querySelectorAll(".dsm-drag-source,.dsm-drop-target").forEach((el) => el.classList.remove("dsm-drag-source", "dsm-drop-target"));
  };
  const decorateRows = () => {
    if (sidebarAdapter.disabled) return;
    document.querySelectorAll('[role="treeitem"]').forEach((row) => {
      const session = sessionForRow(row);
      const ws = workspaceForRow(row);
      if (session) {
        row.setAttribute("aria-description", "\u53EF\u62D6\u52A8\u5230\u5176\u4ED6\u5DE5\u4F5C\u533A\uFF1B\u952E\u76D8\u7528\u6237\u53EF\u901A\u8FC7\u66F4\u591A\u83DC\u5355\u4E2D\u7684\u79FB\u52A8\u4F1A\u8BDD\u64CD\u4F5C");
      }
      if (ws) row.setAttribute("data-dsm-workspace-drop", "");
    });
  };
  const refresh = async () => {
    try {
      const sessionResult = await postJSON("/archived-sessions/sessions", {});
      sessions = new Map((sessionResult.items || []).map((item) => [String(item.sessionId), item]));
      decorateRows();
    } catch (e) {
    }
  };
  document.addEventListener("pointerdown", (event) => {
    if (moving) return;
    const row = eventRow(event);
    if (!row || sessionForRow(row)) return;
    maybeRefresh();
  }, true);
  document.addEventListener("dragstart", (event) => {
    if (sidebarAdapter.disabled) return;
    const moveCapability = dsmActionCapability("relocateSession") || dsmActionCapability("move");
    if (!moveCapability || !moveCapability.available) return;
    const row = eventRow(event);
    const item = row && sessionForRow(row);
    if (!item || moving) return;
    dragging = item;
    row.classList.add("dsm-drag-source");
  }, true);
  document.addEventListener("dragover", (event) => {
    const row = eventRow(event);
    const target = row && workspaceForRow(row);
    if (!dragging || !target || moving) return;
    if (!canDropOnWorkspace(dragging, target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    document.querySelectorAll(".dsm-drop-target").forEach((el) => {
      if (el !== row) el.classList.remove("dsm-drop-target");
    });
    row.classList.add("dsm-drop-target");
  }, true);
  document.addEventListener("drop", async (event) => {
    const row = eventRow(event);
    const item = dragging;
    const target = row && workspaceForRow(row);
    if (!item || !target || moving || !canDropOnWorkspace(item, target)) return;
    event.preventDefault();
    event.stopPropagation();
    moving = true;
    clearVisuals();
    row.classList.add("dsm-drag-busy");
    try {
      const result = await postJSON("/archived-sessions/move", { sessionId: item.sessionId, targetPath: target.path });
      if (result && result.queued) {
        await dsmLoadTrashIds();
        toast(result.notes && result.notes.length ? result.notes.join(" ") : "\u4F1A\u8BDD\u6B63\u88AB DSH \u6253\u5F00\uFF0C\u5DF2\u6392\u961F\u5F85\u79FB\u52A8\uFF1B\u91CD\u542F DSH \u540E\u4F1A\u81EA\u52A8\u5B8C\u6210\uFF08\u8BF7\u5148\u522B\u6253\u5F00\u5B83\uFF09\u3002");
        return;
      }
      sessions.set(item.sessionId, { ...item, workspacePath: result.workspacePath || target.path, workspaceTitle: result.workspaceTitle || target.title });
      await dsmLoadTrashIds();
      toast(result && result.already ? `\u5DF2\u5728\u300C${result.workspaceTitle || target.title}\u300D` : `\u5DF2\u79FB\u5230\u300C${result.workspaceTitle || target.title}\u300D`);
    } catch (error) {
      toast("\u79FB\u52A8\u5931\u8D25\uFF1A" + String(error && error.message || error));
    } finally {
      moving = false;
      dragging = null;
      row.classList.remove("dsm-drag-busy");
      decorateRows();
    }
  }, true);
  document.addEventListener("dragend", () => {
    dragging = null;
    clearVisuals();
  }, true);
  let decorateTimer = null;
  const scheduleDecorate = () => {
    if (decorateTimer) return;
    decorateTimer = requestAnimationFrame(() => {
      decorateTimer = null;
      decorateRows();
    });
  };
  refresh();
  const observer = new MutationObserver(scheduleDecorate);
  observer.observe(document.body, { childList: true, subtree: true });
  let lastRefreshAt = Date.now();
  const maybeRefresh = () => {
    if (typeof document !== "undefined" && document.hidden) return;
    lastRefreshAt = Date.now();
    return refresh();
  };
  const REFRESH_MS = 6e4;
  setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    if (Date.now() - lastRefreshAt < REFRESH_MS) return;
    maybeRefresh();
  }, REFRESH_MS);
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      if (Date.now() - lastRefreshAt < 3e4) return;
      maybeRefresh();
    });
  }
}
function apply(ctx) {
  dsmClientCtx = ctx;
  dsmLoadCapabilities();
  installSettingsNavIcons(ctx);
  installSidebarSessionMenuAug();
  const disposeSidebarDots = installSidebarStatusDots();
  if (disposeSidebarDots) ctx.effect(() => disposeSidebarDots);
  installSidebarWorkspaceDrag();
  const workspacesSvc = ctx.get("workspaces");
  ctx.slots.inject(
    "settings.section",
    () => ctx.slots.register(
      { name: "settings.section", id: "session-manager", order: 90, label: "\u4F1A\u8BDD\u7BA1\u7406" },
      (props) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SessionPanel, { ...props, workspacesSvc })
    )
  );
}
return module.exports; } });
//# sourceMappingURL=client.js.map
