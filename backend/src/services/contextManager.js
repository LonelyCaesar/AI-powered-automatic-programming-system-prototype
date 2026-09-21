const { normalizePath } = require('../tools/fileTools')

const DEFAULT_MAX_CONTEXT_CHARS = 120000
const DEFAULT_MAX_CHARS_PER_FILE = 30000

function estimateTokens(text = '') {
  return Math.ceil(String(text || '').length / 4)
}

function safeFilePath(item = {}) {
  return normalizePath(item.file_path || item.path || '')
}

function compactContextFiles(contextFiles = [], options = {}) {
  const maxChars = Math.min(DEFAULT_MAX_CONTEXT_CHARS, Math.max(1, Number(options.maxChars || DEFAULT_MAX_CONTEXT_CHARS)))
  const maxCharsPerFile = Math.min(DEFAULT_MAX_CHARS_PER_FILE, Math.max(1, Number(options.maxCharsPerFile || DEFAULT_MAX_CHARS_PER_FILE)))
  const files = Array.isArray(contextFiles) ? contextFiles : []
  const normalized = []
  const skipped = []
  let remaining = maxChars

  for (const item of files) {
    const filePath = safeFilePath(item)
    if (!filePath) continue

    const raw = String(item.content ?? '')
    const originalChars = Number(item.original_chars || raw.length)
    const headerReserve = filePath.length + 80

    if (remaining <= headerReserve + 100) {
      skipped.push({ file_path: filePath, original_chars: originalChars, reason: 'backend context budget exhausted' })
      continue
    }

    const perItemMaxChars = Number(item.max_chars_per_file || maxCharsPerFile)
    const limit = Math.min(raw.length, perItemMaxChars, remaining - headerReserve)
    const safeLimit = Math.max(0, limit)
    const content = item.preserve_tail && raw.length > safeLimit ? raw.slice(-safeLimit) : raw.slice(0, safeLimit)
    remaining -= content.length + headerReserve

    normalized.push({
      file_path: filePath,
      content,
      original_chars: originalChars,
      included_chars: content.length,
      truncated: Boolean(item.truncated || originalChars > content.length),
      source: item.source || 'frontend',
      content_mode: item.content_mode || (item.truncated ? 'summary' : 'full'),
      content_type: item.content_type || '',
      reason: item.reason || '',
      estimated_tokens: estimateTokens(content),
    })
  }

  return {
    files: normalized,
    skipped,
    total_chars: normalized.reduce((sum, item) => sum + item.included_chars, 0),
    original_chars: normalized.reduce((sum, item) => sum + item.original_chars, 0) + skipped.reduce((sum, item) => sum + (item.original_chars || 0), 0),
    max_chars: maxChars,
    estimated_tokens: estimateTokens(normalized.map(item => item.content).join('\n\n')),
    truncated: normalized.some(item => item.truncated) || skipped.length > 0,
  }
}

function formatContextFiles(contextFiles = [], maxChars = DEFAULT_MAX_CONTEXT_CHARS) {
  const bundle = compactContextFiles(contextFiles, { maxChars })
  const blocks = bundle.files.map(item => {
    const mode = item.content_mode === 'summary'
      ? '摘要'
      : item.content_mode === 'excerpt'
        ? '片段'
        : '完整內容'
    const size = `included=${item.included_chars}/${item.original_chars} chars`
    return `\n--- ${item.file_path}（${mode}; ${size}${item.truncated ? '; compacted' : ''}） ---\n${item.content}`
  })

  if (bundle.skipped.length) {
    blocks.push(`\n--- Context overflow note ---\nBackend skipped files because context budget was full: ${bundle.skipped.map(item => item.file_path).join('、')}`)
  }

  return blocks.join('\n')
}

module.exports = { compactContextFiles, formatContextFiles, estimateTokens }
