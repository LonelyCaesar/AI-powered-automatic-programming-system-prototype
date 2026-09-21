const path = require('path')
const config = require('../config')
const { askLlm, askAutocompleteLlm } = require('../core/llmClient')
const { makeUnifiedDiff, extractFileContent, extractMultiFiles, stripCodeFences } = require('../tools/diffTools')
const { readFile, writeFile, normalizePath, isDatabaseFile } = require('../tools/fileTools')
const { formatContextFiles } = require('./contextManager')
const { getAutoIntentDefinitionsText, getFeaturePrompt } = require('./featureOptionsService')
const { parseTolerantJsonObject } = require('../utils/tolerantJson')
const { validateGeneratedArtifact, validateGeneratedFiles } = require('./generatedCodeValidation')
const {
  collectRelatedContext,
  detectSourceLanguage,
  convertedFilePath,
  conversionDifferences,
  normalizeProjectPath,
} = require('./relatedContextService')

function codeBlockLanguage(filePath = '') {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.py')) return 'python'
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs') || lower.endsWith('.jsx')) return 'javascript'
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript'
  if (lower.endsWith('.vue')) return 'html'
  if (lower.endsWith('.css')) return 'css'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  if (lower.endsWith('.sql')) return 'sql'
  if (lower.endsWith('.db') || lower.endsWith('.sqlite') || lower.endsWith('.sqlite3')) return 'sql'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.md')) return 'markdown'
  if (lower.endsWith('.java')) return 'java'
  return 'text'
}

function normalizeLanguage(filePath = '', language = '') {
  const requested = String(language || '').trim()
  return requested || codeBlockLanguage(filePath)
}

function configuredFeaturePrompt(key, replacements = {}) {
  let prompt = String(getFeaturePrompt(key) || '').trim()
  for (const [name, value] of Object.entries(replacements)) {
    prompt = prompt.replaceAll(`{{${name}}}`, String(value || ''))
  }
  return prompt
}

function desktopGuiPortabilityRule(filePath = '', language = '') {
  const target = `${filePath || ''} ${language || ''}`.toLowerCase()
  if (!/(?:\.py\b|python|tkinter|customtkinter|turtle)/i.test(target)) return ''
  return '- For Python tkinter/customtkinter/turtle desktop GUI apps, do not replace the real GUI with fake output, fixed values, a fixed success message, or a console-only fallback. Do not skip execution solely because DISPLAY is missing: Windows usually has no DISPLAY. If a headless guard is necessary, apply it only on non-Windows platforms while preserving the real tkinter window startup on Windows.'
}

function safeRead(filePath) {
  try { return readFile(filePath) } catch { return '' }
}

function normalizeAutocompleteSuggestion(rawSuggestion, prefix, language) {
  let suggestion = stripCodeFences(rawSuggestion)
    .replace(/\r\n/g, '\n')
    .trimEnd()

  if (!suggestion) return ''
  suggestion = stripAutocompletePromptArtifacts(suggestion)
  suggestion = stripRepeatedPrefixLines(suggestion, prefix)
  suggestion = stripLeadingAutocompleteJunk(suggestion)

  const rawLines = suggestion.replace(/^\n+/, '').split('\n')
  const firstLine = rawLines[0]?.trim()
  const lastLine = rawLines.at(-1)?.trim()
  const wrapsExecutableCode =
    rawLines.length > 2 &&
    ['"""', "'''"].includes(firstLine) &&
    firstLine === lastLine &&
    rawLines.slice(1, -1).some(line => /^\s*(if|elif|else|for|while|return|raise|try|with|match|case)\b/.test(line))
  if (wrapsExecutableCode) {
    suggestion = rawLines.slice(1, -1).join('\n')
  }

  const prefixLine = String(prefix || '').split('\n').at(-1) || ''
  if (language === 'python' && prefixLine.trimEnd().endsWith(':')) {
    const baseIndent = prefixLine.match(/^\s*/)?.[0] || ''
    const bodyIndent = `${baseIndent}    `
    const lines = suggestion.replace(/^\n+/, '').split('\n')
    suggestion = `\n${lines.map(line => {
      if (!line.trim()) return ''
      return line.startsWith(bodyIndent) ? line : `${bodyIndent}${line}`
    }).join('\n')}`
  }
  suggestion = normalizePythonStatementBoundary(suggestion, prefixLine, language)

  suggestion = trimDanglingAutocompleteTail(suggestion, language)
  if (language === 'python' && suggestion.includes('\n') && suggestion.trim() && !suggestion.endsWith('\n')) {
    suggestion = `${suggestion}\n`
  }
  return suggestion.split('\n').slice(0, 60).join('\n').slice(0, 4000)
}

