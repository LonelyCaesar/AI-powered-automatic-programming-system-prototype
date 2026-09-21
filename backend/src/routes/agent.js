const express = require('express')
const { logAction } = require('../core/auditLogger')
const agent = require('../services/agentService')

const router = express.Router()
const AGENT_LOOP_STREAM_HEARTBEAT_MS = 30000

function logPytestResult(operation, filePath, result) {
  const test = result.test || {}
  const passed = Number(result.passed || 0)
  const failed = Number(result.failed || 0)
  const elapsed = Number(test.elapsed_seconds || 0)
  const status = result.ok ? '成功' : '失敗'
  const actionNote = result.applied ? '已套用修正；' : result.no_change ? '未修改；' : ''
  const testKind = test.kind || 'pytest'
  const pytestResult = `${passed} passed / ${failed} failed (${testKind})`
  const stdoutLines = String(test.stdout || '').trim().split(/\r?\n/).filter(Boolean)
  const stderrLines = String(test.stderr || '').trim().split(/\r?\n/).filter(Boolean)
  const detail = [stdoutLines.length ? `stdout: ${stdoutLines.at(-1)}` : '', stderrLines.length ? `stderr: ${stderrLines.at(-1)}` : ''].filter(Boolean).join('；') || result.content || pytestResult
  logAction('admin', operation, filePath || 'current_file.py', result.model || testKind, result.tokens || 0, `${status}：${actionNote}${pytestResult}、${elapsed}s`, { service: `${testKind} / node_runtime`, pytestResult, elapsedSeconds: elapsed, detail, status: result.ok ? 'success' : 'failed' })
}

router.post('/run-tests', async (req, res) => {
  const isProjectFix = req.body.project_wide === true || req.body.mode === 'fix_error' || req.body.mode === '錯誤修正'
  const result = await agent.runAgent(req.body.task, req.body.file_path, req.body.code, req.body.context_files || [], {
    workspaceSource: req.body.workspace_source || '',
    projectId: req.body.project_id || req.body.workspace_id || '',
    projectName: req.body.project_name || '',
    preferProjectTests: req.body.prefer_project_tests !== false,
    projectWide: isProjectFix,
    validateTargetRuntime: isProjectFix,
    targetOnly: req.body.target_only === true,
    targetFiles: req.body.target_files || req.body.targetFiles || [],
    validateEveryTarget: req.body.validate_every_target === true || req.body.validateEveryTarget === true,
  })
  logPytestResult('Agent 測試執行', result.file_path || req.body.file_path, result)
  res.json(result)
})

router.post('/project-fix/inspect', async (req, res) => {
  const { inspectProjectFix } = require('../services/projectFixService')
  const task = req.body.userInstruction || req.body.task || '錯誤修正'
  const filePath = req.body.filePath || req.body.file_path || ''
  const code = req.body.fullText ?? req.body.code ?? null
  const result = await inspectProjectFix(task, filePath, code, req.body.context_files || [], {
    workspaceSource: req.body.workspace_source || '',
    projectId: req.body.project_id || req.body.workspace_id || '',
    projectName: req.body.project_name || '',
  })
  const status = result.passed ? '通過' : (result.environment_limited ? '環境限制' : '發現錯誤')
  logAction('admin', '錯誤修正 / 全專案掃描與測試', filePath || 'project', 'docker_sandbox', 0, `${status}：執行 ${result.commands.length} 個檢查指令，定位 ${result.error_files.length} 個錯誤位置`, {
    service: 'project_fix_inspection',
    detail: result.commands.join('；') || '未找到可執行檢查',
    status: result.passed ? 'success' : (result.environment_limited ? 'pending' : 'failed'),
  })
  res.json(result)
})

