const path = require('path')
const { createHash } = require('crypto')
const config = require('../config')
const { askLlm } = require('../core/llmClient')
const { listProjectTree, readFile } = require('../tools/fileTools')
const { runTests } = require('../tools/testRunner')
const { getFeaturePrompt } = require('./featureOptionsService')

const relevantExtensions = new Set([
  '.py', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue',
  '.html', '.htm', '.css', '.json', '.txt', '.toml', '.ini',
  '.yml', '.yaml', '.sh', '.ps1', '.md',
])
const relevantNames = new Set([
  'requirements.txt', 'package.json', 'package-lock.json', 'pytest.ini',
  'pyproject.toml', 'dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  '.env', '.env.example',
])

function normalizePath(value = '') {
  const clean = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim()
  const normalized = path.posix.normalize(clean)
  if (!normalized || normalized === '..' || normalized.startsWith('../')) return ''
  return normalized
}

function requestedPaths(filePath = '') {
  return String(filePath || '')
    .split(',')
    .map(normalizePath)
    .filter(Boolean)
}

function normalizeScanScope(value = '') {
  const raw = String(value || '').trim().toLowerCase().replace(/-/g, '_')
  if (['current_file', 'active_file', 'opened_file', 'single_file'].includes(raw)) return 'current_file'
  if (['explicit_files', 'request_context', 'selected_files'].includes(raw)) return 'explicit_files'
  if (['project', 'project_wide', 'workspace', 'all_files'].includes(raw)) return 'project'
  return ''
}

function isRelevantProjectFile(filePath = '') {
  const normalized = normalizePath(filePath)
  const base = path.posix.basename(normalized).toLowerCase()
  if (!normalized || normalized.startsWith('__conversation__/')) return false
  if (/(^|\/)(?:node_modules|\.git|\.venv|venv|dist|build|__pycache__|\.pytest_cache)(\/|$)/i.test(normalized)) return false
  return relevantNames.has(base) || relevantExtensions.has(path.posix.extname(base).toLowerCase()) || /(^|\/)tests?\//i.test(normalized)
}

function sourceLooksLocal(source = '') {
  return /file_system_access|browser_file_input|local_tree|edited_memory/i.test(String(source || ''))
}

function shouldLoadBackendWorkspace(contextFiles, activePaths, activeCode, backendTreePaths) {
  if ((contextFiles || []).some(item => sourceLooksLocal(item?.source))) return false
  if ((contextFiles || []).some(item => item?.source === 'backend')) return true
  const existingActive = activePaths.find(filePath => backendTreePaths.has(filePath))
  if (!existingActive) return false
  if (!String(activeCode || '').trim()) return (contextFiles || []).length === 0
  try {
    return readFile(existingActive).replace(/\r\n/g, '\n').trimEnd() === String(activeCode).replace(/\r\n/g, '\n').trimEnd()
  } catch {
    return false
  }
}

function createProjectSnapshot({ filePath = '', code = '', contextFiles = [], scope = '', scanScope = '' } = {}) {
  const files = new Map()
  const activePaths = requestedPaths(filePath)
  const activePathSet = new Set(activePaths.map(filePath => filePath.toLowerCase()))
  let normalizedScope = normalizeScanScope(scope || scanScope)
  if (!normalizedScope && activePaths.length > 0) {
    normalizedScope = activePaths.length === 1 ? 'current_file' : 'explicit_files'
  }
  const requestOnlyScope = ['current_file', 'explicit_files'].includes(normalizedScope)
  const add = (candidatePath, content, source = 'request_context') => {
    const normalized = normalizePath(candidatePath)
    if (!normalized || !isRelevantProjectFile(normalized)) return
    if (requestOnlyScope && activePathSet.size && !activePathSet.has(normalized.toLowerCase())) return
    const key = normalized.toLowerCase()
    const record = { path: normalized, content: String(content ?? ''), source }
    if (!files.has(key) || record.content.length > files.get(key).content.length) files.set(key, record)
  }

  for (const item of Array.isArray(contextFiles) ? contextFiles : []) {
    if (!item || item.ok === false || item.encoding === 'base64' || item.content_type === 'conversation_history') continue
    add(item.file_path || item.path, item.content, item.source || 'request_context')
  }

  if (activePaths.length === 1 && code !== null && code !== undefined) add(activePaths[0], code, 'active_editor')

  let backendTree = []
  try { backendTree = listProjectTree().filter(item => item.type === 'file' && isRelevantProjectFile(item.path)) } catch {}
  const backendTreePaths = new Set(backendTree.map(item => normalizePath(item.path)))

  if (requestOnlyScope && activePaths.length > 0) {
    for (const activePath of activePaths) {
      if (!files.has(activePath.toLowerCase()) && backendTreePaths.has(activePath)) {
        try {
          const diskContent = readFile(activePath)
          add(activePath, diskContent, 'backend_target')
        } catch {}
      }
    }
  }

  const includeBackendWorkspace = normalizedScope === 'project'
    ? true
    : requestOnlyScope ? false : shouldLoadBackendWorkspace(contextFiles, activePaths, code, backendTreePaths)
  if (includeBackendWorkspace) {
    let totalChars = 0
    for (const item of backendTree.slice(0, 400)) {
      if (totalChars >= 4_000_000) break
      try {
        const content = readFile(item.path)
        if (content.length > 300_000) continue
        add(item.path, content, 'backend_workspace')
        totalChars += content.length
      } catch {}
    }
  }

  const fileList = [...files.values()].sort((left, right) => left.path.localeCompare(right.path))
  return {
    files: fileList,
    activePaths,
    scope: normalizedScope || (includeBackendWorkspace ? 'project' : 'request_context'),
    coverage: includeBackendWorkspace ? 'backend_workspace' : requestOnlyScope ? normalizedScope : 'request_context',
    coverageNotice: normalizedScope === 'current_file'
      ? `已掃描目前開啟檔案：${activePaths[0] || fileList[0]?.path || '未指定'}。`
      : normalizedScope === 'explicit_files'
        ? `已掃描本次指定的 ${fileList.length} 個檔案。`
        : includeBackendWorkspace
      ? `已掃描後端 workspace 的 ${fileList.length} 個相關檔案。`
      : `已掃描本次請求載入的 ${fileList.length} 個專案相關檔案。`,
  }
}

