const express = require('express')
const { logAction } = require('../core/auditLogger')
const { buildSafetyPlan, safeQuery } = require('../services/dbGuard')
const enterprise = require('../services/enterpriseDatabase')

const router = express.Router()

router.get('/safety-plan', (req, res) => {
  const result = buildSafetyPlan()
  logAction('admin', '資料庫讀取限制 / DB Safety', result.policy.database || 'PostgreSQL', 'PostgreSQL read-only guard', 0, 'success: read-only, allowlisted tables and columns, row limit enabled', { service: 'node_db_guard', detail: 'AI database access is read-only. Dangerous SQL is blocked.' })
  res.json(result)
})

router.post('/safe-query', async (req, res) => {
  const result = await safeQuery(req.body.sql)
  logAction('admin', 'PostgreSQL safe query', 'PostgreSQL', 'PostgreSQL read-only guard', 0, result.ok ? 'success' : 'blocked', { service: 'node_db_guard', detail: result.sql || result.error || 'safe query checked', status: result.ok ? 'success' : 'blocked' })
  res.json(result)
})

router.get('/enterprise/plan', (_req, res) => {
  const result = enterprise.enterprisePlan()
  logAction('admin', 'Enterprise DB plan', 'database', 'enterprise_database', 0, 'success', { service: 'node_enterprise_database', detail: 'Show enterprise database read-only and chunking prototype plan.' })
  res.json(result)
})

router.get('/enterprise/schema', async (_req, res) => {
  res.json(await enterprise.schemaSummary())
})

router.post('/enterprise/safe-query', async (req, res) => {
  res.json(await enterprise.safeEnterpriseQuery(req.body.sql))
})

router.post('/enterprise/ask', async (req, res) => {
  res.json(await enterprise.answerDatabaseQuestion(req.body.question, req.body.table_hint))
})

module.exports = router
