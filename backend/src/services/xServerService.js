const fs = require('fs')
const net = require('net')
const path = require('path')
const { spawn } = require('child_process')
const config = require('../config')

const XSERVER_PORT = 6000

function unique(values = []) {
  return [...new Set(values.filter(Boolean))]
}

function candidateExecutables() {
  const envPath = String(process.env.CUBI_XSERVER_PATH || '').trim()
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  return unique([
    envPath,
    'D:\\VcXsrv\\vcxsrv.exe',
    'C:\\VcXsrv\\vcxsrv.exe',
    path.join(programFiles, 'VcXsrv', 'vcxsrv.exe'),
    path.join(programFilesX86, 'VcXsrv', 'vcxsrv.exe'),
    path.join(programFiles, 'Xming', 'Xming.exe'),
    path.join(programFilesX86, 'Xming', 'Xming.exe'),
  ])
}

function existingExecutable() {
  return candidateExecutables().find(file => {
    try {
      return fs.existsSync(file) && fs.statSync(file).isFile()
    } catch {
      return false
    }
  }) || ''
}

function isXServerPortOpen(host = '127.0.0.1', port = XSERVER_PORT, timeoutMs = 700) {
  return new Promise(resolve => {
    const socket = new net.Socket()
    let done = false
    const finish = value => {
      if (done) return
      done = true
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}

function xServerArgs(executable = '') {
  const name = path.basename(executable).toLowerCase()
  if (name === 'vcxsrv.exe') {
    return [':0', '-multiwindow', '-clipboard', '-wgl', '-ac', '-listen', 'tcp', '-silent-dup-error']
  }
  if (name === 'xming.exe') {
    return [':0', '-multiwindow', '-clipboard', '-ac']
  }
  return [':0', '-multiwindow', '-clipboard', '-ac']
}

function installHint() {
  return [
    '尚未偵測到 Windows X Server。',
    '請安裝並啟動 VcXsrv、Xming 或 X410；建議 VcXsrv 使用 Multiple windows、Disable access control，並允許防火牆。',
    '啟動後 Docker Sandbox 內的 DISPLAY=host.docker.internal:0.0 才能開 Tkinter 視窗。',
  ].join(' ')
}

async function getXServerStatus() {
  const executable = existingExecutable()
  const reachable = await isXServerPortOpen()
  const enabled = Boolean(config.terminal.x11Enabled)
  return {
    enabled,
    display: config.terminal.x11Display || 'host.docker.internal:0.0',
    host: '127.0.0.1',
    port: XSERVER_PORT,
    reachable,
    installed: Boolean(executable),
    executable,
    candidates: candidateExecutables(),
    start_supported: Boolean(executable),
    status: reachable ? 'ready' : executable ? 'installed_not_running' : 'missing',
    message: reachable
      ? 'Windows X Server 已在 127.0.0.1:6000 回應，Docker Sandbox 可嘗試開啟 Tkinter 視窗。'
      : executable
        ? `已找到 X Server：${executable}，但 127.0.0.1:6000 尚未回應。`
        : installHint(),
  }
}

async function startXServer() {
  const before = await getXServerStatus()
  if (before.reachable) return { ...before, started: false }
  if (!before.executable) {
    return { ...before, ok: false, started: false, message: installHint() }
  }

  try {
    const child = spawn(before.executable, xServerArgs(before.executable), {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: false,
    })
    child.unref?.()
  } catch (error) {
    return { ...before, ok: false, started: false, message: `X Server 啟動失敗：${error.message}` }
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 500))
    const status = await getXServerStatus()
    if (status.reachable) return { ...status, ok: true, started: true }
  }
  const after = await getXServerStatus()
  return {
    ...after,
    ok: false,
    started: true,
    message: `${after.message} 已嘗試啟動，但尚未連上 127.0.0.1:6000；請檢查 X Server 視窗與 Windows 防火牆。`,
  }
}

module.exports = {
  XSERVER_PORT,
  candidateExecutables,
  existingExecutable,
  getXServerStatus,
  startXServer,
  isXServerPortOpen,
}
