const DEFAULT_MAX_CONTEXT_CHARS = 120000
const DEFAULT_MAX_CHARS_PER_FILE = 30000
const DEFAULT_MIN_SUMMARY_CHARS = 900

export function estimateTokens(text = '') {
  return Math.ceil(String(text || '').length / 4)
}

export function normalizeContextPath(path = '') {
  return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').trim()
}

function getFileName(path = '') {
  return normalizeContextPath(path).split('/').filter(Boolean).pop() || ''
}

function inferLanguage(path = '') {
  const lower = String(path || '').toLowerCase()
  if (lower.endsWith('.py')) return 'Python'
  if (lower.endsWith('.db') || lower.endsWith('.sqlite') || lower.endsWith('.sqlite3')) return 'SQLite DB summary'
  if (lower.endsWith('.vue')) return 'Vue'
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'JavaScript'
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'TypeScript'
  if (lower.endsWith('.json')) return 'JSON'
  if (lower.endsWith('.md')) return 'Markdown'
  if (lower.endsWith('.css')) return 'CSS'
  if (lower.endsWith('.html')) return 'HTML'
  if (lower.endsWith('.sql')) return 'SQL'
  return 'text'
}

function takeMatches(lines, regex, limit = 18) {
  const out = []
  for (const line of lines) {
    const match = line.match(regex)
    if (!match) continue
    out.push(match[1] || match[0])
    if (out.length >= limit) break
  }
  return out
}

function compactSnippet(lines, maxLines = 10) {
  const cleaned = lines
    .map(line => line.trimEnd())
    .filter(line => line.trim())
    .slice(0, maxLines)
  return cleaned.join('\n')
}

