const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

test('missing configured workspace is recreated only by explicit ensure', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cubi-missing-workspace-'))
  const missingWorkspace = path.join(tempRoot, 'my_project')

  try {
    const script = [
      "const fs = require('node:fs')",
      "const config = require('./src/config')",
      "const { listProjectTree, ensureProjectWorkspace } = require('./src/tools/fileTools')",
      'const existedBefore = fs.existsSync(config.workspaceDir)',
      'const tree = listProjectTree()',
      'const existsAfterRead = fs.existsSync(config.workspaceDir)',
      'ensureProjectWorkspace()',
      'const existsAfterEnsure = fs.existsSync(config.workspaceDir)',
      'console.log(JSON.stringify({ existedBefore, existsAfterRead, existsAfterEnsure, treeLength: tree.length, workspaceDir: config.workspaceDir }))',
    ].join(';')

    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        CUBI_WORKSPACE_DIR: missingWorkspace,
      },
      encoding: 'utf8',
    })

    assert.equal(result.status, 0, result.stderr)
    const payload = JSON.parse(result.stdout.trim())
    assert.equal(payload.workspaceDir, missingWorkspace)
    assert.equal(payload.existedBefore, false)
    assert.equal(payload.existsAfterRead, false)
    assert.equal(payload.existsAfterEnsure, true)
    assert.equal(payload.treeLength, 0)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})
