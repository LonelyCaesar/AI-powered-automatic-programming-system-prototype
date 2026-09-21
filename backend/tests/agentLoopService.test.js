const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const config = require('../src/config')
const { runAgentLoop } = require('../src/services/agentLoopService')

function toolResponse(tool, args) {
  return {
    ok: true,
    content: `<thought>test</thought><tool_call>${JSON.stringify({ tool, args })}</tool_call>`,
  }
}

async function withWorkspace(callback) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cubi-agent-loop-'))
  try {
    return await callback(workspace)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
}

test('tool execution failures count as consecutive errors and abort safely', async () => {
  await withWorkspace(async workspace => {
    const result = await runAgentLoop('執行失敗指令', {
      workspaceId: 'test-workspace',
      sandboxWorkspacePath: workspace,
      isLocalHandle: true,
      askLlm: async () => toolResponse('run_command', { command: 'false' }),
      executeCommand: async () => '工具執行錯誤：command failed',
      maxIterations: 10,
    })

    assert.equal(result.ok, false)
    assert.match(result.error, /連續錯誤過多/)
    assert.match(result.error, /command failed/)
  })
})

test('malformed tool JSON gets repair attempts without tripping command failure abort', async () => {
  await withWorkspace(async workspace => {
    const malformed = {
      ok: true,
      content: '<thought>test</thought><tool_call>{"tool":"write_file","args":</tool_call>',
    }
    const replies = [
      malformed,
      malformed,
      malformed,
      malformed,
      malformed,
      malformed,
      toolResponse('write_file', { path: 'app.py', content: 'print("ready")\n' }),
      toolResponse('finish', { message: 'done' }),
    ]
    const events = []

    const result = await runAgentLoop('依照已接受方案實作', {
      workspaceId: 'test-workspace',
      sandboxWorkspacePath: workspace,
      isLocalHandle: true,
      requireFileChanges: true,
      expectedFiles: ['app.py'],
      askLlm: async () => replies.shift(),
      onEvent: event => events.push(event),
      maxIterations: 10,
    })

    assert.equal(result.ok, true)
    assert.deepEqual(result.changedFiles, ['app.py'])
    assert.equal(fs.readFileSync(path.join(workspace, 'app.py'), 'utf8'), 'print("ready")\n')
    assert.equal(events.filter(event => /工具 JSON 解析失敗/.test(event.message || '')).length, 6)
  })
})

test('accepted plan cannot report success before writing project files', async () => {
  await withWorkspace(async workspace => {
    const replies = [
      toolResponse('finish', { message: '規劃完成，沒有修改檔案' }),
      toolResponse('write_file', { path: 'app/main.py', content: 'print("ready")\n' }),
      toolResponse('finish', { message: '實作完成' }),
    ]
    const events = []

    const result = await runAgentLoop('依照已接受方案實作', {
      workspaceId: 'test-workspace',
      sandboxWorkspacePath: workspace,
      isLocalHandle: true,
      requireFileChanges: true,
      expectedFiles: ['app/main.py'],
      askLlm: async () => replies.shift(),
      onEvent: event => events.push(event),
    })

    assert.equal(result.ok, true)
    assert.equal(result.finalMessage, '已完成方案要求的檔案變更。')
    assert.deepEqual(result.changedFiles, ['app/main.py'])
    assert.equal(fs.readFileSync(path.join(workspace, 'app', 'main.py'), 'utf8'), 'print("ready")\n')
    assert.ok(events.some(event => event.type === 'info' && /尚未寫入任何專案檔案/.test(event.message)))
  })
})

