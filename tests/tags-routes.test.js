// 标签 / 保存筛选路由（3.7.0 host 层）的路由级回归。
// 主链路：create → set → /sessions 带 tags → rename → merge →（delete / purge
// 后悬空消失）→ filters save/list/delete；外加旧宿主字段兼容（/sessions items
// 只是多字段）与各错误码（DSM_TAG_* / DSM_FILTER_* / star 的 code 补齐）至少一例。
// boot 沿用 tests/warm-tristate.test.js 的假 ctx 模式（legacy 世代）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Readable } from 'node:stream'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function boot(opts = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsm-tags-routes-'))
  const trashDir = join(root, 'trash')
  process.env.DSH_SESSIONS_MANAGER_TRASH_DIR = trashDir
  process.env.DSH_SESSIONS_MANAGER_STAR_DIR = join(root, 'state')
  process.env.DSH_SESSIONS_MANAGER_PENDING_DIR = join(root, 'pending')
  await mkdir(trashDir, { recursive: true })

  const ids = opts.ids || ['s1', 's2']
  const sessionsDir = join(root, 'logs')
  const headerOf = (id) => ({ id, cwd: root, createdAt: 1 })
  const logPath = (id) => join(sessionsDir, `${id}.jsonl.zstd`)
  for (const id of ids) {
    await mkdir(dirname(logPath(id)), { recursive: true })
    await writeFile(logPath(id), 'x'.repeat(10))
  }
  const routes = new Map()
  const ctx = {
    workspaceRegistry: { list: () => [], state: { archivedSessionIds: [] }, archiveSession: async () => {} },
    // list 读磁盘现状（同 host.test.js）：purge 的 unlink 必须真实反映到列表。
    sessionPersistence: {
      list: async () => ids.filter((id) => existsSync(logPath(id))).map(headerOf),
      locate: (h) => ({ path: logPath(h.id) }),
      readFrom: async (id) => ({ meta: headerOf(id), events: [] }),
    },
    sessionQuery: {
      readTitleSnapshots: async (reqIds) => reqIds.map((id) => ({
        status: 'fulfilled', value: { session: headerOf(String(id)), title: { title: `T-${id}` } },
      })),
    },
    storageDomain: { get: () => ({ global: { get: () => ({ archivedSessionIds: [] }), set: async () => {} } }) },
    webServer: { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
    get: () => null,
    effect: (fn) => fn(),
  }
  const { apply } = await import(`../src/index.js?tags-routes=${Date.now()}-${Math.random()}`)
  apply(ctx)
  const call = async (path, body = {}) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))])
    let status = 200
    let text = ''
    const res = { writeHead: (v) => { status = v }, end: (v) => { text += v || '' } }
    await routes.get(path)(req, res)
    return { status, body: JSON.parse(text) }
  }
  return { root, call, stateDir: process.env.DSH_SESSIONS_MANAGER_STAR_DIR }
}

// 后台预热会浮动落盘 title-index.json（本仓库已知 teardown 竞态，见 index.js
// persistDecoded 注释）——重试式清理。
async function cleanup(b) {
  for (let i = 0; i < 60; i++) {
    try { await rm(b.root, { recursive: true, force: true }); return }
    catch (e) { if (e && e.code === 'ENOTEMPTY') { await sleep(50); continue } throw e }
  }
}

