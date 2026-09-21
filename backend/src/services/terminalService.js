const fs = require('fs')
const path = require('path')
const { randomUUID, randomInt } = require('crypto')
const { spawn } = require('child_process')
const net = require('net')
const { Server } = require('socket.io')
const config = require('../config')
const { dockerStatus } = require('../tools/dockerSandbox')

let pty = null
let ptyLoadError = null
try {
  pty = require('node-pty')
} catch (error) {
  ptyLoadError = error
}

const activeSessions = new Map()

function validProjectName(value = '') {
  const name = String(value || '').trim()
  if (!name) return ''
  if (name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('..')) return ''
  return name
}

function resolveTerminalWorkspace(projectName = '') {
  const requested = validProjectName(projectName)
  if (String(projectName || '').trim() && !requested) {
    throw new Error('Invalid project name for Sandbox terminal')
  }

  const target = requested
    ? path.resolve(config.projectsDir, requested)
    : path.resolve(config.workspaceDir)
  const projectsRoot = path.resolve(config.projectsDir)
  const relative = path.relative(projectsRoot, target)

  // The terminal may mount only one direct/descendant project under the managed
  // my_project root. Never allow a project name to escape into the Cubi host root.
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Sandbox terminal workspace is outside the managed project root')
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new Error(`Project directory not found: ${requested || path.basename(target)}`)
  }
  return target
}

function ensureWorkspaceDir(projectName = '') {
  fs.mkdirSync(config.projectsDir, { recursive: true })
  if (!projectName) fs.mkdirSync(config.workspaceDir, { recursive: true })
  return resolveTerminalWorkspace(projectName)
}

function dockerExecutable() {
  const explicit = String(process.env.CUBI_DOCKER_CLI || '').trim()
  if (explicit) return explicit
  return process.platform === 'win32' ? 'docker.exe' : 'docker'
}

function validContainerName(value = '') {
  const name = String(value || '').trim()
  return /^cubi-terminal-[a-f0-9-]{6,40}$/i.test(name) ? name : ''
}

