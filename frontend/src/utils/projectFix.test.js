import test from 'node:test'
import assert from 'node:assert/strict'

import { buildProjectFixInstruction, selectProjectFixTarget, testFailureRepairBlockReason, visibleResultStderr } from './projectFix.js'

test('selectProjectFixTarget prefers a located production source over a pytest wrapper', () => {
  const target = selectProjectFixTarget({
    error_files: [
      { path: 'test_integration.py', line: 4 },
      { path: 'generated_app/src/visualizer.py', line: 59 },
    ],
  }, 'app.py')

  assert.equal(target, 'generated_app/src/visualizer.py')
})

test('project fix instruction carries terminal evidence and forbids weakening tests', () => {
  const instruction = buildProjectFixInstruction('修正整個專案', {
    commands: ['python3 -m pytest -q'],
    error_files: [{ path: 'src/app.py', line: 8, reason: 'SyntaxError' }],
    related_files: [{ path: 'tests/test_app.py', reason: '測試檔案' }],
    test: { stderr: 'SyntaxError: invalid syntax' },
  })

  assert.match(instruction, /src\/app\.py:8/)
  assert.match(instruction, /SyntaxError: invalid syntax/)
  assert.match(instruction, /不可刪除、略過或弱化測試/)
})

test('sandbox network dependency failures are not routed to source-code repair', () => {
  const reason = testFailureRepairBlockReason({
    stderr: 'NewConnectionError: Failed to establish a new connection\nERROR: No matching distribution found for pyaudio',
    sandbox: { engine: 'docker', isolated: true, network: 'none' },
  })

  assert.match(reason, /修改程式碼無法修復/)
})

test('isolated yfinance DNS failures are not routed to source-code repair', () => {
  const reason = testFailureRepairBlockReason({
    stderr: "Failed to get ticker '2330.TW' reason: Failed to perform, curl: (6) Could not resolve host: guce.yahoo.com",
    sandbox: { engine: 'docker', isolated: true, network: 'bridge' },
  })

  assert.match(reason, /Yahoo Finance/)
  assert.match(reason, /假資料/)
})

test('successful environment-limited yfinance noise is hidden from stderr display', () => {
  const stderr = visibleResultStderr({
    ok: true,
    stdout: 'CUBI_ENVIRONMENT_BLOCKED：完整 runtime 驗證需要外部依賴或網路。',
    stderr: "Failed to get ticker '2330.TW' reason: Failed to perform, curl: (6) Could not resolve host: guce.yahoo.com",
    sandbox: { engine: 'docker', isolated: true, network: 'none' },
  })

  assert.equal(stderr, '')
})

test('source-code errors remain visible in stderr display', () => {
  const stderr = visibleResultStderr({
    ok: false,
    stdout: 'CUBI_ENVIRONMENT_BLOCKED：完整 runtime 驗證需要外部依賴或網路。',
    stderr: '/workspace/app.py:4: SyntaxError: invalid syntax',
    sandbox: { engine: 'docker', isolated: true, network: 'none' },
  })

  assert.match(stderr, /SyntaxError/)
})

test('benign pip target-directory warnings are hidden from stderr display', () => {
  const stderr = visibleResultStderr({
    ok: true,
    stderr: [
      'WARNING: Target directory /workspace/.cubi-python-packages/humanize already exists. Specify --upgrade to force replacement.',
      'WARNING: Target directory /workspace/.cubi-python-packages/python_slugify-8.0.4.dist-info already exists. Specify --upgrade to force replacement.',
    ].join('\n'),
    sandbox: { engine: 'docker', isolated: true, network: 'bridge' },
  })

  assert.equal(stderr, '')
})

test('pip target-directory warning filter keeps real stderr lines visible', () => {
  const stderr = visibleResultStderr({
    ok: false,
    stderr: [
      'WARNING: Target directory /workspace/.cubi-python-packages/humanize already exists. Specify --upgrade to force replacement.',
      'ValueError: invalid value',
    ].join('\n'),
    sandbox: { engine: 'docker', isolated: true, network: 'bridge' },
  })

  assert.equal(stderr, 'ValueError: invalid value')
})