router.post('/prepare-fix', async (req, res) => {
  const result = await agent.prepareAgentFix(req.body.task, req.body.file_path, req.body.code, req.body.context_files || [])
  const diffText = result.diff_text || ''
  const additions = diffText.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).length
  const removals = diffText.split('\n').filter(line => line.startsWith('-') && !line.startsWith('---')).length
  logAction('admin', 'Agent 產生修改建議 / 等待確認', result.file_path || req.body.file_path || 'current_file.py', result.model || 'local_ollama', result.tokens || 0, `${result.pending_approval ? '等待確認' : '未產生可套用 Diff'}：Diff +${additions} / -${removals}，尚未寫入檔案`, { service: result.source || 'node_local_ollama_required', detail: `產生紅綠 Diff，新增 ${additions} 行、刪除 ${removals} 行；等待使用者確認後才套用。`, status: result.pending_approval ? 'pending' : 'failed' })
  res.json(result)
})

router.post('/inline-command', async (req, res) => {
  const task = req.body.userInstruction || req.body.task || ''
  const filePath = req.body.filePath || req.body.file_path || ''
  const selectedCode = req.body.selectedText ?? req.body.selected_code ?? ''
  const fullText = req.body.fullText ?? req.body.code ?? null
  if ((req.body.mode === 'fix_error' || req.body.mode === '錯誤修正') && req.body.project_wide === true && req.body.project_inspected !== true) {
    const { inspectProjectFix } = require('../services/projectFixService')
    const inspection = await inspectProjectFix(task, filePath, fullText, req.body.context_files || [], {
      workspaceSource: req.body.workspace_source || '',
      projectId: req.body.project_id || req.body.workspace_id || '',
      projectName: req.body.project_name || '',
    })
    return res.json(inspection)
  }
  const isErrorFix = req.body.mode === 'fix_error' || req.body.mode === '錯誤修正'
  const requestedTargetFiles = Array.isArray(req.body.target_files)
    ? req.body.target_files
    : (Array.isArray(req.body.targetFiles) ? req.body.targetFiles : [])
  const result = await agent.prepareInlineCommand(task, filePath, selectedCode, fullText, req.body.context_files || [], {
    operation: isErrorFix ? 'fix' : 'rewrite',
    returnOnlyAllowedEditPaths: req.body.sequential_target_only === true,
    allowedEditPaths: isErrorFix
      ? (req.body.target_only === true ? [filePath] : (requestedTargetFiles.length ? requestedTargetFiles : [filePath]))
      : (requestedTargetFiles.length ? requestedTargetFiles : [filePath]),
  })
  const diffText = result.diff_text || ''
  const additions = diffText.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).length
  const removals = diffText.split('\n').filter(line => line.startsWith('-') && !line.startsWith('---')).length
  const auditState = result.no_change ? '逐檔檢查完成，無需修改' : (result.pending_approval ? '等待確認' : '未產生可套用 Diff')
  logAction('admin', 'Ctrl+I Inline Command / 等待確認', result.file_path || filePath || 'current_file.py', result.model || 'local_ollama', result.tokens || 0, `${auditState}：選取 ${result.selected_chars || 0} 字，Diff +${additions} / -${removals}，尚未寫入檔案`, { service: result.source || 'node_local_ollama_required', detail: result.no_change ? result.content : '選取程式碼 → Ctrl+I / Inline Command → 產生紅綠 Diff，等待使用者確認後套用並依專案類型執行測試。', status: result.no_change ? 'success' : (result.pending_approval ? 'pending' : 'failed') })
  res.json(result)
})

router.post('/apply-and-test', async (req, res) => {
  const result = await agent.applyAgentFixAndTest(req.body.file_path, req.body.new_content, req.body.extra_files)
  logPytestResult('Agent 確認套用變更 + pytest', result.file_path || req.body.file_path, result)
  res.json(result)
})

router.post('/fix-and-test', async (req, res) => {
  const result = await agent.runAgentFixAndTest(req.body.task, req.body.file_path, req.body.code)
  logPytestResult('Agent 自動修改檔案 + pytest', result.file_path || req.body.file_path, result)
  res.json(result)
})