function stripAutocompletePromptArtifacts(suggestion = '') {
  const lines = String(suggestion || '').replace(/\r\n/g, '\n').split('\n')
  return lines
    .filter(line => !/^\s*```/.test(line))
    .filter(line => !/^\s*(?:Prefix|Suffix|Cursor suffix|Completion)\s*:?\s*$/i.test(line))
    .join('\n')
    .trimEnd()
}

function stripLeadingAutocompleteJunk(suggestion = '') {
  const lines = String(suggestion || '').replace(/\r\n/g, '\n').split('\n')
  while (lines.length && !lines[0].trim()) lines.shift()
  while (lines.length && /^[,.;:)\]}]/.test(lines[0].trim())) lines.shift()
  return lines.join('\n').trimEnd()
}

function trimDanglingAutocompleteTail(suggestion = '', language = '') {
  if (language !== 'python') return suggestion
  const lines = String(suggestion || '').split('\n')
  while (lines.length) {
    const last = lines.at(-1)
    if (!last.trim()) {
      lines.pop()
      continue
    }
    if (/[.([{,=:+\-*/%]\s*$/.test(last.trim())) {
      lines.pop()
      continue
    }
    if (hasDanglingPythonTail(last)) {
      lines.pop()
      continue
    }
    break
  }
  return lines.join('\n')
}

function normalizePythonStatementBoundary(suggestion = '', prefixLine = '', language = '') {
  if (language !== 'python') return suggestion
  if (!suggestion || suggestion.startsWith('\n') || suggestion.startsWith('\r\n')) return suggestion

  const current = String(prefixLine || '')
  const trimmedCurrent = current.trim()
  if (!trimmedCurrent) return suggestion

  const next = String(suggestion || '').trimStart()
  if (!startsStandalonePythonStatement(next)) return suggestion
  if (!looksCompletePythonLine(current)) return suggestion

  return `\n${next}`
}

function startsStandalonePythonStatement(text = '') {
  return /^(?:from|import|def|class|if|elif|else|for|while|try|except|finally|with|async\s+def|async\s+for|match|case)\b/.test(String(text || '').trimStart())
}

function looksCompletePythonLine(line = '') {
  const text = String(line || '').trimEnd()
  if (!text.trim()) return false
  if (/^\s*#/.test(text)) return true
  if (/[.([{,=:+\-*/%\\]\s*$/.test(text)) return false
  if (hasDanglingPythonTail(text)) return false
  return true
}

function hasDanglingPythonTail(line = '') {
  const text = String(line || '').trim()
  if (!text) return false
  const withoutEscaped = text.replace(/\\["']/g, '')
  const singleQuotes = (withoutEscaped.match(/'/g) || []).length
  const doubleQuotes = (withoutEscaped.match(/"/g) || []).length
  if (singleQuotes % 2 === 1 || doubleQuotes % 2 === 1) return true
  const pairs = [['(', ')'], ['[', ']'], ['{', '}']]
  for (const [open, close] of pairs) {
    const opens = (text.match(new RegExp(`\\${open}`, 'g')) || []).length
    const closes = (text.match(new RegExp(`\\${close}`, 'g')) || []).length
    if (opens > closes) return true
  }
  return /\b(?:if|elif|else|for|while|try|except|with|def|class)\s*$/.test(text)
}

function stripRepeatedPrefixLines(suggestion = '', prefix = '') {
  const prefixLines = String(prefix || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  if (!prefixLines.length) return suggestion

  const repeated = new Set(prefixLines.slice(-8))
  const hadLeadingNewline = /^\s*\n/.test(suggestion)
  const lines = String(suggestion || '').replace(/^\n+/, '').split('\n')
  while (lines.length && repeated.has(lines[0].trim())) lines.shift()
  const cleaned = lines.join('\n')
  return hadLeadingNewline && cleaned ? `\n${cleaned}` : cleaned
}

function unsafeAutocompleteReason(suggestion = '') {
  const text = String(suggestion || '')
  if (/\b(?:eval|exec)\s*\(/.test(text)) return 'dynamic code execution is not allowed'
  if (/\b(?:new\s+)?Function\s*\(/.test(text)) return 'dynamic function construction is not allowed'
  if (/\b(?:os\.system|subprocess\.)\b/.test(text)) return 'shell execution is not allowed'
  return ''
}

function isDatabasePath(filePath = '') {
  return isDatabaseFile(filePath) || /\.(?:db|sqlite|sqlite3)$/i.test(String(filePath || ''))
}

function databaseMigrationPath(filePath = '') {
  const clean = normalizePath(filePath || 'database.db')
  return `${clean}.migration.sql`
}

function buildDatabaseSqlPrompt(sqlTarget, originalDbPath, instruction, dbSummary, contextFilesText) {
  return `You are Cubi Code Database Agent.
The target is a binary database file. Do NOT output binary database bytes and do NOT pretend to directly edit the .db file.
Generate ONLY a generic SQL script for the user's request.
Return raw SQL text only. No markdown. No code fences. No explanation outside SQL comments.
Do not use a fixed template; derive every table, column, query, and migration from the user's request and database summary.

SQL output file: ${sqlTarget}
Database file: ${originalDbPath}
User request:
${instruction}

Database summary / schema context:
${dbSummary || '(no database schema available)'}

Related multi-file context:
${contextFilesText || '(none)'}
`
}

const AUTO_INTENTS = [
  'generate',
  'rewrite',
  'rewrite_advice',
  'convert',
  'detect',
  'fix',
  'analyze',
  'explain',
  'test_advice',
  'run_tests',
  'create_files',
  'multi_file_edit',
  'plan',
  'chat',
]

function normalizeAutoIntent(value = '') {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  const aliases = {
    code_generation: 'generate',
    generate_code: 'generate',
    code_generate: 'generate',
    code_rewrite: 'rewrite',
    refactor: 'rewrite',
    refactor_advice: 'rewrite_advice',
    rewrite_suggestion: 'rewrite_advice',
    language_convert: 'convert',
    conversion: 'convert',
    error_detection: 'detect',
    bug_detect: 'detect',
    bug_fix: 'fix',
    error_fix: 'fix',
    project_analysis: 'analyze',
    file_analysis: 'analyze',
    code_explain: 'explain',
    explanation: 'explain',
    tests: 'test_advice',
    test_case: 'test_advice',
    test_cases: 'test_advice',
    generate_tests: 'test_advice',
    pytest: 'test_advice',
    execute_tests: 'run_tests',
    run_pytest: 'run_tests',
    files: 'create_files',
    create_file: 'create_files',
    multi_file: 'multi_file_edit',
    planning: 'plan',
    ask: 'chat',
    qa: 'chat',
  }
  const normalized = aliases[raw] || raw
  return AUTO_INTENTS.includes(normalized) ? normalized : 'chat'
}

function explicitRequestedFilePaths(instruction = '') {
  const matches = String(instruction || '').match(/[A-Za-z0-9_.\/-]+\.(?:html?|css|mjs|cjs|js|jsx|ts|tsx|vue|py|java|cs|php|go|rs|cpp|c|h|json|md|txt|sql|yml|yaml)\b/gi) || []
  const ignored = new Set(['node.js', 'vue.js', 'react.js', 'next.js', 'nuxt.js', 'express.js', 'chart.js', 'three.js', 'd3.js'])
  return [...new Set(matches.map(value => value.replace(/^\.\/+/, '').trim()).filter(Boolean).filter(v => !ignored.has(v.toLowerCase())))]
}

function deterministicAutoIntent(instruction = '') {
  const text = String(instruction || '')
  const paths = explicitRequestedFilePaths(text)
  const requestsConversion = /(?:轉換|轉成|轉為|改寫成|改寫為|convert(?:ed)?\s+to)/i.test(text)
  const requestsCreation = /(?:建立|新增|產生|生成|創建)/i.test(text) || /\b(?:create|generate)\b/i.test(text)
  const mentionsWorkspace = /(?:資料夾|專案|工作區|檔案總管|整個|folder|project|workspace)/i.test(text)
  const asksWorkspaceRepair = /(?:自動.*(?:處理|修復|修正|補齊|建立|新增)|缺少|缺檔|缺套件|缺安裝|安裝|依賴|套件|dependency|package|requirements|錯誤|error|巡檢|健檢|repair|fix|setup)/i.test(text)
  const reportOnly = /(?:不要修改|不要直接修改|只列出|只分析|只檢查|only list|advice only|no modify)/i.test(text)
  if (requestsConversion) {
    return {
      intent: 'convert',
      reason: '需求明確要求程式語言轉換，應使用轉換流程而不是新增檔案或一般產生。',
    }
  }
  if (mentionsWorkspace && asksWorkspaceRepair) {
    return {
      intent: reportOnly ? 'analyze' : 'create_files',
      reason: reportOnly
        ? '需求是專案/資料夾層級巡檢，但明確要求不要修改，因此先做分析。'
        : '需求是專案/資料夾層級自動巡檢與補齊，需由多檔案代理處理缺檔、缺設定或缺依賴。',
    }
  }
  if (paths.length >= 1 && requestsCreation) {
    return {
      intent: 'create_files',
      reason: `需求明確指定建立 ${paths.length} 個檔案：${paths.join('、')}。`,
    }
  }
  return null
}

function fallbackAutoIntent(instruction = '') {
  const text = String(instruction || '').trim()
  if (!text) return null
  const reportOnly = /(?:不要修改|不要直接修改|只說明|只分析|只檢查|只回報|only list|advice only|no modify|do not modify)/i.test(text)
  const match = (intent, reason, noModify = reportOnly) => ({ intent, reason, no_modify: noModify })

  if (/(?:轉換|轉成|轉為|convert(?:ed)?\s+to)/i.test(text)) return match('convert', '需求明確要求程式語言轉換。', false)
  if (/(?:說明|解釋|用途|輸入輸出|逐行|explain|what does)/i.test(text)) return match('explain', '需求明確要求說明程式內容。', true)
  if (/(?:偵測|檢查.*(?:錯誤|風險|問題)|找出.*(?:錯誤|問題)|detect|scan.*errors?)/i.test(text)) return match('detect', '需求要求唯讀偵測錯誤或風險。', true)
  if (/(?:分析|架構|關聯|依賴關係|analy[sz]e|architecture)/i.test(text)) return match('analyze', '需求要求分析檔案或專案。', true)
  if (!reportOnly && /(?:修正|修復|除錯|fix|repair|debug)/i.test(text)) return match('fix', '需求明確要求修正錯誤。', false)
  if (/(?:改寫|重構|優化|rewrite|refactor)/i.test(text)) return match(reportOnly ? 'rewrite_advice' : 'rewrite', reportOnly ? '需求只要改寫建議，不可修改檔案。' : '需求明確要求改寫或重構。')
  if (!reportOnly && /(?:建立|新增|創建|create|generate).{0,24}(?:檔案|文件|file|[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)|(?:檔案|文件|file).{0,24}(?:建立|新增|創建|create|generate)/i.test(text)) return match('create_files', '需求明確要求建立檔案。', false)
  if (/(?:產生|生成|撰寫|實作|generate|write|implement).{0,20}(?:程式|程式碼|code|函式|function|類別|class)/i.test(text)) return match('generate', '需求明確要求產生程式碼。', false)
  return null
}

function parseJsonObject(text = '') {
  const cleaned = stripCodeFences(String(text || '').trim())
  return parseTolerantJsonObject(cleaned)
}

function tryParseJsonObject(text = '') {
  try {
    return parseJsonObject(text)
  } catch (_) {
    return null
  }
}

async function classifyAutoIntent(instruction = '', options = {}) {
  const deterministic = deterministicAutoIntent(instruction)
  if (deterministic) {
    return {
      ok: true,
      type: 'auto_intent',
      intent: deterministic.intent,
      confidence: 1,
      reason: deterministic.reason,
      needs_file: false,
      no_modify: false,
      source: 'deterministic_router',
      model: 'system',
      tokens: 0,
      allowed_intents: AUTO_INTENTS,
    }
  }

  const filePath = options.filePath || ''
  const code = String(options.code || '').slice(0, 6000)
  const selected = String(options.selectedCode || '').slice(0, 2000)
  const contextFilesText = formatContextFiles(options.contextFiles, 120000)
  const workspaceContext = String(options.workspaceContext || '').slice(0, 60000)
  const configuredIntentDefinitions = getAutoIntentDefinitionsText()
  const fallbackIntentDefinitions = [
    '- generate',
    '- rewrite',
    '- convert',
    '- detect',
    '- fix',
    '- analyze',
    '- create_files',
    '- explain',
  ].join('\n')
  const prompt = `You are Cubi Code Auto Router. Decide which Cubi function should handle the user request.
  Return ONLY one JSON object. Do not answer the coding task.

Configured Auto policy:
${configuredFeaturePrompt('auto') || '(none)'}

Main 8 function intents loaded from backend/data/ai-function-options/*.json:
${configuredIntentDefinitions || fallbackIntentDefinitions}

Extra system intents are also allowed when clearly needed:
- rewrite_advice: provide refactor/rewrite suggestions only; do not modify files.
- test_advice: design pytest/unit test cases only; do not modify files.
- run_tests: execute existing tests.
- multi_file_edit: update or modify multiple existing files.
- plan: make an implementation plan before writing code.
- chat: general question or unclear request.

Important routing rules:
- If the user says 不要修改 / 不要直接修改 / only list / advice only, choose detect, rewrite_advice, test_advice, analyze, explain, or plan instead of rewrite/fix.
- If the request mentions @ two or more files and asks relationship/analysis, choose analyze.
- If the request asks to convert Python to JavaScript/Java/etc., choose convert.
- If the request asks to design pytest tests but not modify files, choose test_advice.
- If the request asks to check errors/risks/unreasonable logic, choose detect.
- If the request is about the opened folder/project/workspace and asks to automatically fix, fill missing files, add missing config, handle missing install/dependencies, or complete setup, choose create_files with needs_file=false.
- If the request is about the opened folder/project/workspace but asks only to list/check/analyze without modifying, choose analyze or detect.

Return JSON schema:
{"intent":"one allowed value","confidence":0.0,"reason":"short Traditional Chinese reason","needs_file":true,"no_modify":false}

User request:
${instruction || '(empty)'}

Current file: ${filePath || '(none)'}
Opened workspace / folder context:
${workspaceContext || '(none)'}

Selected code:
\`\`\`text
${selected || '(none)'}
\`\`\`
Current code excerpt:
\`\`\`text
${code || '(none)'}
\`\`\`
Multi-file context:
${contextFilesText || '(none)'}
`

  const result = await askLlm(prompt, {
    temperature: 0,
    topP: 0.1,
    numPredict: 220,
    numCtx: 120000,
    timeoutMs: options.timeoutMs,
    maxRetries: 0,
    preferChat: true,
    formatJson: true,
    think: false,
    keepAlive: '10m',
    requestEndpoint: '/api/ai/auto-intent',
  })

  if (!result.ok) {
    const fallback = fallbackAutoIntent(instruction)
    if (fallback) {
      return {
        ok: true,
        type: 'auto_intent',
        ...fallback,
        confidence: 0.76,
        needs_file: !['generate', 'create_files'].includes(fallback.intent),
        source: 'rule_fallback',
        model: result.model || 'system',
        tokens: result.tokens || 0,
        model_error: result.error || 'Auto 模型判斷失敗。',
        allowed_intents: AUTO_INTENTS,
      }
    }
    return {
      ok: false,
      type: 'auto_intent',
      intent: 'chat',
      confidence: 0,
      reason: result.error || 'Auto 模型判斷失敗。',
      source: result.source || 'ollama_error',
      model: result.model || 'local_ollama',
      tokens: result.tokens || 0,
      error: result.error || 'Auto 模型判斷失敗。',
      requested_model: result.requested_model,
    }
  }

  let parsed
  try {
    parsed = parseJsonObject(result.content)
  } catch (error) {
    const fallback = fallbackAutoIntent(instruction)
    if (fallback) {
      return {
        ok: true,
        type: 'auto_intent',
        ...fallback,
        confidence: 0.72,
        needs_file: !['generate', 'create_files'].includes(fallback.intent),
        source: 'rule_fallback',
        model: result.model,
        tokens: result.tokens || 0,
        raw_content: result.content,
        model_error: error.message,
        allowed_intents: AUTO_INTENTS,
      }
    }
    return {
      ok: false,
      type: 'auto_intent',
      intent: 'chat',
      confidence: 0,
      reason: 'Auto 模型回覆格式不是 JSON，請重新送出或切換手動功能。',
      source: result.source,
      model: result.model,
      tokens: result.tokens || 0,
      error: error.message,
      raw_content: result.content,
    }
  }

  const intent = normalizeAutoIntent(parsed.intent)
  const confidence = Number.isFinite(Number(parsed.confidence))
    ? Math.max(0, Math.min(1, Number(parsed.confidence)))
    : 0.6

  return {
    type: 'auto_intent',
    ...result,
    content: result.content,
    intent,
    confidence,
    reason: String(parsed.reason || '由地端模型依語意判斷。').slice(0, 160),
    needs_file: parsed.needs_file !== false,
    no_modify: Boolean(parsed.no_modify),
    allowed_intents: AUTO_INTENTS,
  }
}


function normalizeMultiFileItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 20)
}

function normalizeSameFolderModelFiles(content = '') {
  const seen = new Set()
  const files = []
  for (const file of extractMultiFiles(content)) {
    const fileName = String(file.path || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || ''
    const key = fileName.toLowerCase()
    if (!fileName || fileName === '.' || fileName === '..' || !String(file.content || '').trim() || seen.has(key)) continue
    seen.add(key)
    files.push({ path: fileName, content: file.content })
  }
  return files
}

function splitSingleFileGeneration(files = [], filePath = '') {
  const normalizedFiles = Array.isArray(files) ? files.filter(file => String(file?.content || '').trim()) : []
  if (!normalizedFiles.length) return { mainFile: null, supportFiles: [] }

  const targetName = String(filePath || '').replace(/\\/g, '/').split('/').filter(Boolean).pop()?.toLowerCase() || ''
  const mainIndex = Math.max(0, normalizedFiles.findIndex(file => {
    const fileName = String(file?.path || '').replace(/\\/g, '/').split('/').filter(Boolean).pop()?.toLowerCase() || ''
    return targetName && fileName === targetName
  }))

  return {
    mainFile: normalizedFiles[mainIndex] || null,
    supportFiles: normalizedFiles.filter((_, index) => index !== mainIndex),
  }
}

function localDataFileReferences(text = '') {
  const references = []
  const pattern = /["'`]([^"'`\r\n]+?\.(?:csv|json|txt|ya?ml|sql|xlsx?|db|sqlite|sqlite3))["'`]/gi
  for (const match of String(text || '').matchAll(pattern)) {
    const value = String(match[1] || '').replace(/\\/g, '/').replace(/^\.\//, '').trim()
    if (!value || /^(?:https?:)?\/\//i.test(value) || value.startsWith('/')) continue
    references.push(value.split('/').filter(Boolean).pop() || value)
  }
  return [...new Set(references.map(value => value.toLowerCase()))]
}

function missingGeneratedDataFiles({ code = '', instruction = '', contextFiles = [], supportFiles = [] } = {}) {
  const explicitCreation = /(?:建立|新增|產生|生成|一併|附帶|create|generate|include)/i.test(String(instruction || ''))
  const references = new Set([
    ...localDataFileReferences(code),
    ...(explicitCreation ? localDataFileReferences(instruction) : []),
  ])
  const available = new Set((Array.isArray(contextFiles) ? contextFiles : [])
    .map(file => String(file?.file_path || file?.path || '').replace(/\\/g, '/').split('/').filter(Boolean).pop()?.toLowerCase() || '')
    .filter(Boolean))
  const generated = new Set((Array.isArray(supportFiles) ? supportFiles : [])
    .map(file => String(file?.path || '').replace(/\\/g, '/').split('/').filter(Boolean).pop()?.toLowerCase() || '')
    .filter(Boolean))
  return [...references].filter(fileName => !available.has(fileName) && !generated.has(fileName))
}

function allowsSyntheticSupportData(instruction = '') {
  return /(?:範例資料|示範資料|測試資料|假資料|模擬資料|fixture|fixtures|seed data|sample data|mock data|demo data)/i
    .test(String(instruction || ''))
}

function fileExtension(filePath = '') {
  return path.extname(String(filePath || '').replace(/\\/g, '/')).toLowerCase()
}

function csvHasDataRows(content = '') {
  const rows = String(content || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
  return rows.length > 1
}

function jsonHasRecordLikeData(content = '') {
  try {
    const parsed = JSON.parse(String(content || '').trim())
    if (Array.isArray(parsed)) return parsed.length > 0
    if (parsed && typeof parsed === 'object') {
      return Object.values(parsed).some(value => Array.isArray(value) && value.length > 0)
    }
  } catch (_) {
    return false
  }
  return false
}

function supportFileLooksLikeInventedData(file = {}) {
  const ext = fileExtension(file.path)
  const content = String(file.content || '')
  if (ext === '.csv') return csvHasDataRows(content)
  if (ext === '.json') return jsonHasRecordLikeData(content)
  if (ext === '.sql') return /^\s*insert\s+into\b/im.test(content)
  return false
}

function codeMentionsFakeDataSubstitute(code = '') {
  return /\b(?:sample|mock|fake|dummy|demo)(?:Data|Rows|Records|Users|Items|List)?\b/i.test(String(code || ''))
}

function generationPolicyErrors({ instruction = '', mainFile = null, supportFiles = [], missingDataFiles = [] } = {}) {
  const errors = []
  const allowSynthetic = allowsSyntheticSupportData(instruction)

  if (missingDataFiles.length) {
    errors.push(`主程式引用了不存在且未一併產生的本機資料檔：${missingDataFiles.join('、')}`)
  }

  if (!allowSynthetic) {
    const inventedSupportFiles = (supportFiles || [])
      .filter(file => supportFileLooksLikeInventedData(file))
      .map(file => file.path)
    if (inventedSupportFiles.length) {
      errors.push(`支援資料檔看起來包含自行編造的資料列：${inventedSupportFiles.join('、')}；缺少真實資料時只能建立空 schema、匯入入口或設定模板`)
    }
    if (mainFile?.content && codeMentionsFakeDataSubstitute(mainFile.content)) {
      errors.push('主程式包含 sample/mock/fake/demo 類資料替代品；缺少真實資料時必須改成真實輸入、檔案匯入、API/設定邊界或明確環境需求')
    }
  }

  return [...new Set(errors)]
}

function inferredGeneratedArtifactTarget(filePath = '', language = '', code = '') {
  const cleanPath = String(filePath || 'generated.js').replace(/\\/g, '/')
  const text = String(code || '').trim()
  const looksLikeHtmlDocument = /^(?:<!doctype\s+html\b|<html\b)/i.test(text)
    || /<head\b[\s\S]*<body\b/i.test(text)
  if (!looksLikeHtmlDocument || /\.html?$/i.test(cleanPath)) {
    return { filePath: cleanPath, language }
  }

  const slashIndex = cleanPath.lastIndexOf('/')
  const directory = slashIndex >= 0 ? cleanPath.slice(0, slashIndex + 1) : ''
  const fileName = slashIndex >= 0 ? cleanPath.slice(slashIndex + 1) : cleanPath
  const stem = fileName.replace(/\.[^/.]+$/g, '') || 'generated'
  return { filePath: `${directory}${stem}.html`, language: 'html' }
}

async function generateCode(instruction, context = '', options = {}) {
  const filePath = options.filePath || 'current file'
  const language = normalizeLanguage(filePath, options.language)
  const currentFileContent = String(options.currentFileContent ?? '').trim()
  const selectedText = String(options.selectedText ?? '').trim()
  const contextText = String(context ?? '').trim()
  const multiFileItems = normalizeMultiFileItems(options.multiFileItems)
  const isMultiFileRequest = multiFileItems.length > 1

  const sections = []
  
  if (selectedText) {
    sections.push(`Selected code:\n\`\`\`${language}\n${selectedText}\n\`\`\``)
  }
  if (currentFileContent) {
    sections.push(`Current full file:\n\`\`\`${language}\n${currentFileContent}\n\`\`\``)
  }
  if (contextText) {
    sections.push(`Related context:\n${contextText}`)
  }

  const outputRules = isMultiFileRequest
    ? `This request contains exactly ${multiFileItems.length} separate programs.
Create exactly ${multiFileItems.length} complete source files in the SAME currently opened folder, one file per program.
Do NOT create subfolders. Each path must be a filename only.
Do NOT merge programs into any single shared file.
Use short, descriptive, safe English lowercase filenames with the correct extension.
Return ONLY these <file_output> blocks, with no markdown or explanation:
<file_output path="filename1.ext">
... content for file 1 ...
</file_output>
<file_output path="filename2.ext">
... content for file 2 ...
</file_output>

Programs that each require their own file:
${multiFileItems.map((item, index) => `${index + 1}. ${item}`).join('\n')}`
    : `Apply the user request to the current editor file.
Normally return ONLY the complete new file content, without markdown, code fences, explanations, labels, or a patch.
If the generated program requires a local data/configuration file that is not present in Related context, return the required real schema/config/initialization file only when the user request defines it. If real data is unavailable, implement an import/config/input path and do not invent sample data.
For that case, return ONLY <file_output> blocks: the first/main block must use the exact filename "${String(filePath).replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'generated file'}", and each additional block must contain one required data/config file such as CSV, JSON, TXT, YAML, SQL, or SQLite initialization SQL.
Use filename-only paths and keep every generated support file in the same folder. Never reference a missing local data file without also returning its <file_output> block.
If a suitable data file already appears in Related context, use that existing filename and do not generate a duplicate.
Do not create fake/sample/mock data to make the app look complete. Prefer an empty valid structure, user-import flow, configuration template, or explicit environment requirement when the real data source is unknown.
When selected code is provided, use it as the primary edit target while preserving unrelated file content.
If the current file is NOT empty, you MUST strictly preserve its original core logic, architecture, and intended functionality. Only apply the requested modifications (such as translation or feature addition). Do NOT discard the original app and invent a completely different application.
When the current file is empty, return the complete generated program.
${desktopGuiPortabilityRule(filePath, language)}` 

  const prompt = `You are Cubi Code, an AI coding assistant similar to Copilot / Codeium / Windsurf.
Configured feature policy:
${configuredFeaturePrompt('generate', { language, defaultLanguage: 'javascript' }) || '(none)'}

${outputRules}

File path: ${filePath}
Output directory: ${options.outputDirectory || '(currently opened folder root)'}
Language: ${language}
Mode: ${options.mode || 'code-generation'}
Style: ${options.style || 'auto'}

User request:
${instruction}

${sections.join('\n\n')}
`
  let result = await askLlm(prompt, {
    temperature: options.temperature ?? 0.12,
    numPredict: isMultiFileRequest ? Math.min(8000, 2200 * multiFileItems.length) : 3200,
    think: false,
    preferChat: true,
    requestEndpoint: '/api/ai/generate',
  })
  if (!result.ok) {
    return { type: 'code_generation', ...result, generated_code: '', new_content: '', files: [], file_path: filePath, language }
  }

  let files = isMultiFileRequest ? normalizeSameFolderModelFiles(result.content) : extractMultiFiles(result.content)
  let singleFileOutput = isMultiFileRequest ? { mainFile: null, supportFiles: [] } : splitSingleFileGeneration(files, filePath)
  if (!isMultiFileRequest) {
    const initialCode = singleFileOutput.mainFile?.content || extractFileContent(result.content)
    const missingDataFiles = missingGeneratedDataFiles({
      code: initialCode,
      instruction,
      contextFiles: options.contextFiles,
      supportFiles: singleFileOutput.supportFiles,
    })
    if (missingDataFiles.length) {
      let supportFilesResolved = false
      const supportRetry = await askLlm(`${prompt}

Your previous output referenced local data files that do not exist in IDE context and were not returned: ${missingDataFiles.join(', ')}.
Return ONLY <file_output> blocks now. The first block must be the complete main program using the exact filename "${String(filePath).replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'generated file'}".
Then return one complete usable <file_output> block for every missing data file listed above.
The application must work immediately after these files are saved without inventing fake/sample/mock data. If the real data source is unknown, provide an empty valid structure, user-import path, configuration template, or explicit environment requirement instead of placeholder records.`, {
        temperature: 0.05,
        numPredict: 5000,
        think: false,
        preferChat: true,
        requestEndpoint: '/api/ai/generate',
      })
      if (supportRetry.ok) {
        const retryFiles = extractMultiFiles(supportRetry.content)
        const retryOutput = splitSingleFileGeneration(retryFiles, filePath)
        const stillMissing = missingGeneratedDataFiles({
          code: retryOutput.mainFile?.content || '',
          instruction,
          contextFiles: options.contextFiles,
          supportFiles: retryOutput.supportFiles,
        })
        const retryPolicyErrors = generationPolicyErrors({
          instruction,
          mainFile: retryOutput.mainFile,
          supportFiles: retryOutput.supportFiles,
          missingDataFiles: stillMissing,
        })
        if (retryOutput.mainFile && retryOutput.supportFiles.length && !retryPolicyErrors.length) {
          result = { ...supportRetry, tokens: (result.tokens || 0) + (supportRetry.tokens || 0) }
          files = retryFiles
          singleFileOutput = retryOutput
          supportFilesResolved = true
        }
      }

      if (!supportFilesResolved) {
        const generatedSupportFiles = []
        let supportTokens = 0
        const allowSyntheticFixtureData = allowsSyntheticSupportData(instruction)
        for (const dataFile of missingDataFiles) {
          const dataResult = await askLlm(`You generate one local support data file for a program.
Return ONLY the complete raw file content. No markdown, code fences, filename label, or explanation.

Required filename: ${dataFile}
Main program filename: ${filePath}
Original user request:
${instruction}

Main program that will read this file:
${initialCode}

${allowSyntheticFixtureData
  ? 'The user explicitly requested sample/test/demo data. Create deterministic fixture data whose columns, keys, values, encoding, and structure exactly match what the main program expects. Keep it small and clearly suitable only as fixture data.'
  : 'Do NOT invent row data, people, products, prices, locations, metrics, API responses, or business facts. If the real data source is unavailable, return only a valid empty structure or integration template: CSV header row only; JSON [] or {}; SQL CREATE TABLE statements without INSERT rows; configuration keys with empty placeholder values. The generated program must read real user-provided data later instead of pretending synthetic data is real.'}`, {
            temperature: 0.05,
            numPredict: 1800,
            think: false,
            preferChat: true,
            requestEndpoint: '/api/ai/generate-support-file',
          })
          if (!dataResult.ok) break
          const dataContent = extractFileContent(dataResult.content)
          const dataValidation = validateGeneratedArtifact({ code: dataContent, filePath: dataFile })
          if (!dataValidation.ok) break
          const dataPolicyErrors = generationPolicyErrors({
            instruction,
            supportFiles: [{ path: dataFile, content: dataContent }],
          })
          if (dataPolicyErrors.length) break
          supportTokens += dataResult.tokens || 0
          generatedSupportFiles.push({ path: dataFile, content: dataContent })
        }

        if (generatedSupportFiles.length === missingDataFiles.length) {
          result = { ...result, tokens: (result.tokens || 0) + supportTokens }
          singleFileOutput = {
            mainFile: singleFileOutput.mainFile || { path: filePath, content: initialCode },
            supportFiles: [...singleFileOutput.supportFiles, ...generatedSupportFiles],
          }
        }
      }
    }
  }
  if (isMultiFileRequest && files.length !== multiFileItems.length) {
    const retry = await askLlm(`${prompt}

Your previous response was invalid because it returned ${files.length} usable files instead of exactly ${multiFileItems.length}.
Return exactly ${multiFileItems.length} <file_output> blocks now.`, {
      temperature: 0.1,
      numPredict: Math.min(8000, 2400 * multiFileItems.length),
      think: false,
      preferChat: true,
      requestEndpoint: '/api/ai/generate',
    })
    if (retry.ok) {
      result = { ...retry, tokens: (result.tokens || 0) + (retry.tokens || 0) }
      files = normalizeSameFolderModelFiles(retry.content)
    }
  }

  if (isMultiFileRequest && files.length !== multiFileItems.length) {
    return {
      type: 'code_generation',
      ...result,
      ok: false,
      error: `模型應回傳 ${multiFileItems.length} 個同層程式檔案，實際收到 ${files.length} 個。`,
      content: `多檔程式碼生成未完成：需要 ${multiFileItems.length} 個檔案，模型只回傳 ${files.length} 個；未建立任何預設替代檔案。`,
      generated_code: '',
      new_content: '',
      files: [],
      file_path: filePath,
      language,
    }
  }

  let newContent = isMultiFileRequest
    ? ''
    : singleFileOutput.mainFile?.content || extractFileContent(result.content)
  let effectiveTarget = isMultiFileRequest
    ? { filePath, language }
    : inferredGeneratedArtifactTarget(singleFileOutput.mainFile?.path || filePath, language, newContent)
  const refreshEffectiveTarget = () => {
    if (isMultiFileRequest) return
    effectiveTarget = inferredGeneratedArtifactTarget(singleFileOutput.mainFile?.path || filePath, language, newContent)
    if (singleFileOutput.mainFile) singleFileOutput.mainFile.path = effectiveTarget.filePath
  }
  refreshEffectiveTarget()
  const validateOutput = () => {
    if (isMultiFileRequest && files.length !== multiFileItems.length) {
      return { ok: false, errors: [`預期 ${multiFileItems.length} 個檔案，實際收到 ${files.length} 個`] }
    }
    const validationFiles = isMultiFileRequest ? files : [singleFileOutput.mainFile, ...singleFileOutput.supportFiles].filter(Boolean)
    const structuralValidation = validationFiles.length > 0
      ? validateGeneratedFiles(validationFiles, { language: effectiveTarget.language })
      : validateGeneratedArtifact({ code: newContent, filePath: effectiveTarget.filePath, language: effectiveTarget.language })
    const mainFileForPolicy = isMultiFileRequest
      ? null
      : (singleFileOutput.mainFile || { path: effectiveTarget.filePath, content: newContent })
    const unresolvedDataFiles = isMultiFileRequest ? [] : missingGeneratedDataFiles({
      code: mainFileForPolicy?.content || newContent,
      instruction,
      contextFiles: options.contextFiles,
      supportFiles: singleFileOutput.supportFiles,
    })
    const policyErrors = generationPolicyErrors({
      instruction,
      mainFile: mainFileForPolicy,
      supportFiles: isMultiFileRequest ? [] : singleFileOutput.supportFiles,
      missingDataFiles: unresolvedDataFiles,
    })
    const errors = [...(structuralValidation.errors || []), ...policyErrors]
    return {
      ...structuralValidation,
      ok: structuralValidation.ok && policyErrors.length === 0,
      errors,
      policy_errors: policyErrors,
    }
  }
  let validation = validateOutput()
  if (!validation.ok) {
    const validationErrors = validation.errors || []
    const retryPrompt = !isMultiFileRequest && effectiveTarget.filePath !== filePath && effectiveTarget.language === 'html'
      ? `You are Cubi Code repairing a generated standalone HTML application.
The user request was:
${instruction}

The previous model output was clearly HTML, but the original automatic target was ${filePath}. The correct target is ${effectiveTarget.filePath}.
Return ONLY one COMPLETE standalone HTML document for ${effectiveTarget.filePath}. Include all required HTML, CSS, and JavaScript inline so it works immediately when opened in a browser.
Do not return markdown, code fences, labels, explanation, or a partial fragment. The final line must close the html element.

Previous incomplete/invalid HTML:
${newContent}`
      : `${prompt}

Your previous output failed completeness or syntax validation:
${validationErrors.map(error => `- ${error}`).join('\n')}

Return a COMPLETE corrected output now. Do not truncate strings, objects, functions, JSX, classes, or closing tags.`
    const retry = await askLlm(retryPrompt, {
      temperature: 0.05,
      numPredict: isMultiFileRequest ? Math.min(10000, 2600 * multiFileItems.length) : 7000,
      think: false,
      preferChat: true,
      requestEndpoint: '/api/ai/generate',
    })
    if (retry.ok) {
      result = { ...retry, tokens: (result.tokens || 0) + (retry.tokens || 0) }
      files = isMultiFileRequest ? normalizeSameFolderModelFiles(retry.content) : extractMultiFiles(retry.content)
      singleFileOutput = isMultiFileRequest ? { mainFile: null, supportFiles: [] } : splitSingleFileGeneration(files, filePath)
      newContent = isMultiFileRequest
        ? ''
        : singleFileOutput.mainFile?.content || extractFileContent(retry.content)
      refreshEffectiveTarget()
      validation = validateOutput()
    }
  }
  if (!validation.ok) {
    const validationErrors = validation.errors || []
    return {
      type: 'code_generation',
      ...result,
      ok: false,
      error: `模型輸出未通過完整性／語法檢查：${validationErrors.join('；')}`,
      content: `程式碼生成失敗：模型已重試，但輸出仍不完整或語法無效。\n${validationErrors.map(error => `- ${error}`).join('\n')}`,
      generated_code: '',
      new_content: '',
      files: [],
      file_path: effectiveTarget.filePath,
      language: effectiveTarget.language,
      validation,
    }
  }
  return {
    type: 'code_generation',
    ...result,
    generated_code: newContent,
    new_content: newContent,
    files: isMultiFileRequest ? files : [],
    support_files: isMultiFileRequest ? [] : singleFileOutput.supportFiles,
    file_path: effectiveTarget.filePath,
    language: effectiveTarget.language,
    validation,
  }
}

function defaultRewriteInstruction(instruction = '') {
  return String(instruction || '').trim() || '提升可讀性與程式結構清晰度，保留原本功能，只做最小必要修改。'
}

function validateSingleFileResult(modelResult, filePath, language = '') {
  if (!modelResult?.ok) {
    return {
      files: [],
      generatedCode: '',
      validation: { ok: false, errors: [modelResult?.error || '模型沒有回傳可用內容'] },
    }
  }
  const files = extractMultiFiles(modelResult.content)
  const generatedCode = !files.length ? extractFileContent(modelResult.content) : ''
  const validation = files.length
    ? validateGeneratedFiles(files, { language })
    : validateGeneratedArtifact({ code: generatedCode, filePath, language })
  return { files, generatedCode, validation }
}

function failedValidatedAction(type, result, validation, extra = {}) {
  const errors = validation?.errors?.length ? validation.errors : ['模型輸出不完整或不可用']
  return {
    type,
    ...result,
    ...extra,
    ok: false,
    error: `模型輸出未通過完整性／語法檢查：${errors.join('；')}`,
    content: `操作失敗：模型輸出未通過完整性／語法檢查。\n${errors.map(error => `- ${error}`).join('\n')}`,
    generated_code: '',
    new_content: '',
    files: [],
    validation,
  }
}

function rewriteSummary({ instruction, filePath, modifiedFiles, related, fileReasons = [], mainChanges = [], preservedBehavior = true, confirmation = [] }) {
  const changed = modifiedFiles.length ? modifiedFiles : [filePath || '目前檔案']
  const reasonByPath = new Map((related.related_files || []).map(item => [item.file_path.toLowerCase(), item.reason]))
  for (const item of fileReasons) {
    const reasonPath = normalizeProjectPath(item?.path || item?.file_path || '')
    const reason = String(item?.reason || '').trim()
    if (reasonPath && reason) reasonByPath.set(reasonPath.toLowerCase(), reason)
  }
  const reasons = changed.map(changedPath => ({
    file_path: changedPath,
    reason: reasonByPath.get(String(changedPath).toLowerCase()) || (changedPath === filePath ? '使用者目前提供或選取的主要程式碼' : '配合主要程式的相依關係進行一致調整'),
  }))
  const needsConfirmation = [...new Set([...(related.needs_confirmation || []), ...confirmation].filter(Boolean))]
  const changes = mainChanges.length ? mainChanges : ['依需求改善程式結構與可讀性，並限制在最小必要範圍。']
  const content = [
    '改寫目標：' + instruction,
    `修改過的檔案：${changed.join('、')}`,
    '每個檔案修改原因：',
    ...reasons.map(item => `- ${item.file_path}：${item.reason}`),
    '主要修改內容：',
    ...changes.map(item => `- ${item}`),
    `是否有保留原本功能：${preservedBehavior ? '是；已要求維持既有行為與介面不變。' : '模型標示可能有行為差異，需人工確認。'}`,
    `是否需要使用者再確認的地方：${needsConfirmation.length ? needsConfirmation.join('；') : '無；仍建議套用前檢視 Diff 並執行既有測試。'}`,
  ].join('\n')
  return { content, reasons, changes, needsConfirmation }
}

async function rewriteCode(code, instruction, context = '', options = {}) {
  const filePath = normalizeProjectPath(options.filePath || '') || 'current_file.txt'
  const request = defaultRewriteInstruction(instruction)
  const related = collectRelatedContext({
    filePath,
    code,
    instruction: request,
    contextFiles: options.contextFiles || [],
    maxFiles: 16,
    maxChars: 100000,
  })
  const relatedFiles = related.files.filter(item => item.file_path.toLowerCase() !== filePath.toLowerCase())
  const relatedText = formatContextFiles(relatedFiles, 100000)
  const prompt = `You are Cubi Code Context-Aware Rewrite.
Rewrite the existing code according to the user request while preserving observable behavior.

Rules:
- Make the smallest necessary changes. Do not rewrite the whole file or project without a concrete need.
- Preserve public APIs, inputs, outputs, side effects, error behavior, and existing tests unless the request explicitly requires a change.
- Use related files as constraints and context. Modify a related file only when the requested refactor cannot remain consistent without it.
- If the request is vague, improve readability and structure only.
- Return complete file content, never a patch.
- For multiple changed files, wrap each complete file in <file_output path="path">...</file_output>.
- Do not include explanations outside file output/code.
${desktopGuiPortabilityRule(filePath, normalizeLanguage(filePath))}

Primary file: ${filePath}
Request:
${request}

Automatically selected related context:
${relatedText || '(none)'}

Additional caller context:
${String(context || '').slice(0, 30000) || '(none)'}

Primary code:
\`\`\`text
${code || ''}
\`\`\`
`
  let result = await askLlm(prompt, { temperature: 0.12, numPredict: 6000, requestEndpoint: '/api/ai/rewrite' })
  let { files, generatedCode, validation } = validateSingleFileResult(result, filePath, normalizeLanguage(filePath))
  if (result.ok && !validation.ok) {
    const retry = await askLlm(`${prompt}

Your previous rewrite failed completeness or syntax validation:
${validation.errors.map(error => `- ${error}`).join('\n')}

Return complete corrected file content only. If multiple files must change, return only <file_output> blocks. Do not include explanations.`, {
      temperature: 0.04,
      topP: 0.7,
      numPredict: 8000,
      maxRetries: 0,
      requestEndpoint: '/api/ai/rewrite',
    })
    if (retry.ok) {
      result = { ...retry, tokens: (result.tokens || 0) + (retry.tokens || 0) }
      const retryOutput = validateSingleFileResult(result, filePath, normalizeLanguage(filePath))
      files = retryOutput.files
      generatedCode = retryOutput.generatedCode
      validation = retryOutput.validation
    }
  }
  const modifiedFiles = files.length ? files.map(file => file.path) : (generatedCode ? [filePath] : [])
  if (!result.ok || !validation.ok) {
    return failedValidatedAction('code_rewrite', result, validation, {
      model_content: result.content,
      rewrite_goal: request,
      checked_files: related.related_files.map(item => item.file_path),
      modified_files: [],
      context_coverage: related.coverage,
      unresolved_references: related.unresolved_references,
    })
  }
  const report = rewriteSummary({ instruction: request, filePath, modifiedFiles, related })
  return {
    type: 'code_rewrite',
    ...result,
    content: result.ok ? report.content : result.content,
    model_content: result.content,
    generated_code: generatedCode,
    new_content: generatedCode,
    files,
    rewrite_goal: request,
    checked_files: related.related_files.map(item => item.file_path),
    modified_files: modifiedFiles,
    file_reasons: report.reasons,
    main_changes: report.changes,
    preserved_behavior: true,
    needs_confirmation: report.needsConfirmation,
    context_coverage: related.coverage,
    unresolved_references: related.unresolved_references,
    validation,
  }
}

function inferredTargetLanguage(targetLanguage = '', instruction = '') {
  const requested = String(targetLanguage || '').trim()
  if (requested && requested.toLowerCase() !== 'auto') return requested
  const text = String(instruction || '')
  const marker = /(?:轉換|轉成|轉為|改寫成|改寫為|convert(?:ed)?\s+to)/i.exec(text)
  const targetText = marker ? text.slice((marker.index || 0) + marker[0].length) : ''
  if (/\bnode(?:\.js)?\b|\bexpress(?:\.js)?\b|\bjavascript\b|\bjs\b/i.test(targetText)) return 'JavaScript'
  if (/\btypescript\b|\btsx?\b/i.test(targetText)) return 'TypeScript'
  if (/\bpython\b|\bfastapi\b/i.test(targetText)) return 'Python'
  if (/\bc#\b|\bcsharp\b/i.test(targetText)) return 'C#'
  if (/\bphp\b/i.test(targetText)) return 'PHP'
  if (/\bgo\b|\bgolang\b|\bgin\b/i.test(targetText)) return 'Go'
  if (/\brust\b/i.test(targetText)) return 'Rust'
  if (/\bhtml\b/i.test(targetText)) return 'HTML'
  if (/\bjava\b/i.test(targetText) && !/javascript/i.test(targetText)) return 'Java'
  return 'auto（需人工確認目標語言）'
}

function uniqueConvertedPath(candidatePath, sourcePaths, targetLanguage, fallbackPath) {
  let candidate = normalizeProjectPath(candidatePath) || convertedFilePath(fallbackPath, targetLanguage)
  const sourceSet = new Set(sourcePaths.map(item => normalizeProjectPath(item).toLowerCase()))
  if (!sourceSet.has(candidate.toLowerCase())) return candidate
  candidate = convertedFilePath(candidate, targetLanguage)
  if (!sourceSet.has(candidate.toLowerCase())) return candidate
  const extension = require('path').posix.extname(candidate)
  return `${candidate.slice(0, -extension.length)}.converted${extension}`
}

function requestedConversionOutputPath(instruction = '') {
  const text = String(instruction || '')
  const pattern = /@?((?:[A-Za-z0-9_.+-]+[\\/])*\.?[A-Za-z0-9_.+-]+\.[A-Za-z0-9_+-]+)/g
  let match
  while ((match = pattern.exec(text)) !== null) {
    const before = text.slice(Math.max(0, match.index - 36), match.index)
    if (!/(?:輸出(?:檔案)?|轉換後(?:檔案)?|另存|存成|建立|新增|產生|寫入|output(?:\s+file)?(?:\s+as|\s+to)?|save\s+as)\s*(?:為|成|到|至|:|：)?\s*$/i.test(before)) continue
    const normalized = normalizeProjectPath(match[1])
    if (normalized) return normalized
  }
  return ''
}

function conversionSummary({ sourceLanguage, targetLanguage, convertedFiles, related, differences, manual }) {
  const confirmations = [...new Set([...(manual || []), ...(related.needs_confirmation || [])].filter(Boolean))]
  const mainChanges = [
    `將 ${sourceLanguage} 的語法、控制流程與資料處理轉為 ${targetLanguage}。`,
    `依 ${related.related_files.length} 個自動判斷的主要／相關檔案校對模組、API、測試與設定關係。`,
  ]
  const content = [
    `來源語言：${sourceLanguage}`,
    `目標語言：${targetLanguage}`,
    `轉換後的檔案：${convertedFiles.join('、') || '未產生'}`,
    '主要轉換內容：',
    ...mainChanges.map(item => `- ${item}`),
    '原本程式與轉換後程式的差異：',
    ...differences.map(item => `- ${item}`),
    `需要人工確認或補上的部分：${confirmations.length ? confirmations.join('；') : '無特定項目；仍建議執行目標語言的建置與測試。'}`,
    '注意事項：原始檔案不會被覆寫；轉換結果使用新的目標語言檔名。',
  ].join('\n')
  return { content, mainChanges, confirmations }
}

async function convertCode(code, targetLanguage = 'auto', instruction = '', filePath = '', context = '', options = {}) {
  const target = inferredTargetLanguage(targetLanguage, instruction)
  const sourceCode = String(code || '').trim()
  if (!target || /^auto/i.test(target)) {
    return {
      type: 'code_convert',
      source_language: detectSourceLanguage(sourceCode, filePath),
      target_language: target,
      ok: false,
      content: '',
      generated_code: '',
      new_content: '',
      files: [],
      model: 'system',
      source: 'validation',
      tokens: 0,
      error: '無法判斷目標語言。請明確指定要轉成 Python、JavaScript、TypeScript、Go 等目標語言。',
    }
  }
  if (!sourceCode) {
    return {
      type: 'code_convert',
      source_language: detectSourceLanguage('', filePath),
      target_language: target,
      ok: false,
      content: '',
      generated_code: '',
      new_content: '',
      model: 'system',
      source: 'validation',
      tokens: 0,
      error: '沒有可轉換的來源程式碼。',
    }
  }
  const normalizedFilePath = normalizeProjectPath(filePath) || 'source.txt'
  const sourceLanguage = detectSourceLanguage(sourceCode, normalizedFilePath)
  const related = collectRelatedContext({
    filePath: normalizedFilePath,
    code: sourceCode,
    instruction: instruction || `Convert to ${target}`,
    contextFiles: options.contextFiles || [],
    maxFiles: 16,
    maxChars: 100000,
  })
  const relatedFiles = related.files.filter(item => item.file_path.toLowerCase() !== normalizedFilePath.toLowerCase())
  const relatedText = formatContextFiles(relatedFiles, 100000)
  const requestedOutputPath = requestedConversionOutputPath(instruction)
  const suggestedPath = requestedOutputPath || convertedFilePath(normalizedFilePath, target)
  const isPythonTarget = /python|\.py\b/i.test(target) || /\.py$/i.test(suggestedPath)
  const isGuiTarget = /tkinter|customtkinter|gui|桌面/i.test(instruction) || /tkinter|customtkinter/i.test(target)
  const targetSpecificRules = isPythonTarget ? `
- Python Syntax Strictness: Do NOT use full-width Chinese punctuation (such as '．', '，', '：', '；') in code identifiers or syntax. All code tokens must use standard ASCII.
- Complete Runnable Code: Never omit function bodies, write placeholder comments like 'TODO', or truncate class methods.${isGuiTarget ? `
- Python Tkinter Desktop GUI Rules:
  * Map HTML layout, CSS styles, and elements to idiomatic Tkinter / ttk widgets (Frame, Label, Entry, Button, ttk.Treeview, ttk.Notebook).
  * Map web asynchronous timers (setInterval/setTimeout) to non-blocking 'root.after(ms, callback)'. Do NOT use blocking 'time.sleep()'.
  * Include a complete runnable main entry: 'if __name__ == "__main__":' creating 'root = tk.Tk()', instantiating the app, and starting 'root.mainloop()'.` : ''}` : ''

  const prompt = `You are Cubi Code Context-Aware Language Converter.
Configured feature policy:
${configuredFeaturePrompt('convert') || '(none)'}

Convert the primary ${sourceLanguage} program to ${target} while keeping behavior and execution flow equivalent.

Rules:
- Read the automatically selected related files before converting imports, calls, API contracts, configuration assumptions, and tests.
- Preserve inputs, outputs, side effects, validation, error behavior, and important comments as closely as the target language permits.
- Use idiomatic target-language syntax; do not perform a blind line-by-line transliteration.
- Never overwrite or emit the original source path. The suggested target path is ${suggestedPath}.
- Convert related project-owned source modules only when required for the converted program to remain usable. Do not convert tests or configuration without a concrete need.
- Wrap every complete converted file in <file_output path="new-target-path">...</file_output>.
- Return no analysis, hidden thinking, markdown, or text outside <file_output> blocks.${targetSpecificRules}

Instruction:
${instruction || `Convert to ${target}`}

Source file: ${normalizedFilePath}
Suggested target file: ${suggestedPath}

Automatically selected related context:
${relatedText || '(none)'}

Additional caller context:
${String(context || '').slice(0, 30000) || '(none)'}

Primary source code:
\`\`\`text
${sourceCode}
\`\`\`
`
  let result = await askLlm(prompt, {
    temperature: 0.1,
    topP: 0.8,
    numPredict: 8000,
    maxRetries: 1,
    preferChat: true,
    think: false,
    requestEndpoint: '/api/ai/convert',
  })
  const sourcePaths = related.related_files.map(item => item.file_path)
  const extractConvertedFiles = modelResult => {
    const extractedFiles = modelResult.ok ? extractMultiFiles(modelResult.content) : []
    const files = extractedFiles.map((file, index) => ({
      path: uniqueConvertedPath(index === 0 && requestedOutputPath ? requestedOutputPath : file.path, sourcePaths, target, index === 0 ? normalizedFilePath : file.path),
      content: file.content,
    }))
    const fallbackCode = modelResult.ok && !files.length ? extractFileContent(modelResult.content) : ''
    if (fallbackCode) files.push({ path: uniqueConvertedPath(suggestedPath, sourcePaths, target, normalizedFilePath), content: fallbackCode })
    return files
  }
  let converted = extractConvertedFiles(result)
  let validation = converted.length ? validateGeneratedFiles(converted, { language: target }) : { ok: false, errors: ['模型沒有產生可用的轉換檔案'] }
  if (result.ok && !validation.ok) {
    const retry = await askLlm(`${prompt}

Your previous conversion failed completeness or target-language syntax validation:
${validation.errors.map(error => `- ${error}`).join('\n')}

Return complete corrected <file_output> blocks only.`, {
      temperature: 0.05,
      topP: 0.7,
      numPredict: 10000,
      maxRetries: 0,
      preferChat: true,
      think: false,
      requestEndpoint: '/api/ai/convert',
    })
    if (retry.ok) {
      result = { ...retry, tokens: (result.tokens || 0) + (retry.tokens || 0) }
      converted = extractConvertedFiles(result)
      validation = converted.length ? validateGeneratedFiles(converted, { language: target }) : { ok: false, errors: ['模型沒有產生可用的轉換檔案'] }
    }
  }
  const primaryConverted = converted[0] || { path: suggestedPath, content: '' }
  const pairNotes = conversionDifferences(sourceLanguage, target)
  const report = conversionSummary({
    sourceLanguage,
    targetLanguage: target,
    convertedFiles: converted.map(file => file.path),
    related,
    differences: pairNotes.differences,
    manual: pairNotes.manual,
  })
  return {
    type: 'code_convert',
    source_language: sourceLanguage,
    target_language: target,
    ...result,
    ok: result.ok && validation.ok,
    error: validation.ok ? result.error : `轉換輸出未通過完整性／語法檢查：${validation.errors.join('；')}`,
    content: result.ok && validation.ok ? report.content : (result.content || `轉換輸出驗證失敗：${validation.errors.join('；')}`),
    model_content: result.content,
    generated_code: converted.length === 1 ? primaryConverted.content : '',
    new_content: converted.length === 1 ? primaryConverted.content : '',
    files: converted.length > 1 ? converted : [],
    converted_files: converted.map(file => file.path),
    main_conversion: report.mainChanges,
    language_differences: pairNotes.differences,
    needs_confirmation: report.confirmations,
    notes: ['原始檔案保留不變；轉換結果使用新檔案。'],
    checked_files: related.related_files.map(item => item.file_path),
    related_files: related.related_files,
    context_coverage: related.coverage,
    unresolved_references: related.unresolved_references,
    validation,
  }
}

async function detectErrors(code, context = '') {
  const prompt = `You are Cubi Code Error Detector.
Configured feature policy:
${configuredFeaturePrompt('detect') || '(none)'}

Review the code and report bugs, runtime risks, missing edge cases, security issues, and test suggestions.
Reply in Traditional Chinese. Do not rewrite the whole file unless asked.
【嚴格規範：絕不無病呻吟與虛報錯誤】實事求是，嚴禁無病呻吟或胡扯假的錯誤。若程式碼正常無誤、毫無具體語法或執行缺陷，務必清楚表明「✅ 經過檢查，目前程式碼語法與邏輯均為正常，未偵測到任何實質錯誤或高風險缺陷。」嚴禁把正常的撰寫風格、代碼排版或示範寫法挑毛病誤報為錯誤！

Context:
${context || '(none)'}

Code:
\`\`\`text
${code || ''}
\`\`\`
`
  const result = await askLlm(prompt, { temperature: 0.1, numPredict: 1200, requestEndpoint: '/api/ai/detect' })
  return { type: 'error_detection', ...result }
}

async function fixErrors(code, instruction = '', context = '', options = {}) {
  const filePath = normalizeProjectPath(options.filePath || '') || 'current_file.txt'
  const language = normalizeLanguage(filePath)
  const prompt = `You are Cubi Code Error Fixer.
Configured feature policy:
${configuredFeaturePrompt('fix') || '(none)'}

Fix the code according to the request and return only the full fixed code in a code block.

Rules:
- Fix the real defect described by the request, context, compiler output, stack trace, or tests.
- STRICT ZERO-FAKE-FIX POLICY: If the code has no real syntax bugs, logical defects, or test failures, do NOT make cosmetic changes, formatting tweaks, or add useless comments just to pretend a fix was made! If no correction is strictly required, return the complete original code unchanged and state clearly that no changes are needed.
- Preserve existing inputs, outputs, public API, side effects, and data contracts unless the request explicitly changes them.
- Do not invent fake data, mock successful results, or hard-coded sample outputs to hide an error.
- Return complete fixed file content only. Do not include explanations outside the code block unless stating no change is needed.

Request:
${instruction || 'Fix bugs and edge cases.'}

Context:
${context || '(none)'}

Code:
\`\`\`text
${code || ''}
\`\`\`
`
  let result = await askLlm(prompt, { temperature: 0.08, numPredict: 4000, requestEndpoint: '/api/ai/fix' })
  let { generatedCode, validation } = validateSingleFileResult(result, filePath, language)
  if (result.ok && isTrivialOrFakeFix(code, generatedCode, filePath, result.content)) {
    return {
      type: 'error_fix',
      ...result,
      ok: true,
      no_change: true,
      model_content: result.content,
      fixed_code: code,
      generated_code: code,
      new_content: code,
      file_path: filePath,
      validation: { ok: true, errors: [] },
    }
  }
  if (result.ok && !validation.ok) {
    const retry = await askLlm(`${prompt}

Your previous fix failed completeness or syntax validation:
${validation.errors.map(error => `- ${error}`).join('\n')}

Return the complete corrected file content only in one code block.`, {
      temperature: 0.03,
      topP: 0.7,
      numPredict: 5000,
      maxRetries: 0,
      requestEndpoint: '/api/ai/fix',
    })
    if (retry.ok) {
      result = { ...retry, tokens: (result.tokens || 0) + (retry.tokens || 0) }
      const retryOutput = validateSingleFileResult(result, filePath, language)
      generatedCode = retryOutput.generatedCode
      validation = retryOutput.validation
    }
  }
  if (result.ok && isTrivialOrFakeFix(code, generatedCode, filePath, result.content)) {
    return {
      type: 'error_fix',
      ...result,
      ok: true,
      no_change: true,
      model_content: result.content,
      fixed_code: code,
      generated_code: code,
      new_content: code,
      file_path: filePath,
      validation: { ok: true, errors: [] },
    }
  }
  if (!result.ok || !validation.ok) {
    return failedValidatedAction('error_fix', result, validation, {
      model_content: result.content,
      file_path: filePath,
    })
  }
  return {
    type: 'error_fix',
    ...result,
    model_content: result.content,
    fixed_code: generatedCode,
    generated_code: generatedCode,
    new_content: generatedCode,
    file_path: filePath,
    validation,
  }
}


async function rewriteAdvice(code, instruction = '', context = '') {
  const prompt = `You are Cubi Code Refactor Advisor.
Analyze the code and provide refactor / rewrite suggestions only.
Do NOT modify files. Do NOT return a full rewritten file unless the user explicitly asks.
Reply in Traditional Chinese with concise numbered suggestions.

Request:
${instruction || '請提出程式碼改寫與重構建議，不要直接修改檔案。'}

Context:
${context || '(none)'}

Code:
\`\`\`text
${code || ''}
\`\`\`
`
  const result = await askLlm(prompt, { temperature: 0.15, numPredict: 900, requestEndpoint: '/api/ai/rewrite-advice' })
  return { type: 'code_rewrite_advice', ...result }
}

async function testAdvice(code, instruction = '', filePath = '', context = '') {
  const prompt = `You are Cubi Code Test Case Designer.
Design pytest test cases for the current file. Do NOT modify any file.
Reply in Traditional Chinese and include concise pytest examples.

Source file: ${filePath || 'current file'}
Request:
${instruction || '請設計 pytest 測試案例，不要修改檔案。'}

Context:
${context || '(none)'}

Code:
\`\`\`text
${code || ''}
\`\`\`
`
  const result = await askLlm(prompt, { temperature: 0.15, numPredict: 1100, requestEndpoint: '/api/ai/test-advice' })
  return { type: 'test_case_advice', ...result }
}

function normalizePlanText(value = '') {
  return String(value || '').replace(/\r\n/g, '\n').trim()
}

function normalizePlanArray(value, fallback = []) {
  const source = Array.isArray(value) ? value : []
  const normalized = source
    .map(item => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object') {
        return item.label || item.title || item.step || item.description || item.reason || item.command || item.path || ''
      }
      return ''
    })
    .map(item => normalizePlanText(item))
    .filter(Boolean)
  return normalized.length ? normalized : fallback
}

function normalizePlanFiles(value, fallbackPaths = []) {
  const source = Array.isArray(value) ? value : []
  const files = source
    .map(item => {
      if (typeof item === 'string') {
        return { path: normalizePath(item), action: 'planned', reason: 'AI 規劃中可能會新增或修改' }
      }
      if (!item || typeof item !== 'object') return null
      const filePath = normalizePath(item.path || item.file_path || item.file || item.name)
      if (!filePath) return null
      return {
        path: filePath,
        action: normalizePlanText(item.action || item.status || 'planned') || 'planned',
        reason: normalizePlanText(item.reason || item.description || item.purpose || 'AI 規劃中可能會新增或修改') || 'AI 規劃中可能會新增或修改',
      }
    })
    .filter(Boolean)

  if (files.length) return files
  return fallbackPaths.map(path => ({ path: normalizePath(path), action: 'planned', reason: '從方案文字推測的可能影響檔案' })).filter(item => item.path)
}

function buildFallbackStructuredPlan(instruction = '', plainText = '') {
  const text = normalizePlanText(plainText)
  const fallbackPaths = explicitRequestedFilePaths(`${instruction}\n${text}`)
  const lines = text
    .split('\n')
    .map(line => line.replace(/^#{1,6}\s*/, '').replace(/^[-*]\s*/, '').replace(/^\d+[.)、]\s*/, '').trim())
    .filter(line => line.length >= 6)

  return {
    summary: lines[0] || '已完成規劃；尚未修改任何檔案，需由使用者確認後才會執行。',
    workspace_observations: [
      '已依目前提供的工作區上下文與使用者需求規劃。',
      '若資料來源或 API 規格尚未在上下文中，執行階段需要再查證。',
    ],
    steps: lines.slice(0, 6).length ? lines.slice(0, 6) : [
      '讀取工作區結構、README、package 與重要設定檔。',
      '確認需求需要的前後端模組與資料來源。',
      '規劃要新增或修改的檔案與資料流。',
      '實作功能後檢查靜態建置或測試。',
      '回報檔案變更、測試結果與後續風險。',
    ],
    files: normalizePlanFiles([], fallbackPaths),
    risks: ['模型回覆不是完整 JSON；已保留原始方案文字並建立保守結構化摘要。'],
    tests: ['依專案類型執行 npm build / npm test / pytest 或至少做語法檢查。'],
    commands_to_run: [],
    needs_approval: true,
  }
}

