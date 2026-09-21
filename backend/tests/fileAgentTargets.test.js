const test = require('node:test')
const assert = require('node:assert/strict')

const { extractExplicitRequestedPaths } = require('../src/services/agentService')

test('file agent creates only the requested test file and keeps the mentioned source as context', () => {
  const instruction = '請建立 test_generated.py，使用 pytest 為 generated.py 的 add 函式加入測試，不要修改 generated.py。'
  assert.deepEqual(extractExplicitRequestedPaths(instruction), ['test_generated.py'])
})

test('file agent keeps multiple explicitly requested output files', () => {
  assert.deepEqual(
    extractExplicitRequestedPaths('請建立 index.html、style.css 與 script.js'),
    ['index.html', 'style.css', 'script.js'],
  )
})
