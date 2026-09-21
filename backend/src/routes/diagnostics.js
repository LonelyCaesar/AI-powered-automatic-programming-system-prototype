const express = require('express')
const path = require('path')
const espree = require('espree')
const { stageProjectWorkspace } = require('../services/sandboxWorkspaceService')
const sandboxService = require('../services/sandboxService')

const router = express.Router()

function normalizeRelativePath(filePath = '') {
  const clean = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '')
  const normalized = path.posix.normalize(clean)
  if (!normalized || normalized === '..' || normalized.startsWith('../')) return ''
  return normalized
}

function languageFromPath(filePath = '', supplied = '') {
  const language = String(supplied || '').toLowerCase()
  if (language) return language
  const extension = path.posix.extname(String(filePath || '').toLowerCase())
  if (extension === '.py') return 'python'
  if (extension === '.java') return 'java'
  if (['.js', '.mjs', '.cjs'].includes(extension)) return 'javascript'
  if (extension === '.json') return 'json'
  return ''
}

function marker(filePath, line, column, message, severity = 'error') {
  const startLineNumber = Math.max(1, Number(line) || 1)
  const startColumn = Math.max(1, Number(column) || 1)
  return {
    file_path: filePath,
    message: String(message || 'Syntax error'),
    severity,
    startLineNumber,
    startColumn,
    endLineNumber: startLineNumber,
    endColumn: startColumn + 1,
  }
}

function firstDiagnosticLine(text = '') {
  return String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean) || ''
}

function isDiagnosticsInfrastructureFailure(result = {}) {
  const output = [
    result.stderr,
    result.stdout,
    result.error,
    result.sandbox?.error,
  ].map(value => String(value || '')).join('\n')
  return /Docker Sandbox 未就緒|permission denied while trying to connect to the docker API|docker_engine|Access is denied|missing_cli|image_missing_or_daemon_down|Diagnostics unavailable/i.test(output)
}

function fallbackDiagnosticMarker(filePath, result = {}) {
  if (isDiagnosticsInfrastructureFailure(result)) return null
  const message = firstDiagnosticLine(result.stderr) ||
    firstDiagnosticLine(result.stdout) ||
    firstDiagnosticLine(result.error) ||
    firstDiagnosticLine(result.sandbox?.error) ||
    'Diagnostics check failed, but no line-level marker was produced.'

  return marker(filePath, 1, 1, message.slice(0, 500), 'warning')
}

function parsePythonMarkers(output = '', filePath = '') {
  const markers = []
  const pattern = new RegExp(`${filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+):(\\d+):\\s*SyntaxError:\\s*(.+)`, 'g')
  let match
  while ((match = pattern.exec(String(output || ''))) !== null) {
    markers.push(marker(filePath, match[1], match[2], `SyntaxError: ${match[3]}`))
  }
  return markers
}

function parseNodeMarkers(output = '', filePath = '') {
  const text = String(output || '')
  const jsonMatch = text.match(/(.+?):(\d+):(\d+):\s*JSONError:\s*(.+)/)
  if (jsonMatch) return [marker(filePath, jsonMatch[2], jsonMatch[3], `JSONError: ${jsonMatch[4]}`)]

  const syntaxLine = text.split(/\r?\n/).find(line => /SyntaxError|Error:/.test(line))
  const caretIndex = text.split(/\r?\n/).findIndex(line => /\^/.test(line))
  const lineNumber = caretIndex > 0 ? caretIndex : 1
  const column = caretIndex >= 0 ? Math.max(1, text.split(/\r?\n/)[caretIndex].indexOf('^') + 1) : 1
  return syntaxLine ? [marker(filePath, lineNumber, column, syntaxLine.trim())] : []
}

