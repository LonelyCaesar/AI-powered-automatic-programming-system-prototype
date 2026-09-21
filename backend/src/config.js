const path = require('path')
const dotenv = require('dotenv')

const backendDir = path.resolve(__dirname, '..')
const projectRoot = path.resolve(backendDir, '..')
// All user-created projects live under <Cubi root>/my_project.
// Keep projectRoot as the application root because other config files resolve from it.
const projectsDir = path.resolve(projectRoot, 'my_project')
dotenv.config({ path: path.join(backendDir, '.env') })
dotenv.config()

function boolEnv(name, defaultValue = false) {
  const value = String(process.env[name] ?? '').trim().toLowerCase()
  if (!value) return defaultValue
  return ['1', 'true', 'yes', 'on'].includes(value)
}

function intEnv(name, defaultValue) {
  const parsed = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(parsed) ? parsed : defaultValue
}

function intListEnv(name, defaultValue = []) {
  const raw = String(process.env[name] ?? '').trim()
  const values = (raw ? raw.split(',') : defaultValue)
    .map(value => Number.parseInt(String(value).trim(), 10))
    .filter(value => Number.isFinite(value) && value > 0 && value <= 65535)
  return [...new Set(values)]
}

function resolveProjectPath(value, fallbackParts = []) {
  const raw = String(value || '').trim()
  const target = raw ? raw : path.join(...fallbackParts)
  const resolved = path.isAbsolute(target) ? target : path.resolve(projectRoot, target)
  return resolved
}

function resolveWorkspaceDir() {
  const raw = String(process.env.CUBI_WORKSPACE_DIR || process.env.SANDBOX_DIR || '').trim()
  return !raw
    ? path.join(projectsDir, 'my_project')
    : path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(projectsDir, raw)
}

function resolveTerminalCwd() {
  const raw = String(process.env.CUBI_TERMINAL_CWD || '').trim()
  return !raw
    ? resolveWorkspaceDir()
    : path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(projectsDir, raw)
}

