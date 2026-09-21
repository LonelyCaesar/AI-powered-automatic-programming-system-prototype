const { makeInlineDiffFromContent, makeInlineDiff, applyInlineEdit } = require('./codingServices')
const { askLlm } = require('../core/llmClient')
const { formatContextFiles } = require('./contextManager')
const { readFile, writeFile, deleteFile, normalizePath, listProjectTree } = require('../tools/fileTools')
const { stripCodeFences } = require('../tools/diffTools')
const { runTests } = require('../tools/testRunner')
const { collectRelatedContext } = require('./relatedContextService')
const { getFeaturePrompt } = require('./featureOptionsService')

const STATIC_WEB_ASSET_EXTENSIONS = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.json'])

function summarizeTestFailure(test = {}) {
  const lines = `${test.stderr || ''}\n${test.stdout || ''}`
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  const patterns = [
    /SyntaxError:/i,
    /JSONError:/i,
    /ModuleNotFoundError:/i,
    /ImportError:/i,
    /NameError:/i,
    /AssertionError:/i,
    /ERROR collecting/i,
    /FAILED/i,
    /not found/i,
  ]
  for (const pattern of patterns) {
    const matched = [...lines].reverse().find(line => pattern.test(line))
    if (matched) return matched.replace(/^E\s+/, '').slice(0, 300)
  }
  return (lines.at(-1) || `Exit Code ${test.exitCode ?? test.returncode ?? -1}`).slice(0, 300)
}

function configuredModelLabel() {
  try {
    const { getModelSettings } = require('./modelSettings')
    const settings = getModelSettings()
    return settings.modelSource === 'cloud_api'
      ? (settings.cloudModel || 'cloud_api')
      : (settings.ollamaModel || 'local_ollama')
  } catch {
    return 'local_ollama'
  }
}

function testLabels(test) {
  if (test.validation_limited && test.environment_blocked) {
    return {
      content: '已套用修改；Python 語法檢查通過，但 Docker 沙盒目前無法安裝外部依賴或連線，因此略過完整 runtime 驗證。',
      model: 'docker_sandbox',
      runLabel: '執行有限驗證',
      resultDetail: '語法通過；外部依賴驗證受限',
    }
  }
  if (test.kind === 'multi_file') {
    return {
      content: test.returncode === 0
        ? `已逐檔實際驗證 ${test.passed}/${test.total} 個修改檔案。`
        : `多檔驗證失敗：${test.passed} 個通過、${test.failed} 個失敗。`,
      model: 'docker_sandbox',
      runLabel: '逐檔驗證所有修改檔案',
      resultDetail: `${test.passed}/${test.total} 個檔案驗證通過`,
    }
  }
  if (test.kind === 'python_syntax') {
    const isSuccess = (test.exitCode ?? test.returncode) === 0
    return {
      content: isSuccess ? 'Python 專案語法檢查通過。' : `Python 語法檢查失敗：${summarizeTestFailure(test)}`,
      model: 'docker_sandbox',
      runLabel: '執行 Python 語法檢查',
      resultDetail: isSuccess ? '語法檢查通過' : summarizeTestFailure(test),
    }
  }
  if (test.kind === 'node_syntax') {
    const isSuccess = (test.exitCode ?? test.returncode) === 0
    return {
      content: isSuccess ? 'Node.js / JSON 專案語法檢查通過。' : `Node.js / JSON 語法檢查失敗：${summarizeTestFailure(test)}`,
      model: 'docker_sandbox',
      runLabel: '執行 Node.js / JSON 語法檢查',
      resultDetail: isSuccess ? '語法檢查通過' : summarizeTestFailure(test),
    }
  }
  if (test.kind === 'javascript_jsx_syntax') {
    const isSuccess = (test.exitCode ?? test.returncode) === 0
    return {
      content: isSuccess ? 'React / JSX 語法檢查通過。' : `React / JSX 語法檢查失敗：${summarizeTestFailure(test)}`,
      model: 'javascript_jsx_parser',
      runLabel: '執行 React / JSX 語法檢查',
      resultDetail: isSuccess ? '語法檢查通過' : summarizeTestFailure(test),
    }
  }
  if (test.kind === 'project_check') {
    return {
      content: '全專案語法、測試與建置檢查已通過。',
      model: 'docker_sandbox',
      runLabel: '執行全專案檢查',
      resultDetail: `${test.checks?.length || test.total || 0} 個檢查通過`,
    }
  }
  if (test.kind === 'pytest') {
    const isSuccess = (test.exitCode ?? test.returncode) === 0
    return {
      content: isSuccess ? '專案 pytest 測試已在 Docker 沙盒全部通過。' : `專案 pytest 測試仍有失敗：${summarizeTestFailure(test)}`,
      model: 'docker_sandbox',
      runLabel: '執行專案 pytest',
      resultDetail: `${test.passed} passed / ${test.failed} failed`,
    }
  }
  if (test.kind === 'python') {
    const isSuccess = (test.exitCode ?? test.returncode) === 0
    return {
      content: isSuccess ? 'Python 程式在 Docker 沙盒執行成功。' : 'Python 程式在 Docker 沙盒執行失敗。',
      model: 'docker_sandbox',
      runLabel: '執行 Python',
      resultDetail: isSuccess ? '執行成功' : `Exit Code ${test.exitCode ?? test.returncode}`,
    }
  }
  if (test.kind === 'python_long_running') {
    const isSuccess = (test.exitCode ?? test.returncode) === 0
    const seconds = Number(test.sandbox?.smoke_seconds || 3)
    return {
      content: isSuccess
        ? `長時間執行 Python 程式已在 Docker 沙盒完成 ${seconds} 秒真實存活與輸出驗證。`
        : `長時間執行 Python 程式驗證失敗：${summarizeTestFailure(test)}`,
      model: 'docker_sandbox',
      runLabel: '執行長時間 Python 存活測試',
      resultDetail: isSuccess ? `${seconds} 秒內持續執行且產生真實輸出` : summarizeTestFailure(test),
    }
  }
  if (test.kind === 'node') {
    const isSuccess = (test.exitCode ?? test.returncode) === 0
    return {
      content: isSuccess ? 'Node.js 程式在 Docker 沙盒執行成功。' : 'Node.js 程式在 Docker 沙盒執行失敗。',
      model: 'docker_sandbox',
      runLabel: '執行 Node.js',
      resultDetail: isSuccess ? '執行成功' : `Exit Code ${test.exitCode ?? test.returncode}`,
    }
  }
  if (test.kind === 'java') {
    const isSuccess = (test.exitCode ?? test.returncode) === 0
    return {
      content: isSuccess ? 'Java 程式在 Docker 沙盒編譯與執行成功。' : 'Java 程式在 Docker 沙盒執行失敗。',
      model: 'docker_sandbox',
      runLabel: 'Docker 執行 Java',
      resultDetail: isSuccess ? '執行成功' : `Exit Code ${test.exitCode ?? test.returncode}`,
    }
  }
  if (test.kind === 'database') {
    const isSuccess = (test.exitCode ?? test.returncode) === 0
    return {
      content: isSuccess ? '資料庫檔案已在 Docker 沙盒完成 SQLite 隔離驗證。' : '資料庫在 Docker 沙盒驗證失敗。',
      model: 'docker_sandbox',
      runLabel: 'Docker 驗證資料庫',
      resultDetail: isSuccess ? '資料庫驗證成功' : `Exit Code ${test.exitCode ?? test.returncode}`,
    }
  }
  if (test.kind === 'html_check') {
    const isSuccess = (test.exitCode ?? test.returncode) === 0
    return {
      content: isSuccess ? 'HTML/CSS/JS 靜態檢查與語法檢查通過。' : 'HTML/CSS/JS 靜態檢查或語法檢查失敗。',
      model: 'docker_sandbox',
      runLabel: '靜態網頁檢查',
      resultDetail: isSuccess ? '檢查通過' : '檢查失敗',
    }
  }

  if (test.kind === 'frontend_static') {
    return {
      content: test.returncode === 0 ? '前端靜態檔案檢查通過；JS 語法檢查通過。' : '前端靜態檔案檢查未通過。',
      model: 'frontend_static_check',
      runLabel: '執行 frontend static check',
      resultDetail: test.returncode === 0 ? '前端靜態檔案檢查通過' : `${test.passed} passed / ${test.failed} failed`,
    }
  }
  if (test.kind === 'npm_test') {
    return {
      content: test.returncode === 0 ? 'npm test 執行通過。' : 'npm test 執行失敗。',
      model: 'npm_test',
      runLabel: '執行 npm test',
      resultDetail: `${test.passed} passed / ${test.failed} failed`,
    }
  }
  if (test.kind === 'npm_build') {
    return {
      content: test.returncode === 0 ? 'npm run build 執行通過。' : `npm run build 執行失敗：${summarizeTestFailure(test)}`,
      model: 'npm_build',
      runLabel: '執行 npm run build',
      resultDetail: test.returncode === 0 ? '建置通過' : summarizeTestFailure(test),
    }
  }
  if (test.kind === 'no_test_command') {
    return {
      content: test.stdout.trim(),
      model: 'test_dispatcher',
      runLabel: '判斷測試類型',
      resultDetail: '未設定可執行測試，未執行 pytest',
    }
  }

  if (test.kind === 'terminal_hint') {
    const framework = test.sandbox?.framework || ''
    const appLabel = framework === 'streamlit' ? 'Streamlit 網頁應用' : '互動式程式'
    return {
      content: framework
        ? `${appLabel}已準備完成，系統會在 AI Docker Sandbox 隔離執行。`
        : test.stdout.trim(),
      model: 'terminal_hint',
      runLabel: framework ? `準備 ${appLabel}` : '提示網頁內終端機執行',
      resultDetail: framework ? '已切換到本網頁終端機並準備自動執行' : '已阻止用系統預設程式開啟程式碼檔',
    }
  }

  if (test.kind === 'app_launch') {
    const launchType = test.launch_type || test.sandbox?.launch_type || 'default_app'
    const labelMap = {
      static_website: '開啟網站',
      npm_web_app: '啟動前端專案',
      streamlit_web_app: '啟動 Streamlit 網頁應用',
      gui_web_app: '在 Docker + Xvfb 背景啟動 Python GUI',
      python_script: '啟動 Python 程式',
      node_script: '啟動 Node.js 程式',
      default_app: '用預設程式開啟檔案',
    }
    const label = labelMap[launchType] || '開啟程式'
    return {
      content: test.returncode === 0 ? `已${label}，可直接使用。` : `${label}失敗。`,
      model: configuredModelLabel(),
      source: 'app_launcher',
      runLabel: label,
      resultDetail: test.returncode === 0 ? '已開啟，可直接使用' : '啟動失敗',
    }
  }
  if (test.kind === 'python_gui') {
    return {
      content: test.returncode === 0
        ? 'Python GUI 已在 Docker + Xvfb 完成隔離啟動驗證。'
        : 'Python GUI 啟動驗證失敗。',
      model: 'docker_sandbox',
      runLabel: 'Docker / Xvfb 驗證 Python GUI',
      resultDetail: test.returncode === 0 ? 'GUI 隔離啟動驗證成功' : 'Python GUI 啟動失敗',
    }
  }
  return {
    content: 'Node.js Agent 已執行 pytest。',
    model: 'pytest',
    runLabel: '執行 pytest',
    resultDetail: `${test.passed} passed / ${test.failed} failed`,
  }
}

