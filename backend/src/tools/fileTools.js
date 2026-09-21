const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const config = require('../config')

const skipNames = new Set(['.git', '__pycache__', '.pytest_cache', 'node_modules', 'dist', 'build', '.venv', 'venv'])
const textExt = new Set([
  '.py', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue',
  '.html', '.htm', '.css', '.json', '.md', '.txt', '.sql', '.csv',
  '.yml', '.yaml', '.env', '.gitignore', '.toml', '.ini', '.cfg',
  '.java', '.cs', '.php', '.go', '.rs', '.cpp', '.c', '.h', '.hpp',
  '.xml', '.svg', '.sh', '.bat', '.ps1'
])
const databaseExt = new Set(['.db', '.sqlite', '.sqlite3'])
const imageExt = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
const maxTextFileBytes = 2_000_000
const maxTreeBinaryBytes = 200_000_000

function normalizePath(input) {
  return String(input || '').replace(/\\/g, '/').replace(/^\/+/, '').trim()
}

function resolveSafePath(relPath) {
  const clean = normalizePath(relPath)
  const target = path.resolve(config.sandboxDir, clean)
  const root = path.resolve(config.sandboxDir)
  if (!(target === root || target.startsWith(root + path.sep))) {
    const error = new Error('路徑超出專案工作區')
    error.statusCode = 403
    throw error
  }
  return target
}

function extensionOf(filePath = '') {
  return path.extname(String(filePath || '')).toLowerCase()
}

function isDatabaseFile(filePath = '') {
  return databaseExt.has(extensionOf(filePath))
}

function isImageFile(filePath = '') {
  return imageExt.has(extensionOf(filePath))
}

function imageMimeType(filePath = '') {
  const ext = extensionOf(filePath)
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.webp') return 'image/webp'
  return 'image/png'
}

function isKnownTextExtension(filePath = '') {
  const base = path.basename(filePath)
  if (base === '.env.example' || base === '.env' || base === '.gitignore') return true
  return textExt.has(extensionOf(filePath))
}

