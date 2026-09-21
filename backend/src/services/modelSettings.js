const fs = require('fs')
const path = require('path')
const config = require('../config')

const settingsPath = path.join(config.backendDir, 'data', 'model-settings.json')

function sanitizeBaseUrl(value) {
  const raw = String(value || '').trim() || config.ollamaBaseUrl || 'http://localhost:11434'
  return raw.replace(/\/+$/, '')
}

function sanitizeModel(value) {
  return String(value || '').trim() || config.ollamaModel || 'auto'
}

function sanitizeRoutingMode(value) {
  const raw = String(value || '').trim() || config.modelRoutingMode || 'local_first'
  return ['local_first', 'local_only', 'cloud_for_large_context', 'manual'].includes(raw) ? raw : 'local_first'
}

function sanitizeModelSource(value) {
  const raw = String(value || '').trim() || config.modelSource || 'local_ollama'
  return ['local_ollama', 'cloud_api'].includes(raw) ? raw : 'local_ollama'
}

function sanitizeCloudProvider(value) {
  return String(value || '').trim() || config.cloudApiProvider || 'OpenAI / Azure OpenAI API'
}

function sanitizeCloudBaseUrl(value) {
  const raw = String(value || '').trim() || config.cloudApiBaseUrl || 'https://api.openai.com/v1'
  return raw.replace(/\/+$/, '')
}

function sanitizeCloudModel(value) {
  return String(value || '').trim() || config.cloudModel || 'gpt-4.1-mini'
}

function sanitizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return fallback
  return ['1', 'true', 'yes', 'on'].includes(raw)
}

function shouldKeepExistingSecret(value) {
  const raw = String(value || '').trim()
  return !raw || /^(\*+|已設定|configured)$/i.test(raw)
}

function readStoredSettings() {
  try {
    if (!fs.existsSync(settingsPath)) return {}
    const raw = fs.readFileSync(settingsPath, 'utf8')
    return raw ? JSON.parse(raw) : {}
  } catch (error) {
    console.warn(`[modelSettings] read failed: ${error.message}`)
    return {}
  }
}

function getModelSettings(options = {}) {
  const stored = readStoredSettings()
  const cloudApiKey = String(stored.cloudApiKey || config.cloudApiKey || '').trim()
  const settings = {
    ollamaBaseUrl: sanitizeBaseUrl(stored.ollamaBaseUrl),
    ollamaModel: sanitizeModel(stored.ollamaModel),
    modelSource: sanitizeModelSource(stored.modelSource),
    modelRoutingMode: sanitizeRoutingMode(stored.modelRoutingMode),
    cloudApiEnabled: sanitizeBoolean(stored.cloudApiEnabled, config.cloudApiEnabled),
    cloudApiProvider: sanitizeCloudProvider(stored.cloudApiProvider),
    cloudApiBaseUrl: sanitizeCloudBaseUrl(stored.cloudApiBaseUrl),
    cloudModel: sanitizeCloudModel(stored.cloudModel),
    requireCloudApproval: sanitizeBoolean(stored.requireCloudApproval, config.requireCloudApproval),
    cloudApiKeyConfigured: Boolean(cloudApiKey),
    updatedAt: stored.updatedAt || '',
  }
  if (options.includeSecrets) settings.cloudApiKey = cloudApiKey
  return settings
}

function getEffectiveModelSettings() {
  const settings = getModelSettings({ includeSecrets: true })
  return {
    ...settings,
    ollamaConnectTimeoutMs: config.ollamaConnectTimeoutMs,
    ollamaReadTimeoutMs: config.ollamaReadTimeoutMs,
    ollamaNumPredict: config.ollamaNumPredict,
    ollamaNumCtx: config.ollamaNumCtx,
    ollamaMaxRetries: config.ollamaMaxRetries,
  }
}

function applyRuntimeSettings(settings) {
  config.ollamaBaseUrl = settings.ollamaBaseUrl
  config.ollamaModel = settings.ollamaModel
  config.modelSource = settings.modelSource
  config.modelRoutingMode = settings.modelRoutingMode
  config.cloudApiEnabled = Boolean(settings.cloudApiEnabled)
  config.cloudApiProvider = settings.cloudApiProvider
  config.cloudApiBaseUrl = settings.cloudApiBaseUrl
  config.cloudApiKey = String(settings.cloudApiKey || '').trim()
  config.cloudModel = settings.cloudModel
  config.requireCloudApproval = Boolean(settings.requireCloudApproval)
}

function saveModelSettings(input = {}) {
  const stored = readStoredSettings()
  const storedSecret = String(stored.cloudApiKey || '').trim()
  const fallbackSecret = String(config.cloudApiKey || '').trim()
  const incomingSecret = input.cloudApiKey ?? input.CLOUD_API_KEY
  const cloudApiKey = shouldKeepExistingSecret(incomingSecret) ? storedSecret : String(incomingSecret).trim()
  const next = {
    ollamaBaseUrl: sanitizeBaseUrl(input.ollamaBaseUrl || input.OLLAMA_BASE_URL),
    ollamaModel: sanitizeModel(input.ollamaModel || input.OLLAMA_MODEL),
    modelSource: sanitizeModelSource(input.modelSource || input.MODEL_SOURCE),
    modelRoutingMode: sanitizeRoutingMode(input.modelRoutingMode || input.MODEL_ROUTING_MODE),
    cloudApiEnabled: sanitizeBoolean(input.cloudApiEnabled ?? input.CLOUD_API_ENABLED, config.cloudApiEnabled),
    cloudApiProvider: sanitizeCloudProvider(input.cloudApiProvider || input.CLOUD_API_PROVIDER),
    cloudApiBaseUrl: sanitizeCloudBaseUrl(input.cloudApiBaseUrl || input.CLOUD_API_BASE_URL),
    cloudApiKey,
    cloudModel: sanitizeCloudModel(input.cloudModel || input.CLOUD_MODEL),
    requireCloudApproval: sanitizeBoolean(input.requireCloudApproval ?? input.REQUIRE_CLOUD_APPROVAL, config.requireCloudApproval),
    updatedAt: new Date().toISOString().slice(0, 19),
  }
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
  fs.writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  applyRuntimeSettings({ ...next, cloudApiKey: next.cloudApiKey || fallbackSecret })
  return getModelSettings()
}

applyRuntimeSettings(getEffectiveModelSettings())

module.exports = { getModelSettings, getEffectiveModelSettings, saveModelSettings, settingsPath }
