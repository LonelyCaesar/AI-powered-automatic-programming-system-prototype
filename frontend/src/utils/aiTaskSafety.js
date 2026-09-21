const CODE_EXTENSIONS = new Set([
  'c', 'cc', 'cpp', 'cs', 'css', 'go', 'h', 'hpp', 'html', 'java', 'js', 'jsx',
  'mjs', 'php', 'py', 'rs', 'sql', 'ts', 'tsx', 'vue',
])

const CONTEXT_EXTENSIONS = new Set([
  ...CODE_EXTENSIONS,
  'cfg', 'env', 'ini', 'json', 'md', 'properties', 'toml', 'txt', 'xml', 'yaml', 'yml',
])

const FRAMEWORK_NAMES = new Set([
  'chart.js', 'd3.js', 'express.js', 'next.js', 'node.js', 'nuxt.js', 'react.js', 'three.js', 'vue.js',
])

const SOURCE_REQUIRED_ACTIONS = new Set(['rewrite', 'convert', 'detect', 'fix', 'explain', 'run_tests'])

function normalizePath(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^@+/, '').replace(/^\/+/, '').trim()
}

function basename(value = '') {
  return normalizePath(value).split('/').filter(Boolean).pop() || ''
}

function normalizeComparable(value = '') {
  return normalizePath(value).toLowerCase()
}

function isSupportedFileReference(value = '') {
  const name = basename(value).toLowerCase()
  if (!name || FRAMEWORK_NAMES.has(name)) return false
  if (/^\.[a-z0-9_-]+$/i.test(name)) return true
  const extension = name.includes('.') ? name.split('.').pop() : ''
  return CONTEXT_EXTENSIONS.has(extension)
}

export function extractRequestedFileReferences(instruction = '') {
  const matches = String(instruction || '').match(/(?:[A-Za-z0-9_@+.-]+[\\/])*\.?[A-Za-z0-9_@+-]+(?:\.[A-Za-z0-9_@+-]+)+/g) || []
  const seen = new Set()
  const results = []
  for (const raw of matches) {
    const value = normalizePath(raw).replace(/[.,;:!?，。；：！？)）\]】]+$/g, '')
    const key = value.toLowerCase()
    if (!value || seen.has(key) || !isSupportedFileReference(value)) continue
    seen.add(key)
    results.push(value)
  }
  return results
}

