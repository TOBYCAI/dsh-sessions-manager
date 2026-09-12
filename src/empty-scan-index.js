// empty-scan-index.js — 空白会话精判结论的**磁盘**缓存（3.7.0 / T1 refine 解绑）。
//
// 背景：精判（对 ≤8KB 小日志按事件类型判空白）原先只在 sidebar-state 的请求路径里
// 同步跑，进程内 Map 缓存重启即全冷——分支标签延迟审计的根因之一。T1 把精判挪进
// 后台队列后，本模块让「已判定」跨重启复用：指纹未变的会话直接沿用结论，零解码。
//
// 纪律（全部沿用 title-persist-index / session-meta-cache 的既定红线）：
//   1. 只有**真正解码成功**的结论才允许落盘；解码失败按「非空」兜底只进进程内，
//      绝不固化成跨重启的判定（v3.6.1 #1 的教训：一次失败被永久记下）。
//   2. rev: 指纹（实例内 opaque token）在 normalizeEntry 处硬性拦截，与
//      title-persist-index.js 同一道防线。
//   3. 任何文件损坏 → 当空索引，绝不阻塞侧栏数据；坏 db 的代价是重判，不是错数据。
//
// 条目形状 { empty: 0|1, fingerprint: "<mtime:size>" | "sz:<n>", updatedAt }

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const EMPTY_SCAN_SCHEMA_VERSION = 1

const MAX_ENTRIES = 20000

export function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null
  const empty = raw.empty === 1 || raw.empty === true ? 1 : raw.empty === 0 || raw.empty === false ? 0 : null
  const fingerprint = typeof raw.fingerprint === 'string' && raw.fingerprint ? raw.fingerprint : null
  const updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : 0
  if (empty === null || !fingerprint || fingerprint.startsWith('rev:')) return null
  return { empty, fingerprint, updatedAt }
}

export function normalizeEmptyScanIndex(raw) {
  const entries = {}
  if (raw && typeof raw === 'object' && raw.entries && typeof raw.entries === 'object') {
    for (const [id, entry] of Object.entries(raw.entries)) {
      if (typeof id !== 'string' || !id || id.length > 200) continue
      const normalized = normalizeEntry(entry)
      if (normalized) entries[id] = normalized
    }
  }
  return { schemaVersion: EMPTY_SCAN_SCHEMA_VERSION, entries }
}

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

export function createEmptyScanStore({ dir, file }) {
  let cache = null
  let chain = Promise.resolve()
  const path = file || join(dir, 'empty-scan.json')

  async function readRaw() {
    try {
      return normalizeEmptyScanIndex(JSON.parse(await readFile(path, 'utf8')))
    } catch (e) {
      return normalizeEmptyScanIndex(null)
    }
  }

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
    async entries() {
      if (cache) return cache
      cache = (await readRaw()).entries
      return cache
    },
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
        const tmp = join(dirname(path), `.empty-scan-${process.pid}-${Date.now()}.tmp`)
        await writeFile(tmp, JSON.stringify({ schemaVersion: EMPTY_SCAN_SCHEMA_VERSION, entries: next }), { encoding: 'utf8', mode: 0o600 })
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
        const tmp = join(dirname(path), `.empty-scan-${process.pid}-${Date.now()}.tmp`)
        await writeFile(tmp, JSON.stringify({ schemaVersion: EMPTY_SCAN_SCHEMA_VERSION, entries: store }), { encoding: 'utf8', mode: 0o600 })
        await rename(tmp, path)
      })
      return true
    },
  }
}
