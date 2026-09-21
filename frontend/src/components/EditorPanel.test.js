import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const componentPath = fileURLToPath(new URL('./EditorPanel.vue', import.meta.url))
const appPath = fileURLToPath(new URL('../App.vue', import.meta.url))
const source = fs.readFileSync(componentPath, 'utf8')
const appSource = fs.readFileSync(appPath, 'utf8')

test('editor and diff header tabs can switch both directions', () => {
  assert.match(appSource, /class="editor-main-label"/)
  assert.match(appSource, /@click="openResultTab\('editor'\)"/)
  assert.match(appSource, /class="editor-diff-tab"/)
  assert.match(appSource, /@click="openResultTab\('diff'\)"/)
  assert.match(source, /v-show="!diffActive"/)
  assert.match(source, /v-if="diffActive" class="editor-diff-pane"/)
  assert.match(source, /editor-card-diff/)
  assert.match(source, /editor-diff-wrap/)
})

test('inline suggest commands use a guarded Monaco trigger with fallback', () => {
  assert.match(source, /function triggerEditorCommand\(commandId, payload = \{\}\)/)
  assert.match(source, /if \(!options\.forceBackend && triggerEditorCommand\('editor\.action\.inlineSuggest\.trigger'\)\) return/)
  assert.match(source, /return requestInlineSuggestion\(model, position, null, \{ bypassCache: options\.forceBackend, appendCandidate: options\.appendCandidate \}\)/)
  assert.doesNotMatch(source, /editor\.trigger\('cubi-code', 'editor\.action\.inlineSuggest\.trigger'/)
  assert.doesNotMatch(source, /editor\.trigger\('cubi-code', commandId/)
  assert.match(source, /triggerEditorCommand\('editor\.action\.inlineSuggest\.hide'\)/)
  assert.match(source, /triggerEditorCommand\('editor\.action\.inlineSuggest\.acceptNextWord'\)/)
})

test('toolbar completion opens Monaco suggestions and forces backend ghost text', () => {
  const match = source.match(/async function triggerSuggestWidget\(\) \{[\s\S]*?\n\}/)
  assert.ok(match, 'triggerSuggestWidget exists')
  assert.match(match[0], /triggerEditorCommand\('editor\.action\.triggerSuggest'\)/)
  assert.match(match[0], /await triggerInlineSuggestNow\(\{ allowWithoutFocus: true, forceBackend: true \}\)/)
  assert.match(match[0], /已產生補全候選，按 Tab 套用。/)
  assert.match(source, /if \(!options\.forceBackend && triggerEditorCommand\('editor\.action\.inlineSuggest\.trigger'\)\) return/)
  assert.match(source, /requestInlineSuggestion\(model, position, null, \{ bypassCache: options\.forceBackend, appendCandidate: options\.appendCandidate \}\)/)
})

test('format falls back to Monaco and reports only when no formatter changes content', () => {
  assert.match(source, /let backendMessage = ''/)
  assert.match(source, /replaceEditorContent\(formatted, 'cubi-format-api'\)/)
  assert.match(source, /const formatAction = editor\.getAction\('editor\.action\.formatDocument'\)/)
  assert.match(source, /await formatAction\.run\(\)/)
  assert.match(source, /showEditorFeedback\('格式化完成。', 'success'\)/)
  assert.match(source, /emit\('format-message', message\)/)
})

test('editor feature strip keeps diagnostics and feedback without duplicate format or completion buttons', () => {
  const match = source.match(/<div v-if="filePath && !isImagePreview" class="editor-feature-strip">[\s\S]*?<!-- 沒有開啟檔案時/)
  assert.ok(match, 'editor feature strip exists')
  assert.match(match[0], /錯誤紅線/)
  assert.match(match[0], /AI 修正錯誤/)
  assert.match(match[0], /v-if="editorFeedback\.message"/)
  assert.doesNotMatch(match[0], /title="Format Document"/)
  assert.doesNotMatch(match[0], /title="Ctrl \+ Space"/)
  assert.match(source, /const editorFeedback = ref\(\{ message: '', tone: 'info' \}\)/)
  assert.match(source, /const formatBusy = ref\(false\)/)
  assert.match(source, /const autocompleteBusy = ref\(false\)/)
  assert.match(source, /function showEditorFeedback\(message, tone = 'info', options = \{\}\)/)
})

test('autocomplete no-suggestion responses are silent no-ops', () => {
  assert.match(source, /function isAutocompleteNoSuggestion\(data = \{\}\)/)
  assert.match(source, /if \(isAutocompleteNoSuggestion\(data\)\) \{[\s\S]*?return emptyInlineCompletions\(\)/)
  assert.match(source, /上下文不足\|未回傳可用\|no useful completion/)
})

test('inline command opens an in-editor quick input and emits synced file content', () => {
  const match = source.match(/function triggerInlineCommand\(\) \{[\s\S]*?\n\}/)
  assert.ok(match, 'triggerInlineCommand exists')
  assert.match(match[0], /editor\.focus\(\)/)
  assert.match(match[0], /updateCursor\(\)/)
  assert.match(match[0], /const content = editor\.getValue\(\)/)
  assert.match(match[0], /Inline Command 需要目前檔案有實際內容/)
  assert.match(source, /class="inline-command-box"/)
  assert.match(source, /ref="inlineCommandInput"/)
  assert.match(source, /function submitInlineCommand\(\) \{[\s\S]*?emit\('inline-command', \{[\s\S]*?content,\s+filePath: props\.filePath,\s+cursor: cursor\.value/)
  assert.doesNotMatch(source, /Ctrl\+I Inline Command：請輸入修改需求/)
})

test('ghost text is rendered inline with vscode-like accept controls', () => {
  assert.match(source, /let inlineSuggestionDecorationCollection = null/)
  assert.match(source, /inlineSuggestionDecorationCollection = editor\.createDecorationsCollection\(\)/)
  assert.match(source, /function renderInlineSuggestionDecoration\(\)/)
  assert.match(source, /after: \{[\s\S]*?content: firstLine[\s\S]*?inlineClassName: 'cubi-ghost-text'/)
  assert.match(source, /class="inline-suggest-widget"/)
  assert.match(source, /:style="inlineSuggestWidgetStyle"/)
  assert.match(source, /function updateInlineSuggestWidgetPosition\(\) \{[\s\S]*?editor\.getScrolledVisiblePosition/)
  assert.match(source, /let inlineSuggestionCandidates = \[\]/)
  assert.match(source, /function uniqueInlineSuggestions\(items = \[\]\)/)
  assert.match(source, /<button type="button" class="tool"[\s\S]*?@click="formatDocument">格式化<\/button>/)
  assert.match(source, /<button type="button" class="tool"[\s\S]*?@click="triggerSuggestWidget">補全<\/button>/)
  assert.match(source, /@click="acceptVisibleInlineSuggestion"/)
  assert.match(source, /<span>接受<\/span><kbd>Tab<\/kbd>/)
  assert.match(source, /function acceptInlineSuggestionNextWord\(\)/)
  assert.match(source, /\[\\w\$\]\+\\s\*\|/)
  assert.match(source, /@click="acceptInlineSuggestionNextWord"/)
  assert.match(source, /<span>接受字詞<\/span><kbd>Ctrl\+→<\/kbd>/)
  assert.match(source, /@click="cancelInlineSuggestion"/)
  assert.match(source, /<span>取消<\/span><kbd>Esc<\/kbd>/)
  assert.match(source, /monaco\.KeyMod\.CtrlCmd \| monaco\.KeyCode\.RightArrow[\s\S]*?acceptInlineSuggestionNextWord\(\)/)
  assert.doesNotMatch(source, /上一個補全候選/)
  assert.doesNotMatch(source, /下一個補全候選/)
  assert.doesNotMatch(source, /Ghost Text：\{\{ visibleGhostText \}\}/)
})

test('python ghost text starts code on a new line after comment prompts', () => {
  assert.match(source, /function normalizeInlineSuggestionForInsertion\(text = '', model = null, position = null\)/)
  assert.match(source, /const modelLanguageId = model\.getLanguageId\?\.\(\) \|\| languageId\.value/)
  assert.doesNotMatch(source, /language\.value/)
  assert.match(source, /trimmedPrefix\.startsWith\('#'\)/)
  assert.match(source, /function startsStandaloneInlinePythonStatement\(text = ''\)/)
  assert.match(source, /\^\(\?:from\|import\|def\|class\|if\|elif\|else\|for\|while\|try\|except\|finally\|with/)
  assert.match(source, /looksCompleteInlinePythonLine\(linePrefix\) \? `\\n\$\{suggestion\}` : suggestion/)
  assert.match(source, /return `\\n\$\{indentation\}\$\{trimmedSuggestion\}`/)
  assert.match(source, /const suggestion = normalizeInlineSuggestionForInsertion\(String\(text \|\| ''\), model, position\)/)
  assert.match(source, /const text = normalizeInlineSuggestionForInsertion\(lastInlineSuggestion\.text, model, position\)[\s\S]*?editor\.executeEdits\('cubi-inline-fallback'/)
  assert.match(source, /function acceptInlineSuggestionNextWord\(\) \{[\s\S]*?const text = normalizeInlineSuggestionForInsertion\(lastInlineSuggestion\.text, model, position\)/)
})

test('editor status bar does not repeat inline suggestion shortcut text', () => {
  const match = source.match(/<div v-if="filePath && !diffActive && !isImagePreview" class="editor-status">[\s\S]*?<\/div>/)
  assert.ok(match, 'editor status bar exists')
  assert.doesNotMatch(match[0], /Ctrl\+Space 補全/)
  assert.doesNotMatch(match[0], /Ctrl\+I 指令/)
  assert.doesNotMatch(match[0], /Inline Suggestion/)
  assert.doesNotMatch(match[0], /Tab 接受｜Ctrl\+→ 接受字詞｜Esc 取消/)
  assert.doesNotMatch(source, /class="shortcut-note"/)
  assert.doesNotMatch(source, /class="ghost-status"/)
  assert.doesNotMatch(source, /class="ghost-hint"/)
})

test('image files open in a readonly preview instead of Monaco editing', () => {
  assert.match(source, /contentType: \{ type: String, default: 'text' \}/)
  assert.match(source, /previewUrl: \{ type: String, default: '' \}/)
  assert.match(source, /const isImagePreview = computed\(\(\) => props\.contentType === 'image' \|\| isImagePath\(props\.filePath\)\)/)
  assert.match(source, /class="image-preview-pane"/)
  assert.match(source, /<img v-if="previewUrl" :src="previewUrl" :alt="fileLabel" \/>/)
  assert.match(source, /v-if="filePath && !isImagePreview" class="editor-feature-strip"/)
  assert.match(source, /v-show="filePath && !isImagePreview"/)
  assert.match(source, /唯讀預覽/)
})

test('scheduled autocomplete asks the backend after a short random idle delay', () => {
  assert.match(source, /function scheduleInlineSuggest\(\) \{[\s\S]*?window\.setTimeout\(\(\) => \{[\s\S]*?triggerInlineSuggestNow\(\{ forceBackend: true \}\)/)
  assert.match(source, /function getAutoInlineSuggestDelayMs\(\)/)
  assert.match(source, /650 \+ Math\.floor\(Math\.random\(\) \* 700\)/)
  assert.match(source, /const AUTOCOMPLETE_REQUEST_TIMEOUT_MS = 28000/)
  assert.match(source, /window\.setTimeout\(\(\) => controller\.abort\(\), AUTOCOMPLETE_REQUEST_TIMEOUT_MS\)/)
})

test('minimap status control updates Monaco minimap options', () => {
  assert.match(source, /const minimapEnabled = ref\(true\)/)
  assert.match(source, /Minimap：\{\{ minimapEnabled \? '顯示' : '隱藏' \}\}/)
  assert.match(source, /function toggleMinimap\(\) \{[\s\S]*?editor\?\.updateOptions\(\{[\s\S]*?minimap: \{ enabled: minimapEnabled\.value/)
})

test('diagnostic summary is driven by tracked local and server markers', () => {
  assert.match(source, /let localDiagnosticMarkers = \[\]/)
  assert.match(source, /let serverDiagnosticMarkers = \[\]/)
  assert.match(source, /function refreshDiagnosticSummary\(\)/)
  assert.match(source, /\.\.\.localDiagnosticMarkers, \.\.\.serverDiagnosticMarkers/)
  assert.match(source, /serverDiagnosticMarkers = \(Array\.isArray\(data\.markers\)/)
  assert.match(source, /monaco\.editor\.setModelMarkers\(model, 'cubi-server-diagnostics', serverDiagnosticMarkers\)/)
  assert.doesNotMatch(source, /function updateDiagnosticSummary\(\)/)
})

test('diagnostic lines are marked with gutter circle decorations', () => {
  assert.match(source, /glyphMargin: true/)
  assert.match(source, /let diagnosticDecorationCollection = null/)
  assert.match(source, /editor\.createDecorationsCollection\(\)/)
  assert.match(source, /function refreshDiagnosticDecorations\(\)/)
  assert.match(source, /glyphMarginClassName: isWarning \? 'cubi-diagnostic-glyph cubi-diagnostic-glyph-warning' : 'cubi-diagnostic-glyph cubi-diagnostic-glyph-error'/)
  assert.match(source, /\.monaco-host :deep\(\.cubi-diagnostic-glyph::before\)/)
})

test('python quick diagnostics include multi-line undefined-name markers', () => {
  assert.match(source, /function pythonNameDiagnostics\(lines = \[\]\)/)
  assert.match(source, /NameError: name '\$\{name\}' is not defined/)
  assert.match(source, /markers\.push\(\.\.\.pythonNameDiagnostics\(lines\)\)/)
  assert.match(source, /return markers\.slice\(0, 20\)/)
})

test('javascript quick diagnostics skips module and JSX syntax handled by server parser', () => {
  const match = source.match(/function javascriptQuickDiagnostics\(text = ''\) \{[\s\S]*?\n\}/)
  assert.ok(match, 'javascriptQuickDiagnostics exists')
  assert.match(match[0], /\(\?:import\|export\)/)
  assert.match(match[0], /<\[A-Z\]\[A-Za-z0-9\]\*/)
  assert.match(match[0], /return \[\]/)
  assert.match(match[0], /new Function\(source\)/)
})

test('python quick diagnostics treat builtin exceptions as known names', () => {
  assert.match(source, /'ValueError'/)
  assert.match(source, /'TypeError'/)
  assert.match(source, /'BaseException'/)
})

test('python quick diagnostics mask triple-quoted docstrings and skip import statements', () => {
  assert.match(source, /function maskPythonLinesAndComments\(lines = \[\]\)/)
  assert.match(source, /blockQuote = triple/)
  assert.match(source, /if \(\[?\/\^\(\?:from\|import\)\\s\+\/\.test\(trimmed\)\) return/)
})

test('python quick diagnostics recognize comprehension loop variables away from line start', () => {
  assert.match(source, /trimmed\.matchAll\(\/\\b\(\?:for\|async\\s\+for\)\\s\+\(\.\+\?\)\\s\+in\\s\+\/g\)/)
  assert.match(source, /definePythonTargetNames\(forMatch\[1\], definedNames\)/)
})

test('python quick diagnostics recognize tuple-unpacked assignment targets', () => {
  assert.ok(source.includes("if (/^[A-Za-z_0-9()[\\],\\s]*(?::\\s*[^=]+)?\\s*=/.test(trimmed)"))
  assert.match(source, /definePythonTargetNames\(trimmed\.split\('='\)\[0\], definedNames\)/)
})

test('python quick diagnostics recognize numbered tuple-unpacked names', () => {
  assert.match(source, /\[A-Za-z_0-9\(\)\[\\\],\\s\]/)
})

test('python quick diagnostics do not require colons inside bracketed comprehensions', () => {
  assert.match(source, /function pythonNestingDepthBeforeLine\(lines = \[\], targetIndex = 0\)/)
  assert.match(source, /pythonNestingDepthBeforeLine\(lines, index\) === 0/)
  assert.match(source, /SyntaxError: expected ':'/)
  assert.match(source, /const maskedLine = maskPythonStringsAndComments\(line\)\.trimEnd\(\)/)
})

test('diagnostic quick fix sends marker details to the existing fix flow', () => {
  assert.match(source, /AI 修正錯誤/)
  assert.match(source, /讀取目前真實錯誤紅線，送交 Ollama 產生修正/)
  assert.match(source, /function diagnosticMarkersForFix\(\)/)
  assert.match(source, /function diagnosticFixInstruction\(markers = diagnosticMarkersForFix\(\)\)/)
  assert.match(source, /function triggerDiagnosticFix\(\)/)
  assert.match(source, /emit\('inline-command', \{[\s\S]*?action: 'fix'[\s\S]*?targetOnly: true/)
  assert.match(source, /registerDiagnosticCodeActionProviders\(\)/)
  assert.match(source, /registerCodeActionProvider/)
  assert.match(source, /CodeActionKind\.QuickFix/)
})

test('diagnostic quick fix feedback is cleared when the inline fix run finishes', () => {
  assert.match(source, /let diagnosticFixFeedbackPending = false/)
  assert.match(source, /let diagnosticFixSawResultLoading = false/)
  assert.match(source, /diagnosticFixFeedbackPending = true[\s\S]*?showEditorFeedback\('已讀取真實錯誤紅線，正在送交 Ollama 產生修正\.\.\.', 'info', \{ persist: true \}\)/)
  assert.match(source, /watch\(\(\) => props\.resultLoading, loading => \{[\s\S]*?diagnosticFixSawResultLoading = true[\s\S]*?AI 修正流程已結束，請查看修改差異或右側結果訊息。/)
  assert.match(source, /watch\(\(\) => props\.filePath, \(\) => \{[\s\S]*?diagnosticFixFeedbackPending = false[\s\S]*?diagnosticFixSawResultLoading = false/)
})

test('ghost text and inline suggestions remain available even with diagnostic lines present', () => {
  assert.doesNotMatch(source, /function hasDiagnosticMarkerOnLine\(lineNumber\)/)
  assert.doesNotMatch(source, /function clearInlineSuggestionOnDiagnosticLine\(\)/)
  assert.doesNotMatch(source, /if \(hasDiagnosticMarkerOnLine\(position\.lineNumber\)\) return false/)
})

test('diagnostics restart after a file finishes loading', () => {
  assert.match(source, /watch\(\(\) => props\.loading, loading => \{/)
  assert.match(source, /if \(loading \|\| !editor \|\| !props\.filePath \|\| isImagePreview\.value\) return/)
  assert.match(source, /scheduleInlineSuggest\(\)\s+scheduleDiagnostics\(\)/)
})
