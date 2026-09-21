const path = require('path')
const { listProjectTree, readFile } = require('../tools/fileTools')

const SOURCE_EXTENSIONS = new Set([
  '.py', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue',
  '.html', '.htm', '.css', '.java', '.cs', '.php', '.go', '.rs',
  '.cpp', '.c', '.h', '.hpp',
])
const CONTEXT_EXTENSIONS = new Set([
  ...SOURCE_EXTENSIONS,
  '.json', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.xml', '.properties', '.md', '.txt',
])
const CONFIG_NAMES = new Set([
  'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.js', 'vite.config.ts',
  'requirements.txt', 'pyproject.toml', 'pytest.ini', 'setup.cfg', 'pom.xml', 'build.gradle',
  'composer.json', 'dockerfile', 'docker-compose.yml', 'docker-compose.yaml', '.env.example',
])
const SKIPPED_DIRECTORIES = /(^|\/)(?:node_modules|\.git|\.venv|venv|dist|build|coverage|__pycache__|\.pytest_cache)(\/|$)/i

function normalizeProjectPath(value = '') {
  const clean = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim()
  const normalized = path.posix.normalize(clean)
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) return ''
  return normalized
}

function isContextFile(filePath = '') {
  const normalized = normalizeProjectPath(filePath)
  if (!normalized || normalized.startsWith('__conversation__/') || SKIPPED_DIRECTORIES.test(normalized)) return false
  const base = path.posix.basename(normalized).toLowerCase()
  return CONFIG_NAMES.has(base) || CONTEXT_EXTENSIONS.has(path.posix.extname(base).toLowerCase()) || /(^|\/)tests?\//i.test(normalized)
}

function isTestPath(filePath = '') {
  const normalized = normalizeProjectPath(filePath).toLowerCase()
  const base = path.posix.basename(normalized)
  return /(^|\/)tests?\//.test(normalized) || /(?:^test_|_test\.|\.test\.|\.spec\.)/.test(base)
}

function isConfigPath(filePath = '') {
  const normalized = normalizeProjectPath(filePath).toLowerCase()
  const base = path.posix.basename(normalized)
  return CONFIG_NAMES.has(base) || /(?:^|\/)(?:config|settings?)(?:[./_-]|$)/.test(normalized) || /\.(?:ya?ml|toml|ini|cfg|properties)$/.test(base)
}

function sourceLooksBrowserLocal(source = '') {
  return /file_system_access|browser_file_input|local_tree|edited_memory/i.test(String(source || ''))
}

function sameContent(left, right) {
  return String(left || '').replace(/\r\n/g, '\n').trimEnd() === String(right || '').replace(/\r\n/g, '\n').trimEnd()
}

function shouldReadBackendWorkspace(contextFiles, filePath, code, backendPaths) {
  if ((contextFiles || []).some(item => sourceLooksBrowserLocal(item?.source))) return false
  if ((contextFiles || []).some(item => item?.source === 'backend')) return true
  const activePath = normalizeProjectPath(filePath)
  if (!activePath || !backendPaths.has(activePath.toLowerCase())) return false
  try {
    const workspaceContent = readFile(activePath)
    const suppliedCode = String(code || '').trim()
    return !suppliedCode || sameContent(workspaceContent, suppliedCode) || (suppliedCode.length >= 40 && workspaceContent.includes(suppliedCode))
  } catch {
    return false
  }
}

function addCandidate(candidates, candidatePath, content, source = 'request_context') {
  const normalized = normalizeProjectPath(candidatePath)
  if (!isContextFile(normalized)) return
  const key = normalized.toLowerCase()
  const record = { path: normalized, content: String(content ?? ''), source }
  const existing = candidates.get(key)
  if (!existing || record.content.length > existing.content.length || source === 'active_editor') candidates.set(key, record)
}

