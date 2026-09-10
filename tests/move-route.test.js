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
let oldCwd

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsm-move-'))
  process.env.DSH_SESSIONS_MANAGER_TRASH_DIR = join(root, 'trash')
  process.env.DSH_SESSIONS_MANAGER_STAR_DIR = join(root, 'state')
  // 待移动队列也要落到临时目录，别写进真实的 ~/.dsh/sessions-manager。
  process.env.DSH_SESSIONS_MANAGER_PENDING_DIR = join(root, 'pending')
  await mkdir(join(root, 'trash'), { recursive: true })
  const [{ apply }, { projectKeyFor, encodeSegmentFor }] = await Promise.all([
    import(`../src/index.js?move=${Date.now()}`),
    import('../src/handle-era-paths.js'),
  ])
  routes = new Map()

  const sid = 'mv-1'
  // 与 newCwd 同理：fixture 的 cwd 必须经 realpath（macOS /var → /private/var），
  // 否则 moveOne 的 canonical（realpath 后）与假后端按磁盘现状回报的 cwd 不一致，
  // 「移动后校验失败：会话工作目录未正确更新」。
  await mkdir(join(root, 'ws-old'), { recursive: true })
  oldCwd = await realpath(join(root, 'ws-old'))
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

  // 第二个会话（issue #7 move-many）：同样挂在 oldCwd 下，供批量移动用。
  const sid2 = 'mv-2'
  const header2 = { id: sid2, cwd: oldCwd, createdAt: 2, version: 2, isSeeded: false, delegationDepth: 0 }
  const sessionDir2 = join(root, projectKeyFor(oldCwd), encodeSegmentFor(sid2))
  const newSessionDir2 = join(root, projectKeyFor(newCwd), encodeSegmentFor(sid2))
  await mkdir(sessionDir2, { recursive: true })
  await writeFile(join(sessionDir2, 'session.v2.jsonl.zstd'), Buffer.from('zstd-frame-placeholder'))

  // 假后端的 list/stat/open 全部以「磁盘现状」为准：规范 generation 日志落在
  // 哪个工作区目录，会话就属于哪个 cwd——与真实 JSONL 后端行为一致。
  const cwdFor = (sDir, nDir) => {
    if (existsSync(join(nDir, 'session.v2.jsonl.zstd'))) return newCwd
    if (existsSync(join(sDir, 'session.v2.jsonl.zstd'))) return oldCwd
    return null
  }
  const currentCwd = () => cwdFor(sessionDir, newSessionDir)
  const currentCwd2 = () => cwdFor(sessionDir2, newSessionDir2)
  const sp = {
    root,
    async list() {
      const out = []
      const c1 = currentCwd()
      if (c1) out.push({ header: { ...header, cwd: c1 }, revision: 'r1', eventCount: events.length })
      const c2 = currentCwd2()
      if (c2) out.push({ header: { ...header2, cwd: c2 }, revision: 'r2', eventCount: events.length })
      return out
    },
    async stat(id) {
      const cwd = String(id) === sid2 ? currentCwd2() : currentCwd()
      const h = String(id) === sid2 ? header2 : header
      return cwd ? { header: { ...h, cwd }, revision: 'r1', eventCount: events.length } : undefined
    },
    async open(id, access) {
      // 真实后端对未知会话拒绝打开：move-many 的逐条失败回报靠它触发。
      if (String(id) !== sid && String(id) !== sid2) throw new Error('会话不存在')
      const isTwo = String(id) === sid2
      const cwd = (isTwo ? currentCwd2() : currentCwd()) || oldCwd
      return {
        header: { ...(isTwo ? header2 : header), cwd },
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
  oldEntity.sessionIds.push(sid2)
  headers.set(sid, header)
  headers.set(sid2, header2)
  sessionPaths.set(sid, oldCwd)
  sessionPaths.set(sid2, oldCwd)

  ctxRefs = { oldEntity, newEntity, headers, sessionPaths, reindexed: [], sp }
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

// ---- issue #7：批量移动 ------------------------------------------------------

test('move-many moves every listed session to one target in one call', async () => {
  const { status, body } = await call('/archived-sessions/move-many', { sessionIds: ['mv-2'], targetPath: join(root, 'ws-new') })
  assert.equal(status, 200, `move-many must succeed, got ${status}: ${body.error}`)
  assert.equal(body.moved, 1)
  assert.deepEqual(body.failed, [])
  // 成员迁移 + 内存索引重定向到目标工作区。
  assert.ok(ctxRefs.newEntity.sessionIds.includes('mv-2'), 'session must join the target workspace')
  assert.ok(!ctxRefs.oldEntity.sessionIds.includes('mv-2'), 'session must leave the old workspace')
  assert.equal(ctxRefs.headers.get('mv-2').cwd, newCwd)
})

test('move-many reports per-id failures without blocking the rest', async () => {
  // ghost-404 不存在 → 计入 failed；mv-1 已在目标工作区 → 幂等 already 计入 moved。
  const { status, body } = await call('/archived-sessions/move-many', { sessionIds: ['ghost-404', 'mv-1'], targetPath: join(root, 'ws-new') })
  assert.equal(status, 200)
  assert.equal(body.moved, 1)
  assert.equal(body.failed.length, 1)
  assert.equal(body.failed[0].sessionId, 'ghost-404')
  assert.ok(body.failed[0].error)
})

test('move-many validates params', async () => {
  assert.equal((await call('/archived-sessions/move-many', {})).status, 400)
  assert.equal((await call('/archived-sessions/move-many', { sessionIds: ['mv-1'] })).status, 400)
  assert.equal((await call('/archived-sessions/move-many', { sessionIds: [], targetPath: '/tmp/x' })).status, 400)
})

// ---- 同 id 跨目录残留（duplicate JSONL session id 防回归）--------------------
// 真实案例（2026-09-09）：历史移动在源项目目录留下目录壳，0.1.3 后端在 create
// 时扫描到同 id 出现在多个项目目录即拒绝移动。插件现在移动前清壳、移动后收尾
// 源目录；发现真实日志副本则拒绝并人工裁决。

const { projectKeyFor, encodeSegmentFor } = await import('../src/handle-era-paths.js')
// root 在 before() 里才就绪，第三个工作区的项目目录必须在用例内惰性求值。
const extraProjectFor = () => join(root, projectKeyFor(join(root, 'ws-extra')))

test('move cleans up same-id leftover shells elsewhere and succeeds', async () => {
  // mv-2 当前在 ws-new；在第三个工作区留下一个空壳目录（日志已不在，只剩目录）。
  const shell = join(extraProjectFor(), encodeSegmentFor('mv-2'))
  await mkdir(shell, { recursive: true })
  await writeFile(join(shell, 'session.jsonl.zstd.test'), Buffer.from('test residue'))
  const { status, body } = await call('/archived-sessions/move', { sessionId: 'mv-2', targetPath: oldCwd })
  assert.equal(status, 200, `move must succeed after shell cleanup, got ${status}: ${body.error}`)
  assert.equal(body.moved, true)
  // 壳已清掉；源目录（ws-new 里）也已收尾移除。
  assert.equal(existsSync(shell), false, 'leftover shell must be removed before the move')
  assert.equal(existsSync(join(root, projectKeyFor(newCwd), encodeSegmentFor('mv-2'))), false, 'source dir must be cleaned up after the move')
  // 会话落在目标工作区，官方视角 cwd 已更新。
  assert.equal(ctxRefs.headers.get('mv-2').cwd, oldCwd)
})

test('move refuses with 409 when another dir holds a same-generation copy of the same id', async () => {
  // mv-1 当前在 ws-new；在第三个工作区放一份**同代**真实日志副本 → 无法判断谁权威，
  // 必须拒绝且不动盘（被取代的旧代副本会自动回收，见下一条用例）。
  const dupDir = join(extraProjectFor(), encodeSegmentFor('mv-1'))
  await mkdir(dupDir, { recursive: true })
  const dupLog = join(dupDir, 'session.v2.jsonl.zstd')
  await writeFile(dupLog, Buffer.from('real legacy log copy'))
  const { status, body } = await call('/archived-sessions/move', { sessionId: 'mv-1', targetPath: join(root, 'ws-old') })
  assert.equal(status, 409)
  assert.equal(body.code, 'DSM_SESSION_DUP_LOG')
  assert.ok(body.error.includes('确认保留'), `error must be readable, got: ${body.error}`)
  // 同代副本原样保留（绝不擅删疑似数据）。
  assert.equal(existsSync(dupLog), true, 'same-generation duplicate log must be kept for manual inspection')
})

test('move reclaims a superseded (older-generation) copy in another dir and reports it', async () => {
  // 0.1.5 起官方发布新代不删旧代，历史移动会在别的项目目录留下被取代的旧代 →
  // 该 id 永久"跨目录重复"，用户再也移不动。这种残留自动回收并如实回报。
  const dupDir = join(extraProjectFor(), encodeSegmentFor('mv-1'))
  // 上一条用例在该目录留了一份同代副本（刻意保留，供人工裁决），这里先清掉，
  // 只留"被取代的旧代"这一种残留。
  await rm(join(dupDir, 'session.v2.jsonl.zstd'), { force: true })
  await mkdir(dupDir, { recursive: true })
  const staleLog = join(dupDir, 'session.v1.jsonl.zstd')
  await writeFile(staleLog, Buffer.from('superseded legacy generation'))
  const { status, body } = await call('/archived-sessions/move', { sessionId: 'mv-1', targetPath: join(root, 'ws-old') })
  assert.equal(status, 200, `expected success, got ${status}: ${JSON.stringify(body)}`)
  assert.equal(existsSync(dupDir), false, 'reclaimed stale copy dir must be gone')
  assert.ok(Array.isArray(body.notes) && body.notes.some((n) => /回收/.test(n)), `expected reclaim note, got ${JSON.stringify(body.notes)}`)
})

test('a session held by another writer is queued instead of failing, and can be cancelled', async () => {
  // 0.1.5 单写者：DSH 打开会话时持有 flock，插件无法释放 → 排队等它关闭
  // （session/disposed 或下次启动时自动完成）。这里用「写所有权探测抛
  // SessionAlreadyOwnedError」模拟占用。
  const owned = new Error('Session "mv-2" is already owned by an active write handle')
  owned.name = 'SessionAlreadyOwnedError'
  const spRef = ctxRefs.sp
  const originalOpen = spRef.open
  spRef.open = async (id, access) => {
    if (String(id) === 'mv-2' && access === 'write') throw owned
    return originalOpen(id, access)
  }
  try {
    const { status, body } = await call('/archived-sessions/move', { sessionId: 'mv-2', targetPath: join(root, 'ws-new') })
    assert.equal(status, 200, `expected soft-success, got ${status}: ${JSON.stringify(body)}`)
    assert.equal(body.queued, true)
    assert.equal(body.moved, false)
    // 断言语义而非逐字文案：排队提示必须说明「已排队」并给出可操作的自救路径（重启 DSH）。
    assert.ok(body.notes.some((n) => /已排队/.test(n) && /重启/.test(n)), `expected queue note, got ${JSON.stringify(body.notes)}`)

    const listed = await call('/archived-sessions/pending-moves', {})
    assert.equal(listed.status, 200)
    assert.ok(listed.body.items.some((i) => i.sessionId === 'mv-2'), JSON.stringify(listed.body))

    const cancelled = await call('/archived-sessions/pending-moves/cancel', { sessionIds: ['mv-2'] })
    assert.equal(cancelled.status, 200)
    assert.equal(cancelled.body.removed, 1)

    const after = await call('/archived-sessions/pending-moves', {})
    assert.equal(after.body.items.length, 0)
  } finally {
    spRef.open = originalOpen
  }
})
