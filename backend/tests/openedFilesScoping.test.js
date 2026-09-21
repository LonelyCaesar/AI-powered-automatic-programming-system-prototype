const test = require('node:test')
const assert = require('node:assert/strict')

const {
  createProjectSnapshot,
  selectReportTargetFiles,
  projectFacts,
  formatFactsForPrompt,
} = require('../src/services/readOnlyProjectService')

test('when single file is opened, snapshot and report targets contain ONLY that opened file', () => {
  const snapshot = createProjectSnapshot({
    filePath: 'generated.html',
    code: '<!DOCTYPE html><html><head><title>Pomodoro</title></head><body></body></html>',
    scope: 'current_file',
  })

  assert.equal(snapshot.scope, 'current_file')
  assert.equal(snapshot.files.length, 1)
  assert.equal(snapshot.files[0].path, 'generated.html')

  const forbiddenFiles = ['index.html', 'script.js', 'style.css', 'test.js', 'test.py', 'test1.py']
  for (const forbidden of forbiddenFiles) {
    assert.equal(
      snapshot.files.some(f => f.path.toLowerCase() === forbidden.toLowerCase()),
      false,
      `Unopened file ${forbidden} must NOT be in snapshot`
    )
  }

  const analysisTargets = selectReportTargetFiles(snapshot, '請分析')
  assert.deepEqual(analysisTargets.map(f => f.path), ['generated.html'])

  const explainTargets = selectReportTargetFiles(snapshot, '請說明')
  assert.deepEqual(explainTargets.map(f => f.path), ['generated.html'])

  const facts = projectFacts(snapshot)
  const factsText = formatFactsForPrompt(snapshot, facts, analysisTargets)
  for (const forbidden of forbiddenFiles) {
    assert.equal(
      factsText.includes(forbidden),
      false,
      `Unopened file ${forbidden} must NOT appear in factsText prompt`
    )
  }
})

test('when multiple files are opened, snapshot and report targets are strictly restricted to those explicit files', () => {
  const snapshot = createProjectSnapshot({
    filePath: 'generated.html, style.css',
    contextFiles: [
      { path: 'generated.html', content: '<html></html>' },
      { path: 'style.css', content: 'body { margin: 0; }' },
    ],
    scope: 'explicit_files',
  })

  assert.equal(snapshot.scope, 'explicit_files')
  assert.equal(snapshot.files.length, 2)
  const paths = snapshot.files.map(f => f.path).sort()
  assert.deepEqual(paths, ['generated.html', 'style.css'])

  const reportTargets = selectReportTargetFiles(snapshot, '請針對開啟的檔案進行分析')
  assert.deepEqual(reportTargets.map(f => f.path).sort(), ['generated.html', 'style.css'])
})

test('snapshot defaults to current_file when active file is provided even if scope argument is omitted', () => {
  const snapshot = createProjectSnapshot({
    filePath: 'generated.html',
    code: '<!DOCTYPE html><html><body>Test</body></html>',
  })

  assert.equal(snapshot.scope, 'current_file')
  assert.equal(snapshot.files.length, 1)
  assert.equal(snapshot.files[0].path, 'generated.html')
  assert.equal(snapshot.files.some(f => f.path === 'test.py'), false)
})
