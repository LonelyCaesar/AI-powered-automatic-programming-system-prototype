const assert = require('node:assert/strict')
const test = require('node:test')

const { prepareInlineCommand } = require('../src/services/agentService')
const { convertCode, fixErrors, rewriteCode } = require('../src/services/codingServices')

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

test('rewrite rejects invalid model output instead of reporting success', async () => {
  const restoreFetch = mockOllamaResponses([
    'export const value = {',
    'export const value = {',
  ])

  try {
    const result = await rewriteCode('export const value = 1;', '請改善命名', '', {
      filePath: 'src/value.js',
    })
    assert.equal(result.ok, false)
    assert.match(result.error, /未通過完整性／語法檢查/)
    assert.equal(result.new_content, '')
  } finally {
    restoreFetch()
  }
})

test('fix returns validated fixed code as new content', async () => {
  const restoreFetch = mockOllamaResponses([
    '```javascript\nfunction add(a, b) { return a + b; }\nmodule.exports = { add };\n```',
  ])

  try {
    const result = await fixErrors('function add(a, b) { return a - b }', '修正加法錯誤', '', {
      filePath: 'math.js',
    })
    assert.equal(result.ok, true)
    assert.match(result.new_content, /return a \+ b/)
    assert.equal(result.validation.ok, true)
  } finally {
    restoreFetch()
  }
})

test('inline fix strips nested file_output wrappers before producing a diff', async () => {
  const wrappedHtml = [
    '<file_output>',
    'generated.js',
    '<!DOCTYPE html>',
    '<html lang="zh-Hant">',
    '<head><meta charset="UTF-8"><title>計算機</title></head>',
    '<body><main>OK</main><script>const value = 1;</script></body>',
    '</html>',
    '</file_output>',
  ].join('\n')
  const restoreFetch = mockOllamaResponses([
    JSON.stringify({
      summary: 'fixed',
      file_reasons: [{ path: 'generated.html', reason: '清理模型包裝' }],
      files: [{ path: 'generated.html', content: wrappedHtml }],
    }),
  ])

  try {
    const result = await prepareInlineCommand('請修正', 'generated.html', '', '<!DOCTYPE html>\n<html><body><main>OK</main></body></html>', [], {
      operation: 'fix',
      returnOnlyAllowedEditPaths: true,
      allowedEditPaths: ['generated.html'],
    })
    assert.equal(result.ok, true)
    assert.doesNotMatch(result.new_content, /file_output|generated\.js/)
    assert.match(result.new_content, /^<!DOCTYPE html>/)
    assert.match(result.new_content, /<script>const value = 1;<\/script>/)
  } finally {
    restoreFetch()
  }
})

test('conversion fails fast when target language is unknown', async () => {
  const result = await convertCode('print("hello")', 'auto', '請幫我轉換這段程式', 'hello.py')

  assert.equal(result.ok, false)
  assert.match(result.error, /目標語言/)
  assert.equal(result.new_content, '')
})
