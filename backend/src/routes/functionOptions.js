const express = require('express')
const { listFeatureOptions, getFeatureOption } = require('../services/featureOptionsService')

const router = express.Router()

router.get('/function-options', (_req, res) => {
  res.json({
    ok: true,
    type: 'ai_function_options',
    count: listFeatureOptions().length,
    options: listFeatureOptions(),
  })
})

router.get('/function-options/:key', (req, res) => {
  const option = getFeatureOption(req.params.key)
  if (!option) return res.status(404).json({ ok: false, error: '找不到功能選項設定檔。' })
  res.json({ ok: true, option })
})

module.exports = router
