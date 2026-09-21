import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const componentPath = fileURLToPath(new URL('./ChatCommandPanel.vue', import.meta.url))
const source = fs.readFileSync(componentPath, 'utf8')

test('command panel presents feature input as task instructions instead of chat', () => {
  assert.match(source, /AI 任務 \/ 指令/)
  assert.match(source, /開啟新任務/)
  assert.match(source, /輸入「\$\{currentCommandLabel\.value\}」的任務指令/)
  assert.match(source, /自動判斷：輸入任務需求/)
  assert.doesNotMatch(source, /AI 對話 \/ 指令/)
})

test('bottom command panel keeps the original selector composer status order', () => {
  const bottomPanel = source.match(/<div class="bottom-command-panel">[\s\S]*?<div class="enter-note">[\s\S]*?<\/div>/)?.[0] || ''
  assert.match(bottomPanel, /功能選項：/)
  assert.match(bottomPanel, /class="input-row agent-composer-row"/)
  assert.match(bottomPanel, /IDE 上下文：/)
  assert.match(bottomPanel, /規劃模式：/)
  assert.ok(bottomPanel.indexOf('功能選項：') < bottomPanel.indexOf('class="input-row agent-composer-row"'))
  assert.ok(bottomPanel.indexOf('class="input-row agent-composer-row"') < bottomPanel.indexOf('IDE 上下文：'))
  assert.ok(bottomPanel.indexOf('IDE 上下文：') < bottomPanel.indexOf('Enter 送出；Shift + Enter 換行'))
  assert.doesNotMatch(bottomPanel, /task-toggle-strip/)
  assert.doesNotMatch(bottomPanel, /context-injection-strip/)
})

test('command history copy uses task records', () => {
  assert.match(source, /任務紀錄/)
  assert.match(source, /確定要刪除這筆任務紀錄/)
  assert.doesNotMatch(source, /確定要刪除這筆對話紀錄/)
})

test('files mode tells users the next step before and after opening a workspace', () => {
  assert.match(source, /先開啟專案資料夾，再輸入要建立、修改或補齊的檔案需求/)
  assert.match(source, /描述要建立、修改或補齊哪些檔案/)
  assert.match(source, /下一步：先開啟專案資料夾/)
  assert.match(source, /下一步：輸入檔案需求，送出後檢查修改差異與測試結果/)
})

test('assistant messages render markdown formatting safely', () => {
  assert.match(source, /v-html="renderMessageContent\(msg\.content\)"/)
  assert.match(source, /function escapeHtml/)
  assert.match(source, /function renderMessageContent/)
  assert.match(source, /openList\('ol'\)/)
  assert.match(source, /markdown-body/)
})

test('markdown report typography uses one readable base size', () => {
  assert.match(source, /\.message-content\.markdown-body\s*\{[\s\S]*font-size:\s*14px/)
  assert.match(source, /\.markdown-body :deep\(p\)\s*\{[\s\S]*font-size:\s*14px/)
  assert.match(source, /\.markdown-body :deep\(li\)\s*\{[\s\S]*font-size:\s*14px/)
  assert.match(source, /\.markdown-body :deep\(code\)\s*\{[\s\S]*font-size:\s*14px/)
})
