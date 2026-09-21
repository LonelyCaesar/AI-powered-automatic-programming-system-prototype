import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  buildTestFailureFingerprint,
  extractWorkspaceFailurePaths,
  selectTestFailureRepairTarget,
} from './testFailurePaths.js'

const workspacePaths = [
  'main.py',
  'generated.py',
  'src/analyzer.py',
  'src/downloader.py',
  'requirements.txt',
]

test('failed test repair targets the deepest workspace traceback frame', () => {
  const result = {
    filePath: 'main.py',
    stderr: 'File "/workspace/main.py", line 3\nFile "/workspace/src/analyzer.py", line 25',
  }

  assert.equal(selectTestFailureRepairTarget(result, 'main.py', workspacePaths), 'src/analyzer.py')
  assert.deepEqual(extractWorkspaceFailurePaths(result, workspacePaths), ['main.py', 'src/analyzer.py'])
})

test('failed test repair does not choose requirements over a traceback source file', () => {
  const result = {
    filePath: 'generated.py',
    stderr: [
      'ERROR: Could not install -r /workspace/requirements.txt',
      'Traceback (most recent call last):',
      '  File "/workspace/generated.py", line 103, in <module>',
      '_tkinter.TclError: no display name and no $DISPLAY environment variable',
    ].join('\n'),
  }

  assert.equal(selectTestFailureRepairTarget(result, 'generated.py', workspacePaths), 'generated.py')
  assert.deepEqual(extractWorkspaceFailurePaths(result, workspacePaths), ['requirements.txt', 'generated.py'])
})

test('failed test repair prefers active source file over dependency manifests', () => {
  const result = {
    filePath: 'requirements.txt',
    stderr: 'ERROR: Could not install -r /workspace/requirements.txt',
  }

  assert.equal(selectTestFailureRepairTarget(result, 'main.py', workspacePaths), 'main.py')
})

test('failed multi-file validation repairs the failed child file with spaces in its name', () => {
  const paths = ['generated.html', 'style (2).css', 'script (2).js']
  const result = {
    filePath: 'generated.html',
    targetFile: 'generated.html',
    testResults: [
      { path: 'generated.html', test: { exitCode: 0, stdout: 'PASS generated.html' } },
      { path: 'style (2).css', test: { exitCode: 0, stdout: 'PASS style (2).css' } },
      {
        path: 'script (2).js',
        test: {
          exitCode: 1,
          stderr: '===== script (2).js =====\n/workspace/script (2).js:3\nSyntaxError: missing ) after argument list',
        },
      },
    ],
    stderr: '===== script (2).js =====\n/workspace/script (2).js:3\nSyntaxError: missing ) after argument list',
  }

  assert.equal(selectTestFailureRepairTarget(result, 'generated.html', paths), 'script (2).js')
  assert.deepEqual(extractWorkspaceFailurePaths(result, paths), ['script (2).js'])
})

test('failure fingerprint ignores volatile traceback line numbers', () => {
  const first = buildTestFailureFingerprint({
    command: 'python3 src/analyzer.py',
    stderr: 'File "/workspace/src/analyzer.py", line 25\nModuleNotFoundError: No module named pandas_ta',
  })
  const repeated = buildTestFailureFingerprint({
    command: 'python3 src/analyzer.py',
    stderr: 'File "/workspace/src/analyzer.py", line 31\nModuleNotFoundError: No module named pandas_ta',
  })

  assert.equal(first, repeated)
})

test('test failure button uses focused repair instead of project-wide repair', () => {
  const appPath = fileURLToPath(new URL('../App.vue', import.meta.url))
  const source = fs.readFileSync(appPath, 'utf8')
  const start = source.indexOf('async function fixCurrentTestFailure()')
  const end = source.indexOf('\nasync function runAgentFixAndTest', start)
  const functionSource = source.slice(start, end)

  assert.ok(start >= 0 && end > start)
  assert.doesNotMatch(functionSource, /runProjectErrorFix\s*\(/)
  assert.match(functionSource, /targetFiles:\s*\[targetFile\]/)
  assert.match(functionSource, /projectWideFix:\s*false/)
  assert.match(functionSource, /testFailureFix:\s*true/)
  assert.match(source, /content:\s*payload\.testFailureFix\s*\?\s*attemptedPrimaryContent/)
})
