const test = require('node:test')
const assert = require('node:assert/strict')

const { compactContextFiles } = require('../src/services/contextManager')

test('backend context budget remains fixed when a caller requests a larger limit', () => {
  const bundle = compactContextFiles([
    { ok: true, file_path: 'large.txt', content: 'x'.repeat(150000) },
  ], { maxChars: 999999, maxCharsPerFile: 999999 })
  assert.equal(bundle.max_chars, 120000)
  assert.ok(bundle.total_chars <= 120000)
  assert.ok(bundle.files[0].included_chars <= 30000)
})
