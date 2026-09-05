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

const [persistence, handle, workspaceTypes, workspaceIndex] = await Promise.all([
  source('packages/session/session-persistence/src/index.ts'),
  source('packages/session/session-persistence/src/handle.ts'),
  source('packages/workspace/workspace/src/types.ts'),
  source('packages/workspace/workspace/src/index.ts'),
])

const facts = {
  tag,
  snapshotList: /SessionPersistenceSnapshot/.test(persistence) && /abstract list\(/.test(persistence),
  handleOpen: /abstract open\(/.test(persistence),
  handleRead: /read\(offset\?/.test(handle),
  handleClose: /close\(\): Promise<void>/.test(handle),
  workspaceArchive: /archiveSession/.test(workspaceIndex),
  workspaceAttach: /attachSession/.test(workspaceTypes),
  workspaceDetach: /detachSession/.test(workspaceTypes),
}

if (!facts.snapshotList || !facts.handleOpen || !facts.handleRead || !facts.handleClose) {
  console.error(JSON.stringify(facts, null, 2))
  throw new Error('unknown upstream Session persistence contract')
}
console.log(JSON.stringify(facts, null, 2))