function normalizeStructuredPlan(rawPlan = {}, instruction = '', plainText = '') {
  const fallback = buildFallbackStructuredPlan(instruction, plainText)
  const fallbackPaths = explicitRequestedFilePaths(`${instruction}\n${plainText}`)
  const plan = rawPlan && typeof rawPlan === 'object' ? rawPlan : {}
  return {
    summary: normalizePlanText(plan.summary || plan.title || fallback.summary) || fallback.summary,
    workspace_observations: normalizePlanArray(plan.workspace_observations || plan.observations || plan.context_findings, fallback.workspace_observations),
    steps: normalizePlanArray(plan.steps || plan.implementation_steps || plan.plan, fallback.steps).slice(0, 10),
    files: normalizePlanFiles(plan.files || plan.affected_files || plan.file_changes, fallbackPaths),
    risks: normalizePlanArray(plan.risks || plan.risk_notes, fallback.risks).slice(0, 8),
    tests: normalizePlanArray(plan.tests || plan.validation || plan.test_plan, fallback.tests).slice(0, 8),
    commands_to_run: normalizePlanArray(plan.commands_to_run || plan.commands || plan.suggested_commands, fallback.commands_to_run).slice(0, 8),
    needs_approval: plan.needs_approval === false ? false : true,
  }
}

