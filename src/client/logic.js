// dsh-sessions-manager — client 纯判定逻辑。
//
// 侧栏增强里最容易随 DSH 上游变化出回归的三块判定抽到这里：
// 状态点语义、拖拽可放置校验、fiber node → 会话/工作区识别。
// 本模块不碰 DOM，node --test 直接可测（tests/client-logic.test.js）。

// 状态点语义：manual 未读最高优先；done 在当前查看的行上不亮绿
// （读过即视为已读）。返回逻辑态名，颜色映射留在 UI 层。
// 历史回归：DSH 曾把 running 报为 ongoing（9766476），上游枚举变化要盯这里。
// issue #4：上游还存在 waiting / needs-attention 等同义词，这里收敛到同一
// 逻辑态，颜色映射仍由 UI 层统一处理（issue 保持 open 直到上游确认）。
export function dotStateFor({ manualUnread = false, dataState = '', isActive = false } = {}) {
  if (manualUnread) return 'manual'
  switch (dataState) {
    case 'ongoing':
    case 'running': return 'running'
    case 'warning':
    case 'waiting':
    case 'needs-attention': return 'feedback'
    case 'error': return 'error'
    case 'done': return isActive ? null : 'done'
    default: return null
  }
}

// 权威标题只修正新出现 DOM 行的冷态标题。行一旦完成首次 paint，后续文本
// 变化属于 DSH Core 的实时更新（例如重命名），插件不得再用轮询快照覆盖。
export function authoritativeTitleForFirstPaint({ firstPaint = false, rendered = '', authoritative = '' } = {}) {
  if (!firstPaint || !authoritative || rendered === authoritative) return null
  return authoritative
}

// v3.6.2 #2：占位/冷标题的行在权威标题**后到**时回填。返回 null 表示不动 DOM。
// 所有权规则（与首绘一致，绝不覆盖 DSH Core 的实时更新）：
//   - 首次见到该行 → 有权威就用权威（changed 仅在权威≠当前文本时为 true）；
//   - 之后：当前文本仍等于我们上次记录/写入的值（baseline.text）且权威更新 →
//     回填新权威；当前文本被官方改过 → 只重新记录所有权，绝不写。
export function titleBackfillDecision({ rendered = '', baseline = null, authoritative = '' } = {}) {
  const auth = authoritative || ''
  if (!baseline) {
    const next = auth || rendered
    return { text: next, changed: !!auth && auth !== rendered, nextBaseline: { text: next, authoritative: auth || null } }
  }
  if (rendered !== baseline.text) {
    // 文本已被（官方渲染或用户重命名）改动：所有权移交，仅重新记录。
    return { changed: false, nextBaseline: { text: rendered, authoritative: baseline.authoritative || null } }
  }
  if (!auth || auth === baseline.authoritative) return null
  return { text: auth, changed: true, nextBaseline: { text: auth, authoritative: auth } }
}

// v3.6.2 #6：列表搜索/标题排序的「有效标题」= 列表项标题，缺时回落到侧栏
// 权威标题缓存（预热补齐后即使面板还没刷新，搜索/排序也按真标题工作）。
export function effectiveTitleOf(item, authoritativeTitles) {
  if (!item) return ''
  if (item.title) return String(item.title)
  const id = String(item.sessionId)
  const auth = authoritativeTitles && authoritativeTitles.get(id)
  return auth ? String(auth) : ''
}

// 拖拽迁移前置校验：同工作区拦截（workspacePath 相等即拒绝）。
// 无 workspacePath 的会话（如侧栏 live 行尚未同步）放行，由 host 最终裁决。
export function canDropOnWorkspace(item, target) {
  if (!item || !target) return false
  if (item.workspacePath && target.path === item.workspacePath) return false
  return true
}

