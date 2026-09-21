<template>
  <div class="sandbox-terminal-shell" @wheel="handleTerminalWheel">
    <div class="sandbox-terminal-toolbar">
      <div>
        <b>終端機</b>
        <span>{{ statusText }}</span>
      </div>
      <div class="sandbox-terminal-actions">
        <a
          v-if="activeAppUrl"
          :href="activeAppUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="terminal-preview-btn"
          title="在瀏覽器新視窗開啟服務"
        >
          🚀 點此開啟網頁應用
        </a>
        <span class="terminal-mode-badge">Docker Sandbox</span>
        <label class="terminal-follow-toggle" title="關閉後，終端機輸出不會把外層畫面一直往下捲">
          <input v-model="followOutput" type="checkbox" />
          自動跟隨
        </label>
        <button type="button" :disabled="connected" @click="connectTerminal">啟動終端機</button>
        <button type="button" :disabled="!connected" @click="stopTerminal">停止</button>
        <button type="button" @click="clearTerminal">清除</button>
      </div>
    </div>

    <div class="sandbox-terminal-meta">
      <span>執行環境：{{ selectedModeLabel }}</span>
      <span>工作目錄：{{ selectedTerminalStatus.workspace || '-' }}</span>
      <span v-if="selectedTerminalStatus.host_workspace">主機資料夾：{{ selectedTerminalStatus.host_workspace }}</span>
      <span>Shell：{{ selectedTerminalStatus.shell || '-' }}</span>
      <span v-if="selectedTerminalStatus.mode === 'sandbox'">網路：{{ selectedTerminalStatus.network || 'none' }}</span>
      <span v-if="selectedTerminalStatus.x11_enabled" :class="{ 'xserver-ready': xServerReady, 'xserver-missing': !xServerReady }">
        X Server：{{ xServerText }}
      </span>
      <button
        v-if="selectedTerminalStatus.x11_enabled && !xServerReady"
        type="button"
        class="xserver-start-btn"
        :disabled="xServerBusy || !xServerStatus.start_supported"
        :title="xServerStatus.message || '啟動 Windows X Server'"
        @click="startXServer"
      >
        {{ xServerBusy ? '啟動中...' : '啟動 X Server' }}
      </button>
      <a
        v-if="activeAppUrl"
        :href="activeAppUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="terminal-preview-chip"
        title="點此在瀏覽器開啟服務"
      >
        <span class="live-pulse-dot">●</span> <b>服務已啟動：{{ activeAppUrl }}</b> (點此開啟) ↗
      </a>
    </div>

    <div
      ref="terminalRef"
      class="sandbox-terminal-view"
    ></div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { io } from 'socket.io-client'
import '@xterm/xterm/css/xterm.css'
import { apiGet, apiPost, getApiBaseUrl } from '../api/client'

const props = defineProps({
  projectName: { type: String, default: '' },
  currentFile: { type: String, default: '' },
  currentContent: { type: String, default: '' },
  files: { type: Array, default: () => [] },
  initialCommand: { type: String, default: '' },
  initialWorkspaceId: { type: String, default: 'default-project' },
  autoStart: { type: Boolean, default: false },
})

const terminalRef = ref(null)
const connected = ref(false)
const terminalStarted = ref(false)
const mounted = ref(false)
const runtimeLabel = ref('尚未啟動')
const terminalMode = ref('sandbox')
const terminalStatus = ref({})
const xServerStatus = ref({})
const xServerBusy = ref(false)
const activeAppUrl = ref('')
let xServerPollTimer = null
const lastAutoCommand = ref('')
const preferredPythonPath = ref('')
// 預設開啟自動跟隨，確保按 Enter 後能看到最新輸出
const followOutput = ref(true)
const socketPath = computed(() => terminalStatus.value.socket_path || '/socket.io')
const selectedTerminalStatus = computed(() => {
  const modes = terminalStatus.value.modes || {}
  return modes[terminalMode.value] || terminalStatus.value || {}
})
function terminalModeLabel(mode) {
  return 'Docker Sandbox'
}

