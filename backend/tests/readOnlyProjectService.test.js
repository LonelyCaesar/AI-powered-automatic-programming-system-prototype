const test = require('node:test')
const assert = require('node:assert/strict')

const { projectFacts } = require('../src/services/readOnlyProjectService')

test('read-only detection does not report missing tests directory as a code risk', () => {
  const facts = projectFacts({
    files: [
      { path: 'generated.html', content: '<!doctype html><html><body>OK</body></html>' },
    ],
  })

  assert.equal(facts.risks.some(risk => risk.path === 'tests/'), false)
})
