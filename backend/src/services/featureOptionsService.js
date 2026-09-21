const fs = require('fs')
const path = require('path')
const backendDir = path.resolve(__dirname, '..', '..')

const FEATURE_DIR = path.join(backendDir, 'data', 'ai-function-options')
const ORDER = ['auto', 'generate', 'rewrite', 'convert', 'detect', 'fix', 'analyze', 'files', 'explain']

function readFeatureFile(key) {
  const safeKey = String(key || '').replace(/[^a-z0-9_-]/gi, '')
  if (!safeKey) return null
  const filePath = path.join(FEATURE_DIR, `${safeKey}.json`)
  if (!fs.existsSync(filePath)) return null
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function listFeatureOptions() {
  return ORDER
    .map(readFeatureFile)
    .filter(Boolean)
}

function getFeatureOption(key) {
  return readFeatureFile(key)
}

function getAutoIntentDefinitionsText() {
  return listFeatureOptions()
    .filter(item => item.key !== 'auto')
    .map(item => `- ${item.intent}: ${item.label}。用途：${item.purpose}`)
    .join('\n')
}

function getFeaturePrompt(key) {
  const option = getFeatureOption(key)
  return option?.prompt || ''
}

module.exports = {
  FEATURE_DIR,
  listFeatureOptions,
  getFeatureOption,
  getFeaturePrompt,
  getAutoIntentDefinitionsText,
}
