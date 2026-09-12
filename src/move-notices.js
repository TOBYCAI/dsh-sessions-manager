// move-notices.js — 排队移动「后台终局」的持久通知（3.7.0 T2）。
//
// 背景（UX 黑洞）：排队移动发起时有诚实的「已排队」提示，但**后台完成/最终放弃**
// 原先只 console.warn——用户合上页面就永远不知道结果。本模块把每次终局落成一条
// 独立通知，经 sidebar-state 带出、client 弹出、ack 后清除。
//
// 为什么是独立文件而不是 pending-moves.json 加字段：排队的两个终局（成功 remove、
// 放弃 bumpAttempts→dropped）都会把条目从 items 里删掉——挂在条目上的字段与载体
// 同生共死，恰恰在两个目标场景里都观察不到。独立文件另外两点好处：pending-moves
// 的 items 形状与 schemaVersion 保持 1 不动（旧 host 读新文件不可见，回滚零影响）；
// 通知的生命周期（服务端保留到 ack + 7 天 TTL + 20 条截断）与队列互不干扰。
//
// 投递语义：**留在服务端直到 client ack**——pop 式投递会被「toast 没弹用户就关了
// 页面」直接丢通知。同浏览器多 tab 的即时去重靠 client 的 localStorage 已见集合，
// ack 只是尽力清理（ack 失败无害，TTL 兜底）。
//
// 写入沿用本仓库索引的既定纪律：schemaVersion + 串行 mutation + 原子写（tmp →
// rename）+ 0600 + 防御式归一化（坏数据逐条丢弃，坏文件当空集合）。
import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SCHEMA_VERSION = 1
// env 在 create 时读取而非模块加载时冻结（测试动态导入的既定模式；生产单实例两可）。
export const MAX_NOTICES = 20
export const NOTICE_MAX_AGE_MS = 7 * 24 * 3600 * 1000
const KINDS = new Set(['moved', 'abandoned'])

function isSafeId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
}
function str(v, max) {
  return typeof v === 'string' && v ? v.slice(0, max) : null
}

export function normalizeNotice(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (!KINDS.has(raw.kind) || !isSafeId(raw.sessionId)) return null
  const at = Number.isFinite(raw.at) && raw.at > 0 ? Math.floor(raw.at) : 0
  if (!at) return null
  const sessionId = String(raw.sessionId)
  return {
    id: str(raw.id, 400) || `${sessionId}:${raw.kind}:${at}`,
    kind: raw.kind,
    sessionId,
    targetPath: str(raw.targetPath, 500),
    attempts: Number.isSafeInteger(raw.attempts) && raw.attempts >= 0 ? raw.attempts : null,
    reason: str(raw.reason, 300),
    at,
  }
}

function normalizeStore(raw) {
  const source = raw && Array.isArray(raw.items) ? raw.items : []
  const seen = new Set()
  const items = []
  for (const entry of source) {
    const n = normalizeNotice(entry)
    if (!n || seen.has(n.id)) continue
    seen.add(n.id)
    items.push(n)
  }
  items.sort((a, b) => a.at - b.at)
  const trimmed = items.length > MAX_NOTICES ? items.slice(items.length - MAX_NOTICES) : items
  return { schemaVersion: SCHEMA_VERSION, items: trimmed }
}

/**
 * @param {object} [options]
 * @param {string} [options.dir] 通知文件所在目录（测试注入临时目录）
 */
export function createMoveNoticeStore(options = {}) {
  const dir = options.dir
    || process.env.DSH_SESSIONS_MANAGER_PENDING_DIR
    || process.env.DSH_SESSIONS_MANAGER_STAR_DIR
    || join(homedir(), '.dsh', 'sessions-manager')
  const indexPath = options.indexPath || join(dir, 'move-notices.json')
  let mutation = Promise.resolve()

  function read() {
    try {
      return normalizeStore(JSON.parse(readFileSync(indexPath, 'utf8')))
    } catch (e) {
      return normalizeStore(null)
    }
  }

  async function write(store) {
    await mkdir(dir, { recursive: true })
    const tmp = join(dir, `.move-notices-${process.pid}-${Date.now()}.tmp`)
    await writeFile(tmp, JSON.stringify(normalizeStore(store), null, 2), { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, indexPath)
  }

  function mutate(mutator) {
    const operation = mutation.then(async () => {
      const store = read()
      const result = await mutator(store)
      await write(store)
      return result
    })
    mutation = operation.catch(() => {})
    return operation
  }

  return {
    indexPath,
    // 终局落一条通知；同 id（会话+类型+时刻）幂等去重。
    append: (notice) => mutate((store) => {
      const n = normalizeNotice(notice)
      if (!n) return null
      if (store.items.some((x) => x.id === n.id)) return n
      store.items.push(n)
      return n
    }),
    // 只读列出未过期、未 ack 的通知（按时间升序）。过期项在下次写入时随归一化清掉。
    async list() {
      const now = Date.now()
      return read().items.filter((n) => now - n.at <= NOTICE_MAX_AGE_MS)
    },
    ack: (ids) => mutate((store) => {
      const drop = new Set((Array.isArray(ids) ? ids : []).filter((v) => typeof v === 'string' && v.length <= 400).map(String))
      const before = store.items.length
      store.items = store.items.filter((n) => !drop.has(n.id))
      return before - store.items.length
    }),
  }
}
