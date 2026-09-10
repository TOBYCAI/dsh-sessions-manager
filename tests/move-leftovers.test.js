// 回归：移动后源目录必须整体消失（0.1.5 多代共存的 duplicate 根因）。
//
// 背景（2026-09-10 实测）：0.1.5 引入 session format v3 后，官方在
// `open(id,'write')` 时会「发布当前代」（历史日志 v0/v2 → 落盘成 v3）且**不删旧代**；
// 同一会话目录里 session.v2 与 session.v3 并存。历史版本的移动只搬走当前代、
// 且"源目录仍有真实日志就保留目录"，于是同一个 id 同时出现在源与目标两个项目
// 目录，官方 listArtifacts/stat 立刻抛
//   duplicate JSONL session id "…" appears in multiple project directories
// 导致移动失败并回滚（用户实测报错）。
//
// 本文件锁定四条修正：
//   1. 写所有权探测（可能发布新代）必须在定位之前 —— 否则搬的是"探测前"的旧路径，
//      新代留在源目录；
//   2. 移动成功后源目录**整体移除**（含 legacy v0 代与任何被取代的旧代）；
//   3. 其它项目目录里"只含被取代旧代"的副本自动回收并回报，不再让用户永久卡住；
//   4. 版本相同/更高的跨目录副本仍是真重复 → 409 DSM_SESSION_DUP_LOG，交人工裁决。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { moveSessionToCwd } from '../src/handle-era-ops.js'
import { encodeSegmentFor, locateSessionArtifacts, projectKeyFor } from '../src/handle-era-paths.js'

const EVENTS = [{ type: 'user/message', data: { content: [{ type: 'text', text: 'hi' }] }, seq: 0 }]

async function makeRoot(tag) {
  const root = await mkdtemp(join(tmpdir(), `dsm-leftover-${tag}-`))
  await mkdir(join(root, 'ws-old'), { recursive: true })
  await mkdir(join(root, 'ws-new'), { recursive: true })
  return { root, oldCwd: await realpath(join(root, 'ws-old')), newCwd: await realpath(join(root, 'ws-new')) }
}

// 假后端：以「磁盘现状」为准；open(id,'write') 若要模拟 0.1.5 的迁移发布，
// 就把当前代（最高代）落盘，并保留旧代 —— 与官方 publishStoredMigration 一致。
// 另外每次 create 之前先跑一次「官方式全盘扫描」（listArtifacts 等价物）：官方
// listSessionDirs 枚举项目目录下的**所有**子目录、逐个读日志头，因此窗口期里只要
// 还有第二个目录持有该 id 的日志（无论哪一代），真实后端就会抛 duplicate。
function makeBackend({ root, publishOnWrite = false, generation = 2 }) {
  const sessionDirFor = (cwd, id) => join(root, projectKeyFor(cwd), encodeSegmentFor(id))
  const GEN_RE = /^session(\.v\d+)?\.jsonl(\.zst(d)?)?$/
  const highestGeneration = async (dir) => {
    let names
    try { names = await readdir(dir) } catch { return null }
    const gens = names.filter((n) => GEN_RE.test(n))
    if (gens.length === 0) return null
    const version = (n) => Number((n.match(/^session\.v(\d+)\./) || [])[1] || 0)
    return gens.sort((a, b) => version(b) - version(a))[0]
  }
  // 官方 listArtifacts 等价物：扫描 root 下所有项目目录的所有子目录，统计持有
  // 规范日志的目录数（不按目录名过滤）。
  const officialScanHolders = async () => {
    const holders = []
    for (const proj of await readdir(root)) {
      const projDir = join(root, proj)
      let subs
      try { subs = await readdir(projDir, { withFileTypes: true }) } catch { continue }
      for (const sub of subs) {
        if (!sub.isDirectory()) continue
        const dir = join(projDir, sub.name)
        if (await highestGeneration(dir)) holders.push(dir)
      }
    }
    return holders
  }
  return {
    root,
    async list() { return [] },
    async stat(id) {
      // 官方 findLog：只看 join(project, encodeSegment(id))
      for (const cwd of [this.__old, this.__new]) {
        if (!cwd) continue
        const dir = sessionDirFor(cwd, id)
        const gen = await highestGeneration(dir)
        if (gen) return { header: { id, cwd, createdAt: 1, version: generation, isSeeded: false, delegationDepth: 0 }, revision: 'r', eventCount: EVENTS.length }
      }
      return undefined
    },
    async open(id, access) {
      if (access !== 'write') {
        return { header: { id, cwd: this.__old, createdAt: 1, version: generation, isSeeded: false, delegationDepth: 0 }, inheritedEventCount: 0, async read() { return [] }, async close() {} }
      }
      if (publishOnWrite) {
        // 官方语义：为历史代发布当前代（v3），且**不删**旧代。
        const dir = sessionDirFor(this.__old, id)
        if (existsSync(dir)) {
          const cur = await highestGeneration(dir)
          if (cur && !cur.includes('.v3.')) {
            await writeFile(join(dir, 'session.v3.jsonl.zstd'), Buffer.from('published-v3'))
          }
        }
      }
      return { header: { id, cwd: this.__old, createdAt: 1, version: generation, isSeeded: false, delegationDepth: 0 }, inheritedEventCount: 0, async read() { return [] }, async close() {} }
    },
    async create(newHeader) {
      // create 前先做官方式全盘扫描：此刻若仍有第二个目录持有该 id 的日志，
      // 真实后端会以 duplicate 拒绝（这正是 0.1.5 上移动失败的现场）。
      const holders = await officialScanHolders()
      const target = sessionDirFor(newHeader.cwd, newHeader.id)
      const others = holders.filter((d) => d !== target)
      if (others.length > 0) {
        const e = new Error(`duplicate JSONL session id "${newHeader.id}" appears in multiple project directories`)
        e.duplicateWindow = others
        throw e
      }
      const dir = target
      await mkdir(dir, { recursive: true })
      const name = generation === 0 ? 'session.jsonl.zstd' : `session.v${generation}.jsonl.zstd`
      await writeFile(join(dir, name), Buffer.from('moved'))
      return { async append() {}, async flush() {}, async close() {} }
    },
  }
}