test('successful pip dependency resolver noise is hidden from stderr display', () => {
  const stderr = visibleResultStderr({
    ok: true,
    stderr: [
      "ERROR: pip's dependency resolver does not currently take into account all the packages that are installed. This behaviour is the source of the following dependency conflicts.",
      'streamlit 1.60.0 requires websockets<17,>=12.0.0, but you have websockets 17.0.1 which is incompatible.',
    ].join('\n'),
    sandbox: { engine: 'docker', isolated: true, network: 'bridge' },
  })

  assert.equal(stderr, '')
})

test('pip warning filter keeps real failure lines visible', () => {
  const stderr = visibleResultStderr({
    ok: false,
    stderr: [
      "ERROR: pip's dependency resolver does not currently take into account all the packages that are installed. This behaviour is the source of the following dependency conflicts.",
      'streamlit 1.60.0 requires websockets<17,>=12.0.0, but you have websockets 17.0.1 which is incompatible.',
      'ModuleNotFoundError: No module named slugify',
    ].join('\n'),
    sandbox: { engine: 'docker', isolated: true, network: 'bridge' },
  })

  assert.match(stderr, /ModuleNotFoundError/)
})

test('source syntax errors are routed to code repair even when dependency logs mention environment limits', () => {
  const reason = testFailureRepairBlockReason({
    stdout: 'CUBI_ENVIRONMENT_BLOCKED：發現 requirements.txt，但 Docker 沙盒網路已停用，無法安裝。',
    stderr: '/workspace/src/visualizer.py:25: SyntaxError: \"is not\" with a literal. Did you mean \"!=\"?',
    sandbox: { engine: 'docker', isolated: true, network: 'none' },
  })

  assert.equal(reason, '')
})

test('missing CLI arguments are not routed to source-code repair', () => {
  const reason = testFailureRepairBlockReason({
    stderr: 'usage: main.py [-h] symbol\nmain.py: error: the following arguments are required: symbol',
    sandbox: { engine: 'docker', isolated: true, network: 'bridge' },
  })

  assert.match(reason, /命令列參數/)
})

test('pytest no-tests results are not routed to source-code repair', () => {
  const reason = testFailureRepairBlockReason({
    testKind: 'pytest',
    exitCode: 5,
    stdout: 'no tests ran in 0.58s',
    passed: 0,
    failed: 0,
    sandbox: { engine: 'docker', isolated: true },
  })

  assert.match(reason, /沒有收集到任何測試案例/)
})

test('pytest capture tempfile failures are not routed to source-code repair', () => {
  const reason = testFailureRepairBlockReason({
    testKind: 'pytest',
    exitCode: 1,
    stderr: [
      'File "/usr/local/lib/python3.10/site-packages/_pytest/capture.py", line 778, in stop_global_capturing',
      'self._global_capturing.pop_outerr_to_orig()',
      'File "/usr/local/lib/python3.10/site-packages/_pytest/capture.py", line 594, in snap',
      'self.tmpfile.truncate()',
      'FileNotFoundError: [Errno 2] No such file or directory',
    ].join('\n'),
    passed: 0,
    failed: 0,
    sandbox: { engine: 'docker', isolated: true },
  })

  assert.match(reason, /pytest 輸出擷取暫存檔/)
  assert.match(reason, /不應把它送進 AI 改碼/)
})

test('microphone failures in an isolated sandbox require host verification', () => {
  const reason = testFailureRepairBlockReason({
    stderr: 'OSError: No Default Input Device Available',
    sandbox: { engine: 'docker', isolated: true, network: 'none' },
  })

  assert.match(reason, /主機環境/)
})

test('tkinter display failures in an isolated sandbox are not routed to source-code repair', () => {
  const reason = testFailureRepairBlockReason({
    stderr: 'Error: No display detected. Tkinter requires a GUI environment.',
    sandbox: { engine: 'docker', isolated: true, network: 'none' },
  })

  assert.match(reason, /Tkinter/)
  assert.match(reason, /GUI 預覽模式/)
})
