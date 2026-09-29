import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const componentPath = fileURLToPath(new URL('./ResultTabs.vue', import.meta.url))
const appPath = fileURLToPath(new URL('../App.vue', import.meta.url))
const source = fs.readFileSync(componentPath, 'utf8')
const appSource = fs.readFileSync(appPath, 'utf8')

test('terminal panel stays mounted while result tabs change', () => {
  assert.match(source, /v-show="activeTab === 'terminal'"/)
  assert.doesNotMatch(source, /v-else-if="activeTab === 'terminal'"/)
  assert.ok(source.indexOf("v-show=\"activeTab === 'terminal'\"") < source.indexOf("v-if=\"activeTab === 'diff'\" class=\"diff-panel\""))
})

test('bottom result tabs match the editor-first layout', () => {
  const tabGroup = appSource.match(/<div class="editor-title">[\s\S]*?<\/div>/)?.[0] || ''
  assert.match(tabGroup, /程式碼編輯器 <small>\(Monaco Editor\)<\/small>/)
  assert.match(tabGroup, /測試 \/ AI 執行結果/)
  assert.match(tabGroup, /修改差異/)
  assert.match(tabGroup, /終端機/)
  assert.match(tabGroup, /操作紀錄/)
})

test('multi-file diff summary displays every actually modified target', () => {
  assert.match(source, /實際修改檔案（\{\{ diffTargetFiles\.length \}\}）/)
  assert.match(source, /props\.diffInfo\?\.modifiedFiles/)
  assert.match(source, /多檔修改差異：\{\{ diffTargetLabel \}\}/)
})

test('multi-file execution evidence reports the full validated file count', () => {
  assert.match(source, /已逐檔驗證全部 \{\{ testUi\.total \}\} 個修改檔案/)
  assert.match(source, /多檔 Docker 逐檔驗證/)
  assert.match(source, /isMultiFileResult/)
})

test('empty diff copy distinguishes applied changes from pending changes', () => {
  assert.match(source, /目前沒有尚未套用的修改差異/)
  assert.match(source, /測試 \/ AI 執行結果/)
})

test('create-files result copy describes create and edit flow', () => {
  assert.match(source, /檔案處理完成/)
  assert.match(source, /自動建立 \/ 修改檔案成果/)
  assert.match(source, /建立、修改或檢查/)
})

test('a stopped automatic repair cannot be triggered again from the same failed result', () => {
  assert.match(appSource, /!testResult\.autoFixStopped/)
  assert.match(appSource, /failedResult\.autoFixStopped/)
})

test('app launch results do not expose a sandbox preview button', () => {
  assert.doesNotMatch(source, /class="sandbox-preview-actions"/)
  assert.doesNotMatch(source, /@click="openPreviewUrl"/)
  assert.doesNotMatch(source, />開啟預覽</)
  assert.match(source, /node_server_web_app/)
})

test('terminal commands are displayed and launched with their original text', () => {
  assert.doesNotMatch(source, /normalizeWindowsStartCommand/)
  assert.match(source, /const terminalCommand = computed\(\(\) => isTerminalHintResult\.value \? String\(props\.testResult\?\.command \|\| ''\)\.trim\(\) : ''\)/)
  assert.match(source, /formatCommand\(result\.command \|\| 'test dispatcher'\)/)
})

test('test tab running copy follows the shared AI execution loading state', () => {
  assert.match(source, /const resultLoading = computed\(\(\) => Boolean\(props\.loading\)\)/)
  assert.match(appSource, /loading\.result \? '正在準備 Sandbox\.\.\.' : '在 AI 沙盒執行'/)
  assert.match(source, /v-if="resultLoading" class="result-running"/)
  assert.match(source, /正在執行 \/ 開啟，請稍候\.\.\./)
  assert.doesNotMatch(source, /testLoading: Boolean/)
})

test('agent flow without a test result is not presented as a test run', () => {
  assert.match(source, /const hasAgentFlowWithoutResult = computed\(\(\) => !props\.testResult && Boolean\(displayAgentSteps\.value\.length\)\)/)
  assert.match(source, /v-else-if="hasAgentFlowWithoutResult">AI 流程尚未產生可套用結果，未執行沙盒測試/)
  assert.match(source, /!testResult \? 'AI 流程狀態'/)
  assert.match(source, /<div v-if="testResult" class="test-command-grid">/)
  assert.match(source, /<div v-if="testResult" class="metric-grid">/)
  assert.match(source, /AI 修改流程沒有產生可套用差異，因此尚未進入沙盒測試/)
})