function sampleLooksLikeText(filePath) {
  try {
    const stat = fs.statSync(filePath)
    if (stat.size > maxTextFileBytes) return false
    const fd = fs.openSync(filePath, 'r')
    try {
      const length = Math.min(4096, stat.size)
      const buffer = Buffer.alloc(length)
      fs.readSync(fd, buffer, 0, length, 0)
      if (buffer.includes(0)) return false
      const decoded = buffer.toString('utf8')
      const replacementChars = (decoded.match(/�/g) || []).length
      return replacementChars <= Math.max(1, Math.floor(decoded.length * 0.02))
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return false
  }
}

function isLikelyText(filePath) {
  if (isDatabaseFile(filePath)) return false
  if (isKnownTextExtension(filePath)) return true
  return sampleLooksLikeText(filePath)
}

function isEditableTextFile(filePath) {
  return !isDatabaseFile(filePath) && isLikelyText(filePath)
}

function tryRunSqlite(target, command) {
  try {
    const relPath = path.relative(config.sandboxDir, target).replace(/\\/g, '/')
    const dockerArgs = [
      'run', '--rm',
      '-v', `${config.sandboxDir}:/workspace:rw`,
      '-w', '/workspace',
      config.dockerSandbox.image,
      'sqlite3', relPath, command
    ]
    const result = spawnSync('docker', dockerArgs, {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    })
    if (result.error || result.status !== 0) return ''
    return String(result.stdout || '').trim()
  } catch {
    return ''
  }
}

function describeDatabaseFile(filePath) {
  const target = resolveSafePath(filePath)
  if (!fs.existsSync(target)) {
    const error = new Error(`找不到檔案：${filePath}`)
    error.statusCode = 404
    throw error
  }
  const stat = fs.statSync(target)
  const header = Buffer.alloc(Math.min(100, stat.size))
  const fd = fs.openSync(target, 'r')
  try {
    fs.readSync(fd, header, 0, header.length, 0)
  } finally {
    fs.closeSync(fd)
  }
  const isSqlite = header.subarray(0, 16).toString('utf8') === 'SQLite format 3\u0000'
  const tables = isSqlite ? tryRunSqlite(target, '.tables') : ''
  const schema = isSqlite ? tryRunSqlite(target, '.schema') : ''

  return [
    `檔案：${normalizePath(filePath)}`,
    `類型：${isSqlite ? 'SQLite 資料庫檔案（binary）' : '資料庫 / 二進位檔案（binary）'}`,
    `大小：${stat.size.toLocaleString('en-US')} bytes`,
    '',
    '處理方式：',
    '- 此檔案不會以 UTF-8 文字直接送入編輯器或 LLM，避免二進位內容損壞。',
    '- 可用來做檔案分析、資料表結構說明、SQL 查詢 / migration 建議。',
    '- 若要修改資料庫，系統會產生 .sql 腳本或建議步驟，不會把固定範例硬寫進 .db。',
    '',
    schema ? `SQLite schema：\n${schema}` : (isSqlite ? 'SQLite schema：目前環境沒有 sqlite3 CLI 或無法讀取 schema。' : 'schema：非 SQLite 或無法辨識。'),
    tables ? `\n資料表：\n${tables}` : '',
  ].filter(Boolean).join('\n') + '\n'
}

function listProjectTree() {
  const root = config.sandboxDir
  if (!fs.existsSync(root)) return []
  if (!fs.statSync(root).isDirectory()) {
    const error = new Error(`工作區路徑不是資料夾：${root}`)
    error.statusCode = 500
    throw error
  }
  const items = []
  function walk(current) {
    for (const name of fs.readdirSync(current)) {
      if (skipNames.has(name) || name.endsWith('.bak')) continue
      const abs = path.join(current, name)
      const stat = fs.statSync(abs)
      const rel = normalizePath(path.relative(root, abs))
      if (!rel) continue
      if (stat.isDirectory()) {
        items.push({ path: rel, type: 'folder' })
        walk(abs)
      } else if (isDatabaseFile(abs) && stat.size <= maxTreeBinaryBytes) {
        items.push({ path: rel, type: 'file', content_type: 'database' })
      } else if (isImageFile(abs) && stat.size <= maxTreeBinaryBytes) {
        items.push({ path: rel, type: 'file', content_type: 'image' })
      } else if (isLikelyText(abs) && stat.size <= maxTextFileBytes) {
        items.push({ path: rel, type: 'file', content_type: 'text' })
      }
    }
  }
  walk(root)
  return items.sort((a, b) => {
    const pa = a.path.split('/').slice(0, -1).join('/')
    const pb = b.path.split('/').slice(0, -1).join('/')
    if (pa !== pb) return pa.localeCompare(pb)
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.path.localeCompare(b.path)
  })
}

function ensureProjectWorkspace() {
  const root = config.sandboxDir
  fs.mkdirSync(root, { recursive: true })
  return root
}

function readFile(filePath) {
  const target = resolveSafePath(filePath)
  if (!fs.existsSync(target)) {
    const error = new Error(`找不到檔案：${filePath}`)
    error.statusCode = 404
    throw error
  }
  if (fs.statSync(target).isDirectory()) {
    const error = new Error(`不是檔案：${filePath}`)
    error.statusCode = 400
    throw error
  }
  if (isDatabaseFile(target)) return describeDatabaseFile(filePath)
  if (!isLikelyText(target)) {
    const error = new Error(`此檔案看起來不是文字檔，為避免損壞不以文字讀取：${filePath}`)
    error.statusCode = 415
    throw error
  }
  return fs.readFileSync(target, 'utf8')
}

function readImageFile(filePath) {
  const target = resolveSafePath(filePath)
  if (!fs.existsSync(target)) {
    const error = new Error(`找不到檔案：${filePath}`)
    error.statusCode = 404
    throw error
  }
  if (fs.statSync(target).isDirectory()) {
    const error = new Error(`不是檔案：${filePath}`)
    error.statusCode = 400
    throw error
  }
  if (!isImageFile(target)) {
    const error = new Error(`不是支援的圖片檔案：${filePath}`)
    error.statusCode = 415
    throw error
  }
  const buffer = fs.readFileSync(target)
  const mimeType = imageMimeType(target)
  return {
    content: `data:${mimeType};base64,${buffer.toString('base64')}`,
    mime_type: mimeType,
    bytes: buffer.length,
  }
}

function writeFile(filePath, content) {
  const target = resolveSafePath(filePath)
  if (isDatabaseFile(target)) {
    const error = new Error(`不能把文字內容直接寫入資料庫檔案：${filePath}。請改產生 .sql migration / seed / query 檔。`)
    error.statusCode = 400
    throw error
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, String(content ?? ''), 'utf8')
  return { ok: true, file_path: normalizePath(filePath), bytes: Buffer.byteLength(String(content ?? ''), 'utf8') }
}

function makeTreeWritable(target) {
  if (!fs.existsSync(target)) return
  const stat = fs.lstatSync(target)
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    for (const entry of fs.readdirSync(target)) {
      makeTreeWritable(path.join(target, entry))
    }
    fs.chmodSync(target, 0o777)
    return
  }
  fs.chmodSync(target, 0o666)
}

