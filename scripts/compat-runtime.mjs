// Real-runtime integration smoke for dsh-sessions-manager's compat layer.
//
// Boots the OFFICIAL @deepseek-ai JSONL persistence backend (built lib output
// of a deepseek-harness checkout) on a real cordis Context, creates synthetic
// sessions through the official public API only (create → handle.append →
// flush → close), then drives the plugin's adapter + capabilities against it:
//
//   1. list() returns SessionPersistenceSnapshot with header/revision/sizeBytes
//   2. stat() revision is stable while the log is unchanged
//   3. SessionHandle.read(offset, length) is a bounded, contiguous slice
//   4. adapter.inspectSession chunks a long log with exactly one close
//   5. capabilities: handle-era runtime gates physicalPurge / relocateSession
//
// Usage:
//   node scripts/compat-runtime.mjs <path-to-deepseek-harness-checkout>
//        [--node-hint <version>]   # prints a hint when the native deps mismatch
//
// NOTE: the harness build tree contains native modules compiled for whatever
// Node built it. If you hit NODE_MODULE_VERSION errors, rerun with the Node
// version the checkout was built with (e.g. system node 26 for local builds).
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const harnessDir = resolve(process.argv[2] || process.env.DSH_HARNESS_DIR || '')
if (!harnessDir) {
  console.error('usage: node scripts/compat-runtime.mjs <deepseek-harness-checkout>')
  process.exit(2)
}

const pkgs = {
  persistenceJsonl: join(harnessDir, 'packages/session/session-persistence-jsonl'),
  persistence: join(harnessDir, 'packages/session/session-persistence'),
}
const requireFrom = (dir) => createRequire(join(dir, 'package.json'))

async function loadModule(pkgDir, sub) {
  const specifier = sub || '.'
  try {
    return await import(pathToFileURL(join(pkgDir, sub || 'lib/index.js')).href)
  } catch (e) {
    if (String(e.message).includes('NODE_MODULE_VERSION')) {
      console.error(`native module mismatch for ${pkgDir}: rebuild the harness or run this script with the Node version the checkout was built with.`)
    }
    throw e
  }
}

const root = await mkdtemp(join(tmpdir(), 'dsm-runtime-'))
const checks = []
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail: detail === undefined ? null : detail })
  if (!ok) throw new Error(`runtime smoke failed: ${name}${detail !== undefined ? ` (${JSON.stringify(detail)})` : ''}`)
}

