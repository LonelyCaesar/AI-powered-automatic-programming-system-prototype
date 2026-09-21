const assert = require('node:assert/strict')
const test = require('node:test')

const { fallbackDiagnosticMarker, isDiagnosticsInfrastructureFailure, parseJavaScriptMarkers, parsePythonNameMarkers } = require('../src/routes/diagnostics')

test('diagnostics infrastructure failures do not create code markers', () => {
  const marker = fallbackDiagnosticMarker('bad.py', {
    ok: false,
    stderr: 'Docker Sandbox 未就緒：permission denied\nmore detail',
    sandbox: { status: 'error' },
  })

  assert.equal(marker, null)
})

test('diagnostics recognizes Docker failures as infrastructure, not code errors', () => {
  assert.equal(isDiagnosticsInfrastructureFailure({
    stderr: 'permission denied while trying to connect to the docker API at npipe:////./pipe/docker_engine',
    sandbox: { status: 'error' },
  }), true)
})

test('diagnostics still returns a visible warning marker for unparsed code-tool output', () => {
  const marker = fallbackDiagnosticMarker('bad.py', {
    ok: false,
    stderr: 'SyntaxError: invalid syntax\nmore detail',
  })

  assert.equal(marker.file_path, 'bad.py')
  assert.equal(marker.severity, 'warning')
  assert.equal(marker.startLineNumber, 1)
  assert.equal(marker.startColumn, 1)
  assert.match(marker.message, /SyntaxError/)
})

test('python name diagnostics can return markers on multiple lines', () => {
  const markers = parsePythonNameMarkers(JSON.stringify({
    markers: [
      { line: 10, column: 5, message: "NameError: name 'prnt' is not defined" },
      { line: 13, column: 9, message: "NameError: name 'prinA' is not defined" },
    ],
  }), 'setup_project.py')

  assert.equal(markers.length, 2)
  assert.equal(markers[0].file_path, 'setup_project.py')
  assert.equal(markers[0].startLineNumber, 10)
  assert.equal(markers[1].startLineNumber, 13)
  assert.match(markers[1].message, /prinA/)
})

test('javascript diagnostics accepts React JSX in generated js files', () => {
  const code = `
import React from 'react'
import { CheckCircle2 } from 'lucide-react'

const DigitalThermometer = () => {
  const getStatusIcon = () => <CheckCircle2 className="w-6 h-6 text-green-500" />
  return <div className="screen">{getStatusIcon()}</div>
}

export default DigitalThermometer
`

  assert.deepEqual(parseJavaScriptMarkers(code, 'generated.js'), [])
})

test('javascript diagnostics still reports real js syntax errors', () => {
  const markers = parseJavaScriptMarkers('const value = ;', 'generated.js')
  assert.equal(markers.length, 1)
  assert.equal(markers[0].file_path, 'generated.js')
  assert.equal(markers[0].severity, 'error')
  assert.match(markers[0].message, /SyntaxError/)
})
