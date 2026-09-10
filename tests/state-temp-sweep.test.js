// 启动清扫：孤儿临时文件（进程在 tmp 写入与 rename 之间被杀留下的）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readdir, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { sweepStaleStateTemps } from '../src/state-temp-sweep.js'

test('sweeps only stale atomic-write temps and leaves live files alone', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsm-sweep-'))
  const now = Date.now()
  const old = join(dir, '.star-101-1000.tmp')
  const fresh = join(dir, '.star-202-2000.tmp')
  await writeFile(old, '{}')
  await writeFile(fresh, '{}')
  await writeFile(join(dir, 'star.json'), '{}')
  await writeFile(join(dir, 'auto-archive.json'), '{}')
  await writeFile(join(dir, 'not-a-temp.tmp'), '{}')
  // 把孤儿文件的 mtime 推到 2 小时前
  const past = new Date(now - 2 * 3600_000)
  await utimes(old, past, past)

  const removed = await sweepStaleStateTemps([dir], { maxAgeMs: 3600_000, now })
  assert.equal(removed, 1)

  const left = (await readdir(dir)).sort()
  assert.deepEqual(left, ['.star-202-2000.tmp', 'auto-archive.json', 'not-a-temp.tmp', 'star.json'].sort())
})

test('ignores missing dirs and non-matching names', async () => {
  assert.equal(await sweepStaleStateTemps([join(tmpdir(), 'dsm-definitely-absent-' + Date.now())]), 0)
  assert.equal(await sweepStaleStateTemps([null, undefined, '']), 0)

  const dir = await mkdtemp(join(tmpdir(), 'dsm-sweep2-'))
  await mkdir(join(dir, 'sub.tmp'))
  await writeFile(join(dir, '.title-index-1-2.tmp.bak'), '{}')
  assert.equal(await sweepStaleStateTemps([dir], { maxAgeMs: 0 }), 0)
})
