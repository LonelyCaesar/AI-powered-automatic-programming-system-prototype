const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')

test('read-only detection uses the AI feature sandbox timeout, not the global test timeout', () => {
  const source = fs.readFileSync(path.join(root, 'src/services/readOnlyProjectService.js'), 'utf8')
  assert.match(source, /config\.dockerSandbox\.aiFeatureTimeout/)
  assert.match(source, /timeoutMs:/)
})

test('agent loop sandbox commands use the AI feature sandbox timeout', () => {
  const source = fs.readFileSync(path.join(root, 'src/services/agentLoopService.js'), 'utf8')
  assert.match(source, /config\.dockerSandbox\.aiFeatureTimeout/)
  assert.match(source, /timeoutMs:\s*timeoutSeconds \* 1000/)
})
