const config = require('../config')
const { loadAllowedTables, validateSafeSelect } = require('./dbGuard')
const { queryPostgres, postgresHealth } = require('../db/postgres')
const { askLlm } = require('../core/llmClient')

function enterprisePlan() {
  const allowed = loadAllowedTables(config.enterpriseAllowedTablesPath)
  return {
    ok: true,
    type: 'enterprise_db_plan',
    provider: 'postgresql',
    postgresql: {
      enabled: true,
      host: config.databaseUrl ? 'DATABASE_URL' : config.pg.host,
      database: config.databaseUrl ? 'DATABASE_URL' : config.pg.database,
    },
    safety: {
      read_only: true,
      allowlisted_tables: Object.keys(allowed),
      max_rows: config.enterpriseDbMaxRows,
      chunking: true,
      dangerous_sql_blocked: true,
    },
    note: 'Node.js backend uses PostgreSQL as the primary database. Start Docker PostgreSQL first, then run npm run init-db / npm run dev.',
  }
}

async function schemaSummary() {
  const allowed = loadAllowedTables(config.enterpriseAllowedTablesPath)
  const pg = await postgresHealth()
  return {
    ok: true,
    provider: 'postgresql',
    postgresql: pg,
    allowed_tables: allowed,
  }
}

async function safeEnterpriseQuery(sql) {
  const allowed = loadAllowedTables(config.enterpriseAllowedTablesPath)
  const validation = validateSafeSelect(sql, allowed, config.enterpriseDbMaxRows)
  if (!validation.ok) return { ok: false, blocked: true, error: validation.error, sql }
  try {
    const rows = await queryPostgres(validation.sql)
    return { ok: true, provider: 'postgresql', sql: validation.sql, rows, row_count: rows.length, tables: validation.tables, limited: true, sql_validated: true }
  } catch (error) {
    return { ok: false, provider: 'postgresql', sql: validation.sql, error: error.message, tables: validation.tables, sql_validated: true }
  }
}

function inferSql(question, tableHint = '') {
  const raw = String(question || '')
  const table = tableHint || (raw.includes('模型') ? 'model_config' : raw.includes('索引') ? 'project_file_index' : 'audit_log')
  if (table === 'model_config') return 'SELECT model_name, source, is_enabled, note FROM model_config ORDER BY id DESC LIMIT 20'
  if (table === 'project_file_index') return 'SELECT file_path, summary, updated_at FROM project_file_index ORDER BY id DESC LIMIT 20'
  return 'SELECT created_at, "user", operation, file_path, model, service, token_count, result, status FROM audit_log ORDER BY id DESC LIMIT 20'
}

async function answerDatabaseQuestion(question, tableHint = '') {
  const sql = inferSql(question, tableHint)
  const query = await safeEnterpriseQuery(sql)
  let answer = '已完成 PostgreSQL 安全查詢摘要。'
  if (query.ok) {
    const rows = query.rows.slice(0, 5)
    const prompt = `Summarize these PostgreSQL rows in Traditional Chinese for a Cubi Code admin.\nQuestion: ${question}\nRows JSON:\n${JSON.stringify(rows, null, 2)}`
    const llm = await askLlm(prompt, {
      temperature: 0.2,
      numPredict: 500,
      requestEndpoint: '/api/db/enterprise-query',
    })
    answer = llm.ok ? llm.content : `共查到 ${query.row_count} 筆；模型摘要不可用：${llm.error || 'Ollama 未連線'}。`
  }
  return { ok: query.ok, type: 'enterprise_db_ask', answer, table: query.tables?.[0] || 'audit_log', query }
}

module.exports = { enterprisePlan, schemaSummary, safeEnterpriseQuery, answerDatabaseQuestion }