function testReturnCode(test = {}) {
  return Number(test.returncode ?? test.exitCode ?? (test.ok === true ? 0 : 1))
}

function combineMultiFileTestResults(records = []) {
  if (records.length === 1) {
    return {
      ...records[0].test,
      target_files: [records[0].path],
      results: records,
    }
  }
  const failedRecords = records.filter(record => testReturnCode(record.test) !== 0)
  const passed = records.length - failedRecords.length
  const command = records.map(record => `${record.path}: ${record.test.command || 'no command'}`).join('\n')
  const outputFor = key => records
    .map(record => String(record.test[key] || '').trim() ? `===== ${record.path} =====\n${String(record.test[key]).trim()}` : '')
    .filter(Boolean)
    .join('\n\n')
  return {
    ok: failedRecords.length === 0,
    kind: 'multi_file',
    command,
    commands: records.map(record => record.test.command).filter(Boolean),
    returncode: failedRecords.length ? 1 : 0,
    exitCode: failedRecords.length ? 1 : 0,
    stdout: outputFor('stdout'),
    stderr: outputFor('stderr'),
    elapsed_seconds: records.reduce((sum, record) => sum + Number(record.test.elapsed_seconds || 0), 0),
    passed,
    failed: failedRecords.length,
    total: records.length,
    target_files: records.map(record => record.path),
    results: records,
    messages: records.map(record => `${record.path}: ${testReturnCode(record.test) === 0 ? '驗證通過' : '驗證失敗'}`),
    sandbox: {
      engine: 'docker',
      launch_type: 'multi_file_validation',
      runtime_mode: 'docker',
      isolated: records.every(record => record.test.sandbox?.isolated !== false),
      status: failedRecords.length ? 'failed' : 'ready',
      executions: records.map(record => ({
        path: record.path,
        kind: record.test.kind,
        command: record.test.command,
        returncode: testReturnCode(record.test),
      })),
    },
  }
}

function pathDirname(filePath = '') {
  const normalized = normalizePath(filePath)
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(0, index) : ''
}

function pathBasename(filePath = '') {
  const normalized = normalizePath(filePath)
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(index + 1) : normalized
}

function pathExtension(filePath = '') {
  const basename = pathBasename(filePath)
  const index = basename.lastIndexOf('.')
  return index >= 0 ? basename.slice(index).toLowerCase() : ''
}

function staticWebsiteValidationTarget(item = {}, fileItems = [], contextFiles = []) {
  const itemPath = normalizePath(item.path || item.file_path || '')
  const extension = pathExtension(itemPath)
  if (!STATIC_WEB_ASSET_EXTENSIONS.has(extension)) return null

  const itemDir = pathDirname(itemPath)
  const normalizeContextPath = entry => normalizePath(entry?.path || entry?.file_path || '')
  const isSameDirHtml = candidatePath => {
    const normalized = normalizePath(candidatePath)
    return pathDirname(normalized) === itemDir && /\.html?$/i.test(pathBasename(normalized))
  }
  const isIndex = candidatePath => /^index\.html?$/i.test(pathBasename(candidatePath))
  const referencesItem = candidate => {
    const html = String(candidate?.content || '')
    if (!html || !itemPath || /\.html?$/i.test(extension)) return false
    const baseName = pathBasename(itemPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?:href|src)\\s*=\\s*["'][^"']*${baseName}(?:[?#][^"']*)?["']`, 'i').test(html)
  }
  const sameDirHtml = [
    ...fileItems
      .filter(candidate => isSameDirHtml(candidate.path || candidate.file_path))
      .map(candidate => ({ ...candidate, file_path: candidate.path || candidate.file_path })),
    ...contextFiles
      .filter(candidate => isSameDirHtml(normalizeContextPath(candidate)))
      .map(candidate => ({ ...candidate, file_path: normalizeContextPath(candidate) })),
  ]
  const entry = sameDirHtml.find(candidate => normalizeContextPath(candidate).toLowerCase() === itemPath.toLowerCase())
    || sameDirHtml.find(referencesItem)
    || sameDirHtml.find(candidate => isIndex(normalizeContextPath(candidate)))
    || sameDirHtml[0]

  if (!entry) {
    return /\.html?$/i.test(pathBasename(itemPath))
      ? { key: `static:${itemPath}`, path: itemPath, content: item.content }
      : null
  }

  const entryPath = normalizeContextPath(entry)
  return {
    key: `static:${entryPath}`,
    path: entryPath,
    content: entry.content,
  }
}

async function runTestsForFileItems(fileItems = [], contextFiles = [], options = {}) {
  const records = []
  const cachedValidations = new Map()
  for (const item of fileItems) {
    const staticTarget = staticWebsiteValidationTarget(item, fileItems, contextFiles)
    const cacheKey = staticTarget?.key || ''
    let test = cacheKey ? cachedValidations.get(cacheKey) : null
    if (!test) {
      test = await runTests(staticTarget?.path || item.path, staticTarget ? staticTarget.content : item.content, null, contextFiles, {
        ...options,
        projectWide: false,
        preferProjectTests: false,
        validateTargetRuntime: false,
        targetOnly: false,
        staticHtmlCheck: Boolean(staticTarget),
      })
      test = sanitizeDisplayStderr(test)
      if (cacheKey) cachedValidations.set(cacheKey, test)
    }
    records.push({ path: item.path, test })
  }
  return { test: combineMultiFileTestResults(records), records }
}

