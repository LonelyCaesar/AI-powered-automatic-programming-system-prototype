const test = require('node:test')
const assert = require('node:assert/strict')

const { inferredTargetLanguage } = require('../src/services/codingServices')
const { detectSourceLanguage, convertedFilePath } = require('../src/services/relatedContextService')
const { projectFacts } = require('../src/services/readOnlyProjectService')

test('recognizes Node.js Express as JavaScript target language', () => {
  const instruction = '請將以下 Python FastAPI 路由程式碼轉換成 Node.js 的 Express 路由寫法。'
  assert.equal(inferredTargetLanguage('auto', instruction), 'JavaScript')
})

test('source content wins over a misleading file extension', () => {
  const code = "const query = `SELECT * FROM users WHERE name = '${name}'`;"
  assert.equal(detectSourceLanguage(code, 'generated.py'), 'JavaScript')
  assert.equal(detectSourceLanguage("import React from 'react';\nexport default function App() {}", 'generated.py'), 'JavaScript')
})

test('uses the target language extension for converted files', () => {
  assert.equal(convertedFilePath('api/routes.py', 'JavaScript'), 'api/routes.js')
})

test('marks interpolated SQL as a SQL injection risk', () => {
  const facts = projectFacts({
    files: [{ path: 'query.js', content: "const query = `SELECT * FROM users WHERE name = '${name}'`;" }],
  })
  assert.equal(facts.risks.some(item => /SQL Injection/.test(item.reason)), true)
  assert.equal(facts.risks.find(item => /SQL Injection/.test(item.reason)).line, 1)
})

test('marks a state-updating useEffect without dependencies as an infinite-loop risk', () => {
  const facts = projectFacts({
    files: [{ path: 'Profile.jsx', content: 'useEffect(() => {\n  fetch(url).then(setUser);\n});' }],
  })
  assert.equal(facts.risks.some(item => /dependency array/.test(item.reason)), true)
})

test('extracts host and container ports from docker compose evidence', () => {
  const facts = projectFacts({
    files: [{ path: 'docker-compose.yml', content: 'services:\n  backend:\n    ports:\n      - "8080:8000"' }],
  })
  assert.deepEqual(facts.ports[0], {
    path: 'docker-compose.yml',
    line: 4,
    host_port: 8080,
    container_port: 8000,
    source: 'port mapping',
  })
})