// 从 React fiber 链收集到的 node 数组识别会话行。knownSessions 是
// host /archived-sessions/sessions 的权威表；live 行（还没同步到权威表）
// 用启发式兜底：有 id、不是工作区分组（无 workspaceId）、且带标题/时间。
export function sessionForNodes(nodes, knownSessions) {
  for (const node of nodes || []) {
    const id = node && node.id != null ? String(node.id) : ''
    if (knownSessions.has(id)) return knownSessions.get(id)
    // DSH 的行节点有 id；工作区分组用 workspaceId、从不用裸 id。
    if (id && node.workspaceId == null && (node.title != null || node.updatedAt != null || node.blank != null)) {
      return { sessionId: id, title: node.title || '', workspacePath: null }
    }
  }
  return null
}

// 从 fiber node 数组识别可见的工作区标题行（可放置目标）。
// 会话行的 fiber 链也会带出父工作区节点，调用方须先用 sessionForNodes 拦截。
export function workspaceForNodes(nodes) {
  for (const group of nodes || []) {
    if (group && group.workspaceId != null && typeof group.cwd === 'string' && group.cwd) {
      return { workspaceId: String(group.workspaceId), path: group.cwd, title: group.label || group.cwd }
    }
  }
  return null
}

// 收藏过滤：返回已收藏子集。star 是用户标记，与 DSH 的活动/归档状态正交
// （可叠加），所以这里不做任何状态联合判断，只认 starred 字段。
export function starredOf(items) {
  return (items || []).filter((item) => item && item.starred)
}

// 血缘折叠：把 origin === 'subagent' 的会话挂到父会话下，返回顶层列表 + 父子
// 映射 + 折叠数量。
//
// 关键约束：从顶层移除的是「子代理自己」，父会话必须保留在顶层——折叠按钮就
// 渲染在父会话卡片里，父一旦被一起过滤掉，界面上就只剩平铺的子代理，看起来
// 像「折叠完全没生效」。
// 父会话不在当前列表（被筛选掉 / 已删除）时子代理保持在顶层，保证搜得到就
// 看得见。
export function foldSubagents(items, lineage) {
  const list = items || []
  const table = lineage || {}
  const kidsOf = new Map()
  const foldedIds = new Set()
  const byId = new Map()
  for (const item of list) byId.set(String(item.sessionId), item)
  for (const item of list) {
    const id = String(item.sessionId)
    const info = table[id]
    const parentId = info && info.origin === 'subagent' && info.parentSession ? String(info.parentSession) : null
    if (!parentId || parentId === id || !byId.has(parentId)) continue
    if (!kidsOf.has(parentId)) kidsOf.set(parentId, [])
    kidsOf.get(parentId).push(item)
    foldedIds.add(id)
  }
  return {
    topList: foldedIds.size ? list.filter((item) => !foldedIds.has(String(item.sessionId))) : list,
    kidsOf,
    foldedCount: foldedIds.size,
  }
}

// 列表里只显示会话 ID 的短片段。完整 UUID 有 36 个字符，塞进 meta 行会把整
// 行撑到换行、卡片高度跟着浮动——短 ID 是「列表定高」的前提之一。完整值保留
// 在 title 属性与详情面板里，信息不丢。
export function shortId(id) {
  const raw = String(id == null ? '' : id)
  const tail = raw.startsWith('session-') ? raw.slice(8) : raw
  if (!tail) return ''
  return tail.length <= 10 ? tail : tail.slice(0, 8) + '…'
}

// 打开子代理之后的提示文案。三种结果要传达三件不同的事，混成一句「打不开」
// 会让人既不知道原因、也不知道下一步：
//   ok         → 已经切过去了；在设置面板里会话区被挡着，得提醒关掉才看得到
//   no-service → 这个 runtime 没开放会话切换接口，只能手动切
//   failed     → 自动切换没成功，给出确定可走的替代路径（侧栏父会话头部的
//                「/ N」官方子代理目录）
// where: 'panel'（设置面板内）| 'sidebar'（侧栏注入行）
export function openSubagentToast(result, name, where) {
  const label = name || '子代理'
  if (result === 'ok') {
    return {
      kind: 'ok',
      text: where === 'sidebar' ? `已打开「${label}」` : `已打开「${label}」— 关掉设置即可看到`,
    }
  }
  if (result === 'no-service') {
    return { kind: 'err', text: '这个 DSH 版本没有开放会话切换接口，请在侧边栏手动切换' }
  }
  return {
    kind: 'err',
    text: where === 'sidebar'
      ? '打不开这个子代理：请选中它的父会话，点标题栏的「/ N」子代理目录'
      : '打不开：请在侧边栏选中它的父会话，点标题栏的「/ N」子代理目录',
  }
}

