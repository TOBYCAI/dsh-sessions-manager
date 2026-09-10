// Deferred cross-workspace moves ("排队移动").
//
// 背景：0.1.5 起会话日志是**单写者**——agent-loop 在 resume 时会话时取写所有权
// （日志旁的 session.lock 上一个 flock(2)），持有到 agent 卸载；插件既拿不到该
// 句柄，也没有任何公共 API 能释放别人的所有权（dsh-session 服务只暴露
// list/get/prepare/enter/fork/flush；`session/disposed` 只在持有它的 fiber 被
// dispose 时发出）。在占用期硬搬目录会让在写者继续往旧 inode 写、并在旧路径
// 重建空壳（2026-09-10 实测过），所以唯一安全的做法是**排队等它被释放**。
//
// 本模块只负责持久化队列本身（读写/去重/清理），执行时机由 index.js 决定：
//   - 宿主释放该会话（session/disposed；0.1.5 无用户可见的关闭入口，绝大多数情况
//     就是进程退出）→ 立刻尝试
//   - 插件启动后（会话尚未被打开）→ 兜底尝试
//   - 周期性轻量重试（队列为空时不启动定时器）
// 写入沿用本仓库其他索引的模式：schemaVersion + 原子写（tmp → rename）。

import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SCHEMA_VERSION = 1
const DEFAULT_DIR = process.env.DSH_SESSIONS_MANAGER_PENDING_DIR
  || process.env.DSH_SESSIONS_MANAGER_STAR_DIR
  || join(homedir(), '.dsh', 'sessions-manager')
const MAX_ITEMS = 50
// 非"占用中"的失败（目标工作区消失、日志损坏…）留在队列里但计数；超过阈值就丢弃，
// 避免一个永远失败的条目让每次重试都白跑。
const MAX_ATTEMPTS = 5

function isSafeId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
}

function normalizeStore(raw) {
  const items = []
  const seen = new Set()
  const source = raw && Array.isArray(raw.items) ? raw.items : []
  for (const item of source) {
    if (!item || !isSafeId(item.sessionId) || typeof item.targetPath !== 'string' || item.targetPath.length === 0) continue
    if (seen.has(item.sessionId)) continue
    seen.add(item.sessionId)
    items.push({
      sessionId: String(item.sessionId),
      targetPath: String(item.targetPath),
      queuedAt: Number.isFinite(item.queuedAt) ? Number(item.queuedAt) : Date.now(),
      attempts: Number.isSafeInteger(item.attempts) && item.attempts >= 0 ? Number(item.attempts) : 0,
    })
    if (items.length >= MAX_ITEMS) break
  }
  return { schemaVersion: SCHEMA_VERSION, items }
}

/**
 * @param {object} [options]
 * @param {string} [options.dir] 队列所在目录（测试注入临时目录）
 */
export function createPendingMoveStore(options = {}) {
  const dir = options.dir || DEFAULT_DIR
  const indexPath = options.indexPath || join(dir, 'pending-moves.json')
  let mutation = Promise.resolve()

  async function read() {
    try {
      return normalizeStore(JSON.parse(readFileSync(indexPath, 'utf8')))
    } catch (e) {
      return normalizeStore(null)
    }
  }

  async function write(store) {
    await mkdir(dir, { recursive: true })
    const tmp = join(dir, `.pending-moves-${process.pid}-${Date.now()}.tmp`)
    await writeFile(tmp, JSON.stringify(normalizeStore(store), null, 2), { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, indexPath)
  }

  function mutate(mutator) {
    const operation = mutation.then(async () => {
      const store = await read()
      const result = await mutator(store)
      await write(store)
      return result
    })
    mutation = operation.catch(() => {})
    return operation
  }

  return {
    indexPath,
    dir,
    list: async () => (await read()).items,
    has: async (sessionId) => (await read()).items.some((item) => item.sessionId === String(sessionId)),
    queue: (sessionId, targetPath) => mutate((store) => {
      if (!isSafeId(sessionId) || typeof targetPath !== 'string' || targetPath.length === 0) return null
      const existing = store.items.find((item) => item.sessionId === String(sessionId))
      if (existing) {
        existing.targetPath = String(targetPath)
        existing.attempts = 0
        return existing
      }
      const item = { sessionId: String(sessionId), targetPath: String(targetPath), queuedAt: Date.now(), attempts: 0 }
      store.items.push(item)
      if (store.items.length > MAX_ITEMS) store.items.splice(0, store.items.length - MAX_ITEMS)
      return item
    }),
    remove: (sessionIds) => mutate((store) => {
      const drop = new Set((Array.isArray(sessionIds) ? sessionIds : [sessionIds]).filter(isSafeId).map(String))
      const before = store.items.length
      store.items = store.items.filter((item) => !drop.has(item.sessionId))
      return before - store.items.length
    }),
    bumpAttempts: (sessionId) => mutate((store) => {
      const item = store.items.find((entry) => entry.sessionId === String(sessionId))
      if (!item) return null
      item.attempts += 1
      if (item.attempts >= MAX_ATTEMPTS) {
        store.items = store.items.filter((entry) => entry.sessionId !== item.sessionId)
        return { dropped: true, attempts: item.attempts }
      }
      return { dropped: false, attempts: item.attempts }
    }),
  }
}

export { MAX_ITEMS, MAX_ATTEMPTS, SCHEMA_VERSION, normalizeStore }
