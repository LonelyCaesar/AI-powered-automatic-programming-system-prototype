const express = require('express')
const { listLogs, clearLogs } = require('../core/auditLogger')
const router = express.Router()

router.get('/logs', async (req, res) => {
  const logs = await listLogs(req.query.limit || 20)
  res.json({ ok: true, total: logs.length, logs })
})

router.post('/clear', async (_req, res) => {
  const deleted = await clearLogs()
  res.json({ ok: true, deleted, logs: [], message: 'audit logs cleared' })
})

module.exports = router