function javascriptParserOptions(code = '', filePath = '') {
  const text = String(code || '')
  const lowerPath = String(filePath || '').toLowerCase()
  return {
    ecmaVersion: 'latest',
    sourceType: /(^|\n)\s*(?:import|export)\b/.test(text) ? 'module' : 'script',
    ecmaFeatures: {
      jsx: /\.(?:jsx|tsx)$/i.test(lowerPath) || /<[A-Z][A-Za-z0-9]*(?:\s|>|\/>)/.test(text) || /<\w+[\s>][\s\S]*<\/\w+>/.test(text),
    },
  }
}

function parseJavaScriptMarkers(code = '', filePath = '') {
  try {
    espree.parse(String(code || ''), javascriptParserOptions(code, filePath))
    return []
  } catch (error) {
    return [marker(
      filePath,
      error.lineNumber || error.line || 1,
      error.column || 1,
      `SyntaxError: ${error.description || error.message || 'JavaScript syntax error'}`
    )]
  }
}

function parseJavaMarkers(output = '', filePath = '') {
  const markers = []
  const pattern = /(.+?\.java):(\d+):\s*(error|warning):\s*(.+)/g
  let match
  while ((match = pattern.exec(String(output || ''))) !== null) {
    const matchedPath = normalizeRelativePath(match[1])
    if (matchedPath && matchedPath !== filePath) continue
    markers.push(marker(filePath, match[2], 1, `${match[3]}: ${match[4]}`, match[3] === 'warning' ? 'warning' : 'error'))
  }
  return markers
}

async function runJavaSyntaxCheck(filePath, options) {
  const command = `javac -Xlint:all -d /tmp/cubi-javac-out '${filePath.replace(/'/g, `'\\''`)}'`
  return sandboxService.runCommandInSandbox(['sh', '-lc', command], options)
}

async function runPythonNameCheck(filePath, options) {
  const checker = `
import ast
import builtins
import json
import sys

target = sys.argv[1]
known_names = set(dir(builtins)) | {'True', 'False', 'None', '__name__', '__file__', '__package__'}

def add_target_names(node, names):
    if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Param)):
        names.add(node.id)
    elif isinstance(node, (ast.Tuple, ast.List)):
        for item in node.elts:
            add_target_names(item, names)

try:
    with open(target, 'r', encoding='utf-8') as handle:
        source = handle.read()
    tree = ast.parse(source, filename=target)
except SyntaxError:
    print(json.dumps({'markers': []}))
    sys.exit(0)
except Exception as exc:
    print(json.dumps({'markers': [], 'error': str(exc)}))
    sys.exit(0)

defined = set(known_names)
for node in ast.walk(tree):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        defined.add(node.name)
    elif isinstance(node, ast.Import):
        for alias in node.names:
            defined.add(alias.asname or alias.name.split('.')[0])
    elif isinstance(node, ast.ImportFrom):
        for alias in node.names:
            if alias.name != '*':
                defined.add(alias.asname or alias.name)
    elif isinstance(node, ast.ExceptHandler) and node.name:
        defined.add(node.name)
    elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
        defined.add(node.id)
    elif isinstance(node, ast.arg):
        defined.add(node.arg)

markers = []
seen = set()
for node in ast.walk(tree):
    if not isinstance(node, ast.Name) or not isinstance(node.ctx, ast.Load):
        continue
    if node.id in defined:
        continue
    key = (node.lineno, node.col_offset, node.id)
    if key in seen:
        continue
    seen.add(key)
    markers.append({
        'line': node.lineno,
        'column': node.col_offset + 1,
        'message': "NameError: name '{}' is not defined".format(node.id),
        'severity': 'error',
    })
    if len(markers) >= 20:
        break

