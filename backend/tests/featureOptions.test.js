const test = require('node:test')
const assert = require('node:assert/strict')

const { getFeaturePrompt, listFeatureOptions } = require('../src/services/featureOptionsService')
const { deterministicAutoIntent, fallbackAutoIntent } = require('../src/services/codingServices')

test('loads all eight core feature policies plus Auto from JSON', () => {
  const options = listFeatureOptions()
  assert.equal(options.length, 9)
  assert.deepEqual(options.map(item => item.intent), [
    'auto', 'generate', 'rewrite', 'convert', 'detect', 'fix', 'analyze', 'create_files', 'explain',
  ])
})

test('feature policies no longer contain an unrelated Python file-creation instruction', () => {
  for (const option of listFeatureOptions()) {
    const configuredText = `${option.purpose || ''}\n${getFeaturePrompt(option.key)}`
    assert.equal(/os\.makedirs|FileNotFoundError|calculator|student score|score_report|test_student_scores/i.test(configuredText), false, option.key)
  }
})

test('Auto does not mistake an add function name for a file-creation request', () => {
  assert.equal(deterministicAutoIntent('請說明 generated.py 的 add 函式用途'), null)
  assert.deepEqual(deterministicAutoIntent('請建立 test_generated.py'), {
    intent: 'create_files',
    reason: '需求明確指定建立 1 個檔案：test_generated.py。',
  })
})

test('Auto routes explicit language conversion before model guessing', () => {
  assert.deepEqual(deterministicAutoIntent('轉換成 java 可以真的開啟使用'), {
    intent: 'convert',
    reason: '需求明確要求程式語言轉換，應使用轉換流程而不是新增檔案或一般產生。',
  })
})

test('Auto has a safe semantic fallback when a model does not return JSON', () => {
  assert.equal(fallbackAutoIntent('請說明目前程式碼的用途與輸入輸出，只說明不要修改。').intent, 'explain')
  assert.equal(fallbackAutoIntent('請檢查目前程式碼是否有錯誤，只回報不要修改。').intent, 'detect')
})
