// Private-path derivation for the SessionHandle era (dsh-v0.1.3-alpha.1).
//
// 设计裁决（2026-09-06，用户明确决策）：官方公共契约不含 delete/move，而这两类
// 能力在 legacy 时代本来就是「官方 locate 查路径 + 直接文件系统操作」的半官方
// 实现。用户据此放弃 v3.5.2 早前「只走公共契约」的自我限制，要求沿用同一思路
// 在 handle 时代恢复「彻底删除」与「跨工作区移动」。本模块把官方
// session-persistence-jsonl 后端的确定性目录布局移植为可校验的路径推导，并配
// 三层守卫，任何一层不满足都视为「推导失败」返回 null（调用方安全降级为禁用）：
//
//   1. root 必须直接读自后端实例字段（`sp.root`，构建产物里是普通实例属性），
//      绝不猜测、绝不扫描磁盘反推。
//   2. 会话目录 basename 必须等于 encodeSegment(id)，且目录内必须存在至少一个
//      规范 generation 文件（session.vN.jsonl[.zstd]；临时/非规范名不算）。
//   3. 最终日志路径还要过 pathOwnsSession 的 id 归属校验（含子串碰撞拒绝）——
//      因此含异体字符的 id（编码后目录名 ≠ id）会安全降级为不可用。
//
// 布局规则移植自官方构建产物（session-persistence-jsonl/lib/index.js）：
//   projectDir(root, cwd)  = root / projectKey(cwd)          （cwd 缺省 → _no-cwd）
//   sessionDir(root, cwd, id) = projectDir / encodeSegment(id)
//   generationLogFilename  = `session.vN.jsonl` + `.zstd`（compression=zstd）
//   projectKey: 分隔符与 `:` → `-`；[A-Za-z0-9._-] 保留；其余 → `~XXXX`
//   （charCode 的四位大写十六进制）；去前导 `-`；截断 251；空串回退 `root`。
//   encodeSegment: 同样的 `~XXXX` 转义（`.`/`..` 例外）。

import { readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pathOwnsSession } from './path-guard.js'

// 规范 generation 文件：官方 `session.vN.jsonl[.zstd]`，**v0 代无 `.vN.` 分量**
// （即 `session.jsonl[.zstd]`，legacy 时代产物）。官方
// `parseSessionFormatLogFilename` 把 v0 当 version 0 参与「最高代优先」，
// 所以这里也必须收 v0，否则「只有 v0 代」的会话会被误判为不可定位
// （移动/彻底删除静默禁用）。临时备份名（`.move-backup-…`）不以
// `.jsonl`/`.zstd` 结尾，天然不匹配。
const GENERATION_LOG_RE = /^session(\.v\d+)?\.jsonl(\.zst(d)?)?$/

function isSafeChar(ch) {
  return ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)
}

export function projectKeyFor(cwd) {
  const s = String(cwd)
  if (s.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (isSafeChar(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  return '--' + ((readable.replace(/^-+/, '') || 'root').slice(0, 251)) + '--'
}

export function encodeSegmentFor(raw) {
  const s = String(raw)
  if (s.length === 0) throw new Error('cannot encode an empty path segment')
  if (s === '.') return '~002E'
  if (s === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    out += isSafeChar(ch) ? ch : '~' + s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

// 后端实例的 root 只在「实例字段确实携带非空字符串」时可信；拿不到就整体降级。
export function resolveSessionRoot(sp) {
  const root = sp && typeof sp === 'object' ? sp.root : undefined
  return typeof root === 'string' && root.length > 0 ? root : null
}

export function deriveSessionDir(root, cwd, id) {
  const project = cwd === undefined || cwd === null || cwd === ''
    ? join(root, '_no-cwd')
    : join(root, projectKeyFor(cwd))
  return join(project, encodeSegmentFor(id))
}

// 纯推导（不做磁盘校验）。供测试与上层组合使用。
// `generation` 只是名字里的 `.vN` 分量：0 = legacy 的 `session.jsonl`，2 = `session.v2.jsonl`。
// 实际落盘版本由 runtime 的格式目录决定，此处不假设“当前版本是几”。
export function deriveGenerationLogPath(root, cwd, id, { compression = 'zstd', generation = 2 } = {}) {
  const base = generation === 0 ? 'session.jsonl' : `session.v${generation}.jsonl`
  return join(deriveSessionDir(root, cwd, id), `${base}${compression === 'zstd' ? '.zstd' : ''}`)
}

// 名字里的代版本号（`session.v3.jsonl.zstd` → 3；`session.jsonl.zstd` → 0）。
export function generationVersionOf(name) {
  return Number((String(name).match(/^session\.v(\d+)\./) || [])[1] || 0)
}

// 定位一个已落盘会话的全部物理坐标；三层守卫在此汇合。返回
//   { root, projectDir, sessionDir, logPath, generationFiles }
// 或 null（root 不可用 / 目录不存在 / 无规范 generation / id 归属校验拒绝）。
export async function locateSessionArtifacts(sp, header) {
  const root = resolveSessionRoot(sp)
  if (!root || !header || header.id == null) return null
  const sid = String(header.id)
  let sessionDir
  try {
    sessionDir = deriveSessionDir(root, header.cwd, sid)
  } catch (e) {
    return null
  }
  if (basename(sessionDir) !== encodeSegmentFor(sid)) return null
  let entries
  try {
    const st = await stat(sessionDir)
    if (!st.isDirectory()) return null
    entries = await readdir(sessionDir)
  } catch (e) {
    return null
  }
  const generationFiles = entries.filter((name) => GENERATION_LOG_RE.test(name))
  if (generationFiles.length === 0) return null
  // 优先 current generation（v0/legacy 也是候选，版本号最小），保持确定性。
  generationFiles.sort((a, b) => generationVersionOf(b) - generationVersionOf(a))
  const logPath = join(sessionDir, generationFiles[0])
  if (!pathOwnsSession(logPath, sid)) return null
  return {
    root,
    projectDir: join(root, header.cwd === undefined || header.cwd === null || header.cwd === '' ? '_no-cwd' : projectKeyFor(header.cwd)),
    sessionDir,
    logPath,
    generationFiles,
    // 最高代版本号：0 = legacy `session.jsonl[.zstd]`，≥1 = `session.vN.jsonl[.zstd]`。
    // 上层用它判断「另一个目录里的同 id 副本是不是被取代的旧代」。
    generationVersion: generationVersionOf(generationFiles[0]),
  }
}
