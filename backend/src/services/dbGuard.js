const fs = require('fs')
const config = require('../config')
const { queryPostgres } = require('../db/postgres')

function loadAllowedTables(filePath = config.allowedTablesPath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return {
      audit_log: ['created_at', 'user', 'operation', 'file_path', 'model', 'token_count', 'result', 'status'],
      model_config: ['model_name', 'source', 'is_enabled', 'note'],
      project_file_index: ['file_path', 'summary', 'updated_at'],
    }
  }
}

function normalizeSql(sql) {
  return String(sql || '').trim().replace(/;\s*$/g, '')
}

function findTables(sql) {
  const tables = []
  const regex = /\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi
  let match
  while ((match = regex.exec(sql))) tables.push(match[1])
  return [...new Set(tables)]
}

function validateSafeSelect(sql, allowedTables = loadAllowedTables(), maxRows = config.maxDbRows) {
  const cleaned = normalizeSql(sql)
  const lowered = cleaned.toLowerCase()
  if (!cleaned) return { ok: false, error: 'SQL 不可空白。' }
  if (!lowered.startsWith('select ')) return { ok: false, error: '只允許 SELECT 查詢。' }
  const blocked = ['insert ', 'update ', 'delete ', 'drop ', 'alter ', 'truncate ', 'create ', 'replace ', 'attach ', 'pragma ', 'vacuum ']
  if (blocked.some(keyword => lowered.includes(keyword))) return { ok: false, error: '包含危險 SQL 關鍵字，已阻擋。' }
  const tables = findTables(cleaned)
  const allowedNames = Object.keys(allowedTables)
  const notAllowed = tables.filter(table => !allowedNames.includes(table))
  if (notAllowed.length) return { ok: false, error: `資料表不在白名單：${notAllowed.join(', ')}` }
  let safeSql = cleaned
  if (!/\blimit\s+\d+\b/i.test(safeSql)) safeSql += ` LIMIT ${maxRows}`
  safeSql = safeSql.replace(/\blimit\s+(\d+)/i, (_, value) => `LIMIT ${Math.min(Number(value), maxRows)}`)
  return { ok: true, sql: safeSql, tables, allowed_tables: allowedNames, max_rows: maxRows }
}

function buildSafetyPlan() {
  const allowed = loadAllowedTables()
  return {
    ok: true,
    type: 'db_safety_plan',
    database: 'PostgreSQL',
    provider: 'postgresql',
    summary: 'PostgreSQL 唯讀安全查詢已啟用。',
    policy: {
      mode: 'read_only',
      provider: 'postgresql',
      database: config.databaseUrl ? 'DATABASE_URL' : config.pg.database,
      read_only: true,
      allowed_tables: Object.keys(allowed),
      allowed_columns: allowed,
      max_rows: config.maxDbRows,
      blocked_operations: ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE', 'PRAGMA', 'VACUUM'],
    },
    examples: [
      `SELECT created_at, operation, file_path, result FROM audit_log LIMIT ${Math.min(config.maxDbRows, 20)}`,
      'SELECT model_name, source, is_enabled FROM model_config',
    ],
  }
}

async function safeQuery(sql) {
  const validation = validateSafeSelect(sql)
  if (!validation.ok) return { ok: false, blocked: true, error: validation.error, sql }
  try {
    const rows = await queryPostgres(validation.sql)
    return { ok: true, blocked: false, provider: 'postgresql', sql: validation.sql, row_count: rows.length, rows, tables: validation.tables, limited: true, sql_validated: true }
  } catch (error) {
    return { ok: false, blocked: false, provider: 'postgresql', sql: validation.sql, error: error.message, tables: validation.tables, sql_validated: true }
  }
}

module.exports = { loadAllowedTables, validateSafeSelect, buildSafetyPlan, safeQuery }
