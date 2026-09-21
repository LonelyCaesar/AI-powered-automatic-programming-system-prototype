const express = require('express')
const { logAction } = require('../core/auditLogger')
const { getCodexConnectors, saveCodexConnector, testCodexConnectors } = require('../services/codexConnectors')

const router = express.Router()

router.get('/connectors', (_req, res) => {
  res.json(getCodexConnectors())
})

router.post('/connectors/:key', (req, res, next) => {
  try {
    const result = saveCodexConnector(req.params.key, req.body || {})
    const connector = result.connectors[req.params.key]
    logAction('admin', 'Codex 連線器設定', req.params.key, connector?.name || 'Codex', 0, connector?.connected ? '已連線' : '未連線', { service: 'codex_connector', detail: connector?.workspace || connector?.repo || '' })
    res.json(result)
  } catch (error) {
    next(error)
  }
})

router.post('/connectors/test', (_req, res) => {
  res.json(testCodexConnectors())
})

module.exports = router