function loadCandidates({ filePath = '', code = '', contextFiles = [], includeWorkspace = true } = {}) {
  const candidates = new Map()
  for (const item of Array.isArray(contextFiles) ? contextFiles : []) {
    if (!item || item.ok === false || item.encoding === 'base64' || item.content_type === 'conversation_history') continue
    addCandidate(candidates, item.file_path || item.path, item.content, item.source || 'request_context')
  }

  const activePath = normalizeProjectPath(filePath)
  if (activePath) addCandidate(candidates, activePath, code, 'active_editor')

  let backendTree = []
  if (includeWorkspace) {
    try {
      backendTree = listProjectTree().filter(item => item.type === 'file' && isContextFile(item.path))
    } catch {
      backendTree = []
    }
  }
  const backendPaths = new Set(backendTree.map(item => normalizeProjectPath(item.path).toLowerCase()))
  const usesBackendWorkspace = includeWorkspace && shouldReadBackendWorkspace(contextFiles, activePath, code, backendPaths)
  if (usesBackendWorkspace) {
    let totalChars = 0
    for (const item of backendTree.slice(0, 400)) {
      if (totalChars >= 4_000_000) break
      try {
        const content = readFile(item.path)
        if (content.length > 300_000) continue
        addCandidate(candidates, item.path, content, 'backend_workspace')
        totalChars += content.length
      } catch {
        // Binary, oversized, or concurrently removed files are not usable context.
      }
    }
  }

  return {
    candidates: [...candidates.values()],
    coverage: usesBackendWorkspace ? 'backend_workspace' : 'request_context',
    workspaceFileCount: usesBackendWorkspace ? backendTree.length : 0,
  }
}

