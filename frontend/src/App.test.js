import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const appPath = fileURLToPath(new URL('./App.vue', import.meta.url))
const stylePath = fileURLToPath(new URL('./style.css', import.meta.url))
const source = fs.readFileSync(appPath, 'utf8')
const styleSource = fs.readFileSync(stylePath, 'utf8')

test('agent loop stream has idle and total timeout guards', () => {
  assert.match(source, /AGENT_LOOP_IDLE_TIMEOUT_MS/)
  assert.match(source, /AGENT_LOOP_TOTAL_TIMEOUT_MS/)
  assert.match(source, /failAgentLoop\(`Agent 串流已/)
  assert.match(source, /failAgentLoop\(`Agent 執行已超過/)
  assert.match(source, /if \(data\.type === 'heartbeat'\) \{\s+return\s+\}/)
  assert.match(source, /source\.onerror = \(\) => \{\s*failAgentLoop\('SSE 連線中斷。'/)
})

test('create-files UI copy describes file handling instead of only new files', () => {
  assert.match(source, /create_files: '建立 \/ 修改檔案'/)
  assert.match(source, /AI 自動處理檔案逾時/)
  assert.match(source, /檔案處理清單/)
})

test('create-files completion only suggests running tests when files changed', () => {
  assert.match(source, /const hasFileChanges = files\.length > 0/)
  assert.match(source, /const testGuide = hasFileChanges/)
  assert.match(source, /未新增或修改檔案，因此不需要執行測試/)
})

test('task session copy no longer tells users they are opening a new chat', () => {
  assert.match(source, /已開啟新任務/)
  assert.match(source, /清空任務紀錄/)
  assert.match(source, /切換任務紀錄/)
  assert.doesNotMatch(source, /已開啟新對話/)
})

test('placeholder task text is rejected before running create-files', () => {
  assert.match(source, /function isPlaceholderTaskInstruction/)
  assert.match(source, /這句是輸入提示，不是實際任務/)
  assert.match(source, /建立 login\.html、style\.css、script\.js/)
  assert.match(source, /^  if \(isPlaceholderTaskInstruction\(requestedTool, instruction\)\) \{/m)
})

test('accepted plan execution opens the first changed file after Agent writes files', () => {
  assert.match(source, /const changedFiles = Array\.from\(changedFilePaths\)/)
  assert.match(source, /await refreshFolderFromExplorer\(\{ announce: false, mode: 'execution' \}\)/)
  assert.match(source, /await selectFile\(changedFiles\[0\], \{ preserveCommand: true, silent: true \}\)/)
})

test('accepted plan expected files exclude generated command artifacts', () => {
  assert.match(source, /function expectedPlanImplementationFiles/)
  assert.match(source, /generatedArtifactHints/)
  assert.match(source, /expectedFiles: expectedPlanImplementationFiles\(planFiles\)/)
})

test('accepted plan uses delivery stable mode instead of forced validation by default', () => {
  assert.match(source, /const PLANNING_DELIVERY_STABLE_MODE = true/)
  assert.match(source, /【交付穩定模式】/)
  assert.match(source, /const requireValidation = !PLANNING_DELIVERY_STABLE_MODE/)
  assert.match(source, /requireValidation,/)
  assert.match(source, /validation_commands: Array\.isArray\(options\.validationCommands\) \? options\.validationCommands : \[\]/)
  assert.match(source, /validationCommands: requireValidation \? normalizePlanList\(planMessage\.commandsToRun \|\| planMessage\.commands_to_run, \[\]\) : \[\]/)
})

test('workbench layout keeps the editor above the result tabs', () => {
  assert.match(source, /class="center workbench-layout"/)
  assert.ok(source.indexOf('<EditorPanel') < source.indexOf('<ResultTabs'))
  assert.match(source, /const activeWorkbenchTab = ref\('editor'\)/)
  assert.match(source, /:diff-active="activeWorkbenchTab === 'diff'"/)
  assert.match(source, /@open-editor="openResultTab\('editor'\)"/)
  assert.match(source, /@open-diff="openResultTab\('diff'\)"/)
})

test('AI execution result panel keeps the original shared loading behavior', () => {
  assert.match(source, /const loading = reactive\(\{ file: false, chat: false, result: false, login: false \}\)/)
  assert.match(source, /<ResultTabs[\s\S]*:loading="loading\.result"/)
  assert.doesNotMatch(source, /:test-loading="loading\.test"/)
  assert.doesNotMatch(source, /loading\.test/)
})

test('environment-blocked test failures do not force-open the result tab', () => {
  assert.match(source, /function shouldKeepCurrentPageForTestResult\(result = \{\}\) \{[\s\S]*testFailureRepairBlockReason\(result\)/)
  assert.match(source, /function openTestResultTabUnlessEnvironmentBlocked\(result = testResult\.value, fallbackTab = 'editor'\)/)
  assert.match(source, /const previousWorkbenchTab = activeWorkbenchTab\.value\s+loading\.result = true\s+try \{/)
  assert.doesNotMatch(source, /async function runTests\(\) \{[\s\S]{0,180}openResultTab\('test'\)/)
  assert.match(source, /environmentBlocked: data\.environment_blocked === true \|\| data\.test\?\.environment_blocked === true/)
  assert.match(source, /openTestResultTabUnlessEnvironmentBlocked\(testResult\.value, previousWorkbenchTab\)/)
  assert.match(source, /需要原始 stdout \/ stderr 時，可手動開啟「測試 \/ AI 執行結果」/)
})

test('auto repair without a retained failed result returns to the editor', () => {
  assert.match(source, /if \(payload\.testFailureFix\) \{\s+if \(testResult\.value\) testResult\.value\.autoFixStopped = true\s+openResultTab\(testResult\.value \? 'test' : 'editor'\)/)
})

test('sandbox project id is stable so dependency caches can be reused', () => {
  const createId = source.match(/function createSandboxProjectId[\s\S]*?\n\}/)?.[0] || ''
  assert.match(createId, /return `\$\{source\}-\$\{slug\}`/)
  assert.doesNotMatch(createId, /randomUUID|Math\.random|Date\.now/)
})

test('result panel uses a real right-side scrollbar only when content overflows', () => {
  assert.match(styleSource, /\.panel-body \{[\s\S]*?overflow-y: auto;/)
  assert.match(styleSource, /\.panel-body-terminal \{[\s\S]*?overflow-y: auto;/)
  assert.match(styleSource, /\.terminal-panel \{[\s\S]*?min-height: 340px;/)
  assert.doesNotMatch(source, /result-resize-handle/)
  assert.doesNotMatch(styleSource, /result-resize-handle/)
})

test('authenticated startup ensures the backend workspace is shown even when it was deleted', () => {
  assert.match(source, /await refreshHealth\(\)\s+if \(workspaceSource\.value === 'none' && !projectName\.value\) \{\s+await loadTree\(\{ ensureWorkspace: true \}\)\s+\}/)
  assert.match(source, /apiGet\(options\.ensureWorkspace \? '\/api\/files\/tree\?ensure=1' : '\/api\/files\/tree'\)/)
})

test('missing backend workspace clears the file explorer instead of restoring a project name', () => {
  assert.match(source, /if \(data\.workspace_exists === false\) \{/)
  assert.match(source, /projectName\.value = ''[\s\S]*workspaceSource\.value = 'none'[\s\S]*files\.value = \[\]/)
})

test('deleting the project root requires explicit root selection and backend confirmation', () => {
  assert.match(source, /isRoot: Boolean\(selection\.isRoot\)/)
  assert.match(source, /if \(!targetPath && !item\.isRoot\) \{/)
  assert.match(source, /allow_root: item\.isRoot/)
  assert.match(source, /if \(item\.isRoot\) clearExplorer\(\)/)
})

test('refreshing an empty explorer recreates the configured backend workspace', () => {
  assert.match(source, /if \(!projectName\.value && !files\.value\.length\) \{\s+await loadTree\(\{ ensureWorkspace: true \}\)\s+return\s+\}/)
})

test('backend workspace file tree auto-refreshes when files change outside the app', () => {
  assert.match(source, /const FILE_TREE_AUTO_REFRESH_MS = 1500/)
  assert.match(source, /function treeSignature\(tree = \[\]\)/)
  assert.match(source, /function startFileTreeAutoRefresh\(\)/)
  assert.match(source, /window\.setInterval\(\(\) => \{[\s\S]*?refreshBackendTreeIfChanged\(\)/)
  assert.match(source, /if \(treeSignature\(nextTree\) === treeSignature\(files\.value\)\) return/)
  assert.match(source, /files\.value = nextTree/)
  assert.match(source, /startFileTreeAutoRefresh\(\)/)
  assert.match(source, /stopFileTreeAutoRefresh\(\)/)
})

test('manual save writes through the files API and verifies persisted content', () => {
  assert.match(source, /async function saveCurrentFile\(\)/)
  assert.match(source, /apiPost\('\/api\/files\/write', \{\s+file_path: targetPath,\s+content: fileContent\.value\s+\}\)/)
  assert.match(source, /const readResult = await apiPost\('\/api\/files\/read', \{\s+file_path: targetPath\s+\}\)/)
  assert.match(source, /後端寫入後讀回內容不一致/)
  assert.match(source, /markFileSaved\(targetPath, savedContent, \{ updateBackendCache: true \}\)/)
  assert.doesNotMatch(source, /apiPost\('\/api\/diff\/apply', \{\s+file_path: activeFile\.value,\s+new_content: fileContent\.value\s+\}\)/)
})

test('image files are opened as readonly previews instead of editor content', () => {
  assert.match(source, /:content-type="activeFileContentType"/)
  assert.match(source, /:preview-url="activeFilePreviewUrl"/)
  assert.match(source, /function isImagePath\(path = ''\)/)
  assert.match(source, /function setActiveImagePreview\(path, previewUrl, meta = \{\}\)/)
  assert.match(source, /if \(isImagePath\(cleanPath\)\) \{[\s\S]*?data\.preview_url[\s\S]*?setActiveImagePreview\(cleanPath, data\.preview_url, meta\)/)
  assert.match(source, /圖片檔案目前以唯讀預覽開啟/)
  assert.match(source, /content_type: 'image_summary'/)
})

test('saved files clear generated editor drafts before reopening', () => {
  assert.match(source, /function markFileSaved\(path, content, options = \{\}\) \{/)
  assert.match(source, /editedLocalContentMap\.value\.delete\(clean\)/)
  assert.match(source, /clearEditorDraft\(clean\)/)
  assert.match(source, /setFileDirty\(clean, false\)/)
  assert.match(source, /if \(options\.updateBackendCache\) \{[\s\S]*?backendContentCache\.set\(clean, String\(content \?\? ''\)\)/)
  assert.match(source, /markFileSaved\(targetFile, fileContent\.value, \{ updateBackendCache: true \}\)/)
})

test('code generation auto-saves when the workspace is writable', () => {
  assert.match(source, /async function saveGeneratedContentIfWritable\(filePath, newContent\)/)
  assert.match(source, /apiPost\('\/api\/files\/write', \{\s+file_path: target,\s+content: newContent\s+\}\)/)
  assert.match(source, /後端自動儲存後讀回內容不一致/)
  assert.match(source, /generatedSaved = await saveGeneratedContentIfWritable\(targetFile, nextContent\)/)
  assert.match(source, /applyNewContentToLocalEditor\(targetFile, nextContent, \{ dirty: !generatedSaved \}\)/)
  assert.match(source, /generatedSaved \? '主程式已自動儲存。' : '主程式目前尚未儲存/)
})

test('agent apply-and-test uses a long timeout for multi-file validation', () => {
  assert.match(source, /const AGENT_APPLY_AND_TEST_TIMEOUT_MS = 900000/)
  assert.match(source, /apiPost\('\/api\/agent\/apply-and-test'[\s\S]*?AGENT_APPLY_AND_TEST_TIMEOUT_MS/)
  assert.doesNotMatch(source, /apiPost\('\/api\/agent\/apply-and-test'[\s\S]*?\n\s*25000,\s*\n\s*'AI 套用變更與執行測試逾時'/)
})

test('run-tests waits long enough for first-time dependency installation', () => {
  assert.match(source, /const TEST_RUN_TIMEOUT_MS = 900000/)
  assert.match(source, /apiPost\('\/api\/agent\/run-tests'[\s\S]*?TEST_RUN_TIMEOUT_MS/)
  assert.match(source, /可能仍在安裝 Python \/ Node 依賴/)
  assert.doesNotMatch(source, /apiPost\('\/api\/agent\/run-tests'[\s\S]*?\n\s*90000,\s*\n\s*'執行測試逾時'/)
})

test('local apply-and-test canonicalizes project-prefixed paths before saving', () => {
  assert.match(source, /function canonicalWorkspacePath\(path\)/)
  assert.match(source, /const rootName = normalizeLocalPath\(projectName\.value \|\| ''\)/)
  assert.match(source, /const targetFile = canonicalWorkspacePath\(rawTargetFile\)/)
  assert.match(source, /pendingExtraFiles\.value\.map\(item => canonicalWorkspacePath\(item\.path\)\)/)
  assert.match(source, /const target = canonicalWorkspacePath\(filePath\)/)
})

test('local file writes verify persisted content after createWritable', () => {
  assert.match(source, /const savedFile = await fileHandle\.getFile\(\)/)
  assert.match(source, /const savedContent = await readBrowserFileAsContext\(target, savedFile\)/)
  assert.match(source, /本機檔案寫入後讀回內容不一致/)
})

test('local input workspaces cannot confirm apply-and-test as saved', () => {
  assert.match(source, /pendingAgentApproval\.value && workspaceSource\.value !== 'local-handle'/)
  assert.match(source, /目前工作區沒有本機資料夾寫入權限/)
  assert.match(source, /修改差異已保留，尚未寫入磁碟/)
})

test('auto fix stops retrying when validation is blocked by the sandbox environment', () => {
  assert.match(source, /const blockReason = testFailureRepairBlockReason\(testResult\.value\)/)
  assert.match(source, /完整驗證受環境限制/)
  assert.match(source, /testResult\.value\.validationLimited = true/)
  assert.match(source, /系統不會把同一個錯誤重複送給 Ollama/)
  assert.match(source, /停止重複自動修正/)
})

test('analysis and explanation responses hide verbose verification footers', () => {
  assert.match(source, /const compactReadOnlyResponse = \['analysis', 'explanation'\]\.includes/)
  assert.match(source, /\['project_file_analysis', 'program_explanation'\]\.includes/)
  assert.match(source, /data\?\.source && !compactReadOnlyResponse/)
  assert.match(source, /verification && !compactReadOnlyResponse/)
})

test('detect mode sends open editor files as read-only scan scope', () => {
  assert.match(source, /function withCurrentFileDetectionTarget\(instruction = '', explicitTargets = null\)/)
  assert.match(source, /const fallbackTargets = getOpenTaskFiles\(\)/)
  assert.match(source, /const targetScope = withCurrentFileDetectionTarget\(instruction, options\.targetFiles\)/)
  assert.match(source, /buildContextBundle\(targetScope\.targetFiles, \{\s*onlyPaths: true,\s*includeConversation: false,\s*\}\)/)
  assert.match(source, /scope: targetScope\.hasMultipleTargets \? 'explicit_files' : 'current_file'/)
})

test('feature responses do not render fallback content when Ollama is unavailable', () => {
  assert.match(source, /function isModelUnavailableResponse\(data = \{\}\)/)
  assert.match(source, /source === 'ollama_error'/)
  assert.match(source, /model === 'deterministic_project_scanner'/)
  assert.match(source, /function assertModelResponseAvailable\(data = \{\}\)/)
  assert.match(source, /assertModelResponseAvailable\(data\)/)
  assert.match(source, /Ollama 未連線，未產生 AI 回覆/)
})

test('program analysis requires open files and does not scan empty workspace', () => {
  assert.match(source, /if \(isAnalysis && openFiles\.length === 0 && referencedPaths\.length === 0\)/)
  assert.match(source, /尚未在檔案總管開啟任何檔案。請先在檔案總管開啟要分析的檔案，或用 @檔名 指定分析目標。/)
  assert.doesNotMatch(source, /workspaceAnalysisPaths = \(isAnalysis && \(wantsProjectScope \|\| openFiles\.length === 0\)\)/)
})

