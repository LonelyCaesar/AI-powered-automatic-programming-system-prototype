const { askLlm } = require('../core/llmClient')
const fs = require('fs')
const path = require('path')
const config = require('../config')

const sandboxService = require('./sandboxService')

async function executeCommand(command, cwdRelative, workspaceId) {
  const timeoutSeconds = Math.max(1, Number(config.dockerSandbox.aiFeatureTimeout || 120))
  const result = await sandboxService.runCommandInSandbox(
    ['sh', '-lc', command],
    { workspaceId, cwdRelative, timeoutMs: timeoutSeconds * 1000 }
  )
  let output = ''
  if (result.stdout) output += `STDOUT:\n${result.stdout}\n`
  if (result.stderr) output += `STDERR:\n${result.stderr}\n`
  if (!result.ok) output += `ERROR:\nExit code: ${result.exitCode}\n`
  return output || '命令已成功執行，沒有輸出。'
}

function resolveInside(root, requested = '.') {
  const base = path.resolve(root)
  const target = path.resolve(base, String(requested || '.'))
  if (!(target === base || target.startsWith(base + path.sep))) {
    throw new Error(`Path exceeds the project workspace: ${requested}`)
  }
  return target
}

function relativeWorkspacePath(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target)).replace(/\\/g, '/')
  return relative && relative !== '.' ? relative : ''
}

function resolveFromWorkingDirectory(projectRoot, cwd, requested = '.') {
  const target = path.resolve(cwd, String(requested || '.'))
  return resolveInside(projectRoot, target)
}

function observationFailed(observation = '') {
  const text = String(observation || '')
  return /^(?:Error|錯誤|工具執行錯誤)/i.test(text)
    || /(?:^|\n)ERROR:\s*\n?Exit code:\s*[1-9]\d*/i.test(text)
    || /(?:^|\n)(?:npm ERR!|FAILED|Tests? failed|Build failed)\b/i.test(text)
}

function isValidationCommand(command = '') {
  return /(?:^|\s)(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:test|build|lint|check|typecheck)\b|\b(?:pytest|unittest|node\s+--check|py_compile|tsc\s+--noEmit|cargo\s+test|go\s+test|dotnet\s+test)\b/i.test(String(command || ''))
}

function isDependencyInstallCommand(command = '') {
  return /\b(?:pip(?:3)?\s+install|python(?:3)?\s+-m\s+pip\s+install|npm\s+(?:install|i|ci)|pnpm\s+(?:install|i)|yarn\s+(?:install|add)|apt(?:-get)?\s+install)\b/i.test(String(command || ''))
}

function commandContainsPlaceholder(command = '') {
  const text = String(command || '')
  return /<\s*(?:請|替換|輸入|真實|your|path|input|actual|real|replace)[^>\r\n]{0,120}>/i.test(text)
    || /(?:請替換|請提供|真實圖片路徑|實際圖片路徑|your[_ -]?(?:file|path|input)|path\/to\/|replace[_ -]?me)/i.test(text)
}

function isRiskyAutoValidationCommand(command = '') {
  const cmd = String(command || '').trim()
  return !cmd
    || commandContainsPlaceholder(cmd)
    || isDependencyInstallCommand(cmd)
    || /\b(?:curl|wget|start|open|xdg-open|powershell|pwsh|cmd\.exe)\b/i.test(cmd)
    || /\b(?:serve|server|http\.server|uvicorn|flask|streamlit|vite|next|nuxt)\b/i.test(cmd)
}

function autoValidationCandidates(commands = []) {
  return (Array.isArray(commands) ? commands : [])
    .map(command => String(command || '').trim())
    .filter(command => command && !isRiskyAutoValidationCommand(command))
}

function placeholderCommandError(command = '') {
  return `錯誤：不允許直接執行含有占位內容的驗證命令：「${command}」。請先建立可重現的臨時測試輸入（例如在測試資料夾產生一張小型圖片 fixture），或在沒有真實輸入/外部資源時明確回報環境限制；不要把 <請替換...> 之類文字當成實際路徑執行。`
}

function summarizeFailureObservation(observation = '') {
  const text = String(observation || '').replace(/\r\n/g, '\n').trim()
  if (!text) return ''
  const lines = text
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean)
  const interesting = lines.filter(line => (
    /(?:error|exception|traceback|failed|exit code|module|not found|no such file|permission|denied|timeout|npm err|pip|pytest|syntaxerror|importerror|modulenotfounderror)/i.test(line)
    || /^STDERR:|^ERROR:/i.test(line)
  ))
  const selected = (interesting.length ? interesting : lines).slice(-8)
  return selected.join('\n').slice(0, 1200)
}

