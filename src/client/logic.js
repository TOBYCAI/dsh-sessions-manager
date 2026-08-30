// dsh-sessions-manager — client 纯判定逻辑。
//
// 侧栏增强里最容易随 DSH 上游变化出回归的三块判定抽到这里：
// 状态点语义、拖拽可放置校验、fiber node → 会话/工作区识别。
// 本模块不碰 DOM，node --test 直接可测（tests/client-logic.test.js）。

// 状态点语义：manual 未读最高优先；done 在当前查看的行上不亮绿
// （读过即视为已读）。返回逻辑态名，颜色映射留在 UI 层。
// 历史回归：DSH 曾把 running 报为 ongoing（9766476），上游枚举变化要盯这里。
export function dotStateFor({ manualUnread = false, dataState = '', isActive = false } = {}) {
  if (manualUnread) return 'manual'
  switch (dataState) {
    case 'running': return 'running'
    case 'warning': return 'feedback'
    case 'error': return 'error'
    case 'done': return isActive ? null : 'done'
    default: return null
  }
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