test('tags main chain: create → set → /sessions tags → rename → merge; delete & purge leave no ghosts', async () => {
  const b = await boot()
  try {
    // create
    const made = await b.call('/archived-sessions/tags/create', { name: ' 重要 ' })
    assert.equal(made.status, 200)
    assert.equal(made.body.ok, true)
    assert.equal(made.body.tag.name, '重要')
    assert.match(made.body.tag.id, /^t_[a-z0-9]{8}$/)
    const important = made.body.tag
    const todo = (await b.call('/archived-sessions/tags/create', { name: '待办' })).body.tag
    const temp = (await b.call('/archived-sessions/tags/create', { name: '临时' })).body.tag
    assert.equal((await b.call('/archived-sessions/tags/list', {})).body.tags.length, 3)

    // set（全量替换），响应带整个 assignments 映射
    const set1 = await b.call('/archived-sessions/tags/set', { sessionId: 's1', tagIds: [important.id, todo.id] })
    assert.equal(set1.body.ok, true)
    assert.deepEqual(set1.body.assignments.s1, [important.id, todo.id])
    await b.call('/archived-sessions/tags/set', { sessionId: 's2', tagIds: [todo.id, temp.id] })

    // /sessions：旧字段原样（兼容），只多了 tags；值为 tagId 数组。
    const panel = await b.call('/archived-sessions/sessions', {})
    assert.equal(panel.status, 200)
    assert.equal(typeof panel.body.warmPending, 'boolean', '旧宿主响应字段还在')
    const byId = Object.fromEntries(panel.body.items.map((it) => [it.sessionId, it]))
    assert.deepEqual(byId.s1.tags, [important.id, todo.id])
    assert.deepEqual(byId.s2.tags, [todo.id, temp.id])
    for (const it of panel.body.items) {
      assert.ok('title' in it && 'archived' in it && 'starred' in it, '旧字段不丢')
    }

    // rename：id 不变，赋值不动。
    const renamed = await b.call('/archived-sessions/tags/rename', { id: important.id, name: '核心' })
    assert.deepEqual(renamed.body, { ok: true })
    const listed = await b.call('/archived-sessions/tags/list', {})
    assert.equal(listed.body.tags.find((t) => t.id === important.id).name, '核心')
    assert.deepEqual(listed.body.assignments.s1, [important.id, todo.id])

    // merge 待办 → 核心：两行去重落到目标，源消失。
    const merged = await b.call('/archived-sessions/tags/merge', { fromId: todo.id, toId: important.id })
    assert.deepEqual(merged.body, { ok: true })
    const afterMerge = await b.call('/archived-sessions/tags/list', {})
    assert.equal(afterMerge.body.tags.some((t) => t.id === todo.id), false)
    assert.deepEqual(afterMerge.body.assignments.s1, [important.id])
    assert.deepEqual(afterMerge.body.assignments.s2, [temp.id, important.id])

    // delete 标签：只删元数据，会话与其余引用无损（红线）。
    const deleted = await b.call('/archived-sessions/tags/delete', { id: temp.id })
    assert.deepEqual(deleted.body, { ok: true })
    const panel2 = await b.call('/archived-sessions/sessions', {})
    const byId2 = Object.fromEntries(panel2.body.items.map((it) => [it.sessionId, it]))
    assert.equal(byId2.s2.tags.includes(temp.id), false, '被删标签从行上消失')
    assert.deepEqual(byId2.s2.tags, [important.id], '同行其余标签保留')
    assert.ok(byId2.s1 && byId2.s2, 'delete 标签绝不伤会话')
    // 悬空渲染防御：手工往 tags.json 塞一个未知 tagId（模拟旧文件/外部改动），
    // /sessions 必须把它过滤掉，绝不渲染幽灵。
    const { readFile, writeFile: wf } = await import('node:fs/promises')
    const tagsFile = join(b.stateDir, 'tags.json')
    const raw = JSON.parse(await readFile(tagsFile, 'utf8'))
    raw.assignments.s2 = [important.id, 't_ghost9']
    raw.tags.push({ id: 't_ghost9', name: '' }) // 坏定义：normalize 直接丢
    await wf(tagsFile, JSON.stringify(raw))
    const panel3 = await b.call('/archived-sessions/sessions', {})
    const byId3 = Object.fromEntries(panel3.body.items.map((it) => [it.sessionId, it]))
    assert.deepEqual(byId3.s2.tags, [important.id], '悬空 tagId 渲染时被过滤')
    // 幂等：重删未知 id 也回 ok。
    assert.deepEqual((await b.call('/archived-sessions/tags/delete', { id: 't_nope' })).body, { ok: true })

    // purge 路径（S4 教训位）：彻底删除 s2 后，assignments 里不得留幽灵行。
    assert.equal((await b.call('/archived-sessions/delete', { sessionId: 's2' })).body.trashed, true)
    assert.equal((await b.call('/archived-sessions/trash/purge', { sessionId: 's2' })).body.purged, true)
    const afterPurge = await b.call('/archived-sessions/tags/list', {})
    assert.equal('s2' in afterPurge.body.assignments, false, 'purge 必须 await 掉标签清理')
    assert.deepEqual(afterPurge.body.assignments.s1, [important.id], '别的会话不受牵连')
  } finally { await cleanup(b) }
})

