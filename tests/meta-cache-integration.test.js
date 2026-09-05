// issue #1 回归：列表构建的元数据缓存行为（host 级）。
// 断言三件事：
//   1. 首次 /sessions 对未缓存会话做**一次**批量投影（sq.readTitleSnapshots）
//   2. 日志文件没变时，第二次 /sessions 完全命中缓存，零投影调用
//   3. touch 日志（mtime 变）后，该会话重新投影一次（指纹失效 → 增量刷新）
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Readable } from 'node:stream'
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

let root
let routes
let sessionPath
let projectedIds

function buildCtx(routesMap) {
  const header = { id: 'cache-1', cwd: root, title: 'Cached session', createdAt: 1 }
  return {
    workspaceRegistry: { list: () => [], state: { archivedSessionIds: [] }, archiveSession: async () => {} },
    sessionPersistence: {
      list: async () => [header],
      locate: () => ({ path: sessionPath }),
      readFrom: async () => ({ meta: header, events: [] }),
    },
    sessionQuery: {
      readTitleSnapshot: async () => ({ session: header, title: { title: 'Cached session' } }),
      readTitleSnapshots: async (ids) => {
        projectedIds.push(...ids.map(String))
        return ids.map(() => ({ status: 'fulfilled', value: { session: header, title: { title: 'Cached session' } } }))
      },
    },
    storageDomain: { get: () => ({ global: { get: () => ({ archivedSessionIds: [] }), set: async () => {} } }) },
    webServer: { register: (route) => { routesMap.set(route.path, route.handler); return () => {} } },
    get: () => null,
    effect: (fn) => fn(),
  }
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsm-cache-'))
  process.env.DSH_SESSIONS_MANAGER_TRASH_DIR = join(root, 'trash')
  await mkdir(process.env.DSH_SESSIONS_MANAGER_TRASH_DIR, { recursive: true })
  const { apply } = await import(`../src/index.js?cache=${Date.now()}`)
  routes = new Map()
  sessionPath = join(root, 'cache-1', 'session.jsonl.zstd')
  await mkdir(dirname(sessionPath), { recursive: true })
  await writeFile(sessionPath, 'x')
  projectedIds = []
  apply(buildCtx(routes))
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

test('first list build projects the cold session exactly once, second build hits the cache', async () => {
  const first = await call('/archived-sessions/sessions', {})
  assert.equal(first.status, 200)
  assert.deepEqual(projectedIds, ['cache-1'])

  await call('/archived-sessions/sessions', {})
  assert.deepEqual(projectedIds, ['cache-1'], 'warm list must not re-project any session')
})

test('touching the log invalidates the fingerprint and re-projects just that session', async () => {
  const far = new Date(Date.now() + 60_000)
  await utimes(sessionPath, far, far)
  const again = await call('/archived-sessions/sessions', {})
  assert.equal(again.status, 200)
  assert.deepEqual(projectedIds, ['cache-1', 'cache-1'])
  assert.equal(again.body.items[0].title, 'Cached session')
})

// ---- P4：持久标题索引（冷启动零解码）---------------------------------------

const INDEX_PATH = () => join(process.env.DSH_SESSIONS_MANAGER_TRASH_DIR, 'title-index.json')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForIndex() {
  // persistDecoded 是 fire-and-forget：轮询等它落盘（生产路径不等待，仅测试等）。
  for (let i = 0; i < 40; i++) {
    try { return JSON.parse(await readFile(INDEX_PATH(), 'utf8')) } catch (e) { await sleep(50) }
  }
  return null
}

test('list builds persist decoded metadata to the title index', async () => {
  const stored = await waitForIndex()
  assert.ok(stored, 'title-index.json must be written after a list build')
  assert.equal(stored.schemaVersion, 1)
  assert.equal(stored.entries['cache-1'].title, 'Cached session')
  assert.equal(typeof stored.entries['cache-1'].fingerprint, 'string')
})

test('a cold-start instance reuses the persisted index and skips projection entirely', async () => {
  const before = projectedIds.length
  // 新的动态 import = 新的插件实例（apply 闭包内的内存缓存为空），
  // 但 TRASH_DIR 相同 → 持久索引共享，等价于「重启后第一次列表」。
  const { apply: applyCold } = await import(`../src/index.js?cold=${Date.now()}`)
  const coldRoutes = new Map()
  applyCold(buildCtx(coldRoutes))
  const coldCall = async (path, body = {}) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))])
    let status = 200
    let text = ''
    const res = { writeHead: (v) => { status = v }, end: (v) => { text += v || '' } }
    await coldRoutes.get(path)(req, res)
    return { status, body: JSON.parse(text) }
  }
  const cold = await coldCall('/archived-sessions/sessions', {})
  assert.equal(cold.status, 200)
  assert.deepEqual(cold.body.items[0].title, 'Cached session')
  assert.equal(projectedIds.length, before, 'cold start must be served from the persisted index, not projection')
})

test('hard purge removes the entry from the persisted index', async () => {
  await waitForIndex()
  const before = projectedIds.length
  await call('/archived-sessions/delete', { sessionId: 'cache-1' })
  const purged = await call('/archived-sessions/trash/purge', { sessionId: 'cache-1' })
  assert.equal(purged.body.purged, true)
  // titleIndex.remove 也是 fire-and-forget：轮询确认条目被清掉。
  let entries = null
  for (let i = 0; i < 40; i++) {
    entries = await waitForIndex()
    if (entries && !('cache-1' in entries.entries)) break
    await sleep(50)
  }
  assert.ok(entries, 'index must remain readable')
  assert.equal('cache-1' in entries.entries, false)
  assert.equal(projectedIds.length, before)
})
