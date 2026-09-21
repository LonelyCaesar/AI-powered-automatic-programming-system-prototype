const fs = require('fs-extra')
const path = require('path')
const config = require('../config')

function workspaceRoot() {
  return config.sandboxDir || config.workspaceDir || path.resolve(__dirname, '..', '..', 'workspaces', 'default')
}

function safePath(filePath = '') {
  const root = workspaceRoot()
  const clean = String(filePath || '').replace(/^[/\\]+/, '')
  const target = path.resolve(root, clean)
  if (!target.startsWith(path.resolve(root))) {
    throw new Error('檔案路徑超出 workspace 範圍')
  }
  return target
}

async function ensureWorkspace() {
  await fs.ensureDir(workspaceRoot())
  await fs.ensureDir(path.join(workspaceRoot(), '.cubi', 'snapshots'))
  return workspaceRoot()
}

async function listFiles(dir = '.') {
  await ensureWorkspace()
  const base = safePath(dir)
  const entries = await fs.readdir(base, { withFileTypes: true })
  return entries.map(entry => ({
    name: entry.name,
    path: path.posix.join(dir === '.' ? '' : dir, entry.name),
    type: entry.isDirectory() ? 'directory' : 'file'
  }))
}

async function readFile(filePath) {
  await ensureWorkspace()
  return fs.readFile(safePath(filePath), 'utf8')
}

async function writeFile(filePath, content) {
  await ensureWorkspace()
  const target = safePath(filePath)
  await fs.ensureDir(path.dirname(target))
  await fs.writeFile(target, content, 'utf8')
  return { path: filePath, status: 'modified' }
}

async function createSnapshot(label = 'snapshot') {
  await ensureWorkspace()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = path.join(workspaceRoot(), '.cubi', 'snapshots', `${stamp}-${label}`)
  await fs.copy(workspaceRoot(), target, {
    filter: src => !src.includes(`${path.sep}.cubi${path.sep}snapshots${path.sep}`)
  })
  return { path: target, createdAt: stamp }
}

module.exports = {
  workspaceRoot,
  ensureWorkspace,
  listFiles,
  readFile,
  writeFile,
  createSnapshot
}
