// Handle-era destructive/moving operations (dsh-v0.1.3-alpha.1).
//
// 2026-09-06 用户决策：这两类能力在 legacy 时代本就是「官方 locate 查路径 +
// 直接文件系统操作」的半官方实现；handle 时代官方收走 locate 后，改为由
// src/handle-era-paths.js 的三层守卫推导路径。本模块实现两个操作核心，主路径
// 尽量走官方公共 API（create/append/flush/close/stat/open），文件系统操作仅限
// 于「把旧日志改名备份 / 删除会话目录」这两步，并且全部有备份回滚或前置探测：
//
//   - moveSessionToCwd: revision 前后校验（调用方）→ 官方 create+append 重放
//     为主路径；后端已有同 id 幽灵时回退到 frame0 cwd 改写搬运（复用
//     zstd-frame.js，与 legacy relocateLog 同一套校验）。任何失败都会把备份
//     改名回原位并清理目标目录，绝不留下半移动状态。
//   - purgeSessionArtifacts: 官方 open(id,'write') 探测并短暂接管写所有权
//     （活跃写者 → 409 拒绝），然后整目录删除会话目录（basename 已由路径
//     守卫验证），最后以官方 stat 复核该 id 已消失。
//
// 活跃写者策略：两个操作都拒绝「被 DSH 打开、写权限已被占用」的会话，而不是照
// legacy 那样改写活跃对象——handle 时代的写句柄所有权在官方 tracker 内部，
// 与其打补丁不如如实拒绝，风险面更小。
//
// 注意这与 legacy 时代的可用范围不同：legacy 时代没有单写者所有权，插件直接改
// 文件 + 同步 live 对象就能移动任意会话；0.1.3 引入 handle 后，agent-loop 在
// resume 会话时先取写所有权（core/agent-loop resumeWith: "Taking write ownership
// FIRST"）并持有到 agent 卸载，于是「在 DSH 里点开过的会话」一律处于占用态。
// 这是宿主机制决定的硬约束，不是插件能绕开的判定，提示必须如实说明。

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { rewriteFrame0CwdInMemory, scanZstdFrames } from './zstd-frame.js'
import { deriveSessionDir, encodeSegmentFor, generationVersionOf, locateSessionArtifacts } from './handle-era-paths.js'

const MOVE_BATCH = 400

// 真实日志判定：官方命名是 session.vN.jsonl[.zstd]，legacy 时代是
// session.jsonl[.zstd]——锚定结尾，其他后缀（如测试残渣 *.jsonl.zstd.test）
// 不算真日志；只有本插件移动过程的临时名（.move-backup- / .move-stage-）
// 也不算。
const REAL_LOG_RE = /^session.*\.jsonl(\.zst(d)?)?$/
const MOVE_TEMP_RE = /\.move-(backup|stage)-/
// 会话目录里"本会话自己的"非日志文件（lease / flock / 官方临时产物）。用于判定
// 一个仅剩旧代的目录是不是可以安全回收——夹带别的文件就交人工裁决。
const SESSION_LOCAL_JUNK_RE = /^(\.?session\.lock.*|\.lock.*|.*\.lock|.*\.tmp|.*\.stage|.*\.bak|\.DS_Store)$/

