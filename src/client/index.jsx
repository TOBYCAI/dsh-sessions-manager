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
import { authoritativeTitleForFirstPaint, canDropOnWorkspace, dotStateFor, foldSubagents, openSubagentToast, sessionForNodes, shortId, starredOf, toastDurationFor, workspaceForNodes } from './logic.js'

export const inject = ['slots']

const PANEL_PREFS_KEY = 'dsm-panel-prefs-v1'
function loadPanelPrefs() {
  try { return JSON.parse(localStorage.getItem(PANEL_PREFS_KEY) || '{}') || {} } catch (e) { return {} }
}

const CSS = `
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
/* 低频分类（已收藏/空白/回收站）横向收纳：默认 max-width:0 隐藏，点按箭头
   （sess-fmore-open）或低频分类处于选中态（sess-fsec-on）时向右展开；
   max-width 过渡做横向滑出动画，overflow 裁剪回缩过程。 */
.sess-fmore{display:inline-flex;align-items:center;gap:6px;max-width:0;opacity:0;overflow:hidden;white-space:nowrap;transform:translateX(-8px);visibility:hidden;transition:max-width .22s ease,opacity .18s ease,transform .22s ease,visibility 0s .22s}
.sess-fwrap.sess-fmore-open .sess-fmore,.sess-fwrap.sess-fsec-on .sess-fmore{max-width:30em;opacity:1;transform:none;visibility:visible;transition:max-width .22s ease,opacity .18s ease,transform .22s ease}
.sess-farrow{appearance:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;padding:0;opacity:0;pointer-events:none;transition:opacity .18s ease,color .18s ease}
/* 箭头默认紧跟三个主 tab 右边（悬停筛选行才浮现）；展开组撑开后把它推到
   行尾。无外圈底色，只渲染 svg 本体。隐藏态用 pointer-events:none 挡住
   误点；展开态（含选中低频分类的兜底）常驻——收起入口不能消失。 */
.sess-fwrap:hover .sess-farrow,.sess-fwrap.sess-fmore-open .sess-farrow,.sess-fwrap.sess-fsec-on .sess-farrow{opacity:1;pointer-events:auto}
.sess-farrow:hover{color:var(--dsw-alias-label-primary)}
.sess-farrow svg{display:block;transition:transform .22s ease}
.sess-fwrap.sess-fmore-open .sess-farrow svg,.sess-fwrap.sess-fsec-on .sess-farrow svg{transform:rotate(180deg)}
.sess-fbtn{appearance:none;min-height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-subtle);color:var(--dsw-alias-label-secondary);border-radius:999px;font-size:12px;font-weight:500;cursor:pointer}
.sess-fbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.sess-fbtn-on{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}
.sess-tools{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin:0 0 8px}
.sess-tools-4{grid-template-columns:repeat(auto-fit,minmax(132px,1fr))}
.dsm-kids{display:flex;flex-direction:column;gap:6px;margin:10px 0 2px;margin-left:43px;padding-left:10px;border-left:2px solid var(--dsw-alias-border-l3)}
.dsm-kid .dsm-kids{margin-left:8px;margin-top:6px}
.dsm-kids-toggle{appearance:none;min-height:22px;padding:0 9px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);color:var(--dsw-alias-state-business-primary);border-radius:var(--dsm-radius-tag);font:inherit;font-size:11px;font-weight:500;cursor:pointer;flex:none;white-space:nowrap}
.dsm-kids-toggle:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,transparent)}
.dsm-kid{display:flex;flex-direction:column;gap:6px;min-width:0}
.dsm-kid-row{display:flex;align-items:center;gap:8px;min-width:0}
.dsm-kid-name{flex:1 1 auto;min-width:0;font-size:12px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-kid-meta{font-size:11px;color:var(--dsw-alias-label-tertiary);flex:none;white-space:nowrap}
.dsm-kid-acts{display:flex;align-items:center;gap:6px;flex:none;margin-left:auto}
.dsm-kid-acts .archv-btn{min-height:26px;padding:0 9px;font-size:11px}
.sess-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.sess-field label{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.sess-field input,.sess-field select{box-sizing:border-box;width:100%;min-height:36px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsm-radius-ctl);background:var(--dsw-alias-fill-elevated);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
.sess-results{display:flex;flex-direction:column;gap:1px;font-size:11px;color:var(--dsw-alias-label-tertiary);margin:0 0 4px}
.archv button:focus-visible,.archv input:focus-visible,.archv select:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.sess-batch{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 2px 4px;margin-bottom:4px}
/* issue #7：勾选后批量操作栏吸顶——列表再长，操作按钮也一直在手边。 */
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
/* 失败提示用警示色 + 加粗，并停留更久（需要用户读完去做下一步操作）。 */
.archv-status-err{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);font-weight:500}
@media (prefers-reduced-motion:reduce){.archv-skel-card::after{animation:none}.archv-card,.archv-btn,.archv-star{transition:none}.archv-star:hover,.archv-star:active{transform:none}.archv-status,.archv-spin{animation:none}}
@media (max-width:640px){.archv-card{flex-direction:column;align-items:stretch;gap:10px}.archv-actions{justify-content:flex-end}.sess-tools,.sess-tools-4{grid-template-columns:1fr}.sess-fbtn,.archv-btn{min-height:40px}.archv-star{width:30px;height:30px}.archv-star svg{width:22px;height:22px}.dsm-kids{margin-left:10px}.archv-titlerow{flex-wrap:wrap}.dsm-kid-row{flex-wrap:wrap}.dsm-kid-acts{margin-left:0}}
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

// 服务端 409 错误码：会话正被 DSH 占用写权限（0.1.3 单写者机制）。切走会话后
// 原地重试即可，所以这类失败要给用户一个「重试」入口。
const BUSY_CODE = 'DSM_SESSION_BUSY'

async function postJSON(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body || {}),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data) {
    // 保留服务端错误码：UI 需要据此区分「可重试」的失败（如 DSM_SESSION_BUSY
    // —— 会话正被 DSH 占用写权限，切走会话后原地重试即可）与重试也无用的错误。
    const error = new Error((data && (data.error || data.message)) || `request failed (${res.status})`)
    if (data && data.code) error.code = data.code
    throw error
  }
  return data
}

// 打开一个会话（尤其是侧栏不渲染的子代理会话）。
//
// 只走官方公开契约（runtime 的 client api-catalog）：
//   sessions.open(id)                 —— 选中会话为当前
//   sessions.refreshSubagents(parent) —— 刷新某父会话的直接子代理目录
//   sessions.openSubagent(address)    —— 用「直接父 + 子」地址打开目录里的子代理
// 拿不到 sessions 服务（老 runtime）时返回 false，由调用方给出降级提示，绝不
// 触碰任何私有内部状态。
let dsmClientCtx = null
function dsmSessionsService() {
  try { return dsmClientCtx && typeof dsmClientCtx.get === 'function' ? dsmClientCtx.get('sessions') : null } catch (e) { return null }
}
function dsmCurrentSessionId(svc) {
  try {
    const snap = svc && svc.list && typeof svc.list.getSnapshot === 'function' ? svc.list.getSnapshot() : null
    return snap && snap.current != null ? String(snap.current) : null
  } catch (e) { return null }
}
// 返回 Promise<'ok' | 'no-service' | 'failed'>：只回 true/false 的话，调用方
// 只能给出一句「打不开」的笼统提示——用户既不知道为什么，也不知道下一步该
// 怎么办。区分原因后提示才能说清「去哪儿、做什么」。
async function dsmOpenSessionById(childId, directParentId) {
  const sid = String(childId || '')
  if (!sid) return 'failed'
  const svc = dsmSessionsService()
  if (!svc) return 'no-service'
  const parent = directParentId ? String(directParentId) : null
  // 1) 直接选中（对仍在会话列表里的子代理最省事）。
  if (typeof svc.open === 'function') {
    try {
      svc.open(sid)
      await new Promise((r) => setTimeout(r, 350))
      if (dsmCurrentSessionId(svc) === sid) return 'ok'
    } catch (e) { /* 落到目录地址路径 */ }
  }
  // 2) 官方子代理目录路径：父会话头部的目录是 DSH 为子代理准备的导航入口，
  //    这里复用同一个地址契约（parentSessionId 必须是「直接父」，孙代也一样）。
  if (parent && typeof svc.openSubagent === 'function') {
    try {
      if (typeof svc.refreshSubagents === 'function') await svc.refreshSubagents(parent)
      svc.openSubagent({ parentSessionId: parent, childSessionId: sid, mode: 'continuable' })
      await new Promise((r) => setTimeout(r, 350))
      if (dsmCurrentSessionId(svc) === sid) return 'ok'
      // openSubagent 是同步 void，无法从返回值判断成败：地址已提交、当前会话
      // 可能因父会话上下文尚未就绪而稍后才切换，这里按成功处理避免重复触发。
      return 'ok'
    } catch (e) { /* 落到失败提示 */ }
  }
  return 'failed'
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
  let frame = 0
  const run = () => {
    frame = 0
    if (disposed) return
    // 廉价早退：设置面板没打开时整页只有一个 dialog 查询的开销，不遍历按钮。
    if (!document.querySelector('[role="dialog"]')) return
    const buttons = document.querySelectorAll('[role="dialog"] nav button')
    for (const b of buttons) {
      const t = (b.textContent || '').trim()
      if (t === LABEL) b.setAttribute('data-dsh-nav-sessions', '')
      else b.removeAttribute('data-dsh-nav-sessions')
    }
  }
  // rAF 合并：整页 MutationObserver 在一个渲染帧里可能触发成百上千次回调，
  // 每帧最多真正同步一次。
  const sync = () => { if (!frame && !disposed) frame = requestAnimationFrame(run) }
  run()
  // 刻意**不**监听 characterData：流式回复逐 token 改文本，会把整页观察器打成
  // 高频回调；导航按钮的标签只在 childList（面板重渲染）时变化，够用。
  const obs = new MutationObserver(sync)
  obs.observe(document.body, { childList: true, subtree: true })
  return () => {
    disposed = true
    if (frame) cancelAnimationFrame(frame)
    frame = 0
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
  const [capabilities, setCapabilities] = useState(null)
  const initialPrefs = useRef(loadPanelPrefs()).current
  // 注意：'storage' 已从可持久化取值中移除（它不再是视图），旧版残留的
  // filter='storage' 会自动回落到 'all'，避免落到一个已不存在的界面。
  const [filter, setFilter] = useState(() => ['all', 'active', 'archived', 'starred', 'empty', 'trash'].includes(initialPrefs.filter) ? initialPrefs.filter : 'all')
  // 低频分类折叠区：挂载时若选中的就是低频分类（偏好恢复/上次停留）则展开，
  // 保证激活 tab 始终可见；平时由箭头 hover/点按控制。
  const [moreOpen, setMoreOpen] = useState(() => ['starred', 'empty', 'trash'].includes(initialPrefs.filter))
  const [query, setQuery] = useState('')
  const [workspaceFilter, setWorkspaceFilter] = useState(() => initialPrefs.workspaceFilter || 'all')
  const [sortBy, setSortBy] = useState(() => ['newest', 'oldest', 'title'].includes(initialPrefs.sortBy) ? initialPrefs.sortBy : 'newest')
  const [selected, setSelected] = useState({})
  const [delTarget, setDelTarget] = useState(null)
  const [confirmBatch, setConfirmBatch] = useState(false)
  const [batchMoveOpen, setBatchMoveOpen] = useState(false)
  const [busy, setBusy] = useState(null)
  const [openMove, setOpenMove] = useState(null)
  const [moveMode, setMoveMode] = useState('existing')
  const [targetWs, setTargetWs] = useState('')
  const [newPath, setNewPath] = useState('')
  const [error, setError] = useState(null)
  // 可重试的失败：{ run } —— run 是「把刚才那一步原样再做一次」的闭包。存对象
  // 而非裸函数，避免被 useState 当成更新函数吃掉。没有它时错误条的「重试」退回
  // 刷新列表（refresh）。
  const [retry, setRetry] = useState(null)
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
  const [mdBusy, setMdBusy] = useState(null)
  const [zipOk, setZipOk] = useState(true)
  const [storage, setStorage] = useState(null)
  const [storageBusy, setStorageBusy] = useState(false)
  // 存储统计要 stat 每条会话日志，开销不小：面板默认收起、按需加载，
  // 且展开状态刻意不持久化——否则每次打开设置面板都会触发一次全量扫描。
  const [storageOpen, setStorageOpen] = useState(false)
  const [storageError, setStorageError] = useState(null)
  const [aa, setAa] = useState({ settings: { inactiveDays: 0, skipStarred: true }, lastRunAt: null, lastArchivedCount: 0 })
  const [aaOpen, setAaOpen] = useState(false)
  const [aaBusy, setAaBusy] = useState(false)
  const zipChecked = useRef(false)
  const [openMenu, setOpenMenu] = useState(null)
  const timer = useRef(null)
  // 存储面板关着时会话集合若发生变化，标脏；下次展开时再刷新，
  // 既不会显示过期数字，也避免每次 refresh 都白扫一遍全量日志。
  const storageDirty = useRef(false)
  const menuRef = useRef(null)
  const dialogRef = useRef(null)

  // 血缘分组（issue #6）：子代理折叠在父会话下。DSH 侧栏按设计不渲染子代理
  // 行（ui-subagent 明文 "omitted from the ordinary sidebar"），本面板是唯一
  // 能完整看到它们的地方，所以同一套「父 — 子」模型在这里落地：分组开启时
  // 子代理不再作为独立顶层卡片，而是折叠在父会话卡片下方。数据来自
  // sidebar-state 的官方 header 血缘字段（parentSession / origin），零解码。
  const [lineage, setLineage] = useState({})
  const [openKids, setOpenKids] = useState({})
  const [groupByLineage, setGroupByLineage] = useState(() => initialPrefs.groupByLineage !== false)

  const loadLineage = () => postJSON('/archived-sessions/sidebar-state', {})
    .then((r) => setLineage((r && r.lineage) || {}))
    .catch(() => {})

  // kind: 'ok'（默认）| 'err'。停留时长按**字数**给（logic.toastDurationFor）：
  // 固定 2.4s 对"排队/失败"这类几十字的文案根本读不完（用户 2026-09-10 反馈）；
  // 失败类再 +2s 并用警示色。任何提示都可以**点击立即关闭**，不必干等。
  const showToast = (msg, kind) => {
    if (timer.current) clearTimeout(timer.current)
    setToast({ msg, kind: kind === 'err' ? 'err' : 'ok' })
    timer.current = setTimeout(() => setToast(null), toastDurationFor(msg, kind))
  }

  const refresh = () => {
    setError(null)
    Promise.all([
      postJSON('/archived-sessions/sessions', {}),
      postJSON('/archived-sessions/workspaces', {}),
      postJSON('/archived-sessions/capabilities', {}),
    ])
      .then(([s, works, caps]) => {
        // Permanently-purged sessions must never re-appear here, even if DSH's
        // in-memory session index still lists them after the file was unlinked.
        const purged = dsmLoadPurged()
        const visible = (s.items || []).filter((x) => !purged.has(String(x.sessionId)))
        setSessions(visible)
        setWorkspaces(works.items || [])
        setCapabilities(caps || null)
        // 构建指纹打到控制台：面板行为与源码不一致时，第一件事就是核对这行——
        // host 端只在宿主启动时加载一次，不重启宿主看到的永远是旧代码。
        if (caps && caps.buildStamp) console.info('[dsh-sessions-manager] host build:', caps.buildStamp)
        setSelected({})
        setDelTarget(null)
        setConfirmBatch(false)
        loadLineage()
        if (!targetWs && works.items && works.items.length) setTargetWs(works.items[0].workspaceId)
        loadTrash()
        // 会话集合变了：面板开着就同步刷新；关着则只标脏，等展开时再刷。
        if (storageOpen) loadStorage()
        else storageDirty.current = true
      })
      .catch((e) => setError(String((e && e.message) || e)))
  }

  useEffect(() => {
    refresh()
    return () => { if (timer.current) clearTimeout(timer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    try { localStorage.setItem(PANEL_PREFS_KEY, JSON.stringify({ filter, workspaceFilter, sortBy, groupByLineage })) } catch (e) {}
  }, [filter, workspaceFilter, sortBy, groupByLineage])

  // 自动归档设置随面板加载一次（host 侧读取即触发每日检查）。
  // 存储统计刻意不在这里预取：它要 stat 每条日志，只在用户展开面板时才算。
  useEffect(() => {
    loadAutoArchive()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 收藏切换：乐观更新 + 失败回滚（star 是高频轻操作，不等网络往返）。
  const toggleStar = async (it) => {
    const next = !it.starred
    setSessions((s) => s && s.map((x) => (x.sessionId === it.sessionId ? { ...x, starred: next } : x)))
    try {
      await postJSON('/archived-sessions/star/set', { sessionId: it.sessionId, starred: next })
    } catch (e) {
      setSessions((s) => s && s.map((x) => (x.sessionId === it.sessionId ? { ...x, starred: !next } : x)))
      showToast('收藏失败：' + String((e && e.message) || e))
    }
  }

  // Markdown 导出：自有路由（/archived-sessions/export-md），blob 触发下载。
  const exportMarkdown = async (it) => {
    if (mdBusy) return
    setMdBusy(it.sessionId)
    try {
      const res = await fetch('/archived-sessions/export-md?sessionId=' + encodeURIComponent(it.sessionId))
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'dsh-session-' + it.sessionId + '.md'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      showToast('已导出 Markdown')
    } catch (e) {
      showToast('导出失败：' + String((e && e.message) || e))
    } finally {
      setMdBusy(null)
    }
  }

  // 官方 ZIP 导出预检（一次性）：后端不支持 raw artifacts 时返回 501，
  // 此时隐藏 ZIP 入口只留 Markdown（全局缓存，后端能力不会中途变）。
  // 探针用非法 id 走 HEAD：命中 501 = 不支持；404/400 = 路由活着且支持。
  useEffect(() => {
    if (openDetails === null || zipChecked.current) return
    zipChecked.current = true
    fetch('/api/session.export?sessionId=probe&includeDescendants=false', { method: 'HEAD' })
      .then((res) => setZipOk(res.status !== 501))
      .catch(() => setZipOk(true))
  }, [openDetails])

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
  // 能力读取：优先 v3.5.2 规范键名，回退旧键名（旧 host / 缓存响应兼容）。
  const actionCapability = (name, legacy) => {
    const source = capabilities && capabilities.actions
    return (source && (source[name] || (legacy && source[legacy]))) || { available: false, reason: '正在检查当前 DSH 的兼容能力…' }
  }
  const canPurge = actionCapability('physicalPurge', 'purge')
  const canMove = actionCapability('relocateSession', 'move')
  const canRestoreTrash = actionCapability('restoreIndexedSession', 'restoreTrash')

  const archivedList = sessions ? sessions.filter((x) => x.archived) : []
  const activeList = sessions ? sessions.filter((x) => !x.archived) : []
  const starredList = starredOf(sessions)
  // issue #6 之三：空白会话单分一类。空白判定来自宿主血缘快照（sizeBytes 阈值
  // 实测校准），与侧栏「空白」标记同源——两处永远不会各说各话。
  const emptyList = useMemo(() => {
    if (!sessions) return []
    return sessions.filter((x) => { const li = lineage[String(x.sessionId)]; return !!(li && li.empty) })
  }, [sessions, lineage])
  const list = useMemo(() => {
    if (filter === 'trash') return []
    const base = filter === 'archived' ? archivedList : filter === 'active' ? activeList : filter === 'starred' ? starredList : filter === 'empty' ? emptyList : sessions || []
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
  }, [sessions, filter, query, workspaceFilter, sortBy, emptyList, starredList])
  const selIds = Object.keys(selected).filter((k) => selected[k])
  // 「回收站」是独立视图，不共用会话列表。
  const showSessionList = filter !== 'trash'

  // 血缘分组：把 origin === 'subagent' 的会话挂到父会话卡片下（可嵌套到孙
  // 代）。父会话不在当前列表里（被筛选掉 / 已删除 / 跨组）时子会话保持顶层，
  // 保证「搜得到就一定看得见」，不会因为折叠而消失。
  const { topList, kidsOf, foldedCount } = useMemo(() => {
    if (!groupByLineage) return { topList: list, kidsOf: new Map(), foldedCount: 0 }
    return foldSubagents(list, lineage)
  }, [list, lineage, groupByLineage])

  // 子代理折叠分两个部件，各自贴在它该在的位置：
  //   kidsBadge   —— 标题行内，紧跟会话标题，是「这个会话有 N 个子代理」的身份
  //                  标记（贴在卡片底部会显得像多出的一块，没有归属）；
  //   renderKids  —— 展开时的子列表，用竖线挂在父卡片内容左边缘下方。
  const kidsBadge = (sessionId) => {
    if (!groupByLineage) return null
    const kids = kidsOf.get(String(sessionId)) || []
    if (!kids.length) return null
    const open = !!openKids[sessionId]
    return (
      <button
        type="button"
        className="dsm-kids-toggle"
        aria-expanded={open}
        title={(open ? '收起' : '展开') + ' ' + kids.length + ' 个子代理会话'}
        onClick={() => setOpenKids((s) => ({ ...s, [sessionId]: !s[sessionId] }))}
      >
        {open ? '▾' : '▸'} {kids.length} 子代理
      </button>
    )
  }

  // issue #6 之二/之三：面板侧的分支与空白视觉信号（侧栏已有同源 chip/tag）。
  // 分支标记 hover 说明来源；空白标记提示去「空白」分类清理。
  // 父会话标题查找走一次性 Map（sessions 会到几百条，每卡片 find 是 O(n²)）。
  const sessionsById = useMemo(() => new Map((sessions || []).map((x) => [String(x.sessionId), x])), [sessions])
  const branchBadge = (sessionId) => {
    const li = lineage[String(sessionId)]
    if (!li || li.origin === 'subagent' || !li.parentSession) return null
    const parent = sessionsById.get(String(li.parentSession))
    const label = parent && parent.title ? `分支于：${parent.title}` : `分支会话（来源：${shortId(li.parentSession)}）`
    return <span className="dsm-branch-chip" title={label}>⑂ 分支</span>
  }
  const emptyBadge = (sessionId) => {
    const li = lineage[String(sessionId)]
    if (!li || !li.empty) return null
    return <span className="dsm-empty-chip" title="无内容的空白会话">空白</span>
  }

  const renderKids = (parentId, depth) => {
    const kids = kidsOf.get(String(parentId)) || []
    if (!kids.length || !openKids[parentId]) return null
    return (
      <div className="dsm-kids">
        {kids.map((k) => (
          <div className="dsm-kid" key={k.sessionId}>
            <div className="dsm-kid-row">
              <span className="dsm-kid-name" title={k.title || k.sessionId}>{k.title || '(无标题)'}</span>
              <span className="dsm-kid-meta">{k.archived ? '已归档' : '活动'}{fmtDate(k.createdAt) ? ` · ${fmtDate(k.createdAt)}` : ''}</span>
              <span className="dsm-kid-acts">
                <button type="button" className="archv-btn" disabled={busy !== null} title="切换到这个子代理会话（设置面板挡着会话区，关掉即可看到）" onClick={async () => {
                  const name = k.title || (String(k.sessionId).slice(0, 8) + '…')
                  const res = await dsmOpenSessionById(k.sessionId, parentId)
                  const msg = openSubagentToast(res, name, 'panel')
                  showToast(msg.text, msg.kind)
                }}>打开</button>
                <button type="button" className="archv-btn" disabled={busy !== null} onClick={() => act(k.archived ? 'restore' : 'archive', k)}>{k.archived ? '恢复' : '归档'}</button>
                <button type="button" className="archv-btn archv-del" disabled={busy !== null} title="移入回收站，可在回收站恢复" onClick={() => setDelTarget(k)}>删除</button>
              </span>
            </div>
            {(depth || 0) < 4 && renderKids(k.sessionId, (depth || 0) + 1)}
          </div>
        ))}
      </div>
    )
  }

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
        // 单条归档/恢复只是成员标记翻转：本地更新即可，不走整表 refresh
        //（refresh 会清空多选状态；host 侧缓存已把列表成本压到 stat 级别）。
        setSessions((s) => s && s.map((x) => (x.sessionId === it.sessionId ? { ...x, archived: action === 'archive' } : x)))
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
        const sid = String(delTarget.sessionId)
        setDelTarget(null)
        // 删除进入回收站：本地移除该行 + 单刷回收站，不整表 refresh。
        setSessions((s) => s && s.filter((x) => String(x.sessionId) !== sid))
        loadTrash()
        dsmLoadTrashIds()
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
      .then((r) => {
        setTrashBusy(null); setTrashCheck(r)
        if (r.missing) showToast(`发现 ${r.missing} 条日志缺失`)
        else if (r.unverified) showToast(`${r.unverified} 条日志位置由当前 Runtime 管理，无法直接核验`)
        else showToast('回收站校验通过')
      })
      .catch((e) => { setTrashBusy(null); setError(String((e && e.message) || e)) })
  }

  // 存储占用分析：只读聚合（按工作区排行 + 最大的会话）。按需调用，不在面板加载时预取。
  const loadStorage = () => {
    setStorageBusy(true)
    setStorageError(null)
    postJSON('/archived-sessions/storage', { topN: 10 })
      .then((r) => { setStorageBusy(false); setStorage(r); storageDirty.current = false })
      // 错误留在面板内自行重试，不冒泡成整个设置面板的错误条。
      .catch((e) => { setStorageBusy(false); setStorageError(String((e && e.message) || e)) })
  }

  // 自动归档设置。一次纯读取会顺带让 host 跑一遍每日检查（host 侧按天节流）。
  const applyAa = (r) => setAa({ settings: r.settings || { inactiveDays: 0, skipStarred: true }, lastRunAt: r.lastRunAt ?? null, lastArchivedCount: r.lastArchivedCount || 0 })

  const loadAutoArchive = () => {
    postJSON('/archived-sessions/auto-archive/settings', {})
      .then(applyAa)
      .catch(() => {})
  }

  const updateAutoArchive = (patch) => {
    if (aaBusy) return
    setAaBusy(true)
    postJSON('/archived-sessions/auto-archive/settings', patch)
      .then((r) => { setAaBusy(false); applyAa(r); showToast('已更新自动归档策略') })
      .catch((e) => { setAaBusy(false); setError(String((e && e.message) || e)) })
  }

  const runAutoArchive = () => {
    if (aaBusy) return
    setAaBusy(true)
    postJSON('/archived-sessions/auto-archive/run', {})
      .then((r) => {
        setAaBusy(false)
        applyAa(r)
        const n = r.archived || 0
        if (r.skipped === 'disabled') showToast('自动归档未启用')
        else { showToast(`已自动归档 ${n} 个会话`); if (n > 0) refresh() }
      })
      .catch((e) => { setAaBusy(false); setError(String((e && e.message) || e)) })
  }

  const restoreTrash = (sid) => {
    if (trashBusy) return
    setTrashBusy(sid)
    postJSON('/archived-sessions/trash/restore', { sessionId: sid })
      .then((r) => {
        setTrashBusy(null)
        showToast(r && r.workspaceGone ? '已恢复会话（原工作区已删除，会话暂归「未分组」）' : '已恢复会话')
        loadTrash()
        refresh()
      })
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
    if (!canMove.available) { setError(canMove.reason || '当前环境不支持跨工作区移动'); return }
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
        // 会话被 DSH 占用（活跃会话 / 未关闭的会话）：服务端已登记排队，等它
        // 释放（session/disposed）或下次启动时自动完成。不要谎报"已移动"。
        if (r && r.queued) {
          showToast(r.notes && r.notes.length ? r.notes.join(' ') : '会话正被 DSH 打开，已排队待移动。', 'err')
          setRetry(null)
          refresh()
          return
        }
        showToast(`已把「${it.title || it.sessionId}」移到 ${r.workspaceTitle || targetPath}`)
        // 非致命提示（如源目录仍有旧代日志未自动清理）：错误样式 + 停留更久，
        // 让用户来得及读完再去决定怎么处理。
        if (Array.isArray(r.notes) && r.notes.length > 0) showToast(r.notes.join(' '), 'err')
        // 移动只改 workspacePath/workspaceTitle：本地替换该行，不整表 refresh。
        setSessions((s) => s && s.map((x) => (x.sessionId === it.sessionId
          ? { ...x, workspacePath: r.workspacePath || targetPath, workspaceTitle: r.workspaceTitle || targetPath }
          : x)))
        setRetry(null)
      })
      .catch((e) => {
        setBusy(null)
        setError(String((e && e.message) || e))
        // 会话被 DSH 占用写权限：切走会话后原地重试即可，不必重新选目标。
        setRetry(e && e.code === BUSY_CODE ? { run: () => doMove(it) } : null)
      })
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

  // issue #7：批量移动到同一个目标工作区。失败逐条回报，不中断其余会话。
  // 传入 ids 时只搬这些（用于「重试失败的会话」），否则搬当前选中。
  const doBatchMove = (retryIds) => {
    const ids = (Array.isArray(retryIds) && retryIds.length) ? retryIds : selIds
    if (!ids.length || busy) return
    if (!canMove.available) { setError(canMove.reason || '当前环境不支持跨工作区移动'); return }
    const targetPath = moveMode === 'new' ? newPath.trim() : wsPath(targetWs)
    if (!targetPath) { setError('请选择已有工作区或输入新的目标目录路径'); return }
    setBusy('__batch__')
    setError(null)
    setRetry(null)
    postJSON('/archived-sessions/move-many', { sessionIds: ids, targetPath })
      .then((r) => {
        setBusy(null)
        setBatchMoveOpen(false)
        setMoveMode('existing')
        setNewPath('')
        const moved = (r && r.moved) || 0
        const failed = (r && Array.isArray(r.failed)) ? r.failed : []
        const queued = (r && Array.isArray(r.queued)) ? r.queued : []
        if (queued.length) {
          // 活跃/被占用的会话：服务端已排队，下次重启 DSH 时自动完成。
          showToast(`${queued.length} 个会话已排队（正被 DSH 打开），重启 DSH 后自动完成；请先别打开它们。`, 'err')
        }
        if (failed.length) {
          // 短 ID 列表 + 首个失败原因：长 UUID 全列出来不可读，原因只给第一条
          // （通常同批失败同因），完整原因仍可在控制台网络面板查到。
          const firstReason = failed[0] && failed[0].error ? `，首个原因：${failed[0].error.split('\n')[0]}` : ''
          setError(`已移动 ${moved} 个会话，${failed.length} 个失败（${failed.map((f) => shortId(f.sessionId)).join('、')}）${firstReason}`)
          // 被 DSH 占用写权限的那几个：切走会话后重试仍有戏，只重投这几条。
          const busyIds = failed.filter((f) => f.code === BUSY_CODE).map((f) => f.sessionId)
          setRetry(busyIds.length ? { run: () => doBatchMove(busyIds) } : null)
        } else if (moved > 0) {
          showToast(`已把 ${moved} 个会话移到 ${targetPath}`)
          setRetry(null)
        } else {
          setRetry(null)
        }
        clearSel()
        refresh()
      })
      .catch((e) => {
        setBusy(null)
        setError(String((e && e.message) || e))
        setRetry(e && e.code === BUSY_CODE ? { run: () => doBatchMove(ids) } : null)
      })
  }

  const openMoveFor = (it) => {
    if (!canMove.available) { setError(canMove.reason || '当前环境不支持跨工作区移动'); return }
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
            {items.map(([id, label]) => {
              const blocked = id === 'move' && !canMove.available
              return (
              <button
                key={id}
                type="button"
                role="menuitem"
                className={'more-item' + (id === 'delete' ? ' more-item-danger' : '')}
                disabled={blocked}
                title={blocked ? canMove.reason : undefined}
                onClick={() => runMenu(id, it)}
              >{label}</button>
              )
            })}
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
        {capabilities && capabilities.buildStamp
          ? <span className="archv-stamp" title={capabilities.buildStamp} onClick={() => navigator.clipboard && navigator.clipboard.writeText(capabilities.buildStamp).catch(() => {})}>{capabilities.buildStamp}</span>
          : null}
        {sessions !== null && <span className="archv-count" aria-label={`${sessions.length} 个会话`}>{sessions.length}</span>}
      </div>
      <p className="archv-sub">
        统一管理全部会话：归档 / 恢复 / 移动到其他工作区 / 会话详情 / 批量操作，删除会先进入回收站，可在回收站内恢复或彻底清理。
      </p>
      {error && (
        <div className="archv-err" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="archv-errretry"
            title={retry ? '把刚才失败的操作原样再做一次（例如先切走被占用的会话后重试）' : '重新加载会话列表'}
            onClick={() => {
              const run = retry && retry.run
              setRetry(null)
              if (run) run(); else refresh()
            }}
          >重试</button>
        </div>
      )}
      {sessions === null ? (
        <div className="archv-skel" aria-label="加载中">
          {[0, 1, 2].map((i) => <div key={i} className="archv-skel-card" />)}
        </div>
      ) : (
        <>
          <div className={'sess-fwrap' + (moreOpen ? ' sess-fmore-open' : '') + (filter === 'starred' || filter === 'empty' || filter === 'trash' ? ' sess-fsec-on' : '')}>
            <div className="sess-filter" role="tablist" aria-label="会话筛选">
              <button type="button" role="tab" aria-selected={filter === 'all'} className={'sess-fbtn' + (filter === 'all' ? ' sess-fbtn-on' : '')} onClick={() => { setFilter('all'); clearSel(); setConfirmBatch(false) }}>全部 ({sessions.length})</button>
              <button type="button" role="tab" aria-selected={filter === 'active'} className={'sess-fbtn' + (filter === 'active' ? ' sess-fbtn-on' : '')} onClick={() => { setFilter('active'); clearSel(); setConfirmBatch(false) }}>活动 ({activeList.length})</button>
              <button type="button" role="tab" aria-selected={filter === 'archived'} className={'sess-fbtn' + (filter === 'archived' ? ' sess-fbtn-on' : '')} onClick={() => { setFilter('archived'); clearSel(); setConfirmBatch(false) }}>已归档 ({archivedList.length})</button>
              <span className="sess-fmore" role="tablist" aria-label="更多会话筛选">
                <button type="button" role="tab" aria-selected={filter === 'starred'} className={'sess-fbtn' + (filter === 'starred' ? ' sess-fbtn-on' : '')} onClick={() => { setFilter('starred'); clearSel(); setConfirmBatch(false) }}>已收藏 ({starredList.length})</button>
                <button type="button" role="tab" aria-selected={filter === 'empty'} className={'sess-fbtn' + (filter === 'empty' ? ' sess-fbtn-on' : '')} onClick={() => { setFilter('empty'); clearSel(); setConfirmBatch(false) }}>空白 ({emptyList.length})</button>
                <button type="button" role="tab" aria-selected={filter === 'trash'} className={'sess-fbtn' + (filter === 'trash' ? ' sess-fbtn-on' : '')} onClick={() => { setFilter('trash'); clearSel(); setConfirmBatch(false) }}>回收站 ({trash.length})</button>
              </span>
              <button type="button" className="sess-farrow" aria-expanded={moreOpen} aria-label={moreOpen ? '收起更多筛选' : '展开更多筛选'} title={moreOpen ? '收起更多筛选' : '展开更多筛选（已收藏 / 空白 / 回收站）'} onClick={() => setMoreOpen(!moreOpen)}>
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            </div>
          </div>

          {/* 维护栏是面板级工具，与当前查看哪一组会话无关，故所有视图都显示。 */}
          <div className="maint-bar">
              <button type="button" className="archv-btn" aria-expanded={storageOpen} onClick={() => { const next = !storageOpen; setStorageOpen(next); if (next && (!storage || storageDirty.current) && !storageBusy) loadStorage() }}>
                存储占用{storage ? ` · ${fmtBytes(storage.totalBytes) || '0 B'}` : ''}
              </button>
              <button type="button" className={'archv-btn' + (aa.settings.inactiveDays ? ' archv-go' : '')} aria-expanded={aaOpen} onClick={() => setAaOpen(!aaOpen)}>
                自动归档{aa.settings.inactiveDays ? `：${aa.settings.inactiveDays} 天未活跃` : '：未启用'}
              </button>
              {aa.lastRunAt ? <span className="maint-note">上次检查 {fmtDate(aa.lastRunAt)}，归档 {aa.lastArchivedCount} 个</span> : <span className="maint-note">尚未检查</span>}
          </div>
          {aaOpen && (
            <div className="mv-sheet" aria-label="自动归档设置">
              <div className="mv-sheet-head">
                <h3 className="mv-sheet-title">自动归档</h3>
                <button type="button" className="mv-sheet-close" aria-label="关闭" onClick={() => setAaOpen(false)}>×</button>
              </div>
              <div className="mv-field">
                <label className="mv-field-label" htmlFor="dsm-aa-days">将多久未活跃的会话自动归档</label>
                <select id="dsm-aa-days" value={aa.settings.inactiveDays} disabled={aaBusy} onChange={(e) => updateAutoArchive({ inactiveDays: Number(e.target.value) })}>
                  <option value="0">不自动归档</option>
                  <option value="30">30 天未活跃</option>
                  <option value="60">60 天未活跃</option>
                  <option value="90">90 天未活跃</option>
                </select>
              </div>
              <label className="aa-check">
                <input type="checkbox" checked={aa.settings.skipStarred !== false} disabled={aaBusy} onChange={(e) => updateAutoArchive({ skipStarred: e.target.checked })} />
                跳过已收藏的会话
              </label>
              <div className="mv-foot">
                <button type="button" className="archv-btn" disabled={aaBusy || !aa.settings.inactiveDays} onClick={runAutoArchive}>{aaBusy ? '检查中…' : '立即检查'}</button>
              </div>
              <div className="dtl-note">
                自动归档只是把会话收进「已归档」，不删除任何数据，随时可恢复。当前正在使用的会话永远不会被自动归档。检查在打开本面板时触发，每天最多一次。
              </div>
            </div>
          )}
          {storageOpen && (
            <div className="mv-sheet" aria-label="存储占用">
              <div className="mv-sheet-head">
                <h3 className="mv-sheet-title">存储占用</h3>
                <div className="mv-sheet-actions">
                  <button type="button" className="archv-btn" disabled={storageBusy} onClick={loadStorage}>{storageBusy ? '统计中…' : '重新统计'}</button>
                  <button type="button" className="mv-sheet-close" aria-label="关闭" onClick={() => setStorageOpen(false)}>×</button>
                </div>
              </div>
              {storageError ? (
                <div className="archv-err" role="alert">
                  <span>{storageError}</span>
                  <button type="button" className="archv-errretry" onClick={loadStorage}>重试</button>
                </div>
              ) : !storage ? (
                <div className="archv-empty">统计中…</div>
              ) : storage.sessionCount === 0 ? (
                <div className="archv-empty">暂无会话，没有可统计的存储占用。</div>
              ) : (
                <>
                  <div className="dsm-storage-sum">
                    共 {fmtBytes(storage.totalBytes) || '0 B'} · {storage.sessionCount} 个会话{storage.unknownSessions ? ` · ${storage.unknownSessions} 个大小未知` : ''}
                  </div>
                  <div className="dsm-storage-list">
                    {storage.workspaces.map((w) => (
                      <div className="dsm-storage-row" key={w.key}>
                        <span className="dsm-storage-name" title={w.path || '未分组'}>{w.title || (w.path ? pathName(w.path) : '未分组')}</span>
                        <span className="dsm-storage-bar" aria-hidden="true"><span className="dsm-storage-fill" style={{ width: `${Math.round((w.share || 0) * 100)}%` }} /></span>
                        <span className="dsm-storage-size">{fmtBytes(w.bytes) || '—'}</span>
                        <span className="dsm-storage-count">{w.sessions} 个</span>
                      </div>
                    ))}
                  </div>
                  {storage.top.length > 0 && (
                    <div className="dtl-sec">
                      <div className="dtl-sec-t">占用最大的会话</div>
                      <div className="dsm-storage-list">
                        {storage.top.map((s) => (
                          <div className="dsm-storage-row" key={s.sessionId}>
                            <span className="dsm-storage-name" title={s.sessionId}>{s.title || s.sessionId}</span>
                            <span className="dsm-storage-size">{fmtBytes(s.sizeBytes) || '—'}</span>
                            <span className="dsm-storage-count">{s.workspaceTitle || (s.workspacePath ? pathName(s.workspacePath) : '未分组')}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="dtl-note">统计的是会话日志文件的磁盘占用（压缩后的实际大小），只读，不修改任何数据。</div>
                </>
              )}
            </div>
          )}
          {showSessionList && (
            <>
              <div className="sess-tools sess-tools-4" aria-label="查找和整理会话">
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
                <div className="sess-field">
                  <label htmlFor="dsm-group">分组</label>
                  <select id="dsm-group" value={groupByLineage ? 'lineage' : 'flat'} onChange={(e) => setGroupByLineage(e.target.value === 'lineage')} title="血缘分组：子代理折叠在父会话下；平铺：与 DSH 原生一致，全部并列">
                    <option value="lineage">血缘（子代理折叠）</option>
                    <option value="flat">平铺（全部并列）</option>
                  </select>
                </div>
              </div>
              <div className="sess-results" role="status">
                {/* 一句话说清现状：有子代理折叠时，折叠数取代「共 X 个」尾巴
                    出现在同一句里；没有折叠时维持「显示 N 个，共 M 个」。 */}
                <span className="sess-results-main">
                  显示 {topList.length} 个会话
                  {foldedCount
                    ? `，另有 ${foldedCount} 个子代理折叠在父会话下`
                    : query || workspaceFilter !== 'all'
                      ? `，共 ${filter === 'archived' ? archivedList.length : filter === 'active' ? activeList.length : filter === 'starred' ? starredList.length : filter === 'empty' ? emptyList.length : sessions.length} 个`
                      : (topList.length !== list.length ? `，共 ${list.length} 个` : '')}
                </span>
              </div>
            </>
          )}

          {showSessionList && list.length > 0 && (
            <div className={'sess-batch' + (selIds.length > 0 ? ' sess-batch-pin' : '')}>
              <span className="sess-btntext">{selIds.length ? `已选 ${selIds.length} 项` : (filter === 'archived' ? `共 ${archivedList.length} 个归档会话` : filter === 'starred' ? `共 ${starredList.length} 个收藏会话` : `共 ${sessions.length} 个会话（活动 ${activeList.length} / 已归档 ${archivedList.length}）`)}</span>
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
                  {canMove.available && (
                    <button
                      type="button"
                      className="archv-btn"
                      disabled={busy !== null}
                      aria-expanded={batchMoveOpen}
                      onClick={() => setBatchMoveOpen(!batchMoveOpen)}
                    >
                      移动所选…
                    </button>
                  )}
                  <button type="button" className="archv-btn" onClick={clearSel}>取消选择</button>
                </>
              )}
              {selIds.length > 0 && batchMoveOpen && canMove.available && (
                <div className="mv-sheet" role="region" aria-label="批量移动到工作区">
                  <div className="mv-sheet-head">
                    <h3 className="mv-sheet-title">批量移动 {selIds.length} 个会话</h3>
                    <button type="button" className="mv-sheet-close" aria-label="关闭" onClick={() => setBatchMoveOpen(false)}>×</button>
                  </div>
                  <div className="mv-seg" role="tablist">
                    <button type="button" role="tab" aria-selected={moveMode === 'existing'} className={'mv-segbtn' + (moveMode === 'existing' ? ' mv-segbtn-on' : '')} onClick={() => setMoveMode('existing')}>已有工作区</button>
                    <button type="button" role="tab" aria-selected={moveMode === 'new'} className={'mv-segbtn' + (moveMode === 'new' ? ' mv-segbtn-on' : '')} onClick={() => setMoveMode('new')}>新建目录</button>
                  </div>
                  {moveMode === 'existing' ? (
                    <div className="mv-field">
                      <label className="mv-field-label" htmlFor="mv-batch-ws">目标工作区</label>
                      <select id="mv-batch-ws" value={targetWs} onChange={(e) => setTargetWs(e.target.value)}>
                        {workspaces.length === 0 && <option value="">（暂无工作区）</option>}
                        {workspaces.map((w) => (
                          <option key={w.workspaceId} value={w.workspaceId}>{w.title} · {w.path}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="mv-field">
                      <label className="mv-field-label" htmlFor="mv-batch-path">新工作区目录路径</label>
                      <div className="mv-browse-row">
                        <input
                          id="mv-batch-path"
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
                    <button type="button" className="archv-btn" onClick={() => setBatchMoveOpen(false)}>取消</button>
                    <button type="button" className="archv-btn archv-go" disabled={busy !== null} onClick={() => doBatchMove()}>
                      {busy === '__batch__' && <span className="archv-spin" aria-hidden="true" />}确认移动
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {showSessionList && list.length === 0 ? (
            <div className="archv-empty">{query || workspaceFilter !== 'all' ? '没有匹配的会话。请调整搜索词或工作区筛选。' : filter === 'archived' ? '目前没有归档会话。在“全部”里选中会话点“归档”即可收纳进来。' : filter === 'active' ? '目前没有活动会话。' : filter === 'starred' ? '还没有收藏的会话。点击会话左侧的星标即可收藏。' : filter === 'empty' ? '没有空白会话。新开会话还没产生内容时会归到这里，可在侧栏用「纯净视图」把它们一并折叠。' : '暂无可管理的会话。'}</div>
          ) : showSessionList ? (
            <div className="archv-list" role="list">
              {topList.map((it) => {
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
                      <button
                        type="button"
                        className={'archv-star' + (it.starred ? ' archv-star-on' : '')}
                        aria-pressed={!!it.starred}
                        aria-label={(it.starred ? '取消收藏 ' : '收藏 ') + (it.title || it.sessionId)}
                        title={it.starred ? '取消收藏' : '收藏'}
                        onClick={(e) => { e.stopPropagation(); toggleStar(it) }}
                      >
                        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M12 2.5l2.9 5.9 6.6.9-4.8 4.6 1.2 6.5-5.9-3.1-5.9 3.1 1.2-6.5L2.5 9.3l6.6-.9z" /></svg>
                      </button>
                      <div className="archv-body">
                        <div className="archv-main">
                          <div className="archv-titlerow">
                            <span className="archv-name" title={it.title || ''}>{it.title || '(无标题)'}</span>
                            {branchBadge(it.sessionId)}
                            {emptyBadge(it.sessionId)}
                            {kidsBadge(it.sessionId)}
                            <span className="archv-id" title={it.sessionId}>{shortId(it.sessionId)}</span>
                          </div>
                          <div className="archv-meta">
                            {it.archived ? <span className="archv-wtag archv-wgone">已归档</span> : <span className="archv-wtag archv-active">活动</span>}
                            {workspaceTag(it)}
                            {date && <><span className="archv-dot">·</span><span className="archv-date">{date}</span></>}
                          </div>
                        </div>
                        {rowMenu(it)}
                      </div>
                    </div>
                    {groupByLineage && renderKids(it.sessionId, 0)}
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
                              <div className="dtl-sec">
                                <div className="dtl-sec-t">导出</div>
                                <div className="dtl-export">
                                  <a
                                    className="archv-btn"
                                    href={`/api/session.export?sessionId=${encodeURIComponent(it.sessionId)}&includeDescendants=true`}
                                    onClick={(e) => e.stopPropagation()}
                                    style={zipOk ? undefined : { pointerEvents: 'none', opacity: 0.45 }}
                                    title={zipOk ? '含子会话与附件，由 DSH 提供' : '当前持久化后端不支持原始日志导出'}
                                  >下载原始日志 (ZIP)</a>
                                  <button type="button" className="archv-btn" disabled={mdBusy === it.sessionId} onClick={() => exportMarkdown(it)}>{mdBusy === it.sessionId ? '生成中…' : '导出 Markdown'}</button>
                                </div>
                                <div className="dtl-note">ZIP 含子会话与附件，由 DSH 提供 · Markdown 为本插件生成的可读对话记录</div>
                              </div>
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
      {toast && <div className={'archv-status' + (toast.kind === 'err' ? ' archv-status-err' : '') + (String(toast.msg).length > 28 ? ' archv-status-long' : '')} role="status" title="点击关闭" onClick={() => setToast(null)}>{toast.msg}</div>}
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
          <div className="sess-field"><label>永久清理</label><button type="button" className="archv-btn archv-del" disabled={trashBusy !== null || !trash.length || !canPurge.available} aria-disabled={!canPurge.available} title={!canPurge.available ? canPurge.reason : '物理删除这些日志，释放磁盘空间'} onClick={() => setPurgeTarget('__all')}>清空回收站</button></div>
        </div>
        {!canPurge.available && (
          <div className="archv-empty" role="status">
            {canPurge.reason}。回收站条目会一直保留，可随时恢复；当前 DSH 版本下移入回收站<b>不会释放磁盘空间</b>，会话日志仍完整保留在原工作区目录。
          </div>
        )}
        <div className="dtl-note">回收站是软删除：日志仍留在原工作区目录，「彻底删除」才是真正释放磁盘空间的一步（当前版本未支持时会保持禁用）。</div>
        {trashCheck && <div className={trashCheck.missing ? 'archv-err' : 'archv-empty'} role="status">校验完成：{trashCheck.healthy} 条正常，{trashCheck.missing} 条日志缺失，{trashCheck.unverified || 0} 条无法直接核验。</div>}
        {trash.length === 0 ? (
          <div className="dsm-trash-empty">回收站为空。删除的会话会先进入这里，可恢复或彻底删除。</div>
        ) : (
          <div className="dsm-trash-list">
            {trash.map((t) => (
              <div key={t.sessionId} className="dsm-trash-row">
                <span className="dsm-trash-name" title={t.sessionId}>{t.title || t.sessionId}</span>
                <span className="dsm-trash-date">{fmtDate(t.deletedAt)}</span>
                <span className="dsm-trash-actions">
                  <button type="button" className="archv-btn" disabled={trashBusy !== null || !canRestoreTrash.available} title={!canRestoreTrash.available ? canRestoreTrash.reason : '恢复到删除前的位置与归档状态'} onClick={() => restoreTrash(t.sessionId)}>恢复</button>
                  <button type="button" className="archv-btn archv-del" disabled={trashBusy !== null || !canPurge.available} title={!canPurge.available ? canPurge.reason : undefined} onClick={() => setPurgeTarget(t.sessionId)}>彻底删除</button>
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
            <p className="dlg-text">此操作会物理删除日志并释放磁盘空间，无法恢复。归档、筛选和重新安装插件都不能找回这些数据。</p>
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
/* ---- 血缘分层披露（issue #6）：行内徽标 ---- */
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
/* 徽标/标签统一显隐（对齐「子代理折叠」的节奏）：默认一律隐藏，维持 DSH
   原生行外观；行被选中（dsm-row-active，paint 按 activeId 刷新）、鼠标悬
   停、键盘聚焦或已展开子代理列表（dsm-row-open）时才出现。display 切换
   不占位：隐藏时标题拿全宽，悬停时才让位给徽标。 */
[role="treeitem"]>.dsm-kids-badge,[role="treeitem"]>.dsm-tag{display:none}
[role="treeitem"]:hover>.dsm-kids-badge,[role="treeitem"]:hover>.dsm-tag,
[role="treeitem"].dsm-row-active>.dsm-kids-badge,[role="treeitem"].dsm-row-active>.dsm-tag,
[role="treeitem"].dsm-row-open>.dsm-kids-badge,
[role="treeitem"]:focus-within>.dsm-kids-badge,[role="treeitem"]:focus-within>.dsm-tag{display:inline-flex}
@media (prefers-reduced-motion:reduce){.dsm-row-sub{transition:none}.dsm-row-flash{transition:none}}
@media (max-width:640px){.dsm-storage-bar{display:none}.dsm-storage-count{max-width:40%}}
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
let dsmCapabilities = null
// 血缘分层披露（issue #6）：服务端血缘分类 + 本地视图状态。
// dsmLineage: id → { origin, parentSession, delegationDepth, empty }
const dsmLineage = new Map()
// 空白会话一律隐藏（原「纯净视图」的默认行为固化为唯一行为，开关已于
// 0.1.3 移除：上游本就不把空白会话渲染进侧栏，开关没有可服务的场景）。
// 只隐藏，永不删除；子代理行按 DSH 设计不进侧栏（ui-subagent README 明文
// "omitted from the ordinary sidebar"），收纳由上游完成，插件侧不做。
async function dsmLoadCapabilities() {
  try { dsmCapabilities = await postJSON('/archived-sessions/capabilities', {}) } catch (e) { /* unknown stays safely unavailable */ }
  return dsmCapabilities
}
function dsmActionCapability(name, legacy) {
  const source = dsmCapabilities && dsmCapabilities.actions
  return source ? (source[name] || (legacy && source[legacy]) || null) : null
}
async function dsmLoadTrashIds() {
  try {
    const r = await postJSON('/archived-sessions/sidebar-state', {})
    dsmTrashIds = new Set(((r && r.trashedSessionIds) || []).map(String))
    dsmServerPurgedIds = new Set(((r && r.purgedSessionIds) || []).map(String))
    // 服务器已确认的乐观标记随即清除；未被确认的标记最多存活到下次刷新，
    // 绝不永久压住后来同 id 的新会话。
    for (const id of [...dsmPendingPurged]) {
      if (dsmServerPurgedIds.has(id)) dsmPendingPurged.delete(id)
    }
    dsmAuthoritativeTitles = new Map(Object.entries((r && r.titles) || {}).map(([id, title]) => [String(id), String(title)]))
    dsmLineage.clear()
    for (const [id, info] of Object.entries((r && r.lineage) || {})) {
      if (info && typeof info === 'object') dsmLineage.set(String(id), info)
    }
    if (dsmRepaintDots) dsmRepaintDots()
  } catch (e) { /* keep last known set */ }
  return dsmTrashIds
}

// Permanently-hidden set: sessions the user hard-purged from the 回收站. The
// SERVER is the single source of truth: sidebar-state only reports tombstones
// whose ids are NOT currently present, so a same-id session recreated later is
// unhidden automatically (the tombstone must never permanently suppress a new
// session). dsmPendingPurged only carries this tab's optimistic marks until
// the next server fetch acks them — no localStorage persistence, so a stale
// tombstone can never outlive its server record. (dsmServerPurgedIds is
// declared with the trash-state group above.)
const dsmPendingPurged = new Set()
function dsmLoadPurged() {
  return new Set([...dsmServerPurgedIds, ...dsmPendingPurged])
}
function dsmMarkPurged(ids) {
  ids.forEach((id) => dsmPendingPurged.add(String(id)))
  if (dsmRepaintDots) dsmRepaintDots()
}

// ---- Sidebar injection adapter (versioned, safe-degrading) ----------------
// 每一处脆弱的 DOM / React fiber 识别都收敛到这个 adapter：识别规则集中、
// 可版本化（上游改版时 bump version 并只改这里），并且**可安全降级**——
// 识别连续落空说明上游内部结构变了，此时 adapter 自动停用全部注入，
// 绝不把半残行为强加到官方侧栏上（拖拽 / 标题同步 / 状态圆点一并停用）。
const SIDEBAR_ADAPTER_VERSION = 3
const SIDEBAR_ADAPTER_MAX_MISSES = 200

// 侧栏注入的整场清退：移除我们加到 DSH 侧栏 DOM 里的所有节点（状态圆点 /
// 子代理徽标 / 就地子列表 / fork·空白 tag），并还原被隐藏的空分组。
// 两个调用时机：adapter 因上游结构连续未识别而停用（此刻残留的是「半残」
// 节点，必须整体撤下而不是留在官方侧栏上错位显示），以及插件 effect 卸载。
// 只按自己的 data-dsm-* 标记删除，绝不碰 DSH 自己的节点。
function dsmTeardownSidebarAug() {
  if (typeof document === 'undefined') return
  const selectors = ['[data-dsm-dot]', '[data-dsm-kids]', '[data-dsm-subs]', '[data-dsm-tag]']
  for (const sel of selectors) {
    try { document.querySelectorAll(sel).forEach((el) => el.remove()) } catch (e) { /* best-effort */ }
  }
  try {
    document.querySelectorAll('[data-dsm-group-hidden]').forEach((owner) => {
      owner.style.display = owner.dataset.dsmPrevDisplay || ''
      owner.removeAttribute('data-dsm-group-hidden')
      delete owner.dataset.dsmPrevDisplay
    })
  } catch (e) { /* best-effort */ }
}

function createSidebarAdapter() {
  let disabled = false
  let misses = 0
  const findFiber = (el) => {
    const k = Object.keys(el).find((kk) => kk.startsWith('__reactFiber') || kk.startsWith('__reactInternalInstance'))
    return k ? el[k] : null
  }
  // 识别一行侧栏树节点：返回 { node, group }（会话行 / 工作区标题行）。
  // 两种都没有 = 识别落空，累计到阈值即整体停用。
  const recognize = (row) => {
    const out = { node: null, group: null }
    if (disabled || !row || typeof row !== 'object') return out
    let f = findFiber(row)
    let guard = 0
    while (f && guard++ < 300) {
      const props = f.memoizedProps
      if (props && props.node && typeof props.node === 'object') out.node = props.node
      // DSH 的会话行接收 `node`，工作区标题行（ProjectRowItem）接收 `group`。
      if (props && props.group && typeof props.group === 'object') out.group = props.group
      f = f.return
    }
    if (!out.node && !out.group) {
      if (++misses >= SIDEBAR_ADAPTER_MAX_MISSES && !disabled) {
        disabled = true
        // 停用 = 承认对上游结构失去认知：此刻侧栏上残留的注入节点已经失去
        // 幂等维护（paint 不再跑），必须整体撤下，绝不能把半残行为留在
        // 官方 UI 上。
        dsmTeardownSidebarAug()
        try { console.warn('[dsh-sessions-manager] 侧栏注入 adapter v' + SIDEBAR_ADAPTER_VERSION + ' 已停用：未识别到已知的 DSH 侧栏节点结构（上游可能已改版）') } catch (e) {}
      }
    } else if (misses > 0) {
      misses = 0
    }
    return out
  }
  return {
    version: SIDEBAR_ADAPTER_VERSION,
    get disabled() { return disabled },
    findFiber,
    recognize,
  }
}
const sidebarAdapter = createSidebarAdapter()

// apply(ctx) 可能被再次调用（HMR / profile 重载）：用模块级守卫保证观察器、
// 定时器与 document 级监听器只装一份，绝不叠加（叠加会造成重复提示与后台 CPU 增长）。
let sidebarMenuAugInstalled = false
function installSidebarSessionMenuAug() {
  if (typeof document === 'undefined') return
  if (sidebarMenuAugInstalled) return
  sidebarMenuAugInstalled = true
  const AUG = 'data-dsm-aug'
  let styleInjected = false
  let activeSubClose = null
  let hoverTimer = null

  // Walk the React fiber chain from the portalled menu element up to the
  // SessionNodeItem component, which carries `node.id` (the session id).
  // Portalled menus are one-off surfaces: fiber walking here does NOT count
  // toward the row adapter's miss budget (a non-session menu is normal, not a
  // sign of upstream drift).
  const sessionInfoFromMenu = (menuEl) => {
    let f = sidebarAdapter.findFiber(menuEl)
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
    const text = String(msg == null ? '' : msg)
    t.className = 'dsm-toast' + (text.length > 28 ? ' dsm-toast-long' : '')
    t.textContent = text
    t.title = '点击关闭'
    t.setAttribute('role', 'status')
    document.body.appendChild(t)
    // 停留时长按字数给（固定 2.6s 读不完排队/失败类文案），并允许点击提前关闭。
    let killTimer = null
    const kill = () => { if (killTimer) clearTimeout(killTimer); t.remove() }
    killTimer = setTimeout(kill, toastDurationFor(text))
    t.addEventListener('click', kill)
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
    // Fixed-position card: once the async content renders it can be tall or
    // wide enough to hang past the viewport edges, so re-clamp both anchors
    // against the rendered size.
    const placeSub = () => {
      sub.style.top = Math.max(8, Math.min(Math.round(r.top - 4), window.innerHeight - sub.offsetHeight - 8)) + 'px'
      sub.style.left = Math.max(8, Math.min(Math.round(r.right + 10), window.innerWidth - sub.offsetWidth - 8)) + 'px'
    }
    document.body.appendChild(sub)
    placeSub()
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
      if (!items.length) { sub.innerHTML = '<div class="dsm-sub-empty">（暂无可用工作区）</div>'; placeSub(); return }
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
            .then((r) => {
              // 会话被 DSH 打开（活跃/未关闭）时服务端只登记排队：磁盘与工作区分组都没动。
              // 这条路径原先无条件报「移动成功」——2026-09-10 用户报的「说移动成功但还在
              // 原工作区」就是这个。必须按服务端结果如实说明。
              const label = w.title || pathName(w.path) || '目标工作区'
              if (r && r.queued) {
                toast(r.notes && r.notes.length ? r.notes.join(' ') : '会话正被 DSH 打开，已排队待移动；重启 DSH 后会自动完成（请先别打开它）。')
                return
              }
              toast(r && r.already ? `已在「${label}」` : `已移到「${label}」`)
            })
            .catch((ee) => toast('移动失败：' + String((ee && ee.message) || ee)))
        })
        sub.appendChild(b)
      })
      placeSub()
    }).catch((e) => {
      sub.innerHTML = '<div class="dsm-sub-err">' + escapeHtml(String((e && e.message) || e)) + '</div>'
      placeSub()
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
    const moveCapability = dsmActionCapability('relocateSession') || dsmActionCapability('move')
    if (!moveCapability || !moveCapability.available) {
      move.btn.disabled = true
      move.btn.title = (moveCapability && moveCapability.reason) || '正在检查当前版本的移动能力'
    }
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
    // DSH's portalled Menu clamped its position using the height it measured
    // before this shim injected rows, so the grown card can hang past the
    // viewport bottom and cover the sidebar foot. Reuse the host's own
    // placement by firing the resize event it listens for while open.
    window.dispatchEvent(new Event('resize'))
  }

  const seen = new WeakSet()
  const obs = new MutationObserver(() => {
    if (sidebarAdapter.disabled) return
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
//   工作中（黄）       = DSH state 'ongoing'（旧版兼容 'running'）
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
  const rowNode = (row) => sidebarAdapter.recognize(row).node
  const rowId = (row) => { const node = rowNode(row); return node ? node.id : null }
  let curActive = null
  const activeRowId = () => {
    const sel = document.querySelector('[role="treeitem"][aria-selected="true"]')
    return sel ? rowId(sel) : null
  }
  // Dot colors per the user's scheme. We read DSH's REAL session status from the
  // row's own StateDot (its [data-state] attr) and recolor it:
  //   ongoing/running → 黄  工作中
  //   warning  → 琥珀 有追问需用户反馈
  //   done     → 绿  完成后未读（读过则不再显示）
  //   error    → 红  出错/需关注（与 DSH 自带 StateDot 一致）
  //   (manual  → 蓝  手动标记未读，最高优先级)
  const COLOR = {
    manual: 'var(--dsw-alias-state-business-primary)',        // 蓝 手动标记未读
    running: '#EAB308',                                       // 黄 工作中 (DSH running)
    feedback: 'var(--dsw-alias-state-warn-primary, #F59E0B)', // 琥珀 需用户反馈 (DSH warning)
    done: 'var(--dsw-alias-state-success-primary)',           // 绿 完成后未读 (DSH done)
    error: 'var(--dsw-alias-state-error-primary)',            // 红 出错/需关注 (DSH error)
  }
  const manualUnread = dsmLoadManual()
  const titleInitializedRows = new WeakSet()
  // 空分组兜底：DSH 会把「日志已不在原处」的会话重新归到「未分组」组里（删
  // 除后最明显）。我们把行隐藏了，但空组标题会留下来——所以组内所有行都被
  // 隐藏时，把整个分组（含它的标题行）一起隐藏；组内重新出现可见行时自动
  // 还原。只在「组内确实有行」时才判定，避免把正在加载的空组误藏。
  // 原 display 记在 owner 的 dataset 上（见下方 dsmSyncEmptyGroups）。
  function dsmSyncEmptyGroups() {
    let groups = null
    try { groups = document.querySelectorAll('[role="group"]') } catch (e) { return }
    if (!groups || !groups.length) return
    groups.forEach((g) => {
      const items = g.querySelectorAll('[role="treeitem"]')
      if (!items.length) return
      let visible = 0
      items.forEach((it) => { if (it.style.display !== 'none') visible++ })
      // ARIA tree：group 通常嵌在它的标题 treeitem 里，藏标题即藏整组。
      // 原 display 存进 dataset（而非 WeakMap）：清场/还原函数无法遍历
      // WeakMap，dataset 让「谁被我们藏过、原来是什么」随时可查可还原。
      const owner = g.closest('[role="treeitem"]') || g
      if (visible === 0) {
        if (!owner.hasAttribute('data-dsm-group-hidden')) {
          owner.dataset.dsmPrevDisplay = owner.style.display || ''
          owner.setAttribute('data-dsm-group-hidden', '')
        }
        if (owner.style.display !== 'none') owner.style.display = 'none'
      } else if (owner.hasAttribute('data-dsm-group-hidden')) {
        const prev = owner.dataset.dsmPrevDisplay || ''
        if (owner.style.display !== prev) owner.style.display = prev
        owner.removeAttribute('data-dsm-group-hidden')
        delete owner.dataset.dsmPrevDisplay
      }
    })
  }
  const paint = () => {
    if (sidebarAdapter.disabled) return
    // Recompute the active session on every paint so the active row is never
    // shown from a stale `curActive` (the click that changes aria-selected
    // mutates the DOM and triggers paint immediately, before the tick()
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
    // 每次 paint 只聚合一次：父会话 id → 子代理数（O(n)，避免每行重算）。
    const purgedNow = dsmLoadPurged()
    const kidsByParent = (() => {
      const m = new Map()
      for (const [id, info] of dsmLineage.entries()) {
        if (info.origin !== 'subagent' || !info.parentSession) continue
        // 已进回收站 / 已彻底删除的子代理不计数：否则删掉了徽标数字还挂着。
        if ((dsmTrashIds && dsmTrashIds.has(id)) || purgedNow.has(id)) continue
        m.set(info.parentSession, (m.get(info.parentSession) || 0) + 1)
      }
      return m
    })()
    const rows = document.querySelectorAll('[role="treeitem"]')
    // 兜底清理：父行被 React 移除 / 复用后残留的子代理容器立刻摘掉，
    // 避免孤儿容器越堆越多。
    document.querySelectorAll('[data-dsm-subs]').forEach((box) => {
      const pid = box.getAttribute('data-dsm-subs')
      const prev = box.previousElementSibling
      if (!prev || rowId(prev) !== pid) box.remove()
    })
    rows.forEach((row) => {
      const id = rowId(row)
      if (!id) return
      // Trashed sessions belong in 回收站, not the sidebar (DSH would group
      // them under "未分组"). Hide the row entirely and skip its dot. So do
      // hard-purged sessions — they're gone for good and must never resurface
      // (otherwise DSH re-renders the orphan under a "未分组" group).
      const purged = purgedNow
      if ((dsmTrashIds && dsmTrashIds.has(id)) || purged.has(id)) {
        if (row.style.display !== 'none') row.style.display = 'none'
        const d = row.querySelector('[' + DOT + ']'); if (d) d.remove()
        dsmDropSubList(row, id)
        return
      }
      // ---- 血缘分层披露（issue #6）--------------------------------------
      // 优先级：回收站/墓碑隐藏 > 纯净视图隐藏（仅空白行） > 原生显示。
      // 子代理行按 DSH 设计不进侧栏（ui-subagent README 明文）；万一上游
      // 改回渲染，这里只做缩进视觉、绝不隐藏——侧栏没有展开入口，藏了
      // 就再也找不回来。
      const li = dsmLineage.get(id)
      const isSub = !!(li && li.origin === 'subagent')
      const isEmpty = !!(li && li.empty)
      // React 会复用行 DOM：每次先按当前 id 重置血缘视觉，再按需加回。
      // classList 的 add/remove 对已处于目标状态的行是无操作（不触发
      // MutationObserver），徽标节点只允许「缺失才创建」。
      row.classList.remove('dsm-row-sub')
      // 选中行标记：徽标/标签的「选中才显示」靠它驱动（CSS 侧）。
      // toggle 同值时不动 DOM 属性，不会触发 MutationObserver。
      row.classList.toggle('dsm-row-active', id === activeId)
      row.style.removeProperty('--dsm-indent')
      let hideLineage = false
      if (li && isSub) {
        row.classList.add('dsm-row-sub')
        if (getComputedStyle(row).position === 'static') row.style.position = 'relative'
        const depth = Math.max(0, (li.delegationDepth || 1) - 1)
        if (depth > 0) row.style.setProperty('--dsm-indent', String(depth * 10) + 'px')
      } else if (li && isEmpty) {
        // 空白行一律隐藏（原纯净视图行为固化，见 dsmLineage 注释）。
        hideLineage = true
      }
      if (hideLineage) {
        if (row.style.display !== 'none') row.style.display = 'none'
        const d = row.querySelector('[' + DOT + ']'); if (d) d.remove()
        dsmDropSubList(row, id)
        return
      }
      if (row.style.display === 'none') row.style.display = ''
      if (!isEmpty && li && li.parentSession && li.origin !== 'subagent') {
        // fork 分支行：绿「⑂ 分支」chip，点击滚动并高亮父会话行。
        if (!row.querySelector('[data-dsm-tag="fork"]')) {
          const fork = document.createElement('button')
          fork.type = 'button'
          fork.dataset.dsmTag = 'fork'
          fork.className = 'dsm-tag dsm-tag-fork'
          const parentTitle = dsmAuthoritativeTitles.get(li.parentSession)
          fork.textContent = '⑂ 分支'
          fork.title = parentTitle ? '分支于：' + parentTitle : '分支会话（点击查看来源会话）'
          fork.setAttribute('aria-label', fork.title)
          fork.addEventListener('click', (e) => {
            e.stopPropagation(); e.preventDefault()
            const rows = document.querySelectorAll('[role="treeitem"]')
            for (const other of rows) {
              if (rowId(other) === li.parentSession) {
                other.scrollIntoView({ block: 'center', behavior: 'smooth' })
                other.classList.add('dsm-row-flash')
                setTimeout(() => other.classList.remove('dsm-row-flash'), 1200)
                break
              }
            }
          })
          row.appendChild(fork)
        }
      } else {
        const staleFork = row.querySelector('[data-dsm-tag="fork"]')
        if (staleFork) staleFork.remove()
      }
      if (!isEmpty && !isSub) {
        const kids = kidsByParent.get(id)
        const existingKids = row.querySelector('[data-dsm-kids]')
        const open = dsmSubsOpen.has(id)
        // 徽标 DOM 随血缘常驻，显隐交给 CSS（选中 / 悬停 / 键盘聚焦）。已
        // 展开的父行加 dsm-row-open 让徽标常驻可见——否则切走之后就再也
        // 收不回来了。隐藏状态不占位：标题拿全宽，悬停才让位给徽标。
        row.classList.toggle('dsm-row-open', open)
        if (kids) {
          const text = (open ? '▾ ' : '▸ ') + kids + ' 子代理'
          let badge = existingKids
          if (!badge) {
            badge = document.createElement('button')
            badge.type = 'button'
            badge.dataset.dsmKids = ''
            badge.className = 'dsm-kids-badge'
            badge.addEventListener('click', (e) => {
              e.stopPropagation(); e.preventDefault()
              dsmToggleSubs(badge)
            })
            row.appendChild(badge)
          }
          // 父会话 id 存 dataset、每次 paint 刷新：React 复用行 DOM 时旧闭包
          // 里的 id 可能已过期，点击时读 dataset 才不会切错父会话。
          if (badge.dataset.dsmParentId !== id) badge.dataset.dsmParentId = id
          // 同值赋值会替换文本节点、触发 observer——只在变化时写。
          if (badge.textContent !== text) badge.textContent = text
          const label = (open ? '收起' : '展开') + '该会话的 ' + kids + ' 个子代理'
          if (badge.getAttribute('aria-label') !== label) {
            badge.setAttribute('aria-label', label)
            badge.title = label
          }
          if (badge.getAttribute('aria-expanded') !== String(open)) badge.setAttribute('aria-expanded', String(open))
          if (open) dsmSyncSubList(row, id)
          else dsmDropSubList(row, id)
        } else {
          // 没有子代理：徽标与可能残留的子代理容器一并摘掉。
          if (existingKids) existingKids.remove()
          dsmDropSubList(row, id)
        }
      } else {
        row.classList.remove('dsm-row-open')
        const staleKids = row.querySelector('[data-dsm-kids]')
        if (staleKids) staleKids.remove()
      }
      // DSH's cold list baseline can expose a stale header title until the
      // Session is opened. Paint the latest log-folded title from the host
      // authority without materializing the Session or changing its log.
      const authoritativeTitle = dsmAuthoritativeTitles.get(id)
      if (!titleInitializedRows.has(row)) {
        const node = rowNode(row) || {}
        const expected = new Set([node.title, node.displayTitle, node.name].filter((value) => typeof value === 'string'))
        const spans = [...row.children].filter((el) => el.tagName === 'SPAN' && !el.querySelector('[data-state]') && (el.textContent || '').trim())
        const titleEl = spans.find((el) => expected.has((el.textContent || '').trim())) || spans[0]
        if (titleEl) {
          const correction = authoritativeTitleForFirstPaint({
            firstPaint: true,
            rendered: titleEl.textContent || '',
            authoritative: authoritativeTitle || '',
          })
          if (correction) titleEl.textContent = correction
          titleInitializedRows.add(row)
        }
      }
      // Read DSH's REAL session status from the row's own StateDot and recolor
      // it with the user's scheme (we also hide DSH's dot so only ours shows).
      const sd = row.querySelector('[data-state]')
      if (sd) sd.style.display = 'none'
      let dot = row.querySelector('[' + DOT + ']')
      const state = dotStateFor({ manualUnread: manualUnread.has(id), dataState: sd ? sd.getAttribute('data-state') : '', isActive: activeId === id })
      const color = state ? COLOR[state] : null
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
    dsmSyncEmptyGroups()
  }
  dsmRepaintDots = paint
  const paintToast = (msg, kind) => {
    const t = document.createElement('div')
    t.className = 'dsm-toast' + (kind === 'err' ? ' dsm-toast-err' : '')
    t.textContent = msg
    t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:80%;padding:8px 14px;border-radius:8px;background:#2C2C2A;color:#F1EFE8;font-size:12px;line-height:1.5;z-index:9999'
    document.body.appendChild(t)
    setTimeout(() => t.remove(), 4200)
  }
  // ---- 侧栏就地展开子代理（issue #6）------------------------------------
  // DSH 按设计不渲染子代理行（ui-subagent 明文 "omitted from the ordinary
  // sidebar"），所以插件自己把它们在父行下方补渲染出来：点击徽标就地展开，
  // 不需要跳转到任何别处。数据来自 lineage-tree（官方 header 血缘 + live
  // 标记），带短期缓存；删除后整表失效重取。
  const DSM_KEY_SUBS = 'dsm-subs-open-v1'
  const dsmSubsOpen = new Set()
  try { for (const id of JSON.parse(localStorage.getItem(DSM_KEY_SUBS) || '[]')) if (typeof id === 'string') dsmSubsOpen.add(id) } catch (e) {}
  const dsmSaveSubsOpen = () => { try { localStorage.setItem(DSM_KEY_SUBS, JSON.stringify([...dsmSubsOpen])) } catch (e) {} }
  const dsmSubTrees = new Map()
  const SUB_TTL_MS = 15000
  async function dsmFetchSubTree(pid) {
    const cached = dsmSubTrees.get(pid)
    if (cached && Date.now() - cached.ts < SUB_TTL_MS) return cached
    dsmSubTrees.set(pid, { ts: Date.now(), status: 'loading', nodes: (cached && cached.nodes) || [] })
    try {
      const r = await postJSON('/archived-sessions/lineage-tree', { sessionId: pid })
      dsmSubTrees.set(pid, { ts: Date.now(), status: 'ready', nodes: (r && r.nodes) || [] })
    } catch (e) {
      dsmSubTrees.set(pid, { ts: Date.now(), status: 'error', nodes: [], error: String((e && e.message) || e) })
    }
    if (dsmRepaintDots) dsmRepaintDots()
    return dsmSubTrees.get(pid)
  }
  async function dsmSubAction(sid, kind) {
    try {
      await postJSON('/archived-sessions/delete', { sessionId: sid })
      if (kind === 'purge') {
        await postJSON('/archived-sessions/trash/purge', { sessionId: sid })
        dsmMarkPurged([sid])
        paintToast('已彻底删除该子代理')
      } else {
        paintToast('已移入回收站')
      }
      // 乐观剔除：服务端重取是异步的（且 DSH 的内存会话列表可能还挂着刚删掉
      // 的子代理），先把这个 id 从所有已缓存的树里摘掉，立刻重绘，不等网络。
      dsmDropSubagentFromTrees(sid)
      // 后台重取：loading 期间沿用上一步的乐观结果（dsmFetchSubTree 保留旧
      // nodes），新数据到达后再刷新一次，不会闪回「加载中」。
      for (const pid of [...dsmSubTrees.keys()]) dsmFetchSubTree(pid)
      dsmLoadTrashIds()
      if (dsmRepaintDots) dsmRepaintDots()
    } catch (e) { paintToast('操作失败：' + String((e && e.message) || e)) }
  }
  // 从所有缓存的子代理树里递归摘掉一个 id（含它的整棵子树）。
  function dsmDropSubagentFromTrees(sid) {
    const target = String(sid)
    const prune = (nodes) => (nodes || []).filter((n) => String(n.sessionId) !== target).map((n) => ({ ...n, children: prune(n.children) }))
    for (const [pid, rec] of dsmSubTrees) {
      if (!rec || !Array.isArray(rec.nodes)) continue
      dsmSubTrees.set(pid, { ...rec, nodes: prune(rec.nodes) })
    }
  }
  function dsmToggleSubs(badge) {
    const pid = badge && badge.dataset ? badge.dataset.dsmParentId : null
    if (!pid) return
    if (sidebarAdapter.disabled) {
      paintToast('侧栏适配器已停用（上游结构变化），请改从 设置 → 会话管理 查看子代理')
      return
    }
    if (dsmSubsOpen.has(pid)) { dsmSubsOpen.delete(pid); dsmSubTrees.delete(pid) } else { dsmSubsOpen.add(pid) }
    dsmSaveSubsOpen()
    if (dsmRepaintDots) dsmRepaintDots()
  }
  function dsmDropSubList(row, pid) {
    const parent = row.parentNode
    if (!parent) return
    for (const el of parent.children) {
      if (el.getAttribute && el.getAttribute('data-dsm-subs') === pid) { el.remove(); break }
    }
  }
  // 把某父会话的子代理树同步到它下方。全程幂等：容器只在缺失时创建，内容
  // 只在签名变化时重写——否则自己的写入会再次触发 MutationObserver 死循环。
  function dsmSyncSubList(row, pid) {
    const parent = row.parentNode
    if (!parent) return
    const open = dsmSubsOpen.has(pid)
    let box = null
    for (const el of parent.children) {
      if (el.getAttribute && el.getAttribute('data-dsm-subs') === pid) { box = el; break }
    }
    if (!open) { if (box) box.remove(); return }
    const rec = dsmSubTrees.get(pid)
    if (!rec) { dsmFetchSubTree(pid); return }
    if (!box) {
      box = document.createElement('div')
      box.setAttribute('data-dsm-subs', pid)
      box.className = 'dsm-subs'
      parent.insertBefore(box, row.nextSibling)
    } else if (box.nextElementSibling !== row.nextSibling && box.previousElementSibling !== row) {
      // React 重排后容器可能不在原位：搬回父行下方。
      parent.insertBefore(box, row.nextSibling)
    }
    const flat = []
    const walk = (nodes, depth) => { for (const n of nodes || []) { flat.push([n, depth]); if (depth < 4) walk(n.children, depth + 1) } }
    walk(rec.nodes, 0)
    const sig = rec.status + '|' + flat.map(([n, d]) => [n.sessionId, n.title, n.live ? 1 : 0, n.sizeBytes, d].join(':')).join(';')
    if (box.dataset.dsmSig === sig) return
    box.dataset.dsmSig = sig
    box.textContent = ''
    if (rec.status === 'loading' && !flat.length) {
      const p = document.createElement('div'); p.className = 'dsm-sub-note'; p.textContent = '加载子代理…'; box.appendChild(p); return
    }
    if (rec.status === 'error') {
      const p = document.createElement('div'); p.className = 'dsm-sub-note'; p.textContent = '子代理加载失败：' + (rec.error || '未知错误'); box.appendChild(p); return
    }
    if (!flat.length) {
      const p = document.createElement('div'); p.className = 'dsm-sub-note'; p.textContent = '该会话没有子代理'; box.appendChild(p); return
    }
    const canPurgeSub = dsmActionCapability('physicalPurge', 'purge')
    for (const [n, depth] of flat) {
      const r = document.createElement('div')
      r.className = 'dsm-sub-row' + (n.live ? ' dsm-sub-live' : '')
      r.style.paddingLeft = String(14 + depth * 12) + 'px'
      // 整行可点：走官方 sessions.open / openSubagent 打开这个子代理会话。
      // 行内按钮自己 stopPropagation，不会误触发。
      r.title = '打开这个子代理会话'
      r.addEventListener('click', async () => {
        const res = await dsmOpenSessionById(n.sessionId, n.parentSession || pid)
        if (res === 'ok') return
        const msg = openSubagentToast(res, n.title, 'sidebar')
        paintToast(msg.text, msg.kind)
      })
      const name = document.createElement('span')
      name.className = 'dsm-sub-name'
      name.textContent = n.title || (String(n.sessionId).slice(0, 8) + '…')
      name.title = n.sessionId
      r.appendChild(name)
      const meta = document.createElement('span')
      meta.className = 'dsm-sub-meta'
      meta.textContent = n.live ? '运行中' : (fmtBytes(n.sizeBytes) || '已结束')
      r.appendChild(meta)
      const acts = document.createElement('span')
      acts.className = 'dsm-sub-acts'
      const del = document.createElement('button')
      del.type = 'button'
      del.className = 'dsm-sub-btn'
      del.textContent = '删除'
      del.title = '移入回收站，可在回收站恢复'
      del.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); dsmSubAction(n.sessionId, 'delete') })
      acts.appendChild(del)
      // 彻底删除是破坏性操作，只放在会话管理面板里（那里有二次确认、回收站
      // 与墓碑一整套安全网）。侧栏只提供「删除」（进回收站，可恢复）。
      r.appendChild(acts)
      box.appendChild(r)
    }
  }
  // MutationObserver 增量驱动为主（childList + 属性 + 文本），彻底替代高频率
  // 全表定时扫描；保留一个低频兜底 tick 处理无 DOM 变化的状态迁移，且后台
  // 标签页完全不跑。回收站/墓碑集合的刷新也挂在这个兜底上（每 8 拍 ≈ 32s）。
  let raf = 0
  const schedulePaint = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; paint() }) }
  const FALLBACK_TICK_MS = 4000
  const tick = () => {
    if (typeof document !== 'undefined' && document.hidden) return
    if (++dsmTrashTick % 8 === 0) dsmLoadTrashIds()
    paint()
  }
  tick()
  dsmLoadTrashIds()
  paint()
  const obs = new MutationObserver(schedulePaint)
  obs.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-state', 'aria-selected', 'class', 'style'],
    characterData: true,
  })
  const tickTimer = setInterval(tick, FALLBACK_TICK_MS)
  // 插件卸载（HMR / 停用）时整场清退：没有这一步，interval 和 observer 会
  // 跟着旧闭包活到页面关闭，注入节点也会留在侧栏上。
  return () => {
    clearInterval(tickTimer)
    obs.disconnect()
    dsmTeardownSidebarAug()
  }
}

// Cross-workspace drag/drop for the native DSH sidebar. DSH does not expose a
// sidebar-row plugin slot, so the adapter discovers session/workspace rows from
// their React fiber nodes, while the actual move remains entirely host-owned.
// The existing “移动会话” menu is also the keyboard-accessible fallback.
// 同上：拖拽增强的观察器 / interval / document 级 pointerdown|drag* 监听器只装一份。
let sidebarDragInstalled = false
function installSidebarWorkspaceDrag() {
  if (typeof document === 'undefined') return
  if (sidebarDragInstalled) return
  sidebarDragInstalled = true
  let sessions = new Map()
  let dragging = null
  let moving = false

  // 识别统一走 sidebarAdapter（可版本化、可整体降级）；adapter 停用后拖拽
  // 行为整体退出，不残留在官方侧栏上。
  const sessionForRow = (row) => {
    const { node, group } = sidebarAdapter.recognize(row)
    return sessionForNodes(group ? [node, group].filter(Boolean) : [node], sessions)
  }
  const workspaceForRow = (row) => {
    // A session row's fiber chain also contains its parent workspace node.
    // Reject it explicitly so only the visible workspace header is a drop zone.
    if (sessionForRow(row)) return null
    const { group } = sidebarAdapter.recognize(row)
    return group ? workspaceForNodes([group]) : null
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
    if (sidebarAdapter.disabled) return
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
  // 指针按下先于 dragstart 数十到数百毫秒，正好用来给「Map 里还没有的行」预热：
  // replace the 5s poll with a just-in-time fetch, so a brand-new session is
  // draggable on the first gesture without a background poll.
  document.addEventListener('pointerdown', (event) => {
    if (moving) return
    const row = eventRow(event)
    if (!row || sessionForRow(row)) return
    maybeRefresh()
  }, true)

  document.addEventListener('dragstart', (event) => {
    if (sidebarAdapter.disabled) return
    const moveCapability = dsmActionCapability('relocateSession') || dsmActionCapability('move')
    if (!moveCapability || !moveCapability.available) return
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
    if (!canDropOnWorkspace(dragging, target)) return
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
    if (!item || !target || moving || !canDropOnWorkspace(item, target)) return
    event.preventDefault()
    event.stopPropagation()
    moving = true
    clearVisuals()
    row.classList.add('dsm-drag-busy')
    try {
      const result = await postJSON('/archived-sessions/move', { sessionId: item.sessionId, targetPath: target.path })
      // 会话被 DSH 打开时服务端只登记排队：磁盘与工作区分组都没动。这条路径绝不能
      // 本地改行 + 报成功——那会让用户以为移动已完成，而侧栏刷新后该行又跳回原工作区
      //（用户 2026-09-10 报的「说移动成功但还在原工作区」就是这个）。排队时只如实说明。
      if (result && result.queued) {
        await dsmLoadTrashIds()
        toast(result.notes && result.notes.length ? result.notes.join(' ') : '会话正被 DSH 打开，已排队待移动；重启 DSH 后会自动完成（请先别打开它）。')
        return
      }
      sessions.set(item.sessionId, { ...item, workspacePath: result.workspacePath || target.path, workspaceTitle: result.workspaceTitle || target.title })
      await dsmLoadTrashIds()
      toast(result && result.already
        ? `已在「${result.workspaceTitle || target.title}」`
        : `已移到「${result.workspaceTitle || target.title}」`)
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
  // 原先这里每 5s 无脑全表刷新一次。该接口在 host 侧要遍历全部会话，
  // 大库（issue #1: 49 会话 / 14 万帧）上每次都是一次重活，页面挂着就一直占宿主 CPU，
  // 连累 session.history 之类 RPC 超时。拖拽元数据根本不需要 5s 精度：
  //   - 背景标签页完全不刷新
  //   - 前台每 60s 兜底一次
  //   - 标签页重新可见、或真正开始拖拽而 Map 里没有该行时，按需刷新
  let lastRefreshAt = Date.now()
  const maybeRefresh = () => {
    if (typeof document !== 'undefined' && document.hidden) return
    lastRefreshAt = Date.now()
    return refresh()
  }
  const REFRESH_MS = 60000
  setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) return
    if (Date.now() - lastRefreshAt < REFRESH_MS) return
    maybeRefresh()
  }, REFRESH_MS)
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return
      if (Date.now() - lastRefreshAt < 30000) return
      maybeRefresh()
    })
  }
}

export function apply(ctx) {
  dsmClientCtx = ctx
  dsmLoadCapabilities()
  installSettingsNavIcons(ctx)
  installSidebarSessionMenuAug()
  // 侧栏增强的卸载清退挂到 cordis effect：插件停用/HMR 时 interval、
  // MutationObserver 与全部注入 DOM 一并回收（否则泄漏到页面关闭）。
  const disposeSidebarDots = installSidebarStatusDots()
  if (disposeSidebarDots) ctx.effect(() => disposeSidebarDots)
  installSidebarWorkspaceDrag()
  const workspacesSvc = ctx.get('workspaces')
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      { name: 'settings.section', id: 'session-manager', order: 90, label: '会话管理' },
      (props) => <SessionPanel {...props} workspacesSvc={workspacesSvc} />,
    ),
  )
}
