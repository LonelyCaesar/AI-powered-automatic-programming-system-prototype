const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/agent.js'), 'utf8')

test('agent loop SSE stream sends heartbeat events while long operations are running', () => {
  assert.match(routeSource, /AGENT_LOOP_STREAM_HEARTBEAT_MS = 30000/)
  assert.match(routeSource, /type: 'heartbeat'/)
  assert.match(routeSource, /setInterval\(\(\) => \{[\s\S]*writeLoopEvent\(\{[\s\S]*type: 'heartbeat'/)
  assert.match(routeSource, /clearInterval\(heartbeatTimer\)/)
})
