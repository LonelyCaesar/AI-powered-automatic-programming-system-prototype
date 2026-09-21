const express = require('express')
const crypto = require('crypto')
const config = require('../config')

const router = express.Router()

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''))
  const right = Buffer.from(String(b || ''))
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

router.post('/login', (req, res) => {
  const { username, password } = req.body || {}
  if (!safeEqual(username, config.loginUsername) || !safeEqual(password, config.loginPassword)) {
    return res.status(401).json({ detail: '帳號或密碼錯誤' })
  }
  return res.json({
    access_token: `cubi-local-token-${config.loginUsername}`,
    token_type: 'bearer',
    user: {
      username: config.loginUsername,
      display_name: config.loginUsername === 'admin' ? '系統管理員' : config.loginUsername,
      role: 'admin',
    },
    login_at: new Date().toISOString().slice(0, 19),
  })
})

module.exports = router
