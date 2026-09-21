const assert = require('node:assert/strict')
const test = require('node:test')

const config = require('../src/config')
const { askAutocompleteLlm } = require('../src/core/llmClient')
const { autocomplete } = require('../src/services/codingServices')

function jsonResponse(payload) {
  return {
    ok: true,
    statusText: 'OK',
    text: async () => JSON.stringify(payload),
  }
}

test('autocomplete prefers the configured chat model and reuses the Ollama model cache', async () => {
  const originalFetch = global.fetch
  const originalAutocompleteModel = config.autocompleteModel
  const originalOllamaModel = config.ollamaModel
  const originalCacheTtl = config.ollamaModelCacheTtlMs
  let tagsRequests = 0
  const generatedModels = []

  config.autocompleteModel = ''
  config.ollamaModel = 'gemma4:26b'
  config.ollamaModelCacheTtlMs = 60000
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/tags')) {
      tagsRequests += 1
      return jsonResponse({
        models: [
          { name: 'gemma4:26b' },
          { name: 'qwen2.5-coder:1.5b' },
          { name: 'llama3.2:latest' },
        ],
      })
    }
    if (String(url).endsWith('/api/generate')) {
      generatedModels.push(JSON.parse(options.body).model)
      return jsonResponse({ response: 'completion', eval_count: 1, prompt_eval_count: 1 })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  try {
    const first = await askAutocompleteLlm('complete this code', { timeoutMs: 1000 })
    const second = await askAutocompleteLlm('complete this code again', { timeoutMs: 1000 })
    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    assert.deepEqual(generatedModels, ['gemma4:26b', 'gemma4:26b'])
    assert.equal(tagsRequests, 1)
  } finally {
    global.fetch = originalFetch
    config.autocompleteModel = originalAutocompleteModel
    config.ollamaModel = originalOllamaModel
    config.ollamaModelCacheTtlMs = originalCacheTtl
  }
})

test('autocomplete falls back to another local model when the preferred code model is blank', async () => {
  const originalFetch = global.fetch
  const originalAutocompleteModel = config.autocompleteModel
  const generatedModels = []

  config.autocompleteModel = ''
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/tags')) {
      return jsonResponse({
        models: [
          { name: 'qwen2.5-coder:1.5b' },
          { name: 'llama3.2:latest' },
        ],
      })
    }
    if (String(url).endsWith('/api/generate')) {
      const body = JSON.parse(options.body)
      generatedModels.push(body.model)
      return jsonResponse({
        response: body.model === 'llama3.2:latest' ? 'def calculate(a, b):\n    return a + b' : '',
        eval_count: 2,
        prompt_eval_count: 3,
      })
    }
    if (String(url).endsWith('/api/chat')) {
      const body = JSON.parse(options.body)
      return jsonResponse({ message: { content: body.model === 'llama3.2:latest' ? 'def calculate(a, b):\n    return a + b' : '' }, eval_count: 2, prompt_eval_count: 3 })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  try {
    const result = await askAutocompleteLlm('complete this code', { timeoutMs: 1000 })
    assert.equal(result.ok, true)
    assert.equal(result.model, 'llama3.2:latest')
    assert.match(result.content, /def calculate/)
    assert.ok(generatedModels.includes('qwen2.5-coder:1.5b'))
    assert.ok(generatedModels.includes('llama3.2:latest'))
  } finally {
    global.fetch = originalFetch
    config.autocompleteModel = originalAutocompleteModel
  }
})

