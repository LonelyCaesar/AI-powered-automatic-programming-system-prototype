const assert = require('node:assert/strict')
const test = require('node:test')

const { sanitizeDisplayStderr } = require('../src/services/agentService')

test('successful yfinance network noise is suppressed from display stderr', () => {
  const result = sanitizeDisplayStderr({
    ok: true,
    stdout: 'CUBI_ENVIRONMENT_BLOCKED：完整 runtime 驗證需要外部依賴或網路。',
    stderr: "Failed to get ticker '2330.TW' reason: Failed to perform, curl: (6) Could not resolve host: guce.yahoo.com",
    exitCode: 0,
    returncode: 0,
  })

  assert.equal(result.stderr, '')
  assert.match(result.suppressed_stderr, /2330\.TW/)
  assert.equal(result.suppressed_stderr_reason, 'external_network_noise')
})

test('source-code stderr is not suppressed', () => {
  const result = sanitizeDisplayStderr({
    ok: false,
    stdout: 'CUBI_ENVIRONMENT_BLOCKED：完整 runtime 驗證需要外部依賴或網路。',
    stderr: '/workspace/app.py:4: SyntaxError: invalid syntax',
    exitCode: 1,
    returncode: 1,
  })

  assert.match(result.stderr, /SyntaxError/)
  assert.equal(result.suppressed_stderr, undefined)
})