function sandboxDockerArgs(runtime, useTty = true) {
  const startupScript = [
    'mkdir -p "$HOME" "$XDG_CACHE_HOME" "$XDG_RUNTIME_DIR"',
    'chmod 700 "$HOME" "$XDG_RUNTIME_DIR"',
    'touch "$HISTFILE"',
    'cat > /tmp/cubi-terminal-rc <<\'EOF\'',
    '_cubi_port_is_open() {',
    '  python3 -c \'import socket, sys; sock = socket.socket(); sock.settimeout(0.25); sys.exit(0 if sock.connect_ex(("127.0.0.1", int(sys.argv[1]))) == 0 else 1)\' "$1"',
    '}',
    '_cubi_open_html() {',
    '  local target="$1"',
    '  if [ -z "$target" ]; then',
    '    echo "用法：start index.html 或 open index.html" >&2',
    '    return 2',
    '  fi',
    '  if [ ! -f "$target" ]; then',
    '    echo "找不到 HTML 檔案：$target" >&2',
    '    return 2',
    '  fi',
    '  case "$target" in',
    '    *.html|*.htm) ;;',
    '    *) echo "Sandbox 的 start/open 目前支援 .html/.htm；Python 請用 flask run 檔名.py 或 python3 檔名.py" >&2; return 2 ;;',
    '  esac',
    '  local port="${CUBI_APP_PORT:-${PORT:-8000}}"',
    '  local dir="$(dirname "$target")"',
    '  local base="$(basename "$target")"',
    '  local encoded',
    '  encoded="$(python3 -c \'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))\' "$base")"',
    '  if _cubi_port_is_open "$port"; then',
    '    echo "已偵測到 port $port 有服務；直接開啟下列網址。"',
    '  else',
    '    (python3 -m http.server "$port" --bind 0.0.0.0 --directory "$dir" >/tmp/cubi-static-"$port".log 2>&1 & echo $! >/tmp/cubi-static-"$port".pid)',
    '  fi',
    '  echo "開啟網址：http://127.0.0.1:$port/$encoded"',
    '  echo "停止靜態伺服器：kill $(cat /tmp/cubi-static-"$port".pid 2>/dev/null || true)"',
    '}',
    'start() { _cubi_open_html "$@"; }',
    'open() { _cubi_open_html "$@"; }',
    'flask() {',
    '  if [ "$1" = "run" ] && [ -n "$2" ] && [ "${2%.py}" != "$2" ]; then',
    '    local target="$2"',
    '    shift 2',
    '    if [ ! -f "$target" ]; then',
    '      echo "找不到 Flask 啟動檔：$target" >&2',
    '      return 2',
    '    fi',
    '    local module="${target%.py}"',
    '    module="${module#./}"',
    '    module="${module//\\//.}"',
    '    command python3 -m flask --app "$module" run --host "${FLASK_RUN_HOST:-0.0.0.0}" --port "${FLASK_RUN_PORT:-${CUBI_APP_PORT:-${PORT:-5000}}}" "$@"',
    '    return $?',
    '  fi',
    '  command flask "$@"',
    '}',
    'streamlit() {',
    '  if [ "$1" = "run" ] && [ -n "$2" ] && [ "${2%.py}" != "$2" ]; then',
    '    local target="$2"',
    '    shift 2',
    '    if [ ! -f "$target" ]; then',
    '      echo "找不到 Streamlit 啟動檔：$target" >&2',
    '      return 2',
    '    fi',
    '    command streamlit run "$target" --server.address="${STREAMLIT_SERVER_ADDRESS:-0.0.0.0}" --server.port="${STREAMLIT_SERVER_PORT:-${CUBI_APP_PORT:-${PORT:-8501}}}" --server.headless=true --browser.gatherUsageStats=false "$@"',
    '    return $?',
    '  fi',
    '  command streamlit "$@"',
    '}',
    'EOF',
    'exec /bin/bash --rcfile /tmp/cubi-terminal-rc -i',
  ].join('\n')
  const args = ['run', '--rm', '-i']
  if (useTty) args.push('-t')

  args.push(
    '--name', runtime.containerName,
    '--hostname', 'cubi-sandbox',
    '--memory', config.dockerSandbox.memory || '512m',
    '--memory-swap', config.dockerSandbox.memory || '512m',
    '--cpus', String(config.dockerSandbox.cpus || '1.0'),
    '--pids-limit', String(config.dockerSandbox.pidsLimit || 128),
    '--ulimit', 'nofile=1024:1024',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true',
    '--read-only',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m',
    '--user', 'sandbox',
    '-e', 'HOME=/tmp/home',
    '-e', 'TMPDIR=/tmp',
    '-e', 'TEMP=/tmp',
    '-e', 'TMP=/tmp',
    '-e', 'XDG_CACHE_HOME=/tmp/cache',
    '-e', 'XDG_RUNTIME_DIR=/tmp/runtime-sandbox',
    '-e', 'PYTHONDONTWRITEBYTECODE=1',
    '-e', 'PIP_NO_CACHE_DIR=1',
    '-e', 'TERM=xterm-256color',
    '-e', 'SHELL=/bin/bash',
    '-e', 'HISTFILE=/tmp/home/.bash_history',
    '-e', 'PS1=[sandbox] \\w $ '
  )

  // Human Sandbox terminal exposes exactly one high random application port.
  // Host and container use the SAME port so the URL printed by Flask/FastAPI/Node
  // can be opened directly from Windows without a separate port-mapping toolbar.
  if (Number.isFinite(Number(runtime.appPort)) && Number(runtime.appPort) > 0) {
    args.push(
      '-p', `127.0.0.1:${runtime.appPort}:${runtime.appPort}`,
      '-e', `PORT=${runtime.appPort}`,
      '-e', `CUBI_APP_PORT=${runtime.appPort}`,
      '-e', 'FLASK_RUN_HOST=0.0.0.0',
      '-e', `FLASK_RUN_PORT=${runtime.appPort}`,
      '-e', 'STREAMLIT_SERVER_ADDRESS=0.0.0.0',
      '-e', `STREAMLIT_SERVER_PORT=${runtime.appPort}`,
      '-e', 'STREAMLIT_SERVER_HEADLESS=true',
      '-e', 'STREAMLIT_BROWSER_GATHER_USAGE_STATS=false'
    )
  }

  // X11 is a human-terminal-only capability. AI execution sandboxes keep using
  // dockerSandbox.networkDisabled and are not changed by this setting.
  if (config.terminal.x11Enabled) {
    args.push(
      '--network', config.terminal.network || 'bridge',
      '-e', `DISPLAY=${config.terminal.x11Display || 'host.docker.internal:0.0'}`,
      '-e', 'QT_X11_NO_MITSHM=1',
      '-e', 'GDK_BACKEND=x11'
    )
  } else if (config.dockerSandbox.networkDisabled) {
    args.push('--network', 'none')
  }

  // Only the project workspace is exposed to the container. The host root,
  // Docker socket, backend source and user profile are never mounted.
  args.push(
    '-v', `${runtime.hostWorkspace}:/workspace:rw`,
    '-w', '/workspace',
    runtime.image,
    '/bin/bash',
    '-lc',
    startupScript
  )

  return args
}

