import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderSessionMarkdown, createSessionMarkdownBuilder, summarizeToolArguments } from '../src/markdown.js'

const META = { id: 'session-abc', cwd: '/work/project', createdAt: 1787190197938 }

test('renders front matter with title, id, cwd and timestamps', () => {
  const md = renderSessionMarkdown(META, [], { exportedAt: 1787190197938 })
  assert.match(md, /^---\n/)
  assert.match(md, /sessionId: "session-abc"/)
  assert.match(md, /cwd: "\/work\/project"/)
  assert.match(md, /createdAt: \d{4}-\d{2}-\d{2}T/)
  assert.match(md, /exportedAt: \d{4}-\d{2}-\d{2}T/)
})

test('empty session renders front matter only', () => {
  const md = renderSessionMarkdown(META, [])
  assert.ok(md.startsWith('---\n'))
  assert.equal(md.trimEnd().split('\n').filter((l) => l === '---').length, 2)
  assert.ok(!md.includes('### 用户'))
})

test('survives null, undefined and junk input', () => {
  assert.doesNotThrow(() => renderSessionMarkdown(null, null))
  assert.doesNotThrow(() => renderSessionMarkdown({}, [null, undefined, 42, { type: 'weird' }]))
  assert.doesNotThrow(() => renderSessionMarkdown({ title: 'x' }, [{ type: 'user/message', data: { content: 'not-an-array' } }]))
})

test('renders user text from data.content', () => {
  const events = [{ type: 'user/message', data: { content: [{ type: 'text', text: '你好' }] } }]
  const md = renderSessionMarkdown(META, events)
  assert.match(md, /### 用户/)
  assert.ok(md.includes('你好'))
})

test('renders assistant text from data.message.content, not data.content', () => {
  // Real logs nest assistant content one level deeper than user content.
  const events = [{
    type: 'assistant/message',
    data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '已完成' }] } },
  }]
  const md = renderSessionMarkdown(META, events)
  assert.match(md, /### 助手/)
  assert.ok(md.includes('已完成'))
})

test('skips tool-call blocks embedded in assistant content', () => {
  const events = [{
    type: 'assistant/message',
    data: {
      turn: 1,
      step: 1,
      message: {
        content: [
          { type: 'tool-call', name: 'bash', arguments: '{"command":"rm -rf /"}' },
          { type: 'text', text: '先看一下' },
        ],
      },
    },
  }]
  const md = renderSessionMarkdown(META, events)
  assert.ok(md.includes('先看一下'))
  assert.ok(!md.includes('rm -rf /'))
})

test('hides reasoning unless requested', () => {
  const events = [{
    type: 'assistant/message',
    data: { message: { content: [{ type: 'reasoning', text: '让我想想' }, { type: 'text', text: '答案' }] } },
  }]
  assert.ok(!renderSessionMarkdown(META, events).includes('让我想想'))
  const withReasoning = renderSessionMarkdown(META, events, { includeReasoning: true })
  assert.ok(withReasoning.includes('让我想想'))
  assert.ok(withReasoning.includes('思考'))
})

test('renders image blocks as placeholders', () => {
  const events = [{ type: 'user/message', data: { content: [{ type: 'image' }, { type: 'text', text: '看图' }] } }]
  const md = renderSessionMarkdown(META, events)
  assert.match(md, /!\[图片 1\]\(attachment\)/)
  assert.ok(md.includes('看图'))
})

test('splits turns into sections', () => {
  const events = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'user/message', data: { content: [{ type: 'text', text: '第一问' }] } },
    { type: 'turn/start', data: { turn: 2 } },
    { type: 'user/message', data: { content: [{ type: 'text', text: '第二问' }] } },
  ]
  const md = renderSessionMarkdown(META, events)
  assert.match(md, /## 第 1 轮/)
  assert.match(md, /## 第 2 轮/)
  assert.ok(md.indexOf('## 第 1 轮') < md.indexOf('第一问'))
  assert.ok(md.indexOf('第一问') < md.indexOf('## 第 2 轮'))
})

