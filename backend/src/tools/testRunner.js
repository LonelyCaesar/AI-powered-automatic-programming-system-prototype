const fs = require('fs')
const path = require('path')
const { stageProjectWorkspace } = require('../services/sandboxWorkspaceService')
const { validateGeneratedArtifact } = require('../services/generatedCodeValidation')

const pythonExtensions = new Set(['.py'])
const nodeExtensions = new Set(['.js', '.mjs', '.cjs', '.jsx'])
const databaseExtensions = new Set(['.sql', '.db', '.sqlite', '.sqlite3'])

function isPythonGuiCode(code = '') {
  const text = String(code || '')
  return /(^|\n)\s*(import\s+tkinter\b|from\s+tkinter\s+import\b|import\s+customtkinter\b|from\s+customtkinter\s+import\b|import\s+turtle\b|from\s+turtle\s+import\b|import\s+wx\b|from\s+wx\s+import\b|import\s+kivy\b|from\s+kivy\b|import\s+PyQt\d\b|from\s+PyQt\d\b|import\s+PySide\d\b|from\s+PySide\d\b)/i.test(text) ||
    /\.mainloop\s*\(|\bTk\s*\(/i.test(text)
}

function isLongRunningPythonCode(code = '') {
  const text = String(code || '')
  const hasIntentionalInfiniteLoop = /(^|\n)\s*while\s+(?:True|1)\s*:/i.test(text)
  const hasManualStopContract = /KeyboardInterrupt|Ctrl\s*\+\s*C/i.test(text)
  const hasPacedLoop = /\b(?:time\.)?sleep\s*\(/i.test(text)
  return hasIntentionalInfiniteLoop && hasManualStopContract && hasPacedLoop
}

function isBrowserJavaScriptModule(filePath = '', code = '') {
  const text = String(code || '')
  const extension = path.posix.extname(normalizeRelativePath(filePath)).toLowerCase()
  if (extension === '.jsx') return true
  return /(^|\n)\s*import\s+React\b/i.test(text) ||
    /\bfrom\s+['"](?:react|react-dom|lucide-react)['"]/i.test(text) ||
    /(^|\n)\s*export\s+default\s+[A-Z][A-Za-z0-9_]*/.test(text) ||
    /<[A-Z][A-Za-z0-9]*(?:\s|>|\/>)/.test(text) ||
    /\bclassName\s*=/.test(text)
}

function runJavaScriptComponentSyntaxCheck(filePath = '', code = '', workspace = {}) {
  const target = normalizeRelativePath(filePath || 'current_file.js')
  const result = validateGeneratedArtifact({ code, filePath: target, language: 'javascript' })
  return {
    ok: result.ok === true,
    kind: 'javascript_jsx_syntax',
    command: `JSX-aware syntax check ${target}`,
    returncode: result.ok ? 0 : 1,
    exitCode: result.ok ? 0 : 1,
    stdout: result.ok ? `${target} JSX/ES module syntax check passed.\n` : '',
    stderr: result.errors.join('\n'),
    elapsed_seconds: 0,
    sandbox: {
      engine: 'local_parser',
      isolated: false,
      status: result.ok ? 'passed' : 'failed',
      workspace_id: workspace.id || '',
      workspace: workspace.path || '',
    },
    passed: result.ok ? 1 : 0,
    failed: result.ok ? 0 : 1,
    total: 1,
  }
}

function readWorkspaceText(workspacePath = '', filePath = '') {
  const target = normalizeRelativePath(filePath)
  if (!target || !workspacePath) return ''
  try {
    return fs.readFileSync(path.join(workspacePath, ...target.split('/')), 'utf8')
  } catch {
    return ''
  }
}

function safeModuleName(filePath) {
  const stem = path.basename(String(filePath || 'current_file.py')).replace(/\.[^.]+$/, '')
  return stem.replace(/[^A-Za-z0-9_]/g, '_') || 'current_file'
}

function parseCounts(stdout, stderr) {
  const text = `${stdout || ''}\n${stderr || ''}`
  const passed = Number((text.match(/(\d+)\s+passed/) || [0, 0])[1])
  const failed = Number((text.match(/(\d+)\s+failed/) || [0, 0])[1])
  const errors = Number((text.match(/(\d+)\s+error/) || [0, 0])[1])
  return { passed, failed: failed + errors, total: passed + failed + errors }
}

function hasHtmlReference(html, attribute, fileName) {
  const escapedName = String(fileName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${attribute}\\s*=\\s*["'][^"']*${escapedName}(?:[?#][^"']*)?["']`, 'i').test(String(html || ''))
}

function normalizeRelativePath(filePath = '') {
  const clean = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '')
  const normalized = path.posix.normalize(clean)
  if (!normalized || normalized === '..' || normalized.startsWith('../')) return ''
  return normalized
}

function contextFileMap(contextFiles = []) {
  const files = new Map()
  for (const item of Array.isArray(contextFiles) ? contextFiles : []) {
    const filePath = normalizeRelativePath(item?.file_path || item?.path || '')
    if (!filePath || item?.ok === false || item?.encoding === 'base64') continue
    files.set(filePath, String(item?.content ?? ''))
  }
  return files
}

function projectFilePath(filePath, fileName) {
  const clean = normalizeRelativePath(filePath)
  const dir = path.posix.dirname(clean)
  return dir === '.' ? fileName : `${dir}/${fileName}`
}

function isPythonTestFile(filePath = '') {
  const name = path.posix.basename(normalizeRelativePath(filePath)).toLowerCase()
  return name.startsWith('test_') || name.endsWith('_test.py')
}

function discoverPythonTestFiles(workspacePath = '', knownPaths = []) {
  const found = new Set()
  for (const filePath of knownPaths || []) {
    const normalized = normalizeRelativePath(filePath)
    if (normalized && isPythonTestFile(normalized)) found.add(normalized)
  }

  const root = path.resolve(workspacePath || '.')
  const skippedDirectories = new Set(['.git', '.venv', 'venv', 'node_modules', '__pycache__', '.pytest_cache', '.cubi-python-packages'])
  function walk(current) {
    if (found.size >= 100) return
    let entries = []
    try { entries = fs.readdirSync(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (found.size >= 100) break
      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name)) walk(path.join(current, entry.name))
        continue
      }
      if (!entry.isFile() || !isPythonTestFile(entry.name)) continue
      const relative = path.relative(root, path.join(current, entry.name)).replace(/\\/g, '/')
      const normalized = normalizeRelativePath(relative)
      if (normalized) found.add(normalized)
    }
  }
  walk(root)

  return [...found].sort((left, right) => {
    const leftInTests = /(^|\/)tests?\//i.test(left) ? 0 : 1
    const rightInTests = /(^|\/)tests?\//i.test(right) ? 0 : 1
    return leftInTests - rightInTests || left.localeCompare(right)
  })
}

function discoverProjectFiles(workspacePath = '', knownPaths = []) {
  const found = new Set()
  for (const filePath of knownPaths || []) {
    const normalized = normalizeRelativePath(filePath)
    if (normalized) found.add(normalized)
  }

  const root = path.resolve(workspacePath || '.')
  const skippedDirectories = new Set(['.git', '.venv', 'venv', 'node_modules', '__pycache__', '.pytest_cache', '.cubi-python-packages', 'dist', 'build'])
  function walk(current) {
    if (found.size >= 500) return
    let entries = []
    try { entries = fs.readdirSync(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (found.size >= 500) break
      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name)) walk(path.join(current, entry.name))
        continue
      }
      if (!entry.isFile() || entry.name.startsWith('.cubi-')) continue
      const relative = path.relative(root, path.join(current, entry.name)).replace(/\\/g, '/')
      const normalized = normalizeRelativePath(relative)
      if (normalized) found.add(normalized)
    }
  }
  walk(root)
  return [...found].sort((left, right) => left.localeCompare(right))
}

