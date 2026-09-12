// src/empty-scan-index.js 单元测试（3.7.0 T1 的存储层，纯模块，暂无行为接线）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { normalizeEntry, normalizeEmptyScanIndex, createEmptyScanStore, EMPTY_SCAN_SCHEMA_VERSION } from '../src/empty-scan-index.js'

test('normalizeEntry: 只收真判定 + 可持久指纹', () => {
  assert.deepEqual(normalizeEntry({ empty: 1, fingerprint: 'sz:10', updatedAt: 2 }), { empty: 1, fingerprint: 'sz:10', updatedAt: 2 })
  assert.equal(normalizeEntry({ empty: 0, fingerprint: 'sz:10', updatedAt: 2 }).empty, 0, '「非空」也是结论，必须可存')
  assert.equal(normalizeEntry({ empty: true, fingerprint: '1:2', updatedAt: 0 }).empty, 1)
  assert.equal(normalizeEntry({ empty: null, fingerprint: 'sz:10' }), null, 'unknown 不是结论')
  assert.equal(normalizeEntry({ empty: 1, fingerprint: 'rev:abc' }), null, 'rev: 指纹绝不落盘（与 title-persist-index 同一红线）')
  assert.equal(normalizeEntry({ empty: 1 }), null)
  assert.equal(normalizeEntry(null), null)
})

test('normalizeEmptyScanIndex: 坏数据静默剔除，schema 归一', () => {
  const out = normalizeEmptyScanIndex({ schemaVersion: 99, entries: { good: { empty: 1, fingerprint: 'sz:1', updatedAt: 1 }, bad: { empty: 'yes', fingerprint: 'sz:2' } } })
  assert.equal(out.schemaVersion, EMPTY_SCAN_SCHEMA_VERSION)
  assert.ok(out.entries.good)
  assert.equal(out.entries.bad, undefined)
})

test('store: 合并/重启复用/损坏当空/删除', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsm-es-'))
  try {
    const path = join(dir, 'empty-scan.json')
    const store = createEmptyScanStore({ dir })
    assert.equal(await store.merge({ a: { empty: 1, fingerprint: 'sz:10', updatedAt: 1 }, b: { empty: 0, fingerprint: 'sz:20', updatedAt: 1 } }), true)
    // 原子落盘 0600
    await readFile(path)
    assert.match(JSON.stringify(await readFile(path, 'utf8').then((t) => JSON.parse(t))), /"empty":1/)
    // 「重启」= 新实例同目录
    const reopened = createEmptyScanStore({ dir })
    const entries = await reopened.entries()
    assert.equal(entries.a.empty, 1)
    assert.equal(entries.b.empty, 0)
    // 损坏文件 → 空索引，不抛
    await writeFile(path, '{truncated')
    const broken = createEmptyScanStore({ dir })
    assert.deepEqual(await broken.entries(), {})
    // remove 幂等
    await reopened.remove(['a'])
    await reopened.remove(['a'])
    assert.equal(await reopened.merge({}), false, '空批次不写')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