module.exports = {
  appName: process.env.APP_NAME || 'Cubi Code',
  host: process.env.HOST || '127.0.0.1',
  port: intEnv('PORT', 8000),
  backendDir,
  projectRoot,
  projectsDir,
  workspaceDir: resolveWorkspaceDir(),
  // Backward-compatible alias. This is the user's project workspace, not the
  // isolated Docker sandbox used for AI execution.
  sandboxDir: resolveWorkspaceDir(),
  sandboxWorkspacesDir: resolveProjectPath(process.env.CUBI_SANDBOX_WORKSPACES_DIR, ['backend', 'data', 'sandbox-workspaces']),
  allowedTablesPath: resolveProjectPath(process.env.ALLOWED_TABLES_PATH, ['backend', 'data', 'allowed_tables.json']),
  enterpriseAllowedTablesPath: resolveProjectPath(process.env.ENTERPRISE_ALLOWED_TABLES_PATH, ['backend', 'data', 'enterprise_allowed_tables.json']),
  maxDbRows: intEnv('MAX_DB_ROWS', 50),
  enterpriseDbMaxRows: intEnv('ENTERPRISE_DB_MAX_ROWS', 100),
  loginUsername: process.env.CUBI_LOGIN_USERNAME || 'admin',
  loginPassword: process.env.CUBI_LOGIN_PASSWORD || 'cubi1234',
  clearHistoryOnFirstStart: boolEnv('CUBI_CLEAR_HISTORY_ON_FIRST_START', true),
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'auto',
  autocompleteModel: process.env.AUTOCOMPLETE_MODEL || '',
  modelSource: process.env.MODEL_SOURCE || 'local_ollama',
  modelRoutingMode: process.env.MODEL_ROUTING_MODE || 'local_first',
  ollamaConnectTimeoutMs: intEnv('OLLAMA_CONNECT_TIMEOUT', 5000),
  ollamaReadTimeoutMs: intEnv('OLLAMA_READ_TIMEOUT', 300000),
  agentLoopLlmTimeoutMs: intEnv('AGENT_LOOP_LLM_TIMEOUT_MS', 120000),
  ollamaNumPredict: intEnv('OLLAMA_NUM_PREDICT', 900),
  ollamaNumCtx: intEnv('OLLAMA_NUM_CTX', 16384),
  ollamaMaxRetries: intEnv('OLLAMA_MAX_RETRIES', 1),
  autocompleteTimeoutMs: intEnv('AUTOCOMPLETE_TIMEOUT_MS', 25000),
  autocompleteNumPredict: intEnv('AUTOCOMPLETE_NUM_PREDICT', 220),
  autocompleteNumCtx: intEnv('AUTOCOMPLETE_NUM_CTX', 4096),
  autocompleteKeepAlive: process.env.AUTOCOMPLETE_KEEP_ALIVE || '10m',
  ollamaModelCacheTtlMs: intEnv('OLLAMA_MODEL_CACHE_TTL_MS', 30000),
  cloudApiEnabled: boolEnv('CLOUD_API_ENABLED', false),
  cloudApiProvider: process.env.CLOUD_API_PROVIDER || 'OpenAI / Azure OpenAI API',
  cloudApiBaseUrl: process.env.CLOUD_API_BASE_URL || 'https://api.openai.com/v1',
  cloudApiKey: process.env.CLOUD_API_KEY || process.env.OPENAI_API_KEY || process.env.AZURE_OPENAI_API_KEY || '',
  cloudModel: process.env.CLOUD_MODEL || 'gpt-4.1-mini',
  requireCloudApproval: boolEnv('REQUIRE_CLOUD_APPROVAL', true),
  dbProvider: String(process.env.DB_PROVIDER || 'postgresql').toLowerCase(),
  enterpriseDbProvider: String(process.env.ENTERPRISE_DB_PROVIDER || 'postgresql').toLowerCase(),
  databaseUrl: process.env.DATABASE_URL || '',
  pg: {
    host: process.env.DB_HOST || 'localhost',
    port: intEnv('DB_PORT', 5432),
    database: process.env.DB_NAME || 'cubi_postgres',
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || 'password',
  },
  dockerSandbox: {
    mode: String(process.env.DOCKER_SANDBOX_MODE || 'auto').toLowerCase(),
    image: process.env.DOCKER_SANDBOX_IMAGE || 'cubi-code-pytest-sandbox:latest',
    timeout: intEnv('DOCKER_SANDBOX_TIMEOUT', 60),
    aiFeatureTimeout: intEnv('AI_FEATURE_SANDBOX_TIMEOUT', 120),
    memory: process.env.DOCKER_SANDBOX_MEMORY || '512m',
    cpus: process.env.DOCKER_SANDBOX_CPUS || '1.0',
    networkDisabled: boolEnv('DOCKER_SANDBOX_NETWORK_DISABLED', false),
    pidsLimit: intEnv('DOCKER_SANDBOX_PIDS_LIMIT', 128),
  },
  terminal: {
    mode: String(process.env.CUBI_TERMINAL_MODE || 'sandbox').toLowerCase(),
    profile: String(process.env.CUBI_TERMINAL_PROFILE || 'cmd').toLowerCase(),
    shell: process.env.CUBI_TERMINAL_SHELL || '',
    cwd: resolveTerminalCwd(),
    cols: intEnv('CUBI_TERMINAL_COLS', 100),
    rows: intEnv('CUBI_TERMINAL_ROWS', 30),
    socketPath: process.env.CUBI_TERMINAL_SOCKET_PATH || '/socket.io',
    // Optional Windows X11 display for GUI apps launched from the human Docker Sandbox terminal.
    // This is intentionally separate from dockerSandbox.networkDisabled so AI sandboxes can remain offline.
    x11Enabled: boolEnv('CUBI_TERMINAL_X11_ENABLED', false),
    x11Display: process.env.CUBI_TERMINAL_X11_DISPLAY || 'host.docker.internal:0.0',
    network: String(process.env.CUBI_TERMINAL_NETWORK || 'bridge').toLowerCase(),
    // A human Sandbox terminal gets exactly one random application port.
    // Port 0 and 1..1023 are avoided because they are not reliable browser
    // targets for non-root processes inside the Docker terminal.
    // Generated web apps read PORT/CUBI_APP_PORT at runtime instead of hard-coding 3000/5000/etc.
    appPortMin: intEnv('CUBI_TERMINAL_APP_PORT_MIN', 1024),
    appPortMax: intEnv('CUBI_TERMINAL_APP_PORT_MAX', 9999),
  },
}