export function extractDeclaredOutputFileReferences(instruction = '') {
  const text = String(instruction || '')
  const references = extractRequestedFileReferences(text)
  return references.filter(reference => {
    const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp(escaped, 'i').exec(text)
    if (!match) return false
    const before = text.slice(Math.max(0, match.index - 48), match.index)
    return /(?:輸出(?:檔案)?|轉換後(?:檔案)?|轉換成|轉換為|轉成|轉為|另存|存成|存為|儲存為|建立|新增|產生|寫入|output(?:\s+file)?(?:\s+as|\s+to)?|save\s+as)\s*(?:為|成|到|至|:|：)?\s*(?:(?:Node(?:\.js)?|Express|React|Vue|Python|JavaScript|TypeScript|Java|HTML|CSS|C\+\+|Go|Rust|PHP|SQL|[A-Za-z]+)\b[^\n()（）]{0,24})?\s*[（(]?\s*$/i.test(before)
  })
}

export function requiredExistingFileReferences(instruction = '') {
  const text = String(instruction || '')
  const outputs = new Set(extractDeclaredOutputFileReferences(instruction).map(normalizeComparable))
  return extractRequestedFileReferences(instruction)
    .filter(reference => !outputs.has(normalizeComparable(reference)))
    .filter(reference => !isFailureEvidenceFileReference(text, reference))
}

function isFailureEvidenceFileReference(instruction = '', reference = '') {
  const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(escaped, 'i').exec(instruction)
  if (!match) return false
  const before = instruction.slice(Math.max(0, match.index - 48), match.index)
  const after = instruction.slice(match.index + match[0].length, match.index + match[0].length + 48)
  return (
    /(?:沒有|無|缺少|不存在|找不到|未提供|未附上|without|not\s+found)\s*$/i.test(before) ||
    /(?:fetch\s*\(\s*['"]?|依賴\s*fetch\s*\(\s*['"]?)$/i.test(before) ||
    /^\s*(?:時|的時候|時，|時,|不存在|載入失敗|讀取失敗|not\s+found|is\s+missing)/i.test(after)
  )
}

export function resolveRequestedWorkspacePaths(instruction = '', workspacePaths = [], options = {}) {
  const available = [...new Set((workspacePaths || []).map(normalizePath).filter(Boolean))]
  const resolved = []
  const references = options.excludeDeclaredOutputs
    ? requiredExistingFileReferences(instruction)
    : extractRequestedFileReferences(instruction)
  for (const reference of references) {
    const referenceKey = normalizeComparable(reference)
    const referenceName = basename(reference).toLowerCase()
    const match = available.find(path => normalizeComparable(path) === referenceKey) ||
      available.find(path => basename(path).toLowerCase() === referenceName) ||
      available.find(path => normalizeComparable(path).endsWith(`/${referenceKey}`))
    if (match && !resolved.includes(match)) resolved.push(match)
  }
  return resolved
}

export function selectTaskTargetPaths(instruction = '', workspacePaths = [], fallbackPaths = []) {
  const requested = resolveRequestedWorkspacePaths(instruction, workspacePaths, {
    excludeDeclaredOutputs: true,
  })
  if (requested.length) return requested
  return [...new Set((fallbackPaths || []).map(normalizePath).filter(Boolean))]
}

function languageFromText(text = '', options = {}) {
  const value = String(text || '')
  const lower = value.toLowerCase()
  const react = /\breact(?:\.js)?\b/i.test(value)
  const typescript = /\btypescript\b|\btsx?\b/i.test(value)
  if (react && typescript) return options.forFile ? 'React TypeScript' : 'TypeScript'
  if (react) return options.forFile ? 'React JavaScript' : 'JavaScript'
  if (/\bnode(?:\.js)?\b|\bexpress(?:\.js)?\b|\bjavascript\b|\bjs\b/i.test(value)) return 'JavaScript'
  if (typescript) return 'TypeScript'
  if (/\bfastapi\b|\bpython\b/i.test(value)) return 'Python'
  if (/\bvue(?:\.js)?\b/i.test(value)) return options.forFile ? 'Vue' : 'JavaScript'
  if (/\bgin\b|\bgolang\b|(?:^|\s)go(?:\s|$)/i.test(value)) return 'Go'
  if (/\bc#\b|\bcsharp\b/i.test(value)) return 'C#'
  if (/\bphp\b/i.test(value)) return 'PHP'
  if (/\brust\b/i.test(value)) return 'Rust'
  if (/\bjava\b/i.test(value) && !lower.includes('javascript')) return 'Java'
  return ''
}

export function inferExplicitTargetLanguage(instruction = '') {
  const text = String(instruction || '')
  const marker = /(?:轉換|轉成|轉為|改寫成|改寫為|convert(?:ed)?\s+to)/i.exec(text)
  if (!marker) return ''
  const tail = text.slice((marker.index || 0) + marker[0].length)
  return languageFromText(tail)
}

export function inferRequestedOutputLanguage(instruction = '') {
  return languageFromText(instruction, { forFile: true }) || 'JavaScript'
}

export function detectCodeLanguage(code = '', filePath = '') {
  const text = String(code || '')
  if (/(^|\n)\s*(?:from\s+[\w.]+\s+import|import\s+[\w.]+(?:\s+as\s+\w+)?\s*(?:#.*)?$|def\s+\w+\s*\(|class\s+\w+\s*[:(])/m.test(text)) return 'Python'
  if (/\b(?:interface|type)\s+\w+|:\s*(?:string|number|boolean)\b/.test(text)) return 'TypeScript'
  if (/\b(?:const|let|var|function)\b|=>|require\s*\(|\bimport\s+.+\s+from\s+['"]/.test(text)) return 'JavaScript'
  if (/\bpublic\s+(?:static\s+)?class\b|System\.out\.println/.test(text)) return 'Java'
  if (/\bpackage\s+main\b|\bfunc\s+\w+\s*\(/.test(text)) return 'Go'
  if (/<(?:!doctype|html|body|script|style)\b/i.test(text)) return 'HTML'

  const extension = basename(filePath).toLowerCase().split('.').pop()
  const byExtension = {
    py: 'Python', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
    ts: 'TypeScript', tsx: 'TypeScript', java: 'Java', go: 'Go', cs: 'C#', php: 'PHP', rs: 'Rust',
    html: 'HTML', htm: 'HTML', vue: 'JavaScript',
  }
  return byExtension[extension] || ''
}

export function inferConversionTarget({ instruction = '', sourceCode = '', filePath = '' } = {}) {
  const explicit = inferExplicitTargetLanguage(instruction)
  if (explicit) return explicit
  const source = detectCodeLanguage(sourceCode, filePath)
  if (source === 'JavaScript' || source === 'TypeScript') return 'Python'
  if (source === 'Python') return 'JavaScript'
  return ''
}

function extensionForLanguage(language = '') {
  const value = String(language || '').toLowerCase()
  if (value.includes('react typescript')) return '.tsx'
  if (value.includes('react')) return '.jsx'
  if (value.includes('typescript')) return '.ts'
  if (value.includes('javascript')) return '.js'
  if (value.includes('python')) return '.py'
  if (value === 'java') return '.java'
  if (value === 'go') return '.go'
  if (value.includes('c#')) return '.cs'
  if (value.includes('php')) return '.php'
  if (value.includes('rust')) return '.rs'
  if (value.includes('vue')) return '.vue'
  if (value.includes('html')) return '.html'
  return '.txt'
}

function generationStem(instruction = '', language = '') {
  const text = String(instruction || '')
  const componentMatch = text.match(/\(([A-Z][A-Za-z0-9_]*)\)/) || text.match(/\b([A-Z][A-Za-z0-9_]*(?:Card|Component|View|Page|Form|List))\b/)
  if (componentMatch?.[1]) return componentMatch[1]
  if (language === 'Java') return 'Generated'
  return 'generated'
}

export function findAvailableGeneratedPath(preferredPath = '', existingPaths = [], reusablePath = '') {
  const preferred = normalizePath(preferredPath)
  if (!preferred) return ''

  const reusable = normalizeComparable(reusablePath)
  if (reusable && normalizeComparable(preferred) === reusable) return preferred

  const occupied = new Set((existingPaths || []).map(normalizeComparable).filter(Boolean))
  if (!occupied.has(normalizeComparable(preferred))) return preferred

  const slashIndex = preferred.lastIndexOf('/')
  const directory = slashIndex >= 0 ? preferred.slice(0, slashIndex + 1) : ''
  const fileName = slashIndex >= 0 ? preferred.slice(slashIndex + 1) : preferred
  const dotIndex = fileName.lastIndexOf('.')
  const hasExtension = dotIndex > 0
  const rawStem = hasExtension ? fileName.slice(0, dotIndex) : fileName
  const stem = rawStem.replace(/\s\(\d+\)$/g, '') || rawStem
  const extension = hasExtension ? fileName.slice(dotIndex) : ''

  let suffix = 2
  let candidate = `${directory}${stem} (${suffix})${extension}`
  while (occupied.has(normalizeComparable(candidate))) {
    suffix += 1
    candidate = `${directory}${stem} (${suffix})${extension}`
  }
  return candidate
}

export function inferGeneratedTargetPath({ instruction = '', activeFile = '', currentContent = '', existingPaths = [] } = {}) {
  const cleanActive = normalizePath(activeFile)
  const explicitFiles = extractRequestedFileReferences(instruction).filter(path => {
    const extension = basename(path).toLowerCase().split('.').pop()
    return CODE_EXTENSIONS.has(extension)
  })
  if (explicitFiles.length) {
    return findAvailableGeneratedPath(explicitFiles[0], existingPaths, cleanActive)
  }

  const explicitlyCurrent = /(?:目前|當前|這個|current)\s*(?:編輯器|檔案|file)|寫入目前|放進目前/i.test(String(instruction || ''))
  if (cleanActive && (!String(currentContent || '').trim() || explicitlyCurrent)) return cleanActive

  const language = inferRequestedOutputLanguage(instruction)
  const extension = extensionForLanguage(language)
  const stem = generationStem(instruction, language)
  const directory = cleanActive.includes('/') ? cleanActive.split('/').slice(0, -1).join('/') : ''
  const fileName = `${stem}${extension}`
  const preferred = directory ? `${directory}/${fileName}` : fileName
  return findAvailableGeneratedPath(preferred, existingPaths, cleanActive)
}

export function convertedTargetPath(sourcePath = '', targetLanguage = '') {
  const clean = normalizePath(sourcePath || 'converted')
  const extension = extensionForLanguage(targetLanguage)
  const directory = clean.includes('/') ? clean.split('/').slice(0, -1).join('/') : ''
  let stem = basename(clean).replace(/\.[^/.]+$/g, '') || 'converted'
  if (['.java', '.cs'].includes(extension)) {
    stem = stem.replace(/(^|[-_\s]+)([A-Za-z0-9])/g, (_, __, character) => character.toUpperCase())
  }
  const target = `${stem}${extension}`
  return directory ? `${directory}/${target}` : target
}

function requestedFileCount(instruction = '') {
  const text = String(instruction || '')
  if (/(?:這|下列|以下)?\s*兩個/.test(text)) return 2
  if (/(?:這|下列|以下)?\s*三個/.test(text)) return 3
  const match = text.match(/(?:這|下列|以下)?\s*(\d+)\s*個(?:檔案|文件|設定檔)/)
  return match ? Number(match[1]) : 0
}

export function validateTaskContext({
  action = '',
  instruction = '',
  activeFile = '',
  selectedCode = '',
  currentContent = '',
  contextFiles = [],
  resolvedReferencePaths = [],
  workspaceOpen = false,
} = {}) {
  const normalizedAction = String(action || '').trim()
  const usableFiles = (contextFiles || []).filter(item => item?.ok !== false && String(item?.content || '').trim())
  const hasCode = Boolean(String(selectedCode || currentContent || '').trim()) || usableFiles.length > 0
  const references = requiredExistingFileReferences(instruction)
  const resolvedNames = new Set((resolvedReferencePaths || []).map(path => basename(path).toLowerCase()))
  const missingReferences = references.filter(reference => !resolvedNames.has(basename(reference).toLowerCase()))

  if (SOURCE_REQUIRED_ACTIONS.has(normalizedAction) && !hasCode) {
    return { ok: false, error: '缺少可用的程式碼上下文。請開啟或選取正確檔案，也可以用 @檔名 加入後再重試。' }
  }

  if (normalizedAction === 'analyze' && !hasCode) {
    return { ok: false, error: '尚未在檔案總管開啟任何檔案。請先在檔案總管開啟要分析的檔案，或用 @檔名 指定分析目標。' }
  }

  if (!['generate', 'files', 'create_files'].includes(normalizedAction) && missingReferences.length) {
    return { ok: false, error: `找不到需求中指定的檔案：${missingReferences.join('、')}。請確認檔案已存在於目前工作區。` }
  }

  const expectedCount = requestedFileCount(instruction)
  if (normalizedAction === 'analyze' && expectedCount > 0) {
    const availableCount = Math.max(resolvedReferencePaths.length, usableFiles.length, activeFile ? 1 : 0)
    if (availableCount < expectedCount) {
      return { ok: false, error: `需求要分析 ${expectedCount} 個檔案，但目前只有 ${availableCount} 個可用上下文。請開啟或 @ 加入缺少的檔案。` }
    }
  }

  return { ok: true }
}

export function isExistingFileChangeAuthorized({ instruction = '', filePath = '', activeFile = '', explicitTargetFiles = [] } = {}) {
  const text = String(instruction || '')
  const targetName = basename(filePath)
  const escapedTarget = targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const targetNegated = escapedTarget && [
    new RegExp(`(?:不要|不得|請勿|不可|禁止|無須|不需|不用|不必)\\s*(?:直接)?(?:修改|變更|覆寫|改寫|更新)[^，。；;\\n]{0,24}${escapedTarget}`, 'i'),
    new RegExp(`${escapedTarget}[^，。；;\\n]{0,24}(?:不要|不得|請勿|不可|禁止|無須|不需|不用|不必)\\s*(?:被)?(?:修改|變更|覆寫|改寫|更新)`, 'i'),
    new RegExp(`(?:保持|保留)[^，。；;\\n]{0,24}${escapedTarget}[^，。；;\\n]{0,16}(?:不變|原樣)`, 'i'),
  ].some(pattern => pattern.test(text))
  if (targetNegated) return false
  const target = normalizeComparable(filePath)
  const explicitTargets = new Set((explicitTargetFiles || []).map(normalizeComparable))
  if (explicitTargets.has(target)) return true

  const requestsModification = /(?:修改|更新|改寫|重構|補充|追加|調整|修正|modify|update|edit|rewrite|refactor|append|fix)/i.test(text)
  if (!requestsModification) return false
  if (normalizeComparable(activeFile) === target && /(?:目前|當前|這個|current)\s*(?:檔案|file)/i.test(text)) return true
  return extractRequestedFileReferences(text).some(reference => {
    const referenceKey = normalizeComparable(reference)
    return referenceKey === target || basename(referenceKey) === basename(target)
  })
}