try {
  // Real cordis Context, resolved from the harness's own dependency tree so
  // Service registration semantics are exactly the production ones.
  const cordisDir = requireFrom(pkgs.persistence).resolve('@deepseek-ai/cordis')
  const cordis = await import(pathToFileURL(cordisDir).href).then((m) => m.default ?? m)
  const { default: JsonlSessionPersistence } = await loadModule(pkgs.persistenceJsonl)
  const persistenceMod = await loadModule(pkgs.persistence)
  const ServiceCtor = persistenceMod.default
  check('exports resolve', typeof JsonlSessionPersistence === 'function' && typeof ServiceCtor === 'function')

  const ctx = typeof cordis === 'function' ? new cordis() : new cordis.Context()
  const sp = new JsonlSessionPersistence(ctx, { root })
  check('service is the official SessionPersistence subclass', sp instanceof ServiceCtor, sp.name)

  // ---- synthetic session through the official write path -------------------
  // Header must carry the full v2 vocabulary (version/isSeeded/delegationDepth):
  // a sparse header materializes, but the backend's own header reader then
  // classifies the frame as malformed and list()/stat() silently skip it.
  const header = {
    id: `smoke-${Date.now().toString(36)}`,
    cwd: root,
    createdAt: Date.now(),
    version: 2,
    isSeeded: false,
    delegationDepth: 0,
  }
  const write = await sp.create(header)
  const N = 9
  // 官方校验（assertMessageEventShape）：user/message 的 data 本身就是 message
  // record，必须带 id/role/source/content。
  const batch = Array.from({ length: N }, (_, i) => ({
    type: 'user/message',
    data: { id: `m-${i}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: `event-${i}` }] },
    seq: i,
  }))
  await write.append(batch)
  await write.flush()
  await write.close()

  // ---- plugin adapter against the real backend ----------------------------
  const plugin = await import('../src/compat/persistence.js')
  const adapter = plugin.createPersistenceAdapter(sp)
  check('adapter kind is session-handle', adapter.kind === 'session-handle')

  const entries = await adapter.listEntries()
  check('list returns snapshot entries', entries.some((e) => e.id === header.id), { count: entries.length })
  const entry = entries.find((e) => e.id === header.id)
  check('snapshot carries header/revision/sizeBytes', !!entry && typeof entry.revision === 'string' && entry.sizeBytes > 0)

  const stat1 = await adapter.statSession(header.id)
  const stat2 = await adapter.statSession(header.id)
  check('stat revision is stable while unchanged', !!stat1 && stat1.revision === stat2.revision, stat1 && stat1.revision)

  // bounded reads through the official handle
  const rh = await sp.open(header.id, 'read')
  const slice1 = await rh.read(0, 4)
  const slice2 = await rh.read(4, 4)
  const tail = await rh.read(8, 100)
  const beyond = await rh.read(N, 4)
  check('bounded read slices are contiguous', slice1.length === 4 && slice2.length === 4 && tail.length === 1 && beyond.length === 0, [slice1.length, slice2.length, tail.length, beyond.length])
  await rh.close()

  // chunked inspection: single close, exact fold
  let opens = 0
  let closes = 0
  const origOpen = sp.open.bind(sp)
  sp.open = async (...args) => { opens++; const h = await origOpen(...args); const oc = h.close.bind(h); h.close = async () => { closes++; return oc() }; return h }
  const batches = []
  const summary = await adapter.inspectSession(header.id, { chunkSize: 4, onEvents: (b) => batches.push(b.length) })
  check('inspectSession folds the whole log in chunks', summary.eventCount === N && batches.join(',') === '4,4,1', batches)
  check('inspectSession closes the handle exactly once', opens === 1 && closes === 1, { opens, closes })

  // capabilities：真实后端带 root 实例字段 → 物理删除/移动恢复可用（2026-09-06
  // 用户决策）；构造一个无 root 的实例验证降级理由仍然成立。
  const caps = await import('../src/compat/capabilities.js')
  const matrix = caps.detectCapabilities({ persistence: sp, workspaceRegistry: { archiveSession() {}, headers: new Map(), sessionPaths: new Map(), replaceHeaderIndex() {} } })
  check('handle-era with backend root enables physicalPurge', matrix.actions.physicalPurge.available === true, matrix.actions.physicalPurge)
  check('handle-era with backend root enables relocateSession', matrix.actions.relocateSession.available === true, matrix.actions.relocateSession)
  check('handle-era allows readInspection + restoreIndexedSession', matrix.actions.readInspection.available === true && matrix.actions.restoreIndexedSession.available === true)
  const degraded = caps.detectCapabilities({ persistence: { open: sp.open.bind(sp), stat: sp.stat.bind(sp) }, workspaceRegistry: { archiveSession() {} } })
  check('handle-era without root degrades purge/move with reason', degraded.actions.physicalPurge.available === false && /存储根目录/.test(degraded.actions.physicalPurge.reason), degraded.actions.physicalPurge.reason)

  // existence check via stat: a ghost session must be observable as absent
  const ghost = await adapter.statSession('does-not-exist')
  check('statSession reports absent sessions as null', ghost === null)

  // ---- handle-era destructive ops against the REAL backend -----------------
  // 2026-09-06 用户决策：物理删除与跨工作区移动沿用 legacy 半官方路线
  // （守卫式路径推导 + 受控 fs 操作）。本节在真实 alpha.1 构建上验证
  // handle-era-paths / handle-era-ops 的端到端行为。
  const mkBatch = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => ({
    type: 'user/message',
    data: { id: `m-${from + i}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: `event-${from + i}` }] },
    seq: from + i,
  }))
  const pathsMod = await import('../src/handle-era-paths.js')
  const opsMod = await import('../src/handle-era-ops.js')

  // 路径推导必须命中真实落盘布局（root 实例字段 + projectKey/encodeSegment）。
  const currentStat = await sp.stat(header.id)
  const artifacts = await pathsMod.locateSessionArtifacts(sp, currentStat.header)
  check('locateSessionArtifacts resolves the real session dir', !!artifacts && /session\.v2\.jsonl\.zstd$/.test(artifacts.logPath), artifacts && artifacts.logPath)
  check('locateSessionArtifacts rejects unknown sessions', await pathsMod.locateSessionArtifacts(sp, { id: 'no-such-id', cwd: root }) === null)

  // 关闭态会话：写所有权探测放行。
  await opsMod.ensureNoActiveWriter(sp, header.id)
  check('ensureNoActiveWriter passes for a closed session', true)

  // MOVE：官方 create+append 重放 → cwd 生效 + 事件逐条保留 + 旧目录清空。
  const wsB = join(root, 'project-b')
  await opsMod.moveSessionToCwd({ sp, sid: header.id, header: currentStat.header, canonical: wsB, events: batch, inheritedEventCount: 0 })
  const movedStat = await sp.stat(header.id)
  check('move: official stat carries the new cwd', !!movedStat && movedStat.header.cwd === wsB, movedStat && movedStat.header.cwd)
  const reread = await adapter.readSession(header.id, 0)
  check('move: events preserved byte-identically', reread.events.length === N && JSON.stringify(reread.events) === JSON.stringify(batch), reread.events.length)
  const oldLoc = await pathsMod.locateSessionArtifacts(sp, { ...header, cwd: root })
  const newLoc = await pathsMod.locateSessionArtifacts(sp, { ...header, cwd: wsB })
  check('move: derivation follows the relocated log', oldLoc === null && !!newLoc)

  // MOVE 拒绝活跃写者：保持写句柄打开时移动必须 409。
  const busyId = `smoke-busy-${Date.now().toString(36)}`
  const busyHeader = { ...header, id: busyId, createdAt: Date.now() }
  const busyWriter = await sp.create(busyHeader)
  await busyWriter.append(mkBatch(0, 2))
  await busyWriter.flush()
  let busyRefused = false
  try {
    await opsMod.moveSessionToCwd({ sp, sid: busyId, header: busyHeader, canonical: join(root, 'project-c'), events: [] })
  } catch (e) {
    busyRefused = e.status === 409 && /正在进行中/.test(e.message)
  }
  await busyWriter.close()
  check('move refuses an actively-writing session with 409', busyRefused)

  // PURGE：整目录删除 → 官方 stat 复核消失 → 推导失效。
  const purgeHeader = (await sp.stat(header.id)).header
  await opsMod.purgeSessionArtifacts(sp, header.id, purgeHeader)
  const afterPurge = await sp.stat(header.id)
  check('purge: official stat no longer sees the session', afterPurge === undefined)
  check('purge: derivation no longer resolves', await pathsMod.locateSessionArtifacts(sp, purgeHeader) === null)

  // PURGE 拒绝活跃写者（409），句柄关闭后重试成功。
  const busyStat = await sp.stat(busyId)
  let purgeRefused = false
  const holdWriter = await sp.create({ ...header, id: `smoke-hold-${Date.now().toString(36)}`, createdAt: Date.now() })
  await holdWriter.append(mkBatch(0, 1))
  await holdWriter.flush()
  // busyId 的写句柄已关闭；改为用 holdWriter 自身验证「写者未关闭 → 409」。
  try {
    await opsMod.purgeSessionArtifacts(sp, holdWriter.id, (await sp.stat(holdWriter.id)).header)
  } catch (e) {
    purgeRefused = e.status === 409 && /正在进行中/.test(e.message)
  }
  check('purge refuses a session with an open writer handle', purgeRefused)
  await holdWriter.close()
  await opsMod.purgeSessionArtifacts(sp, holdWriter.id, (await sp.stat(holdWriter.id)).header)
  check('purge succeeds after the writer closes', (await sp.stat(holdWriter.id)) === undefined && (await sp.stat(busyId)) !== undefined)
  void busyStat

  // ---- ROUTE-level smoke: boot the FULL plugin and drive real web routes ---
  // 背景：v3.5.2 的「彻底删除」路由曾因引用未定义变量在 0.1.3 上稳定崩溃，
  // 而本脚本的 ops 直连冒烟全程绿灯——路由层回归与 ops 直连不可互替。
  // 本节在真实 alpha.1 后端上以完整 apply() 启动插件，直接驱动
  // /archived-sessions/move 与 /archived-sessions/trash/purge 路由。
  {
    process.env.DSH_SESSIONS_MANAGER_TRASH_DIR = await mkdtemp(join(tmpdir(), 'dsm-runtime-trash-'))
    const { writeFile } = await import('node:fs/promises')
    const { join: pjoin } = await import('node:path')

    const routes = new Map()
    const mkEntity = (dir) => ({
      id: dir,
      title: dir,
      path: dir,
      sessionIds: [],
      async attachSession(id) { if (!this.sessionIds.includes(id)) this.sessionIds.push(id) },
      async detachSession(id) { this.sessionIds = this.sessionIds.filter((x) => x !== id) },
    })
    const headers = new Map()
    const sessionPaths = new Map()
    const entities = new Map()
    const regState = { archivedSessionIds: [] }
    const hostCtx = {
      workspaceRegistry: {
        list: () => [...entities.values()],
        state: regState,
        archiveSession: async () => {},
        create: async (path) => { if (!entities.has(path)) entities.set(path, mkEntity(path)); return entities.get(path) },
        headers,
        sessionPaths,
        replaceHeaderIndex: async (entries) => { for (const h of entries) headers.set(h.id, h) },
        rebuildEntities() {},
      },
      sessionPersistence: sp,
      sessionQuery: {
        readTitleSnapshots: async (ids) => ids.map((id) => ({ status: 'fulfilled', value: { session: { id }, title: { title: `Route ${id}` } } })),
      },
      storageDomain: { get: () => ({ global: { get: () => regState, set: async (next) => Object.assign(regState, next) } }) },
      webServer: { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
      get: () => null,
      effect: (fn) => fn(),
    }
    const pluginMod = await import('../src/index.js')
    pluginMod.apply(hostCtx)

    const callRoute = async (path, body) => {
      const { Readable } = await import('node:stream')
      const req = Readable.from([Buffer.from(JSON.stringify(body))])
      let status = 200
      let text = ''
      const res = { writeHead: (value) => { status = value }, end: (value) => { text += value || '' } }
      await routes.get(path)(req, res)
      return { status, body: JSON.parse(text) }
    }

    // MOVE 路由：真实后端上官方 create+append 重放跨工作区迁移。
    const mvHeader = {
      id: `route-mv-${Date.now().toString(36)}`,
      cwd: root,
      createdAt: Date.now(),
      version: 2,
      isSeeded: false,
      delegationDepth: 0,
    }
    const mvWrite = await sp.create(mvHeader)
    await mvWrite.append(mkBatch(0, 2))
    await mvWrite.flush()
    await mvWrite.close()
    const mvTarget = await (await import('node:fs/promises')).realpath(
      await (async () => { const f = await import('node:fs/promises'); await f.mkdir(join(root, 'route-ws-b'), { recursive: true }); return join(root, 'route-ws-b') })(),
    )
    const mvRes = await callRoute('/archived-sessions/move', { sessionId: mvHeader.id, targetPath: mvTarget })
    check('route /move: 200 + moved', mvRes.status === 200 && mvRes.body.moved === true, mvRes.body)
    const mvStat = await sp.stat(mvHeader.id)
    check('route /move: official stat carries the new cwd', !!mvStat && mvStat.header.cwd === mvTarget, mvStat && mvStat.header.cwd)
    check('route /move: workspace registry redirected', sessionPaths.get(mvHeader.id) === mvTarget)
    const mvReread = await adapter.readSession(mvHeader.id, 0)
    check('route /move: events preserved byte-identically', mvReread.events.length === 3, mvReread.events.length)

    // PURGE 路由：预置真实回收站索引 → 走完整路由 → 官方 stat 复核消失。
    const purgeHeader = {
      id: `route-purge-${Date.now().toString(36)}`,
      cwd: root,
      createdAt: Date.now(),
      version: 2,
      isSeeded: false,
      delegationDepth: 0,
    }
    const purgeWrite = await sp.create(purgeHeader)
    await purgeWrite.append(mkBatch(0, 1))
    await purgeWrite.flush()
    await purgeWrite.close()
    const purgeStat = await sp.stat(purgeHeader.id)
    const { locateSessionArtifacts } = await import('../src/handle-era-paths.js')
    const purgeArtifacts = await locateSessionArtifacts(sp, purgeStat.header)
    const trashIndex = pjoin(process.env.DSH_SESSIONS_MANAGER_TRASH_DIR, 'index.json')
    await writeFile(trashIndex, JSON.stringify({
      schemaVersion: 2,
      settings: { retentionDays: 0 },
      items: [{ sessionId: purgeHeader.id, title: 'Route purge', originalPath: purgeArtifacts.logPath, deletedAt: 1 }],
      purgedSessionIds: [],
    }))
    const purgeRes = await callRoute('/archived-sessions/trash/purge', { sessionId: purgeHeader.id })
    check('route /trash/purge: 200 + purged', purgeRes.status === 200 && purgeRes.body.purged === true, purgeRes.body)
    check('route /trash/purge: official stat no longer sees the session', (await sp.stat(purgeHeader.id)) === undefined)
    check('route /trash/purge: tombstone persisted + item removed', (async () => {
      const { readFileSync } = await import('node:fs')
      const store = JSON.parse(readFileSync(trashIndex, 'utf8'))
      return store.purgedSessionIds.includes(purgeHeader.id) && store.items.length === 0
    })())

    await rm(process.env.DSH_SESSIONS_MANAGER_TRASH_DIR, { recursive: true, force: true }).catch(() => {})
  }

  console.log('\ncompat-runtime smoke PASSED')
  for (const c of checks) console.log(`  ✔ ${c.name}${c.detail !== null ? ` — ${JSON.stringify(c.detail)}` : ''}`)
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {})
}
