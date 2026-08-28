/**
 * dsh-sessions-manager — browser half: renders a single "会话管理" settings
 * section (settings.section list slot) that unifies archived-session
 * management and cross-workspace moving. It talks to the host half's
 * /archived-sessions/* JSON routes by fetch, showing every conversation with
 * its archive state and offering archive / restore / delete / move (and batch)
 * actions. All DOM/runtime wiring failures are logged, never thrown — a thrown
 * plugin apply takes down the whole web-shell boot.
 *
 * @module dsh-sessions-manager/client
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'

export const inject = ['slots']

const PANEL_PREFS_KEY = 'dsm-panel-prefs-v1'
function loadPanelPrefs() {
  try { return JSON.parse(localStorage.getItem(PANEL_PREFS_KEY) || '{}') || {} } catch (e) { return {} }
}

const CSS = `
.archv{--dsm-radius-tag:4px;display:flex;flex-direction:column;gap:4px;max-width:800px;padding:8px 2px 28px}
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
.sess-tools{display:grid;grid-template-columns:minmax(180px,1fr) minmax(140px,.7fr) minmax(130px,.55fr);gap:8px;margin:0 0 8px}
.sess-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.sess-field label{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.sess-field input,.sess-field select{box-sizing:border-box;width:100%;min-height:36px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-fill-elevated);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
.sess-results{font-size:11px;color:var(--dsw-alias-label-tertiary);margin:0 0 4px}
.archv button:focus-visible,.archv input:focus-visible,.archv select:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
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
.archv-wtag{display:inline-flex;align-items:center;gap:4px;max-width:100%;font-size:11px;font-weight:500;line-height:1;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-fill-subtle);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsm-radius-tag);padding:3px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.archv-wgone{border-style:dashed;color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 7%,transparent)}
.archv-active{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 8%,transparent)}
.archv-date{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none}
.archv-id{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;color:var(--dsw-alias-label-tertiary);flex:none}
.archv-dot{color:var(--dsw-alias-border-l3);flex:none}
.archv-check{width:15px;height:15px;accent-color:var(--dsw-alias-state-business-primary);flex:none;cursor:pointer}
.archv-body{flex:1;min-width:0;display:flex;align-items:center;gap:12px}
.archv-actions{display:flex;gap:8px;flex:none;flex-wrap:nowrap;justify-content:flex-end}
.archv-btn{appearance:none;min-height:32px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-subtle);color:var(--dsw-alias-label-secondary);border-radius:9px;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:6px;text-align:center;transition:background-color .15s ease,border-color .15s ease,color .15s ease}
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
@media (max-width:640px){.archv-card{flex-direction:column;align-items:stretch;gap:10px}.archv-actions{justify-content:flex-end}.sess-tools{grid-template-columns:1fr}.sess-fbtn,.archv-btn{min-height:40px}}
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
.dtl-tag{display:inline-flex;font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-fill-elevated);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsm-radius-tag);padding:2px 8px}
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
`

function fmtDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  try {
    return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
  } catch {
    return String(iso)
  }
}

function fmtBytes(n) {
  if (!n && n !== 0) return null
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n
  let u = -1
  do { v /= 1024; u++ } while (v >= 1024 && u < units.length - 1)
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[u]}`
}

function pathName(p) {
  if (!p) return null
  const parts = String(p).replace(/\\+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || p
}

async function postJSON(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body || {}),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data) throw new Error((data && (data.error || data.message)) || `request failed (${res.status})`)
  return data
}

// Left-nav icon swap: DSH's settings shell renders a shared fallback gear for
// every custom section and settings.section has no per-section icon field.
// Like dsh-better-sidebar, we mark our own row by matching its visible label
// text, then CSS swaps the gear for an archive-box glyph. The marker owns no
// shell structure and is removed on fiber disposal (HMR-safe, ships with the
// plugin).
const NAV_CSS = `
[data-dsh-nav-sessions] > svg:first-child { display: none; }
[data-dsh-nav-sessions]::before {
  content: ''; flex: none; width: 16px; height: 16px; background: currentColor;
  -webkit-mask: url("data:image/svg+xml,%3Csvg%20xmlns%3D'http://www.w3.org/2000/svg'%20width%3D'24'%20height%3D'24'%20viewBox%3D'0%200%2024%2024'%20fill%3D'none'%20stroke%3D'black'%20stroke-width%3D'2'%20stroke-linecap%3D'round'%20stroke-linejoin%3D'round'%3E%3Cpath%20d%3D'M21%208v13H3V8'/%3E%3Cpath%20d%3D'M1%203h22v5H1z'/%3E%3Cpath%20d%3D'M10%2012h4'/%3E%3C/svg%3E") center / contain no-repeat;
  mask: url("data:image/svg+xml,%3Csvg%20xmlns%3D'http://www.w3.org/2000/svg'%20width%3D'24'%20height%3D'24'%20viewBox%3D'0%200%2024%2024'%20fill%3D'none'%20stroke%3D'black'%20stroke-width%3D'2'%20stroke-linecap%3D'round'%20stroke-linejoin%3D'round'%3E%3Cpath%20d%3D'M21%208v13H3V8'/%3E%3Cpath%20d%3D'M1%203h22v5H1z'/%3E%3Cpath%20d%3D'M10%2012h4'/%3E%3C/svg%3E") center / contain no-repeat;
}
`

function markSettingsNav() {
  const LABEL = '会话管理'
  let disposed = false
  const sync = () => {
    if (disposed) return
    const buttons = document.querySelectorAll('[role="dialog"] nav button')
    for (const b of buttons) {
      const t = (b.textContent || '').trim()
      if (t === LABEL) b.setAttribute('data-dsh-nav-sessions', '')
      else b.removeAttribute('data-dsh-nav-sessions')
    }
  }
  sync()
  const obs = new MutationObserver(sync)
  obs.observe(document.body, { childList: true, subtree: true, characterData: true })
  return () => {
    disposed = true
    obs.disconnect()
    document.querySelectorAll('[data-dsh-nav-sessions]').forEach((e) => e.removeAttribute('data-dsh-nav-sessions'))
  }
}

function installSettingsNavIcons(ctx) {
  const styleEl = document.createElement('style')
  styleEl.textContent = NAV_CSS
  document.head.appendChild(styleEl)
  const dispose = markSettingsNav()
  ctx.effect(() => () => {
    dispose()
    if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl)
  })
}

function SessionPanel({ workspacesSvc }) {
  const [sessions, setSessions] = useState(null)
  const [workspaces, setWorkspaces] = useState([])
  const initialPrefs = useRef(loadPanelPrefs()).current
  const [filter, setFilter] = useState(() => ['all', 'active', 'archived', 'trash'].includes(initialPrefs.filter) ? initialPrefs.filter : 'all')
  const [query, setQuery] = useState('')
  const [workspaceFilter, setWorkspaceFilter] = useState(() => initialPrefs.workspaceFilter || 'all')
  const [sortBy, setSortBy] = useState(() => ['newest', 'oldest', 'title'].includes(initialPrefs.sortBy) ? initialPrefs.sortBy : 'newest')
  const [selected, setSelected] = useState({})
  const [delTarget, setDelTarget] = useState(null)
  const [confirmBatch, setConfirmBatch] = useState(false)
  const [busy, setBusy] = useState(null)
  const [openMove, setOpenMove] = useState(null)
  const [moveMode, setMoveMode] = useState('existing')
  const [targetWs, setTargetWs] = useState('')
  const [newPath, setNewPath] = useState('')
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)
  const [picking, setPicking] = useState(false)
  const [trash, setTrash] = useState([])
  const [trashBusy, setTrashBusy] = useState(null)
  const [trashSettings, setTrashSettings] = useState({ retentionDays: 0 })
  const [trashCheck, setTrashCheck] = useState(null)
  const [purgeTarget, setPurgeTarget] = useState(null)
  const [details, setDetails] = useState({})
  const [openDetails, setOpenDetails] = useState(null)
  const [detailsLoading, setDetailsLoading] = useState(null)
  const [openMenu, setOpenMenu] = useState(null)
  const timer = useRef(null)
  const menuRef = useRef(null)
  const dialogRef = useRef(null)

  const showToast = (msg) => {
    if (timer.current) clearTimeout(timer.current)
    setToast(msg)
    timer.current = setTimeout(() => setToast(null), 2400)
  }

  const refresh = () => {
    setError(null)
    Promise.all([
      postJSON('/archived-sessions/sessions', {}),
      postJSON('/archived-sessions/workspaces', {}),
    ])
      .then(([s, works]) => {
        // Permanently-purged sessions must never re-appear here, even if DSH's
        // in-memory session index still lists them after the file was unlinked.
        const purged = dsmLoadPurged()
        const visible = (s.items || []).filter((x) => !purged.has(String(x.sessionId)))
        setSessions(visible)
        setWorkspaces(works.items || [])
        setSelected({})
        setDelTarget(null)
        setConfirmBatch(false)
        if (!targetWs && works.items && works.items.length) setTargetWs(works.items[0].workspaceId)
        loadTrash()
      })
      .catch((e) => setError(String((e && e.message) || e)))
  }

  useEffect(() => {
    refresh()
    return () => { if (timer.current) clearTimeout(timer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    try { localStorage.setItem(PANEL_PREFS_KEY, JSON.stringify({ filter, workspaceFilter, sortBy })) } catch (e) {}
  }, [filter, workspaceFilter, sortBy])

  // Close the ⋯ menu on outside click / Escape (no full-screen backdrop).
  useEffect(() => {
    if (openMenu === null) return
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpenMenu(null)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpenMenu(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [openMenu])

  useEffect(() => {
    if (!delTarget && !purgeTarget) return
    const previous = document.activeElement
    const onKey = (e) => {
      if (e.key === 'Escape') { setDelTarget(null); setPurgeTarget(null) }
    }
    document.addEventListener('keydown', onKey)
    requestAnimationFrame(() => dialogRef.current && dialogRef.current.querySelector('button')?.focus())
    return () => {
      document.removeEventListener('keydown', onKey)
      if (previous && typeof previous.focus === 'function') previous.focus()
    }
  }, [delTarget, purgeTarget])

  const wsPath = (id) => {
    const w = workspaces.find((x) => x.workspaceId === id)
    return w ? w.path : ''
  }

  const archivedList = sessions ? sessions.filter((x) => x.archived) : []
  const activeList = sessions ? sessions.filter((x) => !x.archived) : []
  const list = useMemo(() => {
    if (filter === 'trash') return []
    const base = filter === 'archived' ? archivedList : filter === 'active' ? activeList : sessions || []
    const needle = query.trim().toLocaleLowerCase()
    const filtered = base.filter((item) => {
      if (workspaceFilter !== 'all' && (item.workspacePath || '') !== workspaceFilter) return false
      if (!needle) return true
      return [item.title, item.sessionId, item.workspaceTitle, item.workspacePath].some((value) => String(value || '').toLocaleLowerCase().includes(needle))
    })
    return [...filtered].sort((a, b) => {
      if (sortBy === 'oldest') return Number(a.createdAt || 0) - Number(b.createdAt || 0)
      if (sortBy === 'title') return String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN')
      return Number(b.createdAt || 0) - Number(a.createdAt || 0)
    })
  }, [sessions, filter, query, workspaceFilter, sortBy])
  const selIds = Object.keys(selected).filter((k) => selected[k])

  const toggle = (id) => setSelected((s) => ({ ...s, [id]: !s[id] }))
  const clearSel = () => setSelected({})
  const selectAll = () => {
    const o = {}
    list.forEach((x) => { o[x.sessionId] = true })
    setSelected(o)
  }

  const act = (action, it) => {
    if (busy) return
    setBusy(it.sessionId)
    postJSON('/archived-sessions/' + action, { sessionId: it.sessionId })
      .then(() => {
        setBusy(null)
        const n = it.title || it.sessionId
        showToast(action === 'archive' ? `已归档「${n}」` : `已恢复「${n}」`)
        refresh()
      })
      .catch((e) => { setBusy(null); setError(String((e && e.message) || e)) })
  }

  const doDeleteConfirmed = () => {
    if (!delTarget || busy) return
    setBusy(delTarget.sessionId)
    postJSON('/archived-sessions/delete', { sessionId: delTarget.sessionId })
      .then(() => {
        setBusy(null)
        const n = delTarget.title || delTarget.sessionId
        showToast(`已删除 ${n}（已移入回收站）`)
        setDelTarget(null)
        refresh()
      })
      .catch((e) => { setBusy(null); setDelTarget(null); setError(String((e && e.message) || e)) })
  }

  const loadTrash = () => {
    postJSON('/archived-sessions/trash/list', {})
      .then((r) => { setTrash(r.items || []); setTrashSettings(r.settings || { retentionDays: 0 }) })
      .catch(() => {})
  }

  const updateRetention = (days) => {
    setTrashBusy('__settings')
    postJSON('/archived-sessions/trash/settings', { retentionDays: Number(days) })
      .then((r) => { setTrashBusy(null); setTrashSettings(r.settings); showToast('已更新自动清理策略') })
      .catch((e) => { setTrashBusy(null); setError(String((e && e.message) || e)) })
  }

  const verifyTrash = () => {
    setTrashBusy('__verify')
    postJSON('/archived-sessions/trash/verify', {})
      .then((r) => { setTrashBusy(null); setTrashCheck(r); showToast(r.missing ? `发现 ${r.missing} 条日志缺失` : '回收站校验通过') })
      .catch((e) => { setTrashBusy(null); setError(String((e && e.message) || e)) })
  }

  const restoreTrash = (sid) => {
    if (trashBusy) return
    setTrashBusy(sid)
    postJSON('/archived-sessions/trash/restore', { sessionId: sid })
      .then(() => { setTrashBusy(null); showToast('已恢复会话'); loadTrash(); refresh() })
      .catch((e) => { setTrashBusy(null); setError(String((e && e.message) || e)) })
  }
  const purgeTrash = (sid) => {
    if (trashBusy) return
    setTrashBusy(sid)
    postJSON('/archived-sessions/trash/purge', { sessionId: sid })
      .then(() => { setTrashBusy(null); showToast('已彻底删除'); dsmMarkPurged([sid]); dsmLoadTrashIds(); loadTrash() })
      .catch((e) => { setTrashBusy(null); setError(String((e && e.message) || e)) })
  }
  const purgeAllTrash = () => {
    if (trashBusy || !trash.length) return
    setTrashBusy('__all')
    const all = trash.map((t) => t.sessionId)
    postJSON('/archived-sessions/trash/purge-many', { sessionIds: all })
      .then((result) => {
        setTrashBusy(null)
        const rows = result.results || []
        const succeeded = rows.filter((item) => item.ok).map((item) => item.sessionId)
        const failed = rows.filter((item) => !item.ok)
        if (succeeded.length) dsmMarkPurged(succeeded)
        dsmLoadTrashIds()
        loadTrash()
        if (failed.length) {
          const first = failed[0]
          setError(`清理完成 ${succeeded.length} 条，失败 ${failed.length} 条：${first.error || first.sessionId}`)
        } else showToast('已清空回收站')
      })
      .catch((e) => { setTrashBusy(null); setError(String((e && e.message) || e)) })
  }

  const doMove = (it) => {
    const targetPath = moveMode === 'new' ? newPath.trim() : wsPath(targetWs)
    if (!targetPath) { setError('请选择已有工作区或输入新的目标目录路径'); return }
    setBusy(it.sessionId)
    setError(null)
    postJSON('/archived-sessions/move', { sessionId: it.sessionId, targetPath })
      .then((r) => {
        setBusy(null)
        setOpenMove(null)
        setMoveMode('existing')
        setNewPath('')
        showToast(`已把「${it.title || it.sessionId}」移到 ${r.workspaceTitle || targetPath}`)
        refresh()
      })
      .catch((e) => { setBusy(null); setError(String((e && e.message) || e)) })
  }

  const doBatch = (action) => {
    if (!selIds.length || busy) return
    if (action === 'delete-many') {
      if (!confirmBatch) { setConfirmBatch(true); return }
      setConfirmBatch(false)
    }
    setBusy('__batch__')
    postJSON('/archived-sessions/' + action, { sessionIds: selIds })
      .then((r) => {
        setBusy(null)
        const n = (r && (r.archived || r.restored || r.deleted)) || selIds.length
        showToast(`已处理 ${n} 个会话`)
        refresh()
      })
      .catch((e) => { setBusy(null); setConfirmBatch(false); setError(String((e && e.message) || e)) })
  }

  const openMoveFor = (it) => {
    if (openMove === it.sessionId) { setOpenMove(null); return }
    setTargetWs(workspaces.length ? (targetWs || workspaces[0].workspaceId) : '')
    setMoveMode('existing')
    setNewPath('')
    setOpenMove(it.sessionId)
  }

  const pickDirectory = async () => {
    if (!workspacesSvc || picking) return
    setPicking(true)
    try {
      const p = await workspacesSvc.pickDirectory()
      if (p) { setNewPath(p); setMoveMode('new') }
    } catch (e) {
      setError(String((e && e.message) || e))
    } finally {
      setPicking(false)
    }
  }

  const toggleDetails = (it) => {
    if (openDetails === it.sessionId) { setOpenDetails(null); return }
    if (details[it.sessionId]) { setOpenDetails(it.sessionId); return }
    setDetailsLoading(it.sessionId)
    postJSON('/archived-sessions/details', { sessionId: it.sessionId })
      .then((d) => {
        setDetails((m) => ({ ...m, [it.sessionId]: d }))
        setDetailsLoading(null)
        setOpenDetails(it.sessionId)
      })
      .catch((e) => { setDetailsLoading(null); setError(String((e && e.message) || e)) })
  }

  const workspaceTag = (it) => {
    if (it.hasWorkspace && it.workspaceGone) {
      return <span className="archv-wtag archv-wgone" title={(it.workspacePath || '') + '（原工作区已删除）'}>工作区已删 · {pathName(it.workspacePath) || '?'}</span>
    }
    const wName = it.workspaceTitle || pathName(it.workspacePath)
    if (wName) return <span className="archv-wtag" title={it.workspacePath || ''}>{wName}</span>
    return <span className="archv-wtag">未分组</span>
  }

  const runMenu = (id, it) => {
    setOpenMenu(null)
    if (id === 'restore') act('restore', it)
    else if (id === 'archive') act('archive', it)
    else if (id === 'delete') setDelTarget(it)
    else if (id === 'move') openMoveFor(it)
    else if (id === 'details') toggleDetails(it)
  }

  const rowMenu = (it) => {
    const items = it.archived
      ? [
          ['restore', '恢复'],
          ['move', openMove === it.sessionId ? '收起移动' : '移动'],
          ['details', openDetails === it.sessionId ? '收起详情' : '详情'],
          ['delete', '删除'],
        ]
      : [['archive', '归档'], ['move', '移动'], ['details', '详情'], ['delete', '删除']]
    return (
      <div ref={openMenu === it.sessionId ? menuRef : null} className="more-wrap">
        <button
          type="button"
          className="more-btn"
          aria-label="更多操作"
          aria-haspopup="true"
          aria-expanded={openMenu === it.sessionId}
          onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === it.sessionId ? null : it.sessionId) }}
        >⋯</button>
        {openMenu === it.sessionId && (
          <div className="more-menu" role="menu">
            {items.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="menuitem"
                className={'more-item' + (id === 'delete' ? ' more-item-danger' : '')}
                onClick={() => runMenu(id, it)}
              >{label}</button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="archv" role="region" aria-label="会话管理">
      <style>{CSS}</style>
      <div className="archv-head">
        <h2 className="archv-title">会话管理</h2>
        {sessions !== null && <span className="archv-count" aria-label={`${sessions.length} 个会话`}>{sessions.length}</span>}
      </div>
      <p className="archv-sub">
        统一管理全部会话：归档 / 恢复 / 移动到其他工作区 / 会话详情 / 批量操作，删除会先进入回收站，可在回收站内恢复或彻底清理。
      </p>
      {error && (
        <div className="archv-err" role="alert">
          <span>{error}</span>
          <button type="button" className="archv-errretry" onClick={refresh}>重试</button>
        </div>
      )}
      {sessions === null ? (
        <div className="archv-skel" aria-label="加载中">
          {[0, 1, 2].map((i) => <div key={i} className="archv-skel-card" />)}
        </div>
      ) : (
        <>
          <div className="sess-filter" role="tablist" aria-label="会话筛选">
            <button type="button" role="tab" aria-selected={filter === 'all'} className={'sess-fbtn' + (filter === 'all' ? ' sess-fbtn-on' : '')} onClick={() => { setFilter('all'); clearSel(); setConfirmBatch(false) }}>全部 ({sessions.length})</button>
            <button type="button" role="tab" aria-selected={filter === 'active'} className={'sess-fbtn' + (filter === 'active' ? ' sess-fbtn-on' : '')} onClick={() => { setFilter('active'); clearSel(); setConfirmBatch(false) }}>活动 ({activeList.length})</button>
            <button type="button" role="tab" aria-selected={filter === 'archived'} className={'sess-fbtn' + (filter === 'archived' ? ' sess-fbtn-on' : '')} onClick={() => { setFilter('archived'); clearSel(); setConfirmBatch(false) }}>已归档 ({archivedList.length})</button>
            <button type="button" role="tab" aria-selected={filter === 'trash'} className={'sess-fbtn' + (filter === 'trash' ? ' sess-fbtn-on' : '')} onClick={() => { setFilter('trash'); clearSel(); setConfirmBatch(false) }}>回收站 ({trash.length})</button>
          </div>

          {filter !== 'trash' && (
            <>
              <div className="sess-tools" aria-label="查找和整理会话">
                <div className="sess-field">
                  <label htmlFor="dsm-search">搜索会话</label>
                  <input id="dsm-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="标题、会话 ID 或工作区" />
                </div>
                <div className="sess-field">
                  <label htmlFor="dsm-workspace-filter">工作区</label>
                  <select id="dsm-workspace-filter" value={workspaceFilter} onChange={(e) => setWorkspaceFilter(e.target.value)}>
                    <option value="all">全部工作区</option>
                    {workspaces.map((w) => <option key={w.workspaceId} value={w.path}>{w.title}</option>)}
                  </select>
                </div>
                <div className="sess-field">
                  <label htmlFor="dsm-sort">排序</label>
                  <select id="dsm-sort" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                    <option value="newest">最新创建</option><option value="oldest">最早创建</option><option value="title">标题 A–Z</option>
                  </select>
                </div>
              </div>
              <div className="sess-results" role="status">显示 {list.length} 个会话{query || workspaceFilter !== 'all' ? `，共 ${filter === 'archived' ? archivedList.length : filter === 'active' ? activeList.length : sessions.length} 个` : ''}</div>
            </>
          )}

          {filter !== 'trash' && list.length > 0 && (
            <div className="sess-batch">
              <span className="sess-btntext">{selIds.length ? `已选 ${selIds.length} 项` : (filter === 'archived' ? `共 ${archivedList.length} 个归档会话` : `共 ${sessions.length} 个会话（活动 ${activeList.length} / 已归档 ${archivedList.length}）`)}</span>
              <button type="button" className="archv-btn" disabled={list.length === 0} onClick={selectAll}>全选</button>
              {selIds.length > 0 && (
                <>
                  {filter === 'archived' && (
                    <>
                      <button type="button" className="archv-btn" disabled={busy !== null} onClick={() => doBatch('restore-many')}>恢复所选</button>
                      <button type="button" className="archv-btn archv-del" disabled={busy !== null} onClick={() => doBatch('delete-many')}>{confirmBatch ? '确认删除所选?' : '删除所选'}</button>
                    </>
                  )}
                  {filter !== 'archived' && (
                    <button type="button" className="archv-btn" disabled={busy !== null} onClick={() => doBatch('archive-many')}>归档所选</button>
                  )}
                  <button type="button" className="archv-btn" onClick={clearSel}>取消选择</button>
                </>
              )}
            </div>
          )}

          {filter !== 'trash' && list.length === 0 ? (
            <div className="archv-empty">{query || workspaceFilter !== 'all' ? '没有匹配的会话。请调整搜索词或工作区筛选。' : filter === 'archived' ? '目前没有归档会话。在“全部”里选中会话点“归档”即可收纳进来。' : filter === 'active' ? '目前没有活动会话。' : '暂无可管理的会话。'}</div>
          ) : filter !== 'trash' ? (
            <div className="archv-list" role="list">
              {list.map((it) => {
                const date = fmtDate(it.createdAt)
                const expanded = openMove === it.sessionId
                return (
                  <div key={it.sessionId} className={'archv-card' + (expanded ? ' archv-card-exp' : '')} role="listitem">
                    <div className="archv-row">
                      <input
                        type="checkbox"
                        className="archv-check"
                        checked={!!selected[it.sessionId]}
                        onChange={() => toggle(it.sessionId)}
                        aria-label={'选择 ' + (it.title || it.sessionId)}
                      />
                      <div className="archv-body">
                        <div className="archv-main">
                          <div className="archv-name" title={it.title || ''}>{it.title || '(无标题)'}</div>
                          <div className="archv-meta">
                            {it.archived ? <span className="archv-wtag archv-wgone">已归档</span> : <span className="archv-wtag archv-active">活动</span>}
                            {workspaceTag(it)}
                            {date && <><span className="archv-dot">·</span><span className="archv-date">{date}</span></>}
                            <span className="archv-id">{it.sessionId}</span>
                          </div>
                        </div>
                        {rowMenu(it)}
                      </div>
                    </div>
                    {expanded && (
                      <div className="mv-sheet" role="region" aria-label="移动到工作区">
                        <div className="mv-sheet-head">
                          <h3 className="mv-sheet-title">移动到工作区</h3>
                          <button type="button" className="mv-sheet-close" aria-label="关闭" onClick={() => setOpenMove(null)}>×</button>
                        </div>
                        <div className="mv-seg" role="tablist">
                          <button type="button" role="tab" aria-selected={moveMode === 'existing'} className={'mv-segbtn' + (moveMode === 'existing' ? ' mv-segbtn-on' : '')} onClick={() => setMoveMode('existing')}>已有工作区</button>
                          <button type="button" role="tab" aria-selected={moveMode === 'new'} className={'mv-segbtn' + (moveMode === 'new' ? ' mv-segbtn-on' : '')} onClick={() => setMoveMode('new')}>新建目录</button>
                        </div>
                        {moveMode === 'existing' ? (
                          <div className="mv-field">
                            <label className="mv-field-label" htmlFor="mv-target-ws">目标工作区</label>
                            <select id="mv-target-ws" value={targetWs} onChange={(e) => setTargetWs(e.target.value)}>
                              {workspaces.length === 0 && <option value="">（暂无工作区）</option>}
                              {workspaces.map((w) => (
                                <option key={w.workspaceId} value={w.workspaceId}>{w.title} · {w.path}</option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div className="mv-field">
                            <label className="mv-field-label" htmlFor="mv-new-path">新工作区目录路径</label>
                            <div className="mv-browse-row">
                              <input
                                id="mv-new-path"
                                type="text"
                                value={newPath}
                                onChange={(e) => setNewPath(e.target.value)}
                                placeholder="例如 /Users/you/Projects/demo 或 ~/demo"
                              />
                              <button
                                type="button"
                                className="archv-btn"
                                onClick={pickDirectory}
                                disabled={busy !== null || picking || !workspacesSvc}
                                title={!workspacesSvc ? '当前运行环境不支持系统目录选择' : '打开系统目录选择窗口'}
                              >
                                {picking ? '选择中…' : '浏览…'}
                              </button>
                            </div>
                          </div>
                        )}
                        <div className="mv-foot">
                          <button type="button" className="archv-btn" onClick={() => setOpenMove(null)}>取消</button>
                          <button type="button" className="archv-btn archv-go" disabled={busy !== null} onClick={() => doMove(it)}>
                            {busy === it.sessionId && <span className="archv-spin" aria-hidden="true" />}确认移动
                          </button>
                        </div>
                      </div>
                    )}
                    {openDetails === it.sessionId && (
                      <div className="dtl-sheet" role="region" aria-label="会话详情">
                        <div className="dtl-sheet-head">
                          <h3 className="dtl-sheet-title">会话详情</h3>
                          <button type="button" className="mv-sheet-close" aria-label="关闭详情" onClick={() => setOpenDetails(null)}>×</button>
                        </div>
                        {detailsLoading === it.sessionId ? (
                          <div className="archv-skel" aria-label="加载中">{[0, 1].map((i) => <div key={i} className="archv-skel-card" />)}</div>
                        ) : (() => {
                          const d = details[it.sessionId]
                          if (!d) return <div className="dtl-paths">暂无详情</div>
                          const st = d.stats || {}
                          const tools = st.toolCounts ? Object.entries(st.toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 10) : []
                          return (
                            <div>
                              <div className="dtl-grid">
                                <div className="dtl-cell"><span className="dtl-k">磁盘占用</span><span className="dtl-v">{fmtBytes(d.sizeBytes) || '—'}</span></div>
                                <div className="dtl-cell"><span className="dtl-k">轮次 / 步骤</span><span className="dtl-v">{st.turns ?? 0} / {st.steps ?? 0}</span></div>
                                <div className="dtl-cell"><span className="dtl-k">用户 / 助手</span><span className="dtl-v">{st.userMessages ?? 0} / {st.assistantMessages ?? 0}</span></div>
                                <div className="dtl-cell"><span className="dtl-k">工具调用</span><span className="dtl-v">{st.toolCalls ?? 0}</span></div>
                                <div className="dtl-cell"><span className="dtl-k">图片附件</span><span className="dtl-v">{st.attachments ?? 0}</span></div>
                                <div className="dtl-cell"><span className="dtl-k">创建 / 更新</span><span className="dtl-v">{fmtDate(d.createdAt) || '—'} · {fmtDate(d.updatedAt) || '—'}</span></div>
                              </div>
                              {tools.length > 0 && (
                                <div className="dtl-sec"><div className="dtl-sec-t">工具使用</div>
                                  <div className="dtl-tags">{tools.map(([t, c]) => <span className="dtl-tag" key={t}>{t} ×{c}</span>)}</div>
                                </div>
                              )}
                              {st.fetches && st.fetches.length > 0 && (
                                <div className="dtl-sec"><div className="dtl-sec-t">搜索 / 抓取</div>
                                  <ul className="dtl-list">{st.fetches.map((f, i) => <li key={i}>{f.tool}{f.query ? ` 「${f.query}」` : ''}</li>)}</ul>
                                </div>
                              )}
                              {d.files && d.files.length > 0 && (
                                <div className="dtl-sec"><div className="dtl-sec-t">写过的文件（{d.files.length}）</div>
                                  <ul className="dtl-list">{d.files.map((f, i) => <li key={i}><code>{f.path}</code> <span className="dtl-filetool">({f.tool})</span></li>)}</ul>
                                </div>
                              )}
                              {d.lineage && (d.lineage.parentSessionId || (d.lineage.children && d.lineage.children.length > 0) || (d.lineage.subagents && d.lineage.subagents.length > 0)) && (
                                <div className="dtl-sec"><div className="dtl-sec-t">血统</div>
                                  <div className="dtl-paths">
                                    {d.lineage.parentSessionId && <div>父会话: <code>{d.lineage.parentSessionId}</code></div>}
                                    {d.lineage.children && d.lineage.children.length > 0 && <div>子会话 ({d.lineage.children.length}): <code>{d.lineage.children.join(', ')}</code></div>}
                                    {d.lineage.subagents && d.lineage.subagents.length > 0 && <div>子代理 ({d.lineage.subagents.length}): <code>{d.lineage.subagents.join(', ')}</code></div>}
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })()}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : null}
        </>
      )}
      {toast && <div className="archv-status" role="status">{toast}</div>}
      {delTarget && (
        <div className="dlg-backdrop" onClick={() => setDelTarget(null)}>
          <div ref={dialogRef} className="dlg" role="alertdialog" aria-modal="true" aria-label="删除会话" onClick={(e) => e.stopPropagation()}>
            <h3 className="dlg-title">删除会话</h3>
            <p className="dlg-text">确认删除「{delTarget.title || delTarget.sessionId}」？将移入回收站，可在本页底部「回收站」中恢复或彻底删除。</p>
            <div className="dlg-actions">
              <button type="button" className="archv-btn" disabled={busy !== null} onClick={() => setDelTarget(null)}>取消</button>
              <button type="button" className="archv-btn archv-del" disabled={busy !== null} onClick={doDeleteConfirmed}>移入回收站</button>
            </div>
          </div>
        </div>
      )}
      {filter === 'trash' && <section className="dsm-trash" aria-label="回收站">
        <div className="dsm-trash-h">
          <h3>回收站</h3>
          <span className="dsm-trash-count">{trash.length ? `（${trash.length} 个待清理）` : '（空）'}</span>
        </div>
        <div className="sess-tools">
          <div className="sess-field">
            <label htmlFor="dsm-retention">自动清理</label>
            <select id="dsm-retention" value={trashSettings.retentionDays || 0} disabled={trashBusy !== null} onChange={(e) => updateRetention(e.target.value)}>
              <option value="0">不自动清理</option><option value="7">保留 7 天</option><option value="30">保留 30 天</option><option value="90">保留 90 天</option>
            </select>
          </div>
          <div className="sess-field"><label>数据检查</label><button type="button" className="archv-btn" disabled={trashBusy !== null} onClick={verifyTrash}>{trashBusy === '__verify' ? '校验中…' : '校验日志完整性'}</button></div>
          <div className="sess-field"><label>永久清理</label><button type="button" className="archv-btn archv-del" disabled={trashBusy !== null || !trash.length} onClick={() => setPurgeTarget('__all')}>清空回收站</button></div>
        </div>
        {trashCheck && <div className={trashCheck.missing ? 'archv-err' : 'archv-empty'} role="status">校验完成：{trashCheck.healthy} 条正常，{trashCheck.missing} 条日志缺失。</div>}
        {trash.length === 0 ? (
          <div className="dsm-trash-empty">回收站为空。删除的会话会先进入这里，可恢复或彻底删除。</div>
        ) : (
          <div className="dsm-trash-list">
            {trash.map((t) => (
              <div key={t.sessionId} className="dsm-trash-row">
                <span className="dsm-trash-name" title={t.sessionId}>{t.title || t.sessionId}</span>
                <span className="dsm-trash-date">{fmtDate(t.deletedAt)}</span>
                <span className="dsm-trash-actions">
                  <button type="button" className="archv-btn" disabled={trashBusy !== null} onClick={() => restoreTrash(t.sessionId)}>恢复</button>
                  <button type="button" className="archv-btn archv-del" disabled={trashBusy !== null} onClick={() => setPurgeTarget(t.sessionId)}>彻底删除</button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>}
      {purgeTarget && (
        <div className="dlg-backdrop" onClick={() => setPurgeTarget(null)}>
          <div ref={dialogRef} className="dlg" role="alertdialog" aria-modal="true" aria-labelledby="dsm-purge-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="dsm-purge-title" className="dlg-title">永久删除{purgeTarget === '__all' ? '全部回收站会话' : '这个会话'}？</h3>
            <p className="dlg-text">此操作会物理删除日志，无法恢复。归档、筛选和重新安装插件都不能找回这些数据。</p>
            <div className="dlg-actions">
              <button type="button" className="archv-btn" onClick={() => setPurgeTarget(null)}>取消</button>
              <button type="button" className="archv-btn archv-del" onClick={() => { const target = purgeTarget; setPurgeTarget(null); target === '__all' ? purgeAllTrash() : purgeTrash(target) }}>确认永久删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Main-page sidebar session "⋯" menu augmentation (DOM shim) -----------
// DSH core renders the sidebar session list (dsh-client-ui-workspace) with a
// per-row "⋯" Menu whose items (rename / fork / archive) are hardcoded — there
// is NO plugin slot for adding per-session menu items, and the row DOM carries
// no sessionId. To honor the request we augment the already-opened portalled
// menu via DOM: we watch for a [role="menu"] portalled to document.body whose
// React fiber chain reaches a SessionNodeItem (i.e. it is a session menu), read
// the session id (and current cwd) off that fiber, then clone an existing menu
// item to append "移动会话" / "删除会话". This is intentionally a DOM shim and is
// fragile against DSH UI updates (class names / fiber shape / menu markup).
const SIDEBAR_AUG_CSS = `
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
.dsm-drag-source{opacity:.48}
.dsm-drop-target{position:relative;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent)!important;outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px;border-radius:8px}
.dsm-drop-target::after{content:'移动到这里';position:absolute;right:8px;top:50%;transform:translateY(-50%);padding:1px 6px;border-radius:4px;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-inverted);font-size:10px;font-weight:600;line-height:16px;pointer-events:none}
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
`

// Shared status-dot state so the ⋯-menu "标记未读" action can toggle the
// manual flag and trigger a repaint without coupling the two installers.
const DSM_KEY_MANUAL = 'dsm-manual-unread-v1'
let dsmManualUnread = null
let dsmRepaintDots = null
function dsmLoadManual() {
  if (dsmManualUnread) return dsmManualUnread
  try { dsmManualUnread = new Set(JSON.parse(localStorage.getItem(DSM_KEY_MANUAL) || '[]')) } catch (e) { dsmManualUnread = new Set() }
  return dsmManualUnread
}
function dsmSaveManual() { try { localStorage.setItem(DSM_KEY_MANUAL, JSON.stringify([...dsmLoadManual()])) } catch (e) {} }
function dsmToggleManual(id) {
  const s = dsmLoadManual()
  if (s.has(id)) s.delete(id); else s.add(id)
  dsmSaveManual()
  if (dsmRepaintDots) dsmRepaintDots()
}

// Recycle-bin membership (session ids currently in 回收站). The sidebar
// status-dot installer uses this to hide trashed sessions so they don't show
// up under DSH's "未分组" group. Loaded from the backend on a throttle and
// updated optimistically when our own ⋯-menu deletes a session.
let dsmTrashIds = null
let dsmServerPurgedIds = new Set()
let dsmAuthoritativeTitles = new Map()
let dsmTrashTick = 0
async function dsmLoadTrashIds() {
  try {
    const r = await postJSON('/archived-sessions/sidebar-state', {})
    dsmTrashIds = new Set(((r && r.trashedSessionIds) || []).map(String))
    dsmServerPurgedIds = new Set(((r && r.purgedSessionIds) || []).map(String))
    dsmAuthoritativeTitles = new Map(Object.entries((r && r.titles) || {}).map(([id, title]) => [String(id), String(title)]))
    if (dsmRepaintDots) dsmRepaintDots()
  } catch (e) { /* keep last known set */ }
  return dsmTrashIds
}