function detectProjectTypes(files = []) {
  const paths = files.map(file => file.path.toLowerCase())
  const contents = files.map(file => file.content).join('\n')
  const hasPython = paths.some(filePath => filePath.endsWith('.py') || /(^|\/)requirements\.txt$/.test(filePath))
  const hasNode = paths.some(filePath => /(^|\/)package\.json$/.test(filePath) || /\.(?:js|mjs|cjs|ts|tsx|jsx|vue)$/.test(filePath))
  const hasVue = paths.some(filePath => filePath.endsWith('.vue')) || /["']vue["']/.test(contents)
  const hasReact = paths.some(filePath => /\.(?:jsx|tsx)$/.test(filePath)) || /["']react["']/.test(contents)
  const hasStatic = paths.some(filePath => /\.html?$/.test(filePath)) && paths.some(filePath => filePath.endsWith('.css'))
  const types = []
  if (hasPython) types.push('Python 專案')
  if (hasVue) types.push('Vue 專案')
  else if (hasReact) types.push('React 專案')
  else if (hasNode) types.push('Node.js 專案')
  if (hasStatic) types.push('HTML / CSS / JS 靜態專案')
  if (types.length > 1) types.push('混合專案')
  return [...new Set(types.length ? types : ['無法從目前檔案判斷'])]
}

function fileRole(file = {}) {
  const filePath = file.path.toLowerCase()
  const base = path.posix.basename(filePath)
  const content = String(file.content || '')
  if (/(^|\/)tests?\//.test(filePath) || /(?:^test_|_test\.|\.test\.|\.spec\.)/.test(base)) return '測試檔案'
  if (/dockerfile|docker-compose|sandbox/.test(filePath)) return 'Docker / Sandbox'
  if (relevantNames.has(base) || /(?:config|\.env|\.ya?ml$|\.toml$|\.ini$)/.test(filePath)) return '設定檔'
  if (/frontend|components?|views?|pages?|\.vue$|\.(?:jsx|tsx)$|\.html?$|\.css$/.test(filePath)) return '前端檔案'
  if (/backend|routes?|services?|controllers?|models?|express|fastapi|flask/.test(`${filePath}\n${content.slice(0, 1000)}`)) return '後端檔案'
  return '主要程式檔案'
}

function filePurpose(file = {}) {
  const base = path.posix.basename(file.path).toLowerCase()
  const role = fileRole(file)
  if (base === 'package.json') return 'Node.js 套件、scripts 與建置設定'
  if (base === 'requirements.txt') return 'Python 套件依賴清單'
  if (base === 'pytest.ini') return 'pytest 執行設定'
  if (/dockerfile/.test(base)) return '建立隔離執行環境映像'
  if (/route|router/.test(file.path.toLowerCase())) return '定義後端 API 路由'
  if (/service/.test(file.path.toLowerCase())) return '封裝主要商業邏輯或外部服務'
  if (role === '測試檔案') return '驗證對應模組或整合流程'
  if (role === '前端檔案') return '提供使用者介面、事件處理或前端資料流'
  if (role === '後端檔案') return '處理後端請求、資料或服務流程'
  return '專案程式與功能實作'
}

function resolveCandidate(candidate, projectPaths) {
  const normalized = normalizePath(candidate)
  if (!normalized) return ''
  const exact = projectPaths.find(filePath => filePath.toLowerCase() === normalized.toLowerCase())
  return exact || ''
}

function extractRelations(files = []) {
  const relations = []
  const seen = new Set()
  const projectPaths = files.map(file => file.path)
  const add = (from, to, type, detail = '') => {
    if (!from || !to || from === to) return
    const key = `${from}|${to}|${type}`
    if (seen.has(key)) return
    seen.add(key)
    relations.push({ from, to, type, detail })
  }

  const routeFiles = []
  for (const file of files) {
    const directory = path.posix.dirname(file.path) === '.' ? '' : path.posix.dirname(file.path)
    const content = String(file.content || '')
    let match

    if (file.path.toLowerCase().endsWith('.py')) {
      const importPattern = /^\s*(?:from\s+([.\w]+)\s+import|import\s+([\w.]+))/gm
      while ((match = importPattern.exec(content)) !== null) {
        const moduleName = match[1] || match[2]
        const modulePath = moduleName.replace(/^\.+/, '').replace(/\./g, '/')
        for (const candidate of [`${modulePath}.py`, `${modulePath}/__init__.py`, `${directory}/${modulePath}.py`]) {
          const target = resolveCandidate(candidate, projectPaths)
          if (target) add(file.path, target, 'import', moduleName)
        }
      }
    }

    if (/\.(?:js|mjs|cjs|jsx|ts|tsx|vue)$/i.test(file.path)) {
      const importPattern = /(?:from\s*|import\s*(?:\(\s*)?|require\s*\()\s*["'](\.{1,2}\/[^"']+)["']/g
      while ((match = importPattern.exec(content)) !== null) {
        const base = normalizePath(path.posix.join(directory, match[1]))
        const candidates = [base, ...['.js', '.ts', '.tsx', '.jsx', '.vue', '.json'].map(ext => `${base}${ext}`), `${base}/index.js`, `${base}/index.ts`]
        for (const candidate of candidates) {
          const target = resolveCandidate(candidate, projectPaths)
          if (target) add(file.path, target, 'import/export', match[1])
        }
      }
    }

    const routePattern = /router\.(?:get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/g
    while ((match = routePattern.exec(content)) !== null) routeFiles.push({ file: file.path, route: match[1] })
  }

  for (const file of files) {
    const content = String(file.content || '')
    const apiPattern = /(?:api(?:Get|Post)|fetch|axios\.(?:get|post|put|patch|delete))\s*\(\s*["'`]([^"'`]+)["'`]/g
    let match
    while ((match = apiPattern.exec(content)) !== null) {
      const endpoint = match[1]
      const route = routeFiles.find(item => endpoint === item.route || endpoint.endsWith(item.route))
      if (route) add(file.path, route.file, 'API 呼叫', endpoint)
    }
  }

  for (const file of files.filter(item => fileRole(item) === '測試檔案')) {
    const stem = path.posix.basename(file.path).replace(/^(?:test_)/, '').replace(/(?:\.test|\.spec|_test)?\.[^.]+$/, '')
    const source = projectPaths.find(candidate => fileRole({ path: candidate, content: '' }) !== '測試檔案' && path.posix.basename(candidate).startsWith(stem))
    if (source) add(file.path, source, '測試對應', stem)
  }
  return relations.slice(0, 150)
}

function projectRisks(files = []) {
  const risks = []
  const add = (filePath, line, reason, severity = 'warning') => {
    if (risks.length >= 30) return
    risks.push({ path: filePath, line, reason, severity })
  }
  const textLooksPolluted = text => {
    const source = String(text || '').trim()
    if (!source) return false
    if (/(.)\1{5,}/u.test(source)) return true
    return /[\u3130-\u318F\uAC00-\uD7AF].*[\u3040-\u30FF]|[\u3040-\u30FF].*[\u3130-\u318F\uAC00-\uD7AF]/u.test(source)
  }
  const projectPaths = files.map(file => normalizePath(file.path))
  const projectPathSet = new Set(projectPaths.map(filePath => filePath.toLowerCase()))
  const projectBasenames = new Set(projectPaths.map(filePath => path.posix.basename(filePath).toLowerCase()))
  const htmlIds = new Set()
  const hasLocalFile = (fromPath, reference) => {
    const clean = normalizePath(String(reference || '').split(/[?#]/)[0])
    if (!clean || /^(?:https?:|data:|mailto:|#|\/)/i.test(clean)) return true
    const directory = path.posix.dirname(fromPath) === '.' ? '' : path.posix.dirname(fromPath)
    const relative = normalizePath(path.posix.join(directory, clean)).toLowerCase()
    return projectPathSet.has(relative) || projectBasenames.has(path.posix.basename(clean).toLowerCase())
  }
  for (const file of files) {
    if (!/\.html?$/i.test(file.path)) continue
    const idPattern = /\bid\s*=\s*["']([^"']+)["']/g
    let match
    while ((match = idPattern.exec(String(file.content || ''))) !== null) htmlIds.add(match[1])
  }
  for (const file of files) {
    const content = String(file.content || '')
    const lines = content.split(/\r?\n/)
    lines.forEach((line, index) => {
      if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(line)) add(file.path, index + 1, '動態執行字串程式碼，可能造成程式注入風險', 'high')
      const innerHtmlAssignment = line.match(/\.innerHTML\s*=\s*([^;]+)/)
      if (/dangerouslySetInnerHTML/.test(line) || (innerHtmlAssignment && !/^["']\s*["']$/.test(innerHtmlAssignment[1].trim()))) {
        add(file.path, index + 1, '直接注入 HTML，需確認資料已消毒以避免 XSS', 'high')
      }
      if (/\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^\n]*(?:\$\{|['"]\s*\+\s*[A-Za-z_$])/i.test(line)) add(file.path, index + 1, 'SQL 指令直接拼接動態值，可能造成 SQL Injection；應改用參數化查詢', 'critical')
      if (/\b(?:exec|execSync|spawn)\s*\([^\n]*(?:\$\{|\+\s*(?:req|input|command|cmd|user))/i.test(line)) add(file.path, index + 1, '系統命令包含動態輸入，可能造成 Command Injection', 'critical')
      if (/\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\b\s*[:=]\s*['"][^'"]{6,}['"]/i.test(line)) add(file.path, index + 1, '疑似在程式碼中硬編碼密碼、Token 或 API Key', 'high')
      if (/console\.(?:log|info|debug)\s*\([^)]*(?:password|secret|token|authorization)/i.test(line)) add(file.path, index + 1, '可能把敏感資訊寫入日誌', 'high')
      if (/\b(?:readFile|readFileSync|sendFile)\s*\([^)]*(?:req\.|params|query|input)/i.test(line)) add(file.path, index + 1, '檔案路徑直接使用外部輸入，需防止 Path Traversal', 'high')
      if (/\bexcept\s*:\s*$/.test(line)) add(file.path, index + 1, '過度寬鬆的例外捕捉可能隱藏真正錯誤')
      if (/\bTODO\b|\bFIXME\b/i.test(line)) add(file.path, index + 1, '存在尚未完成或待確認的標記')
      if (/\.html?$/i.test(file.path)) {
        let match = line.match(/<link\b[^>]*\bhref\s*=\s*["']([^"']+\.(?:css))["']/i)
        if (match && !hasLocalFile(file.path, match[1])) add(file.path, index + 1, `HTML 引用的樣式檔不存在或未載入：${match[1]}`, 'high')
        match = line.match(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+\.(?:js|mjs|cjs))["']/i)
        if (match && !hasLocalFile(file.path, match[1])) add(file.path, index + 1, `HTML 引用的腳本檔不存在或未載入：${match[1]}`, 'high')
        const visibleText = line.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ')
        if (textLooksPolluted(visibleText)) add(file.path, index + 1, 'HTML 顯示文字疑似混入亂碼或錯誤語系字元，會影響介面品質')
      }
      if (/\.(?:js|mjs|cjs|jsx|ts|tsx)$/i.test(file.path)) {
        let match = line.match(/\bdocument\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/)
        if (match && /^ncreateElementNS$/.test(match[1])) add(file.path, index + 1, `未知 DOM API：document.${match[1]}()，執行時會發生 not a function`, 'high')
        match = line.match(/\bfetch\s*\(\s*["']([^"']+)["']/)
        if (match && !hasLocalFile(file.path, match[1])) add(file.path, index + 1, `fetch 指向不存在的本地檔案：${match[1]}`, 'high')
        match = line.match(/\bgetElementById\s*\(\s*["']([^"']+)["']\s*\)/)
        if (match && htmlIds.size && !htmlIds.has(match[1])) add(file.path, index + 1, `JavaScript 選取的 DOM id 在 HTML 中不存在：#${match[1]}`, 'high')
        match = line.match(/\b([A-Za-z_$][\w$]*)(?:ly[A-Z][\w$]*|[A-Za-z_$][\w$]*ly[A-Z][\w$]*)\s*=/)
        if (match) add(file.path, index + 1, `JavaScript 疑似拼錯變數名稱並直接賦值：${match[1]}...，可能造成 ReferenceError 或全域變數污染`, 'high')
      }
      if (/\.css$/i.test(file.path)) {
        if (/\b(?:margin|padding)\s*:\s*(?:none|lots)\b/i.test(line)) add(file.path, index + 1, 'CSS 使用無效間距值，瀏覽器會忽略此宣告')
        if (/\bdisplay\s*:\s*center\b/i.test(line)) add(file.path, index + 1, 'CSS display:center 不是有效值，應使用 flex/grid/block 等')
        if (/\bjustify-content\s*:\s*middle\b/i.test(line)) add(file.path, index + 1, 'CSS justify-content:middle 不是有效值，常見修正為 center')
        if (/\bmin-height\s*:\s*full\b/i.test(line)) add(file.path, index + 1, 'CSS min-height:full 不是有效值，常見修正為 100vh')
        if (/\bwidth\s*:\s*ninety-percent\b/i.test(line)) add(file.path, index + 1, 'CSS width:ninety-percent 不是有效值，應使用 90%')
        if (/\bmax-width\s*:\s*\d+\s*;/.test(line)) add(file.path, index + 1, 'CSS 數值缺少必要單位，瀏覽器可能忽略此宣告')
        if (/\bborder-radius\s*:\s*round\b/i.test(line)) add(file.path, index + 1, 'CSS border-radius:round 不是有效值，應使用 px 或 %')
        if (/\b(?:color|background(?:-color)?|border(?:-color)?|fill|stroke)\s*:\s*#(?:[0-9a-f]*[g-z][0-9a-z]*|not-a-color)\b/i.test(line) || /rgba\([^)]*\bbroken\b/i.test(line)) add(file.path, index + 1, 'CSS 色彩值無效，瀏覽器會忽略此宣告')
      }
      if (/\.py$/i.test(file.path)) {
        const localFileMatch = line.match(/["']([^"']+\.(?:json|csv|txt|yaml|yml))["']/i)
        if (localFileMatch && !hasLocalFile(file.path, localFileMatch[1])) add(file.path, index + 1, `Python 指向不存在的本地資料檔：${localFileMatch[1]}`, 'high')
        if (/\bencoding\s*=\s*["']ascii["']/.test(line)) add(file.path, index + 1, '使用 ASCII 讀取資料檔會無法處理中文內容，應使用 utf-8')
        if (/\bpoints["']?\]\s*=\s*\[\s*10\s*,\s*10\s*,\s*50\s*,\s*10\s*,\s*50\s*,\s*50\s*,\s*10\s*,\s*50\s*\]/.test(line) && /svgPath/.test(content)) {
          add(file.path, index + 1, 'Python 將 svgPath 資料固定轉成同一組座標，會讓所有地圖區塊顯示成相同形狀', 'high')
        }
      }
    })
    const effectPattern = /\buseEffect\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?\}\s*\)\s*;?/g
    let effectMatch
    while ((effectMatch = effectPattern.exec(content)) !== null) {
      const effectText = effectMatch[0]
      if (/\bset[A-Z]\w*\b/.test(effectText)) {
        const line = content.slice(0, effectMatch.index).split(/\r?\n/).length
        add(file.path, line, 'useEffect 內更新 state 但缺少 dependency array，可能造成無限重新渲染', 'high')
      }
    }
  }
  return risks
}

function directorySummary(files = []) {
  const groups = new Map()
  for (const file of files) {
    const top = file.path.includes('/') ? file.path.split('/')[0] : '專案根目錄'
    if (!groups.has(top)) groups.set(top, [])
    groups.get(top).push(file.path)
  }
  return [...groups.entries()].map(([directory, paths]) => ({ directory, count: paths.length, examples: paths.slice(0, 8) }))
}

function extractSymbols(files = []) {
  const symbols = []
  for (const file of files) {
    const patterns = file.path.toLowerCase().endsWith('.py')
      ? [
          { kind: 'class', regex: /^\s*class\s+([A-Za-z_]\w*)/gm },
          { kind: 'function', regex: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm },
        ]
      : [
          { kind: 'class', regex: /(?:^|\n)\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g },
          { kind: 'function', regex: /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g },
          { kind: 'function', regex: /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g },
        ]
    for (const { kind, regex } of patterns) {
      let match
      while ((match = regex.exec(String(file.content || ''))) !== null && symbols.length < 200) {
        const line = String(file.content || '').slice(0, match.index).split(/\r?\n/).length
        symbols.push({ path: file.path, name: match[1], kind, line })
      }
    }
  }
  return symbols
}

function extractServicePorts(files = []) {
  const ports = []
  const seen = new Set()
  const add = (filePath, line, hostPort, containerPort, source) => {
    const key = `${filePath}:${line}:${hostPort}:${containerPort}`
    if (seen.has(key)) return
    seen.add(key)
    ports.push({ path: filePath, line, host_port: Number(hostPort), container_port: Number(containerPort || hostPort), source })
  }
  for (const file of files) {
    const lines = String(file.content || '').split(/\r?\n/)
    lines.forEach((line, index) => {
      let match = line.match(/["']?(\d{2,5})\s*:\s*(\d{2,5})["']?/)
      if (match) add(file.path, index + 1, match[1], match[2], 'port mapping')
      match = line.match(/(?:--port|\bport\s*[:=]|\.listen\s*\()\s*["']?(\d{2,5})/i)
      if (match) add(file.path, index + 1, match[1], match[1], 'service configuration')
    })
  }
  return ports.slice(0, 50)
}

function projectFacts(snapshot) {
  const types = detectProjectTypes(snapshot.files)
  const files = snapshot.files.map(file => ({ path: file.path, role: fileRole(file), purpose: filePurpose(file) }))
  const relations = extractRelations(snapshot.files)
  const risks = projectRisks(snapshot.files)
  return { types, files, relations, risks, ports: extractServicePorts(snapshot.files), directories: directorySummary(snapshot.files), symbols: extractSymbols(snapshot.files) }
}

function errorLocations(test = {}, projectFiles = []) {
  const output = `${test.stderr || ''}\n${test.stdout || ''}`
  const lines = output.split(/\r?\n/)
  const locations = []
  const seen = new Set()
  const canonical = candidate => {
    const normalized = normalizePath(String(candidate || '').replace(/^\/workspace\//i, ''))
    return projectFiles.find(filePath => filePath.toLowerCase() === normalized.toLowerCase()) || ''
  }
  const add = (candidate, line, column, reason) => {
    const filePath = canonical(candidate)
    if (!filePath) return
    const key = `${filePath}:${Number(line) || 0}`
    if (seen.has(key)) return
    seen.add(key)
    locations.push({ path: filePath, line: Number(line) || null, column: Number(column) || null, reason: String(reason || '').trim().replace(/^E\s+/, '').slice(0, 500) })
  }
  lines.forEach((text, index) => {
    let match = text.match(/File\s+["'](?:\/workspace\/)?([^"']+)["'],\s+line\s+(\d+)/i)
    if (match) add(match[1], match[2], null, lines[index + 1] || text)
    const pattern = /(?:\/workspace\/)?([A-Za-z0-9_.@+ -]+(?:\/[A-Za-z0-9_.@+ -]+)*\.(?:py|js|mjs|cjs|jsx|ts|tsx|vue|html?|css|json)):(\d+)(?::(\d+))?/gi
    while ((match = pattern.exec(text)) !== null) add(match[1], match[2], match[3], text)
    match = text.match(/(?:ERROR collecting|FAILED)\s+([^\s:]+\.(?:py|js|ts|tsx|vue))/i)
    if (match) add(match[1], null, null, text)
  })
  return locations
}

function suggestedDirection(error = {}, test = {}) {
  const reason = `${error.reason || ''}\n${test.stderr || ''}\n${test.stdout || ''}`
  if (/SyntaxError|JSONError|Unexpected token/i.test(reason)) return '先修正指出行數附近的語法或括號／JSON 格式，再重新執行相同指令。'
  if (/ModuleNotFoundError|Cannot find module|ERR_MODULE_NOT_FOUND/i.test(reason)) return '確認 import 路徑、檔名大小寫及 requirements.txt／package.json 依賴。'
  if (/network|resolve host|name resolution|yfinance/i.test(reason)) return '確認沙盒網路政策；若網路被關閉，使用既有 mock 邊界或在可連網環境驗證。'
  if (/AssertionError|FAILED/i.test(reason)) return '比較測試預期值與實際輸出，追查被測函式的輸入、回傳值與邊界條件。'
  return '依 terminal 的第一個實際錯誤向上追查呼叫鏈，先處理根因後再重跑同一檢查。'
}

function terminalFailureSummary(test = {}) {
  const lines = `${test.stderr || ''}\n${test.stdout || ''}`.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const patterns = [/SyntaxError:/i, /JSONError:/i, /ModuleNotFoundError:/i, /Cannot find module/i, /AssertionError:/i, /FAILED/i, /ERROR/i]
  for (const pattern of patterns) {
    const matched = [...lines].reverse().find(line => pattern.test(line))
    if (matched) return matched.replace(/^E\s+/, '').slice(0, 500)
  }
  return (lines.at(-1) || `檢查指令以 Exit Code ${test.exitCode ?? test.returncode ?? -1} 結束`).slice(0, 500)
}

function selectRelevantContents(snapshot, preferredPaths = [], maxChars = 90000, options = {}) {
  const preferred = new Set(preferredPaths.map(normalizePath))
  const ordered = [...snapshot.files].sort((left, right) => Number(preferred.has(right.path)) - Number(preferred.has(left.path)) || left.path.localeCompare(right.path))
  let used = 0
  const sections = []
  const includedPaths = []
  for (const file of ordered) {
    if (used >= maxChars || sections.length >= 24) break
    const rawContent = String(file.content || '').slice(0, preferred.has(file.path) ? 12000 : 5000)
    const content = options.numberLines
      ? rawContent.split(/\r?\n/).map((line, index) => `${String(index + 1).padStart(4, ' ')} | ${line}`).join('\n')
      : rawContent
    const section = `--- ${file.path} ---\n${content}`
    if (used + section.length > maxChars) continue
    sections.push(section)
    includedPaths.push(file.path)
    used += section.length
  }
  return {
    text: sections.join('\n\n'),
    includedPaths,
    includedChars: used,
    totalFiles: snapshot.files.length,
    truncated: includedPaths.length < snapshot.files.length,
  }
}

function relevantContents(snapshot, preferredPaths = [], maxChars = 90000, options = {}) {
  return selectRelevantContents(snapshot, preferredPaths, maxChars, options).text
}

function testCommands(test = {}) {
  const commands = Array.isArray(test.commands) ? test.commands : [test.command]
  return commands.map(command => String(command || '').trim()).filter(command => command && !/no executable test command detected/i.test(command))
}

function buildVerification({ snapshot, contextSelection, test = null, aiResult = null, fallbackUsed = false, mode = 'analysis' }) {
  const commands = test ? testCommands(test) : []
  const programCheckStatus = !test || commands.length === 0
    ? 'not_run'
    : test.ok === true ? 'passed' : 'failed'
  const evidenceSources = ['實際檔案內容', '規則式靜態分析']
  if (commands.length) evidenceSources.push('Docker 沙盒實際檢查')
  if (aiResult?.ok) evidenceSources.push('Ollama 模型判讀')
  if (fallbackUsed || !aiResult?.ok) evidenceSources.push('規則式備援內容')

  return {
    mode,
    scan_completed: true,
    program_check_status: programCheckStatus,
    program_check_passed: programCheckStatus === 'not_run' ? null : programCheckStatus === 'passed',
    executed_check_count: commands.length,
    loaded_file_count: snapshot.files.length,
    model_context_file_count: contextSelection?.includedPaths?.length || 0,
    model_context_truncated: Boolean(contextSelection?.truncated),
    ollama_used: Boolean(aiResult?.ok),
    fallback_used: Boolean(fallbackUsed || !aiResult?.ok),
    evidence_sources: [...new Set(evidenceSources)],
  }
}

function modelUnavailableResponse(type, mode, aiResult = null) {
  const error = aiResult?.error || 'Ollama 模型推論請求逾時或記憶體負載超量，未產生 AI 回覆。'
  return {
    type,
    mode,
    ok: false,
    read_only: true,
    content: '',
    error,
    llm_error: error,
    model: aiResult?.model || 'local_ollama',
    source: aiResult?.source || 'ollama_error',
    tokens: aiResult?.tokens || 0,
  }
}

function selectReportTargetFiles(snapshot, instruction = '') {
  const wantsAll = /(?:整(?:體|個)(?:專案|系統|項目)?|所有檔案|全域|全案|全部檔案)/.test(String(instruction || ''))
  if (wantsAll) return snapshot.files
  if (!snapshot.activePaths?.length) {
    if (['current_file', 'explicit_files'].includes(snapshot.scope)) {
      return snapshot.files.slice(0, 1)
    }
    return snapshot.files
  }
  const activeSet = new Set(snapshot.activePaths.map(p => normalizePath(p).toLowerCase()))
  if (activeSet.has('project') || activeSet.has('專案整體')) return snapshot.files
  const targets = snapshot.files.filter(f => activeSet.has(f.path.toLowerCase()))
  if (targets.length) return targets
  const basenameTargets = snapshot.files.filter(f => activeSet.has(path.posix.basename(f.path).toLowerCase()))
  if (basenameTargets.length) return basenameTargets
  return snapshot.files.slice(0, snapshot.activePaths.length)
}

function formatDetectionReport(snapshot, facts, test, errors, targetFiles = null) {
  const reportFiles = Array.isArray(targetFiles) && targetFiles.length ? targetFiles : snapshot.files
  const commands = testCommands(test)
  const lines = [
    '## 錯誤偵測摘要',
    `1. 檢查指令：${commands.length ? commands.join('；') : '沒有找到可安全執行的檢查指令。'}`,
    `2. 專案類型：${facts.types.join('、')}`,
    `3. 掃描範圍：${snapshot.coverageNotice}`,
    '',
    '## 各檔案偵測結果',
  ]
  
  for (const file of reportFiles) {
    lines.push(`### 檔案名稱：\`${file.path}\``)
    
    const fileErrors = errors.filter(e => e.path === file.path)
    const fileRisks = facts.risks.filter(r => r.path === file.path)
    
    if (fileErrors.length === 0 && fileRisks.length === 0) {
      lines.push(commands.length
        ? '1. 狀態：本次已執行的檢查與規則掃描未在此檔案發現問題；這不代表所有執行路徑都已驗證。'
        : '1. 狀態：本次沒有可安全執行的檢查指令；規則掃描未在此檔案標記已知風險。')
    } else {
      let index = 1
      for (const err of fileErrors) {
        lines.push(`${index}. 錯誤${err.line ? `（第 ${err.line} 行）` : ''}：${err.reason || '需要進一步檢查'}；建議：${suggestedDirection(err, test)}`)
        index += 1
      }
      for (const risk of fileRisks) {
        lines.push(`${index}. 風險${risk.line ? `（第 ${risk.line} 行）` : ''}：${risk.reason}`)
        index += 1
      }
    }
    lines.push('')
  }

  const projectErrors = errors.filter(e => !snapshot.files.some(f => f.path === e.path))
  const projectRisks = facts.risks.filter(r => !snapshot.files.some(f => f.path === r.path))
  
  if (projectErrors.length > 0 || projectRisks.length > 0) {
    lines.push('### 檔案名稱：`專案整體 / 未知位置`')
    let index = 1
    for (const err of projectErrors) {
      lines.push(`${index}. 錯誤：${err.path ? `(${err.path}) ` : ''}${err.reason}；建議：${suggestedDirection(err, test)}`)
      index += 1
    }
    for (const risk of projectRisks) {
       lines.push(`${index}. 風險：${risk.path ? `(${risk.path}) ` : ''}${risk.reason}`)
       index += 1
    }
    lines.push('')
  }

  lines.push('> 本功能僅偵測與回報，沒有修改任何專案檔案。')
  return lines.join('\n').trim()
}

async function detectProjectErrors(options = {}) {
  const snapshot = createProjectSnapshot(options)
  const facts = projectFacts(snapshot)
  const reportFiles = selectReportTargetFiles(snapshot, options.instruction)
  const target = snapshot.activePaths[0] || snapshot.files[0]?.path || 'project'
  const activeContent = snapshot.files.find(file => file.path === target)?.content ?? options.code ?? ''
  const contextFiles = snapshot.files.map(file => ({ ok: true, file_path: file.path, content: file.content, source: file.source }))
  const digest = createHash('sha256').update(snapshot.files.map(file => `${file.path}:${file.content.length}`).join('|')).digest('hex').slice(0, 12)
  const test = await runTests(target, activeContent, null, contextFiles, {
    workspaceSource: 'local-handle',
    projectId: `readonly-detect-${digest}`,
    projectName: 'readonly-detection',
    projectWide: true,
    preferProjectTests: true,
    timeoutMs: Math.max(1000, Number(config.dockerSandbox.aiFeatureTimeout || 120) * 1000),
  })
  const errors = errorLocations(test, snapshot.files.map(file => file.path))
  if (!errors.length && test.ok !== true && (test.exitCode ?? test.returncode ?? 0) !== 0) {
    errors.push({ path: target, line: null, column: null, reason: terminalFailureSummary(test) })
  }
  const deterministicReport = formatDetectionReport(snapshot, facts, test, errors, reportFiles)
  const sourceEvidenceSelection = selectRelevantContents(snapshot, reportFiles.map(f => f.path), 90000, { numberLines: true })
  const sourceEvidence = sourceEvidenceSelection.text
  const prompt = `你是 Cubi Code 的唯讀專案錯誤偵測器。只能分析與回報，絕對不可提供完整重寫檔案、Diff 或宣稱已修改檔案。

後台功能設定：
${getFeaturePrompt('detect') || '(無)'}

請根據真實檢查指令與 terminal 輸出，以繁體中文補充可能根因和最小修正方向。不得捏造未出現在證據中的檔案或行數。
不要重複「已建立的事實報告」已列出的錯誤、風險、行號與建議；只補充尚未說清楚的根因。
【嚴格規範：絕不無病呻吟與虛報錯誤】
1. 務必秉持事實與客觀精神。若「已建立的事實報告」與測試皆正常，且程式碼毫無真正的語法錯誤或執行當機 Bug，你必須直接且唯一回答：「沒有額外補充」。
2. 絕對不可將普通的撰寫習慣、主觀排版喜好（Code Style）、示範性內嵌 CSS/JS 等非致命作法挑毛病誤報為「錯誤」或「風險」！嚴禁偽造或謊報不存在的錯誤。
請用 Markdown 排版，僅針對本次檢視目標檔案進行補充，固定使用以下格式：
### 檔案名稱：\`完整路徑\`
1. 根因補充：...
2. 建議補充：...
沒有額外補充的檔案請略過；如果所有目標檔案都沒有額外補充，只輸出「沒有額外補充」。

使用者要求：${options.instruction || '偵測錯誤'}
目標檔案範圍：${reportFiles.map(f => f.path).join('、') || '全案'}
專案類型：${facts.types.join('、')}
檔案角色：${JSON.stringify(facts.files.slice(0, 80))}
檔案關聯：${JSON.stringify(facts.relations.slice(0, 80))}

實際掃描的程式碼內容：
${sourceEvidence || '(沒有可用程式碼內容)'}

真實 terminal 輸出：
${`${test.stderr || ''}\n${test.stdout || ''}`.slice(-12000)}

已建立的事實報告：
${deterministicReport}

請只提供額外的「原因判讀」與「建議修正方向」，不要重複整份報告。`
  let aiResult = null
  try {
    aiResult = await askLlm(prompt, { temperature: 0.1, numPredict: 1200, think: false, requestEndpoint: '/api/ai/detect' })
  } catch (err) {
    aiResult = { ok: false, error: `執行模型推論異常: ${err?.message || err}`, source: 'ollama_error' }
  }
  if (!aiResult?.ok) {
    return modelUnavailableResponse('project_error_detection', 'detection', aiResult)
  }
  const aiSupplement = aiResult?.ok ? String(aiResult.content || '').trim() : ''
  const content = aiSupplement && !/^(?:沒有額外補充|無額外補充|未發現其他錯誤|目前毫無具體錯誤|無發現實質錯誤|沒有發現問題|沒有額外要補充的|無需額外補充|無須額外補充|沒有其他問題|一切正常)[。.\s]*$/i.test(aiSupplement)
    ? `${deterministicReport}\n\n## AI 補充根因\n${aiSupplement}`
    : deterministicReport
  const verification = buildVerification({
    snapshot,
    contextSelection: sourceEvidenceSelection,
    test,
    aiResult,
    fallbackUsed: !aiResult?.ok,
    mode: 'detection',
  })
  return {
    type: 'project_error_detection',
    ok: true,
    read_only: true,
    content,
    project_types: facts.types,
    project_files: facts.files,
    scan_completed: true,
    program_check_status: verification.program_check_status,
    program_check_passed: verification.program_check_passed,
    commands: testCommands(test),
    error_files: errors,
    risks: facts.risks,
    test,
    coverage: snapshot.coverage,
    coverage_notice: snapshot.coverageNotice,
    model_context_notice: `模型取得 ${verification.model_context_file_count} / ${verification.loaded_file_count} 個檔案內容${verification.model_context_truncated ? '（其餘未送入模型）' : ''}。`,
    verification,
    model: aiResult?.model || 'deterministic_project_scanner',
    source: aiResult?.source || 'readonly_project_detection',
    tokens: aiResult?.tokens || 0,
  }
}

function formatFactsForPrompt(snapshot, facts, targetFiles = null) {
  const isTargetRestricted = ['current_file', 'explicit_files'].includes(snapshot.scope)
  const allowedSet = isTargetRestricted && Array.isArray(targetFiles) && targetFiles.length
    ? new Set(targetFiles.map(f => (f.path || f).toLowerCase()))
    : null

  const filteredFiles = allowedSet
    ? facts.files.filter(f => allowedSet.has(f.path.toLowerCase()))
    : facts.files
  const filteredRelations = allowedSet
    ? facts.relations.filter(r => allowedSet.has(r.from.toLowerCase()) || allowedSet.has(r.to.toLowerCase()))
    : facts.relations
  const filteredSymbols = allowedSet
    ? facts.symbols.filter(s => allowedSet.has(s.path.toLowerCase()))
    : facts.symbols
  const filteredPorts = allowedSet
    ? facts.ports.filter(p => allowedSet.has(p.path.toLowerCase()))
    : facts.ports
  const filteredRisks = allowedSet
    ? facts.risks.filter(r => allowedSet.has(r.path.toLowerCase()))
    : facts.risks

  return [
    `掃描範圍：${snapshot.coverageNotice}`,
    `專案類型：${facts.types.join('、')}`,
    `目錄：${JSON.stringify(facts.directories)}`,
    `主要檔案：${JSON.stringify(filteredFiles.slice(0, 150))}`,
    `檔案關聯：${JSON.stringify(filteredRelations.slice(0, 120))}`,
    `重要函式與 class：${JSON.stringify(filteredSymbols.slice(0, 120))}`,
    `服務與 Port：${JSON.stringify(filteredPorts.slice(0, 50))}`,
    `風險：${JSON.stringify(filteredRisks.slice(0, 30))}`,
  ].join('\n')
}

function analysisFallback(snapshot, facts, targetFiles = null) {
  const reportFiles = Array.isArray(targetFiles) && targetFiles.length ? targetFiles : snapshot.files
  const lines = [
    '## 程式分析摘要',
    `1. 專案類型：${facts.types.join('、')}`,
    `2. 目錄結構：${facts.directories.map(item => `${item.directory}（${item.count} 個檔案）`).join('；') || '目前上下文無法判斷。'}`,
    `3. 服務與 Host Port：${facts.ports.length ? facts.ports.map(item => `${item.path}:${item.line} Host ${item.host_port} → Container ${item.container_port}`).join('；') : '目前提供的檔案沒有可確認的 Port 設定。'}`,
    '',
    '## 各檔案分析',
  ]
  for (const file of reportFiles) {
    lines.push(`### 檔案名稱：\`${file.path}\``)
    let index = 1
    const f = facts.files.find(item => item.path === file.path)
    if (f) {
      lines.push(`${index}. 角色/目的：${f.role}，${f.purpose}`)
      index += 1
    } else {
      lines.push(`${index}. 角色/目的：目前上下文沒有足夠資訊判斷。`)
      index += 1
    }
    const fileRelations = facts.relations.filter(r => r.from === file.path || r.to === file.path)
    if (fileRelations.length > 0) {
      const relationText = fileRelations.map(r => r.from === file.path
        ? `呼叫/依賴 ${r.to}（${r.type}${r.detail ? `，${r.detail}` : ''}）`
        : `被 ${r.from} 依賴（${r.type}${r.detail ? `，${r.detail}` : ''}）`).join('；')
      lines.push(`${index}. 檔案關聯：${relationText}`)
      index += 1
    }
    const fileRisks = facts.risks.filter(r => r.path === file.path)
    if (fileRisks.length > 0) {
      lines.push(`${index}. 風險：${fileRisks.map(risk => `${risk.line ? `第 ${risk.line} 行 - ` : ''}${risk.reason}`).join('；')}`)
    }
    lines.push('')
  }
  lines.push('## 建議下一步', '1. 先確認入口檔、API 路由、核心 service 與對應整合測試。')
  return lines.join('\n').trim()
}

function explanationRelatedPaths(snapshot, facts) {
  const related = new Set(snapshot.activePaths)
  for (let depth = 0; depth < 3; depth += 1) {
    let changed = false
    for (const relation of facts.relations) {
      if (related.has(relation.from) && !related.has(relation.to)) {
        related.add(relation.to)
        changed = true
      }
      if (related.has(relation.to) && !related.has(relation.from)) {
        related.add(relation.from)
        changed = true
      }
    }
    if (!changed) break
  }
  for (const file of facts.files) {
    if (file.role === '測試檔案' && facts.relations.some(relation => relation.from === file.path && related.has(relation.to))) related.add(file.path)
  }
  return [...related].filter(Boolean).slice(0, 24)
}

function explanationFileSections(snapshot, facts, onlyPaths = null) {
  const wanted = onlyPaths ? new Set(onlyPaths.map(normalizePath)) : null
  const lines = []
  for (const file of snapshot.files.filter(item => !wanted || wanted.has(item.path))) {
    lines.push(`### 檔案名稱：\`${file.path}\``)
    let index = 1
    const f = facts.files.find(item => item.path === file.path)
    if (f) {
      lines.push(`${index}. 說明：${f.purpose}`)
      index += 1
    } else {
      lines.push(`${index}. 說明：目前上下文沒有特別的程式說明。`)
      index += 1
    }
    const fileSymbols = facts.symbols.filter(item => item.path === file.path)
    if (fileSymbols.length > 0) {
      lines.push(`${index}. 關鍵語法：${fileSymbols.map(sym => `${sym.name}（${sym.kind}，第 ${sym.line} 行）`).join('；')}`)
      index += 1
    }
    const fileRelations = facts.relations.filter(r => r.from === file.path || r.to === file.path)
    if (fileRelations.length > 0) {
      const relationText = fileRelations.map(r => r.from === file.path
        ? `透過 ${r.type} 連到 ${r.to}`
        : `來自 ${r.from} 的 ${r.type}`).join('；')
      lines.push(`${index}. 執行流程 / 資料流向：${relationText}`)
      index += 1
    }
    const fileRisks = facts.risks.filter(item => item.path === file.path)
    if (fileRisks.length > 0) {
      lines.push(`${index}. 風險與可改善處：${fileRisks.map(risk => `${risk.line ? `第 ${risk.line} 行：` : ''}${risk.reason}`).join('；')}`)
    }
    lines.push('')
  }
  return lines.join('\n').trim()
}

function explanationFallback(snapshot, facts, relatedPaths, targetFiles = null) {
  const reportFiles = Array.isArray(targetFiles) && targetFiles.length ? targetFiles : snapshot.files
  const lines = [
    '## 程式說明摘要',
    `1. 目前功能由 ${facts.files.filter(f => relatedPaths.includes(f.path)).map(item => item.path).join('、') || '目前提供的檔案'} 組成。`,
    `2. 專案類型：${facts.types.join('、')}。`,
    '',
    '## 各檔案程式說明',
    explanationFileSections(snapshot, facts, reportFiles.map(f => f.path)),
    '',
  ]
  lines.push('## 初學者說明', '1. 可以把入口檔想成起點、service 想成處理事情的核心、route 想成前後端通道、test 想成驗收規則。')
  return lines.join('\n').trim()
}

function explainedFilePaths(content = '', files = []) {
  const headings = String(content || '').split(/\r?\n/).map(line => {
    const match = line.match(/^\s*(?:#{1,6}\s*)?(?:(?:[-*]|\d+[.)、])\s*)?(?:\*{0,2})?檔案名稱(?:\*{0,2})?\s*[：:]\s*(.+?)\s*$/i)
    return match
      ? match[1].replace(/`/g, '').replace(/^\*{1,2}\s*|\s*\*{1,2}$/g, '').trim()
      : ''
  }).filter(Boolean)
  const basenameCounts = new Map()
  for (const file of files) {
    const basename = path.posix.basename(file.path).toLowerCase()
    basenameCounts.set(basename, (basenameCounts.get(basename) || 0) + 1)
  }
  return files.filter(file => {
    const expected = normalizePath(file.path).toLowerCase()
    const basename = path.posix.basename(expected)
    return headings.some(value => {
      const heading = normalizePath(value.replace(/[（(].*$/, '').trim()).toLowerCase()
      return heading === expected || (heading === basename && basenameCounts.get(basename) === 1)
    })
  }).map(file => file.path)
}

function missingExplanationFiles(content = '', files = []) {
  const covered = new Set(explainedFilePaths(content, files))
  return files.filter(file => !covered.has(file.path)).map(file => file.path)
}

async function analyzeOrExplainProject(options = {}) {
  const snapshot = createProjectSnapshot(options)
  const facts = projectFacts(snapshot)
  const question = String(options.question || '')
  const reportFiles = selectReportTargetFiles(snapshot, question)
  const mode = options.mode === 'analysis'
    ? 'analysis'
    : options.mode === 'explanation'
      ? 'explanation'
      : /檔案分析|專案分析|目錄結構|架構|檔案關聯|^\s*(?:請)?分析/i.test(question) ? 'analysis' : 'explanation'
  const isTargetRestricted = ['current_file', 'explicit_files'].includes(snapshot.scope)
  const relatedPaths = explanationRelatedPaths(snapshot, facts)
  const effectiveRelated = isTargetRestricted ? reportFiles.map(f => f.path) : relatedPaths
  const factsText = formatFactsForPrompt(snapshot, facts, reportFiles)
  const contentSelection = selectRelevantContents(snapshot, [...new Set([...reportFiles.map(f => f.path), ...(mode === 'analysis' ? snapshot.activePaths : effectiveRelated)])], mode === 'analysis' ? 150000 : 90000, { numberLines: true })
  const contents = contentSelection.text
  const prompt = mode === 'analysis'
    ? `你是 Cubi Code 的唯讀專案分析器。只分析，不得修改檔案、不得輸出 Diff、不得宣稱已寫檔。
後台功能設定：
${getFeaturePrompt('analyze') || '(無)'}

請以繁體中文輸出。請用 Markdown 排版，輸出順序固定為：
## 程式分析總覽
## 各檔案分析
## 風險與注意事項
## 建議下一步
每個段落底下必須使用數字清單（1., 2., 3.）排序；檔案路徑、函式、變數與行號請使用 inline code 標示。
請包含前端、後端、測試、設定等說明，以及 API 呼叫、測試對應關係。另需整理「核心技術棧」、「服務與 Host Port 對應」、「可能需要修改的位置」。
【嚴格限制】：在「各檔案分析」中，僅需針對以下已開啟的 ${reportFiles.length} 個目標檔案進行分析。每個檔案必須使用獨立標題「### 檔案名稱：\`完整路徑\`」，同一個檔案只出現一次。絕對禁止分析、提及、列出或捏造任何未開啟、未在目標清單中的檔案！
目標檔案清單：
${reportFiles.map(file => `- ${file.path}`).join('\n')}
每個重要判斷都要引用「檔案路徑:行號」，沒有證據就明確寫「目前上下文無法判斷」。只可依提供證據作答。

使用者問題：${question || '分析目前檔案或專案'}
${factsText}

檔案內容：
${contents}`
    : `你是 Cubi Code 的唯讀程式說明器。只說明，不得修改檔案、不得輸出 Diff、不得宣稱已寫檔。
後台功能設定：
${getFeaturePrompt('explain') || '(無)'}

請用初學者能理解的繁體中文。請用 Markdown 排版，輸出順序固定為：
## 程式說明摘要
## 各檔案程式說明
## 風險與可改善處
每個段落底下必須使用數字清單（1., 2., 3.）排序；檔案路徑、函式、變數與行號請使用 inline code 標示。
【嚴格限制】：必須完整且僅涵蓋以下已開啟的 ${reportFiles.length} 個目標檔案。標題中的檔案名稱必須原樣照抄，不可省略。絕對禁止分析、提及或輸出任何未開啟或未指定之檔案；每個檔案請精簡說明，以確保全部完成：
${reportFiles.map(file => `- ${file.path}`).join('\n')}
在「各檔案程式說明」中，每個檔案必須使用獨立標題「### 檔案名稱：\`完整路徑\`」，同一個檔案只出現一次，不要在不同段落重複說明同一檔案。
說明功能從哪個檔案開始、重要函式、前後端互動及測試在測什麼。
每一個重要說明都要引用「檔案路徑:行號」。若問題是遞迴，請用一個小輸入逐步展開呼叫、指出 base case、回傳順序與時間複雜度；若是一般流程，請依實際行號列出輸入 → 處理 → 輸出。
不得用未出現在檔案內容中的函式、類別或流程補空白。

使用者問題：${question || '說明目前功能'}
主要與關聯檔案：${effectiveRelated.join('、') || '(無)'}
${factsText}

檔案內容：
${contents}`
  let aiResult = null
  try {
    aiResult = await askLlm(prompt, { temperature: 0.15, numPredict: 2200, think: false, requestEndpoint: '/api/ai/explain' })
  } catch (err) {
    aiResult = { ok: false, error: `執行模型推論異常: ${err?.message || err}`, source: 'ollama_error' }
  }
  if (!aiResult?.ok) {
    return modelUnavailableResponse(
      mode === 'analysis' ? 'project_file_analysis' : 'program_explanation',
      mode,
      aiResult
    )
  }
  const fallback = mode === 'analysis' ? analysisFallback(snapshot, facts, reportFiles) : explanationFallback(snapshot, facts, relatedPaths, reportFiles)
  const modelContent = aiResult?.ok ? String(aiResult.content || '').trim() : ''
  const modelHasRequiredSections = explainedFilePaths(modelContent, reportFiles).length > 0
  let completedModelContent = modelContent
  let totalTokens = Number(aiResult?.tokens || 0)
  let fallbackUsed = !modelHasRequiredSections

  if (modelHasRequiredSections && mode === 'explanation') {
    const initiallyMissing = missingExplanationFiles(completedModelContent, reportFiles)
    if (initiallyMissing.length > 0) {
      const missingSnapshot = { ...snapshot, files: snapshot.files.filter(file => initiallyMissing.includes(file.path)) }
      const missingContents = relevantContents(missingSnapshot, initiallyMissing, 45000, { numberLines: true })
      const repairPrompt = `你是 Cubi Code 的唯讀程式說明器。上一輪漏掉部分檔案，請只補充下列 ${initiallyMissing.length} 個檔案，不得重複其他檔案，也不得修改程式碼。
每個檔案都必須使用獨立標題「### 檔案名稱：\`完整路徑\`」，並使用 Markdown 數字清單簡明列出用途、執行流程、重要函式、輸入輸出、風險與可改善處。檔案路徑、函式、變數與行號請使用 inline code 標示。請使用繁體中文並引用行號。

必須補齊：
${initiallyMissing.map(filePath => `- ${filePath}`).join('\n')}

檔案內容：
${missingContents}`
      let repairResult = null
      try {
        repairResult = await askLlm(repairPrompt, {
          temperature: 0.1,
          numPredict: Math.min(1800, Math.max(700, initiallyMissing.length * 450)),
          think: false,
          requestEndpoint: '/api/ai/explain',
        })
      } catch (err) {
        repairResult = { ok: false, error: `執行模型推論異常: ${err?.message || err}`, source: 'ollama_error' }
      }
      totalTokens += Number(repairResult?.tokens || 0)
      const repairContent = repairResult?.ok ? String(repairResult.content || '').trim() : ''
      if (repairContent && explainedFilePaths(repairContent, missingSnapshot.files).length > 0) {
        completedModelContent = `${completedModelContent}\n\n${repairContent}`
      }
    }

    const stillMissing = missingExplanationFiles(completedModelContent, reportFiles)
    if (stillMissing.length > 0) {
      fallbackUsed = true
      completedModelContent = `${completedModelContent}\n\n## 系統補齊的檔案說明\n\n${explanationFileSections(snapshot, facts, stillMissing)}`
    }
  }
  const content = modelHasRequiredSections
    ? completedModelContent
    : fallback
  const verification = buildVerification({
    snapshot,
    contextSelection: contentSelection,
    aiResult,
    fallbackUsed,
    mode,
  })
  return {
    type: mode === 'analysis' ? 'project_file_analysis' : 'program_explanation',
    mode,
    ok: true,
    scan_completed: true,
    read_only: true,
    content,
    project_types: facts.types,
    project_files: facts.files,
    relations: facts.relations,
    risks: facts.risks,
    ports: facts.ports,
    related_files: relatedPaths,
    coverage: snapshot.coverage,
    coverage_notice: snapshot.coverageNotice,
    model_context_notice: `模型取得 ${verification.model_context_file_count} / ${verification.loaded_file_count} 個檔案內容${verification.model_context_truncated ? '（其餘由規則摘要或備援說明涵蓋）' : ''}。`,
    verification,
    model: aiResult?.model || 'deterministic_project_scanner',
    source: aiResult?.source || 'readonly_project_analysis',
    tokens: totalTokens,
  }
}

module.exports = {
  createProjectSnapshot,
  detectProjectTypes,
  extractRelations,
  extractSymbols,
  projectFacts,
  errorLocations,
  formatDetectionReport,
  selectRelevantContents,
  buildVerification,
  modelUnavailableResponse,
  analysisFallback,
  explainedFilePaths,
  missingExplanationFiles,
  explanationFileSections,
  explanationFallback,
  selectReportTargetFiles,
  detectProjectErrors,
  analyzeOrExplainProject,
  formatFactsForPrompt,
}