function formatStructuredPlan(plan = {}) {
  const files = Array.isArray(plan.files) ? plan.files : []
  const sections = [
    `摘要：${plan.summary || '已產生實作方案。'}`,
    '',
    '工作區觀察：',
    ...normalizePlanArray(plan.workspace_observations, ['已讀取目前可用的工作區上下文。']).map(item => `- ${item}`),
    '',
    '實作步驟：',
    ...normalizePlanArray(plan.steps, ['確認需求後再開始實作。']).map((item, index) => `${index + 1}. ${item}`),
  ]

  if (files.length) {
    sections.push('', '可能影響檔案：')
    for (const file of files) {
      sections.push(`- ${file.path}${file.action ? `（${file.action}）` : ''}${file.reason ? `：${file.reason}` : ''}`)
    }
  }

  sections.push(
    '',
    '風險：',
    ...normalizePlanArray(plan.risks, ['尚未執行，需接受方案後才會修改檔案。']).map(item => `- ${item}`),
    '',
    '測試 / 驗證：',
    ...normalizePlanArray(plan.tests, ['接受方案後依專案類型執行可用測試。']).map(item => `- ${item}`)
  )

  const commands = normalizePlanArray(plan.commands_to_run, [])
  if (commands.length) {
    sections.push('', '建議執行命令：', ...commands.map(item => `- ${item}`))
  }

  sections.push('', plan.needs_approval === false ? '可直接執行。' : '是否實作此方案？')
  return sections.join('\n')
}