function extractFileReferences(content = '', filePath = '') {
  const references = new Set()
  const text = String(content || '')
  const patterns = [
    /(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+[^'";]*?\s+from\s+|require\s*\(|import\s*\(|include(?:_once)?\s*\(?|require(?:_once)?\s*\(?)\s*['"]([^'"]+)['"]/g,
    /<(?:script|link)[^>]+(?:src|href)=["']([^"']+)["']/gi,
    /(?:from|import)\s+([.\w/]+)/g,
  ]
  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const value = String(match[1] || '').trim().replace(/[?#].*$/, '')
      if (value && !/^(?:https?:|data:|node:)/i.test(value)) references.add(value)
    }
  }

  const extension = path.posix.extname(filePath).toLowerCase()
  if (extension === '.css') {
    let match
    const cssPattern = /url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/gi
    while ((match = cssPattern.exec(text)) !== null) {
      if (!/^(?:https?:|data:)/i.test(match[1])) references.add(match[1].replace(/[?#].*$/, ''))
    }
  }
  return [...references]
}

function candidatePathsForReference(reference, fromPath) {
  const cleanRef = String(reference || '').replace(/\\/g, '/').replace(/^~\//, '').trim()
  if (!cleanRef) return []
  const fromDir = path.posix.dirname(fromPath) === '.' ? '' : path.posix.dirname(fromPath)
  const base = cleanRef.startsWith('.') ? path.posix.join(fromDir, cleanRef) : cleanRef.replace(/^\/+/, '')
  const normalized = normalizeProjectPath(base)
  if (!normalized) return []
  const extension = path.posix.extname(normalized)
  const variants = [normalized]
  if (!extension) {
    for (const ext of SOURCE_EXTENSIONS) variants.push(`${normalized}${ext}`)
    for (const ext of SOURCE_EXTENSIONS) variants.push(`${normalized}/index${ext}`)
    variants.push(`${normalized}/__init__.py`)
  }
  return [...new Set(variants.map(normalizeProjectPath).filter(Boolean))]
}

function resolveReference(reference, fromPath, projectPaths) {
  const variants = candidatePathsForReference(reference, fromPath)
  for (const variant of variants) {
    const exact = projectPaths.find(filePath => filePath.toLowerCase() === variant.toLowerCase())
    if (exact) return exact
  }

  const cleanRef = String(reference || '').replace(/^\.+\//, '').replace(/\./g, '/').toLowerCase()
  const tail = cleanRef.split('/').filter(Boolean).slice(-2).join('/')
  if (!tail) return ''
  const suffixMatches = projectPaths.filter(filePath => {
    const noExtension = filePath.replace(/\.[^/.]+$/, '').toLowerCase()
    return noExtension === cleanRef || noExtension.endsWith(`/${cleanRef}`) || noExtension.endsWith(`/${tail}`)
  })
  return suffixMatches.length === 1 ? suffixMatches[0] : ''
}

function extractApiPaths(content = '') {
  const paths = new Set()
  let match
  const pattern = /["'`]((?:https?:\/\/[^/"'`]+)?\/(?:api\/)?[A-Za-z0-9_./:{}-]+)["'`]/g
  while ((match = pattern.exec(String(content || ''))) !== null) {
    const value = match[1].replace(/^https?:\/\/[^/]+/i, '').replace(/\{[^}]+\}/g, ':param')
    if (value.length > 1) paths.add(value)
  }
  return [...paths]
}

function declaredSymbols(content = '') {
  const symbols = new Set()
  let match
  const pattern = /\b(?:class|function|def|interface|type|enum)\s+([A-Za-z_$][\w$]{3,})|\b(?:const|let|var)\s+([A-Za-z_$][\w$]{3,})\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)?\s*=>/g
  while ((match = pattern.exec(String(content || ''))) !== null) symbols.add(match[1] || match[2])
  return [...symbols].slice(0, 30)
}

function instructionPaths(instruction = '') {
  return [...new Set((String(instruction || '').match(/[A-Za-z0-9_.@+\/-]+\.(?:py|js|mjs|cjs|jsx|ts|tsx|vue|html?|css|java|cs|php|json|ya?ml|toml|ini|xml)\b/gi) || [])
    .map(normalizeProjectPath)
    .filter(Boolean))]
}

function relatedFileScore(active, candidate, projectPaths, instruction = '') {
  if (candidate.path.toLowerCase() === active.path.toLowerCase()) {
    return { score: 1000, reasons: ['使用者目前提供或選取的主要程式碼'] }
  }

  let score = 0
  const reasons = []
  const add = (points, reason) => {
    score += points
    if (!reasons.includes(reason)) reasons.push(reason)
  }

  for (const reference of extractFileReferences(active.content, active.path)) {
    if (resolveReference(reference, active.path, projectPaths)?.toLowerCase() === candidate.path.toLowerCase()) {
      add(100, `主要檔案直接引用 ${reference}`)
    }
  }
  for (const reference of extractFileReferences(candidate.content, candidate.path)) {
    if (resolveReference(reference, candidate.path, projectPaths)?.toLowerCase() === active.path.toLowerCase()) {
      add(85, '此檔案引用主要檔案或其模組')
    }
  }

  const activeBase = path.posix.basename(active.path).replace(/\.[^/.]+$/, '').toLowerCase()
  const candidateBase = path.posix.basename(candidate.path).replace(/\.[^/.]+$/, '').toLowerCase()
  if (isTestPath(candidate.path) && (candidateBase.includes(activeBase) || candidate.content.toLowerCase().includes(activeBase))) {
    add(90, '對應主要程式的測試檔')
  }
  if (activeBase && candidateBase === activeBase) add(45, '檔名相同的對應元件或樣式檔')

  const activeApis = extractApiPaths(active.content)
  const candidateApis = extractApiPaths(candidate.content)
  const sharedApi = activeApis.find(apiPath => candidateApis.includes(apiPath) || candidate.content.includes(apiPath))
  if (sharedApi) add(80, `共用 API 路徑 ${sharedApi}`)

  const symbol = declaredSymbols(active.content).find(name => candidate.content.includes(name))
  if (symbol) add(35, `使用主要檔案宣告的 ${symbol}`)

  const explicit = instructionPaths(instruction).find(requested => {
    const lower = requested.toLowerCase()
    return candidate.path.toLowerCase() === lower || candidate.path.toLowerCase().endsWith(`/${lower}`)
  })
  if (explicit) add(120, '使用者需求明確提及此檔案')

  if (isConfigPath(candidate.path)) {
    const activeExtension = path.posix.extname(active.path).toLowerCase()
    const configName = path.posix.basename(candidate.path).toLowerCase()
    const relevantConfig =
      (['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue'].includes(activeExtension) && /package\.json|tsconfig|vite|webpack/.test(configName)) ||
      (activeExtension === '.py' && /requirements|pyproject|pytest|setup\.cfg/.test(configName)) ||
      (activeExtension === '.java' && /pom\.xml|build\.gradle/.test(configName)) ||
      (activeExtension === '.php' && configName === 'composer.json')
    if (relevantConfig) add(25, '影響主要程式依賴或建置的設定檔')
  }

  return { score, reasons }
}

function unresolvedReferences(active, projectPaths) {
  return extractFileReferences(active.content, active.path)
    .filter(reference => reference.startsWith('.') && !resolveReference(reference, active.path, projectPaths))
    .slice(0, 8)
}

function collectRelatedContext(options = {}) {
  const maxFiles = Math.max(1, Number(options.maxFiles || 16))
  const maxChars = Math.max(1000, Number(options.maxChars || 100000))
  const loaded = loadCandidates(options)
  const activePath = normalizeProjectPath(options.filePath)
  let active = loaded.candidates.find(file => file.path.toLowerCase() === activePath.toLowerCase())
  if (!active && activePath) active = { path: activePath, content: String(options.code || ''), source: 'active_editor' }
  if (!active) {
    return {
      files: [], related_files: [], coverage: loaded.coverage, scanned_files: loaded.candidates.length,
      unresolved_references: [], needs_confirmation: ['沒有可辨識的主要檔案路徑，無法判斷跨檔案關聯。'],
    }
  }

  const projectPaths = loaded.candidates.map(file => file.path)
  const ranked = loaded.candidates
    .map(file => ({ ...file, ...relatedFileScore(active, file, projectPaths, options.instruction) }))
    .filter(file => file.path.toLowerCase() === active.path.toLowerCase() || file.score > 0)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))

  const selected = []
  let remainingChars = maxChars
  for (const file of ranked) {
    if (selected.length >= maxFiles || remainingChars <= 200) break
    const content = String(file.content || '')
    const included = content.slice(0, Math.min(content.length, 30000, remainingChars))
    selected.push({
      file_path: file.path,
      content: included,
      source: file.source,
      reason: file.reasons.join('；') || '主要檔案',
      score: file.score,
      truncated: included.length < content.length,
      original_chars: content.length,
      content_mode: included.length < content.length ? 'excerpt' : 'full',
    })
    remainingChars -= included.length + file.path.length + 80
  }

  const unresolved = unresolvedReferences(active, projectPaths)
  const needsConfirmation = []
  if (loaded.coverage !== 'backend_workspace') {
    needsConfirmation.push('目前只能從本次請求已提供的檔案判斷關聯；未提供的瀏覽器本機檔案無法由後端直接讀取。')
  }
  if (unresolved.length) needsConfirmation.push(`下列相對引用在可用上下文中找不到：${unresolved.join('、')}`)

  return {
    files: selected,
    related_files: selected.map(file => ({ file_path: file.file_path, reason: file.reason, score: file.score, source: file.source })),
    coverage: loaded.coverage,
    scanned_files: loaded.candidates.length,
    workspace_files: loaded.workspaceFileCount,
    unresolved_references: unresolved,
    needs_confirmation: needsConfirmation,
  }
}

const LANGUAGE_BY_EXTENSION = {
  '.py': 'Python', '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.jsx': 'JavaScript',
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.java': 'Java', '.cs': 'C#', '.php': 'PHP',
  '.html': 'HTML / CSS / JS', '.htm': 'HTML / CSS / JS', '.css': 'CSS', '.vue': 'Vue / JavaScript',
  '.go': 'Go', '.rs': 'Rust', '.cpp': 'C++', '.c': 'C',
}

function detectSourceLanguage(code = '', filePath = '') {
  const text = String(code || '')
  if (/(^|\n)\s*(?:from\s+[\w.]+\s+import|import\s+[\w.]+(?:\s+as\s+\w+)?\s*(?:#.*)?$|def\s+\w+\s*\(|class\s+\w+\s*[:(])/m.test(text)) return 'Python'
  if (/\b(?:interface|type)\s+\w+|:\s*(?:string|number|boolean)\b/.test(text)) return 'TypeScript'
  if (/\b(?:const|let|var|function)\b|=>|require\s*\(/.test(text)) return 'JavaScript'
  if (/\bpublic\s+(?:static\s+)?class\b|System\.out\.println/.test(text)) return 'Java'
  if (/\bnamespace\s+\w+|Console\.WriteLine/.test(text)) return 'C#'
  if (/<\?php|\$[A-Za-z_]\w*\s*=/.test(text)) return 'PHP'
  if (/<(?:!doctype|html|body|script|style)\b/i.test(text)) return 'HTML / CSS / JS'
  const extensionLanguage = LANGUAGE_BY_EXTENSION[path.posix.extname(normalizeProjectPath(filePath)).toLowerCase()]
  if (extensionLanguage) return extensionLanguage
  return '未知（需人工確認）'
}

function targetExtension(targetLanguage = '') {
  const target = String(targetLanguage || '').toLowerCase()
  if (target.includes('typescript')) return '.ts'
  if (target.includes('javascript') || target === 'js') return '.js'
  if (target.includes('python')) return '.py'
  if (target === 'java' || target.includes(' java')) return '.java'
  if (target.includes('c#') || target.includes('csharp')) return '.cs'
  if (target.includes('php')) return '.php'
  if (target.includes('html')) return '.html'
  if (target.includes('go')) return '.go'
  if (target.includes('rust')) return '.rs'
  return ''
}

function convertedFilePath(filePath = '', targetLanguage = '') {
  const normalized = normalizeProjectPath(filePath || 'converted')
  const extension = targetExtension(targetLanguage) || '.txt'
  const directory = path.posix.dirname(normalized) === '.' ? '' : path.posix.dirname(normalized)
  const originalStem = path.posix.basename(normalized).replace(/\.[^/.]+$/, '') || 'converted'
  const stem = ['.java', '.cs'].includes(extension)
    ? originalStem.replace(/(^|[-_\s]+)([a-zA-Z0-9])/g, (_, __, char) => char.toUpperCase())
    : originalStem
  return directory ? `${directory}/${stem}${extension}` : `${stem}${extension}`
}

function conversionDifferences(sourceLanguage, targetLanguage) {
  const source = String(sourceLanguage || '')
  const target = String(targetLanguage || '')
  const differences = [`語法與模組引用由 ${source} 改為 ${target} 的慣用寫法。`]
  const manual = []
  if (/Python/.test(source) && /Java|C#/.test(target)) {
    differences.push('動態型別會改為明確型別、類別與進入點結構。')
    manual.push('請確認型別、第三方套件與例外處理是否符合目標執行環境。')
  } else if (/JavaScript|TypeScript|HTML/.test(source) && /Python|Java|C#/.test(target)) {
    differences.push('事件迴圈、非同步流程或瀏覽器 API 需要映射到目標語言執行環境。')
    manual.push('若原程式依賴 DOM、瀏覽器事件或 npm 套件，需人工確認替代框架或套件。')
  } else if (/Python|Java|C#|PHP/.test(source) && /JavaScript|TypeScript/.test(target)) {
    differences.push('同步流程、型別與標準函式庫會映射到 JavaScript 執行模型。')
    manual.push('請確認執行環境是瀏覽器或 Node.js，以及相依套件的替代方案。')
    if (/Python/.test(source)) {
      differences.push('Python 的 async def / await 會轉為 JavaScript 的 async function / await；asyncio coroutine 會改由 Promise 與 Node.js event loop 排程。')
      manual.push('Python 套件與 FastAPI middleware 不會自動等價於 npm／Express 套件；請確認錯誤處理、取消、timeout 與 blocking I/O 邊界。')
    }
  }
  return { differences, manual }
}

module.exports = {
  collectRelatedContext,
  detectSourceLanguage,
  convertedFilePath,
  conversionDifferences,
  normalizeProjectPath,
  extractFileReferences,
}
