// Strict source-contract audit of the official deepseek-harness prerelease.
//
// This is deliberately NOT just "the file exists": each fact pins a concrete
// public API shape the plugin depends on, and — just as important — asserts
// that the things we DO NOT use (private backend fields as a public escape
// hatch) stay out of the contract surface. Fails loudly on any drift.
const tag = process.argv[2]
if (!tag) throw new Error('usage: node scripts/check-upstream-contract.mjs <dsh-tag>')

async function source(path) {
  const url = `https://api.github.com/repos/deepseek-ai/deepseek-harness/contents/${path}?ref=${encodeURIComponent(tag)}`
  let lastError
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-sessions-manager-compat' } })
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
      const body = await response.json()
      if (!body || body.encoding !== 'base64' || typeof body.content !== 'string') throw new Error(`${path}: invalid GitHub response`)
      return Buffer.from(body.content.replace(/\s/g, ''), 'base64').toString('utf8')
    } catch (error) {
      lastError = error
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
    }
  }
  throw lastError
}

const [persistence, handle, revision, workspaceTypes, workspaceIndex] = await Promise.all([
  source('packages/session/session-persistence/src/index.ts'),
  source('packages/session/session-persistence/src/handle.ts'),
  source('packages/session/session-persistence/src/revision.ts'),
  source('packages/workspace/workspace/src/types.ts'),
  source('packages/workspace/workspace/src/index.ts'),
])

const facts = {
  tag,
  // --- persistence service surface ---
  snapshotList: /SessionPersistenceSnapshot/.test(persistence) && /abstract list\(/.test(persistence),
  statObservation: /abstract stat\(/.test(persistence) && /SessionPersistenceSnapshot \| undefined/.test(persistence),
  snapshotRevisionField: /readonly revision: SessionPersistenceRevision/.test(persistence),
  // --- handle surface ---
  handleOpen: /abstract open\(/.test(persistence),
  handleReadBounded: /read\(offset\?[^)]*length\?/.test(handle),
  handleClose: /close\(\): Promise<void>/.test(handle),
  handleFlush: /flush\(options\?/.test(handle),
  // --- revision identity ---
  revisionOpaque: /SessionPersistenceRevision/.test(revision),
  // --- workspace surface the plugin is allowed to touch ---
  workspaceArchive: /archiveSession/.test(workspaceIndex),
  workspaceAttach: /attachSession/.test(workspaceTypes),
  workspaceDetach: /detachSession/.test(workspaceTypes),
  // --- things that must NOT be treated as public contract ---
  noPublicDelete: !/abstract delete\(/.test(persistence) && !/abstract purge\(/.test(persistence),
  noPublicMove: !/abstract move\(/.test(persistence) && !/abstract relocate\(/.test(persistence),
}

const required = {
  snapshotList: true,
  statObservation: true,
  snapshotRevisionField: true,
  handleOpen: true,
  handleReadBounded: true,
  handleClose: true,
  handleFlush: true,
  revisionOpaque: true,
  workspaceArchive: true,
  workspaceAttach: true,
  workspaceDetach: true,
  noPublicDelete: true,
  noPublicMove: true,
}

const missing = Object.keys(required).filter((key) => required[key] && !facts[key])
console.log(JSON.stringify(facts, null, 2))
if (missing.length) {
  throw new Error(`upstream contract drift on ${tag}: missing/changed → ${missing.join(', ')}`)
}
console.log(`contract check OK for ${tag}`)
