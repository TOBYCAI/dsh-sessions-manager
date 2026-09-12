// 3.7.0 T1 专项回归：精判彻底移出请求路径之后的两条硬承诺。
//   1) 首拍零解码（v3.6.2 的「预算内串行解码仍在请求里」是过渡形态，此处正式归零）；
//   2) 精判结论跨重启复用（empty-scan.json，sz 指纹 + TTL），冷实例首拍零解码；
//   3) legacy 世代（列表无 sizeBytes）：永不候选、refinePending 恒 false——
//      「永久 busy 让 client 疯轮询」是唯一现实的假忙陷阱，用反例锁死。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Readable } from 'node:stream'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(cond, msg, limit = 200) {
  for (let i = 0; i < limit; i++) {
    const v = await cond()
    if (v) return v
    await sleep(25)
  }
  assert.fail(msg || 'condition not met')
}

function makeCtx(routes, opens, { era = 'handle' } = {}) {
  const root = process.env.DSM_TEST_ROOT
  const mk = (id, extra = {}, sizeBytes = 900) => ({
    header: { id, cwd: root, createdAt: 1, isSeeded: false, delegationDepth: 0, ...extra },
    revision: `rev-${id}`,
    sizeBytes,
  })
  const snapshots = [
    mk('sub-9', { origin: 'subagent', parentSession: 'p9', delegationDepth: 1 }),
    mk('empty-9', {}, 150),
    mk('p9'),
  ]
  const sessionPersistence = era === 'handle'
    ? {
      list: async () => snapshots,
      open: async (id) => {
        opens.push(String(id))
        const types = id === 'empty-9' ? ['permission/preset', 'sandbox/mode', 'approval/policy'] : ['user/message']
        let done = false
        return { read: async () => { if (done) return []; done = true; return types.map((type) => ({ type })) }, close: async () => {} }
      },
      stat: async () => undefined,
    }
    : {
      // legacy：list 返回裸 header（无 sizeBytes / revision）
      list: async () => snapshots.map((s) => s.header),
      readFrom: async (id) => ({ meta: snapshots.find((s) => s.header.id === id).header, events: [] }),
    }
  return {
    workspaceRegistry: { list: () => [], state: { archivedSessionIds: [] }, archiveSession: async () => {} },
    sessionPersistence,
    sessionQuery: { readTitleSnapshots: async () => [], readTitleSnapshot: async () => null },
    storageDomain: { get: () => ({ global: { get: () => ({ archivedSessionIds: [] }), set: async () => {} } }) },
    webServer: { register: (r) => { routes.set(r.path, r.handler); return () => {} } },
    get: () => null,
    effect: (fn) => fn(),
  }
}

async function callOn(routes, path, body = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))])
  let status = 200
  let text = ''
  const res = { writeHead: (v) => { status = v }, end: (v) => { text += v || '' } }
  await routes.get(path)(req, res)
  return { status, body: JSON.parse(text) }
}

let root
test('request path decodes zero logs; refinement converges in the background and persists', async () => {
  root = await mkdtemp(join(tmpdir(), 'dsm-er-'))
  process.env.DSH_SESSIONS_MANAGER_TRASH_DIR = join(root, 'trash')
  process.env.DSH_SESSIONS_MANAGER_STAR_DIR = join(root, 'state')
  process.env.DSH_SESSIONS_MANAGER_PENDING_DIR = join(root, 'pending')
  process.env.DSM_TEST_ROOT = root
  await mkdir(process.env.DSH_SESSIONS_MANAGER_TRASH_DIR, { recursive: true })
  const routes = new Map()
  const opens = []
  const { apply } = await import(`../src/index.js?er=${Date.now()}`)
  apply(makeCtx(routes, opens))
  const first = await callOn(routes, '/archived-sessions/sidebar-state')
  assert.equal(first.body.refinePending, true)
  assert.deepEqual(opens, [], 'first beat must not decode anything (request path zero-decode, T1 completion)')
  await waitFor(async () => opens.length >= 2 && !(await callOn(routes, '/archived-sessions/sidebar-state')).body.refinePending, 'refine never converged', 400)
  const settled = await callOn(routes, '/archived-sessions/sidebar-state')
  assert.equal(settled.body.lineage['empty-9'].empty, true)
  assert.equal(settled.body.lineage['sub-9'].empty, false)

  // —— 「重启」：新实例同目录 → 冷读持久层，首拍即定论且 opens 恒 0 ——
  const routes2 = new Map()
  const opens2 = []
  const { apply: apply2 } = await import(`../src/index.js?er-cold=${Date.now()}`)
  apply2(makeCtx(routes2, opens2))
  const cold = await callOn(routes2, '/archived-sessions/sidebar-state')
  assert.deepEqual(opens2, [], 'persisted verdicts must serve the cold instance without a single decode')
  assert.equal(cold.body.lineage['empty-9'].empty, true)
  assert.equal(cold.body.refinePending, false)
  await rm(root, { recursive: true, force: true })
})

test('legacy era never claims refine work (no sizeBytes observation)', async () => {
  const routes = new Map()
  const opens = []
  const { apply } = await import(`../src/index.js?er-legacy=${Date.now()}`)
  apply(makeCtx(routes, opens, { era: 'legacy' }))
  const r = await callOn(routes, '/archived-sessions/sidebar-state')
  assert.equal(r.body.refinePending, false, 'legacy has no candidates — a stuck pending would make clients poll forever')
  assert.equal(r.body.lineage['sub-9'].empty, null, 'structural rows still publish, empty stays unknown')
  await sleep(60)
  assert.deepEqual(opens, [], 'legacy must never decode (candidate gate)')
})