// Permanently-hidden set: sessions the user hard-purged from the 回收站. Unlike
// dsmTrashIds (which the backend poll refreshes and can drop), these are GONE for
// good, so we keep them hidden forever — otherwise DSH re-surfaces the orphan
// under a "未分组" group after the trash poll drops it from dsmTrashIds.
const DSM_KEY_PURGED = 'dsm-purged-v1'
let dsmPurgedIds = null
function dsmLoadPurged() {
  if (!dsmPurgedIds) {
    try { dsmPurgedIds = new Set(JSON.parse(localStorage.getItem(DSM_KEY_PURGED) || '[]')) } catch (e) { dsmPurgedIds = new Set() }
  }
  dsmServerPurgedIds.forEach((id) => dsmPurgedIds.add(id))
  return dsmPurgedIds
}
function dsmSavePurged() { try { localStorage.setItem(DSM_KEY_PURGED, JSON.stringify([...dsmLoadPurged()])) } catch (e) {} }
function dsmMarkPurged(ids) {
  const s = dsmLoadPurged()
  ids.forEach((id) => s.add(String(id)))
  dsmSavePurged()
  if (dsmRepaintDots) dsmRepaintDots()
}

function installSidebarSessionMenuAug() {
  if (typeof document === 'undefined') return
  const AUG = 'data-dsm-aug'
  let styleInjected = false
  let activeSubClose = null
  let hoverTimer = null

  const findFiber = (el) => {
    const k = Object.keys(el).find((kk) => kk.startsWith('__reactFiber') || kk.startsWith('__reactInternalInstance'))
    return k ? el[k] : null
  }
  // Walk the React fiber chain from the portalled menu element up to the
  // SessionNodeItem component, which carries `node.id` (the session id).
  const sessionInfoFromMenu = (menuEl) => {
    let f = findFiber(menuEl)
    let guard = 0
    while (f && guard++ < 300) {
      const p = f.memoizedProps
      if (p && p.node && typeof p.node.id === 'string' && p.node.id) {
        return { id: p.node.id, cwd: p.node.cwd || p.node.workspacePath || null }
      }
      f = f.return
    }
    return null
  }
  const closeMenu = () => {
    try { document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) } catch (e) {}
    try { document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) } catch (e) {}
  }
  const escapeHtml = (s) => {
    const d = document.createElement('div')
    d.textContent = s == null ? '' : String(s)
    return d.innerHTML
  }
  const toast = (msg) => {
    const t = document.createElement('div')
    t.className = 'dsm-toast'
    t.textContent = msg
    document.body.appendChild(t)
    setTimeout(() => t.remove(), 2600)
  }
  const ensureStyle = () => {
    if (styleInjected) return
    const s = document.createElement('style')
    s.dataset.dsm = 'aug'
    s.textContent = SIDEBAR_AUG_CSS
    document.head.appendChild(s)
    styleInjected = true
  }
  const closeMoveSubmenu = () => {
    if (activeSubClose) { const f = activeSubClose; activeSubClose = null; f() }
  }
  const openMoveSubmenu = (moveBtn, info) => {
    ensureStyle()
    closeMoveSubmenu()
    const sub = document.createElement('div')
    sub.className = 'dsm-sub'
    sub.setAttribute('role', 'menu')
    sub.setAttribute('data-dsm-sub', '')
    sub.innerHTML = '<div class="dsm-sub-loading">加载工作区…</div>'
    const r = moveBtn.getBoundingClientRect()
    sub.style.top = Math.max(8, Math.round(r.top - 4)) + 'px'
    sub.style.left = Math.round(r.right + 10) + 'px'
    document.body.appendChild(sub)
    const closeSub = () => {
      activeSubClose = null
      if (sub.parentNode) sub.remove()
      document.removeEventListener('mousedown', onDocDown, true)
      window.removeEventListener('blur', closeSub)
    }
    const onDocDown = (e) => {
      if (sub.contains(e.target) || moveBtn.contains(e.target)) return
      closeSub()
    }
    // Keep DSH's own outside-click handler from closing the parent menu while
    // the pointer is over our submenu (it lives outside the portalled card).
    sub.addEventListener('mousedown', (e) => e.stopPropagation())
    // Hover bridging: moving from the trigger button across the 10px gap to
    // the submenu must not dismiss it; entering the submenu cancels the
    // pending close timer set on the button's mouseleave.
    sub.addEventListener('mouseenter', () => { if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null } })
    sub.addEventListener('mouseleave', () => { hoverTimer = setTimeout(() => closeSub(), 160) })
    setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0)
    window.addEventListener('blur', closeSub)
    activeSubClose = closeSub
    Promise.all([
      postJSON('/archived-sessions/workspaces', {}),
      postJSON('/archived-sessions/sessions', {}),
    ]).then(([ws, sess]) => {
      const items = ws.items || []
      const cur = (sess.items || []).find((x) => x.sessionId === info.id)
      const curPath = cur ? cur.workspacePath : (info.cwd || null)
      if (!items.length) { sub.innerHTML = '<div class="dsm-sub-empty">（暂无可用工作区）</div>'; return }
      sub.innerHTML = ''
      items.forEach((w) => {
        const isCur = !!curPath && w.path === curPath
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'dsm-sub-item'
        b.setAttribute('role', 'menuitem')
        b.disabled = isCur
        const name = document.createElement('span')
        name.className = 'dsm-sub-name'
        name.textContent = w.title || pathName(w.path) || w.workspaceId
        b.appendChild(name)
        if (isCur) {
          const c = document.createElement('span')
          c.className = 'dsm-sub-cur'
          c.textContent = '当前'
          b.appendChild(c)
        }
        b.addEventListener('click', (e) => {
          e.stopPropagation()
          e.preventDefault()
          closeSub()
          closeMenu()
          postJSON('/archived-sessions/move', { sessionId: info.id, targetPath: w.path })
            .then(() => toast('移动成功'))
            .catch((ee) => toast('移动失败：' + String((ee && ee.message) || ee)))
        })
        sub.appendChild(b)
      })
    }).catch((e) => {
      sub.innerHTML = '<div class="dsm-sub-err">' + escapeHtml(String((e && e.message) || e)) + '</div>'
    })
  }
  const openDeleteConfirm = (id) => {
    ensureStyle()
    const backdrop = document.createElement('div')
    backdrop.className = 'dsm-backdrop'
    const dlg = document.createElement('div')
    dlg.className = 'dsm-dlg'
    dlg.innerHTML = '<h3 class="dsm-title">删除会话</h3><p class="dsm-text">确认将该会话移入回收站？可在「设置 → 会话管理 → 回收站」中恢复或彻底删除。</p><div class="dsm-actions"><button type="button" class="dsm-btn" data-role="cancel">取消</button><button type="button" class="dsm-btn dsm-del" data-role="ok">移入回收站</button></div>'
    backdrop.appendChild(dlg)
    document.body.appendChild(backdrop)
    const close = () => backdrop.remove()
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close() })
    dlg.querySelector('[data-role=cancel]').addEventListener('click', close)
    dlg.querySelector('[data-role=ok]').addEventListener('click', () => {
      close()
      postJSON('/archived-sessions/delete', { sessionId: id })
        .then(() => {
          if (dsmTrashIds) dsmTrashIds.add(String(id))
          if (dsmRepaintDots) dsmRepaintDots()
          toast('已移入回收站')
        })
        .catch((e) => toast('删除失败：' + String((e && e.message) || e)))
    })
  }
  const augmentMenu = (menuEl, info) => {
    if (menuEl.querySelector('[' + AUG + ']')) return
    const viewport = menuEl.querySelector('[role="presentation"]') || menuEl.firstElementChild
    if (!viewport) return
    const proto = menuEl.querySelector('[role="menuitem"]')
    if (!proto) return
    const protoWrap = proto.parentElement
    const protoCls = proto.className
    const protoWrapCls = protoWrap ? protoWrap.className : ''
    const ICON_MOVE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v4"/><path d="M10 13l2 2 2-2"/></svg>'
    const ICON_DEL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M9 7V4h6v3"/></svg>'
    const ICON_UNREAD = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>'
    const mk = (label, svg, danger) => {
      const wrap = protoWrap ? protoWrap.cloneNode(false) : document.createElement('div')
      if (protoWrapCls) wrap.className = protoWrapCls
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.setAttribute('role', 'menuitem')
      btn.className = protoCls // same `.item` class DSH uses → identical layout/alignment
      const icon = document.createElement('span')
      icon.style.cssText = 'display:inline-flex;flex:none;width:16px;height:16px;align-items:center;justify-content:center;color:' + (danger ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-tertiary)')
      icon.innerHTML = svg
      const lab = document.createElement('span')
      lab.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
      lab.textContent = label
      btn.appendChild(icon)
      btn.appendChild(lab)
      if (danger) btn.style.color = 'var(--dsw-alias-state-error-primary)'
      btn.setAttribute(AUG, '')
      wrap.appendChild(btn)
      return { wrap, btn }
    }
    const move = mk('移动会话', ICON_MOVE, false)
    const del = mk('删除会话', ICON_DEL, true)
    const mark = mk(dsmLoadManual().has(info.id) ? '标记已读' : '标记未读', ICON_UNREAD, false)
    if (mark.btn.firstChild) mark.btn.firstChild.style.color = 'var(--dsw-alias-state-business-primary)'
    const chev = document.createElement('span')
    chev.style.cssText = 'margin-left:auto;flex:none;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:1'
    chev.textContent = '›'
    move.btn.appendChild(chev)
    move.btn.addEventListener('mouseenter', () => {
      if (!document.querySelector('[data-dsm-sub]')) openMoveSubmenu(move.btn, info)
    })
    move.btn.addEventListener('mouseleave', () => {
      hoverTimer = setTimeout(() => closeMoveSubmenu(), 160)
    })
    move.btn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault() })
    del.btn.addEventListener('click', (e) => {
      e.stopPropagation()
      e.preventDefault()
      closeMoveSubmenu()
      openDeleteConfirm(info.id)
    })
    mark.btn.addEventListener('click', (e) => {
      e.stopPropagation()
      e.preventDefault()
      closeMoveSubmenu()
      dsmToggleManual(info.id)
      closeMenu()
    })
    viewport.appendChild(move.wrap)
    viewport.appendChild(del.wrap)
    // 标记未读 goes to the very top of the menu (above DSH's native items).
    viewport.insertBefore(mark.wrap, viewport.firstElementChild)
  }

  const seen = new WeakSet()
  const obs = new MutationObserver(() => {
    const menus = document.querySelectorAll('body > [role="menu"]')
    menus.forEach((menuEl) => {
      if (seen.has(menuEl)) return
      const info = sessionInfoFromMenu(menuEl)
      if (!info) return // not a session menu (e.g. settings / header dropdown)
      seen.add(menuEl)
      try { augmentMenu(menuEl, info) } catch (e) { /* best-effort DOM shim */ }
    })
  })
  obs.observe(document.body, { childList: true, subtree: false })
}

