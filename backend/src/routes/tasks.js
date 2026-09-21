const express = require('express')
const taskService = require('../services/taskService')
const { executeAcceptedPlan } = require('../services/agentExecutorService')

const router = express.Router()

router.post('/create', (req, res) => {
  const task = taskService.createTask(req.body || {})
  res.json({ ok: true, task })
})

router.get('/:id', (req, res) => {
  const task = taskService.getTask(req.params.id)
  if (!task) return res.status(404).json({ ok: false, error: 'task not found' })
  res.json({ ok: true, task })
})

router.post('/:id/accept-plan', async (req, res, next) => {
  try {
    const task = await executeAcceptedPlan({
      taskId: req.params.id,
      planMessage: req.body?.planMessage || {},
      dryRun: req.body?.dryRun !== false
    })
    if (!task) return res.status(404).json({ ok: false, error: 'task not found' })
    res.json({ ok: true, task })
  } catch (error) {
    next(error)
  }
})

module.exports = router