export function summarizeContextFile(record = {}) {
  const filePath = normalizeContextPath(record.file_path || record.path || '')
  const content = String(record.content || '').replace(/\r\n/g, '\n')
  const lines = content.split('\n')
  const language = inferLanguage(filePath)
  const imports = takeMatches(lines, /^\s*(?:from\s+[^\s]+\s+import\s+.+|import\s+.+|const\s+.+?=\s+require\(.+\)|import\s+.+\s+from\s+.+)/, 10)
  const declarations = [
    ...takeMatches(lines, /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/, 16),
    ...takeMatches(lines, /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/, 16),
    ...takeMatches(lines, /^\s*class\s+([A-Za-z0-9_$.]+)/, 16),
    ...takeMatches(lines, /^\s*def\s+([A-Za-z0-9_]+)\s*\(/, 16),
  ]
  const routes = takeMatches(lines, /\b(?:router|app)\.(?:get|post|put|patch|delete)\(['"`]([^'"`]+)['"`]/, 16)
  const firstSnippet = compactSnippet(lines, 8)
  const tailSnippet = lines.length > 30 ? compactSnippet(lines.slice(-8), 8) : ''

  const sections = [
    `檔案摘要：${filePath || getFileName(filePath) || 'context'}`,
    `語言：${language}；原始大小：約 ${content.length.toLocaleString('en-US')} chars / ${lines.length.toLocaleString('en-US')} lines；來源：${record.source || 'unknown'}`,
    imports.length ? `主要 imports：${imports.join('； ')}` : '',
    declarations.length ? `主要函式 / 類別：${[...new Set(declarations)].slice(0, 18).join('、')}` : '',
    routes.length ? `API routes：${[...new Set(routes)].slice(0, 16).join('、')}` : '',
    firstSnippet ? `前段片段：\n${firstSnippet}` : '',
    tailSnippet ? `尾段片段：\n${tailSnippet}` : '',
  ]

  return sections.filter(Boolean).join('\n')
}

function buildFileBlock(filePath, content, mode, record, extraNote = '') {
  const label = mode === 'full'
    ? '完整內容'
    : mode === 'excerpt'
      ? '重要片段'
      : '摘要'
  const note = extraNote ? `；${extraNote}` : ''
  return [
    `--- ${filePath}（${label}${note}） ---`,
    content,
  ].join('\n')
}

function pushBudgetNoticeParts(fileOut, record, mode, reason = '') {
  fileOut.content_mode = mode
  fileOut.reason = reason
  fileOut.estimated_tokens = estimateTokens(fileOut.content)
  fileOut.priority = record.priority || 0
  fileOut.role = record.role || ''
  fileOut.content_type = record.content_type || ''
  fileOut.max_chars_per_file = record.max_chars_per_file || undefined
  fileOut.preserve_tail = Boolean(record.preserve_tail)
  return fileOut
}

function getOriginalChars(record, contentLength) {
  const reportedLength = Number(record.original_chars)
  return Number.isFinite(reportedLength) ? Math.max(contentLength, reportedLength) : contentLength
}

export function createManagedContextBundle(records = [], config = {}) {
  const maxChars = Math.min(DEFAULT_MAX_CONTEXT_CHARS, Math.max(1, Number(config.maxChars || DEFAULT_MAX_CONTEXT_CHARS)))
  const maxCharsPerFile = Math.min(DEFAULT_MAX_CHARS_PER_FILE, Math.max(1, Number(config.maxCharsPerFile || DEFAULT_MAX_CHARS_PER_FILE)))
  const minSummaryChars = Number(config.minSummaryChars || DEFAULT_MIN_SUMMARY_CHARS)
  const sorted = [...records]
    .filter(record => record?.ok && normalizeContextPath(record.file_path || record.path || ''))
    .map((record, index) => ({ ...record, index, file_path: normalizeContextPath(record.file_path || record.path || '') }))
    .sort((a, b) => (Number(b.priority || 0) - Number(a.priority || 0)) || (a.index - b.index))

  let remaining = maxChars
  const files = []
  const textBlocks = []
  const skipped = []
  const compacted = []
  const originalChars = sorted.reduce((sum, record) => sum + getOriginalChars(record, String(record.content || '').length), 0)

  for (const record of sorted) {
    const filePath = record.file_path
    const raw = String(record.content || '').replace(/\r\n/g, '\n')
    const originalLength = getOriginalChars(record, raw.length)

    if (remaining <= minSummaryChars) {
      skipped.push({ file_path: filePath, original_chars: originalLength, reason: 'context budget exhausted' })
      continue
    }

    const separatorLength = textBlocks.length ? 2 : 0
    const formattedLength = originalLength.toLocaleString('en-US')
    const headerReserve = separatorLength + Math.max(
      buildFileBlock(filePath, '', 'full', record).length,
      buildFileBlock(filePath, '', 'summary', record, `原始 ${formattedLength} chars 已壓縮`).length,
      buildFileBlock(filePath, '', 'excerpt', record, `原始 ${formattedLength} chars 已截斷`).length,
      buildFileBlock(filePath, '', 'excerpt', record, `原始 ${formattedLength} chars 已保留最新上下文`).length,
    )
    const availableForContent = Math.max(0, remaining - headerReserve)
    const recordMaxChars = Number(record.max_chars_per_file || maxCharsPerFile)
    const fullLimit = Math.min(recordMaxChars, availableForContent)

    if (record.preserve_tail && originalLength > fullLimit && fullLimit > 200) {
      const content = raw.slice(-fullLimit)
      const block = buildFileBlock(filePath, content, 'excerpt', record, `原始 ${originalLength.toLocaleString('en-US')} chars 已保留最新上下文`)
      remaining -= block.length + separatorLength
      textBlocks.push(block)
      compacted.push({ file_path: filePath, mode: 'excerpt', original_chars: originalLength, included_chars: content.length })
      files.push(pushBudgetNoticeParts({
        file_path: filePath,
        content,
        original_chars: originalLength,
        included_chars: content.length,
        truncated: true,
        source: record.source || 'unknown',
      }, record, 'excerpt', 'context capped at max chars; latest tail preserved'))
      continue
    }

    if (originalLength <= fullLimit) {
      const block = buildFileBlock(filePath, raw, 'full', record)
      remaining -= block.length + separatorLength
      textBlocks.push(block)
      files.push(pushBudgetNoticeParts({
        file_path: filePath,
        content: raw,
        original_chars: originalLength,
        included_chars: raw.length,
        truncated: false,
        source: record.source || 'unknown',
      }, record, 'full'))
      continue
    }

    const summary = summarizeContextFile(record)
    const canIncludeSummary = summary.length + headerReserve <= remaining
    if (canIncludeSummary) {
      const summaryLimit = Math.min(summary.length, Math.max(minSummaryChars, availableForContent))
      const content = summary.slice(0, summaryLimit)
      const block = buildFileBlock(filePath, content, 'summary', record, `原始 ${originalLength.toLocaleString('en-US')} chars 已壓縮`)
      remaining -= block.length + separatorLength
      textBlocks.push(block)
      compacted.push({ file_path: filePath, mode: 'summary', original_chars: originalLength, included_chars: content.length })
      files.push(pushBudgetNoticeParts({
        file_path: filePath,
        content,
        original_chars: originalLength,
        included_chars: content.length,
        truncated: true,
        source: record.source || 'unknown',
      }, record, 'summary', 'long file summarized'))
      continue
    }

    const excerptLength = Math.min(fullLimit, Math.max(0, availableForContent))
    if (excerptLength > 200) {
      const headSize = Math.ceil(excerptLength * 0.7)
      const tailSize = Math.max(0, excerptLength - headSize - 80)
      const content = `${raw.slice(0, headSize)}\n\n...（中間內容已因 Context 上限省略）...\n\n${tailSize ? raw.slice(-tailSize) : ''}`.slice(0, excerptLength)
      const block = buildFileBlock(filePath, content, 'excerpt', record, `原始 ${originalLength.toLocaleString('en-US')} chars 已截斷`)
      remaining -= block.length + separatorLength
      textBlocks.push(block)
      compacted.push({ file_path: filePath, mode: 'excerpt', original_chars: originalLength, included_chars: content.length })
      files.push(pushBudgetNoticeParts({
        file_path: filePath,
        content,
        original_chars: originalLength,
        included_chars: content.length,
        truncated: true,
        source: record.source || 'unknown',
      }, record, 'excerpt', 'budget excerpt'))
    } else {
      skipped.push({ file_path: filePath, original_chars: originalLength, reason: 'not enough budget for summary' })
    }
  }

  const includedChars = files.reduce((sum, item) => sum + item.included_chars, 0)
  return {
    files,
    text: textBlocks.join('\n\n'),
    skipped,
    compacted,
    totalChars: includedChars,
    originalChars,
    savedChars: Math.max(0, originalChars - includedChars),
    maxChars,
    maxCharsPerFile,
    estimatedTokens: estimateTokens(textBlocks.join('\n\n')),
    truncated: compacted.length > 0 || skipped.length > 0,
    strategy: compacted.length || skipped.length
      ? 'active/extra files first, long files summarized, overflow skipped'
      : 'all files included within budget',
  }
}
