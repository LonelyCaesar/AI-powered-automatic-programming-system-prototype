const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const source = fs.readFileSync(path.join(__dirname, '../src/services/codingServices.js'), 'utf8')

test('inline edit prompt requires Traditional Chinese user-facing summaries and zero fake data policy', () => {
  assert.match(source, /summary: '<繁體中文短摘要>'/)
  assert.match(source, /file_reasons: files\.map\(file => \(\{ path: file\.path, reason: '<繁體中文說明此檔案為何修改或保持不變>' \}\)\)/)
  assert.match(source, /All user-facing JSON string values .*MUST be Traditional Chinese \(zh-TW\)/)
  assert.match(source, /STRICT ZERO-FAKE-DATA POLICY: Do not satisfy requests by creating fake data/)
})
