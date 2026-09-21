const fs = require('fs')
const path = require('path')
const config = require('../config')

const connectorsPath = path.join(config.backendDir, 'data', 'codex-connectors.json')

const connectorDefaults = {
  github: {
    key: 'github',
    name: 'GitHub',
    description: '連接 GitHub 後，可在 Codex / Cubi Code 中參考 Repository、PR 與程式碼審查流程。',
    setupUrl: 'https://developers.openai.com/codex/integrations/github',
    connected: false,
    workspace: '',
    repo: '',
    note: '此雛形只保留 GitHub 連線器狀態與設定入口；正式 OAuth / 權限核准仍需在 Codex 或 ChatGPT 工作區完成。',
  },
}

function boolEnv(name, defaultValue = false) {
  const value = String(process.env[name] ?? '').trim().toLowerCase()
  if (!value) return defaultValue
  return ['1', 'true', 'yes', 'on'].includes(value)
}

function readStored() {
  try {
    if (!fs.existsSync(connectorsPath)) return {}
    const raw = fs.readFileSync(connectorsPath, 'utf8')
    return raw ? JSON.parse(raw) : {}
  } catch (error) {
    console.warn(`[codexConnectors] read failed: ${error.message}`)
    return {}
  }
}

function fromEnv(key, connector) {
  const prefix = `CODEX_${key.toUpperCase()}`
  return {
    ...connector,
    connected: boolEnv(`${prefix}_CONNECTED`, connector.connected),
    workspace: process.env[`${prefix}_WORKSPACE`] || connector.workspace || '',
    repo: process.env[`${prefix}_REPO`] || connector.repo || '',
  }
}

function getCodexConnectors() {
  const stored = readStored()
  const connectors = {}
  for (const [key, defaults] of Object.entries(connectorDefaults)) {
    connectors[key] = fromEnv(key, {
      ...defaults,
      ...(stored.connectors?.[key] || {}),
      key,
      name: defaults.name,
      description: defaults.description,
      setupUrl: defaults.setupUrl,
    })
  }
  return {
    ok: true,
    connectors,
    updatedAt: stored.updatedAt || '',
    mode: 'codex_connector_status_bridge',
    note: 'Cubi Code 目前保存 Codex GitHub 連線器狀態與設定入口；實際 OAuth / GitHub 授權請在 Codex 或 ChatGPT 工作區完成。',
  }
}

function saveCodexConnector(key, input = {}) {
  const normalizedKey = String(key || '').trim().toLowerCase()
  if (!connectorDefaults[normalizedKey]) throw new Error(`不支援的 Codex 連線器：${key}`)

  const current = getCodexConnectors()
  const existing = current.connectors[normalizedKey]
  const nextConnector = {
    ...existing,
    connected: Boolean(input.connected),
    workspace: String(input.workspace || '').trim(),
    repo: String(input.repo || '').trim(),
    lastCheckedAt: new Date().toISOString().slice(0, 19),
  }

  const next = {
    connectors: {
      ...current.connectors,
      [normalizedKey]: nextConnector,
    },
    updatedAt: nextConnector.lastCheckedAt,
  }
  fs.mkdirSync(path.dirname(connectorsPath), { recursive: true })
  fs.writeFileSync(connectorsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return getCodexConnectors()
}

function testCodexConnectors() {
  const data = getCodexConnectors()
  const connectors = Object.values(data.connectors)
  return {
    ok: true,
    connected_count: connectors.filter(item => item.connected).length,
    total: connectors.length,
    connectors: data.connectors,
    note: data.note,
    checked_at: new Date().toISOString().slice(0, 19),
  }
}

module.exports = { getCodexConnectors, saveCodexConnector, testCodexConnectors, connectorsPath }
