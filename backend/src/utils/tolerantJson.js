function escapeControlCharactersInJsonStrings(value = '') {
  const source = String(value || '')
  let output = ''
  let inString = false
  let escaped = false

  for (const character of source) {
    if (escaped) {
      output += character
      escaped = false
      continue
    }
    if (character === '\\' && inString) {
      output += character
      escaped = true
      continue
    }
    if (character === '"') {
      output += character
      inString = !inString
      continue
    }

    const code = character.charCodeAt(0)
    if (inString && code < 0x20) {
      const escapedControl = {
        '\b': '\\b',
        '\f': '\\f',
        '\n': '\\n',
        '\r': '\\r',
        '\t': '\\t',
      }[character]
      output += escapedControl || `\\u${code.toString(16).padStart(4, '0')}`
      continue
    }
    output += character
  }
  return output
}

function extractBalancedJsonObject(value = '') {
  const source = String(value || '')
  const start = source.indexOf('{')
  if (start < 0) return ''

  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\' && inString) {
      escaped = true
      continue
    }
    if (character === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (character === '{') depth += 1
    if (character === '}') depth -= 1
    if (depth === 0) return source.slice(start, index + 1)
  }
  return ''
}

function parseTolerantJsonObject(value = '') {
  const source = String(value || '').trim()
  const objectSlice = extractBalancedJsonObject(source)
  const candidates = [...new Set([source, objectSlice].filter(Boolean))]

  for (const candidate of candidates) {
    for (const text of [candidate, escapeControlCharactersInJsonStrings(candidate)]) {
      try { return JSON.parse(text) } catch {}
    }
  }
  throw new Error('模型沒有回傳可解析 JSON。')
}

module.exports = {
  escapeControlCharactersInJsonStrings,
  extractBalancedJsonObject,
  parseTolerantJsonObject,
}
