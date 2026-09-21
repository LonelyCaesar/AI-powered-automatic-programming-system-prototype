const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const workspaceServiceSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'services', 'sandboxWorkspaceService.js'),
  'utf8',
)
const sandboxServiceSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'services', 'sandboxService.js'),
  'utf8',
)
const dockerfileSandboxSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'Dockerfile.sandbox'),
  'utf8',
)
const { extractConcretePythonUsageCommand } = require('../src/services/sandboxService')

test('python sandbox maps pandas_ta imports to the installable distribution', () => {
  assert.match(workspaceServiceSource, /"pandas_ta": "pandas-ta-classic"/)
  assert.match(workspaceServiceSource, /"pandas_ta": "pandas_ta_classic"/)
  assert.match(workspaceServiceSource, /請修正來源程式的 import 名稱/)
})

test('dependency discovery follows local imports instead of scanning unrelated project files', () => {
  assert.match(workspaceServiceSource, /pending_files = \[target\]/)
  assert.match(workspaceServiceSource, /local_module_path\(root, python_file, module_name\)/)
  assert.doesNotMatch(workspaceServiceSource, /root\.rglob\("\*\.py"\)/)
})

test('sandbox staging does not sync project-local dependency cache folders', () => {
  assert.match(workspaceServiceSource, /'\.cubi-python-packages'/)
})

test('pytest discovery and execution ignore sandbox dependency cache folders', () => {
  const testRunnerSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'tools', 'testRunner.js'),
    'utf8',
  )
  assert.match(testRunnerSource, /'\.cubi-python-packages'/)
  assert.match(sandboxServiceSource, /--ignore=\.cubi-python-packages/)
})

test('sandbox workspace cleanup retries Docker bind mount leftovers on Windows', () => {
  assert.match(workspaceServiceSource, /maxRetries: 5/)
  assert.match(workspaceServiceSource, /retryDelay: 250/)
})

test('sandbox workspace cleanup preserves installed Python dependency cache', () => {
  assert.match(workspaceServiceSource, /const preserveNames = new Set\(\['\.cubi-python-packages'\]\)/)
  assert.match(workspaceServiceSource, /if \(preserveNames\.has\(entry\)\) continue/)
})

test('normal python execution uses the staged dependency runner', () => {
  assert.match(sandboxServiceSource, /const dependencyRunner = '\.cubi-run-python\.py'/)
  assert.match(sandboxServiceSource, /python3 \$\{shellQuote\(dependencyRunner\)\} \$\{shellQuote\(relativePath\)\}/)
})

test('pip installs use workspace-backed temp directories instead of the small tmpfs', () => {
  assert.match(sandboxServiceSource, /function ensureSandboxRuntimeDirs\(workspacePath = ''\)/)
  assert.match(sandboxServiceSource, /fs\.mkdirSync\(path\.join\(workspacePath, name\), \{ recursive: true \}\)/)
  assert.match(sandboxServiceSource, /'-e', 'TMPDIR=\/workspace\/\.cubi-tmp'/)
  assert.match(sandboxServiceSource, /'-e', 'PIP_NO_CACHE_DIR=1'/)
  assert.match(sandboxServiceSource, /'-e', 'HOME=\/workspace\/\.cubi-home'/)
})

test('python files with required CLI arguments report input requirements instead of auto repair noise', () => {
  assert.match(sandboxServiceSource, /function requiredPythonCliArguments/)
  assert.match(sandboxServiceSource, /python_cli_args_required/)
  assert.match(sandboxServiceSource, /不會用固定資料或假資料代替使用者輸入/)
})

test('sandbox can reuse a concrete Usage command emitted by the program', () => {
  assert.deepEqual(
    extractConcretePythonUsageCommand('Usage: py main.py 2033.TW', 'main.py'),
    { script: 'main.py', args: ['2033.TW'], source: 'Usage: py main.py 2033.TW' },
  )
  assert.equal(extractConcretePythonUsageCommand('Usage: py main.py <symbol>', 'main.py'), null)
  assert.equal(extractConcretePythonUsageCommand('Usage: py other.py 2033.TW', 'main.py'), null)
})

test('python execution runs syntax validation before dependency runner execution', () => {
  assert.match(sandboxServiceSource, /const syntaxResult = await runPythonSyntaxCheckInSandbox\(\[relativePath\], options\)/)
  assert.match(sandboxServiceSource, /if \(!syntaxResult\.ok\) return syntaxResult/)
})

test('offline sandbox reports missing dependencies as an environment block', () => {
  assert.match(workspaceServiceSource, /NETWORK_DISABLED/)
  assert.match(workspaceServiceSource, /CUBI_ENVIRONMENT_BLOCKED/)
  assert.doesNotMatch(workspaceServiceSource, /CUBI_ENVIRONMENT_BLOCKED：發現 requirements\.txt/)
  assert.match(workspaceServiceSource, /本次執行需要的 import 已可載入，未進行下載安裝/)
  assert.match(workspaceServiceSource, /raise SystemExit\(69\)/)
})

test('pytest sandbox disables capture to avoid temporary capture file failures', () => {
  assert.match(sandboxServiceSource, /python3 -m pytest -q --capture=no/)
  assert.match(sandboxServiceSource, /xvfb-run -a python3 -m pytest -q --capture=no/)
})

test('pytest sandbox installs real Python dependencies before running tests', () => {
  assert.match(workspaceServiceSource, /--deps-only/)
  assert.match(sandboxServiceSource, /const dependencyRunner = '\.cubi-run-python\.py'/)
  assert.match(sandboxServiceSource, /python3 \$\{shellQuote\(dependencyRunner\)\} --deps-only/)
  assert.match(sandboxServiceSource, /python3 -m pip install --target \.cubi-python-packages/)
  assert.match(sandboxServiceSource, /const pythonPathExport = `export PYTHONPATH="\/workspace\/\.cubi-python-packages/)
  assert.match(sandboxServiceSource, /\$\{dependencySetup\} && \$\{pythonPathExport\} && xvfb-run -a python3 -m pytest/)
})

test('python dependency runner reuses unchanged requirements installs', () => {
  assert.match(workspaceServiceSource, /import hashlib/)
  assert.match(workspaceServiceSource, /def file_sha256/)
  assert.match(workspaceServiceSource, /\.requirements\.sha256/)
  assert.match(workspaceServiceSource, /requirements\.txt 未變更，沿用已安裝的 Python 套件/)
  assert.match(workspaceServiceSource, /"--upgrade"/)
  assert.match(workspaceServiceSource, /"--no-warn-script-location"/)
})

test('online python dependency installs are written into the staged workspace', () => {
  assert.match(workspaceServiceSource, /\.cubi-python-packages/)
  assert.match(workspaceServiceSource, /"--target"/)
  assert.doesNotMatch(workspaceServiceSource, /"--user"/)
})

test('sandbox image preinstalls common generated visualization dependencies', () => {
  assert.match(dockerfileSandboxSource, /\bmatplotlib\b/)
})
