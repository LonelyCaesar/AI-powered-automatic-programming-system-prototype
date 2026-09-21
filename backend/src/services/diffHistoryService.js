const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const config = require('../config')
const { executePostgres } = require('../db/postgres')

const DIFFS_DIR = path.join(config.backendDir, 'data', 'diffs')
const DIFF_HISTORY_DIR = path.join(config.backendDir, 'data', 'diff-history')
const HISTORY_FILE = path.join(config.backendDir, 'data', 'diff-history.json')
const MAX_TEXT_CHARS = 2_000_000

function ensureDiffsDir() {
  if (!fs.existsSync(DIFFS_DIR)) {
    fs.mkdirSync(DIFFS_DIR, { recursive: true })
  }
}

function nowLocal() {
  const timeZone = process.env.APP_TIMEZONE || 'Asia/Taipei'
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date()).reduce((acc, part) => {
    acc[part.type] = part.value
    return acc
  }, {})
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}

function safeText(value, max = MAX_TEXT_CHARS) {
  return String(value || '').slice(0, max)
}

function validateHistoryId(value) {
  const id = String(value ?? '')
  if (!id) return ''
  // IDs become filenames on both Windows and Unix. Reject path syntax instead
  // of truncating or normalizing it into a different record's identifier.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id)) {
    const error = new Error('Invalid diff history id')
    error.statusCode = 400
    throw error
  }
  return id
}

function safeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return {}
  }
}

function normalizeStatus(value, fallback = 'pending') {
  const status = String(value || '').trim().toLowerCase()
  return ['pending', 'applying', 'applied', 'cancelled', 'failed', 'rolled_back', 'validation_limited'].includes(status)
    ? status
    : fallback
}

function normalizeRecord(payload = {}, existing = null) {
  const timestamp = nowLocal()
  const base = existing || {}
  return {
    id: validateHistoryId(payload.id || base.id || (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'))),
    created_at: safeText(base.created_at || payload.created_at || timestamp, 40),
    updated_at: safeText(payload.updated_at || timestamp, 40),
    project_name: safeText(payload.project_name ?? base.project_name, 240),
    workspace_source: safeText(payload.workspace_source ?? base.workspace_source, 80),
    file_path: safeText(payload.file_path ?? base.file_path, 1200),
    status: normalizeStatus(payload.status ?? base.status, base.status || 'pending'),
    diff_text: safeText(payload.diff_text ?? base.diff_text),
    old_content: safeText(payload.old_content ?? base.old_content),
    new_content: safeText(payload.new_content ?? base.new_content),
    instruction: safeText(payload.instruction ?? base.instruction, 20_000),
    source: safeText(payload.source ?? base.source, 240),
    model: safeText(payload.model ?? base.model, 240),
    additions: Number(payload.additions ?? base.additions ?? 0) || 0,
    removals: Number(payload.removals ?? base.removals ?? 0) || 0,
    metadata: safeObject(payload.metadata ?? base.metadata),
  }
}

function readFolderRecords() {
  const records = []
  const seenIds = new Set()
  const dirs = [DIFFS_DIR, DIFF_HISTORY_DIR]

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue
    try {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
      for (const file of files) {
        try {
          const filePath = path.join(dir, file)
          const raw = fs.readFileSync(filePath, 'utf8')
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object' && parsed.id && !seenIds.has(parsed.id)) {
            seenIds.add(parsed.id)
            records.push(normalizeRecord(parsed, parsed))
          }
        } catch {
          // ignore corrupted single file
        }
      }
    } catch {
      // directory inaccessible
    }
  }

  return records
}

async function upsertDatabaseRecord(record) {
  try {
    await executePostgres(`
      INSERT INTO diff_history (
        id, created_at, updated_at, project_name, workspace_source, file_path,
        status, diff_text, old_content, new_content, instruction, source, model,
        additions, removals, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12, $13,
        $14, $15, $16::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        updated_at = EXCLUDED.updated_at,
        project_name = EXCLUDED.project_name,
        workspace_source = EXCLUDED.workspace_source,
        file_path = EXCLUDED.file_path,
        status = EXCLUDED.status,
        diff_text = EXCLUDED.diff_text,
        old_content = EXCLUDED.old_content,
        new_content = EXCLUDED.new_content,
        instruction = EXCLUDED.instruction,
        source = EXCLUDED.source,
        model = EXCLUDED.model,
        additions = EXCLUDED.additions,
        removals = EXCLUDED.removals,
        metadata = EXCLUDED.metadata
    `, [
      record.id, record.created_at, record.updated_at, record.project_name,
      record.workspace_source, record.file_path, record.status, record.diff_text,
      record.old_content, record.new_content, record.instruction, record.source,
      record.model, record.additions, record.removals, JSON.stringify(record.metadata || {}),
    ])
  } catch (error) {
    // optional database mirror
  }
}

async function saveDiffHistory(payload = {}) {
  const existing = await getDiffHistory(payload.id)
  const record = normalizeRecord(payload, existing)

  if (!record.diff_text && !existing) {
    const error = new Error('diff_text is required')
    error.statusCode = 400
    throw error
  }

  ensureDiffsDir()
  const filePath = path.join(DIFFS_DIR, `${record.id}.json`)
  await fs.promises.writeFile(filePath, JSON.stringify(record, null, 2), 'utf8')

  await upsertDatabaseRecord(record)

  return record
}

async function listDiffHistory(options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200)
  const projectName = safeText(options.project_name, 240)

  const records = readFolderRecords()
  const filtered = records
    .filter(item => !projectName || item.project_name === projectName)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)))
    .slice(0, limit)

  return filtered
}

async function getDiffHistory(id) {
  const cleanId = validateHistoryId(id)
  if (!cleanId) return null

  const candidates = [
    path.join(DIFFS_DIR, `${cleanId}.json`),
    path.join(DIFF_HISTORY_DIR, `${cleanId}.json`),
  ]

  for (const targetPath of candidates) {
    if (fs.existsSync(targetPath)) {
      try {
        const raw = await fs.promises.readFile(targetPath, 'utf8')
        const parsed = JSON.parse(raw)
        return normalizeRecord(parsed, parsed)
      } catch {
        // try next
      }
    }
  }

  return null
}

async function updateDiffHistoryStatus(id, status, options = {}) {
  const existing = await getDiffHistory(id)
  if (!existing) return null

  return saveDiffHistory({
    ...existing,
    updated_at: nowLocal(),
    status: normalizeStatus(status, existing.status),
    metadata: {
      ...(existing.metadata || {}),
      ...(safeObject(options.metadata)),
      status_note: safeText(options.note, 2000),
    },
  })
}

async function deleteDiffHistory(id) {
  const cleanId = validateHistoryId(id)
  if (!cleanId) return false

  let existed = false
  const targets = [
    path.join(DIFFS_DIR, `${cleanId}.json`),
    path.join(DIFF_HISTORY_DIR, `${cleanId}.json`),
  ]

  for (const targetPath of targets) {
    if (fs.existsSync(targetPath)) {
      try {
        await fs.promises.unlink(targetPath)
        existed = true
      } catch {}
    }
  }

  try {
    const result = await executePostgres('DELETE FROM diff_history WHERE id = $1', [cleanId])
    if (Number(result?.rowCount || 0) > 0) existed = true
  } catch {}

  return existed
}

module.exports = {
  DIFFS_DIR,
  DIFF_HISTORY_DIR,
  HISTORY_FILE,
  normalizeRecord,
  normalizeStatus,
  saveDiffHistory,
  listDiffHistory,
  getDiffHistory,
  updateDiffHistoryStatus,
  deleteDiffHistory,
}
