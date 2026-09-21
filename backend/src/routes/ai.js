const express = require('express')
const { logAction } = require('../core/auditLogger')
const coding = require('../services/codingServices')
const { formatContextFiles } = require('../services/contextManager')
const { detectProjectErrors, analyzeOrExplainProject } = require('../services/readOnlyProjectService')

const router = express.Router()

function resultText(result) {
  return result.ok === false ? `失敗：${result.error || result.source || '模型未連線'}` : '成功'
}

function formatIncomingContextFiles(contextFiles = []) {
  return formatContextFiles(contextFiles, 120000)
}

function hasUsableCodeContext(body = {}) {
  if (String(body.code || body.currentFileContent || body.selected_code || body.selectedText || '').trim()) return true
  return (Array.isArray(body.context_files) ? body.context_files : [])
    .some(item => item?.ok !== false && String(item?.content || '').trim())
}

function requireCodeContext(req, res, featureName) {
  if (hasUsableCodeContext(req.body || {})) return true
  res.status(400).json({
    ok: false,
    type: 'context_validation',
    error: `${featureName}需要可用的程式碼上下文。請提供 code、selected_code 或至少一個有內容的 context_files。`,
  })
  return false
}


router.post('/auto-intent', async (req, res) => {
  const result = await coding.classifyAutoIntent(req.body.instruction || req.body.prompt || '', {
    filePath: req.body.file_path || req.body.currentFilePath || '',
    code: req.body.code || req.body.currentFileContent || '',
    selectedCode: req.body.selected_code || req.body.selectedText || '',
    contextFiles: req.body.context_files || [],
    pinnedFiles: req.body.pinned_files || [],
    workspaceContext: req.body.workspace_context || '',
  })
  logAction('admin', 'Auto 模型判斷', req.body.file_path || '', result.model || 'system', result.tokens || 0, result.ok === false ? `失敗：${result.error || result.reason || '無法判斷'}` : `判斷為：${result.intent}`, { service: result.source || 'auto_intent_router', detail: result.reason || req.body.instruction || '', status: result.ok === false ? 'failed' : 'success' })
  res.json(result)
})

router.post('/generate', async (req, res) => {
  const instruction = req.body.prompt || req.body.instruction || ''
  const filePath = req.body.currentFilePath || req.body.file_path || ''
  const currentFileContent = req.body.currentFileContent ?? req.body.fullText ?? req.body.code ?? ''
  const selectedText = req.body.selectedText ?? req.body.selected_code ?? ''
  const language = req.body.language || req.body.language_id || ''
  const contextFileText = formatIncomingContextFiles(req.body.context_files)
  const context = [
    req.body.context,
    contextFileText,
  ].filter(Boolean).join('\n\n')
  const result = await coding.generateCode(instruction, context, {
    filePath,
    currentFileContent,
    selectedText,
    language,
    mode: req.body.mode || 'code-generation',
    style: req.body.style,
    temperature: req.body.temperature,
    multiFileItems: req.body.multi_file_items || req.body.multiFileItems || [],
    outputDirectory: req.body.output_directory || req.body.outputDirectory || '',
    contextFiles: req.body.context_files || [],
  })
  logAction('admin', '程式碼產生', filePath, result.model || 'system', result.tokens || 0, resultText(result), { service: result.source || 'node_ai_service', detail: instruction, status: result.ok === false ? 'failed' : 'success' })
  res.json(result)
})

router.post('/rewrite', async (req, res) => {
  if (!requireCodeContext(req, res, '程式碼改寫')) return
  const result = await coding.rewriteCode(req.body.code || '', req.body.instruction || '', req.body.context || '', {
    filePath: req.body.file_path || req.body.currentFilePath || '',
    contextFiles: req.body.context_files || [],
  })
  logAction('admin', '程式碼改寫', req.body.file_path || '', result.model || 'system', result.tokens || 0, resultText(result), { service: result.source || 'node_ai_service', detail: req.body.instruction || '', status: result.ok === false ? 'failed' : 'success' })
  res.json(result)
})

router.post('/convert', async (req, res) => {
  if (!requireCodeContext(req, res, '程式語言轉換')) return
  const filePath = req.body.file_path || ''
  const result = await coding.convertCode(
    req.body.code || '',
    req.body.target_language || 'auto',
    req.body.instruction || '',
    filePath,
    req.body.context || '',
    { contextFiles: req.body.context_files || [] }
  )
  logAction('admin', '語言轉換', req.body.file_path || '', result.model || 'system', result.tokens || 0, resultText(result), { service: result.source || 'node_ai_service', detail: `target=${result.target_language || req.body.target_language || 'auto'}`, status: result.ok === false ? 'failed' : 'success' })
  res.json(result)
})

router.post('/detect', async (req, res) => {
  if (!requireCodeContext(req, res, '錯誤偵測')) return
  const result = await detectProjectErrors({
    filePath: req.body.file_path || '',
    code: req.body.code || '',
    instruction: req.body.instruction || '掃描整個專案並偵測錯誤，只回報不修改。',
    contextFiles: req.body.context_files || [],
    scope: req.body.scope || req.body.scan_scope || req.body.scanScope || '',
  })
  const found = Array.isArray(result.error_files) ? result.error_files.length : 0
  const commands = Array.isArray(result.commands) ? result.commands.length : 0
  const checkStatus = result.program_check_status === 'passed'
    ? '程式檢查通過'
    : result.program_check_status === 'failed' ? '程式檢查未通過' : '未找到可執行檢查'
  logAction('admin', '錯誤偵測', req.body.file_path || '', result.model || 'system', result.tokens || 0, result.ok === false ? `失敗：${result.error || '模型未連線'}` : `唯讀掃描流程完成：${checkStatus}；執行 ${commands} 個檢查、定位 ${found} 個錯誤位置`, { service: result.source || 'readonly_project_detection', detail: [result.coverage_notice, result.model_context_notice].filter(Boolean).join(' '), status: result.ok === false ? 'failed' : 'success' })
  res.json(result)
})

