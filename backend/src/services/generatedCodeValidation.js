const path = require('path')
const { spawnSync } = require('child_process')
const espree = require('espree')
const eslintScope = require('eslint-scope')

const JS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx'])
const JSON_EXTENSIONS = new Set(['.json'])
const HTML_EXTENSIONS = new Set(['.html', '.htm'])
const DATA_EXTENSIONS = new Set(['.csv', '.txt', '.sql', '.yml', '.yaml', '.env'])

function normalizeExtension(filePath = '', language = '') {
  const extension = path.posix.extname(String(filePath || '').replace(/\\/g, '/')).toLowerCase()
  if (extension) return extension
  const value = String(language || '').toLowerCase()
  if (value.includes('javascript') || value === 'js') return '.js'
  if (value.includes('typescript')) return '.ts'
  if (value.includes('python')) return '.py'
  if (value.includes('json')) return '.json'
  if (value.includes('html')) return '.html'
  if (value === 'css') return '.css'
  return ''
}

function genericCompletenessErrors(code = '', options = {}) {
  const text = String(code || '').replace(/\r\n/g, '\n').trim()
  const errors = []
  if (!text) return ['輸出內容為空白']
  if (text.length < 12 && options.allowShort !== true) errors.push('輸出內容過短，無法視為完整程式')
  if (/```/.test(text)) errors.push('輸出仍包含 Markdown code fence')
  if (/<\/?file_output\b/i.test(text)) errors.push('輸出仍包含 file_output 包裝標籤')
  if (/(?:^|\n)\s*(?:\.\.\.|TODO:\s*implement|your code here|省略|略)\s*$/im.test(text)) errors.push('輸出包含未完成或省略標記')
  const lastCodeLine = text.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('//') && !line.startsWith('#')).at(-1) || ''
  if (options.scanTruncation !== false && /(?:[=,:+\-*/({\[])$/.test(lastCodeLine)) errors.push(`最後一行看起來被截斷：${lastCodeLine.slice(0, 120)}`)
  if (options.scanDelimiters === false) return [...new Set(errors)]

  const pairs = { '(': ')', '[': ']', '{': '}' }
  const closing = new Set(Object.values(pairs))
  const stack = []
  let quote = ''
  let escaped = false
  let lineComment = false
  let blockComment = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    const next = text[index + 1]
    if (lineComment) {
      if (character === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false
        index += 1
      }
      continue
    }
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (quote.length === 3 && text.startsWith(quote, index)) {
        quote = ''
        index += 2
      } else if (quote.length === 1 && character === quote) {
        quote = ''
      }
      continue
    }
    const isPython = options.isPython || options.extension === '.py' || String(options.language || '').toLowerCase().includes('python')
    if (isPython) {
      if (character === '#') {
        lineComment = true
        continue
      }
    } else {
      if (options.extension !== '.css' && character === '/' && next === '/') {
        lineComment = true
        index += 1
        continue
      }
      if (character === '/' && next === '*') {
        blockComment = true
        index += 1
        continue
      }
      if (['.sh', '.bash', '.rb', '.ps1'].includes(options.extension) && character === '#') {
        lineComment = true
        continue
      }
    }
    if (isPython && (text.startsWith('"""', index) || text.startsWith("'''", index))) {
      quote = text.slice(index, index + 3)
      index += 2
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
      continue
    }
    if (pairs[character]) stack.push(pairs[character])
    else if (closing.has(character) && stack.pop() !== character) errors.push(`括號配對錯誤：遇到 ${character}`)
  }
  if (quote) errors.push(`字串引號未關閉：${quote}`)
  if (blockComment) errors.push('區塊註解未關閉')
  if (stack.length) errors.push(`仍有 ${stack.length} 個括號未關閉`)
  return [...new Set(errors)]
}

function javascriptSyntaxErrors(code = '', filePath = '') {
  try {
    const rawCode = String(code || '')
    const ast = espree.parse(rawCode, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      range: true,
      loc: true,
      ecmaFeatures: { jsx: String(filePath || '').toLowerCase().endsWith('.jsx') || /<\w+[\s>]/.test(rawCode) },
    })
    const errors = []
    let undeclared = null
    try {
      const scopeManager = eslintScope.analyze(ast, { ecmaVersion: 'latest', sourceType: 'module' })
      undeclared = new Set((scopeManager.globalScope?.through || []).map(r => r.identifier?.name).filter(Boolean))
    } catch {
      undeclared = null
    }

    function walk(node) {
      if (!node || typeof node !== 'object') return
      if (node.type === 'BinaryExpression' && node.operator === '/' && node.left?.type === 'Identifier' && node.right?.type === 'Identifier') {
        if (Array.isArray(node.left.range) && Array.isArray(node.right.range)) {
          const between = rawCode.slice(node.left.range[1], node.right.range[0])
          if (between === '/' && undeclared && (undeclared.has(node.left.name) || undeclared.has(node.right.name))) {
            const line = node.loc?.start?.line ? `（第 ${node.loc.start.line} 行）` : ''
            errors.push(`JavaScript 語法異常${line}：'${node.left.name}/${node.right.name}' 包含未定義識別符或名稱筆誤。`)
          }
        }
      }
      for (const key of Object.keys(node)) {
        if (key !== 'parent' && key !== 'leadingComments' && key !== 'trailingComments') {
          const child = node[key]
          if (Array.isArray(child)) {
            for (const item of child) walk(item)
          } else if (child && typeof child === 'object') {
            walk(child)
          }
        }
      }
    }
    walk(ast)
    return errors
  } catch (error) {
    return [`JavaScript/JSX 語法錯誤${error.lineNumber ? `（第 ${error.lineNumber} 行）` : ''}：${error.description || error.message}`]
  }
}

function jsonSyntaxErrors(code = '') {
  try {
    JSON.parse(String(code || ''))
    return []
  } catch (error) {
    return [`JSON 格式錯誤：${error.message}`]
  }
}

function htmlEmbeddedSyntaxErrors(code = '') {
  const text = String(code || '')
  const errors = []
  // Consume complete tags (including quoted attributes) and comments. Raw-text
  // elements must be skipped as a unit so example markup is never parsed as JS.
  const tags = /<!--[\s\S]*?(?:-->|$)|<([A-Za-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/g
  let match
  let scriptIndex = 0
  let styleIndex = 0
  while ((match = tags.exec(text))) {
    const tag = String(match[1] || '').toLowerCase()
    if (!['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext'].includes(tag)) continue
    if (tag === 'plaintext') break
    const endTag = new RegExp(`</${tag}\\s*>`, 'gi')
    endTag.lastIndex = tags.lastIndex
    const end = endTag.exec(text)
    if (!end) {
      if (tag === 'script' || tag === 'style') errors.push(`HTML ${tag} 標籤未關閉`)
      break
    }
    const content = text.slice(tags.lastIndex, end.index)
    tags.lastIndex = endTag.lastIndex
    if (tag === 'script') {
      scriptIndex += 1
      const attributes = new Map()
      const attributePattern = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g
      for (const attribute of match[2].matchAll(attributePattern)) {
        attributes.set(attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4] ?? '')
      }
      const type = String(attributes.get('type') || '').trim().toLowerCase()
      if (attributes.has('src') || (type && !/^(?:module|(?:text|application)\/(?:javascript|ecmascript))$/.test(type))) continue
      errors.push(...javascriptSyntaxErrors(content, 'inline.js').map(error => `inline script ${scriptIndex}: ${error}`))
    } else if (tag === 'style') {
      styleIndex += 1
      if (!content.trim()) continue
      errors.push(...genericCompletenessErrors(content, { extension: '.css', allowShort: true, scanTruncation: false })
        .map(error => `inline style ${styleIndex}: ${error}`))
    }
  }
  return errors
}

function looksLikePythonDesktopGui(code = '') {
  const text = String(code || '')
  return /(^|\n)\s*(?:import\s+tkinter\b|from\s+tkinter\s+import\b|import\s+customtkinter\b|from\s+customtkinter\s+import\b|import\s+turtle\b|from\s+turtle\s+import\b)/i.test(text) ||
    /\b(?:tk\.)?Tk\s*\(|\.mainloop\s*\(/i.test(text)
}

function lineHasWindowsPlatformGuard(line = '') {
  return /(?:sys\.platform|os\.name|platform\.system\s*\(\))/.test(line) &&
    /(?:win32|windows|nt)/i.test(line)
}

function pythonDesktopGuiPortabilityErrors(code = '', filePath = '', language = '') {
  const extension = normalizeExtension(filePath, language)
  const isHtml = HTML_EXTENSIONS.has(extension)
  if (extension !== '.py' || !looksLikePythonDesktopGui(code)) return []

  const lines = String(code || '').replace(/\r\n/g, '\n').split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!/^\s*if\b.*(?:DISPLAY|display).*:\s*(?:#.*)?$/i.test(line)) continue

    const nearby = lines.slice(Math.max(0, index - 2), index + 8).join('\n')
    const exitsInsteadOfOpeningGui = /\b(?:return|sys\.exit\s*\(|exit\s*\(|quit\s*\(|raise\s+SystemExit)\b/i.test(nearby) ||
      /Skipping GUI execution|Cannot run GUI|No DISPLAY/i.test(nearby)
    if (!exitsInsteadOfOpeningGui) continue

    if (lineHasWindowsPlatformGuard(nearby)) continue

    return ['Python tkinter/桌面 GUI 程式的 DISPLAY 判斷需要修正。DISPLAY 是 Linux/X11 常用的螢幕環境變數，Windows CMD/PowerShell 通常沒有 DISPLAY，但 tkinter 仍然可以正常開視窗；如果程式只因為 DISPLAY 不存在就 return，會導致 Windows 本機執行也直接略過 GUI。這不是要求寫假資料、固定時間或固定成功訊息；請保留真正的 tkinter 視窗啟動邏輯，只把「無螢幕環境才跳過」限制在非 Windows 平台，或移除這個跳過邏輯。']
  }
  return []
}

function pythonSyntaxErrors(code = '', filePath = '') {
  const rawCode = String(code || '')
  if (!rawCode.trim()) return []
  try {
    const res = spawnSync('python', ['-c', "import ast, sys; ast.parse(sys.stdin.buffer.read().decode('utf-8', errors='replace'))"], {
      input: Buffer.from(rawCode, 'utf-8'),
      encoding: 'utf-8',
      timeout: 3000,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    })
    if (res.error) {
      return []
    }
    if (res.status !== 0) {
      const stderr = String(res.stderr || '').trim()
      const lastLines = stderr.split('\n').filter(Boolean).slice(-2).join(' ')
      return [`Python 語法解析失敗：${lastLines || '程式碼無法通過 AST 語法解析'}`]
    }
    return []
  } catch {
    return []
  }
}

function validateGeneratedArtifact({ code = '', filePath = '', language = '' } = {}) {
  const extension = normalizeExtension(filePath, language)
  const isPython = extension === '.py' || String(language || '').toLowerCase().includes('python')
  const isHtml = HTML_EXTENSIONS.has(extension) || String(language || '').toLowerCase().includes('html')
  const errors = genericCompletenessErrors(code, {
    allowShort: DATA_EXTENSIONS.has(extension),
    scanDelimiters: !JS_EXTENSIONS.has(extension) && !JSON_EXTENSIONS.has(extension) && !isHtml,
    scanTruncation: extension !== '.css',
    isPython,
    extension,
    language,
  })
  if (isPython) errors.push(...pythonSyntaxErrors(code, filePath))
  if (JS_EXTENSIONS.has(extension)) errors.push(...javascriptSyntaxErrors(code, filePath))
  if (JSON_EXTENSIONS.has(extension)) errors.push(...jsonSyntaxErrors(code))
  if (isHtml) errors.push(...htmlEmbeddedSyntaxErrors(code))
  errors.push(...pythonDesktopGuiPortabilityErrors(code, filePath, language))
  return { ok: errors.length === 0, errors: [...new Set(errors)], file_path: filePath, language, extension }
}

function validateGeneratedFiles(files = [], options = {}) {
  const results = (files || []).map(file => validateGeneratedArtifact({
    code: file.content,
    filePath: file.path,
    language: options.language,
  }))
  return {
    ok: results.length > 0 && results.every(result => result.ok),
    results,
    errors: results.flatMap(result => result.errors.map(error => `${result.file_path || 'output'}: ${error}`)),
  }
}

module.exports = { validateGeneratedArtifact, validateGeneratedFiles, pythonDesktopGuiPortabilityErrors }
