const path = require('path')
const { runTests } = require('../tools/testRunner')

function normalizeRelativePath(filePath = '') {
  const clean = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '')
  const normalized = path.posix.normalize(clean)
  if (!normalized || normalized === '..' || normalized.startsWith('../')) return ''
  return normalized
}

function contextFileMap(contextFiles = []) {
  const files = new Map()
  for (const item of Array.isArray(contextFiles) ? contextFiles : []) {
    const filePath = normalizeRelativePath(item?.file_path || item?.path || '')
    if (!filePath || item?.ok === false || item?.encoding === 'base64') continue
    files.set(filePath, String(item?.content ?? ''))
  }
  return files
}

function canonicalProjectPath(candidate, projectFiles = [], allowMissing = false) {
  const normalized = normalizeRelativePath(String(candidate || '').replace(/^\/workspace\//i, ''))
  if (!normalized) return ''
  const exact = projectFiles.find(filePath => filePath.toLowerCase() === normalized.toLowerCase())
  if (exact) return exact
  const suffixMatches = projectFiles.filter(filePath => normalized.toLowerCase().endsWith(`/${filePath.toLowerCase()}`))
  if (suffixMatches.length === 1) return suffixMatches[0]
  return allowMissing ? normalized : ''
}

function extractErrorLocations(test = {}, projectFiles = []) {
  const output = `${test.stderr || ''}\n${test.stdout || ''}`
  const lines = output.split(/\r?\n/)
  const locations = new Map()
  const add = (filePath, line, column, evidence, allowMissing = true) => {
    if (filePath.startsWith('/') && !filePath.startsWith('/workspace/')) return
    if (/^[a-zA-Z]:[\\/]/.test(filePath)) return
    if (filePath.includes('node_modules/') || filePath.includes('site-packages/')) return

    const canonical = canonicalProjectPath(filePath, projectFiles, allowMissing)
    if (!canonical) return
    const key = `${canonical.toLowerCase()}:${Number(line) || 0}`
    if (locations.has(key)) return
    locations.set(key, {
      path: canonical,
      line: Number(line) || null,
      column: Number(column) || null,
      reason: String(evidence || '').trim().replace(/^E\s+/, '').slice(0, 400) || '測試輸出指出此檔案',
    })
  }

  for (let index = 0; index < lines.length; index += 1) {
    const lineText = lines[index]
    let match = lineText.match(/File\s+["'](?:\/workspace\/)?([^"']+)["'],\s+line\s+(\d+)/i)
    if (match) add(match[1], match[2], null, lines[index + 1] || lineText, true)

    const pathPattern = /(?:\/workspace\/)?([A-Za-z0-9_.@+ ()-]+(?:\/[A-Za-z0-9_.@+ ()-]+)*\.(?:py|js|mjs|cjs|ts|tsx|jsx|vue|html?|css|json)):(\d+)(?::(\d+))?/gi
    while ((match = pathPattern.exec(lineText)) !== null) {
      add(match[1], match[2], match[3], lineText, true)
    }

    match = lineText.match(/(?:ERROR collecting|FAILED|FAIL)\s+(.+?\.(?:py|js|mjs|cjs|ts|tsx|jsx|vue|html?|css|json))(?::|\s|$)/i)
    if (match) add(match[1], null, null, lineText, true)

    match = lineText.match(/(?:引用的|不存在或未載入[：:]\s*|缺少|找不到)\s*["']?([^\s"'<>]+\.(?:js|mjs|cjs|ts|tsx|jsx|vue|html?|css|json|py))["']?/i)
    if (match) add(match[1], null, null, lineText, true)
  }
  return [...locations.values()]
}

function resolvePythonImports(filePath, content, projectFiles) {
  const found = new Set()
  const fileDirectory = path.posix.dirname(filePath) === '.' ? '' : path.posix.dirname(filePath)
  const imports = []
  const fromPattern = /^\s*from\s+([.\w]+)\s+import\s+/gm
  const importPattern = /^\s*import\s+([\w.]+)/gm
  let match
  while ((match = fromPattern.exec(content)) !== null) imports.push(match[1])
  while ((match = importPattern.exec(content)) !== null) imports.push(match[1])

  for (const moduleName of imports) {
    const leadingDots = (moduleName.match(/^\.+/) || [''])[0].length
    const moduleParts = moduleName.slice(leadingDots).split('.').filter(Boolean)
    const baseParts = fileDirectory.split('/').filter(Boolean)
    if (leadingDots) baseParts.splice(Math.max(0, baseParts.length - leadingDots + 1))
    const modulePath = [...baseParts, ...moduleParts].join('/')
    const candidates = [`${modulePath}.py`, `${modulePath}/__init__.py`, `${moduleParts.join('/')}.py`, `${moduleParts.join('/')}/__init__.py`]
    let matchFound = false
    for (const candidate of candidates) {
      const canonical = canonicalProjectPath(candidate, projectFiles, false)
      if (canonical) {
        found.add(canonical)
        matchFound = true
        break
      }
    }
    if (!matchFound && candidates.length) {
      const missingCanonical = canonicalProjectPath(candidates[0], projectFiles, true)
      if (missingCanonical) found.add(missingCanonical)
    }
  }
  return [...found]
}

function resolveJavaScriptImports(filePath, content, projectFiles) {
  const found = new Set()
  const baseDirectory = path.posix.dirname(filePath) === '.' ? '' : path.posix.dirname(filePath)
  const importPattern = /(?:from\s*|import\s*\(|require\s*\()\s*["'](\.{1,2}\/[^"']+)["']/g
  let match
  while ((match = importPattern.exec(content)) !== null) {
    const base = normalizeRelativePath(path.posix.join(baseDirectory, match[1]))
    const candidates = [base, ...['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.json'].map(extension => `${base}${extension}`), ...['index.js', 'index.ts', 'index.vue'].map(name => `${base}/${name}`)]
    let matchFound = false
    for (const candidate of candidates) {
      const canonical = canonicalProjectPath(candidate, projectFiles, false)
      if (canonical) {
        found.add(canonical)
        matchFound = true
        break
      }
    }
    if (!matchFound && candidates.length) {
      const preferred = /\.[A-Za-z0-9]+$/.test(base) ? base : (candidates[1] || base)
      const missingCanonical = canonicalProjectPath(preferred, projectFiles, true)
      if (missingCanonical) found.add(missingCanonical)
    }
  }
  return [...found]
}

function resolveHtmlImports(filePath, content, projectFiles) {
  const found = new Set()
  const baseDirectory = path.posix.dirname(filePath) === '.' ? '' : path.posix.dirname(filePath)
  const scriptOrLinkPattern = /(?:<script[^>]+src=|(?:<link[^>]+href=))\s*["']([^"']+)["']/gi
  let match
  while ((match = scriptOrLinkPattern.exec(content)) !== null) {
    const target = match[1].split('?')[0].split('#')[0]
    if (!target || /^https?:\/\//i.test(target) || /^data:/i.test(target)) continue
    const base = normalizeRelativePath(path.posix.join(baseDirectory, target))
    const canonical = canonicalProjectPath(base, projectFiles, true)
    if (canonical) found.add(canonical)
  }
  return [...found]
}

function relatedProjectFiles(test = {}, contextFiles = [], activeFile = '') {
  const projectFiles = Array.isArray(test.project_files) ? test.project_files.map(normalizeRelativePath).filter(Boolean) : []
  const contentFiles = contextFileMap(contextFiles)
  const errors = extractErrorLocations(test, projectFiles)
  const related = new Map()
  const add = (filePath, reason) => {
    const canonical = canonicalProjectPath(filePath, projectFiles, true)
    if (!canonical || related.has(canonical.toLowerCase())) return
    related.set(canonical.toLowerCase(), { path: canonical, reason })
  }

  for (const error of errors) add(error.path, error.line ? `測試錯誤定位於第 ${error.line} 行` : '測試輸出指出此檔案')
  const commandText = [test.command, ...(test.commands || [])].join(' ')
  for (const filePath of projectFiles) {
    if ((/(^|\/)tests?\//i.test(filePath) || /(^|\/)pytest\.ini$/i.test(filePath)) && commandText.includes(filePath)) {
      add(filePath, '本次實際執行的測試檔案')
    }
  }

  const importRoots = [...related.values()].map(item => item.path)
  for (const filePath of importRoots) {
    const content = contentFiles.get(filePath) || ''
    const lower = filePath.toLowerCase()
    let importedFiles = []
    if (lower.endsWith('.py')) {
      importedFiles = resolvePythonImports(filePath, content, projectFiles)
    } else if (/\.(html?|htm)$/.test(lower)) {
      importedFiles = resolveHtmlImports(filePath, content, projectFiles)
    } else {
      importedFiles = resolveJavaScriptImports(filePath, content, projectFiles)
    }
    for (const importedFile of importedFiles) add(importedFile, `${filePath} 直接引用的相關檔案`)
  }

  for (const filePath of projectFiles) {
    const lower = path.posix.basename(filePath).toLowerCase()
    if (['requirements.txt', 'package.json', 'pytest.ini', 'pyproject.toml'].includes(lower)) {
      add(filePath, '專案依賴或測試設定')
    }
  }
  if (!related.size && activeFile) add(activeFile, '目前作用中的檔案；測試未提供可解析路徑')
  return { errors, related: [...related.values()] }
}

function detectNetworkLimitation(test = {}) {
  const output = `${test.stderr || ''}\n${test.stdout || ''}`
  const networkError = /network is unreachable|temporary failure in name resolution|name or service not known|could not resolve host|failed to establish a new connection|connection(?:error|refused|reset)|read timed out|connect timeout|failed to get ticker|possibly delisted|curl error|yfinance/i.test(output)
  const networkDisabled = test.sandbox?.network === 'none' || (test.checks || []).some(check => check.sandbox?.network === 'none')
  const isolatedDocker = test.sandbox?.isolated === true && Boolean(test.sandbox?.engine)
  const externalServiceError = /could not resolve host|failed to get ticker|guce\.yahoo\.com|yfinance|curl error|possibly delisted/i.test(output)
  if (!networkError || (!networkDisabled && !(isolatedDocker && externalServiceError))) return null
  return {
    code: networkDisabled ? 'sandbox_network_disabled' : 'sandbox_external_network_failure',
    message: '目前 Docker 隔離沙盒無法連到真實 API、yfinance 或外部網址。這不是來源程式碼修復題；請改用明確的 mock 測試資料，或在可連網環境驗證真實資料。',
    should_retry: false,
  }
}

function detectGuiDisplayLimitation(test = {}) {
  const output = `${test.stderr || ''}\n${test.stdout || ''}`
  const isolatedDocker = test.sandbox?.isolated === true && Boolean(test.sandbox?.engine)
  const guiError = /no display detected|tkinter requires a gui environment|no display name and no \$?DISPLAY environment variable|could(?:n't| not) connect to display|cannot open display|_tkinter\.TclError/i.test(output)
  if (!isolatedDocker || !guiError) return null
  return {
    code: 'sandbox_gui_display_unavailable',
    message: '目前 Python Tkinter/桌面 GUI 程式需要視窗環境，但 Docker 隔離沙盒沒有可直接使用的桌面顯示。這不是來源程式碼修復題；請改用 GUI 預覽模式或在 Windows 主機直接執行。',
    should_retry: false,
  }
}

function isTargetOnlyFixRequest(task = '', target = '') {
  const instruction = String(task || '')
  if (!/(?:只(?:要|能|准)?修改|僅(?:能|可)?修改|限定修改|不要修改其他|不得修改其他|不可修改其他)/i.test(instruction)) return false
  const targetName = path.posix.basename(normalizeRelativePath(target))
  if (!targetName) return true
  return instruction.toLowerCase().includes(targetName.toLowerCase()) || !/\b[\w.-]+\.(?:py|js|mjs|cjs|ts|tsx|jsx|vue|html?|css|json)\b/i.test(instruction)
}

async function inspectProjectFix(task, filePath, code, contextFiles, options = {}) {
  const target = normalizeRelativePath(filePath || 'current_file')
  const targetOnly = isTargetOnlyFixRequest(task, target)
  const test = await runTests(target, code, null, contextFiles, {
    ...options,
    projectWide: true,
    preferProjectTests: true,
    validateTargetRuntime: true,
    targetOnly,
  })
  const located = relatedProjectFiles(test, contextFiles, target)
  const errors = targetOnly
    ? located.errors.filter(item => item.path.toLowerCase() === target.toLowerCase())
    : located.errors
  const related = targetOnly
    ? [{ path: target, reason: '使用者明確限定只能修改此檔案' }]
    : located.related
  const environmentLimitation = detectNetworkLimitation(test) || detectGuiDisplayLimitation(test)
  return {
    type: 'project_fix_inspection',
    mode: 'fix_error',
    ok: test.ok === true,
    passed: test.ok === true,
    task: String(task || ''),
    project_files: test.project_files || [],
    project_types: test.project_types || [],
    target_file: target,
    target_only: targetOnly,
    editable_files: targetOnly ? [target] : related.map(item => item.path),
    target_runtime_validated: test.target_runtime_validated === true,
    target_implementation_validated: test.target_implementation_validated === true,
    commands: test.commands || [test.command].filter(Boolean),
    checks: test.checks || [],
    error_files: errors,
    related_files: related,
    environment_limited: Boolean(environmentLimitation),
    environment_limitation: environmentLimitation,
    test,
  }
}

module.exports = {
  inspectProjectFix,
  extractErrorLocations,
  relatedProjectFiles,
  detectNetworkLimitation,
  detectGuiDisplayLimitation,
  isTargetOnlyFixRequest,
  resolvePythonImports,
  resolveJavaScriptImports,
  resolveHtmlImports,
}
