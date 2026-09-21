const express = require('express')
const { logAction } = require('../core/auditLogger')
const { buildModelRoutingPlan } = require('../services/modelRouter')
const { getModelSettings, saveModelSettings } = require('../services/modelSettings')
const { ollamaHealth } = require('../core/llmClient')
const router = express.Router()

async function modelSettingsHealth(settings) {
  if (settings.modelSource !== 'cloud_api') return ollamaHealth({ testInference: true })
  const ok = Boolean(settings.cloudApiEnabled && settings.cloudApiBaseUrl && settings.cloudModel && settings.cloudApiKeyConfigured)
  return {
    ok,
    status: ok ? 'configured' : 'not_configured',
    source: 'cloud_api',
    url: settings.cloudApiBaseUrl,
    selected_model: settings.cloudModel,
    model: settings.cloudModel,
    configured: Boolean(settings.cloudApiKeyConfigured),
    warning: ok ? '' : '雲端模型尚未完成設定，請確認 Cloud API URL、模型名稱與 CLOUD_API_KEY。',
    checked_at: new Date().toISOString().slice(0, 19),
  }
}

router.get('/settings', async (_req, res) => {
  const settings = getModelSettings()
  const health = await modelSettingsHealth(settings)
  res.json({ ok: true, settings, health })
})

router.post('/settings', async (req, res) => {
  const settings = saveModelSettings(req.body || {})
  const health = await modelSettingsHealth(settings)
  const modelName = settings.modelSource === 'cloud_api' ? settings.cloudModel : settings.ollamaModel
  const endpoint = settings.modelSource === 'cloud_api' ? settings.cloudApiBaseUrl : settings.ollamaBaseUrl
  logAction('admin', '模型設定更新', 'model-settings', modelName, 0, health.ok ? '成功：模型已設定' : `警告：${health.warning || '模型未連線'}`, { service: settings.modelSource || 'local_ollama', detail: `${endpoint} / ${modelName}` })
  res.json({ ok: true, settings, health })
})

router.post('/settings/test', async (req, res) => {
  const settings = saveModelSettings(req.body || {})
  const health = await modelSettingsHealth(settings)
  res.json({ ok: health.ok, settings, health })
})

router.post('/routing-plan', (req, res) => {
  const result = buildModelRoutingPlan(req.body || {})
  const route = result.route || {}
  logAction('admin', '本地模型與雲端模型分流狀態', req.body.file_path || 'model-routing', route.selected_model || result.local_model, 0, `成功：${route.decision}；來源=${route.selected_source}；雲端啟用=${result.cloud_api_enabled}`, { service: route.selected_source || 'local_ollama', detail: route.reason || result.summary })
  res.json(result)
})

module.exports = router
