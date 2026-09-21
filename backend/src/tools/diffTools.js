function normalizeText(text) {
  return String(text ?? '').replace(/\r\n/g, '\n')
}

function makeUnifiedDiff(filePath, oldContent, newContent) {
  const oldLines = normalizeText(oldContent).split('\n')
  const newLines = normalizeText(newContent).split('\n')
  while (oldLines.length && oldLines[oldLines.length - 1] === '') oldLines.pop()
  while (newLines.length && newLines[newLines.length - 1] === '') newLines.pop()
  const oldCount = Math.max(oldLines.length, 1)
  const newCount = Math.max(newLines.length, 1)
  return [
    `--- a/${filePath || 'current_file.py'}`,
    `+++ b/${filePath || 'current_file.py'}`,
    `@@ -1,${oldCount} +1,${newCount} @@`,
    ...oldLines.map(line => `-${line}`),
    ...newLines.map(line => `+${line}`),
  ].join('\n') + '\n'
}

function stripCodeFences(text) {
  let value = normalizeText(text).trim()
  const fenced = value.match(/```[a-zA-Z0-9_+.#-]*\s*([\s\S]*?)```/)
  if (fenced) value = fenced[1].trim()
  return value.replace(/^```[a-zA-Z0-9_+.#-]*\s*/g, '').replace(/```$/g, '').trim()
}

function extractFileContent(text) {
  let value = stripCodeFences(text)
  if (!value) return ''
  const stopMarkers = ['\n說明：', '\nExplanation:', '\n注意：', '\nNote:']
  for (const marker of stopMarkers) {
    const index = value.indexOf(marker)
    if (index > 0) value = value.slice(0, index).trim()
  }
  return value.endsWith('\n') ? value : `${value}\n`
}

function extractMultiFiles(text) {
  const files = []
  if (!text) return files
  
  const fileBlocks = text.split(/<file_output\s+path=["']([^"']+)["']\s*>/i)
  if (fileBlocks.length > 1) {
    for (let i = 1; i < fileBlocks.length; i += 2) {
      const path = fileBlocks[i].trim()
      let contentBlock = fileBlocks[i + 1] || ''
      const endIdx = contentBlock.indexOf('</file_output>')
      if (endIdx !== -1) {
        contentBlock = contentBlock.substring(0, endIdx)
      }
      contentBlock = extractFileContent(contentBlock)
      if (path && contentBlock) {
        files.push({ path, content: contentBlock })
      }
    }
  }

  const bareFileBlocks = String(text || '').matchAll(/<file_output\s*>\s*([\s\S]*?)<\/file_output>/gi)
  for (const match of bareFileBlocks) {
    const rawBlock = normalizeText(match[1] || '').trim()
    const lines = rawBlock.split('\n')
    const firstLine = String(lines.shift() || '').trim()
    const pathMatch = firstLine.match(/^([A-Za-z0-9_.\/-]+\.(?:html?|css|mjs|cjs|js|jsx|ts|tsx|vue|py|java|cs|php|go|rs|cpp|c|h|json|md|txt|sql|ya?ml|csv|tsv|xml|svg))$/i)
    if (!pathMatch) continue
    const path = pathMatch[1]
    const contentBlock = extractFileContent(lines.join('\n'))
    if (path && contentBlock) {
      files.push({ path, content: contentBlock })
    }
  }
  return files
}

module.exports = { makeUnifiedDiff, stripCodeFences, extractFileContent, extractMultiFiles }
