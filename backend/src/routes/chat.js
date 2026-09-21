const express = require('express')
const chatService = require('../services/chatHistoryService')

const router = express.Router()

router.get('/history', (req, res) => {
  try {
    const sessions = chatService.listChatSessions()
    res.json({ ok: true, sessions })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

router.get('/history/:id', (req, res) => {
  try {
    const session = chatService.getChatSession(req.params.id)
    if (!session) {
      return res.status(404).json({ ok: false, error: 'Session not found' })
    }
    res.json({ ok: true, session })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

router.post('/history/:id', (req, res) => {
  try {
    const { messages, title } = req.body
    const saved = chatService.saveChatSession(req.params.id, messages, title)
    res.json({ ok: true, session: saved })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

router.delete('/history/:id', (req, res) => {
  try {
    const deleted = chatService.deleteChatSession(req.params.id)
    res.json({ ok: deleted })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

module.exports = router
