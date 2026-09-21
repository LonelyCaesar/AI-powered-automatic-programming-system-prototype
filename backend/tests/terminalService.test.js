const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const config = require('../src/config')
const originalProjectsDir = config.projectsDir
const originalWorkspaceDir = config.workspaceDir
const temporaryProjectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubi-terminal-tests-'))
config.projectsDir = temporaryProjectsDir
config.workspaceDir = path.join(temporaryProjectsDir, 'my_project')
test.after(() => {
  config.projectsDir = originalProjectsDir
  config.workspaceDir = originalWorkspaceDir
  fs.rmSync(temporaryProjectsDir, { recursive: true, force: true })
})
const {
  getTerminalStatus,
  resolveSandboxTerminal,
  sandboxDockerArgs,
  selectTerminalMode,
  randomSandboxAppPort,
  resolveTerminalWorkspace,
  shouldForceKillTerminalSession,
  extractOpenableTerminalUrls,
} = require('../src/services/terminalService')

test('all legacy terminal mode requests are forced into Docker Sandbox', () => {
  assert.equal(selectTerminalMode('sandbox'), 'sandbox')
  assert.equal(selectTerminalMode('cmd'), 'sandbox')
  assert.equal(selectTerminalMode('host_cmd'), 'sandbox')
  assert.equal(selectTerminalMode('powershell'), 'sandbox')
  assert.equal(selectTerminalMode('host_powershell'), 'sandbox')
})

test('workspace switches stop sandbox terminals without node-pty force kill', () => {
  assert.equal(shouldForceKillTerminalSession('workspace_changed'), false)
  assert.equal(shouldForceKillTerminalSession('workspace_deleted'), false)
  assert.equal(shouldForceKillTerminalSession('user_stopped'), true)
  assert.equal(shouldForceKillTerminalSession('socket_disconnected'), true)
})

test('terminal status exposes only the Docker Sandbox entry', () => {
  const status = getTerminalStatus()
  assert.equal(status.default_mode, 'sandbox')
  assert.deepEqual(Object.keys(status.modes || {}), ['sandbox'])
  assert.equal(status.modes.sandbox.profile, 'docker')
  assert.equal(status.modes.sandbox.label, 'Docker Sandbox')
  assert.equal(status.modes.sandbox.scope, 'container')
  assert.equal(status.modes.sandbox.workspace, '/workspace')
  assert.equal(status.modes.sandbox.host_workspace, config.workspaceDir)
  assert.equal(status.modes.sandbox.shell, '/bin/bash')
})

test('interactive terminal launches docker run instead of cmd or powershell', () => {
  const runtime = resolveSandboxTerminal()
  const args = sandboxDockerArgs(runtime, true)
  assert.match(runtime.file, /^docker(?:\.exe)?$/i)
  assert.equal(runtime.profile, 'docker')
  assert.ok(args.includes('run'))
  assert.ok(args.includes('-t'))
  assert.ok(args.includes('--read-only'))
  assert.ok(args.includes('--cap-drop'))
  assert.ok(args.includes('ALL'))
  assert.ok(args.includes('no-new-privileges:true'))
  assert.ok(args.includes('/workspace'))
  assert.ok(args.includes(config.dockerSandbox.image))
  assert.ok(args.includes('/bin/bash'))
  assert.ok(args.includes('-lc'))
  assert.ok(args.includes('SHELL=/bin/bash'))
  assert.ok(args.some(value => String(value).includes('exec /bin/bash --rcfile /tmp/cubi-terminal-rc -i')))
  assert.ok(args.some(value => String(value).includes('python3 -m flask --app "$module" run')))
  assert.ok(args.some(value => String(value).includes('--browser.gatherUsageStats=false')))
  assert.ok(args.some(value => String(value).includes('start() { _cubi_open_html "$@"; }')))
  assert.ok(args.some(value => String(value).includes('open() { _cubi_open_html "$@"; }')))
  assert.ok(args.some(value => String(value).includes('python3 -m http.server "$port" --bind 0.0.0.0 --directory "$dir"')))
  assert.ok(!args.some(value => /cmd\.exe|powershell(?:\.exe)?/i.test(value)))
})

