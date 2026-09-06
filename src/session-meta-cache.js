// session-meta-cache.js — 会话「原始元数据」内存缓存（按日志内容指纹校验）。
//
// 背景（issue #1）：列表构建原本对每条会话调用 readTitleSnapshot，而该调用会把
// 会话日志（.jsonl.zstd）的**所有 zstd 帧**逐帧解压、逐行 JSON.parse，只为折叠出
// 最新标题。大库（数十条会话、十万级帧）一次全表要几秒 CPU，且解码是同步块，
// 会阻塞宿主事件循环，连累 session.history 之类的 RPC 超时。
//
// 指纹有两种来源（按 runtime 能力自动选择，调用方构造 stat 对象）：
//
//   1. 文件指纹（legacy runtime）：记下日志的 (mtimeMs, size)。任何
//      append/改名/移动都会更新 mtime，所以「stat 相同 ⇒ 内容没变」。
//      该指纹可跨进程持久化（title-persist-index 用它做冷启动加速）。
//
//   2. revision 指纹（SessionHandle 世代 runtime，0.1.3+）：sessionPersistence
//      的 list()/stat() 返回 SessionPersistenceSnapshot，其 `revision` 是
//      **不透明变更令牌**。官方契约：同一 service 实例、同一 session id 内，
//      revision 相等可视为日志未变；除此之外 revision 不做任何承诺。
//      ⚠️ 因此 revision 指纹**绝不能写入跨进程的持久缓存**（不同进程/重启后
//      revision 值无意义，误用可能把陈旧数据当新鲜数据）。持久索引落盘前必须
//      用 isPersistableFingerprint() 过滤。
//
// 为什么自己实现而不用 runtime 的 prepared 缓存：插件不能假设对方的 runtime 版本，
// runtime 侧的缓存容量/命中策略各版本不同。本模块只用纯数据判定，任何版本行为一致。
//
// 失效策略：
//   1. 指纹校验：revision 不相等 / mtimeMs 或 size 任一变化即视为过期
//   2. TTL：仅对文件指纹生效（防 mtime 精度/时钟回拨）；revision 相等即权威，
//      不受 TTL 影响（官方契约明文允许 treat equal revisions as unchanged）
//   3. 显式 invalidate：删除 / 移动 / 归档等宿主操作后主动丢弃对应条目
//
// 纯逻辑与副作用分离：isFresh / partitionByCache 都是纯函数，便于单测。

const DEFAULT_TTL_MS = 5 * 60 * 1000
const DEFAULT_MAX = 4000

const REVISION_PREFIX = 'rev:'

// 文件指纹：只有同时拿到 mtime 与 size 才可信。
// 拿不到 stat 信息时返回 null——表示「无法校验」，调用方必须按未命中处理，
// 绝不能在有疑问时返回旧数据。
export function fingerprintOf(stat) {
  if (!stat || typeof stat !== 'object') return null
  // revision 指纹优先：SessionHandle 世代没有可靠的 locate/stat，
  // snapshot.revision 是官方提供的唯一变更令牌。
  if (typeof stat.revision === 'string' && stat.revision.length > 0) {
    return REVISION_PREFIX + stat.revision
  }
  const mtimeMs = stat.mtimeMs
  const size = stat.size
  if (typeof mtimeMs !== 'number' || !Number.isFinite(mtimeMs) || mtimeMs <= 0) return null
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return null
  return `${Math.floor(mtimeMs)}:${size}`
}

// revision 指纹只在当前 service 实例内有意义，绝不能落盘作为跨进程指纹。
// title-persist-index 等持久化层必须在写入前用它过滤。
export function isPersistableFingerprint(fingerprint) {
  return typeof fingerprint === 'string' && fingerprint !== '' && !fingerprint.startsWith(REVISION_PREFIX)
}

// 缓存条目是否仍然新鲜（纯函数）。
// stat 传 { revision } 或 { mtimeMs, size }；两类指纹不能互相匹配。
export function isFresh(entry, stat, now, ttlMs = DEFAULT_TTL_MS) {
  if (!entry) return false
  const fp = fingerprintOf(stat)
  if (!fp) return false
  if (entry.fingerprint !== fp) return false
  if (typeof entry.at !== 'number') return false
  // revision 指纹不受 TTL 约束：契约允许把相等 revision 视为日志未变。
  if (fp.startsWith(REVISION_PREFIX)) return true
  return (now - entry.at) <= ttlMs
}

// 把一批 id 分成「命中缓存」与「需要解码」两组（纯函数，便于单测）。
// statsById: Map<id, {mtimeMs, size} | {revision}>；cache: 与 SessionMetaCache 同构的 Map。
export function partitionByCache(ids, statsById, cache, now = Date.now(), ttlMs = DEFAULT_TTL_MS) {
  const cached = new Map()
  const missing = []
  for (const id of ids) {
    const entry = cache && cache.get(String(id))
    const stat = statsById && statsById.get(String(id))
    if (isFresh(entry, stat, now, ttlMs) && entry && entry.meta) {
      cached.set(String(id), entry.meta)
    } else {
      missing.push(String(id))
    }
  }
  return { cached, missing }
}

export function createSessionMetaCache(opts = {}) {
  const ttlMs = Number.isFinite(opts.ttlMs) ? opts.ttlMs : DEFAULT_TTL_MS
  const max = Number.isInteger(opts.max) && opts.max > 0 ? opts.max : DEFAULT_MAX
  const map = new Map()
  let hits = 0
  let misses = 0

  return {
    // 命中返回 meta，未命中/无法校验返回 null。
    get(id, stat) {
      const key = String(id)
      const entry = map.get(key)
      if (isFresh(entry, stat, Date.now(), ttlMs)) {
        hits++
        // LRU：命中后移到末尾，容量满时优先淘汰最久未用。
        map.delete(key)
        map.set(key, entry)
        return entry.meta
      }
      misses++
      return null
    },
    set(id, stat, meta) {
      if (!meta) return null
      const fp = fingerprintOf(stat)
      // 无法算出指纹（没 stat / revision 缺失 / stat 失败）时不写缓存：
      // 写进去就再也无法可靠失效。
      if (!fp) return null
      const key = String(id)
      map.delete(key)
      map.set(key, { fingerprint: fp, at: Date.now(), meta })
      if (map.size > max) {
        // 淘汰最久未用的一个（Map 保持插入顺序，首个即最旧）。
        const oldest = map.keys().next().value
        if (oldest !== undefined) map.delete(oldest)
      }
      return meta
    },
    // 批量判定：一次算出「命中缓存」与「需要解码」两组，供列表构建做批量投影。
    partition(ids, statsById) {
      return partitionByCache(ids, statsById, map, Date.now(), ttlMs)
    },
    invalidate(id) {
      if (id == null) return false
      const key = String(id)
      const had = map.has(key)
      map.delete(key)
      return had
    },
    clear() { map.clear() },
    get size() { return map.size },
    stats() { return { size: map.size, hits, misses, ttlMs } },
  }
}
