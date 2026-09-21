const fs = require('fs')
const path = require('path')
const config = require('../config')
const { executePostgres } = require('../db/postgres')

const FIRST_RUN_MARKER = path.join(config.backendDir, 'data', '.history-initialized')
const DIFF_HISTORY_FILE = path.join(config.backendDir, 'data', 'diff-history.json')
const CHATS_DIR = path.join(config.backendDir, 'data', 'chats')
const DIFFS_DIR = path.join(config.backendDir, 'data', 'diffs')
const DIFF_HISTORY_DIR = path.join(config.backendDir, 'data', 'diff-history')

async function markerExists() {
  try {
    await fs.promises.access(FIRST_RUN_MARKER, fs.constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function initializeCleanHistoryOnce() {
  if (!config.clearHistoryOnFirstStart) return { ok: true, skipped: true, reason: 'disabled' }
  if (await markerExists()) return { ok: true, skipped: true, reason: 'already_initialized' }

  // A packaged installation must open with no developer/demo history.
  // This runs once only; later restarts keep the user's real history.
  try {
    await executePostgres('DELETE FROM audit_log')
    await executePostgres('DELETE FROM diff_history')
  } catch (e) {
    // optional database cleanup
  }
  
  await fs.promises.rm(CHATS_DIR, { recursive: true, force: true }).catch(() => {})
  await fs.promises.rm(DIFFS_DIR, { recursive: true, force: true }).catch(() => {})
  await fs.promises.rm(DIFF_HISTORY_DIR, { recursive: true, force: true }).catch(() => {})

  await fs.promises.mkdir(path.dirname(DIFF_HISTORY_FILE), { recursive: true })
  await fs.promises.writeFile(DIFF_HISTORY_FILE, '[]\n', 'utf8')
  await fs.promises.writeFile(FIRST_RUN_MARKER, JSON.stringify({ initialized_at: new Date().toISOString() }, null, 2), 'utf8')
  return { ok: true, skipped: false }
}

module.exports = {
  FIRST_RUN_MARKER,
  DIFF_HISTORY_FILE,
  initializeCleanHistoryOnce,
}
