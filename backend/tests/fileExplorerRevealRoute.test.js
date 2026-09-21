const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const source = fs.readFileSync(path.resolve(__dirname, '../src/routes/files.js'), 'utf8')
const fileToolsSource = fs.readFileSync(path.resolve(__dirname, '../src/tools/fileTools.js'), 'utf8')

test('file tree route can explicitly ensure the configured workspace exists', () => {
  assert.match(source, /router\.get\('\/tree'/)
  assert.match(source, /req\.query\.ensure/)
  assert.match(source, /ensureProjectWorkspace\(\)/)
})

test('file explorer reveal route resolves only workspace-safe paths', () => {
  assert.match(source, /router\.post\('\/reveal'/)
  assert.match(source, /resolveSafePath\(relativePath\)/)
  assert.match(source, /fs\.existsSync\(target\)/)
})

test('file explorer reveal route uses the native host file manager', () => {
  assert.match(source, /explorer\.exe/)
  assert.match(source, /xdg-open/)
  assert.match(source, /command = 'open'/)
  assert.match(source, /child\.once\('error'/)
})

test('file deletion requires explicit confirmation for the configured workspace root', () => {
  assert.match(fileToolsSource, /function deleteFile\(filePath, options = \{\}\)/)
  assert.match(fileToolsSource, /options = \{\}/)
  assert.match(fileToolsSource, /isWorkspaceRoot && options\.allowRoot !== true/)
  assert.match(fileToolsSource, /刪除目前專案根資料夾需要明確確認/)
  assert.match(fileToolsSource, /workspace_deleted: isWorkspaceRoot/)
  assert.match(source, /const allowRoot = req\.body\.allow_root === true/)
  assert.match(source, /stopAllTerminalSessions\('workspace_deleted'\)/)
})

test('file deletion retries Windows permission failures with shell fallbacks', () => {
  assert.match(fileToolsSource, /function windowsShellDelete\(target\)/)
  assert.match(fileToolsSource, /rmdir \/s \/q/)
  assert.match(fileToolsSource, /Remove-Item -LiteralPath/)
  assert.match(fileToolsSource, /EACCES', 'EPERM', 'ENOTEMPTY', 'EBUSY/)
  assert.match(fileToolsSource, /makeTreeWritable\(target\)/)
})

test('file explorer lists and reads common image files as readonly previews', () => {
  assert.match(fileToolsSource, /const imageExt = new Set\(\['\.png', '\.jpg', '\.jpeg', '\.gif', '\.webp'\]\)/)
  assert.match(fileToolsSource, /function isImageFile\(filePath = ''\)/)
  assert.match(fileToolsSource, /content_type: 'image'/)
  assert.match(fileToolsSource, /function readImageFile\(filePath\)/)
  assert.match(fileToolsSource, /data:\$\{mimeType\};base64/)
  assert.match(source, /if \(isImageFile\(req\.body\.file_path\)\) \{/)
  assert.match(source, /preview_url: image\.content/)
  assert.match(source, /content_type: 'image'/)
  assert.match(source, /readonly: true/)
})
