const express = require('express')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const config = require('../config')
const { logAction } = require('../core/auditLogger')
const { listProjectTree, ensureProjectWorkspace, readFile, readImageFile, writeFile, deleteFile, renameFile, normalizePath, resolveSafePath, isDatabaseFile, isImageFile } = require('../tools/fileTools')
const { stopAllTerminalSessions } = require('../services/terminalService')

const router = express.Router()

function sendError(res, error) {
  res.status(error.statusCode || 500).json({ detail: error.message })
}

router.get('/tree', (req, res) => {
  if (['1', 'true', 'yes'].includes(String(req.query.ensure || '').toLowerCase())) {
    ensureProjectWorkspace()
  }
  const workspaceExists = fs.existsSync(config.workspaceDir) && fs.statSync(config.workspaceDir).isDirectory()
  res.json({
    tree: workspaceExists ? listProjectTree() : [],
    project_name: workspaceExists ? require('path').basename(config.workspaceDir) : '',
    workspace_path: config.workspaceDir,
    workspace_exists: workspaceExists,
    // Compatibility fields for older frontends.
    sandbox_path: config.workspaceDir,
    sandbox_exists: workspaceExists,
  })
})

router.post('/read', (req, res) => {
  try {
    if (isImageFile(req.body.file_path)) {
      const image = readImageFile(req.body.file_path)
      logAction('admin', '讀取圖片', req.body.file_path, 'system', 0, '成功', { service: 'node_file_system', detail: '使用者從檔案總管開啟圖片預覽。' })
      return res.json({ file_path: req.body.file_path, content: '', preview_url: image.content, content_type: 'image', mime_type: image.mime_type, bytes: image.bytes, readonly: true })
    }

    const content = readFile(req.body.file_path)
    logAction('admin', '讀取檔案', req.body.file_path, 'system', 0, '成功', { service: 'node_file_system', detail: '使用者從檔案總管開啟檔案。' })
    res.json({ file_path: req.body.file_path, content, content_type: isDatabaseFile(req.body.file_path) ? 'database_summary' : 'text', readonly: isDatabaseFile(req.body.file_path) })
  } catch (error) {
    logAction('admin', '讀取檔案', req.body.file_path, 'system', 0, '失敗', { service: 'node_file_system', detail: error.message, status: 'failed' })
    sendError(res, error)
  }
})


router.post('/read-many', (req, res) => {
  const paths = Array.isArray(req.body.file_paths) ? req.body.file_paths : []
  const uniquePaths = [...new Set(paths.map(item => normalizePath(item)).filter(Boolean))]
  const maxFiles = Math.min(Number(req.body.max_files || 20), 50)
  const maxCharsPerFile = Math.min(Number(req.body.max_chars_per_file || 12000), 60000)
  const files = []

  for (const filePath of uniquePaths.slice(0, maxFiles)) {
    try {
      const content = readFile(filePath)
      const truncated = content.length > maxCharsPerFile
      files.push({
        ok: true,
        file_path: filePath,
        content: truncated ? content.slice(0, maxCharsPerFile) : content,
        content_type: isDatabaseFile(filePath) ? 'database_summary' : 'text',
        readonly: isDatabaseFile(filePath),
        original_chars: content.length,
        included_chars: truncated ? maxCharsPerFile : content.length,
        truncated,
      })
    } catch (error) {
      files.push({ ok: false, file_path: filePath, content: '', error: error.message })
    }
  }

  logAction('admin', '讀取多檔案上下文', uniquePaths.slice(0, maxFiles).join('、'), 'system', 0, `成功：${files.filter(item => item.ok).length}/${files.length}`, { service: 'node_file_system', detail: '提供 Agent 多檔案上下文讀取。' })
  res.json({ ok: true, files, total: files.length, skipped: Math.max(0, uniquePaths.length - maxFiles) })
})

