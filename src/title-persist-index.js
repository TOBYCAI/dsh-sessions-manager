// title-persist-index.js — 会话标题/元数据的**磁盘**小索引（P4，issue #1）。
//
// metaCache（session-meta-cache.js）解决的是「进程内重复解码」；本模块解决
// 的是冷启动：插件重启后内存缓存为空，第一次列表构建仍要全库解码一次。
// 把解码出的元数据连同文件指纹原子写进一个 JSON 索引，重启后列表只需
// 一次索引读 + 指纹比对，指纹没变的会话零解码。
//
// 结构仿 trash 的原子写索引：{ schemaVersion, entries: { [sessionId]: entry } }
// entry = { title, cwd, createdAt, fingerprint, updatedAt }
//   fingerprint 即 session-meta-cache.js 的 fingerprintOf(stat) 产出
//   （"<mtimeMs>:<size>"），比对一致即可信任条目内容。
//
// 写入时机由调用方决定（列表构建收尾批量回写、purge 时清理），本模块只
// 提供：读取缓存、合并写入（串行化 + 原子替换）、按 id 删除。任何文件
// 损坏都按空索引处理，绝不阻塞列表构建。
//
// 单实例假设：一个进程内只 apply 一个插件实例（生产即如此），实例间的
// 内存副本不互相同步——跨「重启」以落盘内容为准（测试亦按此断言）。

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const TITLE_INDEX_SCHEMA_VERSION = 1

const MAX_ENTRIES = 20000

// 条目只保留可序列化且对列表有用的字段；指纹缺失的条目无法校验，直接丢弃——
// 宁可下次重解码，也不能把无法失效的数据当真。
export function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null
  const title = typeof raw.title === 'string' ? raw.title : null
  const cwd = typeof raw.cwd === 'string' ? raw.cwd : null
  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : null
  const fingerprint = typeof raw.fingerprint === 'string' && raw.fingerprint ? raw.fingerprint : null
  const updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : 0
  if (!fingerprint || (!title && !cwd)) return null
  return { title, cwd, createdAt, fingerprint, updatedAt }
}

export function normalizeTitleIndex(raw) {
  const entries = {}
  if (raw && typeof raw === 'object' && raw.entries && typeof raw.entries === 'object') {
    for (const [id, entry] of Object.entries(raw.entries)) {
      if (typeof id !== 'string' || !id || id.length > 200) continue
      const normalized = normalizeEntry(entry)
      if (normalized) entries[id] = normalized
    }
  }
  return { schemaVersion: TITLE_INDEX_SCHEMA_VERSION, entries }
}

// 纯合并：right 覆盖 left 同 id 条目；截断到 MAX_ENTRIES（保留 updatedAt 新的）。
export function mergeEntries(left, right) {
  const merged = { ...left }
  for (const [id, entry] of Object.entries(right)) merged[id] = entry
  const ids = Object.keys(merged)
  if (ids.length > MAX_ENTRIES) {
    ids.sort((a, b) => (merged[a].updatedAt || 0) - (merged[b].updatedAt || 0))
    for (const id of ids.slice(0, ids.length - MAX_ENTRIES)) delete merged[id]
  }
  return merged
}

export function createTitleIndexStore({ dir, file }) {
  let cache = null
  let chain = Promise.resolve()
  const path = file || join(dir, 'title-index.json')

  async function readRaw() {
    try {
      return normalizeTitleIndex(JSON.parse(await readFile(path, 'utf8')))
    } catch (e) {
      return normalizeTitleIndex(null)
    }
  }

  // 所有写操作串行化（仿 trash 的 mutate 队列），避免并发 merge 互相覆盖。
  function enqueue(mutator) {
    const operation = chain.then(async () => {
      const store = cache || (cache = (await readRaw()).entries)
      await mutator(store)
      return store
    })
    chain = operation.catch(() => {})
    return operation
  }

  return {
    // 只读：内存优先，未加载过才落盘一次。绝不抛错。
    async entries() {
      if (cache) return cache
      cache = (await readRaw()).entries
      return cache
    },
    // 批量合并写入（原子替换）。失败静默：索引只是加速器，坏了下次重解码。
    async merge(batch) {
      const right = {}
      for (const [id, entry] of Object.entries(batch || {})) {
        const normalized = normalizeEntry(entry)
        if (normalized) right[String(id)] = normalized
      }
      if (!Object.keys(right).length) return false
      await enqueue(async (store) => {
        const next = mergeEntries(store, right)
        await mkdir(dirname(path), { recursive: true })
        const tmp = join(dirname(path), `.title-index-${process.pid}-${Date.now()}.tmp`)
        await writeFile(tmp, JSON.stringify({ schemaVersion: TITLE_INDEX_SCHEMA_VERSION, entries: next }), { encoding: 'utf8', mode: 0o600 })
        await rename(tmp, path)
        cache = next
      })
      return true
    },
    async remove(ids) {
      const wanted = new Set((ids || []).map(String))
      if (!wanted.size) return false
      await enqueue(async (store) => {
        let changed = false
        for (const id of wanted) {
          if (id in store) { delete store[id]; changed = true }
        }
        if (!changed) return
        await mkdir(dirname(path), { recursive: true })
        const tmp = join(dirname(path), `.title-index-${process.pid}-${Date.now()}.tmp`)
        await writeFile(tmp, JSON.stringify({ schemaVersion: TITLE_INDEX_SCHEMA_VERSION, entries: store }), { encoding: 'utf8', mode: 0o600 })
        await rename(tmp, path)
      })
      return true
    },
  }
}

// 判定持久条目能否当作当前日志的解码结果：指纹一致即可（与内存缓存同一标准）。
export function persistEntryUsable(entry, stat) {
  const normalized = normalizeEntry(entry)
  if (!normalized || !stat) return null
  return normalized.fingerprint === stat.fingerprint ? normalized : null
}
