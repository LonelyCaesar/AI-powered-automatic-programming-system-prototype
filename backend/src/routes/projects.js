const express = require('express')
const fs = require('fs')
const path = require('path')
const config = require('../config')
const { logAction } = require('../core/auditLogger')
const { stopAllTerminalSessions } = require('../services/terminalService')

const router = express.Router()

// 排除不需要當作專案顯示的核心與隱藏資料夾
const EXCLUDED_DIRS = new Set([
  'frontend', 'backend', 'node_modules', '.git', '.idea', '.vscode', 'dist', 'build', 'scripts', 'patches'
])

function getAvailableProjects() {
  const root = config.projectsDir
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return []
  }

  const projects = []
  const items = fs.readdirSync(root)
  for (const item of items) {
    if (EXCLUDED_DIRS.has(item) || item.startsWith('.')) continue
    
    const itemPath = path.join(root, item)
    try {
      const stat = fs.statSync(itemPath)
      if (stat.isDirectory()) {
        projects.push(item)
      }
    } catch (err) {
      // ignore
    }
  }
  return projects.sort((a, b) => a.localeCompare(b))
}

router.get('/list', (req, res) => {
  try {
    const projects = getAvailableProjects()
    const activeProject = path.basename(config.workspaceDir)
    res.json({
      projects,
      active_project: activeProject
    })
  } catch (error) {
    res.status(500).json({ detail: error.message })
  }
})

router.post('/switch', (req, res) => {
  try {
    const projectName = req.body.project_name
    if (!projectName || typeof projectName !== 'string') {
      return res.status(400).json({ detail: 'Project name is required' })
    }
    
    // 防呆：不可包含路徑符號
    if (projectName.includes('/') || projectName.includes('\\') || projectName.includes('..')) {
      return res.status(400).json({ detail: 'Invalid project name' })
    }

    const newWorkspacePath = path.resolve(config.projectsDir, projectName)
    if (!fs.existsSync(newWorkspacePath) || !fs.statSync(newWorkspacePath).isDirectory()) {
      return res.status(404).json({ detail: 'Project directory not found' })
    }

    // 關閉現有的 Terminal session 以免鎖定檔案
    stopAllTerminalSessions('workspace_changed')

    // 更新設定檔物件中的屬性（僅在執行期切換，不污染 .env，確保系統重啟/裝機預設永遠是 my_project）
    config.workspaceDir = newWorkspacePath
    config.sandboxDir = newWorkspacePath
    config.terminal.cwd = newWorkspacePath

    logAction('admin', '切換專案', projectName, 'system', 0, '成功', { detail: `已切換至專案：${projectName}` })

    res.json({
      ok: true,
      project_name: projectName,
      workspace_path: newWorkspacePath,
      projects_root: config.projectsDir
    })
  } catch (error) {
    logAction('admin', '切換專案', req.body.project_name, 'system', 0, '失敗', { detail: error.message, status: 'failed' })
    res.status(500).json({ detail: error.message })
  }
})

router.post('/create', (req, res) => {
  try {
    const projectName = req.body.project_name
    if (!projectName || typeof projectName !== 'string') {
      return res.status(400).json({ detail: 'Project name is required' })
    }

    if (projectName.includes('/') || projectName.includes('\\') || projectName.includes('..')) {
      return res.status(400).json({ detail: 'Invalid project name' })
    }

    const newWorkspacePath = path.resolve(config.projectsDir, projectName)
    if (fs.existsSync(newWorkspacePath)) {
      return res.status(409).json({ detail: 'Project directory already exists' })
    }

    fs.mkdirSync(newWorkspacePath, { recursive: true })

    // 建立成功後直接在執行期切換過去（不污染 .env）
    stopAllTerminalSessions('workspace_changed')
    config.workspaceDir = newWorkspacePath
    config.sandboxDir = newWorkspacePath
    config.terminal.cwd = newWorkspacePath

    logAction('admin', '新增專案', projectName, 'system', 0, '成功', { detail: `已建立並切換至新專案：${projectName}` })

    res.json({
      ok: true,
      project_name: projectName,
      workspace_path: newWorkspacePath,
      projects_root: config.projectsDir
    })
  } catch (error) {
    logAction('admin', '新增專案', req.body.project_name, 'system', 0, '失敗', { detail: error.message, status: 'failed' })
    res.status(500).json({ detail: error.message })
  }
})

module.exports = router
