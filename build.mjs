/**
 * dsh-sessions-manager — build script (mirrors dsh-skill-picker).
 *
 * Host half (lib/index.js): plain Node ESM, externalizing @deepseek-ai/dsh-*
 * plus cordis (the profile's node_modules provide them).
 *
 * Client half (lib/client.js): a single CJS bundle wrapped in the ModuleLoader
 * handshake — the web shell serves exactly one file per plugin and REQUIRES
 * the bundle to register itself via `window.__ModuleLoader__.load({ id, factory })`.
 * react / @deepseek-ai/dsh-* stay external and are provided by the app.
 */
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

mkdirSync('lib', { recursive: true })

const dshExternal = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-*']

// 构建指纹：编译期注入。诊断「host 跑的是不是这份构建」用——插件 host 端只在
// dsh web / DSH Desktop 启动时加载一次，改 lib 不重启等于白改，指纹一查便知。
//
// **可复现**是硬要求：CI 用 `git diff --exit-code -- lib`（compat.yml）重建比对，
// 指纹里只要有「这次构建才有的东西」（例如 `new Date()`），比对就必然失败——
// 2026-09-10 的 compat 红就是这个原因（同批还叠了「bump 版本却忘了重建 lib」）。
// 所以指纹 = 版本号 + 源码内容哈希：源码一变哈希就变（照样能回答「是不是这份构建」），
// 而对同一份源码，本地 / CI / npm prepack 产出的字节完全相同。
// 构建时刻只打到 stdout 给人看，不进产物。
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const sourceFiles = []
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) walk(abs)
    else if (/\.(js|jsx|mjs|json)$/.test(entry.name)) sourceFiles.push(abs)
  }
}
walk('src')
sourceFiles.push('build.mjs')
sourceFiles.sort()
const srcHash = createHash('sha256')
for (const file of sourceFiles) {
  srcHash.update(file)
  srcHash.update('\0')
  srcHash.update(readFileSync(file))
}
const srcFingerprint = srcHash.digest('hex').slice(0, 8)

const buildStampDefine = { __BUILD_STAMP__: JSON.stringify(`${pkg.version}+${srcFingerprint}`) }
console.log(`build stamp: ${pkg.version}+${srcFingerprint} (source hash over ${sourceFiles.length} files) built ${new Date().toISOString()}`)

// ---- Host half: plain Node ESM -------------------------------------------
await build({
  entryPoints: ['src/index.js'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node22'],
  sourcemap: true,
  external: dshExternal,
  define: buildStampDefine,
  logLevel: 'info',
})

// ---- Client half: CJS bundle wrapped in the ModuleLoader handshake --------
await build({
  entryPoints: ['src/client/index.jsx'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: true,
  jsx: 'automatic',
  external: [...dshExternal, 'react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'scheduler'],
  define: buildStampDefine,
  banner: {
    js: "window.__ModuleLoader__.load({ id: 'dsh-sessions-manager', factory: (require) => { var module = { exports: {} }; var exports = module.exports;",
  },
  footer: {
    js: 'return module.exports; } });',
  },
  logLevel: 'info',
})

console.log('build complete: lib/index.js (ESM host), lib/client.js (CJS + __ModuleLoader__ handshake)')
