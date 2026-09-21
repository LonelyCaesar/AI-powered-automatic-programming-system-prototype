const express = require('express')
const {
  listSandboxApps,
  stopSandboxApp,
} = require('../services/sandboxAppService')
const { stageProjectWorkspace } = require('../services/sandboxWorkspaceService')

const router = express.Router()

router.get('/', (_req, res) => {
  res.json({ ok: true, apps: listSandboxApps() })
})

router.post('/workspaces/stage', (req, res) => {
  const workspace = stageProjectWorkspace({
    projectId: req.body?.project_id || req.body?.workspace_id || '',
    projectName: req.body?.project_name || 'project',
    workspaceSource: req.body?.workspace_source || '',
    filePath: req.body?.file_path || '',
    code: req.body?.code,
    contextFiles: req.body?.context_files || [],
  })
  res.json({
    ok: true,
    workspace_id: workspace.id,
    active_file: workspace.activeFile,
    synced_files: workspace.syncedFiles,
    synced_count: workspace.syncedFiles.length,
  })
})

router.post('/:id/stop', async (req, res) => {
  const stopped = await stopSandboxApp(req.params.id)
  res.json({ ok: true, stopped })
})

module.exports = router
