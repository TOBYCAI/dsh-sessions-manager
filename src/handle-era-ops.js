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
// 活跃写者策略：两个操作都拒绝「正在进行中」的会话，而不是照 legacy 那样
// 改写活跃对象——handle 时代的写句柄所有权在官方 tracker 内部，与其打补丁
// 不如如实拒绝，风险面更小。

import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { rewriteFrame0CwdInMemory, scanZstdFrames } from './zstd-frame.js'
import { deriveSessionDir, locateSessionArtifacts } from './handle-era-paths.js'

const MOVE_BATCH = 400

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
    if (isAlreadyOwned(e)) throw conflictError('该会话正在进行中（存在活跃写入），请先切换到别的会话再操作。')
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
    if (isAlreadyOwned(e)) throw conflictError('该会话正在进行中（存在活跃写入），无法彻底删除。')
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
async function relocateRewrittenBackup({ sid, canonical, backupPath, artifacts }) {
  const original = await readFile(backupPath)
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
export async function moveSessionToCwd({ sp, sid, header, canonical, events = [], inheritedEventCount = 0 }) {
  const artifacts = await locateSessionArtifacts(sp, header)
  if (!artifacts) {
    const error = new Error('无法定位该会话的物理日志，已停止移动')
    error.status = 409
    throw error
  }
  await ensureNoActiveWriter(sp, sid)
  const newHeader = Object.assign({}, header, { cwd: canonical })
  const firstSeq = events.length ? Number(events[0].seq) : 0
  const replay = firstSeq !== 0 ? events.map((event, index) => ({ ...event, seq: index })) : events
  const createOptions = header.isSeeded && Number.isSafeInteger(inheritedEventCount) && inheritedEventCount > 0
    ? { inheritedEventCount }
    : undefined
  const backupPath = `${artifacts.logPath}.move-backup-${process.pid}-${Date.now()}`
  await rename(artifacts.logPath, backupPath)
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
        await relocateRewrittenBackup({ sid, canonical, backupPath, artifacts })
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
    // 回滚：清掉目标目录里的半成品，把备份改名回原位。
    await closeQuietly(writer)
    try { await rm(deriveSessionDir(artifacts.root, canonical, sid), { recursive: true, force: true }) } catch (_) {}
    try { await rename(backupPath, artifacts.logPath) } catch (_) {}
    if (e && e.status) throw e
    const error = new Error('移动会话日志失败：' + String((e && e.message) || e))
    error.status = 500
    throw error
  }
  try { await unlink(backupPath) } catch (e) { /* 备份清理失败不阻塞成功结果 */ }
  return { sessionDir: deriveSessionDir(artifacts.root, canonical, sid) }
}
