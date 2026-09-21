const http = require('http')
const path = require('path')
const { randomUUID } = require('crypto')
const { spawn } = require('child_process')
const httpProxy = require('http-proxy')
const config = require('../config')
const { dockerStatus } = require('../tools/dockerSandbox')
const { resolveProjectWorkspace } = require('./sandboxWorkspaceService')

const activeApps = new Map()
const terminalApps = new Map()
const appLifetimeMs = 30 * 60 * 1000
const proxy = httpProxy.createProxyServer({
  ws: true,
  changeOrigin: true,
  xfwd: true,
})

function cleanRelativePath(filePath = '') {
  const clean = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!clean || clean === '..' || clean.startsWith('../') || clean.includes('/../')) {
    throw new Error('Sandbox App 執行檔案路徑無效')
  }
  return clean
}

function shellQuote(value = '') {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function runDocker(args, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let child

    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(result)
    }

    try {
      child = spawn('docker', args, {
        shell: false,
        windowsHide: true,
      })
    } catch (error) {
      reject(error)
      return
    }

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
      finish(new Error(`Docker 指令逾時：docker ${args.slice(0, 3).join(' ')}`))
    }, timeoutMs)

    child.stdout.on('data', chunk => { stdout += chunk.toString() })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.on('error', error => finish(error))
    child.on('close', code => finish(null, {
      ok: code === 0,
      code: code ?? -1,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    }))
  })
}

function requestHealth(port, healthPath) {
  return new Promise(resolve => {
    const request = http.get({
      host: '127.0.0.1',
      port,
      path: healthPath,
      timeout: 1500,
    }, response => {
      response.resume()
      resolve(response.statusCode >= 200 && response.statusCode < 500)
    })
    request.on('timeout', () => {
      request.destroy()
      resolve(false)
    })
    request.on('error', () => resolve(false))
  })
}

function requestJson(port, requestPath, { method = 'GET', body = null } = {}) {
  return new Promise(resolve => {
    const payload = body ? JSON.stringify(body) : ''
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: requestPath,
      method,
      timeout: 2000,
      headers: {
        Accept: 'application/json',
        ...(payload ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        } : {}),
      },
    }, response => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { text += chunk })
      response.on('end', () => {
        let json = null
        try { json = text ? JSON.parse(text) : null } catch {}
        resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, statusCode: response.statusCode, text, json })
      })
    })
    request.on('timeout', () => {
      request.destroy()
      resolve({ ok: false, statusCode: 0, text: 'request timeout', json: null })
    })
    request.on('error', error => resolve({ ok: false, statusCode: 0, text: error.message, json: null }))
    if (payload) request.write(payload)
    request.end()
  })
}

async function dockerLogs(containerName) {
  try {
    const result = await runDocker(['logs', '--tail', '120', containerName], { timeoutMs: 5000 })
    return [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
  } catch {
    return ''
  }
}

async function runMessageBoardSmokeTest(port) {
  const marker = `Cubi smoke ${Date.now()}`
  const before = await requestJson(port, '/api/messages')
  if (!before.ok) {
    throw new Error(`API smoke test 失敗：GET /api/messages 回傳 ${before.statusCode || before.text}`)
  }
  const created = await requestJson(port, '/api/messages', {
    method: 'POST',
    body: { author: 'Cubi Smoke Test', content: marker },
  })
  if (!created.ok) {
    throw new Error(`API smoke test 失敗：POST /api/messages 回傳 ${created.statusCode || created.text}`)
  }
  const after = await requestJson(port, '/api/messages')
  const records = Array.isArray(after.json) ? after.json : []
  const persisted = records.some(item => String(item?.content || '').includes(marker))
  if (!after.ok || !persisted) {
    throw new Error('API smoke test 失敗：POST 後重新 GET 沒有讀到剛寫入的留言')
  }
  return {
    kind: 'message_board_api',
    passed: true,
    command: 'GET /api/messages -> POST /api/messages -> GET /api/messages',
    inserted_content: marker,
    records_seen: records.length,
  }
}

async function waitForPublishedPort(containerName) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await runDocker(['port', containerName, '8501/tcp'], { timeoutMs: 3000 })
    const match = `${result.stdout}\n${result.stderr}`.match(/:(\d+)\s*$/m)
    if (result.ok && match) return Number(match[1])
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error('無法取得 Docker Sandbox App 的 Server 內部連接埠')
}

