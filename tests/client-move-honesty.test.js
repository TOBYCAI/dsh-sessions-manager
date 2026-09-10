// 守卫测试：客户端每一个「移动会话」入口都必须处理服务端的 `queued` 结果。
//
// 背景（2026-09-10 用户报障）：0.1.5 起会话被 DSH 打开时是单写者，服务端**不能**动盘，
// 只能把移动登记进待移动队列并返回 `{ ok:true, moved:false, queued:true }`。
// 客户端有三条移动入口，其中两条（侧栏右键菜单「移动到工作区」、拖拽到工作区标题）
// 当初直接 `.then(() => toast('移动成功'))` / 无条件本地改行 + 报「已移到」——
// 于是用户看到「移动成功」，而磁盘与工作区分组毫无变化，刷新后该行跳回原工作区。
//
// 这类 bug 单测很难覆盖（DOM + 真实后端），但**可以静态守住**：只要新增入口忘了
// 判断 queued，这条测试就红。
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = readFileSync(join(root, 'src/client/index.jsx'), 'utf8')

// 判定一个入口「诚实」的窗口：从调用点往后看的字符数。三条入口的处理逻辑都很短，
// 600 字足够覆盖 `.then((r) => { if (r.queued) … })`，又不至于跨到下一条入口。
const WINDOW = 600

function moveCallSites(source) {
  const out = []
  for (const route of ["'/archived-sessions/move'", "'/archived-sessions/move-many'"]) {
    let i = -1
    while ((i = source.indexOf('postJSON(' + route, i + 1)) >= 0) {
      out.push({ route: route.replace(/'/g, ''), at: i, window: source.slice(i, i + WINDOW) })
    }
  }
  return out
}

test('客户端每个移动入口都处理服务端的 queued 结果', () => {
  const sites = moveCallSites(CLIENT)
  assert.ok(sites.length >= 3, `期望至少 3 个移动入口，实际 ${sites.length}`)
  const dishonest = sites.filter((s) => !/\bqueued\b/.test(s.window))
  assert.deepEqual(
    dishonest.map((s) => `${s.route} @${s.at}`),
    [],
    '存在未处理 queued 的移动入口：会话被 DSH 打开时它会把「排队」谎报成「移动成功」',
  )
})

test('移动入口不再出现无条件报成功的写法', () => {
  // 曾经的写法：`.then(() => toast('移动成功'))`（连服务端错误码/排队都没看）
  assert.ok(
    !/\.then\(\(\)\s*=>\s*toast\('移动成功'\)/.test(CLIENT),
    "禁止 `.then(() => toast('移动成功'))`：必须按服务端结果区分 已移动 / 已排队 / 已在该工作区",
  )
})
