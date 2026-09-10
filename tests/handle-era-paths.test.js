// Unit tests for the handle-era private-path derivation and destructive ops.
// 端到端行为（真实后端布局上的 locate/move/purge）由 scripts/compat-runtime.mjs
// 在官方构建上验证；这里固化纯函数向量与守卫降级路径。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  projectKeyFor,
  encodeSegmentFor,
  resolveSessionRoot,
  deriveSessionDir,
  locateSessionArtifacts,
} from '../src/handle-era-paths.js'
import { ensureNoActiveWriter, purgeSessionArtifacts, moveSessionToCwd } from '../src/handle-era-ops.js'
import { join } from 'node:path'

test('projectKeyFor matches the official backend encoding', () => {
  // 分隔符归并为单个 '-'，安全字符保留，首尾包 '--'。
  assert.equal(projectKeyFor('/Users/foo/bar'), '--Users-foo-bar--')
  // 连续分隔符归并：'/a//b' → '-a--b'? 不——连续分隔符只产出一个 '-'。
  assert.equal(projectKeyFor('/a//b'), '--a-b--')
  // 非 ASCII（CJK）按 charCode 转四位大写十六进制转义。
  assert.equal(projectKeyFor('/用户/项目'), '--~7528~6237-~9879~76EE--')
  // '.'/'_'/'-' 保留；'~' 本身必须转义。
  assert.equal(projectKeyFor('/a.b_c-d'), '--a.b_c-d--')
  assert.equal(projectKeyFor('/a~b'), '--a~007Eb--')
  // 截断到 251 且空回退 root。
  const long = '/' + 'x'.repeat(400)
  const key = projectKeyFor(long)
  assert.equal(key.length, 2 + 251 + 2)
  assert.equal(projectKeyFor('///'), '--root--')
  assert.throws(() => projectKeyFor(''))
})

test('encodeSegmentFor matches the official backend encoding', () => {
  assert.equal(encodeSegmentFor('abc-123_X.y'), 'abc-123_X.y')
  assert.equal(encodeSegmentFor('a~b'), 'a~007Eb')
  assert.equal(encodeSegmentFor('会话 id'), '~4F1A~8BDD~0020id')
  assert.equal(encodeSegmentFor('.'), '~002E')
  assert.equal(encodeSegmentFor('..'), '~002E~002E')
  assert.throws(() => encodeSegmentFor(''))
})

test('resolveSessionRoot only trusts a non-empty string instance field', () => {
  assert.equal(resolveSessionRoot({ root: '/tmp/sessions' }), '/tmp/sessions')
  assert.equal(resolveSessionRoot({}), null)
  assert.equal(resolveSessionRoot({ root: '' }), null)
  assert.equal(resolveSessionRoot(null), null)
  assert.equal(resolveSessionRoot({ root: 42 }), null)
})

test('deriveSessionDir mirrors projectDir/sessionDir layering', () => {
  assert.equal(deriveSessionDir('/r', '/w', 's1'), join('/r', '--w--', 's1'))
  // cwd 缺省 → _no-cwd。
  assert.equal(deriveSessionDir('/r', undefined, 's1'), join('/r', '_no-cwd', 's1'))
  assert.equal(deriveSessionDir('/r', '', 's1'), join('/r', '_no-cwd', 's1'))
})

test('locateSessionArtifacts degrades to null on every guard failure', async () => {
  const id = 'guard-' + Date.now().toString(36)
  // 无 root → null。
  assert.equal(await locateSessionArtifacts({}, { id, cwd: '/w' }), null)
  // root 给了但目录不存在 → null。
  assert.equal(await locateSessionArtifacts({ root: '/tmp/definitely-not-here-' + id }, { id, cwd: '/w' }), null)
  // 异体字符 id：目录名经编码后 ≠ id，pathOwnsSession 拒绝 → null（安全降级）。
  assert.equal(await locateSessionArtifacts({ root: '/tmp/no-such-root' }, { id: 'has space', cwd: '/w' }), null)
})

test('ensureNoActiveWriter translates ownership conflicts into a 409', async () => {
  const owned = { async open() { const e = new Error('Session "x" is already owned by another writer'); e.name = 'SessionAlreadyOwnedError'; throw e } }
  await assert.rejects(() => ensureNoActiveWriter(owned, 'x'), (e) => e.status === 409 && e.code === 'DSM_SESSION_BUSY' && /正被 DSH 打开/.test(e.message))
  const ok = { async open() { return { async close() {} } } }
  await assert.doesNotReject(() => ensureNoActiveWriter(ok, 'x'))
  const other = { async open() { throw new Error('not found') } }
  await assert.rejects(() => ensureNoActiveWriter(other, 'x'), /not found/)
})

test('purge/move degrade to 409 when the session cannot be located', async () => {
  const sp = { root: '/tmp/definitely-not-here', stat: async () => undefined, open: async () => { throw new Error('nope') } }
  await assert.rejects(() => purgeSessionArtifacts(sp, 'x', { id: 'x', cwd: '/w' }), (e) => e.status === 409)
  await assert.rejects(() => moveSessionToCwd({ sp, sid: 'x', header: { id: 'x', cwd: '/w' }, canonical: '/w2', events: [] }), (e) => e.status === 409)
})

test('purge refuses an actively-writing session with 409', async () => {
  // 真实目录结构夹具：locate 必须先通过，才能走到写者探测。
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const root = await mkdtemp(join(tmpdir(), 'dsm-purge-test-'))
  const dir = join(root, projectKeyFor('/w'), encodeSegmentFor('x'))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'session.v2.jsonl.zstd'), Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00]))
  const sp = {
    root,
    async open() { const e = new Error('already owned'); e.name = 'SessionAlreadyOwnedError'; throw e },
  }
  await assert.rejects(() => purgeSessionArtifacts(sp, 'x', { id: 'x', cwd: '/w' }), (e) => e.status === 409 && e.code === 'DSM_SESSION_BUSY' && /正被 DSH 打开/.test(e.message))
})
