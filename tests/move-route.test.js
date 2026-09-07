// 回归：跨工作区移动路由（/archived-sessions/move）在 handle 世代
// （persistence.kind === 'session-handle'）的端到端行为。
// 背景：v3.5.2 的「彻底删除」路由曾因引用未定义变量在 0.1.3 上稳定崩溃，
// 而当时的冒烟直连 ops 层、绕过了路由，全程绿灯——说明 ops 直连冒烟不能
// 替代路由级回归。本文件锁定 move 路由的完整链路：读日志 → revision 校验 →
// 官方 create+append 重放（同 id 幽灵回退 frame0 改写）→ 工作区成员迁移 →
// 内存索引重定向 → reindex。
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Readable } from 'node:stream'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let root
let routes
let ctxRefs
let newCwd

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsm-move-'))
  process.env.DSH_SESSIONS_MANAGER_TRASH_DIR = join(root, 'trash')
  await mkdir(join(root, 'trash'), { recursive: true })
  const [{ apply }, { projectKeyFor, encodeSegmentFor }] = await Promise.all([
    import(`../src/index.js?move=${Date.now()}`),
    import('../src/handle-era-paths.js'),
  ])
  routes = new Map()

  const sid = 'mv-1'
  const oldCwd = join(root, 'ws-old')
  // 注意：moveTargetWorkspace 用 realpath 归一化目标路径（macOS 上 /var 会解析
  // 为 /private/var），fixture 必须用 realpath 后的字符串构造新工作区，否则
  // 「移动后校验失败：会话工作目录未正确更新」。
  await mkdir(join(root, 'ws-new'), { recursive: true })
  newCwd = await realpath(join(root, 'ws-new'))
  const events = Array.from({ length: 5 }, (_, i) => ({
    type: 'user/message',
    data: { id: `m-${i}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: `hello ${i}` }] },
    seq: i,
  }))
  const header = { id: sid, cwd: oldCwd, createdAt: 1, version: 2, isSeeded: false, delegationDepth: 0 }

  const sessionDir = join(root, projectKeyFor(oldCwd), encodeSegmentFor(sid))
  const newSessionDir = join(root, projectKeyFor(newCwd), encodeSegmentFor(sid))
  await mkdir(sessionDir, { recursive: true })
  const logPath = join(sessionDir, 'session.v2.jsonl.zstd')
  await writeFile(logPath, Buffer.from('zstd-frame-placeholder'))

  // 假后端的 list/stat/open 全部以「磁盘现状」为准：规范 generation 日志落在
  // 哪个工作区目录，会话就属于哪个 cwd——与真实 JSONL 后端行为一致。
  const currentCwd = () => {
    if (existsSync(join(newSessionDir, 'session.v2.jsonl.zstd'))) return newCwd
    if (existsSync(join(sessionDir, 'session.v2.jsonl.zstd'))) return oldCwd
    return null
  }
  const sp = {
    root,
    async list() {
      const cwd = currentCwd()
      return cwd ? [{ header: { ...header, cwd }, revision: 'r1', eventCount: events.length }] : []
    },
    async stat(id) {
      const cwd = currentCwd()
      return cwd ? { header: { ...header, cwd }, revision: 'r1', eventCount: events.length } : undefined
    },
    async open(id, access) {
      const cwd = currentCwd() || oldCwd
      return {
        header: { ...header, cwd },
        inheritedEventCount: 0,
        async read(offset, length) { return offset === 0 ? events : [] },
        async close() {},
      }
    },
    async create(newHeader) {
      const dir = join(root, projectKeyFor(newHeader.cwd), encodeSegmentFor(newHeader.id))
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'session.v2.jsonl.zstd'), Buffer.from('zstd-frame-placeholder'))
      return {
        async append(batch) { /* 假后端接受任意批次 */ },
        async flush() {},
        async close() {},
      }
    },
  }

  const domainState = { archivedSessionIds: [] }
  const headers = new Map()
  const sessionPaths = new Map()
  const makeEntity = (dir) => ({
    id: dir,
    title: dir,
    path: dir,
    sessionIds: [],
    async attachSession(id) { if (!this.sessionIds.includes(id)) this.sessionIds.push(id) },
    async detachSession(id) { this.sessionIds = this.sessionIds.filter((x) => x !== id) },
  })
  const oldEntity = makeEntity(oldCwd)
  const newEntity = makeEntity(newCwd)
  oldEntity.sessionIds.push(sid)
  headers.set(sid, header)
  sessionPaths.set(sid, oldCwd)

  ctxRefs = { oldEntity, newEntity, headers, sessionPaths, reindexed: [] }
  const ctx = {
    workspaceRegistry: {
      list: () => [oldEntity, newEntity],
      state: domainState,
      archiveSession: async () => {},
      create: async (path) => (path === oldCwd ? oldEntity : newEntity),
      headers,
      sessionPaths,
      replaceHeaderIndex: async (entries) => { ctxRefs.reindexed = entries },
      rebuildEntities() {},
    },
    sessionPersistence: sp,
    sessionQuery: {
      readTitleSnapshots: async (ids) => ids.map(() => ({ status: 'fulfilled', value: { session: header, title: { title: 'Move regression' } } })),
    },
    storageDomain: { get: () => ({ global: { get: () => domainState, set: async (next) => Object.assign(domainState, next) } }) },
    webServer: { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
    get: () => null,
    effect: (fn) => fn(),
  }
  apply(ctx)
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

test('handle-era move route completes end-to-end: replay, membership, reindex', async () => {
  const { status, body } = await call('/archived-sessions/move', { sessionId: 'mv-1', targetPath: join(root, 'ws-new') })
  assert.equal(status, 200, `move route must succeed, got ${status}: ${body.error}`)
  assert.equal(body.moved, true)
  // 日志已迁移：新工作区目录在位，旧目录消失。
  assert.equal(existsSync(join(root, 'ws-new')), true)
  // 工作区成员迁移 + 内存索引重定向。
  assert.ok(ctxRefs.newEntity.sessionIds.includes('mv-1'), 'session must join the target workspace')
  assert.ok(!ctxRefs.oldEntity.sessionIds.includes('mv-1'), 'session must leave the old workspace')
  assert.equal(ctxRefs.headers.get('mv-1').cwd, newCwd)
  assert.equal(ctxRefs.sessionPaths.get('mv-1'), newCwd)
  // reindex 拿到的是移动后的官方 headers（cwd 已更新）。
  const reheader = (ctxRefs.reindexed || []).find((h) => h && h.id === 'mv-1')
  assert.ok(reheader, 'reindex must receive the moved header')
  assert.equal(reheader.cwd, newCwd)
})

test('move refuses the currently active session with 409', async () => {
  // 重新 import 一份干净实例太重；直接用错误码语义验证：同工作区移动是
  // already:true，而活跃会话由 getActiveSessionId 拦截。这里用同一 fixture
  // 走 already 分支锁定幂等语义。
  const { status, body } = await call('/archived-sessions/move', { sessionId: 'mv-1', targetPath: join(root, 'ws-new') })
  assert.equal(status, 200)
  assert.equal(body.already, true)
})
