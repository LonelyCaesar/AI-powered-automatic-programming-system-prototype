const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('node:child_process')

const config = require('../src/config')
const { ensureStartupWorkspace } = require('../src/services/workspaceBootstrapService')

test('default workspace resolves to project-root/my_project/my_project when env is configured relatively', () => {
  const result = spawnSync(process.execPath, ['-e',
    "const config = require('./src/config'); console.log(JSON.stringify({ workspaceDir: config.workspaceDir, projectRoot: config.projectRoot }))",
  ], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, CUBI_WORKSPACE_DIR: 'my_project' },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  const resolved = JSON.parse(result.stdout.trim())
  assert.equal(resolved.workspaceDir, path.join(resolved.projectRoot, 'my_project', 'my_project'))
})

test('ensureStartupWorkspace creates missing folder and reuses existing folder', () => {
  const originalWorkspace = config.workspaceDir
  const originalSandbox = config.sandboxDir
  const originalTerminalCwd = config.terminal.cwd
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cubi-workspace-'))
  const target = path.join(tmp, 'my_project')
  try {
    config.workspaceDir = target
    config.sandboxDir = target
    config.terminal.cwd = target

    const first = ensureStartupWorkspace()
    assert.equal(first.created, true)
    assert.equal(fs.existsSync(target), true)
    assert.equal(config.workspaceDir, target)
    assert.equal(config.sandboxDir, target)
    assert.equal(config.terminal.cwd, target)

    fs.writeFileSync(path.join(target, 'keep.txt'), 'keep', 'utf8')
    const second = ensureStartupWorkspace()
    assert.equal(second.created, false)
    assert.equal(second.existed, true)
    assert.equal(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'keep')
  } finally {
    config.workspaceDir = originalWorkspace
    config.sandboxDir = originalSandbox
    config.terminal.cwd = originalTerminalCwd
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