function multiFileEvidenceSteps(records = [], options = {}) {
  const paths = records.map(record => record.path)
  const steps = [
    { label: '1 讀取全部修改檔案', status: 'done', detail: paths.join('、') },
  ]
  if (options.applied) {
    steps.push({ label: '2 一次套用全部變更', status: 'done', detail: paths.join('、') })
  }
  const offset = steps.length + 1
  records.forEach((record, index) => {
    const ok = testReturnCode(record.test) === 0
    steps.push({
      label: `${offset + index} 驗證 ${record.path}`,
      status: ok ? 'done' : 'failed',
      detail: `${record.test.command || '未偵測到指令'}｜${testLabels(record.test).resultDetail}`,
    })
  })
  const passed = records.filter(record => testReturnCode(record.test) === 0).length
  steps.push({
    label: `${steps.length + 1} 顯示全部結果`,
    status: passed === records.length ? 'done' : 'failed',
    detail: `通過 ${passed}/${records.length}倁檔案`,
  })
  return steps
}


function inlineActionLabel(task = '') {
  const text = String(task || '')
  if (/錯誤修正|修正|fix|bug|error|錯誤|語法|失敗|frontend static|node --check/i.test(text)) return '錯誤修正'
  if (/重構|refactor|改寫|rewrite|優化|可讀性/i.test(text)) return '程式碼改寫'
  return '編輯修正'
}

function defaultSteps(filePath, pending = true) {
  return [
    { label: '1 讀檔', status: 'done', detail: `已讀取 ${filePath || 'current_file.py'}` },
    { label: '2 產生修改建議', status: pending ? 'done' : 'pending', detail: '由 Node.js Agent 呼叫模型分析' },
    { label: '3 產生 Diff', status: pending ? 'done' : 'pending', detail: '已產生紅綠 Diff，等待確認' },
    { label: '4 套用', status: 'pending', detail: '等待人工確認' },
    { label: '5 執行測試', status: 'pending', detail: '套用後依專案類型執行' },
    { label: '6 顯示結果', status: 'pending', detail: '等待測試結果' },
  ]
}

async function prepareAgentFix(task, filePath, code = null, contextFiles = []) {
  const target = normalizePath(filePath || 'current_file.py')
  const oldContent = code !== null && code !== undefined ? String(code) : readFile(target)
  const result = await makeInlineDiffFromContent(target, task, oldContent, '', contextFiles, '/api/agent/prepare-fix', { operation: 'fix' })
  return {
    type: 'agent_prepare_fix',
    ok: result.ok,
    pending_approval: Boolean(result.ok && !result.no_change),
    file_path: result.file_path || target,
    old_content: result.old_content ?? oldContent,
    new_content: result.new_content || oldContent,
    diff_text: result.diff || '',
    diff: result,
    model: result.model || 'local_ollama',
    source: result.source || 'node_agent',
    tokens: result.tokens || 0,
    content: result.ok ? 'Agent 已產生修改建議，等待使用者確認後才套用。' : (result.error || 'Agent 未產生可套用 Diff'),
    steps: result.ok ? defaultSteps(target, true) : defaultSteps(target, false).map((step, index) => index === 1 ? { ...step, status: 'failed', detail: result.error || '產生失敗' } : step),
    checked_files: Array.isArray(result.checked_files) ? result.checked_files : [target],
    modified_files: Array.isArray(result.modified_files) ? result.modified_files : (result.ok ? [result.file_path || target] : []),
    extra_files: Array.isArray(result.extra_files) ? result.extra_files : [],
    no_change: result.no_change === true,
    file_results: Array.isArray(result.file_results) ? result.file_results : [],
  }
}

async function prepareInlineCommand(task, filePath, selectedCode = '', code = null, contextFiles = [], options = {}) {
  const target = normalizePath(filePath || 'current_file.py')
  const oldContent = code !== null && code !== undefined ? String(code) : readFile(target)
  const operation = options.operation === 'fix' ? 'fix' : 'rewrite'
  const allowedRewritePaths = operation === 'rewrite'
    ? [...new Set([target, ...(options.allowedEditPaths || [])].map(normalizePath).filter(Boolean))]
    : []
  const effectiveTask = operation === 'rewrite'
    ? (String(task || '').trim() || '提升可讀性與程式結構清晰度，保留原本功能，只做最小必要修改。')
    : task
  const relatedContext = operation === 'rewrite'
    ? collectRelatedContext({
        filePath: target,
        code: oldContent,
        instruction: effectiveTask,
        contextFiles,
        maxFiles: 16,
        maxChars: 100000,
      })
    : null
  const effectiveContextFiles = relatedContext
    ? (allowedRewritePaths.length > 1 ? contextFiles : relatedContext.files)
      .filter(item => normalizePath(item.file_path || item.path || '').toLowerCase() !== target.toLowerCase())
    : contextFiles
  const result = await makeInlineDiffFromContent(
    target,
    effectiveTask,
    oldContent,
    selectedCode || '',
    effectiveContextFiles,
    '/api/agent/inline-command',
    {
      operation,
      relatedContext,
      allowedEditPaths: operation === 'rewrite' ? allowedRewritePaths : (options.allowedEditPaths || []),
      requireEveryAllowedEditPath: operation === 'rewrite' && allowedRewritePaths.length > 1,
      returnOnlyAllowedEditPaths: options.returnOnlyAllowedEditPaths === true,
    }
  )
  const label = inlineActionLabel(effectiveTask)
  const checkedFiles = Array.isArray(result.checked_files) && result.checked_files.length
    ? result.checked_files
    : [target]
  const modifiedFiles = Array.isArray(result.modified_files)
    ? result.modified_files
    : (result.ok ? [result.file_path || target] : [])
  return {
    type: 'inline_command',
    ok: result.ok,
    pending_approval: Boolean(result.ok && !result.no_change),
    file_path: result.file_path || target,
    selected_chars: String(selectedCode || '').length,
    old_content: result.old_content ?? oldContent,
    new_content: result.new_content || oldContent,
    diff_text: result.diff || '',
    diff: result,
    model: result.model || 'local_ollama',
    source: result.source || 'inline_command',
    tokens: result.tokens || 0,
    content: result.ok
      ? (result.content || `Ollama 已一次檢查 ${checkedFiles.join('、')}；實際修改 ${modifiedFiles.join('、')}。`)
      : (result.error || 'Inline Command 未產生 Diff'),
    checked_files: checkedFiles,
    modified_files: modifiedFiles,
    extra_files: Array.isArray(result.extra_files) ? result.extra_files : [],
    no_change: result.no_change === true,
    file_results: Array.isArray(result.file_results) ? result.file_results : [],
    steps: [
      { label: '1 取得主要修正檔案', status: 'done', detail: checkedFiles.join('、') },
      { label: `2 ${label}`, status: result.ok ? 'done' : 'failed', detail: effectiveTask },
      { label: '3 產生多檔 Diff', status: result.ok ? 'done' : 'failed', detail: result.no_change ? '逐檔檢查完成，沒有需要修改的檔案' : (result.ok ? `實際修改：${modifiedFiles.join('、')}` : (result.error || result.content || '未產生 Diff')) },
      { label: '4 確認套用', status: result.no_change ? 'done' : 'pending', detail: result.no_change ? '沒有變更，無需套用' : '等待人工確認' },
      { label: '5 執行測試', status: 'pending', detail: '尚未執行' },
      { label: '6 Audit Log', status: 'pending', detail: '等待寫入操作紀錄' },
    ],
    rewrite_goal: result.rewrite_goal,
    file_reasons: result.file_reasons,
    main_changes: result.main_changes,
    preserved_behavior: result.preserved_behavior,
    needs_confirmation: result.needs_confirmation,
    related_files: result.related_files,
    context_coverage: result.context_coverage,
    unresolved_references: result.unresolved_references,
  }
}