function readPackageScripts(workspacePath = '', projectFiles = []) {
  const packagePaths = projectFiles
    .filter(filePath => path.posix.basename(filePath).toLowerCase() === 'package.json')
    .sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right))
  for (const filePath of packagePaths) {
    try {
      const absolutePath = path.join(workspacePath, ...filePath.split('/'))
      const packageJson = JSON.parse(fs.readFileSync(absolutePath, 'utf8'))
      return {
        filePath,
        cwdRelative: path.posix.dirname(filePath) === '.' ? '' : path.posix.dirname(filePath),
        scripts: packageJson?.scripts && typeof packageJson.scripts === 'object' ? packageJson.scripts : {},
      }
    } catch {}
  }
  return null
}

function readPackageInfo(workspacePath = '', filePath = '') {
  try {
    const absolutePath = path.join(workspacePath, ...normalizeRelativePath(filePath).split('/'))
    const packageJson = JSON.parse(fs.readFileSync(absolutePath, 'utf8'))
    return packageJson && typeof packageJson === 'object' ? packageJson : null
  } catch {
    return null
  }
}

function detectNodeServerApp(workspacePath = '', projectFiles = [], files = new Map()) {
  const normalizedFiles = [...new Set(projectFiles.map(normalizeRelativePath).filter(Boolean))]
  const packagePaths = normalizedFiles
    .filter(filePath => path.posix.basename(filePath).toLowerCase() === 'package.json')
    .sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right))

  for (const packagePath of packagePaths) {
    const dir = path.posix.dirname(packagePath) === '.' ? '' : path.posix.dirname(packagePath)
    const serverCandidates = ['server.js', 'app.js', 'index.js']
      .map(name => dir ? `${dir}/${name}` : name)
    const entryFile = serverCandidates.find(candidate => normalizedFiles.includes(candidate))
    if (!entryFile) continue

    const packageJson = readPackageInfo(workspacePath, packagePath) || {}
    const dependencies = {
      ...(packageJson.dependencies || {}),
      ...(packageJson.devDependencies || {}),
    }
    const serverSource = String(files.get(entryFile) || (() => {
      try { return fs.readFileSync(path.join(workspacePath, ...entryFile.split('/')), 'utf8') } catch { return '' }
    })())
    const looksLikeServer = /(?:require\(['"]express['"]\)|from\s+['"]express['"]|\.listen\s*\(|createServer\s*\()/i.test(serverSource)
      || ['express', 'fastify', 'koa', '@hapi/hapi'].some(name => Object.prototype.hasOwnProperty.call(dependencies, name))
    if (!looksLikeServer) continue

    const startScript = String(packageJson?.scripts?.start || '').trim()
    const hasMessageApi = /\/api\/messages/i.test(serverSource)
      || normalizedFiles.some(filePath => /(?:^|\/)(?:script|main|app)\.js$/i.test(filePath) && /\/api\/messages/i.test(String(files.get(filePath) || '')))

    return {
      framework: 'node_server',
      entryFile,
      command: startScript ? `npm start (${packagePath})` : `node ${entryFile}`,
      startCommand: startScript ? 'npm start' : `node ${path.posix.basename(entryFile)}`,
      port: Number(process.env.CUBI_NODE_APP_PORT || 3000),
      smokeTest: hasMessageApi ? 'message_board' : '',
      label: hasMessageApi ? 'Node.js 留言板後端' : 'Node.js 後端網站',
    }
  }

  return null
}

function projectTypesForFiles(projectFiles = []) {
  const has = predicate => projectFiles.some(predicate)
  return [
    has(filePath => filePath.toLowerCase().endsWith('.py')) ? 'python' : '',
    has(filePath => /\.(?:js|mjs|cjs|ts|tsx|jsx|vue)$/i.test(filePath)) ? 'node' : '',
    has(filePath => /\.html?$/i.test(filePath)) ? 'html' : '',
    has(filePath => /\.css$/i.test(filePath)) ? 'css' : '',
  ].filter(Boolean)
}

function withProjectCheckMetadata(result, projectFiles, projectTypes, checks) {
  const commands = checks.map(check => check.command).filter(Boolean)
  return {
    ...result,
    project_wide: true,
    project_files: projectFiles,
    project_types: projectTypes,
    checks,
    commands,
  }
}

function validationCheck(result = {}, scope = 'project', target = '') {
  return {
    scope,
    target,
    kind: result.kind || 'unknown',
    command: result.command || '',
    ok: result.ok === true,
    exitCode: result.exitCode ?? result.returncode ?? -1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    elapsed_seconds: Number(result.elapsed_seconds || 0),
    sandbox: result.sandbox || null,
  }
}

function targetOnlyProjectResult(workspace, target) {
  const projectFiles = [target].filter(Boolean)
  return {
    ok: true,
    kind: 'target_scope',
    command: '',
    commands: [],
    checks: [],
    stdout: '',
    stderr: '',
    exitCode: 0,
    returncode: 0,
    elapsed_seconds: 0,
    passed: 0,
    failed: 0,
    total: 0,
    project_wide: false,
    target_only: true,
    project_files: projectFiles,
    project_types: projectTypesForFiles(projectFiles),
    sandbox: {
      engine: 'docker',
      isolated: true,
      status: 'ready',
      workspace_id: workspace.id,
      workspace: '/workspace',
    },
  }
}

function combineTargetValidation(projectResult, targetResults, target) {
  const projectChecks = Array.isArray(projectResult.checks)
    ? projectResult.checks.map(check => ({ ...check, scope: check.scope || 'project' }))
    : []
  const targetChecks = targetResults.map(({ result, scope }) => validationCheck(result, scope, target))
  const checks = [...projectChecks, ...targetChecks]
  const lastResult = targetResults.at(-1)?.result || projectResult
  const runtimeResult = targetResults.find(item => item.scope === 'target_runtime')?.result || null
  const implementationResult = targetResults.find(item => item.scope === 'target_implementation')?.result || null
  const ok = projectResult.ok === true && targetResults.every(item => item.result?.ok === true)
  const outputFor = key => checks
    .filter(check => check[key])
    .map(check => `=== ${check.scope}${check.target ? `: ${check.target}` : ''} | ${check.kind} ===\n${check[key]}`)
    .join('\n')

  return {
    ...lastResult,
    ok,
    returncode: ok ? 0 : (lastResult.returncode ?? lastResult.exitCode ?? 1),
    exitCode: ok ? 0 : (lastResult.exitCode ?? lastResult.returncode ?? 1),
    command: lastResult.command || projectResult.command || '',
    commands: checks.map(check => check.command).filter(Boolean),
    checks,
    stdout: outputFor('stdout'),
    stderr: outputFor('stderr'),
    elapsed_seconds: checks.reduce((sum, check) => sum + Number(check.elapsed_seconds || 0), 0),
    passed: checks.filter(check => check.ok).length,
    failed: checks.filter(check => !check.ok).length,
    total: checks.length,
    project_wide: projectResult.project_wide === true,
    target_only: projectResult.target_only === true,
    project_files: projectResult.project_files || [],
    project_types: projectResult.project_types || [],
    target_file: target,
    target_runtime_validated: runtimeResult?.ok === true,
    target_implementation_validated: implementationResult?.ok === true,
    target_stdout: runtimeResult?.stdout || lastResult.stdout || '',
    target_stderr: runtimeResult?.stderr || lastResult.stderr || '',
    target_execution: runtimeResult,
    implementation_check: implementationResult,
  }
}

async function runProjectChecks(workspace, files, sandboxOptions, sandboxService) {
  const projectFiles = discoverProjectFiles(workspace.path, files.keys())
  const projectTypes = projectTypesForFiles(projectFiles)
  const pythonFiles = projectFiles.filter(filePath => pythonExtensions.has(path.posix.extname(filePath).toLowerCase()))
  const pythonTests = discoverPythonTestFiles(workspace.path, projectFiles)
  const integrationTest = pythonTests.find(filePath => filePath.toLowerCase() === 'tests/test_integration.py')
  const hasPytestIni = projectFiles.some(filePath => path.posix.basename(filePath).toLowerCase() === 'pytest.ini')
  const packageInfo = readPackageScripts(workspace.path, projectFiles)
  const checks = []
  let lastExecutedResult = null

  const execute = async runner => {
    const result = await runner()
    lastExecutedResult = result
    checks.push({
      kind: result.kind,
      command: result.command,
      ok: result.ok === true,
      exitCode: result.exitCode ?? result.returncode ?? -1,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      elapsed_seconds: result.elapsed_seconds || 0,
    })
    return result
  }

  if (pythonFiles.length) {
    const syntaxResult = await execute(() => sandboxService.runPythonSyntaxCheckInSandbox(pythonFiles, sandboxOptions))
    if (!syntaxResult.ok) return withProjectCheckMetadata(syntaxResult, projectFiles, projectTypes, checks)
  }

  if (integrationTest) {
    const pytestResult = await execute(() => sandboxService.runPytestInSandbox([integrationTest], sandboxOptions))
    if (!pytestResult.ok) return withProjectCheckMetadata(pytestResult, projectFiles, projectTypes, checks)
  } else if (pythonTests.length || hasPytestIni) {
    const pytestResult = await execute(() => sandboxService.runPytestInSandbox(pythonTests, sandboxOptions))
    if (!pytestResult.ok) return withProjectCheckMetadata(pytestResult, projectFiles, projectTypes, checks)
  }

  const browserModuleFiles = projectFiles.filter(filePath => {
    if (!/\.(?:js|jsx)$/i.test(filePath)) return false
    const code = files.get(filePath) || readWorkspaceText(workspace.path, filePath)
    return isBrowserJavaScriptModule(filePath, code)
  })
  for (const filePath of browserModuleFiles) {
    const code = files.get(filePath) || readWorkspaceText(workspace.path, filePath)
    const componentSyntaxResult = await execute(() => runJavaScriptComponentSyntaxCheck(filePath, code, workspace))
    if (!componentSyntaxResult.ok) return withProjectCheckMetadata(componentSyntaxResult, projectFiles, projectTypes, checks)
  }

  const nodeSyntaxFiles = projectFiles
    .filter(filePath => /\.(?:js|mjs|cjs|json)$/i.test(filePath))
    .filter(filePath => !browserModuleFiles.includes(filePath))
  if (nodeSyntaxFiles.length) {
    const nodeSyntaxResult = await execute(() => sandboxService.runNodeSyntaxCheckInSandbox(nodeSyntaxFiles, sandboxOptions))
    if (!nodeSyntaxResult.ok) return withProjectCheckMetadata(nodeSyntaxResult, projectFiles, projectTypes, checks)
  }

  const nodeServerApp = detectNodeServerApp(workspace.path, projectFiles, files)
  if (nodeServerApp) {
    const { startInteractiveApp } = require('../services/sandboxAppService')
    const appResult = await execute(() => startInteractiveApp(nodeServerApp, sandboxOptions))
    return withProjectCheckMetadata(appResult, projectFiles, projectTypes, checks)
  }

  const htmlFiles = projectFiles.filter(filePath => /\.html?$/i.test(filePath))
  for (const htmlFile of htmlFiles) {
    const staticResult = await execute(() => sandboxService.runStaticHtmlCheck(htmlFile, sandboxOptions))
    if (!staticResult.ok) return withProjectCheckMetadata(staticResult, projectFiles, projectTypes, checks)
  }

  if (packageInfo) {
    const testScript = String(packageInfo.scripts.test || '').trim()
    const buildScript = String(packageInfo.scripts.build || '').trim()
    const npmScript = testScript && !/no test specified/i.test(testScript)
      ? 'test'
      : (buildScript ? 'build' : '')
    if (npmScript) {
      const npmResult = await execute(() => sandboxService.runNpmScriptInSandbox(npmScript, {
        ...sandboxOptions,
        cwdRelative: packageInfo.cwdRelative,
      }))
      if (!npmResult.ok) return withProjectCheckMetadata(npmResult, projectFiles, projectTypes, checks)
    }
  }

  const lastResult = checks.length
    ? {
        ...(lastExecutedResult || {}),
        ok: true,
        kind: 'project_check',
        command: checks.map(check => check.command).join(' && '),
        stdout: checks.map(check => check.stdout).filter(Boolean).join('\n'),
        stderr: '',
        exitCode: 0,
        returncode: 0,
        elapsed_seconds: checks.reduce((sum, check) => sum + Number(check.elapsed_seconds || 0), 0),
        passed: checks.reduce((sum, check) => sum + (check.ok ? 1 : 0), 0),
        failed: 0,
        total: checks.length,
      }
    : noTestCommandResult(projectFiles[0] || 'project', workspace)
  return withProjectCheckMetadata(lastResult, projectFiles, projectTypes, checks)
}

function detectInteractivePythonApp(filePath = '', code = '', files = new Map()) {
  const target = normalizeRelativePath(filePath || 'current_file.py')
  const source = String(code || files.get(target) || '')

  if (/(^|\n)\s*(?:import\s+streamlit\b|from\s+streamlit\s+import\b)/i.test(source)) {
    return {
      framework: 'streamlit',
      entryFile: target,
      command: `python3 -m streamlit run ${target} --server.headless true --server.address 0.0.0.0 --server.port 8501`,
      label: 'Streamlit 網頁應用',
    }
  }

  if (/(^|\n)\s*(?:import\s+flask\b|from\s+flask\s+import\b)/i.test(source)) {
    return {
      framework: 'flask',
      entryFile: target,
      command: `python3 ${target}`,
      label: 'Flask 網頁應用',
    }
  }

  if (/(^|\n)\s*(?:import\s+fastapi\b|from\s+fastapi\s+import\b)/i.test(source)) {
    return {
      framework: 'fastapi',
      entryFile: target,
      command: `uvicorn ${safeModuleName(target)}:app --host 0.0.0.0 --port 8000`,
      label: 'FastAPI 網頁應用',
    }
  }

  if (/(^|\n)\s*(?:import\s+http\.server\b|from\s+http\.server\s+import\b|from\s+http\s+import\s+server\b)/i.test(source)) {
    return {
      framework: 'http_server',
      entryFile: target,
      command: `python3 ${target}`,
      label: 'Python HTTP 伺服器',
    }
  }

  return null
}

function noTestCommandResult(filePath, workspace) {
  const target = normalizeRelativePath(filePath || 'current_file')
  return {
    ok: true,
    kind: 'no_test_command',
    launch_type: 'sandbox_inspection',
    command: 'AI sandbox: no executable test command detected',
    returncode: 0,
    exitCode: 0,
    stdout: `已將專案同步到 AI Docker Sandbox，但 ${target} 沒有可自動判斷的執行或測試方式。\n`,
    stderr: '',
    elapsed_seconds: 0,
    sandbox: {
      engine: 'docker',
      launch_type: 'sandbox_inspection',
      runtime_mode: 'docker',
      isolated: true,
      status: 'ready',
      workspace_id: workspace.id,
      workspace: '/workspace',
      host_workspace: workspace.path,
      container_ephemeral: true,
      error: '',
    },
    messages: ['專案已提供給 AI Sandbox', '未自動執行未知類型檔案'],
    passed: 0,
    failed: 0,
    total: 0,
  }
}

async function runTests(filePath = null, code = null, testsCode = null, contextFiles = [], options = {}) {
  const target = normalizeRelativePath(filePath || 'current_file')
  const extension = path.posix.extname(target).toLowerCase()
  const files = contextFileMap(contextFiles)
  if (code !== null && code !== undefined && target) files.set(target, String(code))

  const workspace = stageProjectWorkspace({
    projectId: options.projectId,
    projectName: options.projectName,
    workspaceSource: options.workspaceSource || 'backend',
    filePath: target,
    code,
    contextFiles,
  })
  const sandboxOptions = { ...options, workspaceId: workspace.id }
  const sandboxService = require('../services/sandboxService')
  if (options.projectWide === true) {
    const projectResult = options.targetOnly === true
      ? targetOnlyProjectResult(workspace, target)
      : await runProjectChecks(workspace, files, sandboxOptions, sandboxService)
    if (options.validateTargetRuntime !== true || projectResult.ok !== true) return projectResult

    const targetResults = []
    if (pythonExtensions.has(extension)) {
      const implementationResult = await sandboxService.runPythonImplementationCheckInSandbox(target, sandboxOptions)
      targetResults.push({ scope: 'target_implementation', result: implementationResult })
      if (!implementationResult.ok) return combineTargetValidation(projectResult, targetResults, target)
    }

    let runtimeResult = await runTests(target, code, testsCode, contextFiles, {
      ...options,
      projectWide: false,
      preferProjectTests: false,
      validateTargetRuntime: false,
      targetOnly: false,
    })
    if (runtimeResult.kind === 'no_test_command') {
      runtimeResult = {
        ...runtimeResult,
        ok: false,
        exitCode: 2,
        returncode: 2,
        stderr: `${runtimeResult.stderr || ''}無法判斷 ${target} 的實際執行方式，因此不能宣稱錯誤修正已通過。\n`,
        passed: 0,
        failed: 1,
        total: 1,
      }
    }
    targetResults.push({ scope: 'target_runtime', result: runtimeResult })
    return combineTargetValidation(projectResult, targetResults, target)
  }

  if (options.staticHtmlCheck === true && ['.html', '.htm'].includes(extension)) {
    return sandboxService.runStaticHtmlCheck(target, sandboxOptions)
  }

  const projectPythonTests = options.preferProjectTests
    ? discoverPythonTestFiles(workspace.path, files.keys())
    : []

  const hasStaticStructure = ['index.html', 'style.css', 'script.js']
    .map(name => projectFilePath(target, name))
    .some(candidate => files.has(candidate))

  const projectFiles = discoverProjectFiles(workspace.path, files.keys())
  const nodeServerApp = detectNodeServerApp(workspace.path, projectFiles, files)
  if (nodeServerApp) {
    const { startInteractiveApp } = require('../services/sandboxAppService')
    return startInteractiveApp(nodeServerApp, sandboxOptions)
  }

  // Explicit test actions validate the project tests before directly running
  // the selected Python source file. This catches related-file regressions
  // introduced by a multi-file AI repair.
  if (pythonExtensions.has(extension)) {
    if (projectPythonTests.length) {
      return sandboxService.runPytestInSandbox(projectPythonTests, sandboxOptions)
    }
    const detectionCode = files.get(target) || ''
    const interactiveApp = detectInteractivePythonApp(target, detectionCode, files)
    if (interactiveApp) {
      const { startInteractiveApp } = require('../services/sandboxAppService')
      return startInteractiveApp(interactiveApp, sandboxOptions)
    }
    if (!isPythonTestFile(target)) {
      const pythonGui = isPythonGuiCode(detectionCode)
      if (pythonGui) {
        const { startGuiApp } = require('../services/sandboxAppService')
        return startGuiApp(target, sandboxOptions)
      }
      const pythonLongRunning = isLongRunningPythonCode(detectionCode)
      return sandboxService.runPythonInSandbox(target, {
        ...sandboxOptions,
        pythonGui: false,
        pythonLongRunning,
      })
    }
    return sandboxService.runPythonInSandbox(target, {
      ...sandboxOptions,
      pythonGui: false,
    })
  }

  if (['.html', '.htm', '.css'].includes(extension) || (nodeExtensions.has(extension) && hasStaticStructure)) {
    const { startInteractiveApp } = require('../services/sandboxAppService')
    return startInteractiveApp({
      framework: 'static_website',
      entryFile: target,
      command: `python3 -m http.server 8787`,
      label: '靜態網站',
    }, sandboxOptions)
  }

  if (nodeExtensions.has(extension)) {
    const detectionCode = files.get(target) || readWorkspaceText(workspace.path, target)
    if (isBrowserJavaScriptModule(target, detectionCode)) {
      return runJavaScriptComponentSyntaxCheck(target, detectionCode, workspace)
    }
    return sandboxService.runNodeInSandbox(target, sandboxOptions)
  }

  if (extension === '.java') {
    return sandboxService.runJavaInSandbox(target, sandboxOptions)
  }

  if (databaseExtensions.has(extension)) {
    return sandboxService.runDatabaseInSandbox(target, sandboxOptions)
  }

  return noTestCommandResult(target, workspace)
}

module.exports = {
  runTests,
  isPythonGuiCode,
  isLongRunningPythonCode,
  isBrowserJavaScriptModule,
  runJavaScriptComponentSyntaxCheck,
  readWorkspaceText,
  detectInteractivePythonApp,
  discoverPythonTestFiles,
  discoverProjectFiles,
  readPackageScripts,
  detectNodeServerApp,
  projectTypesForFiles,
  runProjectChecks,
  combineTargetValidation,
  isPythonTestFile,
  parseCounts,
  safeModuleName,
  hasHtmlReference,
}