function rememberFailure(recentFailures, message) {
  if (!message) return
  recentFailures.push(message)
  if (recentFailures.length > 8) recentFailures.shift()
}

function formatAbortError(recentFailures = []) {
  const reversed = [...recentFailures].reverse()
  const latest = reversed.find(item => item
      && !/^重複失敗工具呼叫/.test(item)
      && !/^LLM 回應異常/.test(item)
      && !/^模型回覆沒有 <tool_call>/.test(item)
      && !/^工具 JSON 解析失敗/.test(item))
    || reversed.find(item => item && !/^重複失敗工具呼叫/.test(item))
    || [...recentFailures].reverse().find(Boolean)
  return latest
    ? `連續錯誤過多，已中止流程。最近失敗：\n${latest}`
    : '連續錯誤過多。'
}

function sandboxNetworkLimitationAdvice(command = '', observation = '') {
  const cmd = String(command || '')
  const text = String(observation || '')
  const dependencyInstall = isDependencyInstallCommand(cmd)
  const networkFailure = /Temporary failure in name resolution|Failed to establish a new connection|NewConnectionError|Name or service not known|Could not resolve host|Network is unreachable|EAI_AGAIN|ENOTFOUND|ECONNRESET|ETIMEDOUT|Read timed out|connection broken|ConnectionError/i.test(text)
  if (!dependencyInstall || !networkFailure || !config.dockerSandbox.networkDisabled) return ''
  return [
    '環境限制：Docker Sandbox 目前停用網路（--network none），所以不能在執行中下載或安裝外部依賴。',
    '請改用沙盒已安裝套件或標準庫完成可驗證成果；如果剛新增的 requirements.txt / package.json 只列出無法下載的套件，請改寫實作以移除這些不必要依賴，並重新跑可離線通過的驗證。',
  ].join('\n')
}

function isLikelyExternalToolShimPath(filePath = '') {
  const normalized = String(filePath || '').replace(/\\/g, '/').split('/').filter(Boolean)
  const baseName = (normalized.at(-1) || '').toLowerCase()
  const toolName = baseName.replace(/\.(?:py|js|mjs|cjs|sh|bat|cmd|ps1)$/i, '')
  const knownExternalTools = new Set([
    'black',
    'coverage',
    'eslint',
    'flake8',
    'mypy',
    'node',
    'npm',
    'pip',
    'pip3',
    'prettier',
    'pyright',
    'pytest',
    'python',
    'python3',
    'ruff',
    'tsc',
    'uvicorn',
  ])
  return knownExternalTools.has(toolName)
}

function externalToolShimError(filePath = '') {
  return `錯誤：不允許建立或覆寫疑似外部工具替身「${filePath}」。缺少 flake8、pytest、npm、pip 等工具或套件時，請更新 requirements.txt、pyproject.toml、package.json 等依賴宣告，改用專案已有的真實驗證指令，或明確回報目前沙盒/網路/權限限制；不得用同名腳本假裝工具已存在。`
}

function acceptedPlanMissingExpectedFiles(expectedFiles = [], baseDir = '') {
  return expectedFiles.filter(file => {
    try {
      return !fs.existsSync(resolveInside(baseDir, file))
    } catch (_) {
      return true
    }
  })
}

function acceptedPlanCompletionReady(options = {}, state = {}) {
  if (!options.requireFileChanges) return false
  if (!state.changedFiles?.size) return false
  if (acceptedPlanMissingExpectedFiles(state.expectedFiles || [], state.baseDir || '').length) return false
  if (options.requireValidation && !state.validationPassed) return false
  if (options.requireValidation && state.unresolvedFailedCommands?.size) return false
  return true
}

function acceptedPlanCompletionMessage(requireValidation, validationCommand = '') {
  return requireValidation
    ? `已完成方案要求的檔案變更，並通過實際驗證：${validationCommand || '可用的專案檢查'}。未執行的外部依賴、網路服務或硬體操作不包含在此驗證範圍。`
    : '已完成方案要求的檔案變更。'
}

function acceptedPlanUnverifiedCompletionMessage() {
  return '已完成方案要求的檔案變更；但目前沒有可自動執行且已通過的驗證命令。請在需要時手動執行規劃中的測試/啟動命令確認成果。'
}

function staticHtmlEntryPoint(baseDir = '', expectedFiles = [], changedFiles = new Set()) {
  const candidates = [
    ...expectedFiles,
    ...Array.from(changedFiles || []),
    'index.html',
  ]
  for (const file of candidates) {
    const normalized = String(file || '').replace(/\\/g, '/')
    if (!/\.html?$/i.test(normalized)) continue
    try {
      const target = resolveInside(baseDir, normalized)
      if (fs.existsSync(target) && fs.statSync(target).isFile()) return normalized
    } catch (_) {}
  }
  return ''
}