async function runAgent(task, filePath, code = null, contextFiles = [], options = {}) {
  const target = normalizePath(filePath || 'current_file.py')
  const requestedTargets = [...new Set([
    target,
    ...(options.validateEveryTarget === true && Array.isArray(options.targetFiles) ? options.targetFiles : []),
  ].map(normalizePath).filter(Boolean))]
  const contextByPath = new Map((contextFiles || []).map(item => [
    normalizePath(item?.file_path || item?.path || '').toLowerCase(),
    String(item?.content || ''),
  ]))
  const fileItems = requestedTargets.map(path => ({
    path,
    content: path.toLowerCase() === target.toLowerCase()
      ? code
      : (contextByPath.has(path.toLowerCase()) ? contextByPath.get(path.toLowerCase()) : null),
  }))
  const execution = requestedTargets.length > 1
    ? await runTestsForFileItems(fileItems, contextFiles, options)
    : { test: await runTests(target, code, null, contextFiles, options), records: [] }
  const test = sanitizeDisplayStderr(execution.test)
  const records = execution.records.length
    ? execution.records.map(record => ({ ...record, test: sanitizeDisplayStderr(record.test) }))
    : [{ path: target, test }]
  const labels = testLabels(test)
  return {
    type: 'agent_test_only',
    ok: test.returncode === 0,
    file_path: target,
    content: labels.content,
    model: labels.model,
    source: 'node_child_process',
    tokens: 0,
    test,
    passed: test.passed,
    failed: test.failed,
    total: test.total,
    applied: true,
    steps: requestedTargets.length > 1
      ? multiFileEvidenceSteps(records)
      : [
          { label: '1 讀檔', status: 'done', detail: target },
          { label: `2 ${labels.runLabel}`, status: test.returncode === 0 ? 'done' : 'failed', detail: test.command },
          { label: '3 顯示結果', status: 'done', detail: labels.resultDetail },
        ],
  }
}

function isEnvironmentBlockedTest(test = {}) {
  const output = `${test.stderr || ''}\n${test.stdout || ''}`
  const code = Number(test.exitCode ?? test.returncode)
  if (/(?:SyntaxError|IndentationError|TabError|NameError):/i.test(output)) return false
  return code === 69 || /CUBI_ENVIRONMENT_BLOCKED|Docker 沙盒網路已停用|無法安裝(?:缺少套件|外部依賴| requirements\.txt)/i.test(output)
}

function sanitizeDisplayStderr(test = {}) {
  const stderr = String(test.stderr || '').trim()
  if (!stderr) return test
  const output = `${stderr}\n${test.stdout || ''}`
  if (/(?:SyntaxError|IndentationError|TabError|NameError):/i.test(output)) return test
  const externalServiceNoise = /could not resolve host|failed to get ticker|guce\.yahoo\.com|yfinance|curl error|possibly delisted/i.test(stderr)
  const environmentHint = /CUBI_ENVIRONMENT_BLOCKED|Docker 沙盒網路已停用|無法安裝(?:缺少套件|外部依賴| requirements\.txt)/i.test(output)
  const passed = test.ok === true || Number(test.returncode ?? test.exitCode) === 0
  const environmentLimited = test.environment_blocked === true || test.validation_limited === true || environmentHint
  if (!externalServiceNoise || !(passed || environmentLimited)) return test
  return {
    ...test,
    stderr: '',
    suppressed_stderr: stderr,
    suppressed_stderr_reason: 'external_network_noise',
  }
}

async function applyAgentFixAndTest(filePath, newContent, extraFiles = []) {
  const target = normalizePath(filePath || 'current_file.py')
  const requestedFiles = [
    { path: target, content: String(newContent || ''), kind: 'primary' },
    ...(Array.isArray(extraFiles) ? extraFiles : [])
      .filter(item => item?.path)
      .map(item => ({ ...item, path: normalizePath(item.path), content: String(item.content || '') })),
  ]
  const snapshots = requestedFiles.map(item => {
    try {
      return { path: item.path, existed: true, content: readFile(item.path) }
    } catch {
      return { path: item.path, existed: false, content: '' }
    }
  })
  const rollback = () => {
    const restored = []
    for (const snapshot of [...snapshots].reverse()) {
      try {
        if (snapshot.existed) writeFile(snapshot.path, snapshot.content)
        else deleteFile(snapshot.path)
        restored.push(snapshot.path)
      } catch {
        // 個別 rollback 失敗會在回傳結果中保留，避免誤稱全部恢復。
      }
    }
    return restored
  }

  let apply
  const createdExtra = []
  try {
    apply = applyInlineEdit(target, newContent)
    for (const item of requestedFiles.slice(1)) {
      writeFile(item.path, item.content)
      createdExtra.push({
        path: item.path,
        kind: item.kind || 'source',
        description: item.description || 'Ollama 同次產生的多檔修正',
        status: item.status || 'modified',
      })
    }
  } catch (error) {
    const restoredFiles = rollback()
    return {
      type: 'agent_apply_and_test',
      ok: false,
      file_path: target,
      content: `寫入變更失敗，已回復 ${restoredFiles.length}/${snapshots.length} 個檔案：${error.message}`,
      source: 'node_express_agent',
      tokens: 0,
      apply: { ok: false, error: error.message },
      applied: false,
      rolled_back: true,
      restored_files: restoredFiles,
      extra_files: [],
      passed: 0,
      failed: 1,
      total: 1,
    }
  }
  const appliedFiles = [target, ...createdExtra.map(item => item.path)]
  const testContextFiles = requestedFiles.map(item => ({
    ok: true,
    file_path: item.path,
    content: item.content,
    role: 'task_target',
  }))
  const execution = requestedFiles.length > 1
    ? await runTestsForFileItems(requestedFiles, testContextFiles, { workspaceSource: 'backend' })
    : {
        test: await runTests(target, newContent, null, testContextFiles, {
          workspaceSource: 'backend',
          projectWide: false,
          preferProjectTests: false,
          validateTargetRuntime: false,
          targetOnly: false,
        }),
        records: [],
      }
  const test = sanitizeDisplayStderr(execution.test)
  const records = execution.records.length
    ? execution.records.map(record => ({ ...record, test: sanitizeDisplayStderr(record.test) }))
    : [{ path: target, test }]
  const testPassed = test.returncode === 0
  const environmentBlocked = !testPassed && isEnvironmentBlockedTest(test)
  let limitedValidation = null
  if (environmentBlocked) {
    limitedValidation = await runTests(target, newContent, null, testContextFiles, {
      workspaceSource: 'backend',
      projectWide: true,
      preferProjectTests: false,
      validateTargetRuntime: false,
    })
  }
  const limitedValidationPassed = environmentBlocked && limitedValidation?.ok === true
  const effectiveTest = limitedValidationPassed
    ? {
        ...limitedValidation,
        kind: 'limited_environment_validation',
        command: limitedValidation.command || test.command,
        stdout: [
          limitedValidation.stdout || '',
          'CUBI_ENVIRONMENT_BLOCKED：完整 runtime 驗證需要外部依賴或網路；已保留修改並停止自動回修。',
        ].filter(Boolean).join('\n'),
        stderr: limitedValidation.stderr || '',
        environment_blocked: true,
        validation_limited: true,
        blocked_test: test,
      }
    : test
  const labels = testLabels(effectiveTest)
  const effectivePassed = testPassed || limitedValidationPassed
  const restoredFiles = effectivePassed ? [] : rollback()
  return {
    type: 'agent_apply_and_test',
    ok: effectivePassed,
    file_path: target,
    content: effectivePassed
      ? `已一次套用檔案：${appliedFiles.join('、')}。${labels.content}`
      : `套用後測試失敗，已自動回復 ${restoredFiles.length}/${snapshots.length} 個檔案。${labels.content}`,
    model: labels.model,
    source: 'node_express_agent',
    tokens: 0,
    apply,
    applied: effectivePassed,
    rolled_back: !effectivePassed,
    restored_files: restoredFiles,
    test: effectiveTest,
    passed: effectiveTest.passed,
    failed: effectiveTest.failed,
    total: effectiveTest.total,
    environment_blocked: effectiveTest.environment_blocked === true,
    validation_limited: effectiveTest.validation_limited === true,
    extra_files: createdExtra,
    steps: requestedFiles.length > 1
      ? multiFileEvidenceSteps(records, { applied: true })
      : [
          { label: '1 讀檔', status: 'done', detail: target },
          { label: '2 產生修改建議', status: 'done', detail: '已於前一步完成' },
          { label: '3 產生 Diff', status: 'done', detail: '已確認' },
          { label: '4 一次套用', status: effectivePassed ? 'done' : 'failed', detail: effectivePassed ? appliedFiles.join('、') : `測試失敗，已 rollback：${restoredFiles.join('、')}` },
          { label: `5 ${labels.runLabel}`, status: effectivePassed ? 'done' : 'failed', detail: effectiveTest.command },
          { label: '6 顯示結果', status: 'done', detail: labels.resultDetail },
        ],
  }
}

async function runAgentFixAndTest(task, filePath, code = null) {
  const prepared = await prepareAgentFix(task, filePath, code)
  if (!prepared.ok) return { ...prepared, applied: false, test: null, passed: 0, failed: 1, total: 1 }
  return applyAgentFixAndTest(prepared.file_path, prepared.new_content, prepared.extra_files)
}

