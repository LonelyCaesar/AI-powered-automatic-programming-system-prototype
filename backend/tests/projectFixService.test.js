const assert = require('node:assert/strict')
const test = require('node:test')

const { detectGuiDisplayLimitation, detectNetworkLimitation, extractErrorLocations, relatedProjectFiles, resolveHtmlImports } = require('../src/services/projectFixService')

test('isolated yfinance DNS failures are treated as environment limitations', () => {
  const limitation = detectNetworkLimitation({
    stderr: "Failed to get ticker '2330.TW' reason: Failed to perform, curl: (6) Could not resolve host: guce.yahoo.com",
    sandbox: { engine: 'docker', isolated: true, network: 'bridge' },
  })

  assert.equal(limitation.code, 'sandbox_external_network_failure')
  assert.match(limitation.message, /不是來源程式碼修復題/)
})

test('isolated tkinter display failures are treated as environment limitations', () => {
  const limitation = detectGuiDisplayLimitation({
    stderr: 'Error: No display detected. Tkinter requires a GUI environment.',
    sandbox: { engine: 'docker', isolated: true, network: 'none' },
  })

  assert.equal(limitation.code, 'sandbox_gui_display_unavailable')
  assert.match(limitation.message, /不是來源程式碼修復題/)
})

test('resolveHtmlImports extracts missing JS references and relatedProjectFiles includes them in editable scope', () => {
  const htmlContent = `<!DOCTYPE html><html><body><script src="generated.js"></script></body></html>`
  const imports = resolveHtmlImports('index1.html', htmlContent, ['index1.html'])
  assert.deepEqual(imports, ['generated.js'])

  const testOutput = {
    project_files: ['index1.html'],
    stderr: 'FAIL index1.html 引用的 generated.js 存在\n風險（第 79 行）：HTML 引用的腳本檔不存在或未載入：generated.js',
    command: 'frontend static check',
  }
  const result = relatedProjectFiles(testOutput, [{ path: 'index1.html', content: htmlContent }], 'index1.html')
  const paths = result.related.map(r => r.path)
  assert.ok(paths.includes('generated.js'), `expected related files to include generated.js, got ${JSON.stringify(paths)}`)
})

test('extractErrorLocations supports generated file names with spaces and parentheses', () => {
  const locations = extractErrorLocations({
    stderr: '/workspace/script (2).js:3\nSyntaxError: missing ) after argument list',
  }, ['generated.html', 'style (2).css', 'script (2).js'])

  assert.equal(locations.length, 1)
  assert.equal(locations[0].path, 'script (2).js')
  assert.equal(locations[0].line, 3)
})
