#!/usr/bin/env node
// dsh-sessions-manager — session log health check.
//
// Scans every session.jsonl.zstd under ~/.dsh/sessions and verifies that each
// log's first zstd frame is exactly one session-header line. This is the
// invariant DSH's persistence layer enforces on startup
// (assertZstdHeaderFrame): when it breaks, the workspace plugin fails to load
// and the whole web profile refuses to start.
//
// Usage:  node scripts/check-session-health.mjs
// Exit:   0 = all healthy, 1 = at least one damaged log

import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { findZstdFrameStarts, readFrame0 } from '../src/zstd-frame.js'

const root = join(homedir(), '.dsh', 'sessions')

let files
try {
  files = execSync(`find "${root}" -name "session.jsonl.zstd"`, { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
} catch (_) {
  console.log('未找到会话目录:', root)
  process.exit(0)
}

if (files.length === 0) {
  console.log('没有找到会话日志文件')
  process.exit(0)
}

let damaged = 0
for (const file of files) {
  try {
    const buf = readFileSync(file)
    const { obj, lineCount } = readFrame0(buf)
    const label = file.replace(homedir(), '~')
    if (obj.type !== 'session') {
      console.log(`✗ ${label}`)
      console.log(`    frame0 type=${obj.type}（期望 session）`)
      damaged++
    } else if (lineCount !== 1) {
      console.log(`✗ ${label}`)
      console.log(`    frame0 有 ${lineCount} 行（期望 1）`)
      damaged++
    }
  } catch (e) {
    console.log(`✗ ${file.replace(homedir(), '~')}`)
    console.log(`    ${e.message}`)
    damaged++
  }
}

console.log('')
if (damaged === 0) {
  console.log(`✓ 全部正常：${files.length} 个会话日志，frame0 均为单行 session header`)
  process.exit(0)
}
console.log(`✗ ${damaged}/${files.length} 个会话日志损坏`)
console.log('  损坏的日志会让 dsm web 无法启动。备份后删除对应文件即可恢复。')
process.exit(1)
