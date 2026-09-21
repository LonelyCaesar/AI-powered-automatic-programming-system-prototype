const assert = require('node:assert/strict')
const test = require('node:test')

const { effectiveSandboxTimeoutMs } = require('../src/services/sandboxService')

test('sandbox timeout 0 disables command timeout', () => {
  assert.equal(effectiveSandboxTimeoutMs({ timeoutMs: 0 }), 0)
})

test('sandbox timeout keeps positive explicit values', () => {
  assert.equal(effectiveSandboxTimeoutMs({ timeoutMs: 2500 }), 2500)
})

test('sandbox timeout falls back for invalid values', () => {
  assert.equal(effectiveSandboxTimeoutMs({ timeoutMs: Number.NaN }), 60000)
})