test('accepted plan cannot finish before post-change validation passes', async () => {
  await withWorkspace(async workspace => {
    const replies = [
      toolResponse('write_file', { path: 'app.js', content: 'console.log("ready")\n' }),
      toolResponse('finish', { message: '未驗證就完成' }),
      toolResponse('run_command', { command: 'node --check app.js' }),
      toolResponse('finish', { message: '驗證後完成' }),
    ]
    const events = []

    const result = await runAgentLoop('依照已接受方案實作並驗證', {
      workspaceId: 'test-workspace',
      sandboxWorkspacePath: workspace,
      isLocalHandle: true,
      requireFileChanges: true,
      requireValidation: true,
      expectedFiles: ['app.js'],
      askLlm: async () => replies.shift(),
      executeCommand: async () => '命令已成功執行，沒有輸出。',
      onEvent: event => events.push(event),
    })

    assert.equal(result.ok, true)
    assert.match(result.finalMessage, /node --check app\.js/)
    assert.match(result.finalMessage, /硬體操作不包含在此驗證範圍/)
    assert.equal(result.validationPassed, true)
    assert.equal(result.validationCommand, 'node --check app.js')
    assert.ok(events.some(event => event.type === 'info' && /尚未通過實作後驗證/.test(event.message)))
    assert.ok(events.some(event => event.type === 'validation'))
  })
})

test('accepted plan auto-runs a safe planned validation command before finish', async () => {
  await withWorkspace(async workspace => {
    const replies = [
      toolResponse('write_file', { path: 'app.js', content: 'console.log("ready")\n' }),
      toolResponse('finish', { message: 'done' }),
    ]
    const commands = []

    const result = await runAgentLoop('依照已接受方案實作並驗證', {
      workspaceId: 'test-workspace',
      sandboxWorkspacePath: workspace,
      isLocalHandle: true,
      requireFileChanges: true,
      requireValidation: true,
      expectedFiles: ['app.js'],
      validationCommands: ['node --check app.js'],
      askLlm: async () => replies.shift(),
      executeCommand: async command => {
        commands.push(command)
        return '命令已成功執行，沒有輸出。'
      },
      maxIterations: 5,
    })

    assert.equal(result.ok, true)
    assert.equal(result.validationPassed, true)
    assert.equal(result.validationCommand, 'node --check app.js')
    assert.deepEqual(commands, ['node --check app.js'])
  })
})

test('accepted plan can finish with an unverified warning when no safe validation command is available', async () => {
  await withWorkspace(async workspace => {
    const replies = [
      toolResponse('write_file', { path: 'app.py', content: 'print("ready")\n' }),
      toolResponse('finish', { message: 'done' }),
      toolResponse('finish', { message: 'done' }),
    ]

    const result = await runAgentLoop('依照已接受方案實作', {
      workspaceId: 'test-workspace',
      sandboxWorkspacePath: workspace,
      isLocalHandle: true,
      requireFileChanges: true,
      requireValidation: true,
      expectedFiles: ['app.py'],
      validationCommands: ['pip install -r requirements.txt'],
      askLlm: async () => replies.shift(),
      executeCommand: async () => '不應執行安裝命令',
      maxIterations: 5,
    })

    assert.equal(result.ok, true)
    assert.equal(result.validationPassed, false)
    assert.match(result.finalMessage, /沒有可自動執行且已通過的驗證命令/)
  })
})

test('accepted plan auto-finishes after file changes and validation pass', async () => {
  await withWorkspace(async workspace => {
    const replies = [
      toolResponse('write_file', { path: 'app.js', content: 'console.log("ready")\n' }),
      toolResponse('run_command', { command: 'node --check app.js' }),
      toolResponse('run_command', { command: 'node --check app.js' }),
    ]
    const events = []

    const result = await runAgentLoop('依照已接受方案實作並驗證', {
      workspaceId: 'test-workspace',
      sandboxWorkspacePath: workspace,
      isLocalHandle: true,
      requireFileChanges: true,
      requireValidation: true,
      expectedFiles: ['app.js'],
      askLlm: async () => replies.shift(),
      executeCommand: async () => '命令已成功執行，沒有輸出。',
      onEvent: event => events.push(event),
      maxIterations: 10,
    })

    assert.equal(result.ok, true)
    assert.equal(result.validationPassed, true)
    assert.equal(result.validationCommand, 'node --check app.js')
    assert.deepEqual(result.changedFiles, ['app.js'])
    assert.equal(replies.length, 1)
    assert.ok(events.some(event => event.type === 'finish' && /node --check app\.js/.test(event.message)))
  })
})

