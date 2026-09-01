// Render a session log as human-readable Markdown.
//
// Pure: no DOM, no I/O, no dsh imports. Everything it needs arrives as
// arguments, so the renderer is unit-testable without a running host.
//
// Field shapes below were read off real session logs (2026-09-01), not guessed:
//   user/message       data.content            = [{ type:'text', text } | { type:'image', ... }]
//   assistant/message  data.message.content    = [{ type:'text'|'reasoning'|'tool-call', ... }]
//   tool/call          data.{name, arguments}  (arguments is a JSON *string*)
//   tool/result        data.message.content    = [{ type:'tool-result', content:[{type:'text',text}] }]
// Note the asymmetry: user text lives at data.content, assistant text one level
// deeper at data.message.content. Streaming deltas (`assistant/chunk`,
// `text-chunks`, `reasoning-chunks`) are never rendered — `assistant/message`
// already carries the final text for each step.

const MAX_TOOL_ARG = 200

function isoTime(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  try { return new Date(value).toISOString() } catch { return null }
}

function yamlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`
}

function blocksOf(value) {
  return Array.isArray(value) ? value.filter((b) => b && typeof b === 'object') : []
}

// Join the text blocks of a content array; image blocks are counted separately.
function textFromBlocks(blocks) {
  const parts = []
  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n\n').trim()
}

function imageCountOf(blocks) {
  let count = 0
  for (const block of blocks) if (block.type === 'image') count++
  return count
}

function reasoningFromBlocks(blocks) {
  const parts = []
  for (const block of blocks) {
    if (block.type === 'reasoning' && typeof block.text === 'string' && block.text.trim()) parts.push(block.text.trim())
  }
  return parts.join('\n\n')
}

// A short, human-usable summary of one tool call's arguments.
export function summarizeToolArguments(name, rawArguments) {
  let parsed = null
  if (typeof rawArguments === 'string') {
    try { parsed = JSON.parse(rawArguments) } catch { parsed = null }
  } else if (rawArguments && typeof rawArguments === 'object') {
    parsed = rawArguments
  }
  if (parsed === null) return typeof rawArguments === 'string' ? rawArguments.slice(0, MAX_TOOL_ARG) : ''
  if (typeof parsed !== 'object') return String(parsed).slice(0, MAX_TOOL_ARG)
  const preferred = ['command', 'file_path', 'path', 'query', 'url', 'pattern']
  for (const key of preferred) {
    if (typeof parsed[key] === 'string' && parsed[key].trim()) return parsed[key]
  }
  const keys = Object.keys(parsed)
  if (keys.length === 0) return ''
  const rest = {}
  for (const key of keys.slice(0, 6)) {
    const value = parsed[key]
    rest[key] = typeof value === 'string' ? value : JSON.stringify(value)
  }
  return JSON.stringify(rest).slice(0, MAX_TOOL_ARG)
}

/**
 * Render one session as Markdown.
 * @param {object} meta - Session header (`{ id, cwd, createdAt, title? }`).
 * @param {Array<object>} events - Session events as stored in the log.
 * @param {object} [options]
 * @param {boolean} [options.includeReasoning=false] - Emit assistant reasoning blocks.
 * @param {boolean} [options.includeToolResults=false] - Emit tool results.
 * @param {number} [options.exportedAt] - Override the export timestamp (tests).
 * @returns {string} Markdown document.
 */
export function renderSessionMarkdown(meta, events, options = {}) {
  const includeReasoning = options.includeReasoning === true
  const includeToolResults = options.includeToolResults === true
  const header = meta && typeof meta === 'object' ? meta : {}
  const list = Array.isArray(events) ? events : []

  // The last session/title event wins — DSH may retitle a session later on.
  let title = typeof header.title === 'string' && header.title.trim() ? header.title.trim() : null
  for (const ev of list) {
    const data = ev && ev.data
    if (ev && ev.type === 'session/title' && data && typeof data.title === 'string' && data.title.trim()) {
      title = data.title.trim()
    }
  }

  const front = ['---']
  if (title) front.push(`title: ${yamlString(title)}`)
  if (typeof header.id === 'string' && header.id) front.push(`sessionId: ${yamlString(header.id)}`)
  if (typeof header.cwd === 'string' && header.cwd) front.push(`cwd: ${yamlString(header.cwd)}`)
  const created = isoTime(header.createdAt)
  if (created) front.push(`createdAt: ${created}`)
  const exported = isoTime(options.exportedAt)
  if (exported) front.push(`exportedAt: ${exported}`)
  front.push('---')

  const out = [front.join('\n')]
  if (title) out.push('', `# ${title}`)

  let turn = null
  for (const ev of list) {
    if (!ev || typeof ev !== 'object') continue
    const data = ev.data && typeof ev.data === 'object' ? ev.data : {}
    const type = ev.type

    if (type === 'turn/start') {
      const next = Number.isInteger(data.turn) ? data.turn : null
      if (next !== null && next !== turn) {
        turn = next
        out.push('', `## 第 ${turn} 轮`)
      }
      continue
    }

    if (type === 'user/message') {
      const blocks = blocksOf(data.content)
      const text = textFromBlocks(blocks)
      const images = imageCountOf(blocks)
      if (!text && images === 0) continue
      out.push('', '### 用户', '')
      if (text) out.push(text)
      for (let i = 0; i < images; i++) out.push('', `![图片 ${i + 1}](attachment)`)
      continue
    }

    if (type === 'assistant/message') {
      const message = data.message && typeof data.message === 'object' ? data.message : {}
      const blocks = blocksOf(message.content)
      const text = textFromBlocks(blocks)
      const reasoning = includeReasoning ? reasoningFromBlocks(blocks) : ''
      if (!text && !reasoning) continue
      out.push('', '### 助手', '')
      if (reasoning) out.push('> 思考：' + reasoning.split('\n').join('\n> '), '')
      if (text) out.push(text)
      continue
    }

    if (type === 'tool/call') {
      const name = typeof data.name === 'string' && data.name ? data.name : 'tool'
      const summary = summarizeToolArguments(name, data.arguments)
      out.push('', `### 工具调用：\`${name}\``, '')
      out.push(summary ? '```\n' + summary + '\n```' : '（无参数）')
      continue
    }

    if (type === 'tool/result' && includeToolResults) {
      const message = data.message && typeof data.message === 'object' ? data.message : {}
      const blocks = blocksOf(message.content)
      let text = ''
      for (const block of blocks) {
        if (block.type === 'tool-result') text = textFromBlocks(blocksOf(block.content))
      }
      if (text) out.push('', '<details><summary>工具结果</summary>', '', '```\n' + text.slice(0, 2000) + '\n```', '', '</details>')
    }
  }

  out.push('')
  return out.join('\n')
}
