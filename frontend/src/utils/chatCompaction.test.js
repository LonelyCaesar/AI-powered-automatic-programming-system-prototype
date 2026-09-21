import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CHAT_AUTO_COMPACT_THRESHOLD_CHARS,
  CHAT_CONTEXT_MAX_CHARS,
  buildStructuredConversationSummary,
  createCompactedChatMessages,
  shouldAutoCompactChatMessages,
} from './chatCompaction.js'
import { createManagedContextBundle } from './contextManager.js'

test('uses a fixed 120000-char limit and automatically compacts at 80 percent', () => {
  assert.equal(CHAT_CONTEXT_MAX_CHARS, 120000)
  assert.equal(CHAT_AUTO_COMPACT_THRESHOLD_CHARS, 96000)
  const messages = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `message ${index}`,
  }))
  assert.equal(shouldAutoCompactChatMessages(messages, { currentUsageChars: 95999 }), false)
  assert.equal(shouldAutoCompactChatMessages(messages, { currentUsageChars: 96000 }), true)
})

test('structured summary preserves the required project state fields', () => {
  const summary = buildStructuredConversationSummary([
    { role: 'user', content: '請完成 Cubi Code 的上下文管理。' },
    { role: 'assistant', content: '已修改 src/App.vue，測試通過。' },
    { role: 'assistant', content: '目前錯誤：轉換找不到 src/api.js。' },
    { role: 'assistant', content: 'TODO：重測錯誤修正。' },
    { role: 'user', content: '最新需求：80% 時背景自動壓縮。' },
  ])
  for (const heading of ['專案目標', '已修改檔案', '已完成事項', '目前錯誤', 'TODO', '使用者最新需求']) {
    assert.match(summary, new RegExp(`## ${heading}`))
  }
  assert.match(summary, /src\/App\.vue/)
  assert.match(summary, /80% 時背景自動壓縮/)
})

test('keeps between 10 and 20 recent messages in the same compacted chat', () => {
  const messages = Array.from({ length: 40 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `message ${index}` }))
  const compacted = createCompactedChatMessages(messages, { keepMessages: 16 })
  assert.equal(compacted[0].type, 'compacted_history')
  assert.equal(compacted.length, 17)
  assert.equal(compacted.at(-1).content, 'message 39')
  assert.equal(compacted[0].oldMessages.length, 24)
})

test('repeated compaction keeps accumulating in the same conversation', () => {
  const first = Array.from({ length: 40 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `message ${index}` }))
  const compactedOnce = createCompactedChatMessages(first, { keepMessages: 16 })
  const continued = [...compactedOnce, ...Array.from({ length: 20 }, (_, index) => ({ role: 'user', content: `continued ${index}` }))]
  const compactedTwice = createCompactedChatMessages(continued, { keepMessages: 16 })
  assert.equal(compactedTwice[0].oldMessages.length, 44)
  assert.equal(compactedTwice.at(-1).content, 'continued 19')
})

test('managed context cannot exceed the fixed limit even when a larger limit is requested', () => {
  const bundle = createManagedContextBundle([
    { ok: true, file_path: 'large.txt', content: 'x'.repeat(150000) },
  ], { maxChars: 999999, maxCharsPerFile: 999999 })
  assert.equal(bundle.maxChars, 120000)
  assert.equal(bundle.maxCharsPerFile, 30000)
  assert.ok(bundle.totalChars <= 120000)
})