test('accepted static html plan auto-validates after expected files are written', async () => {
  await withWorkspace(async workspace => {
    const replies = [
      toolResponse('write_file', { path: 'index.html', content: '<!doctype html><script src="script.js"></script><link rel="stylesheet" href="style.css">' }),
      toolResponse('write_file', { path: 'style.css', content: 'body { color: #222; }\n' }),
      toolResponse('write_file', { path: 'script.js', content: 'console.log("clock ready")\n' }),
      toolResponse('run_command', { command: 'python3 -m http.server 8000' }),
    ]
    const events = []

    const result = await runAgentLoop('建立靜態世界時鐘網頁', {
      workspaceId: 'test-workspace',
      sandboxWorkspacePath: workspace,
      isLocalHandle: true,
      requireFileChanges: true,
      requireValidation: true,
      expectedFiles: ['index.html', 'style.css', 'script.js'],
      askLlm: async () => replies.shift(),
      validateStaticHtml: async entryPoint => ({
        ok: true,
        command: `frontend static check ${entryPoint}`,
        stdout: 'PASS index.html 存在\nPASS index.html 引用的 style.css 存在\nPASS index.html 引用的 script.js 存在\n',
        stderr: '',
        exitCode: 0,
      }),
      onEvent: event => events.push(event),
      maxIterations: 10,
    })

    assert.equal(result.ok, true)
    assert.equal(result.validationPassed, true)
    assert.equal(result.validationCommand, 'frontend static check index.html')
    assert.deepEqual(result.changedFiles, ['index.html', 'style.css', 'script.js'])
    assert.equal(replies.length, 1)
    assert.ok(events.some(event => event.type === 'validation' && /frontend static check index\.html/.test(event.message)))
  })
})

test('failed validation is not treated as success', async () => {
  await withWorkspace(async workspace => {
    const replies = [
      toolResponse('write_file', { path: 'app.js', content: 'broken\n' }),
      toolResponse('run_command', { command: 'node --check app.js' }),
      toolResponse('finish', { message: '錯誤地宣告完成' }),
    ]

    const result = await runAgentLoop('實作後驗證', {
      workspaceId: 'test-workspace',
      sandboxWorkspacePath: workspace,
      isLocalHandle: true,
      requireFileChanges: true,
      requireValidation: true,
      expectedFiles: ['app.js'],
      askLlm: async () => replies.shift() || toolResponse('finish', { message: '仍想完成' }),
      executeCommand: async () => 'STDERR:\nSyntaxError\nERROR:\nExit code: 1\n',
      maxIterations: 7,
    })

    assert.equal(result.ok, false)
    assert.notEqual(result.finalMessage, '錯誤地宣告完成')
  })
})

test('a failed dependency install cannot be hidden by a later syntax check', async () => {
  await withWorkspace(async workspace => {
    const replies = [
      toolResponse('write_file', { path: 'main.py', content: 'print("ready")\n' }),
      toolResponse('run_command', { command: 'pip install -r requirements.txt' }),
      toolResponse('run_command', { command: 'python -m py_compile main.py' }),
      toolResponse('finish', { message: '語法正確所以完成' }),
    ]

    const result = await runAgentLoop('建立可執行成品', {
      workspaceId: 'test-workspace',
      sandboxWorkspacePath: workspace,
      isLocalHandle: true,
      requireFileChanges: true,
      requireValidation: true,
      expectedFiles: ['main.py'],
      askLlm: async () => replies.shift() || toolResponse('finish', { message: '仍想完成' }),
      executeCommand: async command => command.startsWith('pip ')
        ? 'STDERR:\nnetwork unavailable\nERROR:\nExit code: 1\n'
        : '命令已成功執行，沒有輸出。',
      maxIterations: 8,
    })

    assert.equal(result.ok, false)
    assert.notEqual(result.finalMessage, '語法正確所以完成')
  })
})

