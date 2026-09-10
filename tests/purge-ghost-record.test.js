// 回归：回收站「彻底删除」的幽灵记录兜底。
// 会话不在 list() 里（后端索引滞后/缺失）且回收站条目没有 originalPath 时，
// purge 曾只能 409 拒绝（无法确认日志位置）。加固后改用 statSession 拿官方
// header，再由 locateVerified 三层守卫推导日志路径，完成整目录删除。
// 本文件锁定：list 为空 + 无 originalPath 仍然 200，且走的是 handle 时代
// 的写所有权探测 → 整目录删除 → 官方 stat 复核路径。
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Readable } from 'node:stream'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let root
let trashDir
let logPath
let routes
let writeOpenCount

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsm-purge-ghost-'))
  trashDir = join(root, 'trash')
  process.env.DSH_SESSIONS_MANAGER_TRASH_DIR = trashDir
  // 插件状态目录同样隔离，避免测试进程退出时打断原子写而漏下 .tmp
  process.env.DSH_SESSIONS_MANAGER_STAR_DIR = join(root, 'state')
  process.env.DSH_SESSIONS_MANAGER_PENDING_DIR = join(root, 'pending')
  await mkdir(trashDir, { recursive: true })
  const [{ apply }, { projectKeyFor, encodeSegmentFor }] = await Promise.all([
    import(`../src/index.js?purge-ghost=${Date.now()}`),
    import('../src/handle-era-paths.js'),
  ])
  routes = new Map()
  writeOpenCount = 0

  const sid = 'ghost-1'
  const cwd = join(root, 'workspace')
  const sessionDir = join(root, projectKeyFor(cwd), encodeSegmentFor(sid))
  await mkdir(sessionDir, { recursive: true })
  logPath = join(sessionDir, 'session.v2.jsonl.zstd')
  await writeFile(logPath, Buffer.from('zstd-frame-placeholder'))

  const header = { id: sid, cwd, createdAt: 1 }
  // 关键：list() 永远看不到该会话（幽灵记录），只有 stat() 能读到磁盘现状。
  const sp = {
    root,
    async list() { return [] },
    async stat(id) {
      return id === sid && existsSync(sessionDir) ? { header, revision: 'r1', sizeBytes: 22 } : undefined
    },
    async open(id, access) {
      if (access === 'write') writeOpenCount++
      return {
        header,
        inheritedEventCount: 0,
        async read(offset, length) { return [] },
        async close() {},
      }
    },
  }

  const domainState = { archivedSessionIds: [] }
  const ctx = {
    workspaceRegistry: { list: () => [], state: domainState, archiveSession: async () => {} },
    sessionPersistence: sp,
    sessionQuery: {
      readTitleSnapshots: async (ids) => ids.map(() => ({ status: 'fulfilled', value: { session: header, title: { title: 'Ghost purge' } } })),
    },
    storageDomain: { get: () => ({ global: { get: () => domainState, set: async (next) => Object.assign(domainState, next) } }) },
    webServer: { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
    get: () => null,
    effect: (fn) => fn(),
  }
  apply(ctx)

  // 回收站条目故意不带 originalPath：成功与否只能取决于 stat + 守卫推导。
  await writeFile(join(trashDir, 'index.json'), JSON.stringify({
    schemaVersion: 2,
    settings: { retentionDays: 0 },
    items: [{ sessionId: sid, title: 'Ghost purge', deletedAt: 1 }],
    purgedSessionIds: [],
  }))
})

after(async () => { await rm(root, { recursive: true, force: true }) })

async function call(path, body = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))])
  let status = 200
  let text = ''
  const res = { writeHead: (value) => { status = value }, end: (value) => { text += value || '' } }
  await routes.get(path)(req, res)
  return { status, body: JSON.parse(text) }
}

test('ghost-record purge: stat-derived header + guarded path derivation complete the purge', async () => {
  const { status, body } = await call('/archived-sessions/trash/purge', { sessionId: 'ghost-1' })
  assert.equal(status, 200, `purge route must succeed, got ${status}: ${body.error}`)
  assert.equal(body.purged, true)
  assert.equal(existsSync(logPath), false, 'session log directory must be physically removed')
  assert.ok(writeOpenCount >= 1, 'the write-ownership probe (open id,write) must run')
  const store = JSON.parse(readFileSync(join(trashDir, 'index.json'), 'utf8'))
  assert.ok(store.purgedSessionIds.includes('ghost-1'), 'purge tombstone must be persisted')
  assert.equal(store.items.length, 0, 'the trash entry must be gone after a successful purge')
})