const headerFor = (id, cwd, version = 2) => ({ id, cwd, createdAt: 1, version, isSeeded: false, delegationDepth: 0 })

test('探测期间发布的新代也被搬走：源目录整体消失，不留跨目录重复', async () => {
  const { root, oldCwd, newCwd } = await makeRoot('publish')
  const sid = 'sess-pub'
  const srcDir = join(root, projectKeyFor(oldCwd), encodeSegmentFor(sid))
  await mkdir(srcDir, { recursive: true })
  // 历史日志：legacy v0 + v2 两代（与真实磁盘形态一致）
  await writeFile(join(srcDir, 'session.jsonl.zstd'), Buffer.from('legacy-v0'))
  await writeFile(join(srcDir, 'session.v2.jsonl.zstd'), Buffer.from('v2'))

  const sp = makeBackend({ root, publishOnWrite: true })
  sp.__old = oldCwd
  sp.__new = newCwd

  const res = await moveSessionToCwd({ sp, sid, header: headerFor(sid, oldCwd), canonical: newCwd, events: EVENTS })

  assert.equal(res.sourceCleanup.cleaned, true)
  assert.equal(existsSync(srcDir), false, '源目录必须整体移除（含 v0 旧代）')
  const targetDir = join(root, projectKeyFor(newCwd), encodeSegmentFor(sid))
  assert.equal(existsSync(join(targetDir, 'session.v2.jsonl.zstd')), true, '目标目录必须有搬过去的日志')
  // 全盘只有一个目录持有该 id
  const holders = []
  for (const proj of await readdir(root)) {
    const d = join(root, proj, encodeSegmentFor(sid))
    if (existsSync(d) && (await readdir(d)).some((n) => /^session(\.v\d+)?\.jsonl(\.zst(d)?)?$/.test(n))) holders.push(d)
  }
  assert.equal(holders.length, 1, `同一 id 只应有一个目录持有日志，实际 ${holders.length}: ${holders.join(', ')}`)
})

test('只含被取代旧代的跨目录副本自动回收，并如实回报', async () => {
  const { root, oldCwd, newCwd } = await makeRoot('stale')
  const sid = 'sess-stale'
  const srcDir = join(root, projectKeyFor(oldCwd), encodeSegmentFor(sid))
  await mkdir(srcDir, { recursive: true })
  await writeFile(join(srcDir, 'session.v2.jsonl.zstd'), Buffer.from('v2-current'))

  // 第三个项目目录里只有一份 v0 旧代（历史移动残留）→ 被取代，可回收
  const staleProject = join(root, projectKeyFor(join(root, 'ws-third')))
  const staleDir = join(staleProject, encodeSegmentFor(sid))
  await mkdir(staleDir, { recursive: true })
  await writeFile(join(staleDir, 'session.jsonl.zstd'), Buffer.from('legacy-v0-stale'))

  const sp = makeBackend({ root })
  sp.__old = oldCwd
  sp.__new = newCwd

  const res = await moveSessionToCwd({ sp, sid, header: headerFor(sid, oldCwd), canonical: newCwd, events: EVENTS })
  assert.equal(res.reclaimedSiblings.length, 1, '被取代的旧代副本应被回收')
  assert.equal(existsSync(staleDir), false)
  assert.equal(existsSync(srcDir), false)
})