const selectedModeLabel = computed(() => terminalModeLabel(terminalMode.value))
const commandTargetLabel = computed(() => 'Docker Sandbox')
const xServerReady = computed(() => Boolean(xServerStatus.value?.reachable))
const xServerText = computed(() => {
  const status = xServerStatus.value || {}
  if (status.reachable) return `已連線 ${status.host || '127.0.0.1'}:${status.port || 6000}`
  if (status.installed) return '未啟動'
  return '未安裝'
})
const normalizedCurrentFile = computed(() => normalizePath(props.currentFile))
const projectFiles = computed(() => (props.files || [])
  .map(item => ({
    path: normalizePath(item?.path || item?.file_path || ''),
    type: item?.type || 'file',
  }))
  .filter(item => item.path)
)
const projectPathSet = computed(() => new Set(projectFiles.value.map(item => item.path)))
const pythonEntryCandidates = computed(() => {
  const pythonFiles = projectFiles.value
    .filter(item => item.type !== 'folder' && /\.py$/i.test(item.path))
    .map(item => item.path)
  const unique = [...new Set(pythonFiles)]
  const current = normalizedCurrentFile.value
  const priority = path => {
    const name = path.split('/').pop().toLowerCase()
    if (preferredPythonPath.value && path === preferredPythonPath.value) return -30
    if (current && path === current) return -25
    if (name === 'app.py') return -20
    if (name === 'main.py') return -15
    if (name === 'server.py') return -10
    return 0
  }
  return unique
    .sort((left, right) => priority(left) - priority(right) || left.localeCompare(right))
    .map(path => ({ path, command: commandWithRuntimePort(commandForPythonEntry(path)) }))
})
const pythonRunHint = computed(() => {
  const first = pythonEntryCandidates.value[0]
  if (!first) return null
  if (isTkinterPythonEntry(first.path)) return null
  const opensUrl = isSandboxLaunchCommand(first.command)
  if (!opensUrl) return null
  return {
    file: first.path,
    command: first.command,
    opensUrl,
  }
})
const statusText = computed(() => {
  const status = selectedTerminalStatus.value
  if (connected.value) return `執行中，指令會送到 ${commandTargetLabel.value}`
  if (status.status === 'node_pty_missing') return '後端尚未安裝 node-pty'
  if (status.status === 'missing_cli') return '找不到 Docker CLI'
  if (status.status === 'image_missing_or_daemon_down') return 'Docker Sandbox 映像不存在或 Docker Desktop 尚未啟動'
  if (status.status && status.status !== 'ready') return status.message || status.status
  return status.status || 'ready'
})

let term = null
let fitAddon = null
let socket = null
let resizeObserver = null
let terminalInputMode = 'detect'
let pendingStartLine = ''
let terminalCommandLine = ''
let pendingPreviewWindow = null
let pendingPreviewTimer = null

const START_COMMAND_PREFIX = 'start '

function normalizePath(path = '') {
  return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '')
}