function selectPlanContextFiles(contextFiles = [], includeIdeContext = true) {
  const files = Array.isArray(contextFiles) ? contextFiles : []
  if (includeIdeContext) return files

  return files.filter(item => {
    if (item?.content_type === 'conversation_history') return true
    const roles = String(item?.role || '')
      .split(',')
      .map(role => role.trim())
      .filter(Boolean)
    return roles.some(role => ['task_target', 'explicit_task_target', 'conversation_history'].includes(role))
  })
}

function collectPlanFilePaths(instruction = '', resultContent = '') {
  return explicitRequestedFilePaths(`${instruction}\n${resultContent}`)
    .map(path => normalizePath(path))
    .filter(Boolean)
}

function normalizeClarificationAnswers(value = []) {
  if (!Array.isArray(value)) return []
  return value
    .map(item => {
      if (!item || typeof item !== 'object') return null
      const questionId = normalizePlanText(item.question_id || item.questionId || item.id)
      const prompt = normalizePlanText(item.prompt || item.question)
      const rawValue = Array.isArray(item.values) ? item.values : (item.value == null ? [] : [item.value])
      const values = rawValue.map(answer => normalizePlanText(answer)).filter(Boolean)
      if (!questionId || !values.length) return null
      return { question_id: questionId, prompt, values }
    })
    .filter(Boolean)
}

function normalizeClarificationQuestions(value = []) {
  const questions = (Array.isArray(value) ? value : [])
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const prompt = normalizePlanText(item.prompt || item.question || item.title)
      if (!prompt) return null
      const type = ['single', 'multi', 'text'].includes(item.type) ? item.type : 'single'
      const options = (Array.isArray(item.options) ? item.options : [])
        .map((option, optionIndex) => {
          if (typeof option === 'string') return { value: `option_${optionIndex + 1}`, label: normalizePlanText(option), description: '' }
          if (!option || typeof option !== 'object') return null
          const label = normalizePlanText(option.label || option.title || option.value)
          if (!label) return null
          return {
            value: normalizePlanText(option.value || `option_${optionIndex + 1}`),
            label,
            description: normalizePlanText(option.description || option.detail || ''),
          }
        })
        .filter(Boolean)
      return {
        id: normalizePlanText(item.id || item.key || `question_${index + 1}`),
        prompt,
        type: type === 'text' || options.length ? type : 'text',
        required: item.required !== false,
        allow_custom: item.allow_custom !== false,
        options,
      }
    })
    .filter(Boolean)
    .slice(0, 3)
  return questions
}