function formatValidationResult(result = {}) {
  let output = ''
  if (result.stdout) output += `STDOUT:\n${result.stdout}\n`
  if (result.stderr) output += `STDERR:\n${result.stderr}\n`
  if (result.ok === false) output += `ERROR:\nExit code: ${result.exitCode ?? result.returncode ?? 1}\n`
  return output || (result.ok ? '驗證已成功執行，沒有輸出。' : '驗證失敗，沒有輸出。')
}

async function maybeRunStaticHtmlValidation(options = {}, state = {}) {
  if (options.requireValidation !== true) return null
  if (state.validationPassed) return null
  if (!state.changedFiles?.size) return null
  if (acceptedPlanMissingExpectedFiles(state.expectedFiles || [], state.baseDir || '').length) return null

  const entryPoint = staticHtmlEntryPoint(state.baseDir || '', state.expectedFiles || [], state.changedFiles)
  if (!entryPoint) return null

  const validateStaticHtml = options.validateStaticHtml || sandboxService.runStaticHtmlCheck
  const result = await validateStaticHtml(entryPoint, {
    workspaceId: options.workspaceId,
    cwdRelative: state.sandboxCwd || '',
  })
  const command = result.command || `frontend static check ${entryPoint}`
  return {
    ok: result.ok === true,
    command,
    observation: formatValidationResult(result),
  }
}

function agentLoopLlmTimeoutMs(options = {}) {
  const requested = Number(options.llmTimeoutMs || config.agentLoopLlmTimeoutMs || config.ollamaReadTimeoutMs || 120000)
  if (!Number.isFinite(requested) || requested <= 0) return 120000
  return Math.max(30000, Math.min(requested, 300000))
}

