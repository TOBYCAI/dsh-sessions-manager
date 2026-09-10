// Stale atomic-write temp sweeper.
//
// 四个状态文件写入器都用「同目录 .<name>-<pid>-<ts>.tmp → rename 到正式文件」的
// 原子写模式（star-index / auto-archive / title-persist-index / index.js 的回收站索引）。
// 若进程在 writeFile 与 rename 之间被杀（反复重启 dsm web 时很常见），临时文件就留在
// 目录里：实测 ~/.dsh/sessions-manager 累积了 153 个孤儿 .star-*.tmp（2026-09-10）。
//
// 启动时扫一遍这些目录，把「超过 maxAgeMs 没被动过」的临时文件清掉。用年龄而非 pid
// 判定：pid 会回绕，而 1 小时的宽限期远大于任何正常写入窗口，不会碰到并发中的写入。

import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

const TEMP_NAME_RE = /^\..+-\d+-\d+\.tmp$/

/**
 * @param {string[]} dirs 需要清扫的目录（不存在时静默跳过）
 * @param {object} [options]
 * @param {number} [options.maxAgeMs] 只清理比这更旧的临时文件（默认 1 小时）
 * @param {number} [options.now] 注入时钟，便于测试
 * @returns {Promise<number>} 清理掉的临时文件数
 */
export async function sweepStaleStateTemps(dirs, options = {}) {
  const maxAgeMs = Number.isSafeInteger(options.maxAgeMs) && options.maxAgeMs >= 0 ? options.maxAgeMs : 3600_000
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  let removed = 0
  for (const dir of Array.isArray(dirs) ? dirs : []) {
    if (typeof dir !== 'string' || dir.length === 0) continue
    let entries
    try { entries = await readdir(dir) } catch (e) { continue }
    for (const name of entries) {
      if (!TEMP_NAME_RE.test(name)) continue
      const path = join(dir, name)
      let info
      try { info = await stat(path) } catch (e) { continue }
      if (!info.isFile()) continue
      if (now - info.mtimeMs < maxAgeMs) continue
      try { await rm(path, { force: true }); removed++ } catch (e) { /* 清不掉的下次再说 */ }
    }
  }
  return removed
}
