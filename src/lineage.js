// Lineage classification for sidebar grouping (issue #6).
//
// All inputs come from the public list() snapshot — header + sizeBytes — so
// classification costs zero log decoding, keeping the zero-decode listing
// design intact. Three kinds:
//   - subagent: official header.origin === 'subagent' (with parentSession and
//     a delegationDepth recursion budget, both persisted by the backend)
//   - fork branch: header.parentSession set without the subagent origin
//   - empty: the log holds only the generation header
//
// The backend list snapshot carries NO eventCount, so the size test below is
// only a cheap PRE-FILTER: since 0.1.3 it can no longer decide emptiness by
// itself (bigger headers + a constant lifecycle-metadata frame push every
// new log past the old baseline). The authoritative verdict comes from
// refineEmptyLineage in index.js — an event-type scan (see below). Keep the
// size test: it flags candidates cheaply and its false positives get
// corrected by the precise pass.

const EMPTY_BASE = 190

export function isEmptyLogSize(sizeBytes, cwd) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return false
  const cwdLen = typeof cwd === 'string' ? cwd.length : 0
  return sizeBytes <= EMPTY_BASE + cwdLen
}

// ---- 0.1.3 空会话判定（事件类型法）---------------------------------------
// 0.1.3 起日志结构变了：头部帧之后恒定跟一帧「生命周期元数据」
// （permission/preset / sandbox/mode / approval/policy，实测约 150B 压缩），
// 且头部新增 isSeeded / delegationDepth / agentPreset 等字段，压缩后整本
// 约 300 + cwd.length 字节——上面的体积阈值（190 + cwd，alpha.2 基线）对
// 新格式永远判不中，空白会话全部漏判。压缩体积对头部扩容/压缩器参数天生
// 敏感，不再扩阈值，改为按事件类型判定：
//   空会话 = 头部之外只出现生命周期元数据事件，没有任何内容事件。
// 解码在宿主侧进行（index.js 的 refineEmptyLineage：只对压缩体积 ≤
// EMPTY_DECODE_LIMIT 的候选调官方 inspectSession），这里只放纯函数与常量。
//
// 已知的生命周期事件（0.1.3-alpha.1 实测，会话创建时一次性写入）。'session'
// 是头部行自身——inspectSession 若把头部当事件回传，它恒存在于每本日志，
// 放行不削弱判定；任何未知类型都按内容处理（宁可漏判，不可错杀）。
export const EMPTY_DECODE_LIMIT = 8192

const LIFECYCLE_EVENT_TYPES = new Set([
  'session',
  'permission/preset',
  'sandbox/mode',
  'approval/policy',
])

/**
 * @param {Array<string|undefined>} types 事件类型序列（不含头部也可，含头部
 *        也可——'session' 在放行清单里）。0 条 = 头部之外无任何事件，视为空。
 * @returns {boolean}
 */
export function isEmptyEventTypes(types) {
  if (!Array.isArray(types)) return false
  for (const t of types) {
    if (typeof t !== 'string' || !LIFECYCLE_EVENT_TYPES.has(t)) return false
  }
  return true
}

// Returns a lineage record, or null when the session is an ordinary
// top-level, non-empty session (the overwhelmingly common case — keeps the
// sidebar-state payload small).
export function classifyLineage(header, sizeBytes) {
  if (!header || typeof header !== 'object') return null
  const origin = header.origin === 'subagent' ? 'subagent' : null
  const parentSession = typeof header.parentSession === 'string' && header.parentSession
    ? header.parentSession
    : null
  const delegationDepth = Number.isSafeInteger(header.delegationDepth) && header.delegationDepth > 0
    ? header.delegationDepth
    : 0
  const empty = isEmptyLogSize(sizeBytes, header.cwd)
  if (!origin && !parentSession && !empty) return null
  return { origin, parentSession, delegationDepth, empty }
}
