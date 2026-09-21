const fs = require('fs')
const path = require('path')
const config = require('../config')

function ensureStartupWorkspace() {
  fs.mkdirSync(path.resolve(config.projectsDir), { recursive: true })
  const workspace = path.resolve(config.workspaceDir)
  const existed = fs.existsSync(workspace)

  fs.mkdirSync(workspace, { recursive: true })

  // The real editable project is the inner my_project folder, e.g.
  // D:\\Cubi_Code_AI_整理版\\my_project\\my_project.
  // Keep every human-facing workspace reference on that same inner folder.
  config.workspaceDir = workspace
  config.sandboxDir = workspace
  config.terminal.cwd = workspace

  return {
    path: workspace,
    projectName: path.basename(workspace),
    created: !existed,
    existed,
  }
}

module.exports = { ensureStartupWorkspace }
