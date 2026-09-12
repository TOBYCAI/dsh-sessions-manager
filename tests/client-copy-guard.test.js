// 3.7.0 P0/T3 文案守卫（源码扫描，仿 client-move-honesty 风格）。
//
// 背景：「血统/血缘」曾并存（详情卡片标题用「血统」，其余 14+ 处可见文案与代码
// 命名全用「血缘」）；「纯净视图」开关早在 0.1.3 移除，但空白视图空态文案还指向
// 这个不存在的功能。两类都是会随复制粘贴复发的失效文案。
//
// 另立一条仓库纪律（3.6.2 排障教训）：esbuild 把非 ASCII 转义成**大写** \uXXXX，
// 用中文直接 grep 出厂 bundle 永远 0 命中——本文件同时锁住两个关键串在 lib/ 中
// 的**转义形态**，防止「改了 src 忘重建 bundle」这类 check:dist 覆盖不到的出厂盲区。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC_CLIENT = readFileSync(join(import.meta.dirname, '../src/client/index.jsx'), 'utf8')
const SRC_HOST = readFileSync(join(import.meta.dirname, '../src/index.js'), 'utf8')
const README_ZH = readFileSync(join(import.meta.dirname, '../README.md'), 'utf8')

// 「纯净视图」只允许出现在解释历史的注释行（// 或 * 开头段）；任何渲染串里出现即失败。
const BARE_RE = /^[ \t]*(\/\/|\*|\/\*)/

test('「血统」已从全部用户可见文案与代码注释中清除（基准词=血缘/lineage）', () => {
  assert.ok(!SRC_CLIENT.includes('血统'), 'src/client/index.jsx 不得再出现「血统」')
  assert.ok(!SRC_HOST.includes('血统'), 'src/index.js 不得再出现「血统」')
  assert.ok(!README_ZH.includes('血统'), 'README.md 不得再出现「血统」')
  // 基准词必须还在（防有人反向删错）
  assert.ok(SRC_CLIENT.includes('>血缘</div>'), '详情卡片小节标题应为「血缘」')
})

test('「纯净视图」不再出现在任何渲染文案里（该开关 0.1.3 已移除）', () => {
  for (const line of SRC_CLIENT.split('\n')) {
    if (!line.includes('纯净视图')) continue
    assert.ok(BARE_RE.test(line), '「纯净视图」只允许存在于注释行：' + line.trim().slice(0, 100))
  }
})

// 出厂形态校验（大写 \uXXXX 转义）——若 lib/ 不存在（首次 clone 未构建）则跳过。
const esc = (s) => [...s].map((c) => c.codePointAt(0) > 127 ? '\\u' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0') : c).join('')

test('预构建 bundle 与文案改动同步：lib/ 内「血统」转义形态 0 命中', () => {
  let lib
  try { lib = readFileSync(join(import.meta.dirname, '../lib/client.js'), 'utf8') } catch { return }
  assert.ok(!lib.includes(esc('血统')), 'lib/client.js 仍含「血统」——改完 src 忘了 npm run build')
  assert.ok(lib.includes(esc('侧栏会自动隐藏它们')), '新空态文案未出厂——重建 lib/ 后重试')
  assert.ok(lib.includes(esc('血缘')), '「血缘」应存在于出厂包（详情小节标题）')
})
