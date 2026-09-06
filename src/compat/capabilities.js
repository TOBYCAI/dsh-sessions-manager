// Capability matrix for the two DSH persistence generations. Every user-visible
// action gets its own availability flag plus a Chinese reason, so the UI can
// disable buttons honestly and the host routes can refuse with a stable error.
//
// Guiding rule (revised 2026-09-06 by explicit user decision): the official
// SessionHandle-era contract (dsh-v0.1.3-alpha.1) exposes NO delete and NO
// relocation — but legacy implementations were never pure-public either (they
// used the official `locate` to find the path, then acted on the filesystem
// directly). The user chose to keep that semi-official approach in the handle
// era: private-path operations ARE allowed, but only through the guarded
// derivation in src/handle-era-paths.js (backend root instance field → session
// directory structure → id ownership) plus handle-era-ops.js (writer probe,
// backup + rollback). Any derivation failure degrades to "unavailable".
//
// Action vocabulary (canonical):
//   readInspection        read/list/stat the stored log (read-only)
//   archive               archive/unarchive via workspaceRegistry (a marking op)
//   softTrash             move a session into the plugin recycle bin (log stays put)
//   restoreIndexedSession restore a trashed session after verifying the
//                         underlying stored session still exists
//   physicalPurge         irreversibly delete the stored log (guarded fs rm)
//   relocateSession       move a session across workspaces (changes header cwd)
//
// Legacy aliases (read / trash / restoreTrash / purge / move) are kept so the
// client and older routes keep working during the transition.

function action(available, reason = null) {
  return { available: !!available, reason: available ? null : reason }
}

export function detectCapabilities({ persistence, workspaceRegistry }) {
  const handleApi = !!(persistence && typeof persistence.open === 'function')
  const legacyRead = !!(persistence && typeof persistence.readFrom === 'function')
  const legacyLocate = !!(persistence && (typeof persistence.locate === 'function'
    || (persistence.backend && typeof persistence.backend.locate === 'function')))
  // handle 时代：root 必须直接读自后端实例字段（session-persistence-jsonl 的
  // `root`），拿不到整体降级——绝不猜路径。
  const handleEraRoot = !!(handleApi && persistence
    && typeof persistence.root === 'string' && persistence.root.length > 0)
  const canVerifyExistence = !!(handleApi || legacyRead
    || (persistence && typeof persistence.stat === 'function'))
  const readOk = legacyRead || handleApi
  const workspaceInternals = !!(workspaceRegistry
    && workspaceRegistry.headers && workspaceRegistry.sessionPaths
    && typeof workspaceRegistry.replaceHeaderIndex === 'function')

  const matrix = {
    readInspection: action(readOk, '当前 DSH 未提供可识别的会话读取接口'),
    archive: action(!!(workspaceRegistry && typeof workspaceRegistry.archiveSession === 'function'), '当前 DSH 未提供归档接口'),
    softTrash: action(readOk, '当前 DSH 无法读取会话，不能安全移入回收站'),
    // 恢复不再无条件宣称可用：必须能校验底层会话仍存在（stat 或 list），
    // 否则恢复只会制造一条指向已消失日志的僵尸条目。
    restoreIndexedSession: action(canVerifyExistence, '当前 DSH 无法校验底层会话是否存在，不能安全恢复'),
    physicalPurge: action(
      (!handleApi && legacyLocate) || (handleApi && handleEraRoot && canVerifyExistence),
      handleApi && !handleEraRoot
        ? '无法从当前 DSH 后端确认会话存储根目录，已停止物理删除以保护数据安全'
        : '当前 DSH 版本尚未提供经过验证的安全永久删除能力；移入回收站不会释放磁盘空间',
    ),
    relocateSession: action(
      (!handleApi && legacyRead && legacyLocate && workspaceInternals)
      || (handleApi && handleEraRoot && readOk && workspaceInternals),
      handleApi && !workspaceInternals
        ? '当前 DSH 未提供工作区注册表内部结构，跨工作区移动后无法即时刷新分组'
        : handleApi && !handleEraRoot
          ? '无法从当前 DSH 后端确认会话存储根目录，已停止移动以保护数据安全'
          : '当前 DSH 版本尚未提供经过验证的跨工作区迁移能力',
    ),
  }
  // Legacy aliases for existing client/routes/tests.
  matrix.read = matrix.readInspection
  matrix.trash = matrix.softTrash
  matrix.restoreTrash = matrix.restoreIndexedSession
  matrix.purge = matrix.physicalPurge
  matrix.move = matrix.relocateSession

  return {
    persistence: handleApi ? 'session-handle' : 'legacy',
    actions: matrix,
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