test('network-disabled dependency installs produce offline recovery guidance', async () => {
  const previousNetworkDisabled = config.dockerSandbox.networkDisabled
  config.dockerSandbox.networkDisabled = true
  await withWorkspace(async workspace => {
    try {
      const replies = [
        toolResponse('write_file', { path: 'requirements.txt', content: 'geopandas\n' }),
        toolResponse('run_command', { command: 'pip install -r requirements.txt' }),
      ]
      const events = []

      const result = await runAgentLoop('建立台灣地圖', {
        workspaceId: 'test-workspace',
        sandboxWorkspacePath: workspace,
        isLocalHandle: true,
        requireFileChanges: true,
        requireValidation: true,
        expectedFiles: ['requirements.txt'],
        askLlm: async () => replies.shift() || toolResponse('finish', { message: 'done' }),
        executeCommand: async () => [
          'STDERR:',
          "WARNING: Retrying after connection broken by 'NewConnectionError': Temporary failure in name resolution",
          'ERROR:',
          'Exit code: 1',
        ].join('\n'),
        onEvent: event => events.push(event),
        maxIterations: 6,
      })

      assert.equal(result.ok, false)
      assert.match(result.history, /Docker Sandbox 目前停用網路/)
      assert.ok(events.some(event => event.type === 'info' && /沙盒網路停用/.test(event.message)))
    } finally {
      config.dockerSandbox.networkDisabled = previousNetworkDisabled
    }
  })
})

test('LLM empty retries do not hide the actionable command failure on abort', async () => {
  await withWorkspace(async workspace => {
    const replies = [
      toolResponse('write_file', { path: 'requirements.txt', content: 'geopandas\n' }),
      toolResponse('run_command', { command: 'pip install -r requirements.txt' }),
      toolResponse('run_command', { command: 'python -m py_compile create_map.py' }),
      toolResponse('finish', { message: '語法正確所以完成' }),
    ]

    const result = await runAgentLoop('建立台灣地圖', {
      workspaceId: 'test-workspace',
      sandboxWorkspacePath: workspace,
      isLocalHandle: true,
      requireFileChanges: true,
      requireValidation: true,
      expectedFiles: ['requirements.txt'],
      askLlm: async () => replies.shift() || ({ ok: false, content: '', error: 'Ollama 回覆空白。' }),
      executeCommand: async command => command.startsWith('pip ')
        ? [
            'STDERR:',
            "WARNING: Retrying after connection broken by 'NewConnectionError': Temporary failure in name resolution",
            'ERROR:',
            'Exit code: 1',
          ].join('\n')
        : '命令已成功執行，沒有輸出。',
      maxIterations: 12,
    })

    assert.equal(result.ok, false)
    assert.match(result.error, /pip install -r requirements\.txt|Docker Sandbox 目前停用網路/)
    assert.doesNotMatch(result.error, /^連續錯誤過多[\s\S]*最近失敗：\nLLM 回應異常/m)
  })
})

test('accepted implementation agent forbids fake data as a product substitute', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/agentLoopService.js'), 'utf8')

  assert.match(source, /fake data/)
  assert.match(source, /sample data/)
  assert.match(source, /hard-coded successful results/)
  assert.match(source, /Mocks are allowed only in tests/)
  assert.match(source, /never pretend fake data is a working product/)
})

test('accepted implementation agent rejects fake external tool shims', async () => {
  await withWorkspace(async workspace => {
    const replies = [
      toolResponse('write_file', { path: 'flake8.py', content: 'print("pretend ok")\n' }),
      toolResponse('write_file', { path: 'flake8', content: '#!/bin/sh\nexit 0\n' }),
      toolResponse('write_file', { path: 'tools/pytest.py', content: 'print("pretend ok")\n' }),
      toolResponse('write_file', { path: 'ruff', content: '#!/bin/sh\nexit 0\n' }),
      toolResponse('write_file', { path: 'eslint.js', content: 'process.exit(0)\n' }),
    ]

    const result = await runAgentLoop('缺少 lint 工具時不能建立假工具', {
      workspaceId: 'test-workspace',
      sandboxWorkspacePath: workspace,
      isLocalHandle: true,
      requireFileChanges: true,
      askLlm: async () => replies.shift() || toolResponse('finish', { message: 'done' }),
      maxIterations: 10,
    })

    assert.equal(result.ok, false)
    assert.match(result.error, /連續錯誤過多/)
    assert.match(result.error, /外部工具替身/)
    assert.equal(fs.existsSync(path.join(workspace, 'flake8.py')), false)
    assert.equal(fs.existsSync(path.join(workspace, 'flake8')), false)
    assert.equal(fs.existsSync(path.join(workspace, 'tools', 'pytest.py')), false)
    assert.equal(fs.existsSync(path.join(workspace, 'ruff')), false)
    assert.equal(fs.existsSync(path.join(workspace, 'eslint.js')), false)
  })
})

