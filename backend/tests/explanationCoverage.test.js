const test = require('node:test')
const assert = require('node:assert/strict')

const {
  explainedFilePaths,
  missingExplanationFiles,
  explanationFileSections,
  modelUnavailableResponse,
  projectFacts,
} = require('../src/services/readOnlyProjectService')

const files = [
  { path: 'generated.js', content: 'function startClock() { return 1 }' },
  { path: 'teee.js', content: 'class Thermometer { updateTemperature() {} }' },
  { path: 'teee.py', content: 'class ElectronicThermometer:\n    def update_temperature(self):\n        pass' },
]

test('program explanation coverage finds every exact file heading', () => {
  const content = [
    '檔案名稱：generated.js',
    '說明',
    '### 檔案名稱: `teee.js`',
    '說明',
  ].join('\n')

  assert.deepEqual(explainedFilePaths(content, files), ['generated.js', 'teee.js'])
  assert.deepEqual(missingExplanationFiles(content, files), ['teee.py'])
})

test('program explanation coverage accepts markdown numbered file headings', () => {
  const content = [
    '## 重要函式與資料',
    '1. **檔案名稱**：`generated.js`',
    '2. 檔案名稱：`teee.py`',
  ].join('\n')

  assert.deepEqual(explainedFilePaths(content, files), ['generated.js', 'teee.py'])
  assert.deepEqual(missingExplanationFiles(content, files), ['teee.js'])
})

test('fallback file sections fill every missing explanation with an exact heading', () => {
  const snapshot = {
    files,
    coverageNotice: `已掃描本次請求載入的 ${files.length} 個專案相關檔案。`,
  }
  const facts = projectFacts(snapshot)
  const supplemented = explanationFileSections(snapshot, facts, ['teee.py'])

  assert.match(supplemented, /^### 檔案名稱：`teee\.py`/m)
  assert.deepEqual(missingExplanationFiles(supplemented, [files[2]]), [])
  assert.doesNotMatch(supplemented, /檔案名稱：`teee\.js`/)
})

test('an eight-editor explanation identifies only the omitted eighth file', () => {
  const eightFiles = [
    'generated_2.js',
    'generated_2.py',
    'generated_3.js',
    'generated_3.py',
    'generated.js',
    'generated.py',
    'teee.js',
    'teee.py',
  ].map(filePath => ({ path: filePath, content: '' }))
  const firstSeven = eightFiles.slice(0, 7).map(file => `檔案名稱：${file.path}\n- 說明：完成`).join('\n\n---\n\n')

  assert.deepEqual(missingExplanationFiles(firstSeven, eightFiles), ['teee.py'])
})

test('readonly Q&A returns no fallback content when Ollama is unavailable', () => {
  const result = modelUnavailableResponse('program_explanation', 'explanation', {
    source: 'ollama_error',
    model: 'gemma4:26b',
    error: 'Ollama 未連線',
  })

  assert.equal(result.ok, false)
  assert.equal(result.content, '')
  assert.equal(result.source, 'ollama_error')
  assert.match(result.error, /Ollama/)
})
