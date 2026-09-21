const { Pool } = require('pg')
const config = require('../config')

let pool = null
let schemaReady = false

function getPool() {
  if (pool) return pool
  const options = config.databaseUrl
    ? { connectionString: config.databaseUrl }
    : config.pg
  pool = new Pool({
    ...options,
    max: 8,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 15000,
  })
  return pool
}

const CORE_SCHEMA = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    operation_id TEXT,
    created_at TEXT NOT NULL,
    "user" TEXT NOT NULL,
    operation TEXT NOT NULL,
    file_path TEXT,
    model TEXT,
    service TEXT,
    token_count INTEGER DEFAULT 0,
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    result TEXT,
    pytest_result TEXT,
    elapsed_seconds REAL DEFAULT 0,
    detail TEXT,
    status TEXT DEFAULT 'success'
);

CREATE TABLE IF NOT EXISTS diff_history (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    project_name TEXT,
    workspace_source TEXT,
    file_path TEXT,
    status TEXT DEFAULT 'pending',
    diff_text TEXT NOT NULL,
    old_content TEXT,
    new_content TEXT,
    instruction TEXT,
    source TEXT,
    model TEXT,
    additions INTEGER DEFAULT 0,
    removals INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS model_config (
    id SERIAL PRIMARY KEY,
    model_name TEXT NOT NULL,
    source TEXT NOT NULL,
    is_enabled INTEGER DEFAULT 1,
    note TEXT
);

CREATE TABLE IF NOT EXISTS project_file_index (
    id SERIAL PRIMARY KEY,
    file_path TEXT NOT NULL,
    summary TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS project_file_chunks (
    id SERIAL PRIMARY KEY,
    file_path TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding vector
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_operation ON audit_log (operation);
CREATE INDEX IF NOT EXISTS idx_diff_history_created_at ON diff_history (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_diff_history_project_name ON diff_history (project_name);
CREATE INDEX IF NOT EXISTS idx_project_file_index_path ON project_file_index (file_path);
CREATE INDEX IF NOT EXISTS idx_project_file_chunks_path ON project_file_chunks (file_path);
`

async function initializePostgresSchema() {
  const client = await getPool().connect()
  try {
    await client.query(CORE_SCHEMA)
    const countResult = await client.query('SELECT COUNT(*)::int AS count FROM model_config')
    if (Number(countResult.rows?.[0]?.count || 0) === 0) {
      await client.query(
        'INSERT INTO model_config (model_name, source, is_enabled, note) VALUES ($1, $2, $3, $4)',
        [config.ollamaModel, 'local_ollama', 1, 'Default local Ollama model']
      )
    }
    schemaReady = true
    return true
  } finally {
    client.release()
  }
}

async function ensureSchemaReady() {
  if (schemaReady) return true
  return initializePostgresSchema()
}

async function postgresHealth() {
  try {
    const client = await getPool().connect()
    try {
      const ping = await client.query('SELECT 1 AS ok')
      const schema = await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('audit_log', 'diff_history', 'model_config', 'project_file_index', 'project_file_chunks')
        ORDER BY table_name
      `)
      return {
        ok: Boolean(ping.rows?.[0]?.ok),
        status: 'running',
        provider: 'postgresql',
        host: config.databaseUrl ? 'DATABASE_URL' : config.pg.host,
        database: config.databaseUrl ? 'DATABASE_URL' : config.pg.database,
        schema_ready: schema.rows.length >= 5,
        tables: schema.rows.map(row => row.table_name),
      }
    } finally {
      client.release()
    }
  } catch (error) {
    return { ok: false, status: 'error', provider: 'postgresql', error: error.message }
  }
}

async function queryPostgres(sql, values = []) {
  await ensureSchemaReady()
  const client = await getPool().connect()
  try {
    const result = await client.query(sql, values)
    return result.rows
  } finally {
    client.release()
  }
}

async function executePostgres(sql, values = []) {
  await ensureSchemaReady()
  const client = await getPool().connect()
  try {
    return await client.query(sql, values)
  } finally {
    client.release()
  }
}

module.exports = {
  getPool,
  initializePostgresSchema,
  ensureSchemaReady,
  postgresHealth,
  queryPostgres,
  executePostgres,
}
