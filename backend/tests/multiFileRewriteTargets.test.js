const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildInlineFileResults,
  findMissingRequiredEditPaths,
  formatInlineFixReport,
} = require('../src/services/codingServices')

test('rejects a multi-file rewrite when only the first Monaco target changed', () => {
  const required = ['generated_2.py', 'generated_3.py', 'generated.py', 'teee.py']
  const changed = [{ path: 'generated_2.py' }]

  assert.deepEqual(findMissingRequiredEditPaths(required, changed), [
    'generated_3.py',
    'generated.py',
    'teee.py',
  ])
})

test('accepts the rewrite scope only after every Monaco target changed', () => {
  const required = ['generated_2.py', 'generated_3.py', 'generated.py', 'teee.py']
  const changed = required.map(path => ({ path }))

  assert.deepEqual(findMissingRequiredEditPaths(required, changed), [])
})

test('multi-file fix reports both modified and unchanged Monaco targets with reasons', () => {
  const editable = [
    { path: 'app.py', content: 'print(value)' },
    { path: 'app.js', content: 'console.log(value)' },
    { path: 'style.css', content: 'body {}' },
  ]
  const parsed = {
    file_reasons: [
      { path: 'app.py', reason: '修正未定義名稱 value' },
      { path: 'app.js', reason: '語法與名稱引用皆正確' },
      { path: 'style.css', reason: 'CSS 規則完整且無無效宣告' },
    ],
  }
  const results = buildInlineFileResults(parsed, editable, [{ path: 'app.py' }])

  assert.deepEqual(results.map(item => item.status), ['modified', 'unchanged', 'unchanged'])
  const report = formatInlineFixReport(results)
  assert.match(report, /app\.py：已修正/)
  assert.match(report, /app\.js：未修改/)
  assert.match(report, /style\.css：未修改/)
})

test('sanitizes contradictory unchanged reasons that claim modifications', () => {
  const editable = [
    { path: 'generated.html', content: '<div>test</div>' },
  ]
  const parsed = {
    file_reasons: [
      { path: 'generated.html', reason: '修正了 letter-lag 的 CSS 語法錯誤並移除了 pauseTimer' },
    ],
  }
  // File is not modified
  const results = buildInlineFileResults(parsed, editable, [])
  assert.equal(results[0].status, 'unchanged')
  assert.doesNotMatch(results[0].reason, /修正了|修復了|移除了/)
  assert.match(results[0].reason, /已檢查完整內容，未發現語法/)
  const report = formatInlineFixReport(results)
  assert.doesNotMatch(report, /未修改 — 修正了/)
})
