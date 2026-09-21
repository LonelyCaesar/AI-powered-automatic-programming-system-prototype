export function normalizeOpenEditorPath(path = '') {
  return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').trim()
}

export function getOpenEditorTargetFiles(options = {}) {
  const {
    activeFile = '',
    openEditorFiles = [],
    maxFiles = 24,
  } = options

  const seen = new Set()
  const targets = []
  for (const rawPath of [activeFile, ...(openEditorFiles || [])]) {
    const path = normalizeOpenEditorPath(rawPath)
    if (!path || seen.has(path)) continue
    seen.add(path)
    targets.push(path)
    if (targets.length >= maxFiles) break
  }
  return targets
}

// Fix mode mirrors the visible Monaco tab order. The active tab is appended
// only when it is not already open, so the chat scope matches what users see.
export function getOpenEditorFixTargetFiles(options = {}) {
  const {
    activeFile = '',
    openEditorFiles = [],
    maxFiles = 24,
  } = options

  const seen = new Set()
  const targets = []
  for (const rawPath of [...(openEditorFiles || []), activeFile]) {
    const path = normalizeOpenEditorPath(rawPath)
    if (!path || seen.has(path)) continue
    seen.add(path)
    targets.push(path)
    if (targets.length >= maxFiles) break
  }
  return targets
}

export function hasMultipleOpenEditorTargets(targetFiles = []) {
  return Array.isArray(targetFiles) && targetFiles.length > 1
}

export function formatOpenEditorTargetList(targetFiles = []) {
  return (targetFiles || [])
    .map(path => normalizeOpenEditorPath(path))
    .filter(Boolean)
    .map((path, index) => `${index + 1}. ${path}`)
    .join('\n')
}

export function buildOpenEditorTargetInstruction(instruction = '', targetFiles = [], actionLabel = 'AI 任務') {
  const targets = (targetFiles || []).map(normalizeOpenEditorPath).filter(Boolean)
  const userInstruction = String(instruction || '').trim() || `請執行${actionLabel}。`
  if (!hasMultipleOpenEditorTargets(targets)) return userInstruction

  const label = String(actionLabel || '')
  const actionRules = /錯誤偵測|detect/i.test(label)
    ? [
        '逐一檢查每一個目標檔案，只產出錯誤與風險報告。',
        '不可修改檔案、不可產生 Diff，也不可把未列出的檔案納入掃描範圍。',
      ]
    : /錯誤修正|fix/i.test(label)
    ? [
        '逐一檢查每一個目標檔案；有錯誤就做最小必要修改，沒有錯誤就保持內容不變並回報具體原因。',
        '不可只修 active tab，也不可因其中一個檔案有錯就略過其他已開啟檔案。',
      ]
    : [
        '所有目標檔案都必須讀取並一起納入判斷；執行程式碼改寫時，每一個目標都必須產生與原內容不同的實際改寫，不可只改第一個檔案。',
      ]

  return [
    `${actionLabel}：請把「目前程式碼編輯器已開啟的所有檔案」當成同一批目標檔案，不要只處理 active tab。`,
    ...actionRules,
    '',
    '目標檔案：',
    formatOpenEditorTargetList(targets),
    '',
    `使用者原始需求：${userInstruction}`,
  ].join('\n')
}
