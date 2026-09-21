export function hasWorkspaceExplorerContext(workspace = {}) {
  return Boolean(
    workspace?.text ||
    workspace?.error ||
    workspace?.projectName ||
    (Array.isArray(workspace?.tree) && workspace.tree.length) ||
    (Array.isArray(workspace?.files) && workspace.files.length)
  )
}

export function createWorkspaceContextRecord(workspace = {}) {
  if (!hasWorkspaceExplorerContext(workspace)) return null

  const projectName = String(workspace.projectName || 'opened_workspace').trim()
  const content = String(workspace.text || '').trim() || [
    `Project: ${projectName}`,
    workspace.error ? `Error: ${workspace.error}` : '',
    Array.isArray(workspace.tree) ? `Tree items: ${workspace.tree.length}` : '',
    Array.isArray(workspace.files) ? `Read files: ${workspace.files.length}` : '',
  ].filter(Boolean).join('\n')

  return {
    ok: true,
    file_path: '__workspace__/opened_folder_context.md',
    content,
    original_chars: content.length,
    source: 'workspace_explorer',
    content_type: 'workspace_summary',
    priority: 115,
    role: 'opened_folder',
    max_chars_per_file: 30000,
  }
}

export function isWorkspaceRepairRequest(instruction = '') {
  const text = String(instruction || '')
  const mentionsWorkspace = /(資料夾|專案|工作區|檔案總管|整個|folder|project|workspace)/i.test(text)
  const asksRepair = /(自動.*(處理|修復|修正|補齊|建立|新增)|缺少|缺檔|缺套件|缺安裝|安裝|依賴|套件|dependency|package|requirements|錯誤|error|巡檢|健檢|repair|fix|setup)/i.test(text)
  const reportOnly = /(不要修改|不要直接修改|只列出|只分析|只檢查|only list|advice only|no modify)/i.test(text)
  return mentionsWorkspace && asksRepair && !reportOnly
}

export function buildAutoWorkspaceRepairInstruction(instruction = '') {
  const userInstruction = String(instruction || '').trim() || '請自動巡檢目前開啟的資料夾，補齊缺少的專案檔案與設定。'
  return [
    'Auto 專案巡檢與修復模式。',
    '請根據檔案總管目前開啟的資料夾內容、專案樹、README、package/requirements/config 與已提供的上下文，自動判斷：',
    '- 是否有資料檔案或程式檔案錯誤',
    '- 是否缺少必要檔案、設定檔、測試、README 或範例',
    '- 是否缺少套件依賴或安裝設定',
    '- 是否需要新增或更新 package.json、requirements.txt、pyproject.toml、vite/config、測試檔或啟動說明',
    '可以新增或修改必要的文字/程式/設定檔；不要建立無關固定範本，不要編造不存在的資料。',
    '如果需要安裝套件，請優先更新依賴清單或建立安裝說明，並列出使用者可執行的命令；不要假裝已經執行安裝。',
    '',
    `使用者原始需求：${userInstruction}`,
  ].join('\n')
}
