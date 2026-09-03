// Storage usage aggregation (pure, no I/O).
//
// Kept out of the host bundle so it can be unit-tested directly
// (tests/storage-stats.test.js). Takes the session items the host already
// builds (with `sizeBytes` filled in) and rolls them up per workspace plus a
// "largest sessions" leaderboard.
//
// Sessions without a workspace path land in a single "未分组" bucket — that is
// DSH's own label for orphans, so the panel speaks the same language as the
// sidebar.

export const UNGROUPED_KEY = '__ungrouped__'

function isFiniteSize(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * Roll session sizes up per workspace and pick the largest sessions.
 *
 * @param {Array<{sessionId: string, title?: string|null, workspacePath?: string|null,
 *   workspaceTitle?: string|null, sizeBytes?: number|null}>} items
 * @param {object} [options]
 * @param {number} [options.topN=10] - How many entries the leaderboard holds.
 * @returns {{
 *   totalBytes: number,
 *   sessionCount: number,
 *   sizedSessions: number,
 *   unknownSessions: number,
 *   workspaces: Array<{key: string, path: string|null, title: string|null,
 *     bytes: number, sessions: number, share: number}>,
 *   top: Array<{sessionId: string, title: string|null, workspacePath: string|null,
 *     workspaceTitle: string|null, sizeBytes: number}>
 * }}
 */
export function aggregateStorage(items, options = {}) {
  const topN = Number.isInteger(options.topN) && options.topN > 0 ? options.topN : 10
  const list = Array.isArray(items) ? items : []

  const buckets = new Map()
  const sized = []
  let totalBytes = 0
  let unknownSessions = 0
  // Counted entries only: sessionCount must always equal
  // sizedSessions + unknownSessions, or the panel would show a total that
  // disagrees with its own breakdown.
  let counted = 0

  for (const item of list) {
    if (!item || item.sessionId == null) continue
    counted++
    const id = String(item.sessionId)
    const path = item.workspacePath ? String(item.workspacePath) : null
    const key = path || UNGROUPED_KEY

    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { key, path, title: item.workspaceTitle ? String(item.workspaceTitle) : null, bytes: 0, sessions: 0 }
      buckets.set(key, bucket)
    }
    bucket.sessions++

    if (isFiniteSize(item.sizeBytes)) {
      bucket.bytes += item.sizeBytes
      totalBytes += item.sizeBytes
      sized.push({
        sessionId: id,
        title: item.title || null,
        workspacePath: path,
        workspaceTitle: bucket.title,
        sizeBytes: item.sizeBytes,
      })
    } else {
      unknownSessions++
    }
  }

  const workspaces = [...buckets.values()]
    .sort((a, b) => (b.bytes - a.bytes) || (b.sessions - a.sessions) || a.key.localeCompare(b.key))
    .map((bucket) => ({ ...bucket, share: totalBytes > 0 ? bucket.bytes / totalBytes : 0 }))

  const top = sized
    .sort((a, b) => (b.sizeBytes - a.sizeBytes) || a.sessionId.localeCompare(b.sessionId))
    .slice(0, topN)

  return {
    totalBytes,
    sessionCount: counted,
    sizedSessions: sized.length,
    unknownSessions,
    workspaces,
    top,
  }
}
