const test = require('node:test')
const assert = require('node:assert/strict')

const { requestedConversionOutputPath } = require('../src/services/codingServices')

test('reads an explicitly requested conversion output path', () => {
  assert.equal(
    requestedConversionOutputPath('請將 @python/api.py 轉換成 Node.js Express，輸出為 src/api.js'),
    'src/api.js',
  )
})

test('does not mistake the conversion source for an output path', () => {
  assert.equal(
    requestedConversionOutputPath('請將 @python/api.py 轉換成 Node.js Express'),
    '',
  )
})