// 同 id 跨目录残留处理。后端在 create/list 时扫全盘：同一会话 id 出现在多个
// 项目目录即报 “duplicate JSONL session id ... appears in multiple project
// directories”。三类残留区别对待（判定顺序即风险从低到高）：
//
//   1) 空壳：目录里没有任何真实日志 → 纯垃圾，直接删。
//   2) 只含**被取代的旧代**日志（最高代版本号严格低于当前目录的最高代）→ 也删。
//      0.1.5 起官方「发布新代但不删旧代」（实测同一目录里 session.v2 与
//      session.v3 并存），而历史版本的插件移动时只搬走当前代，留下的旧代会让该
//      id 永远处于"跨目录重复"状态，之后所有移动/彻底删除都被拒。旧代内容已被
//      新代取代（官方读取恒定取最高代），删除不丢数据，且会以 note 如实回报。
//      为稳妥只删"纯日志目录"（除日志外只允许 lock/临时文件），夹带未知文件时
//      降级为第 3 类人工裁决。
//   3) 版本相同或更高 → 真重复，无法判断哪份权威 → 拒绝移动并给出清单。
async function cleanSiblingCopies(root, sid, keepDir, keepVersion) {
  let projects
  try { projects = await readdir(root, { withFileTypes: true }) } catch (e) { return { removed: 0, superseded: [], real: [] } }
  let segment
  try { segment = encodeSegmentFor(sid) } catch (e) { return { removed: 0, superseded: [], real: [] } }
  let removed = 0
  const superseded = []
  const real = []
  for (const ent of projects) {
    if (!ent.isDirectory()) continue
    const candidate = join(root, ent.name, segment)
    if (keepDir && candidate === keepDir) continue
    let entries
    try {
      const st = await stat(candidate)
      if (!st.isDirectory()) continue
      entries = await readdir(candidate)
    } catch (e) { continue }
    const logs = entries.filter((name) => REAL_LOG_RE.test(name) && !MOVE_TEMP_RE.test(name))
    if (logs.length === 0) {
      try { await rm(candidate, { recursive: true, force: true }); removed++ } catch (e) { /* 清不掉的壳由真重复检查兜底 */ }
      continue
    }
    const highest = Math.max(...logs.map(generationVersionOf))
    const onlyLogsAndLocalJunk = entries.every((name) =>
      (REAL_LOG_RE.test(name) && !MOVE_TEMP_RE.test(name)) || SESSION_LOCAL_JUNK_RE.test(name))
    if (Number.isSafeInteger(keepVersion) && highest < keepVersion && onlyLogsAndLocalJunk) {
      try {
        await rm(candidate, { recursive: true, force: true })
        superseded.push(candidate)
      } catch (e) { real.push(candidate) }
      continue
    }
    real.push(candidate)
  }
  return { removed, superseded, real }
}

// 移动成功后的源目录收尾。目标侧已经 create + append + 校验出一份完整权威日志，
// 源目录必须**整体移除**：
//   - 0.1.5 起官方发布新代不删旧代，若只搬走当前代，源目录里的旧代会让同 id 出现
//     在两个项目目录 → 官方 listArtifacts/stat 立刻报 duplicate（实测根因）；
//   - 目录本身已由 locateSessionArtifacts 校验过 basename === encodeSegment(id)
//     且 id 归属正确，删的是该会话自己的目录，不是"疑似别人的数据"。
// 返回 { cleaned, leftover }：cleaned=false + leftover 名单用于如实回报清理失败。
async function removeSourceDir(sessionDir) {
  let entries
  try { entries = await readdir(sessionDir) } catch (e) { return { cleaned: true, leftover: [] } }
  try {
    await rm(sessionDir, { recursive: true, force: true })
  } catch (e) {
    return { cleaned: false, leftover: entries }
  }
  return { cleaned: true, leftover: [] }
}

// 活跃写者（409）提示。0.1.3 起官方 session handle 是「单写者」：agent-loop
// 在 resume 一个会话时先 open(id,'write') 取写所有权并持有到 agent 卸载，所以
// 在 DSH 里点开过的会话都处于被占用状态。runtime 未提供任何能远程释放该所有权
// 的公共 API（无 unloadSession / closeSession / evict），因此插件不能替用户解锁，
// 只能如实说明可操作的自救路径，并靠「重试」让用户切走会话后原地再试一次。
const BUSY_MOVE_MESSAGE = '会话正被 DSH 打开，暂时无法移动；请重启 DSH 后再试。'
const BUSY_PURGE_MESSAGE = '会话正被 DSH 打开，暂时无法彻底删除；请重启 DSH 后再试。'

