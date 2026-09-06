// path-guard.js — 回收站/彻底删除前的「日志路径归属」校验（纯函数）。
//
// purgeFromTrash 在物理 unlink 前必须确认目标路径真的属于该会话，防止把
// 无关文件删掉。旧实现用 `basename(dirname(target)) === sid`，只对 POSIX
// 分隔符成立：Windows 风格路径（`C:\\…\\<sid>\\session.jsonl.zstd`）在
// POSIX 版 path.basename 下整串是一个 basename，校验会错误拒绝；反过来，
// 混合分隔符或 URL 编码路径也可能造成误放行。这里统一按两种分隔符切分，
// 并处理盘符前缀与尾部斜杠。
//
// 接受两种官方/历史布局：
//   .../<sessionId>/session.jsonl.zstd   （目录名 = 会话 id）
//   .../<sessionId>.jsonl.zstd           （旧后端：文件名含会话 id）

function splitSegments(target) {
  return String(target)
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .filter((seg) => seg.length > 0)
}

// 去掉 Windows 盘符段（"C:"），保留其余段。POSIX 路径不含盘符段：
// 一个名为 "C:" 的目录段在 macOS/Linux 上合法但极罕见，把它当盘符
// 处理对「会话 id 归属」判断没有影响（id 不会是 "C:"）。
function stripDriveLetter(segments) {
  return segments.length > 0 && /^[A-Za-z]:$/.test(segments[0]) ? segments.slice(1) : segments
}

/**
 * Does `target` plausibly own `sid`'s stored log?
 * @param {string} target - absolute-ish log path reported by the backend or the trash index.
 * @param {string} sid - session id (already validated by isSafeSessionId: no separators).
 * @returns {boolean}
 */
export function pathOwnsSession(target, sid) {
  if (typeof target !== 'string' || target.length === 0) return false
  if (typeof sid !== 'string' || sid.length === 0) return false
  const segments = stripDriveLetter(splitSegments(target))
  if (segments.length === 0) return false
  const file = segments[segments.length - 1]
  // Layout 1: the session id owns the parent directory.
  if (segments.length >= 2 && segments[segments.length - 2] === sid) return true
  // Layout 2: legacy flat layout — the id is part of the file name itself.
  // Only a *standalone token* match counts: `sid` embedded in a longer id
  // (abc ↔ abcdef) must NOT pass, otherwise a purge of `abc` could delete
  // `abcdef`'s log. Extension punctuation (".jsonl.zstd") is not id-glue.
  if (file.includes(sid)) {
    const ID_CHAR = /[A-Za-z0-9_-]/
    let from = 0
    while (true) {
      const at = file.indexOf(sid, from)
      if (at < 0) return false
      const before = at > 0 ? file[at - 1] : ''
      const after = at + sid.length < file.length ? file[at + sid.length] : ''
      if (!(before && ID_CHAR.test(before)) && !(after && ID_CHAR.test(after))) return true
      from = at + 1
    }
  }
  return false
}
