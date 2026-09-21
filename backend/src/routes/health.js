const express = require('express')
const fs = require('fs')
const config = require('../config')
const { postgresHealth } = require('../db/postgres')
const { ollamaHealth } = require('../core/llmClient')
const { dockerStatus } = require('../tools/dockerSandbox')
const { getEffectiveModelSettings } = require('../services/modelSettings')
const { getTerminalStatus } = require('../services/terminalService')

const router = express.Router()

router.get('/health', async (_req, res) => {
  const settings = getEffectiveModelSettings()
  const workspaceExists = fs.existsSync(config.workspaceDir) && fs.statSync(config.workspaceDir).isDirectory()
  const dockerSandbox = dockerStatus()
  res.json({
    api: { ok: true, status: 'running', runtime: 'Node.js', framework: 'Express' },
    ollama: await ollamaHealth(),
    postgresql: await postgresHealth(),
    workspace: { ok: workspaceExists, status: workspaceExists ? 'ready' : 'missing', path: config.workspaceDir },
    sandbox: { ...dockerSandbox, role: 'ai_execution', network: config.dockerSandbox.networkDisabled ? 'none' : 'bridge' },
    docker_sandbox: { ...dockerSandbox, network: config.dockerSandbox.networkDisabled ? 'none' : 'bridge' },
    terminal: getTerminalStatus(),
    cloud_api: {
      ok: Boolean(config.cloudApiEnabled && config.cloudApiKey),
      status: config.cloudApiEnabled && config.cloudApiKey ? 'enabled' : 'not_configured',
      provider: config.cloudApiProvider,
      model: config.cloudModel,
      configured: Boolean(config.cloudApiKey),
      approval_required: config.requireCloudApproval,
    },
    model: settings.ollamaModel,
    model_source: settings.modelSource,
    model_routing_mode: settings.modelRoutingMode,
    checked_at: new Date().toISOString().slice(0, 19),
  })
})

module.exports = router