router.post('/create-files', async (req, res) => {
  const result = await agent.createAgentFiles(req.body.task, req.body.target, req.body.overwrite, req.body.context_files || [], {
    currentFilePath: req.body.current_file_path || req.body.active_file_path || req.body.file_path || '',
    defaultDir: req.body.default_dir || req.body.target_dir || '',
    targetFiles: req.body.target_files || req.body.targetFiles || [],
    anchorToCurrentDir: req.body.anchor_to_current_dir === true,
    dryRun: req.body.dry_run === true,
    returnContent: req.body.return_content === true || req.body.dry_run === true,
  })
  const files = result.created_files || []
  const fileList = files.map(item => item.path).join('、')
  logAction('admin', 'Agent 自動新增檔案', fileList || req.body.target || 'current_project', result.model || 'node_file_agent', result.tokens || 0, `${result.ok ? '成功' : '失敗'}：本次新增 ${result.created_count || 0} 個，已存在略過 ${result.skipped_count || 0} 個`, { service: result.source || 'node_file_agent', elapsedSeconds: result.elapsed_seconds || 0, detail: files.map(item => `${item.status}: ${item.path}`).join('；') || result.error || result.content, status: result.ok ? 'success' : 'failed' })
  res.json(result)
})

const loopSessions = new Map()

router.post('/loop/init', (req, res) => {
  const { stageProjectWorkspace } = require('../services/sandboxWorkspaceService')
  const workspace = stageProjectWorkspace({
    projectId: req.body.project_id || req.body.workspace_id || '',
    projectName: req.body.project_name || 'project',
    workspaceSource: req.body.workspace_source || '',
    filePath: req.body.file_path || '',
    code: req.body.code,
    contextFiles: req.body.context_files || [],
  })
  const id = Date.now().toString() + Math.random().toString().slice(2)
  loopSessions.set(id, {
    task: req.body.task,
    default_dir: req.body.default_dir,
    is_local_handle: req.body.is_local_handle,
    workspace_source: req.body.workspace_source || '',
    workspace_id: workspace.id,
    sandbox_workspace_path: workspace.path,
    require_file_changes: req.body.require_file_changes === true,
    require_validation: req.body.require_validation === true,
    expected_files: Array.isArray(req.body.expected_files) ? req.body.expected_files : [],
    validation_commands: Array.isArray(req.body.validation_commands) ? req.body.validation_commands : [],
  })
  setTimeout(() => loopSessions.delete(id), 60000) // 1 min connect timeout
  res.json({
    id,
    sandbox: {
      engine: 'docker',
      isolated: true,
      workspace_id: workspace.id,
      workspace: '/workspace',
      synced_count: workspace.syncedFiles.length,
    },
  })
})

router.get('/loop/stream', async (req, res) => {
  const id = req.query.id
  const session = loopSessions.get(id)
  if (!session) {
    return res.status(404).send('Session not found or expired')
  }
  loopSessions.delete(id)
  
  const {
    task,
    default_dir,
    is_local_handle,
    workspace_source,
    workspace_id,
    sandbox_workspace_path,
    require_file_changes,
    require_validation,
    expected_files,
    validation_commands,
  } = session
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  })
  res.write('\n')
  const streamStartedAt = Date.now()
  const writeLoopEvent = event => {
    if (res.destroyed || res.writableEnded) return
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  const heartbeatTimer = setInterval(() => {
    writeLoopEvent({
      type: 'heartbeat',
      elapsed_seconds: Math.round((Date.now() - streamStartedAt) / 1000),
    })
  }, AGENT_LOOP_STREAM_HEARTBEAT_MS)

  const { runAgentLoop } = require('../services/agentLoopService')

  try {
    const result = await runAgentLoop(task, {
      defaultDir: default_dir,
      isLocalHandle: is_local_handle,
      workspaceSource: workspace_source,
      workspaceId: workspace_id,
      sandboxWorkspacePath: sandbox_workspace_path,
      requireFileChanges: require_file_changes,
      requireValidation: require_validation,
      expectedFiles: expected_files,
      validationCommands: validation_commands,
      onEvent: (event) => {
        writeLoopEvent(event)
      }
    })
    writeLoopEvent({ type: 'done', result })
  } catch (err) {
    writeLoopEvent({ type: 'error', error: err.message })
  } finally {
    clearInterval(heartbeatTimer)
    res.end()
  }
})

module.exports = router
