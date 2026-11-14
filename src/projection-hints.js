// 官方持久投影缓存（`ctx.sessionProjectionCache`）的读取助手 —— 3.8.1 底座换轨。
//
// 背景：0.2.2-rc.3 的 dsh-base 默认挂载 `dsh-session-projection-cache`
// （`writeEveryEvents: 200` / `writeIntervalMs: 5000`）。它给出一层**只读 header、
// 零 I/O** 的冷读面：未实例化的历史会话也能直接看到 `title` 与
// `sessionListMetadata`（`blank` / `lastPromptAt`），不必让 runtime 把整本日志
// 解码一遍（`readTitleSnapshots` 的老路径，issue #8 的 90s CPU 就是这么来的）。
//
// 纪律（违反任何一条都会退化，改代码前先读）：
//   1. 缓存**可能过期，但永不超前**——官方写路径先落日志再落缓存。所以一律当
//      **提示**用：标题拿到非空串就够渲染，`blank === false` 就够判「必有内容」。
//   2. 服务不存在（0.1.7 / 0.2.0 早期）/ 任何异常 → 返回 null，调用方回退老路径，
//      行为与 3.8.0 逐字节等同。
//   3. `title` 为 null / 空串 = **未知**，绝不是「这个会话真的没有标题」；仍要交
//      后台预热（empty 三态纪律）。
//   4. `blank` 只做**单向**预筛：`blank === false` ⇒ 必有内容（可跳过精判）；
//      `blank === true` 仍要走事件精判——官方口径是「出现 turn/start 之前恒 true」，
//      比我们粗：一条只有 user/message 就被打断的会话官方判空、我们判非空。

/**
 * 从 `ProjectionSnapshot.values` 里抽出我们关心的提示。
 * @param {object|undefined|null} values 快照的 values 块
 * @param {{fromPredecessor?: boolean}} [opts] 是否来自 predecessor 标题面
 * @returns {{title: string|null, blank: boolean|null, fromPredecessor: boolean}|null}
 *          两个字段都拿不到时返回 null（= 没有任何提示）
 */
export function hintsFromValues(values, opts) {
  if (!values || typeof values !== 'object') return null
  const rawTitle = values.title
  const title = typeof rawTitle === 'string' && rawTitle.length > 0 ? rawTitle : null
  const meta = values.sessionListMetadata
  const blank = meta && typeof meta === 'object' && typeof meta.blank === 'boolean' ? meta.blank : null
  if (title === null && blank === null) return null
  return { title, blank, fromPredecessor: !!(opts && opts.fromPredecessor) }
}

/**
 * 没有 `summaryKeys()`（0.2.1 一代）时用的最小键集。
 *
 * 为什么不用 `undefined`（= 全部键）：`viewCheckpoint` 会把每个注册了 `wire` 的
 * 投影都 parse 一遍，那里面可能有整段消息/工具日志——侧栏每拍对每条会话都读一次
 * 全部键是不可接受的。这两个键都拿不到时也只是「没有提示」，不会出错。
 */
const FALLBACK_KEYS = Object.freeze(['title', 'sessionListMetadata'])

/**
 * 读一条会话的冷提示（同步、零 I/O）。
 *
 * 先用 `cachedSnapshot(header, summaryKeys())`：这是当前格式代的完整视图；
 * 拿不到时退 `cachedPredecessorTitle(header)`——格式代际（v3→v4）之间缓存里
 * 只剩前代标题，官方也承认它是「可能过期但绝不超前的真实事实」。
 *
 * @param {object|undefined|null} cache `ctx.sessionProjectionCache`
 * @param {object|undefined|null} registry `ctx.sessionProjections`（取其 summaryKeys）
 * @param {object|undefined|null} header list 快照里的 SessionHeader
 * @returns {{title: string|null, blank: boolean|null, fromPredecessor: boolean}|null}
 */
export function readCachedHints(cache, registry, header) {
  if (!cache || typeof cache !== 'object' || typeof cache.cachedSnapshot !== 'function') return null
  if (!header || typeof header !== 'object') return null
  // 键选择只用官方自己给出的 summary 集合：它随注册/注销变化，不能在这里缓存
  // 常量（拿到未注册的键无害，但拿不到新注册的键就会白丢一次命中）。
  let keys
  try {
    keys = registry && typeof registry.summaryKeys === 'function' ? registry.summaryKeys() : FALLBACK_KEYS
  } catch (e) { keys = FALLBACK_KEYS }
  let snap = null
  try { snap = cache.cachedSnapshot(header, keys) } catch (e) { snap = null }
  if (!snap && typeof cache.cachedPredecessorTitle === 'function') {
    try { snap = cache.cachedPredecessorTitle(header) } catch (e) { snap = null }
    return hintsFromValues(snap && snap.values, { fromPredecessor: true })
  }
  return hintsFromValues(snap && snap.values, { fromPredecessor: false })
}

/**
 * 只取标题（列表构建用）。非空串才算命中，其余一律 null = 未知。
 * @param {object|undefined|null} cache
 * @param {object|undefined|null} registry
 * @param {object|undefined|null} header
 * @returns {string|null}
 */
export function cachedTitleOf(cache, registry, header) {
  const hints = readCachedHints(cache, registry, header)
  return hints && hints.title ? hints.title : null
}