test('tags routes carry stable error codes (400/404/409)', async () => {
  const b = await boot()
  try {
    const a = (await b.call('/archived-sessions/tags/create', { name: 'Alpha' })).body.tag
    const z = (await b.call('/archived-sessions/tags/create', { name: 'Zeta' })).body.tag

    // 400：空名 / 超长名 / 缺失 body 字段
    let r = await b.call('/archived-sessions/tags/create', { name: '   ' })
    assert.equal(r.status, 400)
    assert.equal(r.body.code, 'DSM_TAG_NAME_INVALID')
    r = await b.call('/archived-sessions/tags/create', { name: 'x'.repeat(25) })
    assert.equal(r.status, 400)
    assert.equal(r.body.code, 'DSM_TAG_NAME_INVALID')

    // 409：重名（casefold 不敏感）
    r = await b.call('/archived-sessions/tags/create', { name: ' alpha ' })
    assert.equal(r.status, 409)
    assert.equal(r.body.code, 'DSM_TAG_EXISTS')
    r = await b.call('/archived-sessions/tags/rename', { id: a.id, name: 'ZETA' })
    assert.equal(r.status, 409)
    assert.equal(r.body.code, 'DSM_TAG_EXISTS')

    // 404：rename/merge 引用未知标签
    r = await b.call('/archived-sessions/tags/rename', { id: 't_missing1', name: 'ok' })
    assert.equal(r.status, 404)
    assert.equal(r.body.code, 'DSM_TAG_NOT_FOUND')
    r = await b.call('/archived-sessions/tags/merge', { fromId: a.id, toId: 't_missing1' })
    assert.equal(r.status, 404)
    assert.equal(r.body.code, 'DSM_TAG_NOT_FOUND')

    // set：会话 id 走 isSafeSessionId；未知 tagId → 400；单会话 >10 → 409
    r = await b.call('/archived-sessions/tags/set', { sessionId: '../escape', tagIds: [a.id] })
    assert.equal(r.status, 400)
    assert.equal(r.body.code, 'DSM_TAG_SESSION_INVALID')
    r = await b.call('/archived-sessions/tags/set', { sessionId: 's1', tagIds: ['t_ghost1'] })
    assert.equal(r.status, 400)
    assert.equal(r.body.code, 'DSM_TAG_UNKNOWN')
    r = await b.call('/archived-sessions/tags/set', { sessionId: 's1', tagIds: 'not-an-array' })
    assert.equal(r.status, 400)
    assert.equal(r.body.code, 'DSM_TAG_IDS_INVALID')
    const extra = [a.id, z.id]
    for (let i = 0; i < 9; i++) extra.push((await b.call('/archived-sessions/tags/create', { name: `x-${i}` })).body.tag.id)
    r = await b.call('/archived-sessions/tags/set', { sessionId: 's1', tagIds: extra }) // 11 > 10
    assert.equal(r.status, 409)
    assert.equal(r.body.code, 'DSM_TAG_LIMIT')
  } finally { await cleanup(b) }
})

test('tags global cap surfaces at the route (200 max)', async () => {
  const b = await boot({ ids: ['s1'] })
  try {
    for (let i = 0; i < 200; i++) {
      const r = await b.call('/archived-sessions/tags/create', { name: `tag-${i}` })
      assert.equal(r.status, 200, `create #${i} failed early`)
    }
    const r = await b.call('/archived-sessions/tags/create', { name: 'one too many' })
    assert.equal(r.status, 409)
    assert.equal(r.body.code, 'DSM_TAG_LIMIT')
    const listed = await b.call('/archived-sessions/tags/list', {})
    assert.equal(listed.body.tags.length, 200)
  } finally { await cleanup(b) }
})