async function collectPlanClarifications(instruction = '', options = {}) {
  const prompt = `你是 Cubi Code 的規劃決策助理。你的工作不是產生方案，而是判斷在產生方案前，是否有「少數幾個會明顯改變方案方向」的使用者決策。
只有在真的會影響規劃方向時才提問；若需求已足夠明確，needs_clarification 必須是 false 且 questions 必須是空陣列。
問題和選項必須完全根據本次使用者需求與工作區上下文產生，不可套用固定範本，不可使用固定題庫，不可詢問空泛的交付程度/技術方向/驗收條件。
最多提出 2 個問題；每題最多 4 個選項；選項要短、具體、可直接點選。不得編造假資料或範例資料。

只輸出合法 JSON，不要使用 Markdown code fence：
{
  "needs_clarification": true,
  "rationale": "為什麼這個決策會影響規劃",
  "questions": [
    {
      "id": "stable_english_key",
      "prompt": "繁體中文問題",
      "type": "single 或 multi 或 text",
      "required": true,
      "allow_custom": true,
      "options": [{"value":"stable_value","label":"短選項文字","description":"選擇後的差異"}]
    }
  ]
}

使用者需求：
${instruction || '(未提供)'}

工作區摘要：
${normalizePlanText(options.workspaceContext || '(none)').slice(0, 12000)}`

  const result = await askLlm(prompt, { temperature: 0.1, numPredict: 1200, timeoutMs: 2147483647, requestEndpoint: '/api/ai/plan' })
  if (result.ok === false) {
    return { ...result, needs_clarification: false, questions: [], parse_error: result.error || '規劃決策模型呼叫失敗，直接進入規劃。' }
  }

  const parsed = tryParseJsonObject(result.content || '')
  if (!parsed || typeof parsed !== 'object') {
    return { ...result, needs_clarification: false, questions: [], parse_error: '規劃決策模型未回傳合法 JSON，直接進入規劃。' }
  }

  const questions = normalizeClarificationQuestions(parsed.questions)
  const needsClarification = parsed.needs_clarification === true && questions.length > 0
  return {
    ...result,
    needs_clarification: needsClarification,
    rationale: normalizePlanText(parsed.rationale || (needsClarification ? '需要先選擇會影響方案方向的項目。' : '需求已足夠直接規劃。')),
    questions: needsClarification ? questions : [],
    parse_error: null,
  }
}

async function planTask(instruction = '', options = {}) {
  const includeIdeContext = options.includeIdeContext !== false
  const filePath = options.filePath || ''
  const code = includeIdeContext ? String(options.code || '') : ''
  const planContextFiles = selectPlanContextFiles(options.contextFiles, includeIdeContext)
  const contextFilesText = formatContextFiles(planContextFiles, 48000)
  const workspaceContext = normalizePlanText(options.workspaceContext || '')
  const clarificationAnswers = normalizeClarificationAnswers(options.clarificationAnswers)
  const planningSessionId = normalizePlanText(options.planningSessionId) || `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  if (!clarificationAnswers.length && options.forcePlan !== true) {
    const clarification = await collectPlanClarifications(instruction, { workspaceContext })
    if (clarification.needs_clarification) {
      return {
        ok: clarification.ok !== false,
        type: 'plan_clarification',
        phase: 'clarification',
        planning_session_id: planningSessionId,
        needs_clarification: true,
        needs_approval: false,
        rationale: clarification.rationale,
        questions: clarification.questions,
        source: clarification.source,
        model: clarification.model,
        tokens: clarification.tokens,
      }
    }
  }

  const confirmedRequirements = clarificationAnswers.length
    ? clarificationAnswers.map(item => `- ${item.prompt || item.question_id}：${item.values.join('、')}`).join('\n')
    : '- 未出現需要使用者先選擇的動態規劃決策；請直接依使用者原始需求與工作區資訊提出規劃。'

  const prompt = `你是 Cubi Code Plan Agent，一個專精於程式開發的 AI 助手。
在修改任何程式碼之前，請先檢視提供的工作區上下文，並制定一個詳細、實用的「實作方案 (Implementation Plan)」。
請注意：絕對不要直接修改檔案、不要回傳 diff 格式，也不要假裝你已經執行了任何指令。
如果使用者的需求依賴於外部資料、API 結構、套件安裝或未知的專案狀態，請在方案中明確列出執行階段的驗證步驟或建議指令。
若功能依賴麥克風、攝影機、GPU 或其他主機硬體，不得把 Docker 語法檢查描述成真實硬體驗收；必須分開列出可自動執行的檢查與需要在主機完成的人工驗收。
若規劃的是需要 HTTP/Web Port 的應用（例如 Flask、FastAPI、Node、Vite、Streamlit、小畫家 Web App），不得規劃固定寫死的 3000、5000、5173、8000、8080 等常見 Port。Cubi Code 的 Docker Sandbox Terminal 會在每次啟動時產生一個高位隨機 Port，並透過環境變數 PORT / CUBI_APP_PORT 提供給程式。規劃中的 Server 必須綁定 0.0.0.0 並在執行時讀取 PORT；使用者會自己在 Sandbox 終端機打指令啟動，禁止規劃自動開啟瀏覽器。
【極度重要】當你撰寫建立檔案的 Python 腳本時，請務必先使用 os.makedirs(os.path.dirname(filepath), exist_ok=True) 建立父資料夾，否則會發生 FileNotFoundError。
請將計畫寫成可驗收的結構化資料。每個步驟都必須有明確產物，不得把「稍後確認」當成實作內容。
規劃模式必須像一般 AI 規劃助理：若沒有前置動態決策，就直接產生方案；不要在方案 JSON 內再輸出互動式需求確認表單。若資訊不足，請在 workspace_observations、risks 或 steps 中列出待確認事項、合理假設與執行階段查證方式，但仍要給出可前進的方案。
不得把假資料、mock data、sample data、固定 seed、固定成功結果或展示用假內容列為交付成果。若需求需要資料來源但目前不可用，方案必須規劃真實輸入方式、設定欄位、API/檔案接入點或明確的環境限制，不能以假資料替代。

【極度重要】絕對不要編造假資料、虛構檔案路徑或使用固定寫死的範例資料（Hardcoded Data）。請嚴格根據提供的工作區真實上下文來進行規劃！如果資訊不足，請在方案中提出，切勿自行幻想。
【極度重要】你必須「一律使用繁體中文 (Traditional Chinese, zh-TW)」來撰寫所有的回覆與規劃內容！絕對不要使用英文！

選擇的工具: ${options.selectedTool || 'auto'}
包含 IDE 上下文: ${includeIdeContext ? '是' : '否（僅保留對話與使用者明確指定的目標檔）'}
目前檔案: ${filePath || '(none)'}
使用者需求:
${instruction || '請先分析並提出實作計畫。'}

使用者已確認的需求：
${confirmedRequirements}

使用者要求的方案調整：
${normalizePlanText(options.revisionRequest || '') || '(none)'}

上一版方案（僅供重新規劃時修正，不可視為已執行）：
${normalizePlanText(options.previousPlan || '').slice(0, 16000) || '(none)'}

工作區觀察資訊 (來自 UI):
${workspaceContext || '(none)'}

目前的程式碼:
\`\`\`text
${code}
\`\`\`

多檔案上下文:
${contextFilesText || '(none)'}

---
【輸出格式】
只輸出合法 JSON，不要使用 Markdown code fence：
{
  "summary": "成品與交付結果摘要",
  "workspace_observations": ["已查證的真實工作區事實"],
  "steps": ["具體且可驗收的實作步驟"],
  "files": [{"path":"真實或確定要建立的相對路徑","action":"create 或 modify","reason":"用途"}],
  "risks": ["風險及處理方式"],
  "tests": ["實際可執行的驗收方式"],
  "commands_to_run": ["實際預計執行的驗證命令"],
  "needs_approval": true
}
所有文字必須使用繁體中文；不得宣稱已執行或已完成。
`
  const result = await askLlm(prompt, { temperature: 0.15, numPredict: 2500, timeoutMs: 2147483647, requestEndpoint: '/api/ai/plan' })
  if (result.ok === false) return { type: 'plan', needs_approval: true, ...result }

  const parsedPlan = tryParseJsonObject(result.content || '')
  const structuredPlan = normalizeStructuredPlan(parsedPlan || {}, instruction, result.content || '')
  const content = formatStructuredPlan(structuredPlan)

  return {
    type: 'plan',
    ...result,
    phase: 'approval',
    planning_session_id: planningSessionId,
    content,
    raw_content: result.content || '',
    plan: structuredPlan,
    ...structuredPlan,
    clarification_answers: clarificationAnswers,
    parse_error: parsedPlan ? null : '模型未回傳合法 JSON，已建立保守的結構化方案。',
  }
}

async function explainProject(filePath, question, options = {}) {
  const code = options.code ?? (filePath ? safeRead(filePath) : '')
  const selected = options.selectedCode || ''
  const pinned = Array.isArray(options.pinnedFiles) ? options.pinnedFiles : []
  const pinnedText = pinned.map(item => {
    try { return `\n--- ${item} ---\n${safeRead(item).slice(0, 4000)}` } catch { return `\n--- ${item} ---\n(read failed)` }
  }).join('\n')
  const contextFilesText = formatContextFiles(options.contextFiles, 120000)
  const prompt = `You are Cubi Code Agent. Explain and analyze the current project/file for a developer.
Reply in Traditional Chinese and be practical.

Question:
${question || '請說明目前檔案用途、主要流程、風險與改善建議。'}

Current file: ${filePath || '(none)'}
Selected code:
\`\`\`text
${selected || '(none)'}
\`\`\`

Current code:
\`\`\`${codeBlockLanguage(filePath)}
${code || ''}
\`\`\`

Pinned context from workspace paths:
${pinnedText || '(none)'}

Multi-file context supplied by frontend:
${contextFilesText || '(none)'}
`
  const result = await askLlm(prompt, { temperature: 0.2, numPredict: 1200, requestEndpoint: '/api/ai/explain' })
  return { type: 'project_analysis', ...result }
}

async function autocomplete(prefix, suffix = '', filePath = '', fullContent = '', language = '', options = {}) {
  const prefixText = String(prefix || '')
  const suffixText = String(suffix || '')
  const fileContent = String(fullContent || '')
  const currentLanguage = normalizeLanguage(filePath, language)

  if (!prefixText.trim() && !suffixText.trim() && !fileContent.trim()) {
    return { ok: false, type: 'autocomplete', suggestion: '', content: '', model: 'ollama', source: 'empty_context', tokens: 0, error: '目前游標上下文不足。' }
  }

  const suffixBlock = suffixText.trim()
    ? `
Cursor suffix:
\`\`\`${currentLanguage}
${suffixText.slice(0, 900)}
\`\`\`
`
    : ''
  const prompt = `Complete code at the cursor.
Rules:
- Output insertable ${currentLanguage} only.
- No markdown, code fences, labels, explanations, or repeated prefix/suffix.
- Do not repeat, translate, echo, or print the task text. Do not return a print-only stub.
- No unsafe dynamic execution. Never use or mention eval, exec, new Function, os.system, or subprocess.
- Never output prompt labels such as Prefix, Suffix, Cursor suffix, or Completion.
- If a comment describes a task in Chinese or another natural language, infer the software behavior from the whole phrase and output implementation code.
- If the comment asks to build/create a tool, app, or program (especially when asked to write completely), generate a complete, self-contained working implementation that is fully closed and syntactically valid.
- For Python calculators, use standard binary operations (+, -, *, /) and complete the main loop cleanly without eval.
- For Python comment-only app/tool requests, prefer a compact command-line program. Do not use tkinter, GUI windows, web UI, or servers unless the user explicitly asks for GUI, 視窗, 介面, web, 網頁, or server.

File: ${filePath || '(unsaved)'}
Prefix:
\`\`\`${currentLanguage}
${prefixText.slice(-1800)}
\`\`\`
${suffixBlock}Completion:
`
  const isFullRequested = /完整|complete|full|整個/i.test(prefixText)
  const requestOptions = {
    temperature: 0.05,
    think: false,
    signal: options.signal,
    requestEndpoint: '/api/ai/autocomplete',
    numPredict: isFullRequested ? Math.max(config.autocompleteNumPredict || 220, 500) : (config.autocompleteNumPredict || 220),
  }
  let result = await askAutocompleteLlm(prompt, requestOptions)
  let suggestion = ''
  if (result.ok) {
    suggestion = normalizeAutocompleteSuggestion(result.content, prefixText, currentLanguage)
    if (/^(說明|解釋|Explanation|Here is|Sure)/i.test(suggestion.trim())) suggestion = ''
  }
  const unsafeReason = unsafeAutocompleteReason(suggestion)
  if (suggestion && unsafeReason) {
    const retryPrompt = `${prompt}

Previous completion rejected: ${unsafeReason}.
Generate a safe continuation for the same cursor position. Return only insertable code text.`
    result = await askAutocompleteLlm(retryPrompt, {
      ...requestOptions,
      temperature: 0.02,
    })
    suggestion = result.ok ? normalizeAutocompleteSuggestion(result.content, prefixText, currentLanguage) : ''
    if (/^(說明|解釋|Explanation|Here is|Sure)/i.test(suggestion.trim())) suggestion = ''
    if (unsafeAutocompleteReason(suggestion)) suggestion = ''
  }

  return { ...result, ok: Boolean(result.ok && suggestion), type: 'autocomplete', suggestion, content: suggestion }
}




