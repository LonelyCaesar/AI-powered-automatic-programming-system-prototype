const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { collectPlanFilePaths, selectPlanContextFiles } = require('../src/services/codingServices')

test('planning context keeps all supplied files when IDE context is enabled', () => {
  const files = [
    { file_path: 'active.js', role: 'active_file' },
    { file_path: 'open.js', role: 'open_editor_file' },
    { file_path: 'pinned.js', role: 'pinned_file' },
  ]
  assert.deepEqual(selectPlanContextFiles(files, true), files)
})

test('planning context removes automatic IDE files when disabled', () => {
  const files = [
    { file_path: 'active.js', role: 'active_file' },
    { file_path: 'open.js', role: 'open_editor_file' },
    { file_path: 'pinned.js', role: 'pinned_file' },
    { file_path: 'explicit.js', role: 'task_target' },
    { file_path: 'explicit-2.js', role: 'explicit_task_target' },
    { file_path: '__conversation__/chat_history.md', role: 'conversation_history', content_type: 'conversation_history' },
    { file_path: 'unclassified.js' },
  ]

  assert.deepEqual(
    selectPlanContextFiles(files, false).map(item => item.file_path),
    ['explicit.js', 'explicit-2.js', '__conversation__/chat_history.md'],
  )
})

test('planning result extracts affected files from the real instruction and response', () => {
  assert.deepEqual(
    collectPlanFilePaths(
      '請規劃修改 frontend/src/App.vue',
      '測試階段也要確認 README.md 與 backend/src/server.js。',
    ),
    ['frontend/src/App.vue', 'README.md', 'backend/src/server.js'],
  )
})

test('planning mode does not contain fixed clarification fallback prompts', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/codingServices.js'), 'utf8')
  const planTaskBody = source.match(/async function planTask[\s\S]*?\n}\n\nasync function explainProject/)?.[0] || ''
  const forbiddenPrompts = [
    ['你希望這次', '交付到什麼程度'].join(''),
    ['技術方向', '要如何決定'].join(''),
    ['哪些項目是你', '最在意'].join(''),
    ['fallback', 'ClarificationQuestions'].join(''),
  ]

  assert.ok(planTaskBody.includes("type: 'plan'"))
  assert.ok(planTaskBody.includes("type: 'plan_clarification'"))
  for (const prompt of forbiddenPrompts) assert.equal(source.includes(prompt), false)
})