function waitMs(ms) {
  const buffer = new SharedArrayBuffer(4)
  const view = new Int32Array(buffer)
  Atomics.wait(view, 0, 0, ms)
}

function windowsShellDelete(target) {
  if (process.platform !== 'win32') return false
  const attempts = [
    {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', `rmdir /s /q "${target}"`],
    },
    {
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'param($p) Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction Stop',
        target,
      ],
    },
  ]

  for (const attempt of attempts) {
    const result = spawnSync(attempt.command, attempt.args, {
      encoding: 'utf8',
      timeout: 30000,
      windowsHide: true,
    })
    if (!fs.existsSync(target)) return true
    if (result.error || result.status !== 0) continue
  }
  return !fs.existsSync(target)
}

function deleteFile(filePath, options = {}) {
  const clean = normalizePath(filePath)
  const target = resolveSafePath(filePath)
  const isWorkspaceRoot = target === path.resolve(config.sandboxDir)
  if (isWorkspaceRoot && options.allowRoot !== true) {
    const error = new Error('刪除目前專案根資料夾需要明確確認。')
    error.statusCode = 400
    throw error
  }
  if (!fs.existsSync(target)) {
    const error = new Error(`找不到檔案或資料夾：${filePath}`)
    error.statusCode = 404
    throw error
  }
  let lastError = null
  for (const delay of [0, 100, 250, 500]) {
    if (delay) waitMs(delay)
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      lastError = null
      break
    } catch (error) {
      lastError = error
      if (!['EACCES', 'EPERM', 'ENOTEMPTY', 'EBUSY'].includes(error?.code)) throw error
      makeTreeWritable(target)
      if (windowsShellDelete(target)) {
        lastError = null
        break
      }
    }
  }

  if (lastError && fs.existsSync(target)) {
    lastError.message = `${lastError.message}。請確認沒有外部終端機、檔案總管或程式正在使用此資料夾。`
    throw lastError
  }
  return { ok: true, file_path: clean, deleted: true, workspace_deleted: isWorkspaceRoot }
}

function renameFile(oldPath, newPath) {
  const oldAbs = resolveSafePath(oldPath)
  const newAbs = resolveSafePath(newPath)
  if (!fs.existsSync(oldAbs)) {
    const error = new Error(`找不到檔案或資料夾：${oldPath}`)
    error.statusCode = 404
    throw error
  }
  if (fs.existsSync(newAbs)) {
    const error = new Error(`目標已存在：${newPath}`)
    error.statusCode = 409
    throw error
  }
  fs.mkdirSync(path.dirname(newAbs), { recursive: true })
  fs.renameSync(oldAbs, newAbs)
  return { ok: true, old_path: normalizePath(oldPath), new_path: normalizePath(newPath) }
}

module.exports = {
  normalizePath,
  resolveSafePath,
  listProjectTree,
  ensureProjectWorkspace,
  readFile,
  writeFile,
  deleteFile,
  renameFile,
  isLikelyText,
  isEditableTextFile,
  isDatabaseFile,
  isImageFile,
  imageMimeType,
  readImageFile,
  describeDatabaseFile,
}