router.post('/write-many', (req, res) => {
  const files = Array.isArray(req.body.files) ? req.body.files : []
  const maxFiles = Math.min(Number(req.body.max_files || 20), 50)
  const results = []

  for (const item of files.slice(0, maxFiles)) {
    const filePath = normalizePath(item?.file_path || item?.path)
    try {
      if (!filePath) throw new Error('file_path 不可空白')
      results.push(writeFile(filePath, item?.content ?? ''))
    } catch (error) {
      results.push({ ok: false, file_path: filePath, error: error.message })
    }
  }

  logAction('admin', '寫入多檔案', results.map(item => item.file_path).join('、'), 'system', 0, `成功：${results.filter(item => item.ok).length}/${results.length}`, { service: 'node_file_system', detail: 'Agent / 使用者批次寫入多個檔案。', status: results.every(item => item.ok) ? 'success' : 'failed' })
  res.json({ ok: results.every(item => item.ok), files: results, total: results.length, skipped: Math.max(0, files.length - maxFiles) })
})

router.post('/write', (req, res) => {
  try {
    const result = writeFile(req.body.file_path, req.body.content)
    logAction('admin', '寫入檔案', req.body.file_path, 'system', 0, '成功', { service: 'node_file_system', detail: '使用者儲存目前編輯器內容。' })
    res.json(result)
  } catch (error) {
    logAction('admin', '寫入檔案', req.body.file_path, 'system', 0, '失敗', { service: 'node_file_system', detail: error.message, status: 'failed' })
    sendError(res, error)
  }
})

router.post('/rename', (req, res) => {
  try {
    const result = renameFile(req.body.old_path, req.body.new_path)
    logAction('admin', '重新命名檔案/資料夾', `${req.body.old_path} -> ${req.body.new_path}`, 'system', 0, '成功', { service: 'node_file_system', detail: '重新命名檔案或資料夾。' })
    res.json(result)
  } catch (error) {
    logAction('admin', '重新命名檔案/資料夾', `${req.body.old_path} -> ${req.body.new_path}`, 'system', 0, '失敗', { service: 'node_file_system', detail: error.message, status: 'failed' })
    sendError(res, error)
  }
})

router.post('/delete', (req, res) => {
  try {
    const allowRoot = req.body.allow_root === true
    const target = resolveSafePath(req.body.file_path)
    const isWorkspaceRoot = target === path.resolve(config.workspaceDir)
    const stoppedTerminals = allowRoot && isWorkspaceRoot
      ? stopAllTerminalSessions('workspace_deleted')
      : []
    const result = deleteFile(req.body.file_path, { allowRoot })
    if (stoppedTerminals.length) result.stopped_terminals = stoppedTerminals.length
    logAction('admin', '刪除檔案/資料夾', req.body.file_path, 'system', 0, '成功', { service: 'node_file_system', detail: '刪除檔案或資料夾。' })
    res.json(result)
  } catch (error) {
    logAction('admin', '刪除檔案/資料夾', req.body.file_path, 'system', 0, '失敗', { service: 'node_file_system', detail: error.message, status: 'failed' })
    sendError(res, error)
  }
})

router.post('/reveal', (req, res) => {
  try {
    const relativePath = normalizePath(req.body.file_path)
    const target = resolveSafePath(relativePath)
    if (!fs.existsSync(target)) {
      const error = new Error(`找不到檔案或資料夾：${relativePath || '.'}`)
      error.statusCode = 404
      throw error
    }

    let command
    let args
    if (process.platform === 'win32') {
      command = 'explorer.exe'
      args = target === path.resolve(config.workspaceDir) ? [target] : [`/select,${target}`]
    } else if (process.platform === 'darwin') {
      command = 'open'
      args = target === path.resolve(config.workspaceDir) ? [target] : ['-R', target]
    } else {
      command = 'xdg-open'
      args = [fs.statSync(target).isDirectory() ? target : path.dirname(target)]
    }

    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })
    child.once('error', error => {
      logAction('admin', '在檔案總管中顯示', relativePath || '.', 'system', 0, '失敗', { service: 'node_file_system', detail: error.message, status: 'failed' })
    })
    child.unref()

    logAction('admin', '在檔案總管中顯示', relativePath || '.', 'system', 0, '成功', { service: 'node_file_system', detail: '已呼叫作業系統檔案總管。' })
    res.json({ ok: true, file_path: relativePath, revealed: true })
  } catch (error) {
    logAction('admin', '在檔案總管中顯示', req.body.file_path || '.', 'system', 0, '失敗', { service: 'node_file_system', detail: error.message, status: 'failed' })
    sendError(res, error)
  }
})

module.exports = router