// Left-side per-session status dot (DOM shim). The color is driven by DSH's
// REAL session status, read from the row's own StateDot ([data-state]):
//   手动标记未读（蓝） = 用户在 ⋯ 菜单或点击圆点手动标记，localStorage 持久化（最高优先级）
//   工作中（黄）       = DSH state 'running'
//   需用户反馈（琥珀） = DSH state 'warning'（有追问需用户反馈）
//   完成后未读（绿）   = DSH state 'done' 且用户尚未读过（read 集合）
//   完成已读（不显示） = DSH state 'done' 且已读过（read 集合持久化）
// 手动未读集合 + read 集合均持久化于 localStorage；打开过即记入 read，绿点不再出现。
// 另外：进入回收站的会话会整行隐藏（不出现在「未分组」里）。
function installSidebarStatusDots() {
  if (typeof document === 'undefined') return
  const DOT = 'data-dsm-dot'
  if (!document.querySelector('style[data-dsm=aug]')) {
    const s = document.createElement('style')
    s.dataset.dsm = 'aug'
    s.textContent = SIDEBAR_AUG_CSS
    document.head.appendChild(s)
  }
  const findFiber = (el) => {
    const k = Object.keys(el).find((kk) => kk.startsWith('__reactFiber') || kk.startsWith('__reactInternalInstance'))
    return k ? el[k] : null
  }
  const fiberProp = (el, pred) => {
    let f = findFiber(el)
    let g = 0
    while (f && g++ < 300) {
      const p = f.memoizedProps
      if (p && pred(p)) return pred(p)
      f = f.return
    }
    return null
  }
  const rowNode = (row) => fiberProp(row, (p) => (p.node && typeof p.node.id === 'string' && p.node.id ? p.node : null))
  const rowId = (row) => { const node = rowNode(row); return node ? node.id : null }
  let curActive = null
  const activeRowId = () => {
    const sel = document.querySelector('[role="treeitem"][aria-selected="true"]')
    return sel ? rowId(sel) : null
  }
  // Dot colors per the user's scheme. We read DSH's REAL session status from the
  // row's own StateDot (its [data-state] attr) and recolor it:
  //   running  → 黄  工作中
  //   warning  → 琥珀 有追问需用户反馈
  //   done     → 绿  完成后未读（读过则不再显示）
  //   error    → 红  出错/需关注（与 DSH 自带 StateDot 一致）
  //   (manual  → 蓝  手动标记未读，最高优先级)
  const COLOR = {
    manual: 'var(--dsw-alias-state-business-primary)',        // 蓝 手动标记未读
    running: '#EAB308',                                       // 黄 工作中 (DSH running)
    feedback: 'var(--dsw-alias-state-warning-primary)',       // 琥珀 需用户反馈 (DSH warning)
    done: 'var(--dsw-alias-state-success-primary)',           // 绿 完成后未读 (DSH done)
    error: 'var(--dsw-alias-state-error-primary)',            // 红 出错/需关注 (DSH error)
  }
  const manualUnread = dsmLoadManual()
  const paint = () => {
    // Recompute the active session on every paint so the active row is never
    // shown from a stale `curActive` (the click that changes aria-selected
    // mutates the DOM and triggers paint immediately, before the 1.2s tick()
    // would have run — without this, the clicked session flashed green).
    const activeId = activeRowId()
    // Clicking into a manually-marked session auto-clears the manual unread
    // flag (it becomes read on open) — only on the active transition, so a
    // flag set while already viewing it isn't wiped until you re-enter it.
    if (activeId !== curActive && activeId && manualUnread.has(activeId)) {
      manualUnread.delete(activeId)
      dsmSaveManual()
    }
    curActive = activeId
    const rows = document.querySelectorAll('[role="treeitem"]')
    rows.forEach((row) => {
      const id = rowId(row)
      if (!id) return
      // Trashed sessions belong in 回收站, not the sidebar (DSH would group
      // them under "未分组"). Hide the row entirely and skip its dot. So do
      // hard-purged sessions — they're gone for good and must never resurface
      // (otherwise DSH re-renders the orphan under a "未分组" group).
      const purged = dsmLoadPurged()
      if ((dsmTrashIds && dsmTrashIds.has(id)) || purged.has(id)) {
        if (row.style.display !== 'none') row.style.display = 'none'
        const d = row.querySelector('[' + DOT + ']'); if (d) d.remove()
        return
      }
      if (row.style.display === 'none') row.style.display = ''
      // DSH's cold list baseline can expose a stale header title until the
      // Session is opened. Paint the latest log-folded title from the host
      // authority without materializing the Session or changing its log.
      const authoritativeTitle = dsmAuthoritativeTitles.get(id)
      if (authoritativeTitle) {
        const node = rowNode(row) || {}
        const expected = new Set([node.title, node.displayTitle, node.name].filter((value) => typeof value === 'string'))
        const spans = [...row.children].filter((el) => el.tagName === 'SPAN' && !el.querySelector('[data-state]') && (el.textContent || '').trim())
        const titleEl = spans.find((el) => expected.has((el.textContent || '').trim())) || spans[0]
        if (titleEl && titleEl.textContent !== authoritativeTitle) titleEl.textContent = authoritativeTitle
      }
      // Read DSH's REAL session status from the row's own StateDot and recolor
      // it with the user's scheme (we also hide DSH's dot so only ours shows).
      const sd = row.querySelector('[data-state]')
      if (sd) sd.style.display = 'none'
      let dot = row.querySelector('[' + DOT + ']')
      let color = null
      if (manualUnread.has(id)) color = COLOR.manual
      else if (sd) {
        const st = sd.getAttribute('data-state')
        if (st === 'running') color = COLOR.running
        else if (st === 'warning') color = COLOR.feedback
        else if (st === 'error') color = COLOR.error
        else if (st === 'done') color = (activeId === id) ? null : COLOR.done
      }
      if (!color) { if (dot) dot.remove(); return }
      if (!dot) {
        dot = document.createElement('span')
        dot.setAttribute(DOT, '')
        dot.className = 'dsm-dot'
        if (!row.hasAttribute('data-dsm-pos')) {
          if (getComputedStyle(row).position === 'static') row.style.position = 'relative'
          row.setAttribute('data-dsm-pos', '')
        }
        dot.addEventListener('click', (e) => {
          e.stopPropagation(); e.preventDefault()
          dsmToggleManual(id)
        })
        row.insertBefore(dot, row.firstChild)
      }
      dot.style.background = color
    })
  }
  dsmRepaintDots = paint
  const tick = () => { if (++dsmTrashTick % 8 === 0) dsmLoadTrashIds(); paint() }
  let raf = 0
  const schedulePaint = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; paint() }) }
  tick()
  dsmLoadTrashIds()
  paint()
  const obs = new MutationObserver(schedulePaint)
  obs.observe(document.body, { childList: true, subtree: true })
  setInterval(tick, 1200)
}

