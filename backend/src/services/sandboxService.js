const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')
const { spawn } = require('child_process')
const config = require('../config')
const { dockerStatus } = require('../tools/dockerSandbox')
const { validateGeneratedArtifact } = require('./generatedCodeValidation')
const { resolveProjectWorkspace } = require('./sandboxWorkspaceService')

function parseCounts(stdout, stderr) {
  const text = `${stdout || ''}\n${stderr || ''}`
  const passed = Number((text.match(/(\d+)\s+passed/) || [0, 0])[1])
  const failed = Number((text.match(/(\d+)\s+failed/) || [0, 0])[1])
  const errors = Number((text.match(/(\d+)\s+error/) || [0, 0])[1])
  return { passed, failed: failed + errors, total: passed + failed + errors }
}

function shellQuote(value = '') {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function cleanRelativePath(filePath = '') {
  const clean = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '')
  const normalized = path.posix.normalize(clean)
  if (!normalized || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('沙盒執行檔案路徑無效')
  }
  return normalized
}

function sandboxWorkingDirectory(value = '') {
  const clean = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim()
  if (!clean || clean === '.') return '/workspace'
  const normalized = path.posix.normalize(clean)
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error('沙盒工作目錄超出專案 workspace')
  }
  return `/workspace/${normalized}`
}

function sandboxMetadata(workspace, status, extra = {}) {
  return {
    engine: 'docker',
    isolated: true,
    status,
    workspace_id: workspace.id,
    workspace: '/workspace',
    host_workspace: workspace.path,
    container_ephemeral: true,
    network: config.dockerSandbox.networkDisabled ? 'none' : 'bridge',
    ...extra,
  }
}

function unavailableResult(kind, command, workspaceId, message) {
  let workspace = { id: workspaceId || '', path: '' }
  try {
    if (workspaceId) workspace = resolveProjectWorkspace(workspaceId)
  } catch {}
  return {
    ok: false,
    kind,
    command,
    stdout: '',
    stderr: `${message}\n`,
    exitCode: -1,
    returncode: -1,
    elapsed_seconds: 0,
    sandbox: sandboxMetadata(workspace, 'error', { error: message }),
    passed: 0,
    failed: 1,
    total: 1,
  }
}

function ensureSandboxRuntimeDirs(workspacePath = '') {
  const names = ['.cubi-home', '.cubi-tmp', '.cubi-cache']
  for (const name of names) {
    fs.mkdirSync(path.join(workspacePath, name), { recursive: true })
  }
}

function effectiveSandboxTimeoutMs(options = {}) {
  const hasExplicitTimeout = Object.prototype.hasOwnProperty.call(options, 'timeoutMs')
  const rawTimeout = hasExplicitTimeout
    ? Number(options.timeoutMs)
    : Number(config.dockerSandbox.timeout) * 1000
  if (!Number.isFinite(rawTimeout)) return 60000
  if (rawTimeout <= 0) return 0
  return rawTimeout
}

function runCommandInSandbox(commandArgs, options = {}) {
  return new Promise(resolve => {
    const start = Date.now()
    const workspace = resolveProjectWorkspace(options.workspaceId)
    ensureSandboxRuntimeDirs(workspace.path)
    const timeoutMs = effectiveSandboxTimeoutMs(options)
    const dockerArgs = [
      'run',
      '--rm',
      '--name', `cubi-run-${randomUUID().slice(0, 10)}`,
      '--memory', config.dockerSandbox.memory || '512m',
      '--cpus', String(config.dockerSandbox.cpus || '1.0'),
      '--pids-limit', String(config.dockerSandbox.pidsLimit || 256),
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--read-only',
      '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m',
      '-e', 'HOME=/workspace/.cubi-home',
      '-e', 'TMPDIR=/workspace/.cubi-tmp',
      '-e', 'TEMP=/workspace/.cubi-tmp',
      '-e', 'TMP=/workspace/.cubi-tmp',
      '-e', 'XDG_CACHE_HOME=/workspace/.cubi-cache',
      '-e', 'PIP_NO_CACHE_DIR=1',
    ]
    if (config.dockerSandbox.networkDisabled) dockerArgs.push('--network', 'none')
    dockerArgs.push(
      '-v', `${workspace.path}:/workspace:rw`,
      '-w', sandboxWorkingDirectory(options.cwdRelative),
      config.dockerSandbox.image,
      ...commandArgs
    )

    let stdout = ''
    let stderr = ''
    let child
    let settled = false

    function finish(result) {
      if (settled) return
      settled = true
      resolve({
        ...result,
        workspace,
        elapsed_seconds: Number(((Date.now() - start) / 1000).toFixed(2)),
      })
    }

    try {
      child = spawn('docker', dockerArgs, { shell: false, windowsHide: true })
    } catch (error) {
      finish({ ok: false, stdout: '', stderr: error.message, exitCode: -1 })
      return
    }

    const timer = timeoutMs > 0
      ? setTimeout(() => {
          child.kill('SIGKILL')
          stderr += `\nSandbox execution timeout (${Math.round(timeoutMs / 1000)}s).`
        }, timeoutMs)
      : null

    child.stdout.on('data', chunk => { stdout += chunk.toString() })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.on('error', error => {
      if (timer) clearTimeout(timer)
      finish({ ok: false, stdout, stderr: `${stderr}\n${error.message}`, exitCode: -1 })
    })
    child.on('close', code => {
      if (timer) clearTimeout(timer)
      finish({ ok: code === 0, stdout, stderr, exitCode: code ?? -1 })
    })
  })
}

