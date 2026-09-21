const express = require('express')
const { getTerminalStatus, listTerminalSessions } = require('../services/terminalService')
const { getXServerStatus, startXServer } = require('../services/xServerService')

const router = express.Router()

router.get('/status', (_req, res) => {
  res.json(getTerminalStatus())
})

router.get('/sessions', (_req, res) => {
  res.json({ sessions: listTerminalSessions() })
})

router.get('/xserver/status', async (_req, res, next) => {
  try {
    res.json(await getXServerStatus())
  } catch (error) {
    next(error)
  }
})

router.post('/xserver/start', async (_req, res, next) => {
  try {
    res.json(await startXServer())
  } catch (error) {
    next(error)
  }
})

module.exports = router