function extractBalancedJsonSlice(text, openChar = '{', closeChar = '}') {
  const source = String(text || '')
  const start = source.indexOf(openChar)
  if (start < 0) return ''

  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === openChar) depth += 1
    if (ch === closeChar) depth -= 1
    if (depth === 0) return source.slice(start, i + 1)
  }
  return ''
}

function parseJsonObject(text) {
  const clean = stripCodeFences(text || '').trim()
  const objectSlice = extractBalancedJsonSlice(clean, '{', '}')
  const arraySlice = extractBalancedJsonSlice(clean, '[', ']')
  const candidates = [
    clean,
    objectSlice,
    arraySlice,
    clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1),
    clean.slice(clean.indexOf('['), clean.lastIndexOf(']') + 1),
  ].filter(value => value && value.length > 1)

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // Try the next possible JSON slice.
    }
  }
  return null
}

function safeGeneratedPath(value) {
  const clean = normalizePath(value).replace(/^\.\/+/, '')
  if (!clean) throw new Error('檔案路徑不可空白')
  if (clean.includes('..')) throw new Error(`不允許 .. 路徑：${clean}`)
  if (/^(?:\.git|node_modules|backend\/data)(?:\/|$)/i.test(clean)) {
    throw new Error(`不允許寫入受保護路徑：${clean}`)
  }
  return clean
}

function directoryOf(filePath = '') {
  const clean = normalizePath(filePath).replace(/^\.\/+/, '')
  const parts = clean.split('/').filter(Boolean)
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/')
}

function resolveDefaultDir(options = {}) {
  const rawDir = normalizePath(options.defaultDir || options.default_dir || '').replace(/^\.\/+/, '')
  if (rawDir && !rawDir.includes('..')) return rawDir
  return directoryOf(options.currentFilePath || options.current_file_path || options.activeFilePath || '')
}

function anchorPathToCurrentDir(filePath, defaultDir = '', anchorToCurrentDir = false) {
  const clean = safeGeneratedPath(filePath)
  const dir = normalizePath(defaultDir).replace(/^\.\/+/, '')
  if (!anchorToCurrentDir) {
    if (dir && !clean.includes('/')) return safeGeneratedPath(`${dir}/${clean}`)
    return clean
  }

  const fileName = clean.split('/').filter(Boolean).pop() || clean
  if (!dir) return safeGeneratedPath(fileName)
  if (clean === `${dir}/${fileName}`) return clean
  return safeGeneratedPath(`${dir}/${fileName}`)
}

function inferFileKind(filePath, rawKind = '') {
  const cleanKind = String(rawKind || '').trim().toLowerCase()
  const allowed = new Set(['source', 'test', 'readme', 'config', 'doc', 'example', 'other'])
  if (allowed.has(cleanKind)) return cleanKind

  const lower = String(filePath || '').toLowerCase()
  if (/(^|\/)test_|(\.test|\.spec)\./.test(lower) || lower.startsWith('tests/')) return 'test'
  if (lower.endsWith('readme.md') || lower.includes('/readme')) return 'readme'
  if (lower.startsWith('docs/') || /\.(md|txt)$/.test(lower)) return 'doc'
  if (lower.startsWith('config/') || /\.(json|ya?ml|toml|env)$/.test(lower)) return 'config'
  if (lower.startsWith('examples/')) return 'example'
  if (/\.(py|js|mjs|cjs|jsx|ts|tsx|vue|java|css|html?|sql|db|sqlite3?)$/.test(lower)) return 'source'
  return 'other'
}

function isRuntimeDatabasePath(filePath = '') {
  return /\.(?:db|sqlite|sqlite3)$/i.test(String(filePath || ''))
}

function normalizePlannedFiles(plan, options = {}) {
  const rawFiles = Array.isArray(plan) ? plan : Array.isArray(plan?.files) ? plan.files : []
  const seen = new Set()
  const files = []
  const defaultDir = resolveDefaultDir(options)
  const anchorToCurrentDir = Boolean(options.anchorToCurrentDir || options.anchor_to_current_dir)

  for (const item of rawFiles) {
    if (!item || typeof item !== 'object' || !item.path) continue
    const path = anchorPathToCurrentDir(item.path, defaultDir, anchorToCurrentDir)
    if (isRuntimeDatabasePath(path)) continue
    if (seen.has(path)) continue
    seen.add(path)
    files.push({
      path,
      kind: inferFileKind(path, item.kind),
      description: String(item.description || 'AI 動態規劃產生的檔案').trim(),
      content: String(item.content ?? ''),
    })
  }

  return files
}


function stripGeneratedFileContent(text) {
  return stripCodeFences(String(text || '').trim()).replace(/^```[a-zA-Z0-9_-]*\s*/,'').replace(/```$/,'').trim()
}

function pathMentionClause(text, start, end) {
  const before = text.slice(0, start)
  const after = text.slice(end)
  const beforeBreak = Math.max(
    before.lastIndexOf('\n'),
    before.lastIndexOf('。'),
    before.lastIndexOf('；'),
    before.lastIndexOf(';'),
    before.lastIndexOf('!')
  )
  const afterCandidates = ['\n', '。', '；', ';', '!']
    .map(mark => {
      const index = after.indexOf(mark)
      return index === -1 ? -1 : end + index
    })
    .filter(index => index !== -1)
  const afterBreak = afterCandidates.length ? Math.min(...afterCandidates) : text.length
  return {
    before: text.slice(beforeBreak + 1, start),
    after: text.slice(end, afterBreak),
  }
}