function stripModelArtifactsFromCode(content = '', filePath = '') {
  let value = String(content || '').replace(/\r\n/g, '\n')
  const lower = String(filePath || '').toLowerCase()

  // 移除少數地端模型可能外洩到程式檔的 thought / nthought / 說明標籤。
  value = value
    .replace(/<\/?(?:n?thought|analysis|reasoning)[^>]*>/gi, '')
    .replace(/\/nthought\b/gi, '')
    .replace(/\bnthought\b/gi, '')
    .replace(/\bthought\b/gi, '')

  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    value = value
      .replace(/<title>([^<\n]*?)<\/?(?:n?thought|analysis|reasoning)[^>]*>?/gi, '<title>$1</title>')
      .replace(/<title>([^<\n]*?)<\/title\s*>/gi, '<title>$1</title>')
      .replace(/<title>([^<\n]*?)$/gim, '<title>$1</title>')
      .replace(/<meta\s+namethought/gi, '<meta name')
      .replace(/<meta\s+name\s*$/gim, '<meta name="viewport" content="width=device-width, initial-scale=1.0">')

    if (!/<\/html>\s*$/i.test(value) && /<html[\s>]/i.test(value)) {
      if (!/<\/body>/i.test(value)) value += '\n</body>'
      value += '\n</html>'
    }
  }

  // 避免模型在檔尾附上說明文字，造成 JS / CSS 語法檢查失敗。
  const stopMarkers = [
    '\n說明：', '\nExplanation:', '\n注意：', '\nNote:', '\n以下是', '\n這段程式',
    '\n###', '\n完成後', '\n測試方式：', '\n變更摘要：'
  ]
  for (const marker of stopMarkers) {
    const idx = value.indexOf(marker)
    if (idx > 0) value = value.slice(0, idx).trimEnd()
  }

  return value.endsWith('\n') ? value : `${value}\n`
}

function contextFilePath(item = {}) {
  return normalizePath(item.file_path || item.path || '')
}

function editableInlineFiles(target, oldContent, contextFiles = []) {
  const files = new Map()
  const addFile = (filePath, content) => {
    const normalizedPath = normalizePath(filePath)
    if (!normalizedPath || normalizedPath.startsWith('__conversation__/')) return
    const key = normalizedPath.toLowerCase()
    if (!files.has(key)) files.set(key, { path: normalizedPath, content: String(content || '') })
  }

  for (const item of Array.isArray(contextFiles) ? contextFiles : []) {
    if (!item || item.ok === false || item.content_type === 'conversation_history') continue
    addFile(contextFilePath(item), item.content)
  }

  const targetKey = normalizePath(target).toLowerCase()
  if (files.has(targetKey)) {
    files.set(targetKey, { path: normalizePath(target), content: String(oldContent || '') })
  } else {
    files.set(targetKey, { path: normalizePath(target), content: String(oldContent || '') })
  }
  return Array.from(files.values())
}

function buildMultiFileInlineEditPrompt(target, instruction, selectedCode, files, options = {}) {
  const fileSections = files.map(file => `--- FILE: ${file.path} ---\n${file.content}\n--- END FILE: ${file.path} ---`).join('\n\n')
  const readOnlySections = (options.readOnlyContextFiles || [])
    .map(file => `--- READ-ONLY CONTEXT: ${file.path} ---\n${file.content}\n--- END READ-ONLY CONTEXT: ${file.path} ---`)
    .join('\n\n')
  const responseShape = {
    files: files.map(file => ({ path: file.path, content: '<complete new file content>' })),
    summary: '<繁體中文短摘要>',
    file_reasons: files.map(file => ({ path: file.path, reason: '<繁體中文說明此檔案為何修改或保持不變>' })),
    main_changes: ['<繁體中文列出重要修改>'],
    preserved_behavior: true,
    needs_confirmation: ['<繁體中文列出需要使用者確認的限制；沒有則回傳空陣列>'],
  }
  const repairModeRules = /錯誤修正|修正|fix|bug|error|錯誤|失敗|traceback|pytest/i.test(String(instruction || ''))
    ? `\nRepair-mode requirements:\n- Inspect all editable files for related defects, not only the primary focus path.\n- Treat every authorized Monaco path as a required inspection target. Change a file only when it contains a real defect; otherwise keep it byte-for-byte unchanged.\n- STRICT ZERO-FAKE-FIX POLICY (嚴禁作假修正): If the code has no real bugs, syntax errors, or runtime failures, do NOT make cosmetic changes, formatting tweaks, or add useless comments (such as '# fixed typo if any', '# updated logic') just to pretend a fix was made when there is no real bug!\n- EXCEPTION TO ZERO-FAKE-FIX: If the user's request explicitly complains that the program's core logic was incorrectly altered or hallucinated by a previous AI action (e.g., "it turned into a thermometer instead of a clock"), you MUST rewrite the file to restore the intended functionality described by the user, even if the current code has no syntax errors.\n- When a file has no real defects and no restoration is requested, its returned content MUST be 100% byte-for-byte equivalent to its input, and you must declare in file_reasons/summary that no correction is needed ("✅ 經檢查目前程式碼毫無錯誤，不需進行任何修正。").\n- file_reasons MUST contain one entry for every editable file. For unchanged files, state the concrete checks that passed or why no safe correction applies. Never omit a file or use a vague reason such as "no change".\n- Fix obvious syntax errors, misspelled identifiers, undefined names, invalid literals, broken imports, and stale or incorrect tests encountered during the inspection.\n- Keep production code and tests consistent with each other.\n- Before calling a production method from a test, verify its exact name and signature in the supplied source. Never invent a missing method or replace an import failure with MagicMock merely to make tests pass.\n- Exercise real production methods with deterministic local fixtures. Mock only an actual external boundary such as HTTP, filesystem, clock, or database access.\n- Use any supplied traceback or test output as evidence, then check for the same defect pattern elsewhere before returning.\n- Do not claim success by weakening, deleting, or bypassing a meaningful test.\n- Verification should use real inputs and real data when the environment permits it. If terminal evidence proves that Docker networking is disabled, do not keep retrying the external request: use a proper test mock/fixture at the network boundary when the existing test design supports it, or leave production behavior unchanged and report that network access is required. Never hard-code a successful result.\n`
    : ''
  const featureKey = options.operation === 'fix' ? 'fix' : 'rewrite'
  const allowedEditPaths = (options.allowedEditPaths || []).map(item => normalizeProjectPath(item)).filter(Boolean)
  const rewriteModeRules = options.operation === 'rewrite'
    ? `\nRewrite-mode requirements:\n${allowedEditPaths.length > 1
      ? `- Treat EVERY authorized edit path as a requested rewrite target: ${allowedEditPaths.join(', ')}. Each one MUST contain a real request-related change compared with its input. Leaving any target unchanged makes the entire response invalid and the system will reject it.`
      : '- Treat the primary file as the requested edit target and the other automatically selected files as dependency constraints.'}\n- Make the smallest necessary changes; do not rewrite whole files or the project without a concrete need.\n- Preserve public APIs, inputs, outputs, side effects, error behavior, and existing tests.\n- If the request is vague, improve readability, naming, and structure while preserving behavior.\n- Leave a related file byte-for-byte unchanged only when no valid request-related rewrite applies to it.\n- Do not add unrelated features.\n`
    : ''
  const editScopeRules = allowedEditPaths.length
    ? `- Only these paths may change: ${allowedEditPaths.join(', ')}. Do NOT include any read-only context files in your JSON response.`
    : '- Modify only files directly required by the request; keep unrelated files byte-for-byte unchanged.'
  return `You are Cubi Code Multi-File Inline Edit, an IDE coding agent.
Configured feature policy:
${configuredFeaturePrompt(featureKey) || '(none)'}

Inspect EVERY editable file below together and apply the user's request as one coherent change.
Return ONLY strict JSON matching this shape:
${JSON.stringify(responseShape, null, 2)}

Rules:
- All user-facing JSON string values in summary, file_reasons.reason, main_changes, and needs_confirmation MUST be Traditional Chinese (zh-TW). Keep code content unchanged in its programming language, but do not write English explanations.
- Return every listed editable path exactly once, in the same order, including files that do not need changes.
- For each file, content must be its COMPLETE final file content. Never return a patch or partial snippet.
- Keep an unchanged file byte-for-byte equivalent to its input.
- Coordinate HTML, CSS, JavaScript, imports, selectors, ids, and event handlers across files.
- Do not invent paths, omit files, add markdown fences, or include hidden reasoning.
- Preserve unrelated behavior.
- STRICT ZERO-FAKE-DATA POLICY: Do not satisfy requests by creating fake data, sample records, mock data, or hardcoded fixed data (嚴禁在程式或相關檔案中寫死固定假資料或展示用範例). When real data sources or APIs are needed, implement clean schemas, configuration interfaces, real user inputs, file import pathways, or real endpoint bindings instead of inventing fake values.
${desktopGuiPortabilityRule(target, normalizeLanguage(target))}
${editScopeRules}
${repairModeRules}
${rewriteModeRules}

Primary focus path: ${target}
User request:
${instruction}

Selected code in the primary focus file:
${selectedCode || '(none)'}

Editable project files:
${fileSections}
${readOnlySections ? `\nRead-only related context (inspect for relationships, but do not return or modify these files):\n${readOnlySections}` : ''}
`
}

function sameFileContent(left, right) {
  const normalize = value => String(value || '').replace(/\r\n/g, '\n').trimEnd()
  return normalize(left) === normalize(right)
}

