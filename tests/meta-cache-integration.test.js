// issue #1 回归：列表构建的元数据缓存行为（host 级）。
// 断言三件事：
//   1. 首次 /sessions 对未缓存会话做**一次**批量投影（sq.readTitleSnapshots）
//   2. 日志文件没变时，第二次 /sessions 完全命中缓存，零投影调用
//   3. touch 日志（mtime 变）后，该会话重新投影一次（指纹失效 → 增量刷新）
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Readable } from 'node:stream'
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

let root
let routes
let sessionPath
let projectedIds

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsm-cache-'))
  process.env.DSH_SESSIONS_MANAGER_TRASH_DIR = join(root, 'trash')
  await mkdir(process.env.DSH_SESSIONS_MANAGER_TRASH_DIR, { recursive: true })
  const { apply } = await import(`../src/index.js?cache=${Date.now()}`)
  routes = new Map()
  sessionPath = join(root, 'cache-1', 'session.jsonl.zstd')
  await mkdir(dirname(sessionPath), { recursive: true })
  await writeFile(sessionPath, 'x')
  const header = { id: 'cache-1', cwd: root, title: 'Cached session', createdAt: 1 }
  projectedIds = []
  const ctx = {
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