function isExcludedPathMention(text, start, end) {
  const clause = pathMentionClause(text, start, end)
  if (/(不要|不需|不用|不必|別|避免|禁止|排除|不要另外|不要再|do not|don't|without|not use|not create)/i.test(clause.before)) {
    return true
  }
  if (/^\s*(?:的|中|裡|內)/.test(clause.after) && /(整理到|移到|搬到|合併到|放到|寫到|轉到|merge into|move into|copy into)/i.test(clause.after)) {
    return true
  }
  return false
}

function isExplicitFileChangeMention(text, start, end) {
  const clause = pathMentionClause(text, start, end)
  const actionPattern = /(?:建立|新增|產生|生成|創建|寫入|修改|更新|改寫|補充|追加|調整|修正|create|generate|write|modify|update|edit|rewrite|append|fix)/i
  const separatorIndex = Math.max(clause.before.lastIndexOf('，'), clause.before.lastIndexOf(','))
  const localBefore = clause.before.slice(separatorIndex + 1)
  if (actionPattern.test(localBefore)) return true

  const previousText = clause.before.slice(0, separatorIndex + 1)
  const listContinuation = /^\s*(?:和|及|與|and)?\s*$/i.test(localBefore)
  if (listContinuation && actionPattern.test(previousText)) return true

  return /^\s*(?:請)?(?:建立|新增|產生|生成|創建|寫入|修改|更新|改寫|補充|追加|調整|修正|create|generate|write|modify|update|edit|rewrite|append|fix)/i.test(clause.after)
}

function extractExplicitRequestedPaths(task = '') {
  const text = String(task || '')
  const pathPattern = /(^|[\s`'"，、：:；;,\(\)（）\[\]<>])(@?[A-Za-z0-9_.\/-]+\.(?:html?|css|mjs|cjs|js|jsx|ts|tsx|vue|py|java|cs|php|go|rs|cpp|c|h|json|md|txt|sql|db|sqlite|sqlite3|yml|yaml|toml|env|csv))(?=$|[\s`'"，、。．：:；;,\(\)（）\[\]<>])/gi
  const seen = new Set()
  const results = []
  let match
  while ((match = pathPattern.exec(text)) !== null) {
    let raw = String(match[2] || '').trim().replace(/^@/, '').replace(/^\.\/+/, '')
    raw = raw.replace(/[。．，、；;:,]+$/g, '')
    if (!raw || raw.includes('..')) continue
    if (/^(?:https?:|localhost)/i.test(raw)) continue
    const originalPath = String(match[2] || '')
    const pathStart = match.index + match[0].indexOf(originalPath)
    const pathEnd = pathStart + originalPath.length
    if (isExcludedPathMention(text, pathStart, pathEnd)) continue
    if (!isExplicitFileChangeMention(text, pathStart, pathEnd)) continue
    if (seen.has(raw)) continue
    seen.add(raw)
    results.push(raw)
  }
  return results
}

function contextFilePath(item = {}) {
  return normalizePath(item.file_path || item.path || '').replace(/^\.\/+/, '')
}

function pathMatchesRequested(candidate = '', requested = '') {
  const cleanCandidate = normalizePath(candidate).replace(/^\.\/+/, '')
  const cleanRequested = normalizePath(requested).replace(/^\.\/+/, '')
  if (!cleanCandidate || !cleanRequested) return false
  if (cleanCandidate === cleanRequested) return true
  return !cleanRequested.includes('/') && cleanCandidate.split('/').pop() === cleanRequested
}

function targetPathsFromContext(contextFiles = [], options = {}) {
  const paths = []
  const optionTargets = Array.isArray(options.targetFiles)
    ? options.targetFiles
    : Array.isArray(options.target_files)
      ? options.target_files
      : []

  for (const path of optionTargets) {
    const clean = normalizePath(path).replace(/^\.\/+/, '')
    if (clean) paths.push(clean)
  }

  const current = normalizePath(options.currentFilePath || options.current_file_path || options.activeFilePath || '').replace(/^\.\/+/, '')
  if (current) paths.push(current)

  for (const item of Array.isArray(contextFiles) ? contextFiles : []) {
    const role = String(item?.role || '')
    if (!/(active_file|task_target|open_editor_file)/.test(role)) continue
    const filePath = contextFilePath(item)
    if (filePath) paths.push(filePath)
  }

  const seen = new Set()
  return paths
    .map(path => normalizePath(path).replace(/^\.\/+/, ''))
    .filter(path => path && !path.includes('..') && !isRuntimeDatabasePath(path))
    .filter(path => {
      if (seen.has(path)) return false
      seen.add(path)
      return true
    })
}

function generationFailureMessage(errors = [], targetPaths = [], contextFiles = []) {
  const details = errors.filter(Boolean).join('；') || `模型未產生完整內容：${targetPaths.join('、') || '未指定檔案'}`
  const contextPaths = (Array.isArray(contextFiles) ? contextFiles : [])
    .map(contextFilePath)
    .filter(Boolean)
  const visibleTargets = targetPaths.filter(path => contextPaths.some(contextPath => pathMatchesRequested(contextPath, path)))
  if (!visibleTargets.length) return details
  return `${details}；已收到開啟檔案上下文（${visibleTargets.join('、')}），但模型沒有產生可寫入的完整內容。`
}

function mergeFilesByPath(baseFiles = [], additionalFiles = [], options = {}) {
  const defaultDir = resolveDefaultDir(options)
  const anchorToCurrentDir = Boolean(options.anchorToCurrentDir || options.anchor_to_current_dir)
  const map = new Map()

  for (const file of baseFiles) {
    if (!file || !file.path) continue
    const path = anchorPathToCurrentDir(file.path, defaultDir, anchorToCurrentDir)
    if (isRuntimeDatabasePath(path)) continue
    map.set(path, { ...file, path, kind: inferFileKind(path, file.kind) })
  }

  for (const file of additionalFiles) {
    if (!file || !file.path) continue
    const path = anchorPathToCurrentDir(file.path, defaultDir, anchorToCurrentDir)
    if (isRuntimeDatabasePath(path)) continue
    if (map.has(path) && String(map.get(path).content || '').trim()) continue
    map.set(path, { ...file, path, kind: inferFileKind(path, file.kind) })
  }

  return [...map.values()]
}

function fileContentRules(filePath, allPaths = []) {
  const lower = String(filePath || '').toLowerCase()
  const hasCss = allPaths.some(path => /\.css$/i.test(path))
  const hasJs = allPaths.some(path => /\.(?:js|mjs|cjs)$/i.test(path))

  if (/\.html?$/.test(lower)) {
    return [
      'Return HTML only.',
      hasCss ? 'Reference the requested external CSS file. Do not use <style> or style attributes.' : '',
      hasJs ? 'Reference the requested external JavaScript file. Do not use inline scripts or inline event attributes such as onclick.' : '',
      'Use stable ids, classes, and data attributes so the external CSS and JavaScript can target the elements.',
    ].filter(Boolean).join('\n- ')
  }
  if (/\.css$/.test(lower)) {
    return 'Return CSS only. Do not include HTML, PHP, JavaScript, <style> tags, or markdown. Match selectors from the generated HTML.'
  }
  if (/\.(?:js|mjs|cjs)$/.test(lower)) {
    return 'Return JavaScript only. Do not include HTML, CSS, PHP, or markdown. Bind behavior to the ids, classes, and data attributes in the generated HTML.'
  }
  if (/\.py$/.test(lower)) {
    return [
      'Return Python only. Do not include markdown or code fences.',
      'If defining SQLite tables, use standard clean SQL syntax (e.g. CREATE TABLE IF NOT EXISTS ...). Never introduce typos or stray quotes in SQL keywords.',
      'Do not swallow database errors in try...except blocks without re-raising; let exceptions propagate so tests can identify initialization bugs.',
      'If creating database seed data (e.g. seed_data) with autoincrement primary keys, ALWAYS insert explicit fixed IDs (e.g. (1, "Alice", 1000.0), (2, "Bob", 500.0)) or clear sqlite_sequence upon deletion, so repeated test runs (setUp) never alter or shift record IDs.',
      'Unit tests using unittest/pytest must align their queried IDs and expected assertions with the seed data schema and service logic exactly.',
    ].join('\n- ')
  }
  return 'Return only content valid for this file extension.'
}

function generatedFilesPromptContext(generated = []) {
  if (!generated.length) return '(none yet)'
  return generated.map(file => `--- ${file.path} ---\n${String(file.content || '').slice(0, 12000)}`).join('\n\n')
}

function generatedContentIssue(filePath, content, allPaths = []) {
  const value = String(content || '').trim()
  const lower = String(filePath || '').toLowerCase()
  if (!value) return 'The generated file is empty.'
  if (/(?:nthought|<thought|<\/thought>|<analysis|<\/analysis>)/i.test(value)) {
    return 'The generated file contains reasoning or thought text.'
  }
  if (/\.css$/.test(lower) && /(?:<!doctype|<html|<body|<style|<script|<\?php)/i.test(value)) {
    return 'CSS output contains non-CSS markup.'
  }
  if (/\.(?:js|mjs|cjs)$/.test(lower) && /(?:<!doctype|<html|<body|<style|<\?php)/i.test(value)) {
    return 'JavaScript output contains HTML, CSS, or PHP markup.'
  }
  if (/\.html?$/.test(lower)) {
    if (allPaths.some(path => /\.css$/i.test(path)) && /(?:<style\b|\sstyle\s*=)/i.test(value)) {
      return 'HTML contains inline CSS even though a separate CSS file was requested.'
    }
    if (allPaths.some(path => /\.(?:js|mjs|cjs)$/i.test(path)) && /(?:<script(?![^>]*\bsrc\s*=)|\son[a-z]+\s*=)/i.test(value)) {
      return 'HTML contains inline JavaScript even though a separate JavaScript file was requested.'
    }
  }
  return ''
}

function buildSingleFileContentPrompt(task, filePath, allPaths, tree, contextFilesText, generated = [], retryReason = '') {
  const runtimeDatabasePaths = extractExplicitRequestedPaths(task).filter(isRuntimeDatabasePath)
  const runtimeDatabaseRule = runtimeDatabasePaths.length
    ? `\n- The requested SQLite database filename is ${runtimeDatabasePaths.join(', ')}. Source code must use this exact filename and create it at runtime; do not substitute another database name.`
    : ''
  const retryText = retryReason
    ? `\nPrevious output problem: ${retryReason}\nRegenerate the file and correct this problem.\n`
    : ''
  return `You are Cubi Code File Agent.
Generate the COMPLETE content for exactly one file.
Return ONLY the raw file content. No markdown. No code fences. No explanation.
Do not include chat commentary, thought, nthought, or hidden reasoning in the file.${retryText}

File-specific rules:
- ${fileContentRules(filePath, allPaths)}${runtimeDatabaseRule}
- If this file starts or configures an HTTP/Web server, do not hard-code common ports. Read the Cubi Sandbox random port from PORT (or CUBI_APP_PORT), bind the server to 0.0.0.0, and do not auto-open a browser. Use a random high-port fallback only when PORT is absent outside Cubi Code.

User request:
${task || '請依需求產生檔案內容。'}

File to generate:
${filePath}

All files requested in this operation:
${allPaths.join('\\n') || filePath}

Files already generated in this operation:
${generatedFilesPromptContext(generated)}

Current project tree:
${tree || '(empty tree)'}

Related multi-file context:
${contextFilesText || '(none)'}
`
}

function focusedContextTextForFile(contextFiles = [], filePath = '') {
  const exact = []
  const related = []

  for (const item of Array.isArray(contextFiles) ? contextFiles : []) {
    const itemPath = contextFilePath(item)
    if (!itemPath) continue
    if (pathMatchesRequested(itemPath, filePath)) exact.push(item)
    else if (/(active_file|task_target|open_editor_file)/.test(String(item?.role || ''))) related.push(item)
  }

  return formatContextFiles([...exact, ...related].slice(0, 6), 50000)
}

async function generateMissingFileContents(task, files, tree, contextFilesText, contextFiles = []) {
  const allPaths = files.map(file => file.path)
  const generated = []
  let totalTokens = 0
  let model = 'local_ollama'
  let source = 'node_file_agent'
  const errors = []

  for (const file of files) {
    if (String(file.content || '').trim()) {
      generated.push(file)
      continue
    }

    let content = ''
    let retryReason = ''

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const focusedContextText = attempt >= 2 ? focusedContextTextForFile(contextFiles, file.path) : ''
      const prompt = buildSingleFileContentPrompt(task, file.path, allPaths, tree, focusedContextText || contextFilesText, generated, retryReason)
      const llm = await askLlm(prompt, {
        temperature: attempt === 0 ? 0.15 : 0.05,
        numPredict: 5000,
        numCtx: 120000,
        timeoutMs: 900000,
        maxRetries: 0,
        formatJson: false,
        preferChat: false,
        keepAlive: '10m',
        requestEndpoint: '/api/agent/create-files/content',
      })
      totalTokens += llm.tokens || 0
      model = llm.model || model
      source = llm.source || source

      if (!llm.ok || !String(llm.content || '').trim()) {
        retryReason = llm.error || '模型未產生內容'
        continue
      }

      const candidate = stripGeneratedFileContent(llm.content)
      retryReason = generatedContentIssue(file.path, candidate, allPaths)
      if (!retryReason) {
        content = candidate
        break
      }
    }

    if (!content) {
      errors.push(`${file.path}: ${retryReason || '模型未產生有效內容'}`)
      generated.push(file)
      continue
    }

    generated.push({
      ...file,
      content,
      description: file.description || '依使用者明確檔名逐檔產生內容',
    })
  }

  return { files: generated, tokens: totalTokens, model, source, errors }
}

function buildFileAgentPrompt(task, target, tree, contextFilesText, options = {}, retryReason = '') {
  const currentFilePath = normalizePath(options.currentFilePath || options.current_file_path || options.activeFilePath || '')
  const defaultDir = resolveDefaultDir(options)
  const outputDirText = defaultDir || '(project root)'
  const retryText = retryReason
    ? `\nPrevious response problem: ${retryReason}\nYou must correct it and return JSON only.\n`
    : ''

  return `You are Cubi Code File Agent.
Configured feature policy:
${getFeaturePrompt('files') || '(none)'}

Create or update files ONLY according to the user's request and current project tree.
Return ONLY valid JSON. No markdown. No code fences. No explanation.${retryText}

JSON schema:
{
  "files": [
    {
      "path": "relative/path.ext",
      "kind": "source|test|readme|config|doc|example|other",
      "description": "short Traditional Chinese description",
      "content": "complete UTF-8 file content"
    }
  ]
}

Rules:
- Do not use a fixed template.
- Do not use any fixed topic, fixed filename, or unrelated template as a fallback.
- Choose every file path and every file content from the user's task, the current open file, and project context.
- For project/folder audit or repair tasks, inspect the project tree and related context to infer missing dependencies, missing config files, missing tests, missing README/setup docs, and missing source/data files.
- When dependencies or installation steps are missing, update or create the appropriate manifest such as package.json, requirements.txt, pyproject.toml, vite config, or setup documentation. Do not claim that npm/pip/other package managers were executed.
- If a package manager command is required, include it in generated documentation or scripts; do not pretend the command already ran.
- If the requested project needs an HTTP/Web server port, NEVER hard-code common fixed ports such as 3000, 5000, 5173, 8000, 8080, 8501, 8787, or 8888. Cubi Code Docker Sandbox injects one random high port in environment variables PORT and CUBI_APP_PORT when the user manually starts the Sandbox terminal. Generated server code must bind to 0.0.0.0 and read PORT at runtime. Do not auto-open a browser. Outside Cubi Code only, a language-appropriate random high-port fallback may be used.
- Default location for newly created files: ${outputDirText}.
- If the user explicitly asks for a project folder, preserve that folder in each returned path.
- If the user asks to add tests or any new file and does not explicitly request another folder, place the new file beside the current open file.
- Never force backend/, tests/, src/, or any fixed folder just because it is common convention.
- Derive test file names from the current source file or the user's wording.
- Use safe relative paths only.
- Include complete file content.
- For .html, .js, .css, .py and other text/code files, return the complete UTF-8 file content.
- Never return .db, .sqlite, or .sqlite3 as a file to create. These are binary runtime artifacts.
- When the request says a SQLite database should appear after running the program, generate the source code that initializes it with the standard sqlite3 library; the application will create the database at runtime.
- For existing .db/.sqlite database files, do not generate binary bytes. If the user asks to modify or inspect a database, create a .sql migration/query/seed file instead, based only on the request and context.
- When generating Python database code and unit tests:
  * In database seeding/initialization (e.g. seed_data), always insert explicit fixed primary key IDs (e.g. (1, 'Alice', 1000.0), (2, 'Bob', 500.0)) and clear sqlite_sequence when resetting, so test assertions on specific IDs remain deterministic across all test runs.
  * Never swallow database schema or initialization errors in print-only try/except blocks; let exceptions raise.
- If no file should be created, return {"files":[]}.
- Prefer Traditional Chinese for documentation text.

Target area:
${target || outputDirText || 'current_project'}

Current open file:
${currentFilePath || '(none)'}

Default output folder:
${outputDirText}

User request:
${task || '請依需求規劃並新增必要檔案。'}

Current project tree:
${tree || '(empty tree)'}

Related multi-file context:
${contextFilesText || '(none)'}
`
}

function getLlmContentText(llm) {
  return String(llm?.content ?? llm?.text ?? llm?.message ?? '').trim()
}

async function requestFilePlanOnce(prompt, attemptIndex = 0) {
  return askLlm(prompt, {
    temperature: attemptIndex === 0 ? 0.2 : 0.05,
    numPredict: attemptIndex === 0 ? 2600 : 4200,
    numCtx: 120000,
    timeoutMs: 300000,
    maxRetries: 0,
    formatJson: true,
    preferChat: true,
    keepAlive: '10m',
    requestEndpoint: '/api/agent/create-files',
  })
}

async function planAgentFiles(task, target, contextFiles = [], options = {}) {
  const tree = listProjectTree()
    .slice(0, 160)
    .map(item => `${item.type}: ${item.path}`)
    .join('\\n')
  const contextFilesText = formatContextFiles(contextFiles, 120000)
  const requestedPaths = extractExplicitRequestedPaths(task)
  const runtimeDatabasePaths = requestedPaths.filter(isRuntimeDatabasePath)
  const explicitPaths = requestedPaths.filter(path => !isRuntimeDatabasePath(path))
  const databaseWarning = runtimeDatabasePaths.length
    ? `未直接建立二進位資料庫檔案 ${runtimeDatabasePaths.join('、')}；應由產生的程式在執行時透過 sqlite3 自動建立。`
    : ''

  if (explicitPaths.length) {
    const explicitFiles = explicitPaths.map(path => ({
      path,
      kind: inferFileKind(path),
      description: '使用者明確指定需建立的檔案',
      content: '',
    }))
    const normalized = mergeFilesByPath([], explicitFiles, options)
      const generated = await generateMissingFileContents(task, normalized, tree, contextFilesText, contextFiles)
      const emptyFiles = generated.files.filter(file => !String(file.content || '').trim())
      if (!emptyFiles.length) {
      return {
        ok: true,
        files: generated.files,
        llm: {
          ok: true,
          source: generated.source || 'ollama',
          model: generated.model || 'local_ollama',
          tokens: generated.tokens,
        },
        attempts: [{ ok: true, source: 'explicit_file_names', tokens: generated.tokens }],
        warnings: [databaseWarning, ...generated.errors].filter(Boolean),
      }
    }
    return {
      ok: false,
      files: [],
      llm: {
        ok: false,
        source: generated.source || 'node_file_agent',
        model: generated.model || 'local_ollama',
        tokens: generated.tokens,
      },
      attempts: [{ ok: false, source: 'explicit_file_names', tokens: generated.tokens }],
      error: generationFailureMessage(generated.errors, emptyFiles.map(file => file.path), contextFiles),
    }
  }

  const attempts = []
  let retryReason = ''

  for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
    const prompt = buildFileAgentPrompt(task, target, tree, contextFilesText, options, retryReason)
    const llm = await requestFilePlanOnce(prompt, attemptIndex)
    const content = getLlmContentText(llm)

    if (!llm.ok) {
      retryReason = llm.error || '模型呼叫失敗'
      attempts.push({ ok: false, error: retryReason, tokens: llm.tokens || 0 })
      continue
    }

    if (!content) {
      retryReason = 'Ollama 回覆空白'
      attempts.push({ ok: false, error: retryReason, tokens: llm.tokens || 0 })
      continue
    }

    const parsed = parseJsonObject(content)
    if (!parsed) {
      retryReason = '模型回覆不是有效 JSON'
      attempts.push({ ok: false, error: retryReason, tokens: llm.tokens || 0 })
      continue
    }

    try {
      const normalized = normalizePlannedFiles(parsed, options)
      const explicitFiles = explicitPaths.map(path => ({
        path,
        kind: inferFileKind(path),
        description: '使用者明確指定需建立的檔案',
        content: '',
      }))
      const merged = mergeFilesByPath(normalized, explicitFiles, options)
      const generated = await generateMissingFileContents(task, merged, tree, contextFilesText, contextFiles)
      return {
        ok: true,
        files: generated.files,
        llm: {
          ...llm,
          tokens: (llm.tokens || 0) + generated.tokens,
          model: generated.model || llm.model,
          source: generated.source || llm.source,
        },
        attempts: [...attempts, { ok: true, tokens: llm.tokens || 0, filled_missing: generated.files.length - normalized.length }],
        warnings: [databaseWarning, ...generated.errors].filter(Boolean),
      }
    } catch (error) {
      retryReason = error.message
      attempts.push({ ok: false, error: retryReason, tokens: llm.tokens || 0 })
    }
  }

  const fallbackPaths = targetPathsFromContext(contextFiles, options).filter(path => !explicitPaths.includes(path))
  if (fallbackPaths.length) {
    try {
      const fallbackFiles = fallbackPaths.map(path => ({
        path,
        kind: inferFileKind(path),
        description: '模型未回傳檔案規劃；改依目前開啟檔案作為更新目標逐檔生成內容。',
        content: '',
      }))
      const normalized = mergeFilesByPath([], fallbackFiles, options)
      const generated = await generateMissingFileContents(task, normalized, tree, contextFilesText, contextFiles)
      const hasEmpty = generated.files.some(file => !String(file.content || '').trim())
      if (!hasEmpty) {
        return {
          ok: true,
          files: generated.files,
          llm: {
            ok: true,
            source: generated.source || 'ollama',
            model: generated.model || 'local_ollama',
            tokens: attempts.reduce((sum, item) => sum + (item.tokens || 0), 0) + generated.tokens,
          },
          attempts: [...attempts, { ok: true, fallback: 'open_editor_targets', tokens: generated.tokens }],
          warnings: ['模型未回傳有效 JSON，已改依目前開啟檔案作為更新目標逐檔產生內容。', ...generated.errors],
        }
      }
      retryReason = generationFailureMessage(generated.errors, fallbackPaths, contextFiles) || retryReason
    } catch (error) {
      retryReason = error.message
    }
  }

  return {
    ok: false,
    files: [],
    llm: { ok: false, source: 'node_file_agent', model: 'local_ollama', tokens: attempts.reduce((sum, item) => sum + (item.tokens || 0), 0) },
    attempts,
    error: `${retryReason || '模型未回傳檔案規劃'}，已重試仍失敗；未使用固定範本，也未寫入任何檔案。`,
  }
}

async function createAgentFiles(task, target, overwrite = false, contextFiles = [], options = {}) {
  const start = Date.now()
  const plan = await planAgentFiles(task, target, contextFiles, options)
  if (!plan.ok) {
    return {
      type: 'agent_create_files',
      ok: false,
      task,
      target,
      model: plan.llm?.model || 'local_ollama',
      source: plan.llm?.source || 'node_file_agent',
      tokens: plan.llm?.tokens || 0,
      created_files: [],
      created_count: 0,
      skipped_count: 0,
      elapsed_seconds: Number(((Date.now() - start) / 1000).toFixed(2)),
      content: `Agent 動態規劃檔案失敗：${plan.error}`,
      error: plan.error,
      steps: [
        { label: '1 分析需求', status: 'done', detail: task || '未提供需求' },
        { label: '2 呼叫模型規劃檔案', status: 'failed', detail: plan.error },
        { label: '3 寫入檔案', status: 'pending', detail: '模型規劃失敗，未寫入任何檔案' },
      ],
    }
  }

  const files = plan.files
  const results = []
  const dryRun = Boolean(options.dryRun || options.dry_run)
  const returnContent = Boolean(options.returnContent || options.return_content || dryRun)
  for (const file of files) {
    const generatedContent = String(file.content || '')
    const generatedLines = generatedContent ? generatedContent.split(/\r?\n/).length : 0
    try {
      if (dryRun) {
        results.push({
          ...file,
          content: returnContent ? file.content : undefined,
          line_count: generatedLines,
          char_count: generatedContent.length,
          status: 'planned'
        })
        continue
      }

      let exists = false
      let existingContent = ''
      try {
        existingContent = readFile(file.path)
        exists = true
      } catch {
        exists = false
      }
      if (exists && !overwrite && String(existingContent || '').trim()) {
        results.push({ ...file, content: returnContent ? file.content : undefined, line_count: existingContent.split(/\r?\n/).length, char_count: existingContent.length, status: 'skipped' })
        continue
      }
      // 若檔案已存在但內容為空，視為可補內容，避免空白檔造成 Demo 檢查失敗。
      writeFile(file.path, file.content)
      results.push({ ...file, content: returnContent ? file.content : undefined, line_count: generatedLines, char_count: generatedContent.length, status: 'created' })
    } catch (error) {
      results.push({ ...file, content: returnContent ? file.content : undefined, line_count: generatedLines, char_count: generatedContent.length, status: 'failed', error: error.message })
    }
  }
  const createdCount = results.filter(item => item.status === 'created').length
  const plannedCount = results.filter(item => item.status === 'planned').length
  const skippedCount = results.filter(item => item.status === 'skipped').length
  const failedCount = results.filter(item => item.status === 'failed').length
  return {
    type: 'agent_create_files',
    ok: failedCount === 0,
    task,
    target,
    model: plan.llm?.model || 'local_ollama',
    source: plan.llm?.source || 'node_file_agent',
    tokens: plan.llm?.tokens || 0,
    created_files: results,
    created_count: createdCount,
    skipped_count: skippedCount,
    elapsed_seconds: Number(((Date.now() - start) / 1000).toFixed(2)),
    planned_count: plannedCount,
    content: dryRun
      ? `Agent 已依需求動態規劃 ${files.length} 個檔案；等待前端寫入目前開啟資料夾。`
      : `Agent 已依需求動態規劃 ${files.length} 個檔案；新增 ${createdCount} 個，略過 ${skippedCount} 個。`,
    steps: [
      { label: '1 分析需求', status: 'done', detail: task },
      { label: '2 模型規劃檔案清單', status: 'done', detail: `${files.length} 個檔案；預設位置：${resolveDefaultDir(options) || '專案根目錄'}` },
      ...results.map((item, index) => ({
        label: `${index + 3} ${item.status === 'skipped' ? '略過既有檔案' : item.status === 'failed' ? '寫入失敗' : '寫入檔案'}`,
        status: item.status === 'failed' ? 'failed' : 'done',
        detail: item.error ? `${item.path}: ${item.error}` : item.path,
      })),
    ],
  }
}

module.exports = { prepareAgentFix, prepareInlineCommand, runAgent, applyAgentFixAndTest, runAgentFixAndTest, createAgentFiles, planAgentFiles, summarizeTestFailure, combineMultiFileTestResults, multiFileEvidenceSteps, staticWebsiteValidationTarget, extractExplicitRequestedPaths, sanitizeDisplayStderr }
