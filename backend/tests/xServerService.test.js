const test = require('node:test')
const assert = require('node:assert/strict')
const net = require('net')

const {
  candidateExecutables,
  isXServerPortOpen,
} = require('../src/services/xServerService')

test('x server candidates include common Windows X server executables', () => {
  const candidates = candidateExecutables().map(item => item.replace(/\\/g, '/').toLowerCase())
  assert.ok(candidates.some(item => item.endsWith('/vcxsrv/vcxsrv.exe')))
  assert.ok(candidates.some(item => item.endsWith('/xming/xming.exe')))
})

test('x server port probe detects a reachable local listener', async () => {
  const server = net.createServer()
  await new Promise(resolve => server.listen({ host: '127.0.0.1', port: 0 }, resolve))
  const port = server.address().port
  try {
    assert.equal(await isXServerPortOpen('127.0.0.1', port, 1000), true)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
