// session-meta-cache.js — 会话「原始元数据」内存缓存（按日志文件指纹校验）。
//
// 背景（issue #1）：列表构建原本对每条会话调用 readTitleSnapshot，而该调用会把
// 会话日志（.jsonl.zstd）的**所有 zstd 帧**逐帧解压、逐行 JSON.parse，只为折叠出
// 最新标题。大库（数十条会话、十万级帧）一次全表要几秒 CPU，且解码是同步块，
// 会阻塞宿主事件循环，连累 session.history 之类的 RPC 超时。
//
// 关键观察：解码得出的元数据（title / cwd / createdAt）只随**日志文件内容**变化，
// 而任何append/改名/移动都会更新日志文件的 mtime。所以只要记下当时的
// (mtimeMs, size)，下次 stat 到相同指纹就可以直接复用缓存，跳过整本解码。
//
// 为什么自己实现而不用 runtime 的 prepared 缓存：插件不能假设对方的 runtime 版本
// （issue 报告者是 0.1.1-rc.2，本机是 0.1.2-rc.1），runtime 侧的缓存容量/命中策略
// 各版本不同。本模块只用 node 原生能力与插件已有的 sp.locate + stat，任何版本行为一致。
//
// 失效策略（三重保险）：
//   1. 指纹校验：mtimeMs 或 size 任一变化即视为过期（append 改 mtime、移动改写 frame0 也改 mtime）
//   2. TTL：防止「mtime 精度/时钟回拨」导致的长期陈旧
//   3. 显式 invalidate：删除 / 移动 / 归档等宿主操作后主动丢弃对应条目
//
// 纯逻辑与副作用分离：isFresh / partitionByCache 都是纯函数，便于单测。

const DEFAULT_TTL_MS = 5 * 60 * 1000
const DEFAULT_MAX = 4000

// 文件指纹：只有同时拿到 mtime 与 size 才可信（两者都变才算内容变了）。
// 拿不到 stat 信息时返回 null——表示「无法校验」，调用方必须按未命中处理，
// 绝不能在有疑问时返回旧数据。
export function fingerprintOf(stat) {
  if (!stat || typeof stat !== 'object') return null
  const mtimeMs = stat.mtimeMs
  const size = stat.size
  if (typeof mtimeMs !== 'number' || !Number.isFinite(mtimeMs) || mtimeMs <= 0) return null
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return null
  return `${Math.floor(mtimeMs)}:${size}`
}

// 缓存条目是否仍然新鲜（纯函数）。
export function isFresh(entry, stat, now, ttlMs = DEFAULT_TTL_MS) {
  if (!entry) return false
  const fp = fingerprintOf(stat)
  if (!fp) return false
  if (entry.fingerprint !== fp) return false
  if (typeof entry.at !== 'number') return false
  return (now - entry.at) <= ttlMs
}

// 把一批 id 分成「命中缓存」与「需要解码」两组（纯函数，便于单测）。
// statsById: Map<id, {mtimeMs, size}>；cache: 与 SessionMetaCache 同构的 Map。
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
      // 无法算出指纹（没 stat / stat 失败）时不写缓存：写进去就再也无法可靠失效。
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
