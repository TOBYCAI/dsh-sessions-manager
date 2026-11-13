// 回归：回收站「彻底删除」不再对着不存在的路径空删。
//
// 现场来自 issue #26 现象 2（122 条条目里 45 条 originalPath 记的是
// `session.v4.jsonl.zstd`，磁盘上却是 legacy 的 `session.jsonl.zstd`）：
//   1) 老代条目必须先按磁盘实际代际纠偏、再删掉，而不是报「日志已消失」；
//   2) 真的找不到文件时必须 409 拒绝并保留条目，绝不能把 unlink 的 ENOENT
//      当成功吞掉之后还写墓碑 —— 那会让条目永久变成 410，文件和条目都回不去。
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Readable } from 'node:stream'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let root
let trashDir
let staleLogPath
let staleEntryPath
let routes

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsm-purge-stale-'))
  trashDir = join(root, 'trash')
  process.env.DSH_SESSIONS_MANAGER_TRASH_DIR = trashDir
  process.env.DSH_SESSIONS_MANAGER_STAR_DIR = join(root, 'state')
  process.env.DSH_SESSIONS_MANAGER_PENDING_DIR = join(root, 'pending')
  await mkdir(trashDir, { recursive: true })

  const [{ apply }, { projectKeyFor, encodeSegmentFor }] = await Promise.all([
    import(`../src/index.js?purge-stale=${Date.now()}`),
    import('../src/handle-era-paths.js'),
  ])

  const cwd = join(root, 'workspace')
  const dir = join(root, projectKeyFor(cwd), encodeSegmentFor('stale-a'))
  await mkdir(dir, { recursive: true })
  // 磁盘上停在老代命名，而 header.version 早已是 4（真实用户现场）
  staleLogPath = join(dir, 'session.jsonl.zstd')
  await writeFile(staleLogPath, Buffer.from('zstd-frame-placeholder'))
  staleEntryPath = join(dir, 'session.v4.jsonl.zstd')

  const header = { id: 'stale-a', cwd, version: 4 }
  // 刻意不提供 open()：这是 legacy 布局，彻底删除走单文件 unlink 分支，
  // 也就是这条路径才会真正暴露「假路径 → ENOENT 被吞」。
  const sp = {
    root,
    async list() { return [{ header }] },
    // 官方 locate 只按 header.version 拼名字，从不看盘
    locate: (h) => ({ path: join(root, projectKeyFor(h.cwd), encodeSegmentFor(h.id), 'session.v4.jsonl.zstd') }),
    async readFrom() { return { meta: header, inheritedEventCount: 0, events: [] } },
  }

  const domainState = { archivedSessionIds: [] }
  const ctx = {
    workspaceRegistry: { list: () => [], state: domainState, archiveSession: async () => {} },
    sessionPersistence: sp,
    sessionQuery: { readTitleSnapshots: async (ids) => ids.map(() => ({ status: 'fulfilled', value: { session: header, title: { title: 'Stale purge' } } })) },
    storageDomain: { get: () => ({ global: { get: () => domainState, set: async (next) => Object.assign(domainState, next) } }) },
    webServer: { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
    get: () => null,
    effect: (fn) => fn(),
  }
  routes = new Map()
  apply(ctx)

  await writeFile(join(trashDir, 'index.json'), JSON.stringify({
    schemaVersion: 2,
    settings: { retentionDays: 0 },
    items: [
      // A：索引里的路径是假的（v4 名字从未落盘），真实文件是 legacy 命名
      { sessionId: 'stale-a', title: 'Stale purge', deletedAt: 1, originalPath: staleEntryPath },
      // B：文件与索引都不存在 —— 必须拒绝，不能假成功
      { sessionId: 'gone-b', title: 'Gone', deletedAt: 1, originalPath: join(root, 'nowhere', 'session.v4.jsonl.zstd') },
    ],
    purgedSessionIds: [],
  }))
})

after(async () => { await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }) })

async function call(path, body = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))])
  let status = 200
  let text = ''
  const res = { writeHead: (value) => { status = value }, end: (value) => { text += value || '' } }
  await routes.get(path)(req, res)
  return { status, body: JSON.parse(text) }
}

test('purge refuses a missing log instead of faking success and burning the tombstone', async () => {
  const { status, body } = await call('/archived-sessions/trash/purge', { sessionId: 'gone-b' })
  assert.equal(status, 409, `must refuse, got ${status}: ${JSON.stringify(body)}`)
  assert.equal(body.code, 'DSM_SESSION_LOG_MISSING')
  const store = JSON.parse(readFileSync(join(trashDir, 'index.json'), 'utf8'))
  assert.ok(store.items.some((t) => String(t.sessionId) === 'gone-b'), 'the entry must stay recoverable for a retry')
  assert.ok(!store.purgedSessionIds.map(String).includes('gone-b'), 'no tombstone may be written for a refused purge')
})

test('purge repairs a stale originalPath from the on-disk generation and really deletes it', async () => {
  assert.ok(existsSync(staleLogPath), 'precondition: the legacy generation is on disk')
  const { status, body } = await call('/archived-sessions/trash/purge', { sessionId: 'stale-a' })
  assert.equal(status, 200, `purge must succeed after path repair, got ${status}: ${JSON.stringify(body)}`)
  assert.equal(body.purged, true)
  assert.equal(existsSync(staleLogPath), false, 'the real log must be gone')
  const store = JSON.parse(readFileSync(join(trashDir, 'index.json'), 'utf8'))
  assert.ok(!store.items.some((t) => String(t.sessionId) === 'stale-a'), 'the trash entry must be removed')
  assert.ok(store.purgedSessionIds.map(String).includes('stale-a'), 'a successful purge keeps its tombstone')
})