test('filters routes: save → list → delete round-trip + error codes', async () => {
  const b = await boot({ ids: ['s1'] })
  try {
    const payload = { workspaces: ['/ws/a'], tags: ['t_deadbeef'], archived: 'any', sort: 'newest' }
    const saved = await b.call('/archived-sessions/filters/save', { name: '未归档重点', filters: payload })
    assert.equal(saved.status, 200)
    assert.equal(saved.body.ok, true)
    assert.match(saved.body.item.id, /^f_[a-z0-9]{8}$/)
    assert.deepEqual(saved.body.item.filters, payload, '不透明载荷原样回读')
    const dup = await b.call('/archived-sessions/filters/save', { name: ' 未归档重点 ', filters: {} })
    assert.equal(dup.status, 409)
    assert.equal(dup.body.code, 'DSM_FILTER_EXISTS')
    const big = await b.call('/archived-sessions/filters/save', { name: 'big', filters: 'x'.repeat(3000) })
    assert.equal(big.status, 400)
    assert.equal(big.body.code, 'DSM_FILTER_TOO_LARGE')
    const badName = await b.call('/archived-sessions/filters/save', { name: '', filters: {} })
    assert.equal(badName.status, 400)
    assert.equal(badName.body.code, 'DSM_FILTER_NAME_INVALID')
    await b.call('/archived-sessions/filters/save', { name: '另一条', filters: { starred: true } })
    const list = await b.call('/archived-sessions/filters/list', {})
    assert.equal(list.body.ok, true)
    assert.deepEqual(list.body.items.map((i) => i.name), ['未归档重点', '另一条'])
    const gone = await b.call('/archived-sessions/filters/delete', { ids: [saved.body.item.id, 'f_nope'] })
    assert.deepEqual(gone.body, { ok: true, removed: 1 })
    assert.deepEqual((await b.call('/archived-sessions/filters/list', {})).body.items.map((i) => i.name), ['另一条'])
    const missingIds = await b.call('/archived-sessions/filters/delete', {})
    assert.equal(missingIds.status, 400)
    assert.equal(missingIds.body.code, 'DSM_FILTER_IDS_INVALID')
  } finally { await cleanup(b) }
})

test('filters global cap surfaces at the route (20 max)', async () => {
  const b = await boot({ ids: ['s1'] })
  try {
    for (let i = 0; i < 20; i++) {
      const r = await b.call('/archived-sessions/filters/save', { name: `f-${i}`, filters: { i } })
      assert.equal(r.status, 200, `save #${i} failed early`)
    }
    const r = await b.call('/archived-sessions/filters/save', { name: 'f-20', filters: {} })
    assert.equal(r.status, 409)
    assert.equal(r.body.code, 'DSM_FILTER_LIMIT')
  } finally { await cleanup(b) }
})

test('star/set keeps its shape and now carries codes on failures', async () => {
  const b = await boot({ ids: ['s1'] })
  try {
    const ok = await b.call('/archived-sessions/star/set', { sessionId: 's1', starred: true })
    assert.equal(ok.status, 200)
    assert.deepEqual(ok.body, { ok: true, starredSessionIds: ['s1'] })
    const un = await b.call('/archived-sessions/star/set', { sessionId: 's1', starred: false })
    assert.deepEqual(un.body.starredSessionIds, [])
    const bad = await b.call('/archived-sessions/star/set', {})
    assert.equal(bad.status, 400)
    assert.equal(bad.body.code, 'DSM_STAR_SESSION_INVALID', 'code 补齐（响应形状兼容，只多字段）')
  } finally { await cleanup(b) }
})

// 3.7.0 P4：/sessions 带出 updatedAt（=日志文件 mtime）——分支组 createdAt
// 缺失时的时间回退键（logic.branchTimeKey）；legacy 世代有 stat 即有值。
test('/sessions items carry updatedAt for branch-group time fallback', async () => {
  const b = await boot({ ids: ['u1'] })
  try {
    const r = await b.call('/archived-sessions/sessions', {})
    assert.equal(r.status, 200)
    const item = r.body.items.find((i) => i.sessionId === 'u1')
    assert.ok(item && Number.isFinite(item.updatedAt), 'legacy-era item must carry file mtime: ' + JSON.stringify(item))
  } finally { await cleanup(b) }
})