async function runAgentLoop(instruction, options = {}) {
  if (!options.workspaceId || !options.sandboxWorkspacePath) {
    throw new Error('AI Sandbox workspace is not prepared')
  }

  const sandboxWorkspace = path.resolve(options.sandboxWorkspacePath)
  const useManagedCopy = options.isLocalHandle || options.workspaceSource !== 'backend'
  const baseDir = useManagedCopy ? sandboxWorkspace : path.resolve(config.workspaceDir || config.sandboxDir)
  fs.mkdirSync(baseDir, { recursive: true })
  const cwd = resolveInside(baseDir, options.defaultDir || '.')
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`Agent working directory does not exist: ${options.defaultDir || '.'}`)
  }
  const sandboxCwd = relativeWorkspacePath(baseDir, cwd)
  fs.mkdirSync(resolveInside(sandboxWorkspace, sandboxCwd || '.'), { recursive: true })
  const expectedFiles = Array.isArray(options.expectedFiles) ? options.expectedFiles.filter(Boolean) : []
  const validationCommands = Array.isArray(options.validationCommands) ? options.validationCommands.filter(Boolean) : []
  const fileChangeRequirement = options.requireFileChanges
    ? `\nExecution requirement: This is an accepted implementation plan. You MUST make at least one real source-file change with write_file or replace_file_content before finish.${expectedFiles.length ? ` Expected files include: ${expectedFiles.join(', ')}.` : ''} Track every implementation step with update_task_list, mark progress as you go, then validate in the Docker Sandbox before finish.\n`
    : ''
  const sandboxNetworkState = config.dockerSandbox.networkDisabled ? 'disabled (--network none)' : 'enabled'
  let history = `Task: ${instruction}\nProject Workspace: ${baseDir}\nAI Sandbox: ${sandboxWorkspace} mounted as /workspace\nSandbox Network: ${sandboxNetworkState}\nWorking Directory: ${sandboxCwd || '.'}${fileChangeRequirement}\n`
  const maxIterations = options.maxIterations || 100
  let iteration = 0
  let consecutiveErrors = 0
  let toolFormatRepairAttempts = 0
  
  let currentTaskList = 'No tasks recorded yet.'
  let lastToolCallJson = null
  let lastToolFailed = false
  const changedFiles = new Set()
  let validationPassed = options.requireValidation !== true
  let validationCommand = ''
  let unvalidatedFinishAttempts = 0
  const unresolvedFailedCommands = new Set()
  const recentFailures = []

  const events = options.onEvent || (() => {})
  const requestLlm = options.askLlm || askLlm
  const runSandboxCommand = options.executeCommand || executeCommand
  events({ type: 'start', message: 'Agent 迴圈已啟動。' })

  const systemPrompt = `You are an Autonomous AI Agent (Antigravity Mode).
You can read and edit files only inside the project workspace.
All run_command calls execute inside the project's isolated Docker Sandbox, mounted at /workspace.
Docker Sandbox network is ${sandboxNetworkState}. If network is disabled, do not rely on pip install, npm install, apt install, external downloads, live map/data APIs, or CDN assets during validation. Prefer the standard library and packages already present in the sandbox; when an external dependency is unavoidable, implement a real input/config boundary and report the environment limitation instead of retrying downloads.
Use the sandbox to inspect, build, run, and test the project after changes.
Do not edit source files with run_command; use write_file or replace_file_content so changes stay synchronized.
When the task is an accepted implementation plan, planning-only phrases such as "do not modify files" are historical constraints and no longer apply. Implement the accepted plan in the workspace before finishing.
For an accepted implementation plan, convert the plan into a task list first, execute each item in order where possible, update the task list after each meaningful item, and do not finish until real file changes and required validation evidence are present.
Do not satisfy the task with fake data, mock data, sample data, fixed seeds, hard-coded successful results, demo-only placeholders, or invented external responses. Production/source files must implement the real requested behavior against real workspace inputs, user-provided data, configuration, files, APIs, or explicit integration boundaries. Mocks are allowed only in tests for true external boundaries, and must be clearly limited to test files. If real data or an external service is unavailable, implement the real input/config/import/API boundary and report the environment limitation; never pretend fake data is a working product.
Do not create local scripts, modules, binaries, or wrappers named after missing external tools such as flake8, pytest, pip, npm, node, python, ruff, black, eslint, prettier, or tsc. If a dependency or CLI tool is missing, update the project's dependency manifest or report the sandbox limitation; never fake a tool to make validation look successful.
Do not execute placeholder commands containing tokens such as <請替換...>, <your path>, path/to/file, or similar. Replace them with a real temporary validation fixture when safe. For image/audio/file-input tasks, tests may create small deterministic fixture files inside the test/output workspace to validate real code paths; this is allowed as test evidence, but do not ship fixture data as the product behavior.
When writing Python scripts that create files, you MUST explicitly create necessary parent directories using os.makedirs(os.path.dirname(filepath), exist_ok=True) to avoid FileNotFoundError.
You must think step-by-step.

Available tools:
1. run_command: Execute a shell command. Args: {"command": "..."}
2. list_dir: List contents of a directory. Args: {"path": "..."}
3. read_file: Read file contents. Args: {"path": "..."}
4. write_file: Write or overwrite a file. Args: {"path": "...", "content": "..."}
5. replace_file or replace_file_content: Precise substring replacement in a file. Args: {"path": "...", "target_string": "...", "replacement_string": "..."}
6. update_task_list: Update your in-memory task progress. Args: {"task_list": "..."}
7. finish: Mark the task as complete. Args: {"message": "..."}

To use a tool, you MUST first output your thought process wrapped in <thought>...</thought> tags, followed by exactly ONE tool call wrapped in <tool_call> XML tags.
The content inside <tool_call> must be valid JSON.

Example of running a command:
<thought>
I need to initialize the project. I will use the run_command tool.
</thought>
<tool_call>
{
  "tool": "run_command",
  "args": {
    "command": "npm init -y"
  }
}
</tool_call>

Example of finishing when all tasks are complete:
<thought>
All required files have been created and validated. I will call finish.
</thought>
<tool_call>
{
  "tool": "finish",
  "args": {
    "message": "Project implementation completed successfully."
  }
}
</tool_call>

You can only use one tool per turn. Wait for the Observation before proceeding.
`

  while (iteration < maxIterations) {
    if (acceptedPlanCompletionReady(options, { changedFiles, expectedFiles, baseDir, validationPassed, unresolvedFailedCommands })) {
      const evidenceBasedMessage = acceptedPlanCompletionMessage(options.requireValidation, validationCommand)
      events({ type: 'finish', message: evidenceBasedMessage })
      return { ok: true, history, finalMessage: evidenceBasedMessage, changedFiles: Array.from(changedFiles), validationPassed, validationCommand }
    }

    if (consecutiveErrors >= 5) {
      const error = formatAbortError(recentFailures)
      events({ type: 'error', message: error })
      return { ok: false, error, history, recentFailures }
    }
    if (toolFormatRepairAttempts >= 8) {
      const error = `模型連續輸出無效工具格式過多，已中止流程。最近失敗：\n\n${recentFailures.slice(-3).join('\n') || '工具 JSON 解析失敗'}`
      events({ type: 'error', message: error })
      return { ok: false, error, history, recentFailures }
    }
    
    iteration++
    const missingExpectedFiles = acceptedPlanMissingExpectedFiles(expectedFiles, baseDir)
    let planGuidance = ''
    if (expectedFiles.length > 0) {
      if (missingExpectedFiles.length > 0) {
        planGuidance = `\n[Plan Status] Still missing required files from the accepted plan: ${missingExpectedFiles.join(', ')}. Please use write_file to create: ${missingExpectedFiles[0]}.\n`
      } else {
        planGuidance = `\n[Plan Status] All expected files (${expectedFiles.join(', ')}) have been written. If you have finished all tasks, call finish tool: <tool_call>{"tool": "finish", "args": {"message": "All plan files created successfully."}}</tool_call>\n`
      }
    }
    const prompt = `${systemPrompt}\n\nCurrent Task List State:\n${currentTaskList}\n\nHistory of actions and observations:\n${history}${planGuidance}\nWhat is your next action? (Remember to output <thought> followed strictly by ONE <tool_call>)`
    
    events({ type: 'thinking', message: `第 ${iteration} 輪：思考中...` })
    
    const result = await requestLlm(prompt, {
      temperature: 0.2,
      numPredict: 2500,
      timeoutMs: agentLoopLlmTimeoutMs(options),
      requestEndpoint: '/api/agent/loop',
      preferChat: true,
    })
    if (!result.ok || !(result.content || '').trim()) {
      consecutiveErrors++
      const errMsg = result.error || 'LLM 回傳空白內容'
      events({ type: 'info', message: `LLM 回應異常 (${errMsg})，正在自動重試 (${consecutiveErrors}/5)...` })
      rememberFailure(recentFailures, `LLM 回應異常：${errMsg}`)
      history += `\n=== Observation ===\nError: LLM call failed or returned empty content (${errMsg}). Please retry and ensure you output valid XML with a tool call.\n`
      continue
    }

    const content = result.content || ''
    history += `\n=== Agent Thought ===\n${content}\n`

    let jsonStr = ''
    const toolMatch = content.match(/<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/i)
    
    if (toolMatch && toolMatch[1].trim()) {
      jsonStr = toolMatch[1]
    } else {
      // Fallback 1: Try to extract from markdown JSON block
      const jsonBlockMatch = content.match(/```(?:json)?\s*(\{\s*"tool"[\s\S]*?\})\s*```/i)
      if (jsonBlockMatch) {
        jsonStr = jsonBlockMatch[1]
      } else {
        // Fallback 2: Try to extract from alternative tags like <action>...</action> or <call>...</call>
        const altTagMatch = content.match(/<(?:action|call|tool)>([\s\S]*?)(?:<\/(?:action|call|tool)>|$)/i)
        if (altTagMatch && altTagMatch[1].trim()) {
          jsonStr = altTagMatch[1]
        } else {
          // Fallback 3: Try to find a raw JSON object matching the schema
          const rawJsonMatch = content.match(/\{\s*"tool"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[\s\S]*\}\s*\}/)
          if (rawJsonMatch) {
            jsonStr = rawJsonMatch[0]
          }
        }
      }
    }

    // Fallback 4: Finish intent detection when model outputs natural language completion without XML tags
    if (!jsonStr) {
      const cleanContent = content.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim()
      const isFinishKeyword = /\b(?:all tasks completed|all files created|task completed|everything is done|finished|finish|done|已完成|全部完成|執行完畢|實作完成|全數完成)\b/i.test(cleanContent)
      const hasFinishTag = /<finish>[\s\S]*?(?:<\/finish>|$)/i.test(content) || /"tool"\s*:\s*"finish"/i.test(content)
      const currentMissingFiles = acceptedPlanMissingExpectedFiles(expectedFiles, baseDir)
      
      if ((isFinishKeyword || hasFinishTag) && (expectedFiles.length === 0 || currentMissingFiles.length === 0)) {
        jsonStr = JSON.stringify({
          tool: 'finish',
          args: { message: cleanContent.slice(0, 300) || 'Task completed' }
        })
      } else if ((isFinishKeyword || hasFinishTag) && currentMissingFiles.length > 0) {
        toolFormatRepairAttempts++
        events({ type: 'info', message: `模型嘗試提早結束，但方案檔案尚未完成：${currentMissingFiles.join('、')}` })
        rememberFailure(recentFailures, `方案檔案尚未完成：${currentMissingFiles.join('、')}`)
        history += `\n=== Observation ===\nError: You indicated task completion, but the following required plan files are still missing: ${currentMissingFiles.join(', ')}. Do not finish yet. Please call write_file to create ${currentMissingFiles[0]}.\nExample:\n<tool_call>\n{\n  "tool": "write_file",\n  "args": {\n    "path": "${currentMissingFiles[0]}",\n    "content": "..."\n  }\n}\n</tool_call>\n`
        continue
      }
    }

    if (jsonStr && jsonStr === lastToolCallJson && lastToolFailed) {
      consecutiveErrors++
      events({ type: 'info', message: '偵測到重複失敗的工具呼叫，已攔截。' })
      rememberFailure(recentFailures, `重複失敗工具呼叫：${jsonStr.slice(0, 500)}`)
      history += `\n=== Observation ===\nError: You repeated the exact same tool call that previously failed. Please change your strategy or fix the syntax.\n`
      continue
    }
    if (jsonStr) {
      lastToolCallJson = jsonStr
    }

    if (!jsonStr) {
      toolFormatRepairAttempts++
      events({ type: 'info', message: '未偵測到工具呼叫，正在要求模型重新輸出。' })
      rememberFailure(recentFailures, '模型回覆沒有 <tool_call>，無法執行下一步。')
      const currentMissing = acceptedPlanMissingExpectedFiles(expectedFiles, baseDir)
      const nextHint = currentMissing.length > 0
        ? ` You still need to create: ${currentMissing.join(', ')}. Use write_file for ${currentMissing[0]}.`
        : ' If all tasks are done, call finish.'
      const exampleTool = currentMissing.length > 0 ? 'write_file' : 'finish'
      const exampleArgs = currentMissing.length > 0 ? `"path": "${currentMissing[0]}", "content": "..."` : '"message": "Completed"'
      history += `\n=== Observation ===\nError: No valid <tool_call> found in your response.${nextHint}\nYou MUST output exactly ONE valid JSON object wrapped in <tool_call> tags.\nExample:\n<tool_call>\n{\n  "tool": "${exampleTool}",\n  "args": {\n    ${exampleArgs}\n  }\n}\n</tool_call>\n`
      continue
    }

    let toolCall
    try {
      jsonStr = jsonStr.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
      if (jsonStr.endsWith('</tool_call>')) {
        jsonStr = jsonStr.slice(0, -'</tool_call>'.length).trim()
      }
      toolCall = JSON.parse(jsonStr)
      
      // Basic validation
      if (!toolCall.tool || !toolCall.args) {
        throw new Error("Missing 'tool' or 'args' field in JSON")
      }
      
    } catch (e) {
      toolFormatRepairAttempts++
      events({ type: 'info', message: '工具 JSON 解析失敗，正在要求模型修正。' })
      rememberFailure(recentFailures, `工具 JSON 解析失敗：${e.message}`)
      history += `\n=== Observation ===\nError: Parsed content is not valid tool JSON (${e.message}). Please strictly output valid JSON with "tool" and "args" properties wrapped in <tool_call> tags.\n`
      continue
    }
    toolFormatRepairAttempts = 0

    const { tool, args } = toolCall
    events({ type: 'tool', tool, args, message: `執行工具：${tool}` })

    if (tool === 'finish') {
      if (options.requireFileChanges && changedFiles.size === 0) {
        consecutiveErrors++
        lastToolFailed = true
        events({ type: 'info', message: '尚未寫入任何專案檔案，不能結束；請依已接受方案繼續實作。' })
        rememberFailure(recentFailures, 'Agent 嘗試在尚未寫入任何專案檔案前結束。')
        history += `\n=== Observation ===\nError: The user accepted the implementation plan, but no project files were written. Do not finish yet. Use write_file or replace_file_content to implement the accepted plan, then run an appropriate validation.\n`
        continue
      }
      const missingExpectedFiles = acceptedPlanMissingExpectedFiles(expectedFiles, baseDir)
      if (options.requireFileChanges && missingExpectedFiles.length) {
        consecutiveErrors++
        lastToolFailed = true
        events({ type: 'info', message: `方案預期檔案尚未完成：${missingExpectedFiles.join('、')}` })
        rememberFailure(recentFailures, `方案預期檔案尚未完成：${missingExpectedFiles.join('、')}`)
        history += `\n=== Observation ===\nError: Do not finish. These accepted-plan files are still missing: ${missingExpectedFiles.join(', ')}. Create or correct them before validation.\n`
        continue
      }
      if (options.requireValidation && !validationPassed) {
        const candidates = autoValidationCandidates(validationCommands)
        let autoValidationObservation = ''
        for (const command of candidates) {
          events({ type: 'action', message: `[AI Sandbox] > ${command}` })
          const result = await runSandboxCommand(command, sandboxCwd, options.workspaceId)
          autoValidationObservation += `\n=== Auto Validation: ${command} ===\n${result}\n`
          if (!observationFailed(result)) {
            validationPassed = true
            validationCommand = command
            unresolvedFailedCommands.delete(command)
            events({ type: 'validation', message: `驗證通過：${command}`, command })
            break
          }
          unresolvedFailedCommands.add(command)
          const advice = sandboxNetworkLimitationAdvice(command, result)
          if (advice) {
            events({ type: 'info', message: '沙盒網路停用，外部依賴安裝失敗；請改用離線可驗證方案。' })
            rememberFailure(recentFailures, advice)
          }
        }
        history += autoValidationObservation ? `\n=== Observation ===\n${autoValidationObservation}\n` : ''
        if (!validationPassed && !unresolvedFailedCommands.size) {
          unvalidatedFinishAttempts++
          if (unvalidatedFinishAttempts < 2) {
            lastToolFailed = false
            events({ type: 'info', message: '尚未通過實作後驗證；請先執行一個可用的驗證命令，若環境無法驗證再回報限制。' })
            history += `\n=== Observation ===\nValidation has not passed yet. Run an appropriate available validation command next. If no safe validation is possible in this environment, call finish again and clearly report the limitation.\n`
            continue
          }
          const finalMessage = acceptedPlanUnverifiedCompletionMessage()
          events({ type: 'finish', message: finalMessage })
          return { ok: true, history, finalMessage, changedFiles: Array.from(changedFiles), validationPassed, validationCommand: '' }
        }
      }
      if (options.requireValidation && unresolvedFailedCommands.size) {
        consecutiveErrors++
        lastToolFailed = true
        const failedCommands = Array.from(unresolvedFailedCommands).join(', ')
        events({ type: 'info', message: `仍有失敗指令尚未修復：${failedCommands}` })
        rememberFailure(recentFailures, `仍有失敗指令尚未修復：${failedCommands}`)
        history += `\n=== Observation ===\nError: Do not finish. These commands failed and have not succeeded afterward: ${failedCommands}. Fix the root cause and rerun them successfully before finishing.\n`
        continue
      }

      const evidenceBasedMessage = options.requireValidation
        ? acceptedPlanCompletionMessage(true, validationCommand)
        : (args.message || acceptedPlanCompletionMessage(false, validationCommand))
      events({ type: 'finish', message: evidenceBasedMessage })
      


      return { ok: true, history, finalMessage: evidenceBasedMessage, changedFiles: Array.from(changedFiles), validationPassed, validationCommand }
    }

    let observation = ''
    try {
      if (tool === 'run_command') {
        const cmd = args.command
        events({ type: 'action', message: `[AI Sandbox] > ${cmd}` })
        observation = commandContainsPlaceholder(cmd)
          ? placeholderCommandError(cmd)
          : await runSandboxCommand(cmd, sandboxCwd, options.workspaceId)
        const commandFailed = observationFailed(observation)
        if (commandFailed) {
          const advice = sandboxNetworkLimitationAdvice(cmd, observation)
          if (advice) {
            events({ type: 'info', message: '沙盒網路停用，外部依賴安裝失敗；請改用離線可驗證方案。' })
            observation += `\n${advice}\n`
            rememberFailure(recentFailures, advice)
          }
          unresolvedFailedCommands.add(String(cmd || '').trim())
          if (changedFiles.size) validationPassed = false
        } else {
          unresolvedFailedCommands.delete(String(cmd || '').trim())
        }
        if (!commandFailed && changedFiles.size && isValidationCommand(cmd)) {
          validationPassed = true
          validationCommand = cmd
          events({ type: 'validation', message: `驗證通過：${cmd}`, command: cmd })
        }
      } else if (tool === 'list_dir') {
        const targetPath = resolveFromWorkingDirectory(baseDir, cwd, args.path || '.')
        events({ type: 'action', message: `列出資料夾 ${args.path || '.'}` })
        if (fs.existsSync(targetPath)) {
          const files = fs.readdirSync(targetPath, { withFileTypes: true })
          observation = files.map(f => `${f.isDirectory() ? '[DIR]' : '[FILE]'} ${f.name}`).join('\n') || '空資料夾'
        } else {
          observation = `錯誤：找不到資料夾 - ${args.path}`
        }
      } else if (tool === 'read_file') {
        const targetPath = resolveFromWorkingDirectory(baseDir, cwd, args.path)
        events({ type: 'action', message: `讀取 ${args.path}` })
        if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
          observation = fs.readFileSync(targetPath, 'utf8')
        } else {
          observation = `錯誤：找不到檔案 - ${args.path}`
        }
      } else if (tool === 'write_file') {
        if (isLikelyExternalToolShimPath(args.path)) {
          observation = externalToolShimError(args.path)
        } else {
        const targetPath = resolveFromWorkingDirectory(baseDir, cwd, args.path)
        events({ type: 'action', message: `寫入 ${args.path}` })
        fs.mkdirSync(path.dirname(targetPath), { recursive: true })
        fs.writeFileSync(targetPath, args.content, 'utf8')
        validationPassed = options.requireValidation !== true
        const relPath = relativeWorkspacePath(baseDir, targetPath)
        changedFiles.add(relPath)
        if (baseDir !== sandboxWorkspace) {
          const sandboxTarget = resolveInside(sandboxWorkspace, relPath)
          fs.mkdirSync(path.dirname(sandboxTarget), { recursive: true })
          fs.writeFileSync(sandboxTarget, args.content, 'utf8')
        }
        events({ type: 'file_change', path: relPath, content: args.content, isNew: true })
        observation = `檔案已成功寫入 ${args.path}`
        }
      } else if (tool === 'replace_file' || tool === 'replace_file_content') {
        if (isLikelyExternalToolShimPath(args.path)) {
          observation = externalToolShimError(args.path)
        } else {
        const targetPath = resolveFromWorkingDirectory(baseDir, cwd, args.path)
        events({ type: 'action', message: `取代 ${args.path} 的內容` })
        if (!fs.existsSync(targetPath)) {
          observation = `錯誤：找不到檔案 - ${args.path}`
        } else {
          const fileContent = fs.readFileSync(targetPath, 'utf8')
          const targetString = args.target_string || ''
          const replacementString = args.replacement_string || ''
          
          if (!targetString) {
            observation = `錯誤：target_string 不能為空。`
          } else {
            const count = fileContent.split(targetString).length - 1
            if (count === 0) {
              observation = `錯誤：檔案中找不到 target_string。`
            } else if (count > 1) {
              observation = `錯誤：target_string 出現多次（${count} 次）。請提供更精確的 target_string。`
            } else {
              const newContent = fileContent.replace(targetString, replacementString)
              fs.writeFileSync(targetPath, newContent, 'utf8')
              validationPassed = options.requireValidation !== true
              
              const relPath = relativeWorkspacePath(baseDir, targetPath)
              changedFiles.add(relPath)
              if (baseDir !== sandboxWorkspace) {
                const sandboxTarget = resolveInside(sandboxWorkspace, relPath)
                fs.mkdirSync(path.dirname(sandboxTarget), { recursive: true })
                fs.writeFileSync(sandboxTarget, newContent, 'utf8')
              }
              events({ type: 'file_change', path: relPath, content: newContent, isNew: false })
              observation = `已成功取代 ${args.path} 中的目標文字`
            }
          }
        }
        }
      } else if (tool === 'update_task_list') {
        currentTaskList = args.task_list || ''
        events({ type: 'action', message: `更新任務清單` })
        observation = `任務清單已更新。`
      } else {
        observation = `錯誤：未知工具「${tool}」`
      }

      if (!observationFailed(observation)) {
        const autoValidation = await maybeRunStaticHtmlValidation(options, {
          changedFiles,
          expectedFiles,
          baseDir,
          sandboxCwd,
          validationPassed,
        })
        if (autoValidation) {
          observation += `\n\n=== Automatic Validation ===\n${autoValidation.observation}`
          if (autoValidation.ok) {
            validationPassed = true
            validationCommand = autoValidation.command
            events({ type: 'validation', message: `驗證通過：${autoValidation.command}`, command: autoValidation.command })
          }
        }
      }
    } catch (e) {
      observation = `工具執行錯誤：${e.message}`
    }

    lastToolFailed = observationFailed(observation)
    consecutiveErrors = lastToolFailed ? consecutiveErrors + 1 : 0
    if (lastToolFailed) {
      const summary = summarizeFailureObservation(observation)
      if (summary) {
        rememberFailure(recentFailures, summary)
      }
    }

    history += `\n=== Observation ===\n${observation.slice(0, 5000)}${observation.length > 5000 ? '\n...[truncated]' : ''}\n`
    events({ type: 'observation', message: observation.slice(0, 500) + (observation.length > 500 ? '...' : '') })
  }

  events({ type: 'error', message: '已達最大迭代次數。' })
  return { ok: false, error: '已達最大迭代次數。', history }
}

module.exports = {
  runAgentLoop
}
