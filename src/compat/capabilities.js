function action(available, reason = null) {
  return { available: !!available, reason: available ? null : reason }
}

export function detectCapabilities({ persistence, workspaceRegistry }) {
  const handleApi = !!(persistence && typeof persistence.open === 'function')
  const legacyRead = !!(persistence && typeof persistence.readFrom === 'function')
  const legacyLocate = !!(persistence && (typeof persistence.locate === 'function'
    || (persistence.backend && typeof persistence.backend.locate === 'function')))
  const workspaceInternals = !!(workspaceRegistry
    && workspaceRegistry.headers && workspaceRegistry.sessionPaths
    && typeof workspaceRegistry.replaceHeaderIndex === 'function')

  return {
    persistence: handleApi ? 'session-handle' : 'legacy',
    actions: {
      read: action(legacyRead || handleApi, '当前 DSH 未提供可识别的会话读取接口'),
      archive: action(!!(workspaceRegistry && typeof workspaceRegistry.archiveSession === 'function'), '当前 DSH 未提供归档接口'),
      trash: action(legacyRead || handleApi, '当前 DSH 无法读取会话，不能安全移入回收站'),
      restoreTrash: action(true),
      purge: action(!handleApi && legacyLocate, '当前 DSH 版本尚未提供经过验证的安全永久删除能力'),
      move: action(!handleApi && legacyRead && legacyLocate && workspaceInternals, '当前 DSH 版本尚未提供经过验证的跨工作区迁移能力'),
    },
  }
}

export function requireCapability(capabilities, name) {
  const value = capabilities && capabilities.actions && capabilities.actions[name]
  if (value && value.available) return
  const error = new Error((value && value.reason) || `当前环境不支持 ${name}`)
  error.status = 409
  error.code = 'DSM_CAPABILITY_UNAVAILABLE'
  throw error
}