test('版本相同或更高的跨目录副本仍是真重复 → 409 拒绝', async () => {
  const { root, oldCwd, newCwd } = await makeRoot('tie')
  const sid = 'sess-tie'
  const srcDir = join(root, projectKeyFor(oldCwd), encodeSegmentFor(sid))
  await mkdir(srcDir, { recursive: true })
  await writeFile(join(srcDir, 'session.v2.jsonl.zstd'), Buffer.from('v2'))

  // 另一目录里是同版本的副本 → 无法判断谁权威，必须拒绝
  const otherProject = join(root, projectKeyFor(join(root, 'ws-other')))
  const otherDir = join(otherProject, encodeSegmentFor(sid))
  await mkdir(otherDir, { recursive: true })
  await writeFile(join(otherDir, 'session.v2.jsonl.zstd'), Buffer.from('v2-copy'))

  const sp = makeBackend({ root })
  sp.__old = oldCwd
  sp.__new = newCwd

  await assert.rejects(
    () => moveSessionToCwd({ sp, sid, header: headerFor(sid, oldCwd), canonical: newCwd, events: EVENTS }),
    (e) => e.status === 409 && e.code === 'DSM_SESSION_DUP_LOG',
  )
  assert.equal(existsSync(otherDir), true, '真重复副本绝不能被自动删除')
})

test('v0 代（legacy session.jsonl.zstd）也能被定位与移动', async () => {
  const { root, oldCwd, newCwd } = await makeRoot('v0')
  const sid = 'sess-v0'
  const srcDir = join(root, projectKeyFor(oldCwd), encodeSegmentFor(sid))
  await mkdir(srcDir, { recursive: true })
  await writeFile(join(srcDir, 'session.jsonl.zstd'), Buffer.from('legacy-v0-only'))

  const sp = makeBackend({ root })
  sp.__old = oldCwd
  sp.__new = newCwd

  const loc = await locateSessionArtifacts(sp, headerFor(sid, oldCwd, 0))
  assert.ok(loc, '只有 v0 代时也必须能定位（此前正则会漏掉 v0）')
  assert.equal(loc.generationVersion, 0)
  assert.match(loc.logPath, /session\.jsonl\.zstd$/)

  const res = await moveSessionToCwd({ sp, sid, header: headerFor(sid, oldCwd, 0), canonical: newCwd, events: EVENTS })
  assert.equal(res.sourceCleanup.cleaned, true)
  assert.equal(existsSync(srcDir), false)
})

test('读到 0 条事件但源日志有内容时拒绝移动（数据安全守卫）', async () => {
  const { root, oldCwd, newCwd } = await makeRoot('guard')
  const sid = 'sess-guard'
  const srcDir = join(root, projectKeyFor(oldCwd), encodeSegmentFor(sid))
  await mkdir(srcDir, { recursive: true })
  // 源日志明显不只是头部（> 4KB）：读取却拿到 0 条事件 → 必须中止且不碰源目录
  await writeFile(join(srcDir, 'session.v2.jsonl.zstd'), Buffer.alloc(64 * 1024, 0x41))

  const sp = makeBackend({ root })
  sp.__old = oldCwd
  sp.__new = newCwd

  await assert.rejects(
    () => moveSessionToCwd({ sp, sid, header: headerFor(sid, oldCwd), canonical: newCwd, events: [] }),
    (e) => e.status === 409 && e.code === 'DSM_MOVE_EMPTY_READ',
  )
  assert.equal(existsSync(join(srcDir, 'session.v2.jsonl.zstd')), true, '源日志必须原样保留')
  assert.equal(existsSync(join(root, projectKeyFor(newCwd), encodeSegmentFor(sid))), false, '目标目录不得被创建')
  await rm(root, { recursive: true, force: true })
})

test('临时备份/测试残渣不算真实日志（写所有权探测留下的新代才搬走）', async () => {
  const { root, oldCwd, newCwd } = await makeRoot('temp')
  const sid = 'sess-temp'
  const srcDir = join(root, projectKeyFor(oldCwd), encodeSegmentFor(sid))
  await mkdir(srcDir, { recursive: true })
  await writeFile(join(srcDir, 'session.v2.jsonl.zstd'), Buffer.from('v2'))
  await writeFile(join(srcDir, 'session.v2.jsonl.zstd.move-backup-1-2'), Buffer.from('temp-backup'))
  await writeFile(join(srcDir, 'session.jsonl.zstd.test'), Buffer.from('test-residue'))

  const sp = makeBackend({ root })
  sp.__old = oldCwd
  sp.__new = newCwd

  const res = await moveSessionToCwd({ sp, sid, header: headerFor(sid, oldCwd), canonical: newCwd, events: EVENTS })
  assert.equal(res.sourceCleanup.cleaned, true)
  assert.equal(existsSync(srcDir), false, '源目录整体移除，临时件一并带走')
  const moved = await readFile(join(root, projectKeyFor(newCwd), encodeSegmentFor(sid), 'session.v2.jsonl.zstd'), 'utf8')
  assert.equal(moved, 'moved')
  await rm(root, { recursive: true, force: true })
})