function conflictError(message) {
  const error = new Error(message)
  error.status = 409
  error.code = 'DSM_SESSION_BUSY'
  return error
}

function failureText(e) {
  return `${(e && e.name) || ''} ${(e && e.message) || e}`
}

function isAlreadyOwned(e) {
  return /already owned/i.test(failureText(e))
}

function isAlreadyExists(e) {
  return /already exists/i.test(failureText(e))
}

async function closeQuietly(handle) {
  try { if (handle && typeof handle.close === 'function') await handle.close() } catch (e) { /* 目录可能已被删，lease 释放失败可忽略 */ }
}

// 官方写所有权探测：能 open(id,'write') 就证明当前没有活跃写者（顺带让官方
// 路径 flush 一次），拿到后立即释放。真正的并发保护来自随后的 rename-aside
// （旧日志消失后，迟到的写者会在官方 open 处干净地 NotFound，而不是写坏数据）。
export async function ensureNoActiveWriter(sp, sid) {
  let handle = null
  try {
    handle = await sp.open(sid, 'write')
  } catch (e) {
    if (isAlreadyOwned(e)) throw conflictError(BUSY_MOVE_MESSAGE)
    throw e
  }
  await closeQuietly(handle)
}

// 彻底删除一个会话的全部物理产物。header 必须来自官方 list/stat（携带真实 cwd）。
// 返回被删除的 artifacts（供上层记录 originalPath 等）。
export async function purgeSessionArtifacts(sp, sid, header) {
  const artifacts = await locateSessionArtifacts(sp, header)
  if (!artifacts) {
    const error = new Error('无法定位该会话的物理日志目录，已停止永久删除')
    error.status = 409
    throw error
  }
  let writer = null
  try {
    writer = await sp.open(sid, 'write')
  } catch (e) {
    if (isAlreadyOwned(e)) throw conflictError(BUSY_PURGE_MESSAGE)
    throw e
  }
  // 句柄从未 append 过，先释放再删目录（Windows 上打开中的文件无法删除）。
  await closeQuietly(writer)
  writer = null
  try {
    // 整目录移除（含 lease 等会话本地文件）。basename === encodeSegment(id)
    // 与「规范 generation 在位」都已在 locateSessionArtifacts 验证过。
    await rm(artifacts.sessionDir, { recursive: true, force: true })
  } catch (e) {
    const error = new Error('删除会话日志失败：' + String((e && e.message) || e))
    error.status = 500
    throw error
  }
  // 官方视角复核：该 id 必须已从后端消失。
  if (typeof sp.stat === 'function') {
    const after = await sp.stat(sid).catch(() => undefined)
    if (after) {
      const error = new Error('删除后官方 stat 仍能看到该会话，已中止（目录可能被并发重建）')
      error.status = 500
      throw error
    }
  }
  return artifacts
}

// frame0 改写回退：把备份日志的 frame0 cwd 改写为目标工作区后搬入目标会话目录。
// 校验与 legacy relocateLog 完全一致：帧数不变 + frame0 之外字节逐位相等。
async function relocateRewrittenBackup({ sid, canonical, backupLogPath, artifacts }) {
  const original = await readFile(backupLogPath)
  const frames = scanZstdFrames(original).frames
  if (frames.length === 0) throw new Error('移动前校验失败：会话日志没有完整 zstd 帧')
  const rewritten = rewriteFrame0CwdInMemory(original, canonical)
  const rewrittenFrames = scanZstdFrames(rewritten).frames
  if (rewrittenFrames.length !== frames.length) throw new Error('移动后校验失败：会话日志帧数发生变化')
  if (!original.subarray(frames[0].end).equals(rewritten.subarray(rewrittenFrames[0].end))) {
    throw new Error('移动后校验失败：会话事件内容发生变化')
  }
  const targetDir = deriveSessionDir(artifacts.root, canonical, sid)
  await mkdir(targetDir, { recursive: true })
  const staged = join(targetDir, `.move-stage-${process.pid}-${Date.now()}`)
  await writeFile(staged, rewritten, { mode: 0o600 })
  await rename(staged, join(targetDir, artifacts.generationFiles[0]))
  return targetDir
}