test('renders tool calls with a readable argument summary', () => {
  const events = [
    { type: 'tool/call', data: { name: 'bash', arguments: '{"command":"ls -la"}' } },
    { type: 'tool/call', data: { name: 'write', arguments: '{"file_path":"/tmp/a.txt","content":"x"}' } },
  ]
  const md = renderSessionMarkdown(META, events)
  assert.match(md, /### 工具调用：`bash`/)
  assert.ok(md.includes('ls -la'))
  assert.match(md, /### 工具调用：`write`/)
  assert.ok(md.includes('/tmp/a.txt'))
})

test('tool results are opt-in only', () => {
  const events = [{
    type: 'tool/result',
    data: { message: { content: [{ type: 'tool-result', content: [{ type: 'text', text: 'ok' }] }] } },
  }]
  assert.ok(!renderSessionMarkdown(META, events).includes('工具结果'))
  assert.ok(renderSessionMarkdown(META, events, { includeToolResults: true }).includes('工具结果'))
})

test('last session/title event wins over the header title', () => {
  const events = [
    { type: 'session/title', data: { title: '旧标题' } },
    { type: 'session/title', data: { title: '新标题' } },
  ]
  const md = renderSessionMarkdown({ ...META, title: '头部标题' }, events)
  assert.ok(md.includes('新标题'))
  assert.ok(!md.includes('旧标题'))
})

test('summarizeToolArguments prefers meaningful keys and tolerates junk', () => {
  assert.equal(summarizeToolArguments('bash', '{"command":"pwd"}'), 'pwd')
  assert.equal(summarizeToolArguments('write', '{"file_path":"/a/b"}'), '/a/b')
  assert.equal(summarizeToolArguments('tool', 'not json'), 'not json')
  assert.equal(summarizeToolArguments('tool', null), '')
  assert.equal(summarizeToolArguments('tool', '{}'), '')
})

test('quotes front matter values that would break YAML', () => {
  const md = renderSessionMarkdown({ id: 's1', title: 'a: b "c"\nsecond' }, [])
  assert.ok(md.includes('title: "a: b \\"c\\"\\nsecond"'))
})

// ---- 流式构建器（SessionHandle.read 分块导出用）----------------------------

const STREAM_EVENTS = [
  { type: 'session/title', data: { title: 'first' } },
  { type: 'turn/start', data: { turn: 1 } },
  { type: 'user/message', data: { content: [{ type: 'text', text: '你好' }] } },
  { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '在的' }] } } },
  { type: 'session/title', data: { title: 'renamed' } },
  { type: 'tool/call', data: { name: 'write', arguments: JSON.stringify({ file_path: '/a.md' }) } },
]

test('streaming builder output is byte-identical to the one-shot renderer', () => {
  const oneShot = renderSessionMarkdown(META, STREAM_EVENTS, { exportedAt: 1787190197938 })
  const builder = createSessionMarkdownBuilder(META, { exportedAt: 1787190197938 })
  // 以 2 个事件为一块流式喂入（模拟 handle.read offset/length 分页）
  for (let i = 0; i < STREAM_EVENTS.length; i += 2) builder.addEvents(STREAM_EVENTS.slice(i, i + 2))
  assert.equal(builder.finish(), oneShot)
})

test('finish(metaOverride) lets a late header replace front matter fields', () => {
  const builder = createSessionMarkdownBuilder({ id: 'session-abc' })
  builder.addEvents(STREAM_EVENTS)
  const md = builder.finish({ id: 'session-abc', cwd: '/late/cwd', createdAt: 1787190197938 })
  assert.match(md, /cwd: "\/late\/cwd"/)
  assert.match(md, /# renamed/, 'front-matter title must be the LAST session/title event')
})