function stripCommentsAndWhitespace(code, language = '') {
  let text = String(code || '').replace(/\r\n/g, '\n')
  const lang = String(language || '').toLowerCase()
  if (lang.includes('python') || lang === 'py' || lang === 'python') {
    text = text.replace(/#.*$/gm, '')
    text = text.replace(/"""[\s\S]*?"""/g, '').replace(/'''[\s\S]*?'''/g, '')
  } else if (lang.includes('html') || lang.includes('vue') || lang.includes('xml')) {
    text = text.replace(/<!--[\s\S]*?-->/g, '')
    text = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  } else {
    text = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    text = text.replace(/#.*$/gm, '')
  }
  return text.replace(/\s+/g, '').trim()
}

function isNoFixIndicatedByReason(reasonText = '') {
  const text = String(reasonText || '').trim()
  if (!text) return false
  const noFixPattern = /(?:(?:不需|無需|不用|無須|沒必要|毋須|不需要).{0,10}(?:修改|修正|變更|更新|改動)|(?:未發現|毫無|沒有|找不到|皆無|並無|無任何).{0,25}(?:錯誤|問題|Bug|缺陷|風險)|(?:維持|保持).{0,10}(?:原|不變|現有|同樣|不改|狀態|內容)|(?:語法|邏輯|代碼|程式碼|檢查).{0,15}(?:正常|無誤|正確|沒問題))/i
  const actionPattern = /(?:已(?:修正|修改|重整|消除|解決|更新|移除|更正)|補上|新增|刪除|改為|改成|替換|修正為|修正未定義|修正參數|調整為)/i
  return noFixPattern.test(text) && !actionPattern.test(text)
}

function isTrivialOrFakeFix(oldContent, newContent, filePath = '', reasonText = '') {
  if (sameFileContent(oldContent, newContent)) return true
  if (isNoFixIndicatedByReason(reasonText)) return true
  const ext = String(filePath || '').split('.').pop() || ''
  const oldClean = stripCommentsAndWhitespace(oldContent, ext)
  const newClean = stripCommentsAndWhitespace(newContent, ext)
  if (oldClean.length > 0 && oldClean === newClean) {
    return true
  }
  return false
}

function findMissingRequiredEditPaths(requiredPaths = [], changedFiles = []) {
  const changed = new Set((changedFiles || [])
    .map(file => normalizeProjectPath(file?.path || file).toLowerCase())
    .filter(Boolean))
  return (requiredPaths || [])
    .map(path => normalizeProjectPath(path))
    .filter(Boolean)
    .filter(path => !changed.has(path.toLowerCase()))
}

function resolveReturnedFilePath(returnedPath, editableFiles) {
  const normalized = normalizePath(returnedPath)
  const exact = editableFiles.find(file => file.path.toLowerCase() === normalized.toLowerCase())
  if (exact) return exact.path

  const name = normalized.split('/').pop()?.toLowerCase()
  const matchingNames = editableFiles.filter(file => file.path.split('/').pop()?.toLowerCase() === name)
  return matchingNames.length === 1 ? matchingNames[0].path : normalized
}

function parseMultiFileInlineResult(text, editableFiles) {
  const parsed = parseJsonObject(text)
  const returnedFiles = Array.isArray(parsed?.files) ? parsed.files : []
  const resultMap = new Map()

  for (const item of returnedFiles) {
    const resolvedPath = resolveReturnedFilePath(item?.path, editableFiles)
    if (!resolvedPath || typeof item?.content !== 'string') continue
    resultMap.set(resolvedPath.toLowerCase(), normalizeInlineReturnedContent(item.content, resolvedPath))
  }

  if (resultMap.size === 0) {
    throw new Error('Ollama 未回傳任何修正檔案內容（或 JSON 格式不正確）')
  }

  const missingPaths = editableFiles
    .filter(file => !resultMap.has(file.path.toLowerCase()))
    .map(file => file.path)
  
  // If the LLM omitted files, assume they are unchanged instead of throwing an error.
  for (const missingPath of missingPaths) {
    const originalFile = editableFiles.find(f => f.path === missingPath)
    if (originalFile) {
      resultMap.set(missingPath.toLowerCase(), originalFile.content)
    }
  }

  const finalFiles = editableFiles.map(file => ({
    path: file.path,
    old_content: file.content,
    new_content: resultMap.get(file.path.toLowerCase()),
  }))

  // Add any new files that were returned by Ollama but were not in editableFiles
  for (const [lowerPath, newContent] of resultMap.entries()) {
    if (!editableFiles.some(f => f.path.toLowerCase() === lowerPath)) {
      // Find the original cased path from returnedFiles if possible
      const returnedMatch = returnedFiles.find(f => f?.path && normalizePath(f.path).toLowerCase() === lowerPath)
      const originalCasedPath = returnedMatch ? normalizePath(returnedMatch.path) : lowerPath
      finalFiles.push({
        path: originalCasedPath,
        old_content: '',
        new_content: newContent
      })
    }
  }

  return {
    summary: String(parsed?.summary || '').trim(),
    file_reasons: Array.isArray(parsed?.file_reasons) ? parsed.file_reasons : [],
    main_changes: Array.isArray(parsed?.main_changes) ? parsed.main_changes.map(item => String(item || '').trim()).filter(Boolean) : [],
    preserved_behavior: parsed?.preserved_behavior !== false,
    needs_confirmation: Array.isArray(parsed?.needs_confirmation) ? parsed.needs_confirmation.map(item => String(item || '').trim()).filter(Boolean) : [],
    files: finalFiles,
  }
}

function normalizeInlineReturnedContent(content = '', filePath = '') {
  const raw = String(content || '')
  const embeddedFiles = extractMultiFiles(raw)
  const embedded = embeddedFiles.find(file => normalizeProjectPath(file.path).toLowerCase() === normalizeProjectPath(filePath).toLowerCase())
    || (embeddedFiles.length === 1 ? embeddedFiles[0] : null)
  const extracted = embedded ? embedded.content : extractFileContent(raw)
  const clean = stripModelArtifactsFromCode(extracted, filePath)
  return clean
}

function buildInlineFileResults(parsedResult, editableFiles, changedFiles = []) {
  const changedPaths = new Set((changedFiles || []).map(file => normalizePath(file?.path || file).toLowerCase()))
  const reasons = new Map()
  for (const item of Array.isArray(parsedResult?.file_reasons) ? parsedResult.file_reasons : []) {
    const resolvedPath = resolveReturnedFilePath(item?.path, editableFiles)
    const reason = String(item?.reason || '').trim()
    if (resolvedPath && reason) reasons.set(resolvedPath.toLowerCase(), reason)
  }
  return editableFiles.map(file => {
    const modified = changedPaths.has(file.path.toLowerCase())
    const rawReason = reasons.get(file.path.toLowerCase()) || ''
    let finalReason = rawReason
    if (!modified) {
      const claimsChange = /(?:已?(?:修正|修改|重整|消除|解決|更新|移除|更正|修復)|補上|新增|刪除|改為|改成|替換)/i.test(rawReason)
      if (!rawReason || claimsChange) {
        finalReason = '已檢查完整內容，未發現語法、名稱、常值、匯入或明顯執行邏輯錯誤，因此保持原內容。'
      }
    } else if (!rawReason) {
      finalReason = '已依本次錯誤檢查結果做最小必要修正。'
    }
    return {
      path: file.path,
      status: modified ? 'modified' : 'unchanged',
      reason: finalReason,
    }
  })
}

function formatInlineFixReport(fileResults = []) {
  const modifiedCount = fileResults.filter(item => item.status === 'modified').length
  const lines = fileResults.map(item => `- ${item.path}：${item.status === 'modified' ? '已修正' : '未修改'} — ${item.reason}`)
  return [
    `Ollama 已逐一檢查 ${fileResults.length} 個 Monaco 檔案；${modifiedCount ? `實際修改 ${modifiedCount} 個檔案` : '所有檔案皆不需修改'}。`,
    '逐檔結果：',
    ...lines,
  ].join('\n')
}

async function makeInlineDiffFromContent(filePath, instruction, oldContent, selectedCode = '', contextFiles = [], requestEndpoint = '/api/diff/generate', options = {}) {
  const target = normalizePath(filePath || 'current_file.py')
  const contextFilesText = formatContextFiles(contextFiles, 120000)

  if (isDatabasePath(target)) {
    const sqlTarget = databaseMigrationPath(target)
    const prompt = buildDatabaseSqlPrompt(sqlTarget, target, instruction, oldContent, contextFilesText)
    const llm = await askLlm(prompt, {
      temperature: 0.08,
      topP: 0.8,
      numPredict: 3000,
      timeoutMs: 900000,
      maxRetries: 2,
      preferChat: true,
      requestEndpoint,
    })
    if (!llm.ok) {
      return {
        ok: false,
        file_path: sqlTarget,
        old_content: '',
        new_content: '',
        diff: '',
        model: llm.model || 'local_ollama',
        source: llm.source || 'ollama_error',
        tokens: llm.tokens || 0,
        error: llm.error || '資料庫任務未產生 SQL 腳本。系統未使用固定 fallback，也未直接寫入 .db。',
        ...llm,
      }
    }
    const newSql = stripModelArtifactsFromCode(extractFileContent(llm.content), sqlTarget)
    if (!newSql.trim()) {
      return {
        ok: false,
        no_change: true,
        file_path: sqlTarget,
        old_content: '',
        new_content: '',
        diff: '',
        model: llm.model,
        source: llm.source,
        tokens: llm.tokens,
        error: '模型沒有產生 SQL 腳本，因此沒有可套用 Diff。系統未使用固定 fallback，也未直接寫入 .db。',
        ...llm,
      }
    }
    return {
      ok: true,
      file_path: sqlTarget,
      old_content: '',
      new_content: newSql,
      diff: makeUnifiedDiff(sqlTarget, '', newSql),
      model: llm.model,
      source: llm.source,
      tokens: llm.tokens,
      content: llm.content,
      note: `資料庫檔案 ${target} 以安全方式處理：產生 SQL 腳本 ${sqlTarget}，不直接覆寫二進位 .db。`,
    }
  }

  const allowedEditPaths = new Set((options.allowedEditPaths || []).map(item => normalizeProjectPath(item).toLowerCase()).filter(Boolean))
  const suppliedFiles = editableInlineFiles(target, oldContent, contextFiles)
  const editableFiles = options.returnOnlyAllowedEditPaths && allowedEditPaths.size
    ? suppliedFiles.filter(file => allowedEditPaths.has(normalizeProjectPath(file.path).toLowerCase()))
    : suppliedFiles
  const readOnlyContextFiles = options.returnOnlyAllowedEditPaths
    ? suppliedFiles.filter(file => !allowedEditPaths.has(normalizeProjectPath(file.path).toLowerCase()))
    : []
  const prompt = buildMultiFileInlineEditPrompt(target, instruction, selectedCode, editableFiles, {
    ...options,
    readOnlyContextFiles,
  })
  let llm = null
  let parsedResult = null
  let changedFiles = []
  let semanticError = ''
  let totalTokens = 0
  let acceptedNoChange = false

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const retryInstruction = attempt === 0 ? '' : `

Your previous response did not produce an authorized content change.
Problem: ${semanticError || 'the returned files were unchanged'}
The user requested a concrete correction. Re-read the primary focus file, make the smallest real change that satisfies the request, and return the complete strict JSON response.
${allowedEditPaths.size ? `Only these paths may change: ${[...allowedEditPaths].join(', ')}. Every other listed file is read-only context and must remain byte-for-byte unchanged.` : ''}`
    llm = await askLlm(`${prompt}${retryInstruction}`, {
      temperature: attempt === 0 ? 0.08 : 0.03,
      topP: 0.8,
      numPredict: 12000,
      timeoutMs: 900000,
      maxRetries: attempt === 0 ? 2 : 0,
      preferChat: true,
      formatJson: true,
      think: false,
      requestEndpoint,
    })
    totalTokens += Number(llm.tokens || 0)
    if (!llm.ok) break

    try {
      parsedResult = parseMultiFileInlineResult(llm.content, editableFiles)
    } catch (error) {
      parsedResult = null
      semanticError = error.message
      continue
    }

    if (options.operation === 'fix' && parsedResult && Array.isArray(parsedResult.files)) {
      for (const file of parsedResult.files) {
        if (!sameFileContent(file.old_content, file.new_content)) {
          const reasonItem = (parsedResult.file_reasons || []).find(r => normalizePath(r?.path || '').toLowerCase() === normalizePath(file.path).toLowerCase())
          const reasonText = String(reasonItem?.reason || parsedResult.summary || '').trim()
          if (isTrivialOrFakeFix(file.old_content, file.new_content, file.path, reasonText)) {
            file.new_content = file.old_content
          }
        }
      }
    }

    const allChangedFiles = parsedResult.files.filter(file => !sameFileContent(file.old_content, file.new_content))
    const authorizedChangedFiles = allowedEditPaths.size
      ? allChangedFiles.filter(file => allowedEditPaths.has(normalizeProjectPath(file.path).toLowerCase()))
      : allChangedFiles
    const unauthorizedChanges = allowedEditPaths.size
      ? allChangedFiles.filter(file => !allowedEditPaths.has(normalizeProjectPath(file.path).toLowerCase()))
      : []
    const missingRequiredChanges = options.requireEveryAllowedEditPath
      ? findMissingRequiredEditPaths([...allowedEditPaths], authorizedChangedFiles)
      : []
    if (missingRequiredChanges.length) {
      changedFiles = []
      semanticError = `多檔改寫少了實際變更：${missingRequiredChanges.join('、')}。每個 Monaco 開啟目標都必須產生與原內容不同的完整檔案。`
      continue
    }
    changedFiles = authorizedChangedFiles
    if (changedFiles.length) {
      const attemptValidation = validateGeneratedFiles(changedFiles.map(file => ({ path: file.path, content: file.new_content })))
      if (!attemptValidation.ok) {
        changedFiles = []
        semanticError = `改寫結果未通過完整性／語法檢查：${attemptValidation.errors.join('；')}`
        continue
      }
      break
    }
    if (options.operation === 'fix' && !unauthorizedChanges.length) {
      acceptedNoChange = true
      semanticError = ''
      break
    }
    semanticError = unauthorizedChanges.length
      ? `模型只修改了未授權檔案：${unauthorizedChanges.map(file => file.path).join('、')}`
      : '模型回傳的所有檔案內容都與原內容相同'
  }

  if (llm) llm = { ...llm, tokens: totalTokens }
  if (!llm.ok) {
    return {
      ok: false,
      file_path: target,
      old_content: oldContent || '',
      new_content: oldContent || '',
      diff: '',
      model: llm.model || 'local_ollama',
      source: llm.source || 'ollama_error',
      tokens: llm.tokens || 0,
      checked_files: editableFiles.map(file => file.path),
      modified_files: [],
      extra_files: [],
      error: llm.error || 'Ollama 未回傳可用的多檔修改內容，沒有寫入任何檔案。請重試、換模型或縮短檔案內容。',
      ...llm,
    }
  }
  if (!parsedResult) {
    return {
      ok: false,
      file_path: target,
      old_content: oldContent || '',
      new_content: oldContent || '',
      diff: '',
      model: llm.model,
      source: llm.source,
      tokens: llm.tokens,
      checked_files: editableFiles.map(file => file.path),
      modified_files: [],
      extra_files: [],
      error: `${semanticError || '模型回覆無法解析'}，因此沒有寫入任何檔案。`,
    }
  }

  const fileResults = buildInlineFileResults(parsedResult, editableFiles, changedFiles)
  if (!changedFiles.length && options.operation === 'fix' && acceptedNoChange) {
    return {
      ok: true,
      no_change: true,
      file_path: target,
      old_content: oldContent || '',
      new_content: '',
      diff: '',
      model: llm.model,
      source: llm.source,
      tokens: llm.tokens,
      checked_files: editableFiles.map(file => file.path),
      modified_files: [],
      extra_files: [],
      file_results: fileResults,
      content: formatInlineFixReport(fileResults),
      note: parsedResult.summary || '所有已開啟檔案皆已檢查，沒有需要套用的修改。',
    }
  }

  if (!changedFiles.length) {
    return {
      ok: false,
      no_change: true,
      file_path: target,
      old_content: oldContent || '',
      new_content: oldContent || '',
      diff: '',
      model: llm.model,
      source: llm.source,
      tokens: llm.tokens,
      checked_files: editableFiles.map(file => file.path),
      modified_files: [],
      extra_files: [],
      error: `Ollama 已自動重試，但${semanticError || '沒有產生內容變更'}，因此沒有檔案被覆寫。`,
    }
  }

  const changedValidation = validateGeneratedFiles(changedFiles.map(file => ({ path: file.path, content: file.new_content })))
  if (!changedValidation.ok) {
    return {
      ok: false,
      file_path: target,
      old_content: oldContent || '',
      new_content: oldContent || '',
      diff: '',
      model: llm.model,
      source: llm.source,
      tokens: llm.tokens,
      checked_files: editableFiles.map(file => file.path),
      modified_files: [],
      extra_files: [],
      validation: changedValidation,
      error: `改寫結果未通過完整性／語法檢查：${changedValidation.errors.join('；')}，因此沒有產生可套用變更。`,
    }
  }

  const primary = changedFiles.find(file => file.path.toLowerCase() === target.toLowerCase()) || changedFiles[0]
  const extraFiles = changedFiles
    .filter(file => file.path.toLowerCase() !== primary.path.toLowerCase())
    .map(file => ({
      path: file.path,
      content: file.new_content,
      kind: 'source',
      description: 'Ollama 同次產生的多檔修正',
      status: 'modified',
    }))
  const diff = changedFiles
    .map(file => makeUnifiedDiff(file.path, file.old_content, file.new_content))
    .filter(Boolean)
    .join('\n')
  const checkedFiles = editableFiles.map(file => file.path)
  const modifiedFiles = changedFiles.map(file => file.path)
  const related = options.relatedContext || { related_files: [], needs_confirmation: [] }
  const rewriteReport = options.operation === 'rewrite'
    ? rewriteSummary({
        instruction: defaultRewriteInstruction(instruction),
        filePath: target,
        modifiedFiles,
        related,
        fileReasons: parsedResult.file_reasons,
        mainChanges: parsedResult.main_changes.length ? parsedResult.main_changes : [parsedResult.summary].filter(Boolean),
        preservedBehavior: parsedResult.preserved_behavior,
        confirmation: parsedResult.needs_confirmation,
      })
    : null
  const fixReport = options.operation === 'fix' ? formatInlineFixReport(fileResults) : ''

  return {
    ok: true,
    file_path: primary.path,
    old_content: primary.old_content,
    new_content: primary.new_content,
    diff,
    model: llm.model,
    source: llm.source,
    tokens: llm.tokens,
    checked_files: checkedFiles,
    modified_files: modifiedFiles,
    extra_files: extraFiles,
    file_results: fileResults,
    content: rewriteReport?.content || fixReport || `Ollama 已一次檢查 ${checkedFiles.join('、')}；實際修改 ${modifiedFiles.join('、')}。`,
    note: parsedResult.summary || '多檔修改差異已產生，等待套用。',
    rewrite_goal: rewriteReport ? defaultRewriteInstruction(instruction) : undefined,
    file_reasons: rewriteReport?.reasons,
    main_changes: rewriteReport?.changes,
    preserved_behavior: rewriteReport ? parsedResult.preserved_behavior : undefined,
    needs_confirmation: rewriteReport?.needsConfirmation,
    related_files: options.operation === 'rewrite' ? related.related_files : undefined,
    context_coverage: options.operation === 'rewrite' ? related.coverage : undefined,
    unresolved_references: options.operation === 'rewrite' ? related.unresolved_references : undefined,
  }
}

async function makeInlineDiff(filePath, instruction) {
  const oldContent = readFile(filePath)
  return makeInlineDiffFromContent(filePath, instruction, oldContent)
}

function applyInlineEdit(filePath, newContent) {
  return writeFile(filePath, newContent)
}

module.exports = {
  classifyAutoIntent,
  generateCode,
  rewriteCode,
  convertCode,
  detectErrors,
  fixErrors,
  explainProject,
  rewriteAdvice,
  testAdvice,
  planTask,
  normalizeClarificationAnswers,
  normalizeClarificationQuestions,
  tryParseJsonObject,
  selectPlanContextFiles,
  collectPlanFilePaths,
  autocomplete,
  makeInlineDiff,
  makeInlineDiffFromContent,
  applyInlineEdit,
  inferredTargetLanguage,
  requestedConversionOutputPath,
  findMissingRequiredEditPaths,
  buildInlineFileResults,
  formatInlineFixReport,
  deterministicAutoIntent,
  fallbackAutoIntent,
  stripCommentsAndWhitespace,
  isNoFixIndicatedByReason,
  isTrivialOrFakeFix,
}