function registerTerminalApp({
  sessionId,
  containerName,
  workspaceId,
  port,
}) {
  const id = String(sessionId || '').trim()
  if (!id || !Number.isFinite(Number(port))) {
    throw new Error('終端機 Sandbox App 代理資料不完整')
  }
  const app = {
    id,
    containerName,
    workspaceId,
    framework: 'terminal_web_app',
    port: Number(port),
    basePath: `/sandbox/terminals/${id}`,
    target: `http://127.0.0.1:${Number(port)}`,
    createdAt: new Date().toISOString(),
  }
  terminalApps.set(id, app)
  return {
    session_id: id,
    preview_path: `${app.basePath}/`,
    target: app.target,
  }
}

function unregisterTerminalApp(sessionId) {
  return terminalApps.delete(String(sessionId || ''))
}

function shouldStripSandboxAppBasePath(framework = '') {
  return ['static_website', 'node_server', 'flask', 'fastapi'].includes(String(framework || ''))
}

async function waitForAppReady(port, basePath) {
  const healthPath = `${basePath}/_stcore/health`
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await requestHealth(port, healthPath)) return true
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return false
}

async function stopSandboxApp(appId) {
  const app = activeApps.get(String(appId || ''))
  if (!app) return false
  activeApps.delete(app.id)
  if (app.cleanupTimer) clearTimeout(app.cleanupTimer)
  try {
    await runDocker(['rm', '-f', app.containerName], { timeoutMs: 10000 })
  } catch {}
  return true
}

async function stopWorkspaceApps(workspaceId) {
  const matches = Array.from(activeApps.values()).filter(app => app.workspaceId === workspaceId)
  await Promise.all(matches.map(app => stopSandboxApp(app.id)))
}

function renewAppLifetime(app) {
  if (app.cleanupTimer) clearTimeout(app.cleanupTimer)
  app.cleanupTimer = setTimeout(() => stopSandboxApp(app.id), appLifetimeMs)
  app.cleanupTimer.unref?.()
}

function appLaunchResult(app, interactiveApp, commandLabel, startedAt, reused = false) {
  const previewPath = app.framework === 'node_server'
    ? `${app.target}/`
    : app.framework === 'flask' || app.framework === 'fastapi'
    ? app.basePath
    : `${app.basePath}/`
  return {
    ok: true,
    kind: 'app_launch',
    launch_type: `${app.framework}_web_app`,
    command: `docker run --rm ... ${commandLabel}`,
    stdout: reused
      ? `${interactiveApp.label} 已沿用執行中的 Server 端 Docker Sandbox。\n預覽網址：${previewPath}\n`
      : `${interactiveApp.label} 已在 Server 端 Docker Sandbox 啟動。\n預覽網址：${previewPath}\n`,
    stderr: '',
    exitCode: 0,
    returncode: 0,
    elapsed_seconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
    sandbox: {
      engine: 'docker_app_proxy',
      launch_type: `${app.framework}_web_app`,
      framework: app.framework,
      interactive: true,
      isolated: true,
      status: 'running',
      workspace_id: app.workspaceId,
      workspace: '/workspace',
      container_ephemeral: true,
      app_id: app.id,
      preview_path: previewPath,
      proxy_path: `${app.basePath}/`,
      access_mode: app.framework === 'node_server' ? 'direct_localhost' : 'server_reverse_proxy',
      network: 'server-managed',
      reused,
      expires_in_seconds: Math.round(appLifetimeMs / 1000),
    },
    messages: [
      reused
        ? `${interactiveApp.label} 已沿用執行中的 Server 端 Docker Sandbox`
        : `${interactiveApp.label} 已在 Server 端 Docker Sandbox 啟動`,
      '預覽固定重用同一個瀏覽器視窗',
    ],
    passed: 1,
    failed: 0,
    total: 1,
  }
}

