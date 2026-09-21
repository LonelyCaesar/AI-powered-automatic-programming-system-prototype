const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { runTests } = require('../src/tools/testRunner')
const { resolveProjectWorkspace } = require('../src/services/sandboxWorkspaceService')

test('project-wide checks validate every html file, not only index.html', async () => {
  const projectId = `project-html-${Date.now()}`
  const workspace = resolveProjectWorkspace(projectId)
  try {
    const html = '<file_output>\ngenerated.html\n<!doctype html><html><body>bad</body></html>'
    const result = await runTests('generated.html', html, null, [
      { ok: true, file_path: 'index.html', content: '<!doctype html><html><body>ok</body></html>' },
      { ok: true, file_path: 'generated.html', content: html },
    ], {
      projectWide: true,
      workspaceSource: 'local-handle',
      projectId,
      projectName: 'html-project',
      preferProjectTests: true,
    })

    assert.equal(result.ok, false)
    assert.equal(result.kind, 'html_check')
    assert.match(result.command, /frontend static check/)
    assert.match(result.stdout, /generated\.html 不含模型輸出包裝標籤/)
  } finally {
    fs.rmSync(workspace.path, { recursive: true, force: true })
  }
})
