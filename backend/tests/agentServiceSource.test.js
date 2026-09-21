const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'agentService.js'), 'utf8')

test('multi-file apply-and-test reuses one static website validation per folder', () => {
  assert.match(source, /STATIC_WEB_ASSET_EXTENSIONS/)
  assert.match(source, /staticWebsiteValidationTarget/)
  assert.match(source, /const cachedValidations = new Map\(\)/)
  assert.match(source, /cachedValidations\.get\(cacheKey\)/)
  assert.match(source, /cachedValidations\.set\(cacheKey, test\)/)
})

test('apply-and-test keeps a candidate when runtime is blocked by offline dependencies but syntax passes', () => {
  assert.match(source, /function isEnvironmentBlockedTest\(test = \{\}\)/)
  assert.match(source, /CUBI_ENVIRONMENT_BLOCKED/)
  assert.match(source, /\(\?:SyntaxError\|IndentationError\|TabError\|NameError\):/)
  assert.match(source, /limitedValidation = await runTests\(target, newContent, null, testContextFiles/)
  assert.match(source, /validation_limited: true/)
  assert.match(source, /const restoredFiles = effectivePassed \? \[\] : rollback\(\)/)
})

test('single-file apply-and-test validates the proposed content, not a stale workspace copy', () => {
  assert.match(source, /if \(test\.kind === 'javascript_jsx_syntax'\)/)
  assert.match(source, /React \/ JSX 語法檢查通過/)
  assert.match(source, /test: await runTests\(target, newContent, null, testContextFiles/)
  assert.doesNotMatch(source, /: \{ test: await runTests\(target\), records: \[\] \}/)
})
