import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const componentPath = fileURLToPath(new URL('./TerminalPanel.vue', import.meta.url))
const source = fs.readFileSync(componentPath, 'utf8')

test('terminal mode is shown as a fixed Docker Sandbox label', () => {
  assert.match(source, /<span class="terminal-mode-badge">Docker Sandbox<\/span>/)
  assert.doesNotMatch(source, /<select v-model="terminalMode"/)
  assert.doesNotMatch(source, /<option value="sandbox">/)
  assert.doesNotMatch(source, /<option value="host_cmd">/)
  assert.doesNotMatch(source, /<option value="host_powershell">/)
})

test('terminal status copy identifies Docker Sandbox execution', () => {
  assert.match(source, /terminalStatus\.value\.modes \|\| \{\}/)
  assert.match(source, /modes\[terminalMode\.value\]/)
  assert.match(source, /commandTargetLabel/)
  assert.match(source, /selectedModeLabel/)
  assert.match(source, /Docker Sandbox/)
  assert.match(source, /X Server/)
  assert.match(source, /\/api\/terminal\/xserver\/status/)
  assert.match(source, /\/api\/terminal\/xserver\/start/)
  assert.match(source, /xServerReady/)
})

test('terminal sends start commands directly to CMD like a normal Windows terminal', () => {
  assert.doesNotMatch(source, /normalizeWindowsStartCommand/)
  assert.match(source, /term\.onData\(handleTerminalInput\)/)
  assert.doesNotMatch(source, /socket\?*\.emit\('terminal:openStartCommand'/)
  assert.match(source, /const command = String\(props\.initialCommand \|\| ''\)\.trim\(\)/)
  assert.match(source, /socket\.emit\('terminal:input', `\$\{command\}\\r`\)/)
})

test('terminal preserves control-key sequences for CMD history navigation', () => {
  assert.match(source, /function isTerminalFocusSequence\(text = ''\)/)
  assert.match(source, /return text === '\\u001b\[I' \|\| text === '\\u001b\[O'/)
  assert.match(source, /function isTerminalEscapeSequence\(text = ''\)/)
  assert.match(source, /socket\.emit\('terminal:input', text\)/)
})

test('terminal controls remain visible in the short bottom panel', () => {
  assert.match(source, /\.sandbox-terminal-shell \{[\s\S]*?overflow: visible;/)
  assert.match(source, /\.sandbox-terminal-toolbar \{[\s\S]*?position: sticky;/)
  assert.match(source, /\.sandbox-terminal-view \{[\s\S]*?min-height: 1000px;/)
})

test('terminal mouse wheel scrolls the outer result panel when it overflows', () => {
  assert.match(source, /@wheel="handleTerminalWheel"/)
  assert.match(source, /closest\?\.\('\.panel-body-terminal'\)/)
  assert.match(source, /scroller\.scrollTop \+= event\.deltaY/)
  assert.match(source, /event\.preventDefault\(\)/)
})


test('terminal has no Web Port mapping toolbar or fixed-port summary output', () => {
  assert.doesNotMatch(source, /terminal:ports/)
  assert.doesNotMatch(source, /forwardedPorts/)
  assert.doesNotMatch(source, /Sandbox Web Port/)
  assert.doesNotMatch(source, /class="sandbox-terminal-portbar"/)
  assert.doesNotMatch(source, />Web Port</)
  assert.doesNotMatch(source, /開啟 Port/)
})


test('terminal start is bound to the currently selected project', () => {
  assert.match(source, /projectName: \{ type: String, default: '' \}/)
  assert.match(source, /project_name: props\.projectName \|\| ''/)
  assert.match(source, /if \(socket\?\.connected\) \{\s*emitTerminalStart\(\)/)
})

test('terminal does not render the suggested Python launch card', () => {
  assert.match(source, /currentFile: \{ type: String, default: '' \}/)
  assert.match(source, /currentContent: \{ type: String, default: '' \}/)
  assert.match(source, /files: \{ type: Array, default: \(\) => \[\] \}/)
  assert.doesNotMatch(source, /建議啟動檔/)
  assert.doesNotMatch(source, /sandbox-terminal-runhint/)
  assert.doesNotMatch(source, /\[hint\] 建議啟動/)
  assert.doesNotMatch(source, /啟動後請開/)
  assert.match(source, /pythonEntryCandidates/)
  assert.match(source, /commandForPythonEntry/)
  assert.match(source, /function isTkinterPythonSource\(source = ''\)/)
  assert.match(source, /if \(isTkinterPythonEntry\(first\.path\)\) return null/)
  assert.match(source, /if \(!opensUrl\) return null/)
  assert.match(source, /function isStreamlitPythonSource\(source = ''\)/)
  assert.match(source, /streamlit run \$\{shellQuote\(normalized\)\} --server\.address=0\.0\.0\.0 --server\.port=\$PORT --server\.headless=true --browser\.gatherUsageStats=false/)
  assert.match(source, /commandWithRuntimePort\(commandForPythonEntry\(path\)\)/)
  assert.match(source, /replace\(\/\\\$PORT\\b\/g, String\(port\)\)/)
  assert.doesNotMatch(source, /Tkinter 桌面 GUI：/)
  assert.match(source, /return `flask run \$\{shellQuote\(normalized\)\}`/)
})

test('terminal launch commands open URLs from Sandbox output', () => {
  assert.match(source, /function isSandboxLaunchCommand\(command = ''\)/)
  assert.match(source, /flask\\s\+run\\s\+\.\+\\\.py/)
  assert.match(source, /streamlit\\s\+run\\s\+\.\+\\\.py/)
  assert.match(source, /start\\s\+\.\+\\\.html\?/)
  assert.match(source, /return isWebPythonSource\(pythonSourceForPath\(path\)\)/)
  assert.match(source, /function prepareTerminalPreviewWindow\(command = ''\)/)
  assert.match(source, /window\.open\('about:blank', '_blank'\)/)
  assert.match(source, /socket\.on\('terminal:open-url'/)
  assert.match(source, /openTerminalPreviewUrl\(url\)/)
  assert.match(source, /writeLine\(`\\r\\n\[open\] \$\{target\}`\)/)
  assert.doesNotMatch(source, /瀏覽器封鎖自動開啟/)
})
