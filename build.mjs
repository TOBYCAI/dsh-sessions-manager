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
import { mkdirSync, readFileSync } from 'node:fs'

mkdirSync('lib', { recursive: true })

const dshExternal = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-*']

// 构建指纹：编译期注入。诊断「host 跑的是不是这份构建」用——插件 host 端只在
// dsh web / DSH Desktop 启动时加载一次，改 lib 不重启等于白改，指纹一查便知。
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const buildStampDefine = { __BUILD_STAMP__: JSON.stringify(`${pkg.version} built ${new Date().toISOString()}`) }

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