print(json.dumps({'markers': markers}))
`
  return sandboxService.runCommandInSandbox(['python3', '-c', checker, filePath], options)
}

function parsePythonNameMarkers(output = '', filePath = '') {
  try {
    const parsed = JSON.parse(String(output || '').trim() || '{}')
    return (Array.isArray(parsed.markers) ? parsed.markers : []).map(item =>
      marker(filePath, item.line, item.column, item.message, item.severity || 'error')
    )
  } catch {
    return []
  }
}

router.post('/check', async (req, res) => {
  const filePath = normalizeRelativePath(req.body.file_path || req.body.filePath || '')
  const code = String(req.body.code ?? req.body.content ?? '')
  const language = languageFromPath(filePath, req.body.language || req.body.language_id)

  if (!filePath || !code.trim()) {
    return res.json({ ok: true, markers: [], language, file_path: filePath })
  }

  try {
    const workspace = stageProjectWorkspace({
      projectId: req.body.project_id || req.body.workspace_id || '',
      projectName: req.body.project_name || 'project',
      workspaceSource: req.body.workspace_source || '',
      filePath,
      code,
      contextFiles: req.body.context_files || [],
    })
    const sandboxOptions = { workspaceId: workspace.id }
    let result
    let markers = []

    if (language === 'python') {
      result = await sandboxService.runPythonSyntaxCheckInSandbox([filePath], sandboxOptions)
      markers = parsePythonMarkers(`${result.stdout || ''}\n${result.stderr || ''}`, filePath)
      if (result.ok === true) {
        const nameResult = await runPythonNameCheck(filePath, sandboxOptions)
        const nameMarkers = parsePythonNameMarkers(nameResult.stdout, filePath)
        if (nameMarkers.length) {
          markers = nameMarkers
          result = {
            ...result,
            ok: false,
            kind: 'python_static_names',
            stdout: `${result.stdout || ''}\n${nameResult.stdout || ''}`.trim(),
            stderr: `${result.stderr || ''}\n${nameResult.stderr || ''}`.trim(),
          }
        }
      }
    } else if (language === 'javascript') {
      markers = parseJavaScriptMarkers(code, filePath)
      result = {
        ok: markers.length === 0,
        kind: 'javascript_jsx_parser',
        stdout: '',
        stderr: markers.map(item => `${filePath}:${item.startLineNumber}:${item.startColumn}: ${item.message}`).join('\n'),
        sandbox: {
          engine: 'espree',
          isolated: false,
          status: markers.length === 0 ? 'passed' : 'failed',
        },
      }
    } else if (language === 'json') {
      result = await sandboxService.runNodeSyntaxCheckInSandbox([filePath], sandboxOptions)
      markers = parseNodeMarkers(`${result.stdout || ''}\n${result.stderr || ''}`, filePath)
    } else if (language === 'java') {
      result = await runJavaSyntaxCheck(filePath, sandboxOptions)
      markers = parseJavaMarkers(`${result.stdout || ''}\n${result.stderr || ''}`, filePath)
    } else {
      return res.json({ ok: true, markers: [], language, file_path: filePath, skipped: true })
    }

    let diagnostic_notice = ''
    if (result.ok !== true && !markers.length) {
      if (isDiagnosticsInfrastructureFailure(result)) {
        diagnostic_notice = firstDiagnosticLine(result.stderr) ||
          firstDiagnosticLine(result.stdout) ||
          firstDiagnosticLine(result.error) ||
          'Diagnostics unavailable.'
        markers = []
      } else {
        markers = [fallbackDiagnosticMarker(filePath, result)].filter(Boolean)
      }
    }

    res.json({
      ok: result.ok === true,
      language,
      file_path: filePath,
      markers,
      diagnostic_notice,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      sandbox: result.sandbox || null,
    })
  } catch (error) {
    res.status(200).json({
      ok: false,
      language,
      file_path: filePath,
      markers: [],
      diagnostic_notice: `Diagnostics unavailable: ${error.message}`,
      error: error.message,
    })
  }
})

module.exports = router
module.exports.fallbackDiagnosticMarker = fallbackDiagnosticMarker
module.exports.parseJavaScriptMarkers = parseJavaScriptMarkers
module.exports.parsePythonNameMarkers = parsePythonNameMarkers
module.exports.isDiagnosticsInfrastructureFailure = isDiagnosticsInfrastructureFailure
