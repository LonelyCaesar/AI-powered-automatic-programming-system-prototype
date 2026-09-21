const assert = require('node:assert/strict')
const test = require('node:test')

const {
  shouldStripSandboxAppBasePath,
  stripProxyBasePath,
} = require('../src/services/sandboxAppService')

test('Flask and FastAPI previews strip the public sandbox proxy prefix', () => {
  assert.equal(shouldStripSandboxAppBasePath('static_website'), true)
  assert.equal(shouldStripSandboxAppBasePath('node_server'), true)
  assert.equal(shouldStripSandboxAppBasePath('flask'), true)
  assert.equal(shouldStripSandboxAppBasePath('fastapi'), true)
  assert.equal(shouldStripSandboxAppBasePath('streamlit'), false)
})

test('sandbox proxy path stripping maps app base URLs to container root', () => {
  assert.equal(stripProxyBasePath('/sandbox/apps/app-id', '/sandbox/apps/app-id'), '/')
  assert.equal(stripProxyBasePath('/sandbox/apps/app-id/', '/sandbox/apps/app-id'), '/')
  assert.equal(stripProxyBasePath('/sandbox/apps/app-id/api/health', '/sandbox/apps/app-id'), '/api/health')
})