test('sandbox terminal mounts only the project workspace and never the Docker socket', () => {
  const runtime = resolveSandboxTerminal()
  const args = sandboxDockerArgs(runtime, true)
  const joined = args.join(' ')
  assert.match(joined, /:\/workspace:rw|:\\workspace:rw/)
  assert.doesNotMatch(joined, /docker\.sock/i)
  assert.doesNotMatch(joined, /--privileged/i)
})
test('X11 terminal settings stay inside the Docker terminal runtime', () => {
  const runtime = resolveSandboxTerminal()
  const args = sandboxDockerArgs(runtime, true)
  if (config.terminal.x11Enabled) {
    assert.equal(runtime.network, config.terminal.network || 'bridge')
    assert.equal(runtime.display, config.terminal.x11Display)
    assert.ok(args.includes(`DISPLAY=${config.terminal.x11Display}`))
    assert.ok(args.includes('QT_X11_NO_MITSHM=1'))
    assert.ok(!args.includes('none'))
  }
  assert.ok(!args.some(value => /cmd\.exe|powershell(?:\.exe)?/i.test(value)))
})



test('terminal exposes exactly one random application port with the same host/container port', () => {
  const runtime = resolveSandboxTerminal({ appPort: 43127 })
  const args = sandboxDockerArgs(runtime, true)
  assert.equal(runtime.appPort, 43127)
  assert.ok(args.includes('127.0.0.1:43127:43127'))
  assert.ok(args.includes('PORT=43127'))
  assert.ok(args.includes('CUBI_APP_PORT=43127'))
  assert.ok(args.includes('FLASK_RUN_HOST=0.0.0.0'))
  assert.ok(args.includes('FLASK_RUN_PORT=43127'))
  assert.ok(args.includes('STREAMLIT_SERVER_ADDRESS=0.0.0.0'))
  assert.ok(args.includes('STREAMLIT_SERVER_PORT=43127'))
  assert.ok(args.includes('STREAMLIT_SERVER_HEADLESS=true'))
  assert.ok(args.includes('STREAMLIT_BROWSER_GATHER_USAGE_STATS=false'))
  assert.ok(!args.some(value => /127\.0\.0\.1::(?:3000|4173|5000|5173|8000|8080|8501|8787|8888)/.test(value)))
})

test('random Sandbox application port stays inside the configured range', () => {
  assert.equal(config.terminal.appPortMin, 1024)
  assert.equal(config.terminal.appPortMax, 9999)
  for (let index = 0; index < 20; index += 1) {
    const port = randomSandboxAppPort()
    assert.ok(port >= config.terminal.appPortMin)
    assert.ok(port <= config.terminal.appPortMax)
    assert.ok(port <= 9999)
  }
})


test('managed project folders live under the outer my_project directory', () => {
  const path = require('node:path')
  assert.equal(path.resolve(originalProjectsDir), path.resolve(config.projectRoot, 'my_project'))
  assert.ok(path.resolve(originalWorkspaceDir).startsWith(path.resolve(originalProjectsDir)))
})

test('terminal can explicitly bind the selected backend project', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const name = '__terminal_project_test__'
  const target = path.join(config.projectsDir, name)
  fs.mkdirSync(target, { recursive: true })
  try {
    assert.equal(resolveTerminalWorkspace(name), path.resolve(target))
    const runtime = resolveSandboxTerminal({ projectName: name })
    assert.equal(runtime.hostWorkspace, path.resolve(target))
    assert.equal(runtime.projectName, name)
    assert.ok(runtime.args.includes(`${path.resolve(target)}:/workspace:rw`))
  } finally {
    fs.rmSync(target, { recursive: true, force: true })
  }
})

test('terminal rejects project paths that try to escape the managed project root', () => {
  assert.throws(() => resolveTerminalWorkspace('../backend'), /Invalid project name/)
  assert.throws(() => resolveTerminalWorkspace('foo/bar'), /Invalid project name/)
})

test('terminal opens only host URLs for the current Sandbox application port', () => {
  const output = [
    ' * Running on http://127.0.0.1:4334',
    ' * Running on http://172.17.0.11:4334',
    'open http://localhost:4334/generated.html',
    'open http://127.0.0.1:4334/generated.html\u001b[K',
    'ignore http://127.0.0.1:9999/',
  ].join('\n')
  assert.deepEqual(extractOpenableTerminalUrls(output, { appPort: 4334 }), [
    'http://127.0.0.1:4334',
    'http://localhost:4334/generated.html',
    'http://127.0.0.1:4334/generated.html',
  ])
})
