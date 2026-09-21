const assert = require('node:assert/strict')
const test = require('node:test')

const { generateCode } = require('../src/services/codingServices')

function jsonResponse(payload) {
  return {
    ok: true,
    statusText: 'OK',
    text: async () => JSON.stringify(payload),
  }
}

test('code generation disables model thinking so the final content is not blank', async () => {
  const originalFetch = global.fetch
  const requestBodies = []

  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/tags')) {
      return jsonResponse({ models: [{ name: 'gemma4:26b' }] })
    }
    if (String(url).endsWith('/api/chat') || String(url).endsWith('/api/generate')) {
      const body = JSON.parse(options.body)
      requestBodies.push(body)
      const content = body.think === false ? 'print("compass ready")\n' : ''
      return String(url).endsWith('/api/chat')
        ? jsonResponse({ message: { content }, eval_count: 2, prompt_eval_count: 3 })
        : jsonResponse({ response: content, eval_count: 2, prompt_eval_count: 3 })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  try {
    const result = await generateCode('請產生電子指南針範例', '', {
      filePath: 'generated.py',
      language: 'python',
    })
    assert.equal(result.ok, true)
    assert.match(result.new_content, /compass ready/)
    assert.equal(requestBodies.length > 0, true)
    assert.equal(requestBodies.every(body => body.think === false), true)
  } finally {
    global.fetch = originalFetch
  }
})

