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
// v3.7.0 (T1)：体积法**不再对外发布任何空白结论**——它历史上就有假阳性
// （长 cwd 抬高阈值把有内容的小日志标空 → 侧栏误隐藏，误隐藏严格重于误闪现）。
// isEmptyLogSize 降级为纯参考实现（阈值单测仍锁着）；空白与否现在只有三个来源：
// 解码精判的成功结论（true/false）、精判解码上限之外的日志（false = 必有内容）、
// 以及未知（null，交后台 refine 队列判定）。见 index.js refineEmpty.

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
// 已知的生命周期/状态事件（会话创建与运行中由 DSH 自身写入，不是内容）。
// 'session' 是头部行自身——inspectSession 若把头部当事件回传，它恒存在于每本日志，
// 放行不削弱判定；任何未知类型都按内容处理（宁可漏判，不可错杀）。
export const EMPTY_DECODE_LIMIT = 8192

const LIFECYCLE_EVENT_TYPES = new Set([
  'session',
  'permission/preset',
  'sandbox/mode',
  'approval/policy',
  // 0.2.2 起新增的状态/配置事件（0.2.2-rc.3 的 KNOWN_SESSION_EVENT_TYPES 复核）：
  // 预设选择、模型选择、计划模式、团队模式、工作目录切换等，全部只记录「设置」。
  // 放行它们不影响有内容的会话——本判定要求「所有事件都是噪声」才算空白，
  // 只要有一条 user/assistant/tool 事件就照旧判为非空。
  'agent-preset/selected',
  'model/selection',
  'subagent/model-selection-policy',
  'plan/mode',
  'team/mode',
  'working-directory/change',
  'goal/change',
  'schedule/change',
  'session/end-seed',
  'session/title',
])

// 注入型事件：`agent/inbox/spliced` 把消息写进下一轮的 inbox。它不是用户输入，
// 但它**可能**是插件塞进来的上下文/指令（issue #18 第 5 条：openviking-memory
// 之类的记忆插件会这么干）。这种会话在界面上空空如也，先前却被算作「有内容」
// → 永远进不了「空白」分类，只能一直占着列表。
//
// 判定按「插入项来源」做，而不是按事件类型一刀切——真实用户消息同样走这个
// 事件，绝不能连人打的字一起判空：
//   - 每条插入消息都带 source，且 source.form === 'instructions' 或
//     source.kind 以 'plugin:' 开头 → 纯注入，算噪声；
//   - 有任何一条没有 source / 是普通用户消息 → 算内容；
//   - 同时带 removedCount（删了东西）→ 算内容（可能删掉了真实消息）。
function isInjectedMessage(msg) {
  const src = msg && typeof msg === 'object' ? msg.source : null
  if (!src || typeof src !== 'object') return false
  if (src.form === 'instructions') return true
  return typeof src.kind === 'string' && src.kind.startsWith('plugin:')
}

// 单条事件是否属于「不构成内容」的噪声。接受两种形状：
//   - 旧形状：事件类型字符串（向后兼容，历史调用点与单测仍这样传）
//   - 新形状：{ type, data } —— 只有 inbox 注入需要看 data
export function isNoiseEvent(event) {
  const type = typeof event === 'string' ? event : event && typeof event === 'object' ? event.type : null
  if (typeof type !== 'string') return false
  if (LIFECYCLE_EVENT_TYPES.has(type)) return true
  if (type !== 'agent/inbox/spliced') return false
  const data = event && typeof event === 'object' ? event.data : null
  if (!data || typeof data !== 'object') return false
  const removed = Number(data.removedCount)
  if (Number.isFinite(removed) && removed > 0) return false
  // inserted 缺失/畸形一律按内容处理（宁可漏判，不可错杀）。
  if (!Array.isArray(data.inserted)) return false
  if (data.inserted.length === 0) return true
  return data.inserted.every(isInjectedMessage)
}

/**
 * @param {Array<string|{type?:string,data?:object}|undefined>} events 事件序列
 *        （类型字符串或带 data 的事件对象；不含头部也可，含头部也可——
 *        'session' 在放行清单里）。0 条 = 头部之外无任何事件，视为空。
 * @returns {boolean}
 */
export function isEmptyEventTypes(events) {
  if (!Array.isArray(events)) return false
  for (const ev of events) {
    if (!isNoiseEvent(ev)) return false
  }
  return true
}

// Structural lineage only (T1): a record is produced when the session is a
// subagent or a fork branch; `empty` is published as null (= not yet judged)
// and refined in the background. Ordinary top-level sessions return null —
// they only ever gain an entry once a real decode says empty:true.
export const SUBAGENT_CASCADE_LIMIT = 500

/**
 * 子代理后代（issue #18 第 4 条：子代理生命周期跟随父会话）。
 *
 * 只认官方 header 的 `origin === 'subagent'` + `parentSession`，零解码：
 * 删除父会话时由宿主把同一份 listEntries 快照传进来，一次扫描算出整棵子树。
 *
 * @param {Array<object>} headers 会话 header 列表（可为 null / 含畸形项）
 * @param {string} rootId 父会话 id
 * @param {number} [limit] 节点上限（默认 SUBAGENT_CASCADE_LIMIT，防病态血缘）
 * @returns {string[]} 后代 id（广度优先，含孙代；不含 rootId 自身）
 */
export function subagentDescendantsOf(headers, rootId, limit = SUBAGENT_CASCADE_LIMIT) {
  const root = rootId == null ? '' : String(rootId)
  if (!root) return []
  const kidsOf = new Map()
  for (const h of Array.isArray(headers) ? headers : []) {
    if (!h || typeof h !== 'object' || h.id == null || h.origin !== 'subagent') continue
    const id = String(h.id)
    const parent = h.parentSession != null ? String(h.parentSession) : ''
    // 自指 / 空父一律跳过：它们不构成「后代」边。
    if (!parent || parent === id) continue
    if (!kidsOf.has(parent)) kidsOf.set(parent, [])
    kidsOf.get(parent).push(id)
  }
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : SUBAGENT_CASCADE_LIMIT
  const out = []
  const visited = new Set([root])
  const queue = [root]
  while (queue.length && out.length < max) {
    const cur = queue.shift()
    for (const kid of kidsOf.get(cur) || []) {
      if (visited.has(kid)) continue
      visited.add(kid)
      out.push(kid)
      queue.push(kid)
      if (out.length >= max) break
    }
  }
  return out
}

export function classifyLineage(header) {
  if (!header || typeof header !== 'object') return null
  const origin = header.origin === 'subagent' ? 'subagent' : null
  const parentSession = typeof header.parentSession === 'string' && header.parentSession
    ? header.parentSession
    : null
  const delegationDepth = Number.isSafeInteger(header.delegationDepth) && header.delegationDepth > 0
    ? header.delegationDepth
    : 0
  if (!origin && !parentSession) return null
  return { origin, parentSession, delegationDepth, empty: null }
}

// 空白精判候选：压缩体积在解码上限内的小日志。sizeBytes 缺失（legacy 列表
// 快照没有该观测）时返回 false —— 与历史行为一致：legacy 世代空白判定不生效。
export function emptyScanCandidate(sizeBytes) {
  return Number.isFinite(sizeBytes) && sizeBytes <= EMPTY_DECODE_LIMIT
}