function dockerReady(kind, command, options = {}) {
  const status = dockerStatus()
  if (status.ok) return null
  return unavailableResult(
    kind,
    command,
    options.workspaceId,
    `Docker Sandbox 未就緒：${status.message}。請用 Dockerfile.sandbox 建置 ${config.dockerSandbox.image}。`
  )
}

function requiredPythonCliArguments(source = '') {
  if (!/\bargparse\b|ArgumentParser\s*\(/.test(source)) return []
  const required = []
  const pattern = /\.add_argument\s*\(\s*(['"])(?!-)([^'"]+)\1([^)]*)\)/g
  let match
  while ((match = pattern.exec(String(source || ''))) !== null) {
    const name = String(match[2] || '').trim()
    const options = String(match[3] || '')
    if (!name || /(?:^|\W)(?:nargs\s*=\s*['"][?*]['"]|default\s*=)/.test(options)) continue
    required.push(name)
  }
  return [...new Set(required)]
}

function cliArgumentsRequiredResult(relativePath, commandLabel, options, requiredArgs) {
  const workspace = resolveProjectWorkspace(options.workspaceId)
  const argsText = requiredArgs.join(', ')
  const stderr = [
    `此 Python 程式需要命令列參數：${argsText}`,
    `沙盒自動執行目前只收到檔案路徑 ${relativePath}，未收到必要參數。`,
    '請提供參數後重跑；系統不會用固定資料或假資料代替使用者輸入。',
  ].join('\n')
  return {
    ok: false,
    kind: 'python_cli_args_required',
    command: `docker run --rm ... ${commandLabel}`,
    stdout: '',
    stderr,
    exitCode: 2,
    returncode: 2,
    elapsed_seconds: 0,
    sandbox: sandboxMetadata(workspace, 'failed', {
      validation: 'python_cli_arguments_required',
      required_args: requiredArgs,
    }),
    passed: 0,
    failed: 1,
    total: 1,
  }
}

function splitUsageCommand(command = '') {
  const tokens = []
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g
  let match
  while ((match = pattern.exec(String(command || ''))) !== null) {
    const token = match[1] ?? match[2] ?? match[3] ?? ''
    if (!token || /[;&|`$]/.test(token)) return []
    tokens.push(token)
  }
  return tokens
}

function isPlaceholderUsageToken(token = '') {
  const text = String(token || '').trim()
  if (!text) return true
  if (/^[<[{].*[>\]}]$/.test(text)) return true
  if (/^(?:symbol|ticker|arg|args|argument|value|input|file|filename|path|target|name|id)$/i.test(text)) return true
  return false
}

function extractConcretePythonUsageCommand(output = '', relativePath = '') {
  const target = cleanRelativePath(relativePath)
  const targetBase = path.posix.basename(target)
  const lines = String(output || '').split(/\r?\n/)
  for (const line of lines) {
    const match = line.match(/\bUsage:\s*(.+)$/i)
    if (!match) continue
    const tokens = splitUsageCommand(match[1])
    if (tokens.length < 3) continue
    const runner = tokens[0].toLowerCase()
    if (!/^(?:py|python|python3|python\d+(?:\.\d+)?)$/.test(runner)) continue
    const script = normalizeUsagePath(tokens[1])
    if (script !== target && path.posix.basename(script) !== targetBase) continue
    const args = tokens.slice(2)
    if (!args.length || args.some(isPlaceholderUsageToken)) continue
    return { script, args, source: match[0] }
  }
  return null
}

function normalizeUsagePath(value = '') {
  const clean = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '')
  const normalized = path.posix.normalize(clean)
  if (!normalized || normalized === '..' || normalized.startsWith('../')) return ''
  return normalized
}

async function runPythonInSandbox(filePath, options = {}) {
  const relativePath = cleanRelativePath(filePath)
  const dependencyRunner = '.cubi-run-python.py'
  const isTestFile = path.posix.basename(relativePath).startsWith('test_') || relativePath.endsWith('_test.py')
  const isGui = Boolean(options.pythonGui)
  const isLongRunning = Boolean(options.pythonLongRunning) && !isTestFile && !isGui
  const smokeSeconds = 3
  const commandLabel = isTestFile
    ? `python3 -m pytest -q ${relativePath}`
    : isGui
      ? `timeout 3s python3 ${dependencyRunner} --gui ${relativePath}`
      : isLongRunning
        ? `timeout ${smokeSeconds}s python3 -u ${dependencyRunner} ${relativePath}`
        : `python3 ${dependencyRunner} ${relativePath}`
  const resultKind = isGui ? 'python_gui' : isLongRunning ? 'python_long_running' : 'python'
  const unavailable = dockerReady(resultKind, commandLabel, options)
  if (unavailable) return unavailable
  if (!isTestFile) {
    const syntaxResult = await runPythonSyntaxCheckInSandbox([relativePath], options)
    if (!syntaxResult.ok) return syntaxResult
  }
  if (!isTestFile && !isGui) {
    try {
      const workspace = resolveProjectWorkspace(options.workspaceId)
      const sourcePath = path.join(workspace.path, ...relativePath.split('/'))
      const requiredArgs = requiredPythonCliArguments(fs.readFileSync(sourcePath, 'utf8'))
      if (requiredArgs.length) return cliArgumentsRequiredResult(relativePath, commandLabel, options, requiredArgs)
    } catch {}
  }

  const script = isTestFile
    ? `xvfb-run -a python3 -m pytest -q ${shellQuote(relativePath)}`
    : isGui
      ? `timeout 3s python3 ${shellQuote(dependencyRunner)} --gui ${shellQuote(relativePath)}; code=$?; if [ "$code" = "124" ]; then echo "GUI smoke test stayed alive for 3 seconds."; exit 0; fi; exit "$code"`
      : isLongRunning
        ? `output_file=$(mktemp); timeout ${smokeSeconds}s python3 -u ${shellQuote(dependencyRunner)} ${shellQuote(relativePath)} >"$output_file" 2>&1; code=$?; cat "$output_file"; if [ "$code" = "124" ]; then if [ -s "$output_file" ]; then rm -f "$output_file"; echo "Long-running console smoke test stayed alive and produced output for ${smokeSeconds} seconds."; exit 0; fi; rm -f "$output_file"; echo "Long-running program stayed alive but produced no observable output." >&2; exit 1; fi; rm -f "$output_file"; exit "$code"`
        : `python3 ${shellQuote(dependencyRunner)} ${shellQuote(relativePath)}`
  let runResult = await runCommandInSandbox(['sh', '-lc', script], options)
  let effectiveCommandLabel = commandLabel
  let usageCommand = null
  if (!isTestFile && !isGui && !isLongRunning && runResult.exitCode !== 0) {
    usageCommand = extractConcretePythonUsageCommand(`${runResult.stdout || ''}\n${runResult.stderr || ''}`, relativePath)
    if (usageCommand) {
      const rerunScript = `python3 ${shellQuote(dependencyRunner)} ${shellQuote(relativePath)} ${usageCommand.args.map(shellQuote).join(' ')}`
      const rerunResult = await runCommandInSandbox(['sh', '-lc', rerunScript], options)
      effectiveCommandLabel = `python3 ${dependencyRunner} ${relativePath} ${usageCommand.args.join(' ')}`
      runResult = {
        ...rerunResult,
        stdout: [
          runResult.stdout,
          `\n[auto usage rerun] ${effectiveCommandLabel}\n`,
          rerunResult.stdout,
        ].filter(Boolean).join(''),
        stderr: [runResult.stderr, rerunResult.stderr].filter(Boolean).join('\n'),
      }
    }
  }
  const counts = isTestFile
    ? parseCounts(runResult.stdout, runResult.stderr)
    : { passed: runResult.exitCode === 0 ? 1 : 0, failed: runResult.exitCode === 0 ? 0 : 1, total: 1 }

  return {
    ok: runResult.exitCode === 0,
    kind: resultKind,
    command: `docker run --rm ... ${effectiveCommandLabel}`,
    stdout: runResult.stdout,
    stderr: runResult.stderr,
    exitCode: runResult.exitCode,
    returncode: runResult.exitCode,
    elapsed_seconds: runResult.elapsed_seconds,
    sandbox: sandboxMetadata(runResult.workspace, runResult.exitCode === 0 ? 'passed' : 'failed', {
      gui_mode: isGui ? 'xvfb_headless_smoke_test' : '',
      long_running_mode: isLongRunning ? 'bounded_output_smoke_test' : '',
      smoke_seconds: isLongRunning ? smokeSeconds : undefined,
      auto_usage_command: usageCommand ? effectiveCommandLabel : undefined,
    }),
    ...counts,
  }
}

async function runPythonImplementationCheckInSandbox(filePath, options = {}) {
  const relativePath = cleanRelativePath(filePath)
  const commandLabel = `python3 AST incomplete-implementation check ${relativePath}`
  const unavailable = dockerReady('python_implementation', commandLabel, options)
  if (unavailable) return unavailable

  const checker = `
import ast
import sys

target = sys.argv[1]
with open(target, "r", encoding="utf-8") as source_file:
    tree = ast.parse(source_file.read(), filename=target)

def is_docstring(node):
    return isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str)

def is_not_implemented_raise(node):
    if not isinstance(node, ast.Raise) or node.exc is None:
        return False
    exc = node.exc.func if isinstance(node.exc, ast.Call) else node.exc
    return isinstance(exc, ast.Name) and exc.id == "NotImplementedError"

incomplete = []
for node in ast.walk(tree):
    if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        continue
    body = list(node.body)
    if body and is_docstring(body[0]):
        body = body[1:]
    placeholder = len(body) == 1 and (
        isinstance(body[0], ast.Pass)
        or (isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and body[0].value.value is Ellipsis)
        or is_not_implemented_raise(body[0])
    )
    if placeholder:
        incomplete.append((node.lineno, node.name))

if incomplete:
    for line, name in incomplete:
        print(f"{target}:{line}: incomplete implementation: function '{name}' contains only pass / Ellipsis / NotImplementedError", file=sys.stderr)
    sys.exit(1)

print(f"No placeholder-only function implementations found in {target}.")
`
  const runResult = await runCommandInSandbox(['python3', '-c', checker, relativePath], options)
  const ok = runResult.exitCode === 0
  return {
    ok,
    kind: 'python_implementation',
    command: `docker run --rm ... ${commandLabel}`,
    stdout: runResult.stdout,
    stderr: runResult.stderr,
    exitCode: runResult.exitCode,
    returncode: runResult.exitCode,
    elapsed_seconds: runResult.elapsed_seconds,
    sandbox: sandboxMetadata(runResult.workspace, ok ? 'passed' : 'failed', {
      validation: 'python_ast_incomplete_implementation',
    }),
    passed: ok ? 1 : 0,
    failed: ok ? 0 : 1,
    total: 1,
  }
}

async function runPytestInSandbox(filePaths = [], options = {}) {
  const targets = [...new Set((Array.isArray(filePaths) ? filePaths : [filePaths])
    .map(cleanRelativePath)
    .filter(Boolean))]
  const dependencyRunner = '.cubi-run-python.py'
  const pytestIgnoreArgs = ['--ignore=.cubi-python-packages', '--ignore=.cubi-home', '--ignore=.cubi-cache', '--ignore=.cubi-tmp']
  const commandLabel = `python3 -m pytest -q --capture=no ${pytestIgnoreArgs.join(' ')} ${targets.join(' ')}`.trim()
  const unavailable = dockerReady('pytest', commandLabel, options)
  if (unavailable) return unavailable

  const pythonPathExport = `export PYTHONPATH="/workspace/.cubi-python-packages${'${PYTHONPATH:+:$PYTHONPATH}'}"`
  const dependencySetup = targets.length
    ? targets.map(target => `python3 ${shellQuote(dependencyRunner)} --deps-only ${shellQuote(target)}`).join(' && ')
    : `if [ -f requirements.txt ]; then python3 -m pip install --target .cubi-python-packages --disable-pip-version-check --prefer-binary -r requirements.txt; fi`
  const script = `${dependencySetup} && ${pythonPathExport} && xvfb-run -a python3 -m pytest -q --capture=no ${pytestIgnoreArgs.map(shellQuote).join(' ')} ${targets.map(shellQuote).join(' ')}`.trim()
  const runResult = await runCommandInSandbox(['sh', '-lc', script], options)
  const counts = parseCounts(runResult.stdout, runResult.stderr)
  return {
    ok: runResult.exitCode === 0,
    kind: 'pytest',
    command: `docker run --rm ... ${commandLabel}`,
    stdout: runResult.stdout,
    stderr: runResult.stderr,
    exitCode: runResult.exitCode,
    returncode: runResult.exitCode,
    elapsed_seconds: runResult.elapsed_seconds,
    sandbox: sandboxMetadata(runResult.workspace, runResult.exitCode === 0 ? 'passed' : 'failed'),
    ...counts,
  }
}

async function runPythonSyntaxCheckInSandbox(filePaths = [], options = {}) {
  const targets = [...new Set((Array.isArray(filePaths) ? filePaths : [filePaths])
    .map(cleanRelativePath)
    .filter(Boolean))]
  const commandLabel = `python3 syntax check ${targets.join(' ')}`.trim()
  const unavailable = dockerReady('python_syntax', commandLabel, options)
  if (unavailable) return unavailable

  const checker = [
    'import ast, pathlib, sys',
    'failed = False',
    'for name in sys.argv[1:]:',
    '    try:',
    "        ast.parse(pathlib.Path(name).read_text(encoding='utf-8'), filename=name)",
    '    except SyntaxError as error:',
    "        print(f'{name}:{error.lineno}:{error.offset}: SyntaxError: {error.msg}', file=sys.stderr)",
    '        failed = True',
    'raise SystemExit(1 if failed else 0)',
  ].join('\n')
  const runResult = await runCommandInSandbox(['python3', '-c', checker, ...targets], options)
  return {
    ok: runResult.exitCode === 0,
    kind: 'python_syntax',
    command: `docker run --rm ... ${commandLabel}`,
    stdout: runResult.stdout || (runResult.exitCode === 0 ? `Python 語法檢查通過：${targets.length} 個檔案\n` : ''),
    stderr: runResult.stderr,
    exitCode: runResult.exitCode,
    returncode: runResult.exitCode,
    elapsed_seconds: runResult.elapsed_seconds,
    sandbox: sandboxMetadata(runResult.workspace, runResult.exitCode === 0 ? 'passed' : 'failed'),
    passed: runResult.exitCode === 0 ? targets.length : 0,
    failed: runResult.exitCode === 0 ? 0 : 1,
    total: targets.length || 1,
  }
}

async function runNpmScriptInSandbox(scriptName, options = {}) {
  const script = String(scriptName || '').trim()
  const commandLabel = script === 'test' ? 'npm test' : `npm run ${script}`
  const unavailable = dockerReady(script === 'test' ? 'npm_test' : 'npm_build', commandLabel, options)
  if (unavailable) return unavailable
  const runResult = await runCommandInSandbox(['npm', script === 'test' ? 'test' : 'run', ...(script === 'test' ? [] : [script])], options)
  const counts = parseCounts(runResult.stdout, runResult.stderr)
  return {
    ok: runResult.exitCode === 0,
    kind: script === 'test' ? 'npm_test' : 'npm_build',
    command: `docker run --rm ... ${commandLabel}`,
    stdout: runResult.stdout,
    stderr: runResult.stderr,
    exitCode: runResult.exitCode,
    returncode: runResult.exitCode,
    elapsed_seconds: runResult.elapsed_seconds,
    sandbox: sandboxMetadata(runResult.workspace, runResult.exitCode === 0 ? 'passed' : 'failed'),
    passed: counts.total ? counts.passed : (runResult.exitCode === 0 ? 1 : 0),
    failed: counts.total ? counts.failed : (runResult.exitCode === 0 ? 0 : 1),
    total: counts.total || 1,
  }
}

async function runNodeSyntaxCheckInSandbox(filePaths = [], options = {}) {
  const targets = [...new Set((Array.isArray(filePaths) ? filePaths : [filePaths])
    .map(cleanRelativePath)
    .filter(Boolean))]
  const commandLabel = `node/json syntax check ${targets.join(' ')}`.trim()
  const unavailable = dockerReady('node_syntax', commandLabel, options)
  if (unavailable) return unavailable

  const jsonChecker = "const fs=require('fs'); try { JSON.parse(fs.readFileSync(process.argv[1], 'utf8')) } catch (error) { console.error(process.argv[1] + ':1:1: JSONError: ' + error.message); process.exit(1) }"
  const script = targets.map(target => target.toLowerCase().endsWith('.json')
    ? `node -e ${shellQuote(jsonChecker)} ${shellQuote(target)}`
    : `node --check ${shellQuote(target)}`
  ).join(' && ')
  const runResult = await runCommandInSandbox(['sh', '-lc', script], options)
  return {
    ok: runResult.exitCode === 0,
    kind: 'node_syntax',
    command: `docker run --rm ... ${commandLabel}`,
    stdout: runResult.stdout || (runResult.exitCode === 0 ? `Node/JSON 語法檢查通過：${targets.length} 個檔案\n` : ''),
    stderr: runResult.stderr,
    exitCode: runResult.exitCode,
    returncode: runResult.exitCode,
    elapsed_seconds: runResult.elapsed_seconds,
    sandbox: sandboxMetadata(runResult.workspace, runResult.exitCode === 0 ? 'passed' : 'failed'),
    passed: runResult.exitCode === 0 ? targets.length : 0,
    failed: runResult.exitCode === 0 ? 0 : 1,
    total: targets.length || 1,
  }
}

async function runNodeInSandbox(filePath, options = {}) {
  const relativePath = cleanRelativePath(filePath)
  const unavailable = dockerReady('node', `node ${relativePath}`, options)
  if (unavailable) return unavailable
  const workspace = resolveProjectWorkspace(options.workspaceId)
  let commandLabel = `node ${relativePath}`
  let script = `node ${shellQuote(relativePath)}`
  const packagePath = path.join(workspace.path, 'package.json')
  if (fs.existsSync(packagePath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
      const testScript = String(packageJson?.scripts?.test || '').trim()
      if (testScript && !/no test specified/i.test(testScript)) {
        commandLabel = 'npm test'
        script = 'npm test'
      }
    } catch {}
  }
  const runResult = await runCommandInSandbox(['sh', '-lc', script], options)
  const parsed = commandLabel === 'npm test' ? parseCounts(runResult.stdout, runResult.stderr) : { passed: 0, failed: 0, total: 0 }
  const counts = parsed.total
    ? parsed
    : { passed: runResult.exitCode === 0 ? 1 : 0, failed: runResult.exitCode === 0 ? 0 : 1, total: 1 }
  return {
    ok: runResult.exitCode === 0,
    kind: 'node',
    command: `docker run --rm ... ${commandLabel}`,
    stdout: runResult.stdout,
    stderr: runResult.stderr,
    exitCode: runResult.exitCode,
    returncode: runResult.exitCode,
    elapsed_seconds: runResult.elapsed_seconds,
    sandbox: sandboxMetadata(runResult.workspace, runResult.exitCode === 0 ? 'passed' : 'failed'),
    ...counts,
  }
}

async function runJavaInSandbox(filePath, options = {}) {
  const relativePath = cleanRelativePath(filePath)
  const className = path.posix.basename(relativePath, '.java')
  const sourceDir = path.posix.dirname(relativePath)
  const classPath = sourceDir === '.' ? '/workspace' : `/workspace/${sourceDir}`
  const workspace = resolveProjectWorkspace(options.workspaceId)
  let mainClass = className
  try {
    const source = fs.readFileSync(path.join(workspace.path, ...relativePath.split('/')), 'utf8')
    const packageMatch = source.match(/^\s*package\s+([A-Za-z_][\w.]*)\s*;/m)
    if (packageMatch) mainClass = `${packageMatch[1]}.${className}`
  } catch {}
  const commandLabel = `javac ${relativePath} && java -cp ${classPath} ${mainClass}`
  const unavailable = dockerReady('java', commandLabel, options)
  if (unavailable) return unavailable
  const script = `javac ${shellQuote(relativePath)} && java -cp ${shellQuote(classPath)} ${shellQuote(mainClass)}`
  const runResult = await runCommandInSandbox(['sh', '-lc', script], options)
  return {
    ok: runResult.exitCode === 0,
    kind: 'java',
    command: `docker run --rm ... ${commandLabel}`,
    stdout: runResult.stdout,
    stderr: runResult.stderr,
    exitCode: runResult.exitCode,
    returncode: runResult.exitCode,
    elapsed_seconds: runResult.elapsed_seconds,
    sandbox: sandboxMetadata(runResult.workspace, runResult.exitCode === 0 ? 'passed' : 'failed'),
    passed: runResult.exitCode === 0 ? 1 : 0,
    failed: runResult.exitCode === 0 ? 0 : 1,
    total: 1,
  }
}

async function runDatabaseInSandbox(filePath, options = {}) {
  const relativePath = cleanRelativePath(filePath)
  const extension = path.posix.extname(relativePath).toLowerCase()
  const isSql = extension === '.sql'
  const commandLabel = isSql
    ? `sqlite3 cubi-sandbox.db < ${relativePath}`
    : `sqlite3 ${relativePath} "PRAGMA integrity_check; .tables"`
  const unavailable = dockerReady('database', commandLabel, options)
  if (unavailable) return unavailable
  const script = isSql
    ? `sqlite3 cubi-sandbox.db < ${shellQuote(relativePath)} && sqlite3 cubi-sandbox.db 'PRAGMA integrity_check;'`
    : `sqlite3 ${shellQuote(relativePath)} 'PRAGMA integrity_check;' && sqlite3 ${shellQuote(relativePath)} '.tables'`
  const runResult = await runCommandInSandbox(['sh', '-lc', script], options)
  return {
    ok: runResult.exitCode === 0,
    kind: 'database',
    command: `docker run --rm ... ${commandLabel}`,
    stdout: runResult.stdout,
    stderr: runResult.stderr,
    exitCode: runResult.exitCode,
    returncode: runResult.exitCode,
    elapsed_seconds: runResult.elapsed_seconds,
    sandbox: sandboxMetadata(runResult.workspace, runResult.exitCode === 0 ? 'passed' : 'failed', {
      database_engine: 'sqlite',
    }),
    passed: runResult.exitCode === 0 ? 1 : 0,
    failed: runResult.exitCode === 0 ? 0 : 1,
    total: 1,
  }
}

function resolveLocalHtmlAsset(indexPath, reference = '') {
  const raw = String(reference || '').trim()
  if (!raw || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(raw)) return ''
  const withoutSuffix = raw.split(/[?#]/, 1)[0].replace(/\\/g, '/')
  if (!withoutSuffix) return ''
  const baseDir = path.posix.dirname(cleanRelativePath(indexPath))
  const candidate = withoutSuffix.startsWith('/')
    ? withoutSuffix.replace(/^\/+/, '')
    : path.posix.join(baseDir === '.' ? '' : baseDir, withoutSuffix)
  try {
    return cleanRelativePath(candidate)
  } catch {
    return ''
  }
}

function extractLocalHtmlAssets(html = '', indexPath = 'index.html') {
  const scripts = []
  const styles = []
  const add = (collection, reference) => {
    const resolved = resolveLocalHtmlAsset(indexPath, reference)
    if (resolved && !collection.includes(resolved)) collection.push(resolved)
  }

  let match
  const scriptPattern = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi
  while ((match = scriptPattern.exec(String(html || ''))) !== null) add(scripts, match[1])

  const linkPattern = /<link\b[^>]*>/gi
  while ((match = linkPattern.exec(String(html || ''))) !== null) {
    const tag = match[0]
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] || ''
    const rel = tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1] || ''
    if (href && (/\bstylesheet\b/i.test(rel) || /\.css(?:[?#]|$)/i.test(href))) add(styles, href)
  }

  return { scripts, styles }
}

function extractInlineHtmlScripts(html = '') {
  const scripts = []
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
  let match
  while ((match = scriptPattern.exec(String(html || ''))) !== null) {
    const attrs = match[1] || ''
    if (/\bsrc\s*=/i.test(attrs)) continue
    const type = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1] || ''
    if (type && !/^(?:module|text\/javascript|application\/javascript)$/i.test(type)) continue
    scripts.push(match[2] || '')
  }
  return scripts
}

function extractElementInnerHtmlById(html = '', id = '') {
  const safeId = String(id || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!safeId) return null
  const tagPattern = new RegExp(`<([a-z][\\w:-]*)\\b[^>]*\\bid\\s*=\\s*["']${safeId}["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i')
  return String(html || '').match(tagPattern)?.[2] ?? null
}

function detectEmptyInnerHtmlGuardRisks(html = '', scripts = extractInlineHtmlScripts(html)) {
  const checks = []
  for (const script of scripts) {
    const bindings = new Map()
    const bindingPattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*document\.getElementById\(\s*["']([^"']+)["']\s*\)/g
    let binding
    while ((binding = bindingPattern.exec(script)) !== null) {
      bindings.set(binding[1], binding[2])
    }

    for (const [variable, id] of bindings) {
      const guardPattern = new RegExp(`${variable}\\s*\\.\\s*innerHTML\\s*={2,3}\\s*["']\\s*["']`)
      if (!guardPattern.test(script)) continue
      const innerHtml = extractElementInnerHtmlById(html, id)
      const invisibleContent = String(innerHtml ?? '').replace(/<!--[\s\S]*?-->/g, '').trim()
      if (innerHtml != null && String(innerHtml).trim() && !invisibleContent) {
        checks.push({
          ok: false,
          message: `#${id} 只有註解或空白，但 JavaScript 使用 ${variable}.innerHTML === '' 判斷初始化，瀏覽器會略過建立內容而造成空白頁`,
        })
      }
    }

    const directPattern = /document\.getElementById\(\s*["']([^"']+)["']\s*\)\s*\.\s*innerHTML\s*={2,3}\s*["']\s*["']/g
    let direct
    while ((direct = directPattern.exec(script)) !== null) {
      const id = direct[1]
      const innerHtml = extractElementInnerHtmlById(html, id)
      const invisibleContent = String(innerHtml ?? '').replace(/<!--[\s\S]*?-->/g, '').trim()
      if (innerHtml != null && String(innerHtml).trim() && !invisibleContent) {
        checks.push({
          ok: false,
          message: `#${id} 只有註解或空白，但 JavaScript 使用 innerHTML === '' 判斷初始化，可能造成空白頁`,
        })
      }
    }
  }
  return checks
}

function inspectInlineHtmlScripts(html = '') {
  const scripts = extractInlineHtmlScripts(html)
  const checks = scripts.map((_script, index) => ({
    ok: true,
    message: `inline script ${index + 1} 已納入靜態檢查`,
  }))
  const domApiChecks = scripts.flatMap((script, index) => inspectDocumentApiCalls(script, `inline script ${index + 1}`))
  return [...checks, ...domApiChecks, ...detectEmptyInnerHtmlGuardRisks(html, scripts)]
}

const COMMON_DOCUMENT_METHODS = new Set([
  'addEventListener',
  'adoptNode',
  'append',
  'caretPositionFromPoint',
  'caretRangeFromPoint',
  'close',
  'createAttribute',
  'createAttributeNS',
  'createCDATASection',
  'createComment',
  'createDocumentFragment',
  'createElement',
  'createElementNS',
  'createEvent',
  'createExpression',
  'createNodeIterator',
  'createNSResolver',
  'createProcessingInstruction',
  'createRange',
  'createTextNode',
  'createTreeWalker',
  'elementFromPoint',
  'elementsFromPoint',
  'evaluate',
  'execCommand',
  'exitFullscreen',
  'exitPictureInPicture',
  'getElementById',
  'getElementsByClassName',
  'getElementsByName',
  'getElementsByTagName',
  'getElementsByTagNameNS',
  'hasFocus',
  'importNode',
  'open',
  'prepend',
  'queryCommandEnabled',
  'queryCommandIndeterm',
  'queryCommandState',
  'queryCommandSupported',
  'queryCommandValue',
  'querySelector',
  'querySelectorAll',
  'releaseCapture',
  'removeEventListener',
  'replaceChildren',
  'requestStorageAccess',
  'startViewTransition',
])

function inspectDocumentApiCalls(script = '', sourceLabel = 'script') {
  const checks = []
  const seen = new Set()
  const pattern = /\bdocument\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g
  let match
  while ((match = pattern.exec(script))) {
    const method = match[1]
    if (COMMON_DOCUMENT_METHODS.has(method) || seen.has(method)) continue
    seen.add(method)
    checks.push({
      ok: false,
      message: `${sourceLabel} 使用未知 document.${method}()，可能造成前端執行錯誤`,
    })
  }
  return checks
}

async function runStaticHtmlCheck(filePath, options = {}) {
  const start = Date.now()
  const workspace = resolveProjectWorkspace(options.workspaceId)
  const cleanPath = cleanRelativePath(filePath)
  const readText = relative => {
    const target = path.join(workspace.path, ...relative.split('/'))
    return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
  }
  const html = readText(cleanPath)
  const assets = extractLocalHtmlAssets(html, cleanPath)
  const inlineScriptChecks = inspectInlineHtmlScripts(html)
  const referencedAssets = [...assets.styles, ...assets.scripts]
  const checks = [
    { ok: Boolean(html), message: `${cleanPath} ${html ? '存在' : '不存在'}` },
    {
      ok: !/<\/?file_output\b/i.test(html),
      message: `${cleanPath} 不含模型輸出包裝標籤`,
    },
    ...inlineScriptChecks,
    ...referencedAssets.map(asset => ({
      ok: fs.existsSync(path.join(workspace.path, ...asset.split('/'))),
      message: `${cleanPath} 引用的 ${asset} 存在`,
    })),
  ]
  let nodeResult = { exitCode: 0, stdout: '', stderr: '', elapsed_seconds: 0, workspace }
  const existingScripts = assets.scripts.filter(asset =>
    /\.(?:js|mjs|cjs)$/i.test(asset) && fs.existsSync(path.join(workspace.path, ...asset.split('/')))
  )
  if (existingScripts.length) {
    const localScriptErrors = []
    for (const scriptPath of existingScripts) {
      const scriptText = readText(scriptPath)
      checks.push(...inspectDocumentApiCalls(scriptText, scriptPath))
      const syntax = validateGeneratedArtifact({ code: scriptText, filePath: scriptPath, language: 'javascript' })
      if (syntax.ok !== true) {
        localScriptErrors.push(...syntax.errors.map(error => `${scriptPath}: ${error}`))
      }
    }
    if (localScriptErrors.length) {
      nodeResult = {
        ok: false,
        kind: 'javascript_syntax',
        command: `local JavaScript syntax check (${existingScripts.join(', ')})`,
        stdout: '',
        stderr: localScriptErrors.join('\n'),
        exitCode: 1,
        returncode: 1,
        elapsed_seconds: 0,
        sandbox: sandboxMetadata(workspace, 'failed', { engine: 'local_parser', isolated: false }),
        passed: 0,
        failed: 1,
        total: 1,
      }
    } else {
      nodeResult = await runNodeSyntaxCheckInSandbox(existingScripts, options)
      if (nodeResult.kind === 'sandbox_unavailable') return nodeResult
    }
    checks.push({ ok: nodeResult.ok === true, message: `HTML 引用的 JavaScript 語法檢查（${existingScripts.length} 個檔案）` })
  }
  const passed = checks.filter(item => item.ok).length
  const failed = checks.length - passed
  return {
    ok: failed === 0,
    kind: 'html_check',
    command: `docker run --rm ... frontend static check${existingScripts.length ? ` + JavaScript syntax check (${existingScripts.join(', ')})` : ''}`,
    stdout: `${checks.map(item => `${item.ok ? 'PASS' : 'FAIL'} ${item.message}`).join('\n')}\n${nodeResult.stdout || ''}`,
    stderr: nodeResult.stderr || '',
    exitCode: failed ? 1 : 0,
    returncode: failed ? 1 : 0,
    elapsed_seconds: Number(((Date.now() - start) / 1000).toFixed(2)),
    sandbox: sandboxMetadata(workspace, failed ? 'failed' : 'passed'),
    passed,
    failed,
    total: checks.length,
  }
}

module.exports = {
  runCommandInSandbox,
  effectiveSandboxTimeoutMs,
  runPythonInSandbox,
  runPythonImplementationCheckInSandbox,
  runPytestInSandbox,
  runPythonSyntaxCheckInSandbox,
  runNpmScriptInSandbox,
  runNodeSyntaxCheckInSandbox,
  runNodeInSandbox,
  runJavaInSandbox,
  runDatabaseInSandbox,
  runStaticHtmlCheck,
  extractLocalHtmlAssets,
  extractInlineHtmlScripts,
  inspectInlineHtmlScripts,
  inspectDocumentApiCalls,
  detectEmptyInnerHtmlGuardRisks,
  extractConcretePythonUsageCommand,
}