function randomSandboxAppPort() {
  const min = Math.max(1024, Number(config.terminal.appPortMin || 20000))
  const max = Math.min(65535, Number(config.terminal.appPortMax || 59999))
  const low = Math.min(min, max)
  const high = Math.max(min, max)
  return randomInt(low, high + 1)
}

function isLocalPortAvailable(port) {
  return new Promise(resolve => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolve(true))
    })
  })
}

async function findAvailableSandboxAppPort(maxAttempts = 40) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const port = randomSandboxAppPort()
    if (await isLocalPortAvailable(port)) return port
  }
  throw new Error('無法取得可用的隨機應用 Port，請稍後再試')
}

function resolveSandboxTerminal(options = {}) {
  const projectName = validProjectName(options.projectName || '')
  const hostWorkspace = ensureWorkspaceDir(projectName)
  const runtime = {
    mode: 'sandbox',
    profile: 'docker',
    label: 'Docker Sandbox',
    scope: 'container',
    file: dockerExecutable(),
    shell: '/bin/bash',
    hostWorkspace,
    workspace: '/workspace',
    image: config.dockerSandbox.image,
    network: config.terminal.x11Enabled
      ? (config.terminal.network || 'bridge')
      : (config.dockerSandbox.networkDisabled ? 'none' : 'bridge'),
    x11Enabled: Boolean(config.terminal.x11Enabled),
    display: config.terminal.x11Enabled ? config.terminal.x11Display : '',
    appPort: Number(options.appPort || 0) > 0 ? Number(options.appPort) : randomSandboxAppPort(),
    projectName: projectName || path.basename(hostWorkspace),
    containerName: `cubi-terminal-${randomUUID().slice(0, 10)}`,
  }
  runtime.args = sandboxDockerArgs(runtime, true)
  return runtime
}

function getSandboxTerminalStatus(options = {}) {
  const runtime = resolveSandboxTerminal(options)
  const docker = dockerStatus()
  const ready = Boolean(pty) && docker.ok
  const status = !pty ? 'node_pty_missing' : docker.status

  return {
    ok: ready,
    status,
    mode: 'sandbox',
    scope: 'container',
    profile: 'docker',
    label: runtime.label,
    workspace: runtime.workspace,
    host_workspace: runtime.hostWorkspace,
    project_name: runtime.projectName,
    shell: runtime.shell,
    image: runtime.image,
    network: runtime.network,
    x11_enabled: runtime.x11Enabled,
    display: runtime.display,
    app_port: runtime.appPort,
    socket_path: config.terminal.socketPath,
    message: !pty
      ? `node-pty 尚未安裝或載入失敗：${ptyLoadError?.message || 'unknown error'}`
      : docker.ok
        ? 'Docker Sandbox terminal ready. Commands execute only inside the isolated container.'
        : `Docker Sandbox 未就緒：${docker.message || docker.status}`,
  }
}

function getTerminalStatus() {
  const sandbox = getSandboxTerminalStatus()
  return {
    ...sandbox,
    socket_path: config.terminal.socketPath,
    default_mode: 'sandbox',
    modes: { sandbox },
  }
}

function selectTerminalMode() {
  // The web terminal intentionally has no host mode. Every request is forced
  // into Docker Sandbox, even if an old client sends cmd/host/powershell.
  return 'sandbox'
}

function writeTerminalInput(term, data = '') {
  if (!term) return
  if (typeof term.write === 'function') {
    term.write(String(data || ''))
  } else if (term.stdin?.writable) {
    term.stdin.write(String(data || '').replace(/\r/g, '\n'))
  }
}

function removeSandboxContainer(containerName = '') {
  const safeName = validContainerName(containerName)
  if (!safeName) return
  try {
    const child = spawn(dockerExecutable(), ['rm', '-f', safeName], {
      stdio: 'ignore',
      windowsHide: true,
      detached: false,
      shell: false,
    })
    child.unref?.()
  } catch {}
}

function shouldForceKillTerminalSession(reason = '') {
  return !String(reason || '').startsWith('workspace_')
}