// 提示（toast）停留时长：按**可读字数**给，而不是固定 2.4s / 2.6s。
// 中文舒适阅读约 6 字/秒，留 40% 余量后夹在 [2.6s, 11s]；失败类再 ×1.25（同样受上限约束）。
// 背景（2026-09-10 用户反馈）：排队/失败类文案动辄 40~100 字，"还没读完提示就不见了"。
export const TOAST_MIN_MS = 2600
export const TOAST_MAX_MS = 11000
export function toastDurationFor(text, kind) {
  const chars = String(text == null ? '' : text).length
  const readingMs = Math.round((chars / 6) * 1000 * 1.4)
  const scaled = kind === 'err' ? Math.round(readingMs * 1.25) : readingMs
  return Math.min(TOAST_MAX_MS, Math.max(TOAST_MIN_MS, scaled))
}

// —— T2（3.7.0）：排队移动终局通知的文案与投递计划（纯函数，可 node --test）——
// host 把每次后台终局（成功/放弃）落成通知经 sidebar-state 带出；client 用本地
// 已见集合过滤后弹一次 toast，并 ack 已展示项。投递策略全部收敛在这里，
// index.jsx 只做接线。

export function pathTail(p) {
  const parts = String(p == null ? '' : p).split(/[\\/]+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : ''
}

export function moveNoticeText(n) {
  const id = shortId(n && n.sessionId)
  if (n && n.kind === 'moved') {
    const where = pathTail(n.targetPath)
    return `排队中的移动已完成：${id}${where ? ` → 「${where}」` : ''}`
  }
  const reason = String((n && n.reason) || '').split('\n')[0].slice(0, 120)
  return `排队中的移动多次失败已放弃：${id}${reason ? `（${reason}）` : ''}，可在 设置 → 会话管理 → 待移动队列 重新发起移动`
}

/**
 * 一次侧栏拉取里的通知投递计划。
 * @param raw      sidebar-state 的 moveNotices 数组（可能缺失/畸形——一律宽容）
 * @param seenIds  本浏览器已展示过的通知 id 集合（多 tab 即时去重）
 * @param max      单次最多展示几条真实通知，超出并入省略句
 * @returns {{ text: string|null, kind: 'ok'|'err', ackIds: string[] }}
 *          ackIds 只含**已展示**项——未展示的留在服务端，下一拍继续（TTL 兜底）。
 */
export function noticeToastPlan(raw, seenIds, max = 2) {
  const list = (Array.isArray(raw) ? raw : [])
    .filter((n) => n && typeof n.id === 'string' && typeof n.sessionId === 'string' && (n.kind === 'moved' || n.kind === 'abandoned') && !seenIds.has(String(n.id)))
    .sort((a, b) => (a.at || 0) - (b.at || 0))
  if (!list.length) return { text: null, kind: 'ok', ackIds: [] }
  const shown = list.slice(Math.max(0, list.length - Math.max(1, max)))
  const parts = shown.map(moveNoticeText)
  if (list.length > shown.length) parts.push(`另有 ${list.length - shown.length} 条排队移动的结果，见 设置 → 会话管理 → 待移动队列`)
  return {
    text: parts.join('；'),
    kind: shown.some((n) => n.kind === 'abandoned') ? 'err' : 'ok',
    ackIds: shown.map((n) => String(n.id)),
  }
}

// —— T3（3.7.0）：分支聚拢 ——
// 把「同一父会话派生出的普通分支会话」归组，收拢到组锚（真实父行或合成头）
// 之下。子代理已由 foldSubagents 先行摘除，本函数只处理非子代理的分支血缘。
// 判定全部收敛为纯函数，供列表管线在 foldSubagents 之后调用；UI 接线不在此处。

// 组内时间键：createdAt（>0）优先；缺失/非正回退 updatedAt——它是 host 后加的
// 字段，老快照或尚未同步的行可能根本没有，必须宽容；两者都不可用按 0，交给
// sessionId 决胜。
export function branchTimeKey(item) {
  const c = Number(item && item.createdAt)
  if (Number.isFinite(c) && c > 0) return c
  const u = Number(item && item.updatedAt)
  if (Number.isFinite(u) && u > 0) return u
  return 0
}

// 组内升序比较：时间差优先，决胜恒为 sessionId 字典序——即使宿主哪天给所有行
// 都补上 createdAt，排序仍全序稳定、可复现。同毫秒/同零值也靠决胜定序。
export function ascBranchTime(a, b) {
  const ta = String((a && a.sessionId) ?? '')
  const tb = String((b && b.sessionId) ?? '')
  return branchTimeKey(a) - branchTimeKey(b) || ta.localeCompare(tb)
}

// 分支血缘边：lineage[id] 存在、origin 非 subagent、parentSession 非空且不
// 自指，才返回父 id；否则 null（该行不是分支，不参与聚拢）。
// 子代理即便漏进输入（上游本该是 foldSubagents 之后的 topList）也被 origin
// 挡下——链上链下两层都锁，绝不入组。
function branchParentOf(id, table) {
  const info = table[id]
  if (!info || typeof info !== 'object') return null
  if (info.origin === 'subagent') return null
  const p = info.parentSession ? String(info.parentSession) : null
  if (!p || p === id) return null
  return p
}

/**
 * 分支聚拢：把普通分支会话（lineage 有 parentSession、非子代理、不自指）移入
 * 组锚的分支组。
 *
 * 输入契约：items 应为 foldSubagents 之后的 topList（子代理已摘除）；lineage
 * 形状 {id:{origin,parentSession,delegationDepth,empty}}。任何畸形输入（items
 * 或 lineage 为 null、数组含洞/非对象行、lineage 非对象）都不得抛错——认不出
 * 血缘的行一律原样留在顶层。
 *
 * 组锚解析（memo 化）：沿 parentSession 上溯，锚 = 链上第一个「在 items 中且
 * 自身非分支」的行；父在 items 但也是分支 → 继续上溯（整条链拍平进同一组）；
 * 父不在 items → 合成锚 = 链尾那个缺失父 id。visited Set + 步数上限防环；成
 * 环的整条链不聚拢（行不丢，原地保 chip）；自指不算分支。
 *
 * 真实锚父行在 topList 中的位置纹丝不动；成员行从 topList 移出进 branchGroupsOf。
 * 仅当锚是合成的（缺失父）才产出头行 {syntheticRoot:rootId, sessionId:'dsm-src:'+rootId}，
 * 插入位置 = 组内最早成员（ascBranchTime 排序后的第一个）在原列表中的下标；
 * 成员 ≥1 就出合成头（单孤儿与多孤儿统一规则）。组内恒按 ascBranchTime 升序
 * （与调用方主排序方向无关）。
 *
 * 守恒不变量：topList 中非合成行数 + foldedCount === items.length（行不丢）。
 *
 * @param items 任意（应为 foldSubagents 之后的 topList 数组；畸形宽容）
 * @param lineage 任意（血缘表 {id:{origin,parentSession,...}}；畸形宽容）
 * @returns {{ topList: any[], branchGroupsOf: Map<string, any[]>, foldedCount: number, groupCount: number }}
 *   topList 真实锚原位保留（或插入合成头行），branchGroupsOf 为 rootId → 升序
 *   成员数组，foldedCount 为移出顶层的成员行数，groupCount 为组数。
 */
export function foldBranches(items, lineage) {
  const list = Array.isArray(items) ? items : []
  const table = lineage && typeof lineage === 'object' ? lineage : {}

  const byId = new Map()
  for (const it of list) {
    if (it == null || it.sessionId == null) continue
    byId.set(String(it.sessionId), it)
  }

  // 1) 组锚解析：向上走 parent 链。防环 = 访问集 + 步数上限（链上每个 id 至多
  //    出现一次，上限只是兜底）；结果按起点 id memo。
  const maxWalk = Object.keys(table).length + list.length + 2
  const anchorMemo = new Map()
  function resolveAnchor(id) {
    if (anchorMemo.has(id)) return anchorMemo.get(id)
    const seen = new Set([id])
    let cur = id
    let steps = 0
    let anchor = null // null = 环 / 起点不是分支，整链不聚
    while (true) {
      const p = branchParentOf(cur, table)
      if (!p) {
        // cur 不是分支：起点若不是分支则不聚；否则停在祖先上，cur 即锚
        // （循环不变量：除首轮外 cur 恒为分支，此分支只在起点命中）。
        anchor = steps === 0 ? null : cur
        break
      }
      if (seen.has(p)) break // 成环：anchor 保持 null
      seen.add(p)
      steps++
      if (byId.has(p)) {
        if (!branchParentOf(p, table)) {
          anchor = p // p 在列表且自身非分支 → 真实锚
          break
        }
        cur = p // p 在列表但也是分支 → 继续上溯（链拍平）
        if (steps > maxWalk) break // 环：保持 null
        continue
      }
      // p 不在列表：还是分支 → 继续上溯找更高祖先；否则合成锚 = p
      if (!branchParentOf(p, table)) {
        anchor = p
        break
      }
      cur = p
      if (steps > maxWalk) break // 环：保持 null
    }
    anchorMemo.set(id, anchor)
    return anchor
  }

  // 2) 收集分组。anchorOfRow 按行对象记录锚（重复 id 的畸形行也各算各的），
  //    foldedCount 按行计数——保证守恒律在含洞/重复 id 的输入下仍成立。
  const groupsOf = new Map()
  const anchorOfRow = new Map()
  let foldedCount = 0
  for (const it of list) {
    if (it == null || it.sessionId == null) continue
    const id = String(it.sessionId)
    if (!branchParentOf(id, table)) continue // 非分支 / 子代理 / 自指 → 不动
    const anchor = resolveAnchor(id)
    if (!anchor || anchor === id) continue // 环 / 自锚异常 → 保持顶层可见
    if (!groupsOf.has(anchor)) groupsOf.set(anchor, [])
    groupsOf.get(anchor).push(it)
    anchorOfRow.set(it, anchor)
    foldedCount++
  }

  // 3) 组内升序（与主排序方向无关）；合成锚的组记下最早成员（升序第一个），
  //    合成头将在它原来的位置插一次。
  const earliest = new Set()
  for (const [anchor, members] of groupsOf) {
    members.sort(ascBranchTime)
    if (!byId.has(anchor)) earliest.add(members[0])
  }

  // 4) topList 重建：非成员行（含畸形行）原样保序；成员行移出，合成组在最早
  //    成员的原位置放一次合成头行。
  const topList = []
  const emitted = new Set()
  for (const it of list) {
    const anchor = it == null ? undefined : anchorOfRow.get(it)
    if (anchor === undefined) {
      topList.push(it)
      continue
    }
    if (!byId.has(anchor) && !emitted.has(anchor) && earliest.has(it)) {
      emitted.add(anchor)
      topList.push({ syntheticRoot: anchor, sessionId: 'dsm-src:' + anchor })
    }
  }

  // 空组防御（正常路径每组成员 ≥1，不产出空组）。
  for (const [anchor, members] of groupsOf) {
    if (!members.length) groupsOf.delete(anchor)
  }
  return { topList, branchGroupsOf: groupsOf, foldedCount, groupCount: groupsOf.size }
}