function shellQuote(value = '') {
  const text = String(value || '')
  return /^[A-Za-z0-9_./-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`
}

function commandForPythonEntry(path = '') {
  const normalized = normalizePath(path)
  const source = pythonSourceForPath(normalized)
  if (isTkinterPythonSource(source)) return `python3 ${shellQuote(normalized)}`
  if (isStreamlitPythonSource(source)) return `streamlit run ${shellQuote(normalized)} --server.address=0.0.0.0 --server.port=$PORT --server.headless=true --browser.gatherUsageStats=false`
  if (isWebPythonSource(source)) return `flask run ${shellQuote(normalized)}`
  const hasFlaskStructure = projectPathSet.value.has('templates/index.html') || projectFiles.value.some(item => item.path.startsWith('templates/'))
  if (hasFlaskStructure) return `flask run ${shellQuote(normalized)}`
  return `python3 ${shellQuote(normalized)}`
}

function commandWithRuntimePort(command = '') {
  const port = Number(selectedTerminalStatus.value?.app_port || 0)
  if (!Number.isFinite(port) || port <= 0) return command
  return String(command || '').replace(/\$PORT\b/g, String(port))
}

function pythonSourceForPath(path = '') {
  const normalized = normalizePath(path)
  if (normalized && normalized === normalizedCurrentFile.value && props.currentContent) {
    return String(props.currentContent)
  }
  const match = (props.files || []).find(item => normalizePath(item.path || item.file_path || '') === normalized)
  if (match?.content) return String(match.content)
  return normalized && normalized === normalizedCurrentFile.value ? String(props.currentContent || '') : ''
}

function isTkinterPythonSource(source = '') {
  return /\bimport\s+tkinter\b|\bfrom\s+tkinter\s+import\b|\bTk\s*\(/.test(String(source || ''))
}

function isWebPythonSource(source = '') {
  return /\bfrom\s+flask\s+import\b|\bimport\s+flask\b|\bFlask\s*\(|\bFastAPI\s*\(|\buvicorn\.run\s*\(/.test(String(source || ''))
}

function isStreamlitPythonSource(source = '') {
  return /\bimport\s+streamlit\b|\bfrom\s+streamlit\s+import\b|\bst\./.test(String(source || ''))
}

function isTkinterPythonEntry(path = '') {
  return isTkinterPythonSource(pythonSourceForPath(path))
}

function selectSuggestedPython(path = '') {
  preferredPythonPath.value = normalizePath(path)
}

function sendSuggestedCommand() {
  const command = pythonRunHint.value?.command
  if (!command || !socket?.connected) return
  followOutput.value = true
  prepareTerminalPreviewWindow(command)
  term?.writeln(`\r\n[manual hint] ${command}\r\n`)
  socket.emit('terminal:input', `${command}\r`)
}

async function copySuggestedCommand() {
  const command = pythonRunHint.value?.command
  if (!command) return
  try {
    await navigator.clipboard?.writeText(command)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = command
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    try { document.execCommand('copy') } catch {}
    textarea.remove()
  }
}

function writeLine(message = '') {
  if (!term) return
  term.writeln(String(message).replace(/\n/g, '\r\n'))
}

function fitTerminal() {
  if (!term || !fitAddon || !terminalRef.value) return
  if (!terminalRef.value.clientWidth || !terminalRef.value.clientHeight) return
  try {
    fitAddon.fit()
    socket?.emit('terminal:resize', { cols: term.cols, rows: term.rows })
  } catch {}
}

async function loadTerminalStatus() {
  try {
    terminalStatus.value = await apiGet('/api/terminal/status')
    terminalMode.value = terminalStatus.value.default_mode || terminalStatus.value.mode || 'sandbox'
    if (selectedTerminalStatus.value?.x11_enabled) await loadXServerStatus()
  } catch (error) {
    terminalStatus.value = { status: 'api_error', message: error.message, workspace: '-' }
    writeLine(`[terminal status error] ${error.message}`)
  }
}

async function loadXServerStatus() {
  try {
    xServerStatus.value = await apiGet('/api/terminal/xserver/status')
  } catch (error) {
    xServerStatus.value = { status: 'api_error', reachable: false, message: error.message }
  }
}

async function startXServer() {
  if (xServerBusy.value) return
  xServerBusy.value = true
  try {
    const status = await apiPost('/api/terminal/xserver/start', {})
    xServerStatus.value = status
    writeLine(`\r\n[xserver] ${status.message || (status.reachable ? 'X Server ready' : 'X Server not ready')}`)
  } catch (error) {
    xServerStatus.value = { status: 'api_error', reachable: false, message: error.message }
    writeLine(`\r\n[xserver error] ${error.message}`)
  } finally {
    xServerBusy.value = false
  }
}

function initXterm() {
  if (term) return
  if (!terminalRef.value) return
  term = new Terminal({
    cursorBlink: true,
    scrollback: 8000,
    scrollOnUserInput: true,
    smoothScrollDuration: 0,
    fontSize: 14,
    fontFamily: "Consolas, 'Cascadia Mono', 'Courier New', monospace",
    theme: {
      background: '#0f172a',
      foreground: '#e5e7eb',
      cursor: '#ffffff',
      selectionBackground: '#334155',
    },
  })
  fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.open(terminalRef.value)
  term.writeln(`Cubi ${selectedModeLabel.value} 尚未啟動。按「啟動終端機」。`)
  term.onData(handleTerminalInput)
  nextTick(fitTerminal)
}

function resetTerminalInputDetection() {
  terminalInputMode = 'detect'
  pendingStartLine = ''
}

function isPrintableTerminalInput(text = '') {
  return /^[\t\x20-\x7e]$/.test(text)
}

function isTerminalFocusSequence(text = '') {
  return text === '\u001b[I' || text === '\u001b[O'
}

function isTerminalEscapeSequence(text = '') {
  return String(text || '').startsWith('\u001b')
}

function isSandboxLaunchCommand(command = '') {
  const text = String(command || '').trim()
  if (/^(?:flask\s+run\s+.+\.py|streamlit\s+run\s+.+\.py(?:\s+.*)?|start\s+.+\.html?|open\s+.+\.html?)$/i.test(text)) return true
  const pythonMatch = text.match(/^python3?\s+(.+\.py)$/i)
  if (!pythonMatch) return false
  const path = normalizePath(pythonMatch[1].replace(/^['"]|['"]$/g, ''))
  return isWebPythonSource(pythonSourceForPath(path))
}

function prepareTerminalPreviewWindow(command = '') {
  if (!isSandboxLaunchCommand(command)) return
  try {
    if (pendingPreviewWindow && !pendingPreviewWindow.closed) return
    pendingPreviewWindow = window.open('about:blank', '_blank')
    pendingPreviewWindow?.document?.write?.('<!doctype html><title>Cubi Preview</title><body style="font-family:sans-serif;padding:24px">正在等待 Docker Sandbox 啟動網址...</body>')
    window.clearTimeout(pendingPreviewTimer)
    pendingPreviewTimer = window.setTimeout(() => {
      if (pendingPreviewWindow && !pendingPreviewWindow.closed && pendingPreviewWindow.location.href === 'about:blank') {
        pendingPreviewWindow.close()
      }
      pendingPreviewWindow = null
    }, 30000)
  } catch {
    pendingPreviewWindow = null
  }
}

function openTerminalPreviewUrl(url = '') {
  const target = String(url || '').trim()
  if (!/^https?:\/\/(?:127\.0\.0\.1|localhost):\d+/i.test(target)) return
  activeAppUrl.value = target
  window.clearTimeout(pendingPreviewTimer)
  try {
    if (pendingPreviewWindow && !pendingPreviewWindow.closed) {
      pendingPreviewWindow.location.href = target
      pendingPreviewWindow = null
      return
    }
  } catch {
    pendingPreviewWindow = null
  }
  try {
    const opened = window.open(target, '_blank')
    if (opened) return
  } catch {}
  writeLine(`\r\n[open] ${target}`)
}

function trackTerminalCommandInput(text = '') {
  for (const char of String(text || '')) {
    if (char === '\u007f' || char === '\b') {
      terminalCommandLine = terminalCommandLine.slice(0, -1)
      continue
    }
    if (char === '\r' || char === '\n') {
      prepareTerminalPreviewWindow(terminalCommandLine)
      terminalCommandLine = ''
      continue
    }
    if (char >= ' ' && char !== '\u007f') {
      terminalCommandLine += char
    }
  }
}

function flushPendingDetectionText() {
  if (terminalInputMode === 'detect' && pendingStartLine) {
    socket?.emit('terminal:input', pendingStartLine)
  }
  resetTerminalInputDetection()
}

function sendPendingStartLineToTerminal(newline = '\r') {
  const command = pendingStartLine.trim()
  if (terminalInputMode === 'start' && command) {
    prepareTerminalPreviewWindow(command)
    socket?.emit('terminal:input', `${command}${newline}`)
    resetTerminalInputDetection()
    return
  }
  if (terminalInputMode === 'detect' && pendingStartLine) {
    socket?.emit('terminal:input', pendingStartLine)
  }
  socket?.emit('terminal:input', newline.includes('\n') && !newline.includes('\r') ? '\n' : '\r')
  resetTerminalInputDetection()
}

function handleTerminalInputChunk(text = '') {
  for (const char of String(text || '')) {
    if (char === '\u007f' || char === '\b') {
      if (terminalInputMode === 'start' && pendingStartLine) {
        pendingStartLine = pendingStartLine.slice(0, -1)
        term?.write('\b \b')
        continue
      }
      if (terminalInputMode === 'detect' && pendingStartLine) {
        pendingStartLine = pendingStartLine.slice(0, -1)
        continue
      }
      socket?.emit('terminal:input', char)
      continue
    }

    if (!isPrintableTerminalInput(char)) {
      if (terminalInputMode === 'detect' && pendingStartLine) {
        socket?.emit('terminal:input', pendingStartLine)
      }
      resetTerminalInputDetection()
      socket?.emit('terminal:input', char)
      continue
    }

    if (terminalInputMode === 'start') {
      pendingStartLine += char
      term?.write(char)
      continue
    }

    if (terminalInputMode === 'detect') {
      const nextLine = pendingStartLine + char
      const nextLower = nextLine.toLowerCase()
      if (START_COMMAND_PREFIX.startsWith(nextLower)) {
        pendingStartLine = nextLine
        if (nextLower === START_COMMAND_PREFIX) {
          terminalInputMode = 'start'
          term?.write(pendingStartLine)
        }
        continue
      }
      socket?.emit('terminal:input', nextLine)
      terminalInputMode = 'passthrough'
      pendingStartLine = ''
      continue
    }

    socket?.emit('terminal:input', char)
  }
}

function handleTerminalInput(data = '') {
  if (!socket?.connected) return
  const text = String(data || '')
  if (isTerminalFocusSequence(text)) return
  if (isTerminalEscapeSequence(text)) {
    flushPendingDetectionText()
    socket.emit('terminal:input', text)
    return
  }
  trackTerminalCommandInput(text)
  flushPendingDetectionText()
  socket.emit('terminal:input', text)
}

function runInitialCommandIfReady() {
  const command = String(props.initialCommand || '').trim()
  if (!props.autoStart || !command || !term || !socket?.connected || !terminalStarted.value) return
  if (lastAutoCommand.value === command) return
  lastAutoCommand.value = command
  followOutput.value = true
  term.writeln(`\r\n[auto] ${command}\r\n`)
  socket.emit('terminal:input', `${command}\r`)
}

function emitTerminalStart() {
  if (!socket?.connected || terminalStarted.value) return
  connected.value = true
  runtimeLabel.value = '啟動中...'
  socket.emit('terminal:start', {
    mode: terminalMode.value,
    workspace_id: props.initialWorkspaceId || 'default-project',
    project_name: props.projectName || '',
    cols: term?.cols || 100,
    rows: term?.rows || 30,
  })
}

function connectTerminal() {
  initXterm()
  // A project switch stops the old Docker container but Socket.IO can remain
  // connected. Reuse that socket to start a fresh container for the new project.
  if (socket?.connected) {
    emitTerminalStart()
    return
  }

  const apiBase = getApiBaseUrl()
  socket = io(apiBase, {
    path: socketPath.value,
    transports: ['websocket', 'polling'],
    withCredentials: true,
  })

  socket.on('connect', () => {
    connected.value = true
    terminalStarted.value = false
    emitTerminalStart()
  })

  socket.on('terminal:status', data => {
    terminalStatus.value = {
      ...terminalStatus.value,
      ...data,
      modes: {
        ...(terminalStatus.value.modes || {}),
        ...(data?.modes || {}),
      },
    }
  })

  socket.on('terminal:started', data => {
    terminalStarted.value = true
    const mode = data.runtime || terminalMode.value
    terminalMode.value = 'sandbox'
    runtimeLabel.value = mode
    const startedStatus = {
      ...selectedTerminalStatus.value,
      mode: 'sandbox',
      status: 'ready',
      ok: true,
      scope: data.scope || 'server',
      workspace: data.workspace || selectedTerminalStatus.value.workspace,
      host_workspace: data.host_workspace || selectedTerminalStatus.value.host_workspace,
      project_name: data.project_name || props.projectName || selectedTerminalStatus.value.project_name,
      shell: data.shell || selectedTerminalStatus.value.shell,
      image: data.image || selectedTerminalStatus.value.image,
      network: data.network || selectedTerminalStatus.value.network,
      app_port: data.app_port || selectedTerminalStatus.value.app_port || 0,
    }
    terminalStatus.value = {
      ...terminalStatus.value,
      ...startedStatus,
    modes: {
        ...(terminalStatus.value.modes || {}),
        sandbox: startedStatus,
      },
    }
    runInitialCommandIfReady()
  })

  socket.on('terminal:data', data => {
    if (!term) return
    const text = String(data || '')
    const previousViewport = term.buffer?.active?.viewportY || 0
    term.write(text, () => {
      if (followOutput.value) {
        term.scrollToBottom()
      } else {
        // 固定目前視窗位置，避免輸出錯誤訊息時整個畫面一直被推到最下面。
        term.scrollToLine(previousViewport)
      }
    })
  })

  socket.on('terminal:open-url', data => {
    const url = typeof data === 'string' ? data : data?.url
    openTerminalPreviewUrl(url)
  })

  socket.on('terminal:exit', event => {
    connected.value = false
    terminalStarted.value = false
    lastAutoCommand.value = ''
    activeAppUrl.value = ''
    runtimeLabel.value = `已結束 code=${event?.code ?? '-'} signal=${event?.signal ?? '-'}`
    writeLine(`\r\n[terminal exited] code=${event?.code ?? '-'} signal=${event?.signal ?? '-'}`)
  })

  socket.on('connect_error', error => {
    connected.value = false
    terminalStarted.value = false
    activeAppUrl.value = ''
    runtimeLabel.value = '連線失敗'
    writeLine(`[socket error] ${error.message}`)
  })
}

function stopTerminal() {
  activeAppUrl.value = ''
  socket?.emit('terminal:stop')
  socket?.disconnect()
  connected.value = false
  terminalStarted.value = false
  lastAutoCommand.value = ''
  resetTerminalInputDetection()
  runtimeLabel.value = '已停止'
}

function clearTerminal() {
  term?.clear()
  term?.scrollToTop()
}

function handleTerminalWheel(event) {
  const scroller = event.currentTarget?.closest?.('.panel-body-terminal')
  if (!scroller || scroller.scrollHeight <= scroller.clientHeight) return
  scroller.scrollTop += event.deltaY
  event.preventDefault()
}

onMounted(async () => {
  mounted.value = true
  await loadTerminalStatus()
  initXterm()
  resizeObserver = new ResizeObserver(() => window.requestAnimationFrame(fitTerminal))
  if (terminalRef.value) resizeObserver.observe(terminalRef.value)
  if (props.autoStart && String(props.initialCommand || '').trim()) {
    connectTerminal()
  }
  // 每 2 秒自動輪詢 X Server 狀態，開啟或關閉 XLaunch 免按 F5 即自動更新顯示
  xServerPollTimer = setInterval(() => {
    if (selectedTerminalStatus.value?.x11_enabled) {
      loadXServerStatus()
    }
  }, 2000)
})

onBeforeUnmount(() => {
  if (xServerPollTimer) {
    clearInterval(xServerPollTimer)
    xServerPollTimer = null
  }
  resizeObserver?.disconnect()
  window.clearTimeout(pendingPreviewTimer)
  socket?.emit('terminal:stop')
  socket?.disconnect()
  resetTerminalInputDetection()
  term?.dispose()
})

watch(
  () => [props.autoStart, props.initialCommand, props.initialWorkspaceId],
  async () => {
    if (!mounted.value || !props.autoStart || !String(props.initialCommand || '').trim()) return
    terminalMode.value = terminalStatus.value.default_mode || terminalStatus.value.mode || 'sandbox'
    await nextTick()
    initXterm()
    if (socket?.connected) {
      runInitialCommandIfReady()
      return
    }
    connectTerminal()
  }
)
</script>

<style scoped>
.sandbox-terminal-shell {
  height: auto;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: visible;
}
.sandbox-terminal-toolbar,
.sandbox-terminal-meta {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.sandbox-terminal-toolbar {
  position: sticky;
  top: 0;
  z-index: 2;
  align-items: flex-start;
  flex-wrap: wrap;
  background: #fff;
  padding: 0 2px 2px;
}
.sandbox-terminal-toolbar > div:first-child {
  flex: 1 1 240px;
  min-width: 180px;
}
.sandbox-terminal-toolbar b {
  display: block;
  font-size: 15px;
  color: #111827;
}
.sandbox-terminal-toolbar span,
.sandbox-terminal-meta span {
  color: #64748b;
  font-size: 12px;
}
.sandbox-terminal-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex: 1 1 420px;
  justify-content: flex-end;
}
.terminal-follow-toggle {
  height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border: 1px solid #dbe5f3;
  border-radius: 8px;
  background: #fff;
  color: #334155;
  font-size: 12px;
  font-weight: 800;
  user-select: none;
}
.terminal-follow-toggle input {
  margin: 0;
}
.terminal-mode-badge,
.sandbox-terminal-actions button {
  height: 34px;
  border: 1px solid #dbe5f3;
  border-radius: 8px;
  background: #fff;
  padding: 0 10px;
  font-weight: 700;
  color: #1f2937;
}
.terminal-mode-badge {
  display: inline-flex;
  align-items: center;
  min-width: 134px;
}
.sandbox-terminal-actions button:first-of-type {
  background: #155eef;
  border-color: #155eef;
  color: #fff;
}
.sandbox-terminal-actions button:disabled {
  opacity: .55;
}
.sandbox-terminal-meta {
  justify-content: flex-start;
  flex-wrap: wrap;
  padding: 8px 10px;
  border: 1px solid #e6edf7;
  border-radius: 8px;
  background: #f8fbff;
}
.sandbox-terminal-meta .xserver-ready {
  color: #047857;
  font-weight: 800;
}
.sandbox-terminal-meta .xserver-missing {
  color: #b45309;
  font-weight: 800;
}
.xserver-start-btn {
  height: 28px;
  border: 1px solid #f59e0b;
  border-radius: 7px;
  background: #fffbeb;
  color: #92400e;
  padding: 0 9px;
  font-size: 12px;
  font-weight: 800;
}
.xserver-start-btn:disabled {
  opacity: .55;
}
.sandbox-terminal-view {
  flex: 0 0 auto;
  height: 1000px;
  min-height: 1000px;
  border-radius: 10px;
  background: #0f172a;
  border: 1px solid #0f172a;
  padding: 8px;
  overscroll-behavior: contain;
  overflow: hidden;
}
.sandbox-terminal-view :deep(.xterm) {
  height: 100%;
}
.terminal-preview-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #10b981;
  border: 1px solid #059669;
  color: #ffffff !important;
  border-radius: 6px;
  padding: 0 12px;
  height: 32px;
  line-height: 32px;
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(16, 185, 129, 0.25);
  transition: all 0.2s ease;
  animation: pulse-green 2s infinite;
}
.terminal-preview-btn:hover {
  background: #059669;
  transform: translateY(-1px);
}
.terminal-preview-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #ecfdf5;
  border: 1px solid #10b981;
  color: #065f46 !important;
  border-radius: 6px;
  padding: 2px 10px;
  font-size: 12px;
  text-decoration: none;
  font-weight: 600;
  margin-left: 6px;
}
.terminal-preview-chip:hover {
  background: #d1fae5;
}
.live-pulse-dot {
  color: #10b981;
  font-size: 10px;
  animation: pulse-dot 1.5s infinite;
}
@keyframes pulse-green {
  0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.5); }
  50% { box-shadow: 0 0 0 5px rgba(16, 185, 129, 0); }
}
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
</style>

<style>
/* xterm.js 捲軸樣式 (不受 scoped 限制才能正確套用到 ::-webkit-scrollbar) */
.sandbox-terminal-view .xterm-viewport::-webkit-scrollbar {
  width: 12px;
  height: 12px;
}
.sandbox-terminal-view .xterm-viewport::-webkit-scrollbar-thumb {
  background: #334155;
  border-radius: 6px;
  border: 2px solid #0f172a;
}
.sandbox-terminal-view .xterm-viewport::-webkit-scrollbar-track,
.sandbox-terminal-view .xterm-viewport::-webkit-scrollbar-corner {
  background: #0f172a;
}
/* 隱藏不必要的水平捲軸，並在沒內容時隱藏垂直捲軸 */
.sandbox-terminal-view .xterm .xterm-viewport {
  overflow-y: auto !important;
}
</style>