function stopTerminalSession(id, item = {}, reason = 'stopped') {
  activeSessions.delete(id)
  try {
    writeTerminalInput(item.term, 'exit\r')
  } catch {}
  removeSandboxContainer(item.runtime?.containerName)
  if (shouldForceKillTerminalSession(reason)) {
    try {
      item.term?.kill?.()
    } catch {}
  }
  try {
    item.socket?.emit?.('terminal:exit', {
      code: null,
      signal: 'SIGTERM',
      reason,
    })
  } catch {}
}

function stopAllTerminalSessions(reason = 'workspace_deleted') {
  const stopped = []
  for (const [id, item] of activeSessions.entries()) {
    stopTerminalSession(id, item, reason)
    stopped.push(id)
  }
  return stopped
}

function writeWelcome(socket, runtime) {
  socket.emit('terminal:data', [
    '\r\n\x1b[36mCubi Docker Sandbox Terminal\x1b[0m',
    '\r\n執行位置：Docker 隔離容器（不是 Windows CMD、PowerShell 或主機 Bash）',
    `\r\n容器：${runtime.containerName}`,
    `\r\n映像：${runtime.image}`,
    `\r\nShell：${runtime.shell}`,
    `\r\n專案：${runtime.projectName}`,
    `\r\n工作目錄：${runtime.workspace}`, 
    `\r\n網路：${runtime.network}`,
    runtime.x11Enabled
      ? `\r\nGUI/X11：啟用（DISPLAY=${runtime.display}；程式仍在 Docker Sandbox 執行）`
      : '\r\nGUI/X11：停用',
    '\r\n主機只掛載專案資料夾到 /workspace；沒有掛載主機磁碟根目錄或 Docker socket。',
    '\r\n----------------------------------------\r\n',
  ].join(''))
}

