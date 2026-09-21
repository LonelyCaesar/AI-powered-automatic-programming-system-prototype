const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  detectNodeServerApp,
  isBrowserJavaScriptModule,
  runProjectChecks,
  runTests,
} = require('../src/tools/testRunner')

test('detects package.json plus server.js as a Node server app with message-board smoke test', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cubi-node-server-'))
  try {
    fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({
      scripts: { start: 'node server.js' },
      dependencies: { express: '^4.18.2' },
    }), 'utf8')
    fs.writeFileSync(path.join(workspace, 'server.js'), `
      const express = require('express')
      const app = express()
      app.get('/api/messages', (_req, res) => res.json([]))
      app.listen(process.env.PORT || 3000)
    `, 'utf8')
    fs.writeFileSync(path.join(workspace, 'public-script.js'), `
      fetch('/api/messages')
    `, 'utf8')

    const files = new Map([
      ['server.js', fs.readFileSync(path.join(workspace, 'server.js'), 'utf8')],
      ['public-script.js', fs.readFileSync(path.join(workspace, 'public-script.js'), 'utf8')],
    ])
    const app = detectNodeServerApp(workspace, ['package.json', 'server.js', 'public-script.js'], files)

    assert.equal(app.framework, 'node_server')
    assert.equal(app.entryFile, 'server.js')
    assert.equal(app.startCommand, 'npm start')
    assert.equal(app.smokeTest, 'message_board')
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('does not treat a plain JavaScript utility project as a server app', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cubi-node-utility-'))
  try {
    fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({
      scripts: { start: 'node index.js' },
    }), 'utf8')
    fs.writeFileSync(path.join(workspace, 'index.js'), `console.log('utility')`, 'utf8')

    const app = detectNodeServerApp(workspace, ['package.json', 'index.js'], new Map([
      ['index.js', `console.log('utility')`],
    ]))

    assert.equal(app, null)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('detects generated React JavaScript as a browser module', () => {
  assert.equal(isBrowserJavaScriptModule('generated.js', `
    import React from 'react';
    export default function Calculator() {
      return <div className="calculator">0</div>;
    }
  `), true)
})

test('runs JSX-aware syntax check instead of node execution for generated React JavaScript', async () => {
  const result = await runTests('generated.js', `
    import React from 'react';
    export default function Calculator() {
      return <div className="calculator">0</div>;
    }
  `, null, [], {
    projectId: 'jsx-generated-test',
    projectName: 'JSX Generated Test',
    workspaceSource: 'backend',
  })

  assert.equal(result.ok, true)
  assert.equal(result.kind, 'javascript_jsx_syntax')
  assert.equal(result.command, 'JSX-aware syntax check generated.js')
})

test('project checks do not run empty pytest just because tests directory exists', async () => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cubi-empty-tests-'))
  try {
    fs.mkdirSync(path.join(workspacePath, 'src'), { recursive: true })
    fs.mkdirSync(path.join(workspacePath, 'tests'), { recursive: true })
    fs.writeFileSync(path.join(workspacePath, 'src', 'app.py'), 'print("ok")\n', 'utf8')

    let pytestCalled = false
    const result = await runProjectChecks(
      { id: 'empty-tests', path: workspacePath },
      new Map(),
      {},
      {
        runPythonSyntaxCheckInSandbox: async () => ({
          ok: true,
          kind: 'python_syntax',
          command: 'python syntax check src/app.py',
          stdout: '',
          stderr: '',
          exitCode: 0,
          returncode: 0,
          elapsed_seconds: 0,
        }),
        runPytestInSandbox: async () => {
          pytestCalled = true
          throw new Error('pytest should not run without discovered tests')
        },
      },
    )

    assert.equal(pytestCalled, false)
    assert.equal(result.ok, true)
    assert.equal(result.kind, 'project_check')
  } finally {
    fs.rmSync(workspacePath, { recursive: true, force: true })
  }
})

test('project checks validate React JavaScript with JSX parser instead of node --check', async () => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cubi-jsx-project-'))
  try {
    fs.writeFileSync(path.join(workspacePath, 'generated.js'), `
      import React from 'react';
      export default function Calculator() {
        return <div className="calculator">0</div>;
      }
    `, 'utf8')

    let nodeSyntaxCalled = false
    const result = await runProjectChecks(
      { id: 'jsx-project', path: workspacePath },
      new Map([
        ['generated.js', fs.readFileSync(path.join(workspacePath, 'generated.js'), 'utf8')],
      ]),
      {},
      {
        runNodeSyntaxCheckInSandbox: async () => {
          nodeSyntaxCalled = true
          throw new Error('node --check should not run for React JSX components')
        },
      },
    )

    assert.equal(nodeSyntaxCalled, false)
    assert.equal(result.ok, true)
    assert.equal(result.checks[0].kind, 'javascript_jsx_syntax')
  } finally {
    fs.rmSync(workspacePath, { recursive: true, force: true })
  }
})
