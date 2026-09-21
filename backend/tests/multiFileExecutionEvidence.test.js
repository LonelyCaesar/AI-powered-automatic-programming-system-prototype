const test = require('node:test')
const assert = require('node:assert/strict')

const { combineMultiFileTestResults, multiFileEvidenceSteps, staticWebsiteValidationTarget } = require('../src/services/agentService')

function passingGuiRecord(path) {
  return {
    path,
    test: {
      kind: 'python_gui',
      command: `docker run python3 ${path}`,
      returncode: 0,
      exitCode: 0,
      passed: 1,
      failed: 0,
      total: 1,
      stdout: `${path} GUI started`,
      stderr: '',
      sandbox: { engine: 'docker', isolated: true },
    },
  }
}

test('multi-file execution evidence contains every modified Monaco file', () => {
  const records = [
    'generated_2.py',
    'generated_3.py',
    'generated.py',
    'teee.py',
  ].map(passingGuiRecord)

  const result = combineMultiFileTestResults(records)
  const steps = multiFileEvidenceSteps(records, { applied: true })

  assert.equal(result.kind, 'multi_file')
  assert.equal(result.passed, 4)
  assert.equal(result.total, 4)
  assert.deepEqual(result.target_files, records.map(record => record.path))
  for (const record of records) {
    assert.match(result.command, new RegExp(record.path.replace('.', '\\.')))
    assert.equal(steps.some(step => step.label.includes(record.path) && step.detail.includes(record.test.command)), true)
  }
})

test('one failed file makes the entire multi-file validation fail', () => {
  const records = [passingGuiRecord('generated_2.py'), passingGuiRecord('teee.py')]
  records[1].test.returncode = 1
  records[1].test.exitCode = 1

  const result = combineMultiFileTestResults(records)

  assert.equal(result.returncode, 1)
  assert.equal(result.passed, 1)
  assert.equal(result.failed, 1)
})

test('multi-file static website validation uses same-folder generated html for renamed assets', () => {
  const fileItems = [
    {
      path: 'generated.html',
      content: '<!doctype html><link rel="stylesheet" href="style (2).css"><script src="script (2).js"></script>',
    },
    { path: 'style (2).css', content: 'body { color: #111; }' },
    { path: 'script (2).js', content: 'document.addEventListener("DOMContentLoaded", () => {});' },
  ]

  const htmlTarget = staticWebsiteValidationTarget(fileItems[0], fileItems, [])
  const cssTarget = staticWebsiteValidationTarget(fileItems[1], fileItems, [])
  const jsTarget = staticWebsiteValidationTarget(fileItems[2], fileItems, [])

  assert.equal(htmlTarget.path, 'generated.html')
  assert.equal(cssTarget.path, 'generated.html')
  assert.equal(jsTarget.path, 'generated.html')
  assert.equal(cssTarget.key, 'static:generated.html')
  assert.equal(jsTarget.key, 'static:generated.html')
})