// 跨工作区移动核心。events 为完整事件数组（官方 read 路径读回，seq 保持原值）。
// seeded（fork 溯源）日志的物理事件 seq 不从 0 起步时，官方 assertContiguous
// 会拒绝直录——此时把副本日志的 seq 重排为 0 起步（仅副本的存储序，事件内容
// 不变），并在 create 时如实携带 inheritedEventCount 溯源。
//
// 0.1.5 关键约束（实测）：官方在 open(id,'write') 时会为历史代**发布当前代**
// （v0/v2 → v3）且**不删旧代**，一个会话目录里可同时有 v0/v2/v3；而官方
// listArtifacts/findLog 会跨项目目录解析同一个 id，**任意两个目录同时持有该 id
// 的日志（无论哪一代）都会抛 duplicate**。所以搬运必须是：
//   探测（会发布新代，必须先做）→ 定位 → 同 id 残留清理
//   → **把整个源会话目录改名移开**（对官方彻底不可见，而不是只搬单个文件）
//   → 目标侧 create+append+校验 → 成功则删除移开的源目录，失败则整体改回。
export async function moveSessionToCwd({ sp, sid, header, canonical, events = [], inheritedEventCount = 0 }) {
  // 1) 写所有权探测放最前：它可能发布新代，之后定位到的才是权威路径。
  // 非「已被占用」的探测失败（后端异常等）不在此处立即上抛——先看能否定位，
  // 定位也失败时如实回报定位错误（提示更可操作），能定位时才报告写状态未知。
  let probeError = null
  try {
    await ensureNoActiveWriter(sp, sid)
  } catch (e) {
    if (e && e.status === 409) throw e
    probeError = e
  }
  const artifacts = await locateSessionArtifacts(sp, header)
  if (!artifacts) {
    const error = new Error('无法定位该会话的物理日志，已停止移动')
    error.status = 409
    throw error
  }
  if (probeError) {
    const error = new Error('无法确认该会话是否正被写入，已停止移动：' + String((probeError && probeError.message) || probeError))
    error.status = 409
    throw error
  }
  // 数据安全守卫（最后一层保险）：源日志明显不只是头部（> 4KB），但我们拿到的事件
  // 是空的 —— 说明读取链路出了问题。此时若继续，就是"用空事件重建日志"再删掉源目录，
  // 等于清空会话。2026-09-10 实测过一次（0.1.5 读取返回结构变更），绝不能再发生。
  const HEADER_ONLY_MAX = 4096
  if (events.length === 0) {
    let sourceBytes = null
    try { sourceBytes = (await stat(artifacts.logPath)).size } catch (e) { sourceBytes = null }
    if (sourceBytes !== null && sourceBytes > HEADER_ONLY_MAX) {
      const error = new Error(
        `移动前校验失败：源日志有 ${sourceBytes} 字节但读到 0 条事件（读取链路异常），已停止移动以免丢失会话内容。`,
      )
      error.status = 409
      error.code = 'DSM_MOVE_EMPTY_READ'
      throw error
    }
  }
  // 2) 同 id 跨目录残留：空壳与被取代的旧代直接回收（会以 note 回报），
  //    版本相同/更高的真重复拒绝移动并给出清单。必须在 rename 备份之前做——
  //    rename 后源目录暂时变成壳，会干扰判定。
  const siblings = await cleanSiblingCopies(artifacts.root, sid, artifacts.sessionDir, artifacts.generationVersion)
  if (siblings.real.length > 0) {
    const error = new Error(
      '无法移动：在其他工作区目录发现同一会话的日志副本，请先确认保留哪一份：\n' +
      siblings.real.map((p) => '· ' + p).join('\n')
    )
    error.status = 409
    error.code = 'DSM_SESSION_DUP_LOG'
    throw error
  }
  const newHeader = Object.assign({}, header, { cwd: canonical })
  const firstSeq = events.length ? Number(events[0].seq) : 0
  const replay = firstSeq !== 0 ? events.map((event, index) => ({ ...event, seq: index })) : events
  const createOptions = header.isSeeded && Number.isSafeInteger(inheritedEventCount) && inheritedEventCount > 0
    ? { inheritedEventCount }
    : undefined
  // 3) 把**整个源会话目录**移出 sessions 根，而不是只 rename 当前代那一个文件：
  //    - 只搬单个文件会留下并存的其他代（0.1.5 的 v0/v2/v3 多代共存），
  //    - 在本项目目录里改名也不够：官方 listSessionDirs 枚举项目目录下的**所有**
  //      子目录（不按名字过滤），listArtifacts 会读每个目录里的日志头，仍会看到
  //      同一个 id → duplicate。必须移到 root 之外（与回收站同级）才对官方扫描
  //      彻底不可见。
  const backupRoot = join(dirname(artifacts.root), 'sessions-manager-move-backup')
  const backupDir = join(backupRoot, `${encodeSegmentFor(sid)}-${process.pid}-${Date.now()}`)
  await mkdir(backupRoot, { recursive: true })
  const backupLogPath = join(backupDir, basename(artifacts.logPath))
  await rename(artifacts.sessionDir, backupDir)
  let writer = null
  try {
    try {
      writer = await sp.create(newHeader, createOptions)
      for (let i = 0; i < replay.length; i += MOVE_BATCH) {
        await writer.append(replay.slice(i, i + MOVE_BATCH))
      }
      await writer.flush()
      await writer.close()
      writer = null
    } catch (e) {
      if (isAlreadyExists(e)) {
        // 后端内存里已有同 id 记录（created-but-unmaterialized 幽灵等）：
        // 回退到 frame0 改写搬运，不再走 create。
        await relocateRewrittenBackup({ sid, canonical, backupLogPath, artifacts })
      } else {
        throw e
      }
    }
    // 官方视角校验：新 cwd 必须生效；事件数一致（snapshot.eventCount 缺省时跳过）。
    if (typeof sp.stat !== 'function') throw new Error('移动后无法校验：后端未提供 stat')
    const after = await sp.stat(sid)
    if (!after || !after.header || after.header.cwd !== canonical) {
      throw new Error('移动后校验失败：会话工作目录未正确更新')
    }
    if (Number.isSafeInteger(after.eventCount) && events.length > 0 && after.eventCount !== events.length) {
      throw new Error(`移动后校验失败：事件数不一致（源 ${events.length}，副本 ${after.eventCount}）`)
    }
  } catch (e) {
    // 回滚：清掉目标目录里的半成品，把整个源目录移回原位（多代日志一起复原）。
    await closeQuietly(writer)
    try { await rm(deriveSessionDir(artifacts.root, canonical, sid), { recursive: true, force: true }) } catch (_) {}
    try { await mkdir(dirname(artifacts.sessionDir), { recursive: true }) } catch (_) {}
    try { await rename(backupDir, artifacts.sessionDir) } catch (_) {}
    if (e && e.status) throw e
    const error = new Error('移动会话日志失败：' + String((e && e.message) || e))
    error.status = 500
    throw error
  }
  // 4) 成功：删掉移开的源目录（含全部旧代日志）。留着它等于让同一个 id 出现在
  //    两个项目目录，下一次 create/list 立刻被后端 duplicate 检查拒绝。
  const sourceCleanup = await removeSourceDir(backupDir)
  return {
    sessionDir: deriveSessionDir(artifacts.root, canonical, sid),
    sourceCleanup,
    reclaimedSiblings: siblings.superseded,
  }
}