// Cross-workspace drag/drop for the native DSH sidebar. DSH does not expose a
// sidebar-row plugin slot, so the adapter discovers session/workspace rows from
// their React fiber nodes, while the actual move remains entirely host-owned.
// The existing “移动会话” menu is also the keyboard-accessible fallback.
function installSidebarWorkspaceDrag() {
  if (typeof document === 'undefined') return
  let sessions = new Map()
  let dragging = null
  let moving = false

  const findFiber = (el) => {
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'))
    return key ? el[key] : null
  }
  const fiberNodes = (el) => {
    const out = []
    let fiber = findFiber(el)
    let guard = 0
    while (fiber && guard++ < 300) {
      const props = fiber.memoizedProps
      if (props && props.node && typeof props.node === 'object') out.push(props.node)
      // DSH's SessionNodeItem receives `node`, while ProjectRowItem (the
      // workspace heading) receives `group`. Without the latter every session
      // can start dragging but no workspace can ever become a valid drop zone.
      if (props && props.group && typeof props.group === 'object') out.push(props.group)
      fiber = fiber.return
    }
    return out
  }
  const sessionForRow = (row) => {
    for (const node of fiberNodes(row)) {
      const id = node && node.id != null ? String(node.id) : ''
      if (sessions.has(id)) return sessions.get(id)
      // The live DSH row is authoritative even before the async sidebar-state
      // refresh finishes. Workspace groups use `workspaceId`, never `id`.
      if (id && node.workspaceId == null && (node.title != null || node.updatedAt != null || node.blank != null)) {
        return { sessionId: id, title: node.title || '', workspacePath: null }
      }
    }
    return null
  }
  const workspaceForRow = (row) => {
    // A session row's fiber chain also contains its parent workspace node.
    // Reject it explicitly so only the visible workspace header is a drop zone.
    if (sessionForRow(row)) return null
    for (const group of fiberNodes(row)) {
      if (group.workspaceId != null && typeof group.cwd === 'string' && group.cwd) {
        return { workspaceId: String(group.workspaceId), path: group.cwd, title: group.label || group.cwd }
      }
    }
    return null
  }
  const eventRow = (event) => {
    for (const item of event.composedPath ? event.composedPath() : []) {
      if (item instanceof Element && item.getAttribute('role') === 'treeitem') return item
    }
    return event.target instanceof Element ? event.target.closest('[role="treeitem"]') : null
  }
  const toast = (message) => {
    const el = document.createElement('div')
    el.className = 'dsm-toast'
    el.setAttribute('role', 'status')
    el.textContent = message
    document.body.appendChild(el)
    setTimeout(() => el.remove(), 2600)
  }
  const clearVisuals = () => {
    document.querySelectorAll('.dsm-drag-source,.dsm-drop-target').forEach((el) => el.classList.remove('dsm-drag-source', 'dsm-drop-target'))
  }
  const decorateRows = () => {
    document.querySelectorAll('[role="treeitem"]').forEach((row) => {
      const session = sessionForRow(row)
      const ws = workspaceForRow(row)
      if (session) {
        row.setAttribute('aria-description', '可拖动到其他工作区；键盘用户可通过更多菜单中的移动会话操作')
      }
      if (ws) row.setAttribute('data-dsm-workspace-drop', '')
    })
  }
  const refresh = async () => {
    try {
      const sessionResult = await postJSON('/archived-sessions/sessions', {})
      sessions = new Map((sessionResult.items || []).map((item) => [String(item.sessionId), item]))
      decorateRows()
    } catch (e) { /* sidebar enhancement remains optional */ }
  }

  // Capture before DSH's delegated React handlers. DSH reserves the same
  // native drag gesture for reordering sessions inside one group; only a real
  // workspace-heading target is intercepted here, so same-group sorting keeps
  // its official behavior.
  document.addEventListener('dragstart', (event) => {
    const row = eventRow(event)
    const item = row && sessionForRow(row)
    if (!item || moving) return
    dragging = item
    row.classList.add('dsm-drag-source')
  }, true)
  document.addEventListener('dragover', (event) => {
    const row = eventRow(event)
    const target = row && workspaceForRow(row)
    if (!dragging || !target || moving) return
    if (dragging.workspacePath && target.path === dragging.workspacePath) return
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    document.querySelectorAll('.dsm-drop-target').forEach((el) => { if (el !== row) el.classList.remove('dsm-drop-target') })
    row.classList.add('dsm-drop-target')
  }, true)
  document.addEventListener('drop', async (event) => {
    const row = eventRow(event)
    const item = dragging
    const target = row && workspaceForRow(row)
    if (!item || !target || moving || (item.workspacePath && target.path === item.workspacePath)) return
    event.preventDefault()
    event.stopPropagation()
    moving = true
    clearVisuals()
    row.classList.add('dsm-drag-busy')
    try {
      const result = await postJSON('/archived-sessions/move', { sessionId: item.sessionId, targetPath: target.path })
      sessions.set(item.sessionId, { ...item, workspacePath: result.workspacePath || target.path, workspaceTitle: result.workspaceTitle || target.title })
      await dsmLoadTrashIds()
      toast(`已移到「${result.workspaceTitle || target.title}」`)
    } catch (error) {
      toast('移动失败：' + String((error && error.message) || error))
    } finally {
      moving = false
      dragging = null
      row.classList.remove('dsm-drag-busy')
      decorateRows()
    }
  }, true)
  document.addEventListener('dragend', () => {
    dragging = null
    clearVisuals()
  }, true)

  let decorateTimer = null
  const scheduleDecorate = () => {
    if (decorateTimer) return
    decorateTimer = requestAnimationFrame(() => { decorateTimer = null; decorateRows() })
  }
  refresh()
  const observer = new MutationObserver(scheduleDecorate)
  observer.observe(document.body, { childList: true, subtree: true })
  setInterval(refresh, 5000)
}

export function apply(ctx) {
  installSettingsNavIcons(ctx)
  installSidebarSessionMenuAug()
  installSidebarStatusDots()
  installSidebarWorkspaceDrag()
  const workspacesSvc = ctx.get('workspaces')
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      { name: 'settings.section', id: 'session-manager', order: 90, label: '会话管理' },
      (props) => <SessionPanel {...props} workspacesSvc={workspacesSvc} />,
    ),
  )
}