test('agent loop rejects placeholder validation commands before execution', async () => {
  await withWorkspace(async workspace => {
    let executed = false
    const result = await runAgentLoop('驗證圖片處理功能', {
      workspaceId: 'test-workspace',
      sandboxWorkspacePath: workspace,
      isLocalHandle: true,
      askLlm: async () => toolResponse('run_command', { command: 'python tests/test_conversion.py --input <請替換為真實圖片路徑> --width 800' }),
      executeCommand: async () => {
        executed = true
        return '命令不應被執行'
      },
      maxIterations: 6,
    })

    assert.equal(executed, false)
    assert.equal(result.ok, false)
    assert.match(result.error, /占位內容/)
    assert.match(result.error, /請替換/)
  })
})

test('agent loop LLM calls use a bounded timeout instead of waiting forever', async () => {
  await withWorkspace(async workspace => {
    const timeoutValues = []
    const result = await runAgentLoop('驗證模型 timeout', {
      workspaceId: 'test-workspace',
      sandboxWorkspacePath: workspace,
      isLocalHandle: true,
      llmTimeoutMs: 999999999,
      askLlm: async (_prompt, options) => {
        timeoutValues.push(options.timeoutMs)
        return toolResponse('finish', { message: 'done' })
      },
      maxIterations: 1,
    })

    assert.equal(result.ok, true)
    assert.deepEqual(timeoutValues, [300000])
  })
})

test('agent loop recognizes finish intent when model outputs conversational completion and files exist', async () => {
  await withWorkspace(async workspace => {
    const replies = [
      toolResponse('write_file', { path: 'index.html', content: '<h1>Done</h1>' }),
      {
        ok: true,
        content: '<thought>I have finished writing the required file.</thought>\nAll tasks completed! Everything is ready.',
        tokens: 30,
      }
    ]

    const events = []
    const result = await runAgentLoop('建立 index.html', {
      workspaceId: 'test-workspace',
      sandboxWorkspacePath: workspace,
      isLocalHandle: true,
      requireFileChanges: true,
      expectedFiles: ['index.html'],
      askLlm: async () => replies.shift(),
      onEvent: event => events.push(event),
      maxIterations: 4,
    })

    assert.equal(result.ok, true)
    assert.equal(fs.existsSync(path.join(workspace, 'index.html')), true)
    // Verify it did not trigger "未偵測到工具呼叫"
    const missingCallEvents = events.filter(e => e.message?.includes('未偵測到工具呼叫'))
    assert.equal(missingCallEvents.length, 0)
  })
})

test('agent loop extracts unclosed tool_call tags properly', async () => {
  await withWorkspace(async workspace => {
    const replies = [
      {
        ok: true,
        // Missing </tool_call> closing tag
        content: '<thought>Writing main.js</thought>\n<tool_call>\n{\n  "tool": "write_file",\n  "args": {\n    "path": "main.js",\n    "content": "console.log(1)"\n  }\n}',
        tokens: 45,
      },
      toolResponse('finish', { message: 'done' })
    ]

    const result = await runAgentLoop('建立 main.js', {
      workspaceId: 'test-workspace',
      sandboxWorkspacePath: workspace,
      isLocalHandle: true,
      requireFileChanges: true,
      askLlm: async () => replies.shift(),
      maxIterations: 4,
    })

    assert.equal(result.ok, true)
    assert.equal(fs.existsSync(path.join(workspace, 'main.js')), true)
  })
})