test('autocomplete comment prompts use Ollama output instead of fixed snippets', async () => {
  const originalFetch = global.fetch
  const originalAutocompleteModel = config.autocompleteModel
  let generateRequests = 0
  const modelCompletion = [
    '# 建立電子計算機',
    'def build_tool(name):',
    '    return f"{name} ready"',
    '',
    'print(build_tool("demo"))',
  ].join('\n')

  config.autocompleteModel = 'gemma4:26b'
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/tags')) {
      return jsonResponse({ models: [{ name: 'gemma4:26b' }] })
    }
    if (String(url).endsWith('/api/generate')) {
      generateRequests += 1
      const body = JSON.parse(options.body)
      assert.equal(body.model, 'gemma4:26b')
      assert.equal(body.keep_alive, '10m')
      assert.equal(body.options.num_ctx, 4096)
      assert.equal(body.options.num_predict, 220)
      assert.match(body.prompt, /# 建立電子計算機/)
      assert.match(body.prompt, /infer the software behavior from the whole phrase/)
      assert.ok(Array.isArray(body.options.stop))
      assert.ok(body.options.stop.includes('Here is'))
      assert.ok(!body.options.stop.includes('```'))
      assert.doesNotMatch(body.prompt, /電子指南針|heading_to_direction|DIRECTIONS|compass/i)
      assert.doesNotMatch(body.prompt, /def calculate\(|calculator fallback|fixed snippet/i)
      return jsonResponse({ response: modelCompletion, eval_count: 2, prompt_eval_count: 3 })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  try {
    const result = await autocomplete('# 建立電子計算機\n', '', 'test.py', '', 'python')
    assert.equal(result.ok, true)
    assert.equal(result.source, 'ollama')
    assert.equal(result.suggestion, `${modelCompletion.split('\n').slice(1).join('\n')}\n`)
    assert.equal(generateRequests, 1)
  } finally {
    global.fetch = originalFetch
    config.autocompleteModel = originalAutocompleteModel
  }
})

test('autocomplete retries unsafe model suggestions without using fixed fallback code', async () => {
  const originalFetch = global.fetch
  const originalAutocompleteModel = config.autocompleteModel
  const responses = [
    'def calculate(expression):\n    return eval(expression)',
    [
      'def calculate(a, operator, b):',
      '    if operator == "+":',
      '        return a + b',
      '    if operator == "-":',
      '        return a - b',
      '    raise ValueError("unsupported operator")',
    ].join('\n'),
  ]
  const prompts = []

  config.autocompleteModel = 'gemma4:26b'
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/tags')) {
      return jsonResponse({ models: [{ name: 'gemma4:26b' }] })
    }
    if (String(url).endsWith('/api/generate')) {
      const body = JSON.parse(options.body)
      prompts.push(body.prompt)
      return jsonResponse({ response: responses.shift() || '', eval_count: 2, prompt_eval_count: 3 })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  try {
    const result = await autocomplete('# 建立電子計算機\n', '', 'test.py', '', 'python')
    assert.equal(result.ok, true)
    assert.equal(result.source, 'ollama')
    assert.doesNotMatch(result.suggestion, /eval\s*\(/)
    assert.match(result.suggestion, /operator/)
    assert.equal(prompts.length, 2)
    assert.match(prompts[1], /Previous completion rejected/)
  } finally {
    global.fetch = originalFetch
    config.autocompleteModel = originalAutocompleteModel
  }
})

test('autocomplete strips prompt artifacts and dangling Python tail lines', async () => {
  const originalFetch = global.fetch
  const originalAutocompleteModel = config.autocompleteModel

  config.autocompleteModel = 'gemma4:26b'
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/tags')) {
      return jsonResponse({ models: [{ name: 'gemma4:26b' }] })
    }
    if (String(url).endsWith('/api/generate')) {
      return jsonResponse({
        response: [
          'Suffix:',
          '```python',
          ', num1 - num2)',
          'result = num1 + num2',
          'num2 = float(tokens',
        ].join('\n'),
        eval_count: 2,
        prompt_eval_count: 3,
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  try {
    const result = await autocomplete('# 建立電子計算機\n', '', 'test.py', '', 'python')
    assert.equal(result.ok, true)
    assert.equal(result.suggestion, 'result = num1 + num2')
  } finally {
    global.fetch = originalFetch
    config.autocompleteModel = originalAutocompleteModel
  }
})

test('autocomplete separates standalone Python statements after a complete current line', async () => {
  const originalFetch = global.fetch
  const originalAutocompleteModel = config.autocompleteModel

  config.autocompleteModel = 'gemma4:26b'
  global.fetch = async (url) => {
    if (String(url).endsWith('/api/tags')) {
      return jsonResponse({ models: [{ name: 'gemma4:26b' }] })
    }
    if (String(url).endsWith('/api/generate')) {
      return jsonResponse({
        response: 'if __name__ == "__main__":\n    print("ok")',
        eval_count: 2,
        prompt_eval_count: 3,
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  try {
    const prefix = [
      'class Calculator:',
      '    def divide(self, x, y):',
      '        return x / y',
    ].join('\n')
    const result = await autocomplete(prefix, '', 'test.py', prefix, 'python')
    assert.equal(result.ok, true)
    assert.equal(result.suggestion, '\nif __name__ == "__main__":\n    print("ok")\n')
  } finally {
    global.fetch = originalFetch
    config.autocompleteModel = originalAutocompleteModel
  }
})

test('autocomplete uses a bounded timeout large enough for local model cold starts', () => {
  assert.equal(config.autocompleteTimeoutMs, 25000)
  assert.equal(config.autocompleteNumPredict, 220)
})