function extractOpenableTerminalUrls(text = '', runtime = {}) {
  const port = Number(runtime.appPort || 0)
  if (!port) return []
  const cleaned = String(text || '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
  const urls = []
  const pattern = /https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)(?:\/[^\s'"<>\x00-\x1f\x7f]*)?/gi
  for (const match of cleaned.matchAll(pattern)) {
    if (Number(match[1]) === port) urls.push(match[0])
  }
  return [...new Set(urls)]
}

function startTerminalSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    path: config.terminal.socketPath,
  })

  io.on('connection', socket => {
    let term = null
    let sessionId = null
    const openedTerminalUrls = new Set()
    let terminalUrlBuffer = ''

    socket.emit('terminal:status', getTerminalStatus())

    socket.on('terminal:start', async payload => {
      // A workspace switch can stop the container from outside this socket
      // while Socket.IO itself remains connected. Clear that stale PTY handle
      // so the same web terminal can start a fresh Sandbox for the new project.
      if (term && sessionId && !activeSessions.has(sessionId)) {
        term = null
        sessionId = null
      }
      if (term) return
      selectTerminalMode(payload?.mode)

      let status
      try {
        status = getSandboxTerminalStatus({ projectName: payload?.project_name || '' })
      } catch (error) {
        const message = error.message || '無法解析目前專案的 Sandbox 工作區'
        socket.emit('terminal:data', `\r\n[終端機啟動失敗] ${message}\r\n`)
        socket.emit('terminal:exit', { code: 1, signal: null, reason: message })
        return
      }
      if (!status.ok) {
        const message = status.message || status.status || 'Docker Sandbox 未就緒'
        socket.emit('terminal:data', `\r\n[終端機啟動失敗] ${message}\r\n`)
        socket.emit('terminal:exit', { code: 1, signal: null, reason: message })
        return
      }

      let runtime
      try {
        const appPort = await findAvailableSandboxAppPort()
        runtime = resolveSandboxTerminal({ projectName: payload?.project_name || '', appPort })
      } catch (error) {
        const message = error.message || '無法取得隨機應用 Port'
        socket.emit('terminal:data', `\r\n[終端機啟動失敗] ${message}\r\n`)
        socket.emit('terminal:exit', { code: 1, signal: null, reason: message })
        return
      }
      sessionId = randomUUID()

      try {
        term = pty.spawn(runtime.file, runtime.args, {
          name: 'xterm-256color',
          cols: Math.max(20, Number(payload?.cols || config.terminal.cols || 100)),
          rows: Math.max(8, Number(payload?.rows || config.terminal.rows || 30)),
          cwd: config.projectRoot,
          env: {
            ...process.env,
            TERM: 'xterm-256color',
            CUBI_TERMINAL_MODE: 'sandbox',
            CUBI_PROJECT_ROOT: config.projectRoot,
          },
        })
      } catch (error) {
        removeSandboxContainer(runtime.containerName)
        socket.emit('terminal:data', `\r\n[終端機啟動失敗] ${error.message}\r\n`)
        socket.emit('terminal:exit', { code: 1, signal: null, reason: error.message })
        return
      }

      activeSessions.set(sessionId, {
        socketId: socket.id,
        socket,
        term,
        runtime,
        startedAt: new Date().toISOString(),
      })

      socket.emit('terminal:started', {
        session_id: sessionId,
        runtime: 'sandbox',
        scope: 'container',
        profile: runtime.profile,
        label: runtime.label,
        workspace: runtime.workspace,
        host_workspace: runtime.hostWorkspace,
        project_name: runtime.projectName,
        shell: runtime.shell,
        image: runtime.image,
        network: runtime.network,
        x11_enabled: runtime.x11Enabled,
        display: runtime.display,
        app_port: runtime.appPort,
        container_name: runtime.containerName,
      })
      writeWelcome(socket, runtime)

      term.onData(data => {
        const text = String(data || '')
        socket.emit('terminal:data', text)
        terminalUrlBuffer = `${terminalUrlBuffer}${text}`.slice(-4000)
        for (const url of extractOpenableTerminalUrls(terminalUrlBuffer, runtime)) {
          if (openedTerminalUrls.has(url)) continue
          openedTerminalUrls.add(url)
          socket.emit('terminal:open-url', { url, source: 'sandbox_terminal', app_port: runtime.appPort })
        }
      })
      term.onExit(event => {
        const item = sessionId ? activeSessions.get(sessionId) : null
        if (item) {
          activeSessions.delete(sessionId)
          removeSandboxContainer(runtime.containerName)
          socket.emit('terminal:exit', event)
        }
        // stopAllTerminalSessions() may already have removed the session and
        // emitted terminal:exit. Always clear the local PTY reference anyway.
        term = null
        sessionId = null
      })
    })

    socket.on('terminal:input', data => {
      writeTerminalInput(term, data)
    })

    socket.on('terminal:openStartCommand', payload => {
      // Kept for older frontends, but the command is sent into the container.
      // It is never interpreted by Windows cmd.exe on the host.
      const command = typeof payload === 'string' ? payload : payload?.command
      writeTerminalInput(term, `${String(command || '').trim()}\r`)
    })

    socket.on('terminal:resize', size => {
      if (!term || typeof term.resize !== 'function') return
      const cols = Math.max(20, Number(size?.cols || config.terminal.cols || 100))
      const rows = Math.max(8, Number(size?.rows || config.terminal.rows || 30))
      try { term.resize(cols, rows) } catch {}
    })

    socket.on('terminal:stop', () => {
      if (sessionId && activeSessions.has(sessionId)) {
        stopTerminalSession(sessionId, activeSessions.get(sessionId), 'user_stopped')
      } else {
        try { term?.kill?.() } catch {}
      }
      term = null
    })

    socket.on('disconnect', () => {
      if (sessionId && activeSessions.has(sessionId)) {
        stopTerminalSession(sessionId, activeSessions.get(sessionId), 'socket_disconnected')
      } else {
        try { term?.kill?.() } catch {}
      }
      term = null
    })
  })

  return io
}

function listTerminalSessions() {
  return Array.from(activeSessions.entries()).map(([id, item]) => ({
    id,
    socketId: item.socketId,
    runtime: {
      mode: item.runtime.mode,
      scope: item.runtime.scope,
      profile: item.runtime.profile,
      label: item.runtime.label,
      workspace: item.runtime.workspace,
      host_workspace: item.runtime.hostWorkspace,
      shell: item.runtime.shell,
      image: item.runtime.image,
      network: item.runtime.network,
      x11_enabled: item.runtime.x11Enabled,
      display: item.runtime.display,
      app_port: item.runtime.appPort,
      container_name: item.runtime.containerName,
    },
    startedAt: item.startedAt,
  }))
}

module.exports = {
  startTerminalSocket,
  getTerminalStatus,
  listTerminalSessions,
  stopAllTerminalSessions,
  selectTerminalMode,
  sandboxDockerArgs,
  resolveSandboxTerminal,
  resolveTerminalWorkspace,
  shouldForceKillTerminalSession,
  randomSandboxAppPort,
  findAvailableSandboxAppPort,
  extractOpenableTerminalUrls,
}