router.post('/fix', async (req, res) => {
  if (!requireCodeContext(req, res, '錯誤修正')) return
  const contextFileText = formatIncomingContextFiles(req.body.context_files)
  const result = await coding.fixErrors(req.body.code || '', req.body.instruction || '', [req.body.context, contextFileText].filter(Boolean).join('\n\n'), {
    filePath: req.body.file_path || req.body.currentFilePath || '',
    contextFiles: req.body.context_files || [],
  })
  logAction('admin', '錯誤修正', req.body.file_path || '', result.model || 'system', result.tokens || 0, resultText(result), { service: result.source || 'node_ai_service', detail: req.body.instruction || '', status: result.ok === false ? 'failed' : 'success' })
  res.json(result)
})


router.post('/rewrite-advice', async (req, res) => {
  const contextFileText = formatIncomingContextFiles(req.body.context_files)
  const result = await coding.rewriteAdvice(req.body.code || '', req.body.instruction || '', [req.body.context, contextFileText].filter(Boolean).join('\n\n'))
  logAction('admin', '程式碼改寫建議', req.body.file_path || '', result.model || 'system', result.tokens || 0, resultText(result), { service: result.source || 'node_ai_service', detail: req.body.instruction || '只提供改寫建議，不修改檔案。', status: result.ok === false ? 'failed' : 'success' })
  res.json(result)
})

router.post('/test-advice', async (req, res) => {
  const contextFileText = formatIncomingContextFiles(req.body.context_files)
  const result = await coding.testAdvice(req.body.code || '', req.body.instruction || '', req.body.file_path || '', [req.body.context, contextFileText].filter(Boolean).join('\n\n'))
  logAction('admin', '測試案例', req.body.file_path || '', result.model || 'system', result.tokens || 0, resultText(result), { service: result.source || 'node_ai_service', detail: req.body.instruction || '產生 pytest 測試案例建議，不修改檔案。', status: result.ok === false ? 'failed' : 'success' })
  res.json(result)
})

router.post('/plan', async (req, res) => {
  const result = await coding.planTask(req.body.instruction || req.body.prompt || '', {
    filePath: req.body.file_path || '',
    selectedTool: req.body.selected_tool || 'auto',
    code: req.body.code || '',
    selectedCode: req.body.selected_code || '',
    includeIdeContext: req.body.include_ide_context !== false,
    pinnedFiles: req.body.pinned_files || [],
    contextFiles: req.body.context_files || [],
    workspaceContext: req.body.workspace_context || '',
    planningSessionId: req.body.planning_session_id || '',
    clarificationAnswers: req.body.clarification_answers || [],
    revisionRequest: req.body.revision_request || '',
    previousPlan: req.body.previous_plan || '',
    forcePlan: req.body.force_plan === true,
  })
  logAction('admin', 'Plan Agent / 規劃模式', req.body.file_path || '', result.model || 'system', result.tokens || 0, resultText(result), { service: result.source || 'node_plan_agent', detail: req.body.instruction || '', status: result.ok === false ? 'failed' : 'success' })
  res.json(result)
})

router.post('/explain', async (req, res) => {
  const featureName = req.body.mode === 'analysis' ? '專案檔案分析' : '程式說明'
  if (!requireCodeContext(req, res, featureName)) return
  const result = await analyzeOrExplainProject({
    filePath: req.body.file_path || '',
    question: req.body.question || '',
    code: req.body.code,
    selectedCode: req.body.selected_code,
    contextFiles: req.body.context_files,
    mode: req.body.mode,
    scope: req.body.scope || req.body.scan_scope || req.body.scanScope || '',
  })
  const operation = result.mode === 'analysis' ? '專案檔案分析' : '程式說明'
  logAction('admin', operation, req.body.file_path || '', result.model || 'system', result.tokens || 0, result.ok === false ? `失敗：${result.error || '模型未連線'}` : `唯讀${operation}完成：${result.project_files?.length || 0} 個檔案、${result.relations?.length || 0} 個關聯`, { service: result.source || 'readonly_project_analysis', detail: [result.coverage_notice, result.model_context_notice].filter(Boolean).join(' ') || req.body.question || '', status: result.ok === false ? 'failed' : 'success' })
  res.json(result)
})

router.post('/autocomplete', async (req, res) => {
  const controller = new AbortController()
  const abortRequest = () => controller.abort()
  req.once('aborted', abortRequest)
  res.once('close', () => {
    if (!res.writableEnded) abortRequest()
  })
  const filePath = req.body.filePath || req.body.file_path || ''
  const fullText = req.body.fullText ?? req.body.content ?? req.body.code ?? ''
  const result = await coding.autocomplete(
    req.body.prefix || '',
    req.body.suffix || '',
    filePath,
    fullText,
    req.body.language || req.body.language_id || '',
    { signal: controller.signal }
  )
  if (controller.signal.aborted || res.writableEnded) return
  logAction('admin', 'Autocomplete', filePath, result.model || 'system', result.tokens || 0, resultText(result), { service: result.source || 'node_autocomplete', detail: '游標位置 ghost text 補全。', status: result.ok === false ? 'failed' : 'success' })
  res.json(result)
})

module.exports = router
