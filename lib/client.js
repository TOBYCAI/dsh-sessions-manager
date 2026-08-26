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
var import_jsx_runtime = require("react/jsx-runtime");
var inject = ["slots"];
var CSS = `
.archv{display:flex;flex-direction:column;gap:4px;max-width:800px;padding:8px 2px 28px}
.archv-head{display:flex;align-items:center;gap:10px;margin:0 0 2px}
.archv-title{font-size:16px;font-weight:650;color:var(--dsw-alias-label-primary);letter-spacing:-0.01em;margin:0}
.archv-count{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-fill-subtle);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:1px 8px;flex:none}
.archv-sub{font-size:12px;line-height:1.55;color:var(--dsw-alias-label-tertiary);margin:0 0 12px;max-width:64ch}
.archv-err{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);border-radius:10px;color:var(--dsw-alias-state-error-primary);font-size:12px;margin-bottom:10px}
.archv-errretry{appearance:none;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent);background:transparent;color:inherit;border-radius:8px;padding:4px 10px;font-size:11px;cursor:pointer;flex:none}
.sess-filter{display:flex;align-items:center;gap:6px;margin:0 0 12px}
.sess-fbtn{appearance:none;min-height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-subtle);color:var(--dsw-alias-label-secondary);border-radius:999px;font-size:12px;font-weight:500;cursor:pointer}
.sess-fbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.sess-fbtn-on{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}
.sess-batch{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 2px 4px;margin-bottom:4px}
.sess-btntext{font-size:12px;color:var(--dsw-alias-label-tertiary);flex:none}
.archv-list{display:flex;flex-direction:column;gap:8px}
.archv-card{display:flex;flex-direction:column;align-items:stretch;gap:0;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-fill-elevated);transition:border-color .15s ease,background-color .15s ease}
.archv-card:hover{border-color:var(--dsw-alias-border-l4)}
.archv-card-exp{border-color:var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-1)}
.archv-row{display:flex;align-items:center;gap:14px;width:100%;min-width:0}
.archv-main{min-width:0;display:flex;flex-direction:column;gap:4px}
.archv-name{font-size:13px;font-weight:550;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.archv-meta{display:flex;align-items:center;gap:7px;flex-wrap:wrap;min-width:0}
.archv-wtag{display:inline-flex;align-items:center;gap:4px;max-width:100%;font-size:11px;font-weight:500;line-height:1;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-fill-subtle);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:3px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.archv-wgone{border-style:dashed;color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 7%,transparent)}
.archv-active{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 8%,transparent)}
.archv-date{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none}
.archv-id{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;color:var(--dsw-alias-label-tertiary);flex:none}
.archv-dot{color:var(--dsw-alias-border-l3);flex:none}
.archv-check{width:15px;height:15px;accent-color:var(--dsw-alias-state-business-primary);flex:none;cursor:pointer}
.archv-body{flex:1;min-width:0;display:flex;align-items:center;gap:12px}
.archv-actions{display:flex;gap:8px;flex:none;flex-wrap:nowrap;justify-content:flex-end}
.archv-btn{appearance:none;min-height:32px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-subtle);color:var(--dsw-alias-label-secondary);border-radius:9px;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;transition:background-color .15s ease,border-color .15s ease,color .15s ease}
.archv-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.archv-btn:disabled{opacity:.5;cursor:default}
.archv-del{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}
.archv-del:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}
.archv-go{color:var(--dsw-alias-state-business-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 45%,transparent)}
.archv-go:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);color:var(--dsw-alias-state-business-primary)}
.archv-empty{display:flex;align-items:center;gap:10px;padding:20px 14px;border:1px dashed var(--dsw-alias-border-l3);border-radius:12px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.archv-skel{display:flex;flex-direction:column;gap:8px}
.archv-skel-card{height:58px;border-radius:12px;background:var(--dsw-alias-fill-subtle);position:relative;overflow:hidden}
.archv-skel-card::after{content:'';position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--dsw-alias-fill-elevated) 75%,transparent),transparent);animation:archv-shimmer 1.4s infinite}
.archv-status{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:60;background:var(--dsw-alias-fill-elevated);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);padding:9px 16px;border-radius:999px;font-size:12px;box-shadow:0 8px 24px rgb(0 0 0/.18);display:flex;align-items:center;gap:8px;animation:archv-pop .18s ease-out;max-width:min(90vw,420px)}
.archv-spin{width:12px;height:12px;border:2px solid color-mix(in srgb,var(--dsw-alias-label-secondary) 35%,transparent);border-top-color:var(--dsw-alias-label-secondary);border-radius:50%;animation:archv-rot .8s linear infinite;flex:none}
@keyframes archv-shimmer{100%{transform:translateX(100%)}}
@keyframes archv-rot{to{transform:rotate(360deg)}}
@keyframes archv-pop{from{opacity:0;transform:translateX(-50%) translateY(10px)}}
@media (prefers-reduced-motion:reduce){.archv-skel-card::after{animation:none}.archv-card,.archv-btn{transition:none}.archv-status,.archv-spin{animation:none}}
@media (max-width:640px){.archv-card{flex-direction:column;align-items:stretch;gap:10px}.archv-actions{justify-content:flex-end}}
.mv-sheet{width:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:12px;margin-top:12px;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-fill-subtle)}
.mv-sheet-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.mv-sheet-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);margin:0}
.mv-sheet-close{appearance:none;width:26px;height:26px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:7px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:16px;line-height:1}
.mv-sheet-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.mv-seg{display:flex;gap:2px;padding:2px;background:var(--dsw-alias-fill-elevated);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;width:100%}
.mv-segbtn{appearance:none;flex:1;min-height:30px;padding:0 12px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.mv-segbtn:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.mv-segbtn-on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgb(0 0 0/.08)}
.mv-field{display:flex;flex-direction:column;gap:6px}
.mv-field label.mv-field-label{font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.mv-field select,.mv-field input[type=text]{box-sizing:border-box;appearance:none;width:100%;min-height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-fill-elevated);color:var(--dsw-alias-label-primary);font-size:12px;font-family:inherit}
.mv-field select:focus-visible,.mv-field input[type=text]:focus-visible,.mv-sheet-close:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.mv-browse-row{display:flex;align-items:center;gap:8px}
.mv-browse-row input[type=text]{flex:1;min-width:0}
.mv-foot{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:2px}
@media (max-width:640px){.archv-row{flex-wrap:wrap}.mv-sheet{padding:12px}}
.dtl-sheet{margin-top:12px;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-fill-subtle)}
.dtl-sheet-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.dtl-sheet-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);margin:0}
.dtl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin-top:10px}
.dtl-cell{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-fill-elevated);min-width:0}
.dtl-k{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dtl-v{font-size:12px;color:var(--dsw-alias-label-primary);word-break:break-all}
.dtl-sec{margin-top:12px}
.dtl-sec-t{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.03em;margin-bottom:6px}
.dtl-tags{display:flex;flex-wrap:wrap;gap:6px}
.dtl-tag{display:inline-flex;font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-fill-elevated);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 8px}
.dtl-list{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:3px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.dtl-list code,.dtl-paths code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-primary);word-break:break-all}
.dtl-filetool{color:var(--dsw-alias-label-tertiary)}
.dtl-paths{display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:var(--dsw-alias-label-secondary);word-break:break-all}
.more-wrap{position:relative;flex:none}
.more-btn{appearance:none;width:28px;height:28px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;line-height:1}
.more-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.more-menu{position:absolute;top:calc(100% + 4px);right:0;z-index:60;min-width:160px;padding:5px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l3);border-radius:10px;box-shadow:0 10px 32px rgb(0 0 0/.24);display:flex;flex-direction:column;gap:1px}
.more-item{appearance:none;display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:none;background:transparent;color:var(--dsw-alias-label-primary);border-radius:7px;font-size:12.5px;cursor:pointer;white-space:nowrap;text-align:left}
.more-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.more-item-danger{color:var(--dsw-alias-state-error-primary)}
.more-item-danger:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}
.dlg-backdrop{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px}
.dlg{width:min(420px,92vw);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l3);border-radius:14px;padding:18px;box-shadow:0 16px 48px rgb(0 0 0/.28);display:flex;flex-direction:column;gap:12px}
.dlg-title{font-size:15px;font-weight:650;color:var(--dsw-alias-label-primary);margin:0}
.dlg-text{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary);margin:0;word-break:break-all}
.dlg-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:2px}
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
async function postJSON(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body || {})
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(data && (data.error || data.message) || `request failed (${res.status})`);
  return data;
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
  const sync = () => {
    if (disposed) return;
    const buttons = document.querySelectorAll('[role="dialog"] nav button');
    for (const b of buttons) {
      const t = (b.textContent || "").trim();
      if (t === LABEL) b.setAttribute("data-dsh-nav-sessions", "");
      else b.removeAttribute("data-dsh-nav-sessions");
    }
  };
  sync();
  const obs = new MutationObserver(sync);
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  return () => {
    disposed = true;
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
  const [filter, setFilter] = (0, import_react.useState)("all");
  const [selected, setSelected] = (0, import_react.useState)({});
  const [delTarget, setDelTarget] = (0, import_react.useState)(null);
  const [confirmBatch, setConfirmBatch] = (0, import_react.useState)(false);
  const [busy, setBusy] = (0, import_react.useState)(null);
  const [openMove, setOpenMove] = (0, import_react.useState)(null);
  const [moveMode, setMoveMode] = (0, import_react.useState)("existing");
  const [targetWs, setTargetWs] = (0, import_react.useState)("");
  const [newPath, setNewPath] = (0, import_react.useState)("");
  const [error, setError] = (0, import_react.useState)(null);
  const [toast, setToast] = (0, import_react.useState)(null);
  const [picking, setPicking] = (0, import_react.useState)(false);
  const [trash, setTrash] = (0, import_react.useState)([]);
  const [trashBusy, setTrashBusy] = (0, import_react.useState)(null);
  const [details, setDetails] = (0, import_react.useState)({});
  const [openDetails, setOpenDetails] = (0, import_react.useState)(null);
  const [detailsLoading, setDetailsLoading] = (0, import_react.useState)(null);
  const [openMenu, setOpenMenu] = (0, import_react.useState)(null);
  const timer = (0, import_react.useRef)(null);
  const menuRef = (0, import_react.useRef)(null);
  const showToast = (msg) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(msg);
    timer.current = setTimeout(() => setToast(null), 2400);
  };
  const refresh = () => {
    setError(null);
    Promise.all([
      postJSON("/archived-sessions/sessions", {}),
      postJSON("/archived-sessions/workspaces", {})
    ]).then(([s, works]) => {
      const purged = dsmLoadPurged();
      const visible = (s.items || []).filter((x) => !purged.has(String(x.sessionId)));
      setSessions(visible);
      setWorkspaces(works.items || []);
      setSelected({});
      setDelTarget(null);
      setConfirmBatch(false);
      if (!targetWs && works.items && works.items.length) setTargetWs(works.items[0].workspaceId);
      loadTrash();
    }).catch((e) => setError(String(e && e.message || e)));
  };
  (0, import_react.useEffect)(() => {
    refresh();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
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
  const wsPath = (id) => {
    const w = workspaces.find((x) => x.workspaceId === id);
    return w ? w.path : "";
  };
  const archivedList = sessions ? sessions.filter((x) => x.archived) : [];
  const activeList = sessions ? sessions.filter((x) => !x.archived) : [];
  const list = filter === "archived" ? archivedList : sessions || [];
  const selIds = Object.keys(selected).filter((k) => selected[k]);
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
      refresh();
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
      setDelTarget(null);
      refresh();
    }).catch((e) => {
      setBusy(null);
      setDelTarget(null);
      setError(String(e && e.message || e));
    });
  };
  const loadTrash = () => {
    postJSON("/archived-sessions/trash/list", {}).then((r) => setTrash(r.items || [])).catch(() => {
    });
  };
  const restoreTrash = (sid) => {
    if (trashBusy) return;
    setTrashBusy(sid);
    postJSON("/archived-sessions/trash/restore", { sessionId: sid }).then(() => {
      setTrashBusy(null);
      showToast("\u5DF2\u6062\u590D\u4F1A\u8BDD");
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
    postJSON("/archived-sessions/trash/purge-many", { sessionIds: all }).then(() => {
      setTrashBusy(null);
      showToast("\u5DF2\u6E05\u7A7A\u56DE\u6536\u7AD9");
      dsmMarkPurged(all);
      dsmLoadTrashIds();
      loadTrash();
    }).catch((e) => {
      setTrashBusy(null);
      setError(String(e && e.message || e));
    });
  };
  const doMove = (it) => {
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
      showToast(`\u5DF2\u628A\u300C${it.title || it.sessionId}\u300D\u79FB\u5230 ${r.workspaceTitle || targetPath}`);
      refresh();
    }).catch((e) => {
      setBusy(null);
      setError(String(e && e.message || e));
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
  const openMoveFor = (it) => {
    if (openMove === it.sessionId) {
      setOpenMove(null);
      return;
    }
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
      return;
    }
    setDetailsLoading(it.sessionId);
    postJSON("/archived-sessions/details", { sessionId: it.sessionId }).then((d) => {
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
  const runMenu = (id, it) => {
    setOpenMenu(null);
    if (id === "restore") act("restore", it);
    else if (id === "archive") act("archive", it);
    else if (id === "delete") setDelTarget(it);
    else if (id === "move") openMoveFor(it);
    else if (id === "details") toggleDetails(it);
  };
  const rowMenu = (it) => {
    const items = it.archived ? [
      ["restore", "\u6062\u590D"],
      ["move", openMove === it.sessionId ? "\u6536\u8D77\u79FB\u52A8" : "\u79FB\u52A8"],
      ["details", openDetails === it.sessionId ? "\u6536\u8D77\u8BE6\u60C5" : "\u8BE6\u60C5"],
      ["delete", "\u5220\u9664"]
    ] : [["archive", "\u5F52\u6863"], ["move", "\u79FB\u52A8"], ["details", "\u8BE6\u60C5"]];
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
      openMenu === it.sessionId && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "more-menu", role: "menu", children: items.map(([id, label]) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          role: "menuitem",
          className: "more-item" + (id === "delete" ? " more-item-danger" : ""),
          onClick: () => runMenu(id, it),
          children: label
        },
        id
      )) })
    ] });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "archv", role: "region", "aria-label": "\u4F1A\u8BDD\u7BA1\u7406", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: CSS }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "archv-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { className: "archv-title", children: "\u4F1A\u8BDD\u7BA1\u7406" }),
      sessions !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "archv-count", "aria-label": `${sessions.length} \u4E2A\u4F1A\u8BDD`, children: sessions.length })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "archv-sub", children: "\u7EDF\u4E00\u7BA1\u7406\u5168\u90E8\u4F1A\u8BDD\uFF1A\u5F52\u6863 / \u6062\u590D / \u79FB\u52A8\u5230\u5176\u4ED6\u5DE5\u4F5C\u533A / \u4F1A\u8BDD\u8BE6\u60C5 / \u6279\u91CF\u64CD\u4F5C\uFF0C\u5220\u9664\u4F1A\u5148\u8FDB\u5165\u56DE\u6536\u7AD9\uFF0C\u53EF\u5728\u56DE\u6536\u7AD9\u5185\u6062\u590D\u6216\u5F7B\u5E95\u6E05\u7406\u3002" }),
    error && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "archv-err", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: error }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-errretry", onClick: refresh, children: "\u91CD\u8BD5" })
    ] }),
    sessions === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "archv-skel", "aria-label": "\u52A0\u8F7D\u4E2D", children: [0, 1, 2].map((i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "archv-skel-card" }, i)) }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "sess-filter", role: "tablist", "aria-label": "\u4F1A\u8BDD\u7B5B\u9009", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "sess-fbtn" + (filter === "all" ? " sess-fbtn-on" : ""), onClick: () => {
          setFilter("all");
          clearSel();
          setConfirmBatch(false);
        }, children: [
          "\u5168\u90E8 (",
          sessions.length,
          ")"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "sess-fbtn" + (filter === "archived" ? " sess-fbtn-on" : ""), onClick: () => {
          setFilter("archived");
          clearSel();
          setConfirmBatch(false);
        }, children: [
          "\u5DF2\u5F52\u6863 (",
          archivedList.length,
          ")"
        ] })
      ] }),
      list.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "sess-batch", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "sess-btntext", children: selIds.length ? `\u5DF2\u9009 ${selIds.length} \u9879` : filter === "archived" ? `\u5171 ${archivedList.length} \u4E2A\u5F52\u6863\u4F1A\u8BDD` : `\u5171 ${sessions.length} \u4E2A\u4F1A\u8BDD\uFF08\u6D3B\u52A8 ${activeList.length} / \u5DF2\u5F52\u6863 ${archivedList.length}\uFF09` }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", disabled: list.length === 0, onClick: selectAll, children: "\u5168\u9009" }),
        selIds.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          filter === "archived" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", disabled: busy !== null, onClick: () => doBatch("restore-many"), children: "\u6062\u590D\u6240\u9009" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn archv-del", disabled: busy !== null, onClick: () => doBatch("delete-many"), children: confirmBatch ? "\u786E\u8BA4\u5220\u9664\u6240\u9009?" : "\u5220\u9664\u6240\u9009" })
          ] }),
          filter === "all" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", disabled: busy !== null, onClick: () => doBatch("archive-many"), children: "\u5F52\u6863\u6240\u9009" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", onClick: clearSel, children: "\u53D6\u6D88\u9009\u62E9" })
        ] })
      ] }),
      list.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "archv-empty", children: filter === "archived" ? "\u76EE\u524D\u6CA1\u6709\u5F52\u6863\u4F1A\u8BDD\u3002\u5728\u201C\u5168\u90E8\u201D\u91CC\u9009\u4E2D\u4F1A\u8BDD\u70B9\u201C\u5F52\u6863\u201D\u5373\u53EF\u6536\u7EB3\u8FDB\u6765\u3002" : "\u6682\u65E0\u53EF\u7BA1\u7406\u7684\u4F1A\u8BDD\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "archv-list", role: "list", children: list.map((it) => {
        const date = fmtDate(it.createdAt);
        const expanded = openMove === it.sessionId;
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
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "archv-body", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "archv-main", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "archv-name", title: it.title || "", children: it.title || "(\u65E0\u6807\u9898)" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "archv-meta", children: [
                  it.archived ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "archv-wtag archv-wgone", children: "\u5DF2\u5F52\u6863" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "archv-wtag archv-active", children: "\u6D3B\u52A8" }),
                  workspaceTag(it),
                  date && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "archv-dot", children: "\xB7" }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "archv-date", children: date })
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "archv-id", children: it.sessionId })
                ] })
              ] }),
              rowMenu(it)
            ] })
          ] }),
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
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dtl-sec-t", children: "\u8840\u7EDF" }),
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
                ] })
              ] });
            })()
          ] })
        ] }, it.sessionId);
      }) })
    ] }),
    toast && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "archv-status", role: "status", children: toast }),
    delTarget && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dlg-backdrop", onClick: () => setDelTarget(null), children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlg", role: "alertdialog", "aria-modal": "true", "aria-label": "\u5220\u9664\u4F1A\u8BDD", onClick: (e) => e.stopPropagation(), children: [
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
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsm-trash", "aria-label": "\u56DE\u6536\u7AD9", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsm-trash-h", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "\u56DE\u6536\u7AD9" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsm-trash-count", children: [
          trash.length ? `\uFF08${trash.length} \u4E2A\u5F85\u6E05\u7406\uFF09` : "\uFF08\u7A7A\uFF09",
          trash.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", style: { marginLeft: 10 }, disabled: trashBusy !== null, onClick: purgeAllTrash, children: "\u6E05\u7A7A\u56DE\u6536\u7AD9" })
        ] })
      ] }),
      trash.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsm-trash-empty", children: "\u56DE\u6536\u7AD9\u4E3A\u7A7A\u3002\u5220\u9664\u7684\u4F1A\u8BDD\u4F1A\u5148\u8FDB\u5165\u8FD9\u91CC\uFF0C\u53EF\u6062\u590D\u6216\u5F7B\u5E95\u5220\u9664\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsm-trash-list", children: trash.map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsm-trash-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsm-trash-name", title: t.sessionId, children: t.title || t.sessionId }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsm-trash-date", children: fmtDate(t.deletedAt) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsm-trash-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn", disabled: trashBusy !== null, onClick: () => restoreTrash(t.sessionId), children: "\u6062\u590D" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "archv-btn archv-del", disabled: trashBusy !== null, onClick: () => purgeTrash(t.sessionId), children: "\u5F7B\u5E95\u5220\u9664" })
        ] })
      ] }, t.sessionId)) })
    ] })
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
.dsm-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:2147483601;background:var(--dsw-alias-fill-elevated);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);padding:9px 16px;border-radius:999px;font-size:12px;box-shadow:0 8px 24px rgb(0 0 0/.18);max-width:min(90vw,420px)}
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
.dsm-dot-waiting{background:var(--dsw-alias-state-warning-primary)}
.dsm-dot-unread{background:var(--dsw-alias-state-success-primary)}
.dsm-trash{margin-top:18px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:14px}
.dsm-trash-h{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
.dsm-trash-h h3{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);margin:0}
.dsm-trash-count{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dsm-trash-list{display:flex;flex-direction:column;gap:6px;max-height:260px;overflow:auto}
.dsm-trash-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-fill-elevated)}
.dsm-trash-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;color:var(--dsw-alias-label-primary)}
.dsm-trash-date{font-size:11px;color:var(--dsw-alias-label-tertiary);flex:none;white-space:nowrap}
.dsm-trash-actions{display:flex;gap:6px;flex:none}
.dsm-trash-empty{font-size:12px;color:var(--dsw-alias-label-tertiary);padding:6px 2px}
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
var dsmTrashTick = 0;
async function dsmLoadTrashIds() {
  try {
    const r = await postJSON("/archived-sessions/trash/list", {});
    const items = r && r.items || [];
    dsmTrashIds = new Set(items.map((t) => String(t.sessionId)));
  } catch (e) {
  }
  return dsmTrashIds;
}
var DSM_KEY_PURGED = "dsm-purged-v1";
var dsmPurgedIds = null;
function dsmLoadPurged() {
  if (dsmPurgedIds) return dsmPurgedIds;
  try {
    dsmPurgedIds = new Set(JSON.parse(localStorage.getItem(DSM_KEY_PURGED) || "[]"));
  } catch (e) {
    dsmPurgedIds = /* @__PURE__ */ new Set();
  }
  return dsmPurgedIds;
}
function dsmSavePurged() {
  try {
    localStorage.setItem(DSM_KEY_PURGED, JSON.stringify([...dsmLoadPurged()]));
  } catch (e) {
  }
}
function dsmMarkPurged(ids) {
  const s = dsmLoadPurged();
  ids.forEach((id) => s.add(String(id)));
  dsmSavePurged();
  if (dsmRepaintDots) dsmRepaintDots();
}
function installSidebarSessionMenuAug() {
  if (typeof document === "undefined") return;
  const AUG = "data-dsm-aug";
  let styleInjected = false;
  let activeSubClose = null;
  let hoverTimer = null;
  const findFiber = (el) => {
    const k = Object.keys(el).find((kk) => kk.startsWith("__reactFiber") || kk.startsWith("__reactInternalInstance"));
    return k ? el[k] : null;
  };
  const sessionInfoFromMenu = (menuEl) => {
    let f = findFiber(menuEl);
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
    t.className = "dsm-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
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
    sub.style.top = Math.max(8, Math.round(r.top - 4)) + "px";
    sub.style.left = Math.round(r.right + 10) + "px";
    document.body.appendChild(sub);
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
          postJSON("/archived-sessions/move", { sessionId: info.id, targetPath: w.path }).then(() => toast("\u79FB\u52A8\u6210\u529F")).catch((ee) => toast("\u79FB\u52A8\u5931\u8D25\uFF1A" + String(ee && ee.message || ee)));
        });
        sub.appendChild(b);
      });
    }).catch((e) => {
      sub.innerHTML = '<div class="dsm-sub-err">' + escapeHtml(String(e && e.message || e)) + "</div>";
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
  };
  const seen = /* @__PURE__ */ new WeakSet();
  const obs = new MutationObserver(() => {
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
  const KEY_READ = "dsm-read-v1";
  if (!document.querySelector("style[data-dsm=aug]")) {
    const s = document.createElement("style");
    s.dataset.dsm = "aug";
    s.textContent = SIDEBAR_AUG_CSS;
    document.head.appendChild(s);
  }
  const findFiber = (el) => {
    const k = Object.keys(el).find((kk) => kk.startsWith("__reactFiber") || kk.startsWith("__reactInternalInstance"));
    return k ? el[k] : null;
  };
  const fiberProp = (el, pred) => {
    let f = findFiber(el);
    let g = 0;
    while (f && g++ < 300) {
      const p = f.memoizedProps;
      if (p && pred(p)) return pred(p);
      f = f.return;
    }
    return null;
  };
  const rowId = (row) => fiberProp(row, (p) => p.node && typeof p.node.id === "string" && p.node.id ? p.node.id : null);
  const loadRead = () => {
    try {
      return new Set(JSON.parse(localStorage.getItem(KEY_READ) || "[]"));
    } catch (e) {
      return /* @__PURE__ */ new Set();
    }
  };
  const saveRead = (s) => {
    try {
      localStorage.setItem(KEY_READ, JSON.stringify([...s]));
    } catch (e) {
    }
  };
  const read = loadRead();
  let curActive = null;
  const activeRowId = () => {
    const sel = document.querySelector('[role="treeitem"][aria-selected="true"]');
    return sel ? rowId(sel) : null;
  };
  const COLOR = {
    manual: "var(--dsw-alias-state-business-primary)",
    // 蓝 手动标记未读
    running: "#EAB308",
    // 黄 工作中 (DSH ongoing)
    feedback: "var(--dsw-alias-state-warning-primary)",
    // 琥珀 需用户反馈 (DSH warning)
    done: "var(--dsw-alias-state-success-primary)",
    // 绿 完成后未读 (DSH done)
    error: "var(--dsw-alias-state-error-primary)"
    // 红 出错/需关注 (DSH error)
  };
  const manualUnread = dsmLoadManual();
  const paint = () => {
    const activeId = activeRowId();
    if (activeId) {
      read.add(activeId);
      saveRead();
    }
    if (activeId !== curActive && activeId && manualUnread.has(activeId)) {
      manualUnread.delete(activeId);
      dsmSaveManual();
    }
    curActive = activeId;
    const rows = document.querySelectorAll('[role="treeitem"]');
    rows.forEach((row) => {
      const id = rowId(row);
      if (!id) return;
      const purged = dsmLoadPurged();
      if (dsmTrashIds && dsmTrashIds.has(id) || purged.has(id)) {
        if (row.style.display !== "none") row.style.display = "none";
        const d = row.querySelector("[" + DOT + "]");
        if (d) d.remove();
        return;
      }
      if (row.style.display === "none") row.style.display = "";
      const sd = row.querySelector("[data-state]");
      if (sd) sd.style.display = "none";
      let dot = row.querySelector("[" + DOT + "]");
      let color = null;
      if (manualUnread.has(id)) color = COLOR.manual;
      else if (sd) {
        const st = sd.getAttribute("data-state");
        if (st === "ongoing") color = COLOR.running;
        else if (st === "warning") color = COLOR.feedback;
        else if (st === "error") color = COLOR.error;
        else if (st === "done") color = read.has(id) ? null : COLOR.done;
      }
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
  };
  dsmRepaintDots = paint;
  const tick = () => {
    if (++dsmTrashTick % 3 === 0) dsmLoadTrashIds();
    paint();
  };
  let raf = 0;
  const schedulePaint = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      paint();
    });
  };
  tick();
  dsmLoadTrashIds();
  paint();
  const obs = new MutationObserver(schedulePaint);
  obs.observe(document.body, { childList: true, subtree: true });
  setInterval(tick, 1200);
}
function apply(ctx) {
  installSettingsNavIcons(ctx);
  installSidebarSessionMenuAug();
  installSidebarStatusDots();
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
