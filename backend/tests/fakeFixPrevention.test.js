const test = require('node:test')
const assert = require('node:assert/strict')

const { prepareInlineCommand } = require('../src/services/agentService')
const {
  isNoFixIndicatedByReason,
  isTrivialOrFakeFix,
  stripCommentsAndWhitespace,
} = require('../src/services/codingServices')

function jsonResponse(payload) {
  return {
    ok: true,
    statusText: 'OK',
    text: async () => JSON.stringify(payload),
  }
}

function mockOllamaResponses(contents) {
  const originalFetch = global.fetch
  const queue = [...contents]
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/tags')) {
      return jsonResponse({ models: [{ name: 'qwen2.5-coder:7b' }] })
    }
    if (String(url).endsWith('/api/chat')) {
      const content = queue.length ? queue.shift() : contents.at(-1)
      return jsonResponse({ message: { content }, eval_count: 2, prompt_eval_count: 3 })
    }
    if (String(url).endsWith('/api/generate')) {
      const content = queue.length ? queue.shift() : contents.at(-1)
      return jsonResponse({ response: content, eval_count: 2, prompt_eval_count: 3 })
    }
    throw new Error(`Unexpected request: ${url} ${options.body || ''}`)
  }
  return () => { global.fetch = originalFetch }
}

test('isNoFixIndicatedByReason recognizes statements of correctness without fake edits', () => {
  assert.equal(isNoFixIndicatedByReason('已檢查完整內容，未發現語法、名稱、常值或明顯執行邏輯錯誤，保持原內容。'), true)
  assert.equal(isNoFixIndicatedByReason('✅ 經檢查目前程式碼毫無錯誤，不需進行任何修正。'), true)
  assert.equal(isNoFixIndicatedByReason('目前語法與邏輯皆為正常，無需修改。'), true)
  assert.equal(isNoFixIndicatedByReason('未發現實質錯誤。'), true)
  
  assert.equal(isNoFixIndicatedByReason('已修正未定義名稱 value，現在沒有錯誤了。'), false)
  assert.equal(isNoFixIndicatedByReason('補上漏寫的斷行符號。'), false)
})

test('isTrivialOrFakeFix catches trivial comment additions and whitespace changes in python and js', () => {
  const oldPy = 'def calc(a, b):\n    # original comment\n    return a + b\n'
  const newPy = 'def calc(a, b):\n    # original comment (Fixed typo in hex code logic if any...)\n    return a + b\n\n'
  assert.equal(isTrivialOrFakeFix(oldPy, newPy, 'math.py', ''), true)

  const oldJs = 'function add(a,b){return a+b;}'
  const newJs = 'function add(a, b) {\n  /* formatted */\n  return a + b;\n}'
  assert.equal(isTrivialOrFakeFix(oldJs, newJs, 'math.js', ''), true)
  
  const oldReal = 'function add(a, b) { return a - b; }'
  const newReal = 'function add(a, b) { return a + b; }'
  assert.equal(isTrivialOrFakeFix(oldReal, newReal, 'math.js', '已將減號修正為加號'), false)
})

test('prepareInlineCommand in fix mode converts fake trivial comment edits into no_change', async () => {
  const originalCode = 'def hello():\n    print("Hello world")\n'
  const fakeFixedCode = 'def hello():\n    # updated logic for printing\n    print("Hello world")\n'
  const restoreFetch = mockOllamaResponses([
    JSON.stringify({
      summary: '進行微調並加入註解',
      file_reasons: [{ path: 'app.py', reason: '加入詳細說明註解以利維持穩定' }],
      files: [{ path: 'app.py', content: fakeFixedCode }],
    }),
  ])

  try {
    const result = await prepareInlineCommand('錯誤修正', 'app.py', '', originalCode, [], {
      operation: 'fix',
      returnOnlyAllowedEditPaths: true,
      allowedEditPaths: ['app.py'],
    })
    assert.equal(result.ok, true)
    assert.equal(result.no_change, true)
    assert.equal(result.diff_text, '')
  } finally {
    restoreFetch()
  }
})

test('prepareInlineCommand in fix mode converts explicit no-error statements into no_change despite formatting diffs', async () => {
  const originalCode = 'const x = 100;\n'
  const reformattingCode = 'const x = 100;\n\n// checked OK\n'
  const restoreFetch = mockOllamaResponses([
    JSON.stringify({
      summary: '經過深度掃描與安全分析',
      file_reasons: [{ path: 'test.js', reason: '經檢查程式碼在語法及邏輯上未發現任何實質錯誤，不需要修改' }],
      files: [{ path: 'test.js', content: reformattingCode }],
    }),
  ])

  try {
    const result = await prepareInlineCommand('錯誤修正', 'test.js', '', originalCode, [], {
      operation: 'fix',
      returnOnlyAllowedEditPaths: true,
      allowedEditPaths: ['test.js'],
    })
    assert.equal(result.ok, true)
    assert.equal(result.no_change, true)
  } finally {
    restoreFetch()
  }
})
