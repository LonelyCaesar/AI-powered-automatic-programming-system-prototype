const crypto = require('crypto')
const { ensureSchemaReady, executePostgres, queryPostgres } = require('../db/postgres')

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

async function logAction(user, operation, filePath, model, tokens, result, options = {}) {
  try {
    await ensureSchemaReady()
    const operationId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')
    await executePostgres(`
      INSERT INTO audit_log (
        operation_id, created_at, "user", operation, file_path, model, service,
        token_count, prompt_tokens, completion_tokens, result, pytest_result,
        elapsed_seconds, detail, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `, [
      operationId,
      nowLocal(),
      user || 'admin',
      operation || '',
      filePath || '',
      model || 'system',
      options.service || 'node_express_api',
      Number(tokens || 0),
      Number(options.promptTokens || 0),
      Number(options.completionTokens || 0),
      result || '',
      options.pytestResult || '',
      Number(options.elapsedSeconds || 0),
      options.detail || '',
      options.status || 'success',
    ])
    return { ok: true, operation_id: operationId }
  } catch (error) {
    console.warn('[auditLogger] PostgreSQL write failed:', error.message)
    return { ok: false, error: error.message }
  }
}

async function listLogs(limit = 20) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100)
  return queryPostgres(`
    SELECT id, operation_id, created_at, "user", operation, file_path, model, service,
           token_count, result, pytest_result, elapsed_seconds, detail, status
    FROM audit_log
    ORDER BY id DESC
    LIMIT $1
  `, [safeLimit])
}

async function clearLogs() {
  await ensureSchemaReady()
  const before = await queryPostgres('SELECT COUNT(*)::int AS count FROM audit_log')
  await executePostgres('DELETE FROM audit_log')
  return Number(before?.[0]?.count || 0)
}

module.exports = { logAction, listLogs, clearLogs }