async function startInteractiveApp(interactiveApp, options = {}) {
  const startedAt = Date.now()
  const docker = dockerStatus()
  const entryFile = cleanRelativePath(interactiveApp.entryFile)
  const framework = interactiveApp.framework || 'unknown'
  const commandLabel = interactiveApp.command

  if (!docker.ok) {
    return {
      ok: false,
      kind: 'app_launch',
      command: commandLabel,
      stdout: '',
      stderr: `Docker Sandbox 未就緒：${docker.message}`,
      exitCode: -1,
      returncode: -1,
      elapsed_seconds: 0,
      sandbox: {
        engine: 'docker_app_proxy',
        isolated: true,
        status: 'error',
        launch_type: `${framework}_web_app`,
        error: docker.message,
      },
      passed: 0,
      failed: 1,
      total: 1,
    }
  }

  const workspace = resolveProjectWorkspace(options.workspaceId)
  const reusableApp = framework === 'static_website'
    ? Array.from(activeApps.values()).find(app => (
      app.workspaceId === workspace.id &&
      app.entryFile === entryFile &&
      app.framework === framework
    ))
    : null
  if (reusableApp) {
    if (await requestHealth(reusableApp.port, '/')) {
      renewAppLifetime(reusableApp)
      return appLaunchResult(reusableApp, interactiveApp, commandLabel, startedAt, true)
    }
    await stopSandboxApp(reusableApp.id)
  }
  await stopWorkspaceApps(workspace.id)

  const appId = randomUUID()
  const containerName = `cubi-app-${appId.slice(0, 8)}`
  const basePath = `/sandbox/apps/${appId}`
  
  let appCommand = []
  let internalPort = 8501
  
  if (framework === 'streamlit') {
    const streamlitBasePath = basePath.replace(/^\/+/, '')
    appCommand = [
      'python3', '-m', 'streamlit', 'run', entryFile,
      '--server.headless', 'true',
      '--server.address', '0.0.0.0',
      '--server.port', '8501',
      '--server.baseUrlPath', streamlitBasePath,
      '--server.enableCORS', 'false',
      '--server.enableXsrfProtection', 'false',
      '--browser.gatherUsageStats', 'false',
    ]
  } else if (framework === 'flask') {
    internalPort = 5000
    appCommand = ['sh', '-lc', `export FLASK_APP=${entryFile} && python3 -m flask run --host=0.0.0.0 --port=5000`]
  } else if (framework === 'fastapi') {
    internalPort = 8000
    const moduleName = entryFile.replace(/\.[^.]+$/, '').replace(/\//g, '.')
    appCommand = ['uvicorn', `${moduleName}:app`, '--host', '0.0.0.0', '--port', '8000', '--root-path', basePath]
  } else if (framework === 'static_website') {
    internalPort = 8787
    const staticDirectory = path.posix.dirname(entryFile)
    appCommand = [
      'python3', '-m', 'http.server', '8787',
      '--bind', '0.0.0.0',
      '--directory', staticDirectory === '.' ? '/workspace' : `/workspace/${staticDirectory}`,
    ]
  } else if (framework === 'node_server') {
    internalPort = Number(interactiveApp.port || 3000)
    const appDirectory = path.posix.dirname(entryFile)
    const cdCommand = appDirectory === '.'
      ? ''
      : `cd ${shellQuote(appDirectory)} && `
    const startCommand = interactiveApp.startCommand || 'npm start'
    appCommand = [
      'sh', '-lc',
      `${cdCommand}if [ ! -d node_modules ]; then npm install --no-audit --no-fund; fi && ${startCommand}`,
    ]
  } else {
    // fallback
    appCommand = ['python3', entryFile]
  }

  const dockerArgs = [
    'run', '-d', '--rm',
    '--name', containerName,
    '--memory', config.dockerSandbox.memory || '512m',
    '--cpus', String(config.dockerSandbox.cpus || '1.0'),
    '--pids-limit', String(config.dockerSandbox.pidsLimit || 256),
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--read-only',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m',
    '-e', 'HOME=/tmp/home',
    '-e', 'TMPDIR=/tmp',
    '-e', `PORT=${internalPort}`,
    '-p', `127.0.0.1::${internalPort}`,
    '-v', `${workspace.path}:/workspace:rw`,
    '-w', '/workspace',
    config.dockerSandbox.image,
    ...appCommand,
  ]

  let port = 0
  try {
    const runResult = await runDocker(dockerArgs, { timeoutMs: 20000 })
    if (!runResult.ok) throw new Error(runResult.stderr || runResult.stdout || 'Docker App 容器啟動失敗')

    // Wait for the specific internal port to be published
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const result = await runDocker(['port', containerName, `${internalPort}/tcp`], { timeoutMs: 3000 })
      const match = `${result.stdout}\n${result.stderr}`.match(/:(\d+)\s*$/m)
      if (result.ok && match) { port = Number(match[1]); break; }
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    if (!port) throw new Error('無法取得 Docker Sandbox App 的 Server 內部連接埠')

    // Use a small delay for other apps, or full health check for streamlit
    if (framework === 'streamlit') {
      const ready = await waitForAppReady(port, basePath)
      if (!ready) throw new Error('Streamlit 啟動逾時')
    } else if (framework === 'node_server') {
      let ready = false
      for (let attempt = 0; attempt < 180; attempt += 1) {
        if (await requestHealth(port, '/')) { ready = true; break }
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      if (!ready) {
        const logs = await dockerLogs(containerName)
        throw new Error(`Node.js Server 啟動逾時${logs ? `\n最近容器輸出：\n${logs}` : ''}`)
      }
    } else {
      await new Promise(resolve => setTimeout(resolve, 3000))
    }

    const smokeTest = framework === 'node_server' && interactiveApp.smokeTest === 'message_board'
      ? await runMessageBoardSmokeTest(port)
      : null

    const app = {
      id: appId,
      containerName,
      workspaceId: workspace.id,
      entryFile,
      framework,
      port,
      basePath,
      target: `http://127.0.0.1:${port}`,
      stripBasePath: shouldStripSandboxAppBasePath(framework),
      createdAt: new Date().toISOString(),
      cleanupTimer: null,
    }
    renewAppLifetime(app)
    activeApps.set(appId, app)

    const launch = appLaunchResult(app, interactiveApp, commandLabel, startedAt, false)
    if (smokeTest) {
      launch.stdout += `API smoke test 通過：${smokeTest.command}；目前讀到 ${smokeTest.records_seen} 則留言。\n`
      launch.sandbox.smoke_test = smokeTest
      launch.messages = [...launch.messages, 'API smoke test 通過，留言寫入後可重新讀取']
      launch.passed = 2
      launch.total = 2
    }
    return launch
  } catch (error) {
    const logs = await dockerLogs(containerName)
    try { await runDocker(['rm', '-f', containerName], { timeoutMs: 10000 }) } catch {}
    const message = logs && !String(error.message || '').includes(logs)
      ? `${error.message}\n最近容器輸出：\n${logs}`
      : error.message
    return {
      ok: false,
      kind: 'app_launch',
      launch_type: `${framework}_web_app`,
      command: commandLabel,
      stdout: '',
      stderr: `${message}\n`,
      exitCode: 1,
      returncode: 1,
      elapsed_seconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
      sandbox: {
        engine: 'docker_app_proxy',
        launch_type: `${framework}_web_app`,
        framework,
        interactive: true,
        isolated: true,
        status: 'failed',
        workspace_id: workspace.id,
        workspace: '/workspace',
        error: message,
      },
      passed: 0,
      failed: 1,
      total: 1,
    }
  }
}

async function waitForPublishedGuiPort(containerName) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await runDocker(['port', containerName, '6080/tcp'], { timeoutMs: 3000 })
    const match = `${result.stdout}\n${result.stderr}`.match(/:(\d+)\s*$/m)
    if (result.ok && match) return Number(match[1])
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error('無法取得 Docker Sandbox App 的 GUI VNC 內部連接埠')
}

async function startGuiApp(filePath, options = {}) {
  const startedAt = Date.now()
  const docker = dockerStatus()
  const entryFile = cleanRelativePath(filePath)
  const commandLabel = `python3 ${entryFile} (GUI Mode)`

  if (!docker.ok) {
    return {
      ok: false,
      kind: 'app_launch',
      command: commandLabel,
      stdout: '',
      stderr: `Docker Sandbox 未就緒：${docker.message}`,
      exitCode: -1,
      returncode: -1,
      elapsed_seconds: 0,
      sandbox: {
        engine: 'docker_app_proxy',
        isolated: true,
        status: 'error',
        launch_type: 'gui_web_app',
        error: docker.message,
      },
      passed: 0,
      failed: 1,
      total: 1,
    }
  }

  const workspace = resolveProjectWorkspace(options.workspaceId)
  await stopWorkspaceApps(workspace.id)

  const appId = randomUUID()
  const containerName = `cubi-app-${appId.slice(0, 8)}`
  const basePath = `/sandbox/apps/${appId}`

  // Start a virtual display and expose it through noVNC. The Cubi proxy removes
  // the public /sandbox/apps/<id> prefix before forwarding to websockify.
  const startupScript = `
Xvfb :99 -screen 0 1024x768x24 &
fluxbox -display :99 &
x11vnc -display :99 -forever -nopw -bg -xkb -quiet -listen 127.0.0.1 -rfbport 5900
websockify --web /usr/share/novnc 6080 127.0.0.1:5900 &
export DISPLAY=:99
python3 -u ${entryFile}
`

  const dockerArgs = [
    'run', '-d', '--rm',
    '--name', containerName,
    '--memory', config.dockerSandbox.memory || '512m',
    '--cpus', String(config.dockerSandbox.cpus || '1.0'),
    '--pids-limit', String(config.dockerSandbox.pidsLimit || 256),
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--read-only',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m',
    '-e', 'HOME=/tmp/home',
    '-e', 'TMPDIR=/tmp',
    '-p', '127.0.0.1::6080',
    '-v', `${workspace.path}:/workspace:rw`,
    '-w', '/workspace',
    config.dockerSandbox.image,
    'sh', '-lc', startupScript
  ]

  let port = 0
  try {
    const runResult = await runDocker(dockerArgs, { timeoutMs: 20000 })
    if (!runResult.ok) throw new Error(runResult.stderr || runResult.stdout || 'Docker App 容器啟動失敗')

    port = await waitForPublishedGuiPort(containerName)
    // Wait briefly for the websockify to be up
    await new Promise(resolve => setTimeout(resolve, 2000))

    const app = {
      id: appId,
      containerName,
      workspaceId: workspace.id,
      entryFile,
      framework: 'gui',
      port,
      basePath,
      target: `http://127.0.0.1:${port}`,
      stripBasePath: true,
      createdAt: new Date().toISOString(),
      cleanupTimer: null,
    }
    app.cleanupTimer = setTimeout(() => stopSandboxApp(appId), appLifetimeMs)
    app.cleanupTimer.unref?.()
    activeApps.set(appId, app)
    const websockifyPath = encodeURIComponent(`${basePath.replace(/^\/+/, '')}/websockify`)
    const previewPath = `${basePath}/vnc.html?autoconnect=true&resize=remote&path=${websockifyPath}`

    return {
      ok: true,
      kind: 'app_launch',
      launch_type: 'gui_web_app',
      command: `docker run --rm ... ${commandLabel}`,
      stdout: `GUI 應用程式已在 Server 端 Docker Sandbox 啟動。\n本次不自動開啟網頁；預覽位址：${previewPath}\n`,
      stderr: '',
      exitCode: 0,
      returncode: 0,
      elapsed_seconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
      sandbox: {
        engine: 'docker_app_proxy',
        launch_type: 'gui_web_app',
        framework: 'gui',
        interactive: true,
        isolated: true,
        status: 'running',
        workspace_id: workspace.id,
        workspace: '/workspace',
        container_ephemeral: true,
        app_id: appId,
        preview_path: previewPath,
        access_mode: 'server_reverse_proxy',
        network: 'server-managed',
        expires_in_seconds: Math.round(appLifetimeMs / 1000),
      },
      messages: [
        'GUI 應用程式已啟動',
        '不自動開啟網頁；需要時請由終端機操作'
      ],
      passed: 1,
      failed: 0,
      total: 1,
    }
  } catch (error) {
    try { await runDocker(['rm', '-f', containerName], { timeoutMs: 10000 }) } catch {}
    return {
      ok: false,
      kind: 'app_launch',
      launch_type: 'gui_web_app',
      command: commandLabel,
      stdout: '',
      stderr: `${error.message}\n`,
      exitCode: 1,
      returncode: 1,
      elapsed_seconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
      sandbox: {
        engine: 'docker_app_proxy',
        launch_type: 'gui_web_app',
        framework: 'gui',
        interactive: true,
        isolated: true,
        status: 'failed',
        workspace_id: workspace.id,
        workspace: '/workspace',
        error: error.message,
      },
      passed: 0,
      failed: 1,
      total: 1,
    }
  }
}

function getSandboxApp(appId) {
  return activeApps.get(String(appId || '')) || null
}

function listSandboxApps() {
  return Array.from(activeApps.values()).map(app => ({
    id: app.id,
    workspace_id: app.workspaceId,
    entry_file: app.entryFile,
    framework: app.framework,
    preview_path: `${app.basePath}/`,
    created_at: app.createdAt,
  }))
}

function appIdFromUrl(url = '') {
  const match = String(url || '').match(/^\/sandbox\/apps\/([0-9a-f-]+)(?:\/|$)/i)
  return match?.[1] || ''
}

function terminalIdFromUrl(url = '') {
  const match = String(url || '').match(/^\/sandbox\/terminals\/([0-9a-f-]+)(?:\/|$)/i)
  return match?.[1] || ''
}

function proxyAppFromUrl(url = '') {
  const appId = appIdFromUrl(url)
  if (appId) return activeApps.get(appId) || null
  const terminalId = terminalIdFromUrl(url)
  if (terminalId) return terminalApps.get(terminalId) || null
  return null
}

function stripProxyBasePath(url = '', basePath = '') {
  const requestUrl = String(url || '')
  const prefix = String(basePath || '').replace(/\/+$/, '')
  if (!prefix || requestUrl.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) {
    return requestUrl || '/'
  }
  const stripped = requestUrl.slice(prefix.length)
  if (!stripped) return '/'
  return stripped.startsWith('/') || stripped.startsWith('?') ? stripped : `/${stripped}`
}

function handleSandboxAppHttp(req, res, next) {
  const url = req.originalUrl || req.url
  const isSandboxAppPath = /^\/sandbox\/(?:apps|terminals)\//i.test(String(url || ''))
  if (!isSandboxAppPath) return next()
  const sandboxApp = proxyAppFromUrl(url)
  if (!sandboxApp) {
    res.status(404).send('Sandbox App 已停止或網址已過期')
    return
  }
  if (sandboxApp.stripBasePath) {
    req.url = stripProxyBasePath(req.url, sandboxApp.basePath)
  }
  proxy.web(req, res, { target: sandboxApp.target })
}

function attachSandboxAppWebSocketProxy(server) {
  server.on('upgrade', (req, socket, head) => {
    if (!/^\/sandbox\/(?:apps|terminals)\//i.test(String(req.url || ''))) return
    const sandboxApp = proxyAppFromUrl(req.url)
    if (!sandboxApp) {
      socket.destroy()
      return
    }
    if (sandboxApp.stripBasePath) {
      req.url = stripProxyBasePath(req.url, sandboxApp.basePath)
    }
    proxy.ws(req, socket, head, { target: sandboxApp.target })
  })
}

proxy.on('error', (error, req, resOrSocket) => {
  if (typeof resOrSocket?.writeHead === 'function') {
    if (!resOrSocket.headersSent) {
      resOrSocket.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
    }
    resOrSocket.end(`Sandbox App 代理失敗：${error.message}`)
    return
  }
  try { resOrSocket?.destroy() } catch {}
})

module.exports = {
  startInteractiveApp,
  startGuiApp,
  stopSandboxApp,
  getSandboxApp,
  listSandboxApps,
  waitForPublishedPort,
  registerTerminalApp,
  unregisterTerminalApp,
  handleSandboxAppHttp,
  attachSandboxAppWebSocketProxy,
  shouldStripSandboxAppBasePath,
  stripProxyBasePath,
}
