const http = require('http')
const express = require('express')
const cors = require('cors')
const config = require('./config')
const { initializePostgresSchema } = require('./db/postgres')
const { initializeCleanHistoryOnce } = require('./services/firstRunService')
const { ensureStartupWorkspace } = require('./services/workspaceBootstrapService')
const { startTerminalSocket } = require('./services/terminalService')
const {
  handleSandboxAppHttp,
  attachSandboxAppWebSocketProxy,
} = require('./services/sandboxAppService')

const app = express()
app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '20mb' }))
app.use(express.urlencoded({ extended: true, limit: '20mb' }))

app.use('/api', require('./routes/health'))
app.use('/api/auth', require('./routes/auth'))
app.use('/api/ai', require('./routes/ai'))
app.use('/api/projects', require('./routes/projects'))
app.use('/api/files', require('./routes/files'))
app.use('/api/diff', require('./routes/diff'))
app.use('/api/diagnostics', require('./routes/diagnostics'))
app.use('/api/format', require('./routes/format'))
app.use('/api/agent', require('./routes/agent'))
app.use('/api/audit', require('./routes/audit'))
app.use('/api/db', require('./routes/db'))
app.use('/api/model', require('./routes/model'))
app.use('/api/codex', require('./routes/codex'))
app.use('/api/terminal', require('./routes/terminal'))
app.use('/api/sandbox/apps', require('./routes/sandboxApps'))
app.use('/api/tasks', require('./routes/tasks'))
app.use('/api', require('./routes/functionOptions'))
app.use('/api/chat', require('./routes/chat'))
app.use('/api/rag', require('./routes/rag'))
app.use(handleSandboxAppHttp)

app.get('/', (_req, res) => {
  res.json({
    name: 'Cubi Code',
    role: '企業內部 AI 寫程式系統雛型 / AI Coding Assistant',
    backend: 'Node.js / Express API',
    database: ['PostgreSQL'],
    model: config.ollamaModel,
    model_routing: config.modelRoutingMode,
    status: 'running',
  })
})

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(err.statusCode || 500).json({ detail: err.message || 'Internal Server Error' })
})

async function startServer() {
  try {
    const workspace = ensureStartupWorkspace()
    console.log(`[Cubi Code Node Backend] ${workspace.created ? 'created' : 'opened'} workspace ${workspace.path}`)
  } catch (error) {
    console.error('[Cubi Code Node Backend] workspace init failed:', error.message)
    throw error
  }

  try {
    await initializePostgresSchema()
    console.log('[Cubi Code Node Backend] PostgreSQL schema ready')
  } catch (error) {
    console.warn('[Cubi Code Node Backend] PostgreSQL init failed:', error.message)
  }

  try {
    const firstRun = await initializeCleanHistoryOnce()
    if (!firstRun.skipped) console.log('[Cubi Code Node Backend] first-run history cleaned')
  } catch (error) {
    console.warn('[Cubi Code Node Backend] first-run history cleanup failed:', error.message)
  }

  const server = http.createServer(app)
  attachSandboxAppWebSocketProxy(server)
  startTerminalSocket(server)

  server.listen(config.port, config.host, () => {
    console.log(`[Cubi Code Node Backend] http://${config.host}:${config.port}`)
    console.log(`[Cubi Code Node Backend] terminal socket ${config.terminal.socketPath}`)
  })
}

if (require.main === module) startServer()

module.exports = app