test('single-program generation separates companion data files from main editor content', async () => {
  const originalFetch = global.fetch
  const response = [
    '<file_output path="generated.py">',
    'import csv',
    'with open("data.csv", encoding="utf-8") as source:',
    '    print(list(csv.DictReader(source)))',
    '</file_output>',
    '<file_output path="data.csv">',
    'name,value',
    '</file_output>',
  ].join('\n')

  global.fetch = async (url) => {
    if (String(url).endsWith('/api/tags')) {
      return jsonResponse({ models: [{ name: 'gemma4:26b' }] })
    }
    if (String(url).endsWith('/api/chat')) {
      return jsonResponse({ message: { content: response }, eval_count: 4, prompt_eval_count: 5 })
    }
    if (String(url).endsWith('/api/generate')) {
      return jsonResponse({ response, eval_count: 4, prompt_eval_count: 5 })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  try {
    const result = await generateCode('產生會讀取 CSV 的 Python 程式，沒有資料檔時一併建立', '', {
      filePath: 'generated.py',
      language: 'python',
    })
    assert.equal(result.ok, true)
    assert.match(result.new_content, /open\("data\.csv"/)
    assert.deepEqual(result.files, [])
    assert.equal(result.support_files.length, 1)
    assert.equal(result.support_files[0].path, 'data.csv')
    assert.equal(result.support_files[0].content.trim(), 'name,value')
  } finally {
    global.fetch = originalFetch
  }
})

test('code generation retries when generated code references a missing local data file', async () => {
  const originalFetch = global.fetch
  let modelCalls = 0
  const rawProgram = [
    'import csv',
    'with open("sales.csv", encoding="utf-8") as source:',
    '    print(sum(float(row["amount"]) for row in csv.DictReader(source)))',
  ].join('\n')
  const completeOutput = [
    '<file_output path="sales_report.py">',
    rawProgram,
    '</file_output>',
    '<file_output path="sales.csv">',
    'item,amount',
    '</file_output>',
  ].join('\n')

  global.fetch = async (url) => {
    if (String(url).endsWith('/api/tags')) {
      return jsonResponse({ models: [{ name: 'gemma4:26b' }] })
    }
    if (String(url).endsWith('/api/chat') || String(url).endsWith('/api/generate')) {
      modelCalls += 1
      const content = modelCalls === 1 ? rawProgram : completeOutput
      return String(url).endsWith('/api/chat')
        ? jsonResponse({ message: { content }, eval_count: 4, prompt_eval_count: 5 })
        : jsonResponse({ response: content, eval_count: 4, prompt_eval_count: 5 })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  try {
    const result = await generateCode('請產生會讀取 sales.csv 的銷售報表，沒有資料檔時一併建立', '', {
      filePath: 'sales_report.py',
      language: 'python',
      contextFiles: [],
    })
    assert.equal(result.ok, true)
    assert.equal(modelCalls, 2)
    assert.equal(result.support_files.length, 1)
    assert.equal(result.support_files[0].path, 'sales.csv')
    assert.equal(result.support_files[0].content.trim(), 'item,amount')
  } finally {
    global.fetch = originalFetch
  }
})

test('code generation falls back to a dedicated empty support-file schema when block format is ignored', async () => {
  const originalFetch = global.fetch
  let modelCalls = 0
  const rawProgram = [
    'import csv',
    'with open("sales.csv", encoding="utf-8") as source:',
    '    print(sum(float(row["amount"]) for row in csv.DictReader(source)))',
  ].join('\n')

  global.fetch = async (url) => {
    if (String(url).endsWith('/api/tags')) {
      return jsonResponse({ models: [{ name: 'gemma4:26b' }] })
    }
    if (String(url).endsWith('/api/chat') || String(url).endsWith('/api/generate')) {
      modelCalls += 1
      const content = modelCalls < 3 ? rawProgram : 'item,amount\n'
      return String(url).endsWith('/api/chat')
        ? jsonResponse({ message: { content }, eval_count: 4, prompt_eval_count: 5 })
        : jsonResponse({ response: content, eval_count: 4, prompt_eval_count: 5 })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  try {
    const result = await generateCode('請產生會讀取 sales.csv 的銷售報表，沒有資料檔時一併建立', '', {
      filePath: 'sales_report.py',
      language: 'python',
      contextFiles: [],
    })
    assert.equal(result.ok, true)
    assert.equal(modelCalls, 3)
    assert.equal(result.support_files.length, 1)
    assert.equal(result.support_files[0].path, 'sales.csv')
    assert.equal(result.support_files[0].content.trim(), 'item,amount')
  } finally {
    global.fetch = originalFetch
  }
})

test('code generation rejects missing local data files instead of pretending success', async () => {
  const originalFetch = global.fetch
  const rawProgram = [
    'import csv',
    'with open("sales.csv", encoding="utf-8") as source:',
    '    print(sum(float(row["amount"]) for row in csv.DictReader(source)))',
  ].join('\n')

  global.fetch = async (url) => {
    if (String(url).endsWith('/api/tags')) {
      return jsonResponse({ models: [{ name: 'gemma4:26b' }] })
    }
    if (String(url).endsWith('/api/chat') || String(url).endsWith('/api/generate')) {
      return String(url).endsWith('/api/chat')
        ? jsonResponse({ message: { content: rawProgram }, eval_count: 4, prompt_eval_count: 5 })
        : jsonResponse({ response: rawProgram, eval_count: 4, prompt_eval_count: 5 })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  try {
    const result = await generateCode('請產生會讀取 sales.csv 的銷售報表', '', {
      filePath: 'sales_report.py',
      language: 'python',
      contextFiles: [],
    })
    assert.equal(result.ok, false)
    assert.match(result.error, /不存在.*sales\.csv|本機資料檔/)
    assert.equal(result.new_content, '')
  } finally {
    global.fetch = originalFetch
  }
})

test('code generation retargets obvious standalone HTML instead of validating it as JavaScript', async () => {
  const originalFetch = global.fetch
  let modelCalls = 0
  const incompleteHtml = '<!DOCTYPE html>\n<html lang="zh-Hant">\n<head><title>Compass</title></head>\n<body><main>Compass</main></'
  const completeHtml = '<!DOCTYPE html>\n<html lang="zh-Hant">\n<head><meta charset="UTF-8"><title>Compass</title></head>\n<body><main>Compass</main><script>const heading = 0; document.querySelector("main").dataset.heading = heading;</script></body>\n</html>'

  global.fetch = async (url) => {
    if (String(url).endsWith('/api/tags')) {
      return jsonResponse({ models: [{ name: 'gemma4:26b' }] })
    }
    if (String(url).endsWith('/api/chat') || String(url).endsWith('/api/generate')) {
      modelCalls += 1
      const content = modelCalls === 1 ? incompleteHtml : completeHtml
      return String(url).endsWith('/api/chat')
        ? jsonResponse({ message: { content }, eval_count: 4, prompt_eval_count: 5 })
        : jsonResponse({ response: content, eval_count: 4, prompt_eval_count: 5 })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  try {
    const result = await generateCode('建立電子指南針', '', {
      filePath: 'generated.js',
      language: 'javascript',
    })
    assert.equal(result.ok, true)
    assert.equal(modelCalls, 2)
    assert.equal(result.file_path, 'generated.html')
    assert.equal(result.language, 'html')
    assert.match(result.new_content, /<\/html>\s*$/)
    assert.equal(result.validation.ok, true)
  } finally {
    global.fetch = originalFetch
  }
})

test('code generation parses bare file_output HTML blocks before JavaScript validation', async () => {
  const originalFetch = global.fetch
  const htmlBlock = [
    '<file_output>',
    'generated.js',
    '<!DOCTYPE html>',
    '<html lang="zh-Hant">',
    '<head><meta charset="UTF-8"><title>Calculator</title></head>',
    '<body><main>Calculator</main><script>const total = 1 + 1; document.querySelector("main").dataset.total = total;</script></body>',
    '</html>',
    '</file_output>',
  ].join('\n')

  global.fetch = async (url) => {
    if (String(url).endsWith('/api/tags')) {
      return jsonResponse({ models: [{ name: 'gemma4:26b' }] })
    }
    if (String(url).endsWith('/api/chat') || String(url).endsWith('/api/generate')) {
      return String(url).endsWith('/api/chat')
        ? jsonResponse({ message: { content: htmlBlock }, eval_count: 4, prompt_eval_count: 5 })
        : jsonResponse({ response: htmlBlock, eval_count: 4, prompt_eval_count: 5 })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  try {
    const result = await generateCode('建立計算機', '', {
      filePath: 'generated.js',
      language: 'javascript',
    })
    assert.equal(result.ok, true)
    assert.equal(result.file_path, 'generated.html')
    assert.equal(result.language, 'html')
    assert.match(result.new_content, /<script>const total = 1 \+ 1;/)
    assert.equal(result.validation.ok, true)
  } finally {
    global.fetch = originalFetch
  }
})
