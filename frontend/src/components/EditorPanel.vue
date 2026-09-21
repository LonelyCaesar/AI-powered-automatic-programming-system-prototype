<template>
  <div class="card editor-card" :class="{ 'editor-card-diff': diffActive }">
    <div class="editor-shell">
      <div v-show="!diffActive" class="editor-code-pane">
        <div v-if="editorTabs.length" class="editor-tabs">
          <button
            v-for="tab in editorTabs"
            :key="tab.path"
            type="button"
            class="editor-tab"
            :class="{ active: tab.path === normalizedFilePath }"
            :title="tab.path"
            @click="$emit('tab-select', tab.path)"
          >
            <span class="tab-name">{{ tab.label }}</span>
            <small v-if="tab.dirty" class="dirty-dot">●</small>
            <span class="tab-close" title="關閉檔案" @click.stop="$emit('close-file', tab.path)">×</span>
          </button>
        </div>

        <div v-if="filePath && !isImagePreview" class="editor-feature-strip">
          <span class="feature-chip" :class="{ danger: diagnosticSummary.count }">
            錯誤紅線：{{ diagnosticSummary.count ? `${diagnosticSummary.count} 個` : '0 個' }}
          </span>
          <button
            v-if="diagnosticSummary.count"
            type="button"
            class="feature-button fix-button"
            title="AI Quick Fix：讀取目前真實錯誤紅線，送交 Ollama 產生修正"
            :disabled="loading || resultLoading"
            @click="triggerDiagnosticFix"
          >
            AI 修正錯誤
          </button>
          <span v-if="editorFeedback.message" class="editor-feedback" :class="editorFeedback.tone">
            {{ editorFeedback.message }}
          </span>
        </div>
        <div v-else-if="filePath && isImagePreview" class="editor-feature-strip image-feature-strip">
          <span class="feature-chip">圖片預覽</span>
          <span class="editor-feedback success">唯讀開啟，不會以文字模式覆寫圖片。</span>
        </div>

        <!-- 沒有開啟檔案時，連 Monaco 編輯區也隱藏，避免出現空白第 1 行。 -->
        <div v-show="filePath && !isImagePreview" ref="editorHost" class="monaco-host" :class="{ loading }"></div>
        <div v-if="filePath && isImagePreview" class="image-preview-pane">
          <img v-if="previewUrl" :src="previewUrl" :alt="fileLabel" />
          <div v-else class="image-preview-empty">無法顯示圖片預覽。</div>
          <div class="image-preview-meta">
            <b>{{ fileLabel }}</b>
            <span v-if="previewMeta?.mimeType">{{ previewMeta.mimeType }}</span>
            <span v-if="previewFileSizeLabel">{{ previewFileSizeLabel }}</span>
          </div>
        </div>
        <div v-if="!filePath" class="editor-empty-pane" aria-hidden="true"></div>

        <div
          v-if="filePath && !isImagePreview && visibleGhostText && inlineSuggestWidget.visible"
          class="inline-suggest-widget"
          :style="inlineSuggestWidgetStyle"
          @mousedown.prevent
        >
          <button type="button" class="tool" :disabled="formatBusy || loading" title="Format Document" @click="formatDocument">格式化</button>
          <button type="button" class="tool" :disabled="autocompleteBusy || loading || !autocompleteEnabled" title="Ctrl + Space" @click="triggerSuggestWidget">補全</button>
          <button type="button" class="accept" title="Tab" @click="acceptVisibleInlineSuggestion">
            <span>接受</span><kbd>Tab</kbd>
          </button>
          <button type="button" class="accept" title="Ctrl+Right" @click="acceptInlineSuggestionNextWord">
            <span>接受字詞</span><kbd>Ctrl+→</kbd>
          </button>
          <button type="button" class="cancel" title="Esc" @click="cancelInlineSuggestion">
            <span>取消</span><kbd>Esc</kbd>
          </button>
        </div>

        <div
          v-if="filePath && !isImagePreview && pasteMenu.visible"
          class="editor-context-menu"
          :style="{ left: `${pasteMenu.x}px`, top: `${pasteMenu.y}px` }"
          @mousedown.prevent
          @click.stop
        >
          <button type="button" @click="pasteFromClipboard">貼上</button>
        </div>

        <form
          v-if="filePath && !isImagePreview && inlineCommandBox.visible"
          class="inline-command-box"
          @submit.prevent="submitInlineCommand"
          @keydown.esc.prevent="cancelInlineCommand"
        >
          <span class="inline-command-mark">Ctrl+I</span>
          <input
            ref="inlineCommandInput"
            v-model="inlineCommandBox.text"
            type="text"
            placeholder="輸入局部修改指令，例如：修正這段、補錯誤處理、改成 async"
            autocomplete="off"
          />
          <button type="submit">執行</button>
          <button type="button" class="ghost-button" @click="cancelInlineCommand">取消</button>
        </form>
      </div>

      <div v-if="diffActive" class="editor-diff-pane">
        <div class="diff-history-shell">
          <aside class="diff-history-sidebar">
            <div class="diff-history-head">
              <div>
                <b>歷史修改記錄</b>
                <span>{{ historyRecords.length }} 筆</span>
              </div>
              <button type="button" :disabled="historyLoading" title="重新整理" @click="$emit('refresh-diff-history')">↻</button>
            </div>

            <button
              v-if="hasPendingDiff"
              type="button"
              class="diff-history-item current"
              :class="{ active: !selectedHistoryId }"
              @click="$emit('select-diff-history', 'current')"
            >
              <span class="diff-history-status status-pending">等待套用</span>
              <b>{{ diffFilePath || filePath || '目前檔案' }}</b>
              <small>目前尚未套用的修改差異</small>
            </button>

            <div
              v-for="record in historyRecords"
              :key="record.id"
              class="diff-history-record"
              :class="{ active: selectedHistoryId === record.id }"
            >
              <button
                type="button"
                class="diff-history-item diff-history-select"
                @click="$emit('select-diff-history', record.id)"
              >
                <span class="diff-history-status" :class="historyStatusClass(record.status === 'applying' ? 'applied' : record.status)">{{ historyStatusLabel(record.status === 'applying' ? 'applied' : record.status) }}</span>
                <b :title="record.file_path">{{ compactHistoryPath(record.file_path) }}</b>
                <small>{{ formatHistoryTime(record.created_at) }}｜+{{ record.additions || 0 }} / -{{ record.removals || 0 }}</small>
              </button>
              <button
                type="button"
                class="diff-history-delete"
                title="刪除這筆歷史修改記錄"
                aria-label="刪除這筆歷史修改記錄"
                @click.stop="$emit('delete-diff-history', record.id)"
              >
                刪除
              </button>
            </div>

            <div v-if="historyLoading" class="diff-history-loading">正在讀取歷史修改記錄…</div>
            <div v-else-if="!hasPendingDiff && !historyRecords.length" class="diff-history-none">尚無歷史修改記錄</div>
          </aside>

          <section class="diff-history-detail">
            <div v-if="activeHistoryRecord" class="diff-history-summary">
              <div>
                <span class="diff-history-status" :class="historyStatusClass(activeHistoryRecord.status === 'applying' ? 'applied' : activeHistoryRecord.status)">{{ historyStatusLabel(activeHistoryRecord.status === 'applying' ? 'applied' : activeHistoryRecord.status) }}</span>
                <b>{{ activeHistoryRecord.file_path || '未知檔案' }}</b>
              </div>
              <span>{{ formatHistoryTime(activeHistoryRecord.created_at) }}</span>
              <small v-if="activeHistoryRecord.instruction">{{ activeHistoryRecord.instruction }}</small>
            </div>
            <div v-else-if="hasPendingDiff" class="diff-history-summary current-summary">
              <div><span class="diff-history-status status-pending">等待套用</span><b>{{ diffTargetLabel }}</b></div>
              <span>目前修改</span>
              <small>原始檔尚未覆蓋，確認後才能套用。</small>
            </div>

            <div v-if="diffRows.length" class="diff-wrap editor-diff-wrap">
              <div class="diff-file-label">修改差異：{{ diffTargetLabel }}</div>
              <div class="diff-grid">
                <div class="diff-col diff-old">
                  <div class="diff-head">{{ oldFileLabel }}</div>
                  <div
                    v-for="(row, index) in diffRows"
                    :key="`editor-old-${index}`"
                    class="diff-row"
                    :class="diffSideRowClass(row, 'old')"
                  >
                    <span class="diff-line-no" :class="{ 'changed-line-no': isChangedDiffLine(row, 'old') }">{{ row.oldNo || '' }}</span>
                    <span class="diff-mark">{{ row.oldMark || ' ' }}</span>
                    <code>{{ row.oldText }}</code>
                  </div>
                </div>

                <div class="diff-col diff-new">
                  <div class="diff-head">{{ newFileLabel }}</div>
                  <div
                    v-for="(row, index) in diffRows"
                    :key="`editor-new-${index}`"
                    class="diff-row"
                    :class="diffSideRowClass(row, 'new')"
                  >
                    <span class="diff-line-no" :class="{ 'changed-line-no': isChangedDiffLine(row, 'new') }">{{ row.newNo || '' }}</span>
                    <span class="diff-mark">{{ row.newMark || ' ' }}</span>
                    <code>{{ row.newText }}</code>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="empty-state diff-empty">
              <b>目前沒有可顯示的修改差異。</b>
              <span>左側會保留過去的修改時間、檔名、狀態與新增／刪除行數；點選紀錄即可重新查看。</span>
            </div>
          </section>
        </div>
      </div>
    </div>

    <div v-if="filePath && !diffActive && !isImagePreview" class="editor-status">
      <span>Ln {{ cursor.line }}, Col {{ cursor.col }}</span>
      <span>Spaces: 4</span>
      <span>UTF-8</span>
      <span>LF</span>
      <span>{{ languageLabel }}</span>
      <button type="button" class="status-toggle" :class="{ active: minimapEnabled }" @click="toggleMinimap">Minimap：{{ minimapEnabled ? '顯示' : '隱藏' }}</button>
      <button type="button" class="autocomplete-toggle" :class="{ active: autocompleteEnabled }" @click="toggleAutocomplete">Autocomplete：{{ autocompleteEnabled ? '啟用' : '停用' }}</button>
      <span class="saved">
        <span class="status-dot dot-ok"></span>{{ loading ? '讀取中' : dirty ? '未儲存' : '已儲存' }}
      </span>
    </div>
    <div v-else-if="filePath && !diffActive && isImagePreview" class="editor-status">
      <span>Preview</span>
      <span>{{ languageLabel }}</span>
      <span v-if="previewMeta?.mimeType">{{ previewMeta.mimeType }}</span>
      <span class="saved">
        <span class="status-dot dot-ok"></span>{{ loading ? '讀取中' : '唯讀預覽' }}
      </span>
    </div>
    <div v-else-if="!diffActive" class="editor-status editor-status-empty"></div>
  </div>
</template>

<script setup>
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution'
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution'
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution'
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution'
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution'
import 'monaco-editor/esm/vs/language/json/monaco.contribution'
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { apiPost } from '../api/client'

const props = defineProps({
  filePath: String,
  content: String,
  contentType: { type: String, default: 'text' },
  previewUrl: { type: String, default: '' },
  previewMeta: { type: Object, default: null },
  loading: Boolean,
  ghostText: String,
  mode: { type: String, default: 'Agent' },
  dirty: { type: Boolean, default: false },
  openFiles: { type: Array, default: () => [] },
  dirtyFiles: { type: Array, default: () => [] },
  diffActive: { type: Boolean, default: false },
  hasDiff: { type: Boolean, default: false },
  hasPendingDiff: { type: Boolean, default: false },
  diffText: { type: String, default: '' },
  diffInfo: { type: Object, default: null },
  diffFilePath: { type: String, default: '' },
  diffHistory: { type: Array, default: () => [] },
  selectedHistoryId: { type: String, default: '' },
  pendingHistoryId: { type: String, default: '' },
  historyLoading: { type: Boolean, default: false },
  resultLoading: { type: Boolean, default: false },
  canApplyDiff: { type: Boolean, default: false },
  approvalMode: { type: Boolean, default: false },
  activeTab: { type: String, default: '' }
})

const emit = defineEmits(['mode', 'update:content', 'save', 'cursor', 'selection', 'ghost', 'autocomplete-error', 'format-message', 'audit-refresh', 'inline-command', 'close', 'tab-select', 'close-file', 'open-editor', 'open-diff', 'apply-diff', 'cancel-diff', 'select-diff-history', 'delete-diff-history', 'refresh-diff-history'])

const editorHost = ref(null)
const cursor = ref({ line: 1, col: 1 })
const inlineSuggestionText = ref('')
const autocompleteEnabled = ref(true)
const minimapEnabled = ref(true)
const pasteMenu = ref({ visible: false, x: 0, y: 0 })
const inlineCommandInput = ref(null)
const inlineCommandBox = ref({ visible: false, text: '' })
const inlineSuggestWidget = ref({ visible: false, x: 0, y: 0 })
const diagnosticSummary = ref({ count: 0, message: '' })
const editorFeedback = ref({ message: '', tone: 'info' })
const formatBusy = ref(false)
const autocompleteBusy = ref(false)

let editor = null
let suppressChange = false
let inlineTriggerTimer = null
let inlineRequestSeq = 0
let inlineProviderDisposables = []
let hoverProviderDisposables = []
let codeActionProviderDisposables = []
let inlineCache = new Map()
let activeAutocompleteController = null
let activeDiagnosticsController = null
let inlineSuggestionDecorationCollection = null
let lastAutocompleteError = ''
let lastEmittedValue = ''
let diagnosticsTimer = null
let localDiagnosticsTimer = null
let editorFeedbackTimer = null
let diagnosticFixFeedbackPending = false
let diagnosticFixSawResultLoading = false
let diagnosticsSeq = 0
let localDiagnosticMarkers = []
let serverDiagnosticMarkers = []
let diagnosticDecorationCollection = null
let lastInlineSuggestion = {
  text: '',
  lineNumber: 0,
  column: 0,
  modelVersion: 0
}
let inlineSuggestionCandidates = []
let inlineSuggestionCandidateIndex = 0

const supportedInlineLanguages = ['python', 'javascript', 'typescript', 'java', 'html', 'json', 'css', 'markdown', 'sql', 'plaintext']
const serverDiagnosticLanguages = ['python', 'java', 'javascript', 'json']
const AUTOCOMPLETE_REQUEST_TIMEOUT_MS = 28000
const normalizedFilePath = computed(() => normalizePath(props.filePath))
const fileLabel = computed(() => getFileName(props.filePath))
const isImagePreview = computed(() => props.contentType === 'image' || isImagePath(props.filePath))
const languageId = computed(() => getLanguageId(props.filePath))
const languageLabel = computed(() => getLanguageLabel(languageId.value))
const previewFileSizeLabel = computed(() => {
  const bytes = Number(props.previewMeta?.bytes || props.previewMeta?.size || 0)
  return bytes ? `${bytes.toLocaleString('en-US')} bytes` : ''
})
const visibleGhostText = computed(() => autocompleteEnabled.value ? (inlineSuggestionText.value || props.ghostText || '') : '')
const inlineSuggestWidgetStyle = computed(() => ({
  left: `${inlineSuggestWidget.value.x}px`,
  top: `${inlineSuggestWidget.value.y}px`
}))
const diffTargetFiles = computed(() => {
  const paths = Array.isArray(props.diffInfo?.modifiedFiles) && props.diffInfo.modifiedFiles.length
    ? props.diffInfo.modifiedFiles
    : (Array.isArray(props.diffInfo?.targetFiles) && props.diffInfo.targetFiles.length
        ? props.diffInfo.targetFiles
        : [props.diffInfo?.filePath || props.diffFilePath || props.filePath])
  return paths.map(path => String(path || '').trim()).filter(Boolean)
})
const diffTargetLabel = computed(() => diffTargetFiles.value.join('、') || '目前檔案')
const oldFileLabel = computed(() => firstDiffHeader(props.diffText, '---') || `--- a/${props.diffFilePath || props.filePath || '目前檔案'}`)
const newFileLabel = computed(() => firstDiffHeader(props.diffText, '+++') || `+++ b/${props.diffFilePath || props.filePath || '目前檔案'}`)
const diffRows = computed(() => parseUnifiedDiff(props.diffText || ''))
const historyRecords = computed(() => (props.diffHistory || []).filter(record => record?.id && !(props.hasPendingDiff && record.id === props.pendingHistoryId)))
const activeHistoryRecord = computed(() => historyRecords.value.find(record => record.id === props.selectedHistoryId) || null)

function historyStatusLabel(status = '') {
  return ({
    pending: '等待套用',
    applying: '套用中',
    applied: '已套用',
    cancelled: '已取消',
    failed: '失敗',
    rolled_back: '已回復',
    validation_limited: '已套用／驗證受限',
  })[String(status || '').toLowerCase()] || '已記錄'
}

function historyStatusClass(status = '') {
  return `status-${String(status || 'recorded').toLowerCase().replace(/[^a-z_]/g, '')}`
}

function formatHistoryTime(value = '') {
  const text = String(value || '').trim()
  if (!text) return '時間未提供'
  return text.replace('T', ' ').replace(/\.\d+Z?$/, '')
}

function compactHistoryPath(value = '') {
  const text = normalizePath(value)
  if (text.length <= 42) return text || '未知檔案'
  const parts = text.split('/')
  return parts.length > 1 ? `…/${parts.slice(-2).join('/')}` : `…${text.slice(-39)}`
}

const editorTabs = computed(() => {
  const paths = uniquePaths(props.openFiles)
  if (!paths.length && normalizedFilePath.value) paths.push(normalizedFilePath.value)

  const nameCounts = paths.reduce((counts, path) => {
    const name = getFileName(path)
    counts[name] = (counts[name] || 0) + 1
    return counts
  }, {})

  return paths.map(path => ({
    path,
    label: nameCounts[getFileName(path)] > 1 ? getCompactPathLabel(path) : getFileName(path),
    dirty: props.dirtyFiles.map(item => normalizePath(item)).includes(path)
  }))
})

function firstDiffHeader(text, prefix) {
  return String(text || '')
    .split('\n')
    .find(line => line.startsWith(prefix) && !line.startsWith(`${prefix}${prefix}`))
}

function parseUnifiedDiff(text) {
  const rows = []
  let oldLine = 0
  let newLine = 0
  let pendingRemoves = []
  let pendingAdds = []

  const flushChangeBlock = () => {
    rows.push(...buildAlignedDiffRows(pendingRemoves, pendingAdds))
    pendingRemoves = []
    pendingAdds = []
  }

  for (const line of String(text || '').split('\n')) {
    if (!line || line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff --git') || line.startsWith('index ')) continue
    if (line.startsWith('@@')) {
      flushChangeBlock()
      const match = line.match(/@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/)
      oldLine = match ? Number(match[1]) : oldLine
      newLine = match ? Number(match[2]) : newLine
      rows.push({
        type: 'hunk',
        oldType: 'hunk',
        newType: 'hunk',
        oldNo: '',
        newNo: '',
        oldMark: '',
        newMark: '',
        oldText: line,
        newText: line
      })
      continue
    }

    if (line.startsWith('-')) {
      pendingRemoves.push({ no: oldLine++, text: line.slice(1) })
      continue
    }

    if (line.startsWith('+')) {
      pendingAdds.push({ no: newLine++, text: line.slice(1) })
      continue
    }

    flushChangeBlock()
    rows.push({
      type: 'context',
      oldType: 'context',
      newType: 'context',
      oldNo: oldLine++,
      newNo: newLine++,
      oldMark: ' ',
      newMark: ' ',
      oldText: line.startsWith(' ') ? line.slice(1) : line,
      newText: line.startsWith(' ') ? line.slice(1) : line
    })
  }
  flushChangeBlock()
  return rows
}

function buildAlignedDiffRows(oldEntries, newEntries) {
  if (!oldEntries.length && !newEntries.length) return []
  const matchCounts = Array.from({ length: oldEntries.length + 1 }, () => Array(newEntries.length + 1).fill(0))

  for (let oldIndex = 1; oldIndex <= oldEntries.length; oldIndex += 1) {
    for (let newIndex = 1; newIndex <= newEntries.length; newIndex += 1) {
      if (oldEntries[oldIndex - 1].text === newEntries[newIndex - 1].text) {
        matchCounts[oldIndex][newIndex] = matchCounts[oldIndex - 1][newIndex - 1] + 1
      } else {
        matchCounts[oldIndex][newIndex] = Math.max(matchCounts[oldIndex - 1][newIndex], matchCounts[oldIndex][newIndex - 1])
      }
    }
  }

  const reversedRows = []
  let oldIndex = oldEntries.length
  let newIndex = newEntries.length

  while (oldIndex > 0 || newIndex > 0) {
    const oldEntry = oldEntries[oldIndex - 1]
    const newEntry = newEntries[newIndex - 1]
    if (oldIndex > 0 && newIndex > 0 && oldEntry.text === newEntry.text) {
      reversedRows.push({
        type: 'context',
        oldType: 'context',
        newType: 'context',
        oldNo: oldEntry.no,
        newNo: newEntry.no,
        oldMark: ' ',
        newMark: ' ',
        oldText: oldEntry.text,
        newText: newEntry.text
      })
      oldIndex -= 1
      newIndex -= 1
    } else if (newIndex > 0 && (oldIndex === 0 || matchCounts[oldIndex][newIndex - 1] >= matchCounts[oldIndex - 1][newIndex])) {
      reversedRows.push({
        type: 'add',
        oldType: 'empty',
        newType: 'add',
        oldNo: '',
        newNo: newEntry.no,
        oldMark: '',
        newMark: '+',
        oldText: '',
        newText: newEntry.text
      })
      newIndex -= 1
    } else {
      reversedRows.push({
        type: 'remove',
        oldType: 'remove',
        newType: 'empty',
        oldNo: oldEntry.no,
        newNo: '',
        oldMark: '-',
        newMark: '',
        oldText: oldEntry.text,
        newText: ''
      })
      oldIndex -= 1
    }
  }

  return reversedRows.reverse()
}

function diffSideRowClass(row, side) {
  if (row?.type === 'hunk') return 'row-hunk'
  const type = side === 'old' ? row?.oldType : row?.newType
  if (type === 'remove' || type === 'change-remove') return 'row-remove'
  if (type === 'add' || type === 'change-add') return 'row-add'
  if (type === 'empty') return 'row-empty'
  return ''
}

function isChangedDiffLine(row, side) {
  const type = side === 'old' ? row?.oldType : row?.newType
  if (side === 'old') return type === 'remove'
  return type === 'add' || type === 'change-add'
}

function normalizePath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '')
}

function uniquePaths(paths) {
  const seen = new Set()
  const result = []
  for (const path of paths || []) {
    const clean = normalizePath(path)
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    result.push(clean)
  }
  return result
}

function getFileName(path) {
  return normalizePath(path).split('/').pop() || ''
}

function getCompactPathLabel(path) {
  const clean = normalizePath(path)
  const parts = clean.split('/').filter(Boolean)
  if (parts.length <= 1) return clean
  return `${parts.at(-2)}/${parts.at(-1)}`
}

onMounted(async () => {
  await nextTick()
  configureMonacoLanguageServices()

  editor = monaco.editor.create(editorHost.value, {
    value: props.content || '',
    language: languageId.value,
    theme: 'vs',
    automaticLayout: true,
    minimap: { enabled: minimapEnabled.value, size: 'proportional', scale: 1, maxColumn: 80, showSlider: 'mouseover' },
    fontSize: 15,
    fontFamily: 'Consolas, "Cascadia Mono", "Courier New", monospace',
    lineHeight: 24,
    tabSize: 4,
    insertSpaces: true,
    lineNumbers: 'on',
    glyphMargin: true,
    scrollBeyondLastLine: false,
    wordWrap: 'off',
    roundedSelection: false,
    renderWhitespace: 'selection',
    formatOnPaste: true,
    formatOnType: true,
    padding: { top: 12, bottom: 12 },
    contextmenu: false,
    inlineSuggest: {
      enabled: true,
      mode: 'prefix',
      showToolbar: 'onHover',
      suppressSuggestions: false
    },
    tabCompletion: 'on',
    suggest: {
      preview: true,
      showInlineDetails: true
    }
  })

  registerInlineCompletionProviders()
  registerDiagnosticHoverProviders()
  registerDiagnosticCodeActionProviders()
  diagnosticDecorationCollection = editor.createDecorationsCollection()
  inlineSuggestionDecorationCollection = editor.createDecorationsCollection()

  editorHost.value?.addEventListener('contextmenu', showPasteMenu)
  window.addEventListener('click', hidePasteMenu)
  window.addEventListener('keydown', hidePasteMenu)

  editor.addAction({
    id: 'cubi-code-paste',
    label: '貼上（Cubi Code）',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 0,
    run: () => pasteFromClipboard()
  })
  editor.addAction({
    id: 'cubi-code.fixDiagnostics',
    label: 'AI 修正錯誤',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1,
    run: () => triggerDiagnosticFix()
  })

  editor.onDidChangeModelContent(() => {
    if (suppressChange) return
    clearInlineSuggestion()
    const val = editor.getValue()
    lastEmittedValue = val
    emit('update:content', val)
    updateCursor()
    scheduleInlineSuggest()
    scheduleDiagnostics()
  })

  editor.onDidChangeCursorPosition(() => {
    updateCursor()
    updateSelection()
    clearInlineSuggestionIfCursorMoved()
    updateInlineSuggestWidgetPosition()
    scheduleInlineSuggest()
  })

  editor.onDidChangeCursorSelection(() => {
    updateSelection()
  })
  editor.onDidScrollChange(() => updateInlineSuggestWidgetPosition())
  editor.onDidLayoutChange(() => updateInlineSuggestWidgetPosition())

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => emit('save'))

  // Copilot / Codeium 類操作：Ctrl+Space 可主動觸發 ghost text，Esc 可取消。
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space, () => {
    if (!autocompleteEnabled.value) return
    triggerSuggestWidget()
  })
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, () => triggerInlineCommand())
  editor.addCommand(monaco.KeyCode.Escape, () => {
    if (inlineCommandBox.value.visible) {
      cancelInlineCommand()
      return
    }
    cancelInlineSuggestion()
  })

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.RightArrow, () => {
    if (lastInlineSuggestion.text) {
      acceptInlineSuggestionNextWord()
      return true
    }
    triggerEditorCommand('editor.action.inlineSuggest.acceptNextWord')
  })
  editor.addCommand(monaco.KeyCode.Tab, () => {
    if (lastInlineSuggestion.text) {
      acceptVisibleInlineSuggestion()
      return true
    }
    const selection = editor.getSelection()
    if (selection && !selection.isEmpty()) {
      editor.getAction('editor.action.indentLines')?.run()
      return true
    }
    const tabSize = editor.getOption(monaco.editor.EditorOption.tabSize) || 4
    editor.trigger('keyboard', 'type', { text: ' '.repeat(tabSize) })
    return true
  })

  updateCursor()
  updateSelection()
  scheduleInlineSuggest()
  scheduleDiagnostics()
})

onBeforeUnmount(() => {
  if (inlineTriggerTimer) window.clearTimeout(inlineTriggerTimer)
  if (diagnosticsTimer) window.clearTimeout(diagnosticsTimer)
  if (localDiagnosticsTimer) window.clearTimeout(localDiagnosticsTimer)
  if (editorFeedbackTimer) window.clearTimeout(editorFeedbackTimer)
  activeAutocompleteController?.abort()
  activeAutocompleteController = null
  activeDiagnosticsController?.abort()
  activeDiagnosticsController = null
  clearDiagnosticsMarkers()
  inlineProviderDisposables.forEach(disposable => disposable.dispose())
  inlineProviderDisposables = []
  hoverProviderDisposables.forEach(disposable => disposable.dispose())
  hoverProviderDisposables = []
  codeActionProviderDisposables.forEach(disposable => disposable.dispose())
  codeActionProviderDisposables = []
  editorHost.value?.removeEventListener('contextmenu', showPasteMenu)
  window.removeEventListener('click', hidePasteMenu)
  window.removeEventListener('keydown', hidePasteMenu)
  if (editor) editor.dispose()
})

function syncEditorValue(value, options = {}) {
  if (!editor) return
  const nextValue = value || ''
  if (!options.force && editor.getValue() === nextValue) return
  if (!options.force && nextValue === lastEmittedValue) return

  const position = editor.getPosition()
  suppressChange = true
  editor.setValue(nextValue)
  suppressChange = false
  lastEmittedValue = nextValue
  if (position) editor.setPosition(position)
  clearInlineSuggestion()
  updateCursor()
  scheduleInlineSuggest()
  scheduleDiagnostics()
}

function replaceEditorContent(nextValue, source = 'cubi-replace') {
  if (!editor) return false
  const value = String(nextValue ?? '')
  if (editor.getValue() === value) return false

  const model = editor.getModel()
  const position = editor.getPosition()
  suppressChange = true
  try {
    if (model && typeof editor.executeEdits === 'function') {
      const lastLine = model.getLineCount()
      const fullRange = model.getFullModelRange?.() || new monaco.Range(
        1,
        1,
        lastLine,
        model.getLineMaxColumn(lastLine)
      )
      editor.executeEdits(source, [{
        range: fullRange,
        text: value,
        forceMoveMarkers: true
      }])
    } else {
      editor.setValue(value)
    }
  } finally {
    suppressChange = false
  }

  lastEmittedValue = value
  if (model && position) {
    const nextLine = Math.min(position.lineNumber, model.getLineCount())
    editor.setPosition({
      lineNumber: nextLine,
      column: Math.min(position.column, model.getLineMaxColumn(nextLine))
    })
  }
  clearInlineSuggestion()
  updateCursor()
  emit('update:content', value)
  scheduleDiagnostics()
  return true
}

watch(() => props.content, value => {
  syncEditorValue(value)
})

watch(() => props.contentType, value => {
  if (value !== 'image') return
  cancelInlineSuggestion()
  clearDiagnosticsMarkers()
})

watch(() => props.loading, loading => {
  if (loading || !editor || !props.filePath || isImagePreview.value) return
  scheduleInlineSuggest()
  scheduleDiagnostics()
})

watch(() => props.resultLoading, loading => {
  if (!diagnosticFixFeedbackPending) return
  if (loading) {
    diagnosticFixSawResultLoading = true
    return
  }
  if (!diagnosticFixSawResultLoading) return

  diagnosticFixFeedbackPending = false
  diagnosticFixSawResultLoading = false
  showEditorFeedback('AI 修正流程已結束，請查看修改差異或右側結果訊息。', 'info')
})

watch(() => props.activeTab, () => {
  nextTick(() => {
    editor?.layout()
  })
})

watch(() => props.filePath, () => {
  pasteMenu.value = { ...pasteMenu.value, visible: false }
  diagnosticFixFeedbackPending = false
  diagnosticFixSawResultLoading = false
  if (!editor) return
  const model = editor.getModel()
  if (model) monaco.editor.setModelLanguage(model, languageId.value)
  syncEditorValue(props.content, { force: true })
  inlineCache = new Map()
  clearInlineSuggestion()
  clearDiagnosticsMarkers()
  nextTick(() => {
    editor?.layout()
    if (props.filePath && !isImagePreview.value) {
      editor?.focus()
      scheduleInlineSuggest()
      scheduleDiagnostics()
    }
  })
})

function configureMonacoLanguageServices() {
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: false
  })
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: false
  })
  const compilerOptions = {
    allowJs: true,
    checkJs: true,
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    allowNonTsExtensions: true,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    jsx: monaco.languages.typescript.JsxEmit.React,
    strict: false
  }
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions(compilerOptions)
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions(compilerOptions)
}

function markerSeverity(value = '') {
  if (value === 'warning') return monaco.MarkerSeverity.Warning
  if (value === 'info') return monaco.MarkerSeverity.Info
  if (value === 'hint') return monaco.MarkerSeverity.Hint
  return monaco.MarkerSeverity.Error
}

function clearDiagnosticsMarkers() {
  const model = editor?.getModel()
  if (model) {
    monaco.editor.setModelMarkers(model, 'cubi-local-diagnostics', [])
    monaco.editor.setModelMarkers(model, 'cubi-server-diagnostics', [])
  }
  diagnosticDecorationCollection?.clear()
  localDiagnosticMarkers = []
  serverDiagnosticMarkers = []
  diagnosticSummary.value = { count: 0, message: '' }
}

function setLocalDiagnosticsMarkers(markers = []) {
  const model = editor?.getModel()
  localDiagnosticMarkers = markers.map(item => ({
    severity: markerSeverity(item.severity),
    message: item.message,
    startLineNumber: item.startLineNumber,
    startColumn: item.startColumn,
    endLineNumber: item.endLineNumber || item.startLineNumber,
    endColumn: item.endColumn || item.startColumn + 1,
    source: 'Monaco quick diagnostics'
  }))
  if (model) monaco.editor.setModelMarkers(model, 'cubi-local-diagnostics', localDiagnosticMarkers)
  refreshDiagnosticDecorations()
  refreshDiagnosticSummary()
}

function refreshDiagnosticDecorations() {
  if (!editor || !diagnosticDecorationCollection || !monaco) return
  const markersByLine = new Map()
  for (const marker of [...localDiagnosticMarkers, ...serverDiagnosticMarkers]) {
    if (![monaco.MarkerSeverity.Error, monaco.MarkerSeverity.Warning].includes(marker.severity)) continue
    const line = Math.max(1, Number(marker.startLineNumber || 1))
    const current = markersByLine.get(line)
    if (!current || marker.severity === monaco.MarkerSeverity.Error) {
      markersByLine.set(line, marker)
    }
  }
  diagnosticDecorationCollection.set(Array.from(markersByLine.entries()).map(([line, marker]) => {
    const isWarning = marker.severity === monaco.MarkerSeverity.Warning
    return {
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        glyphMarginClassName: isWarning ? 'cubi-diagnostic-glyph cubi-diagnostic-glyph-warning' : 'cubi-diagnostic-glyph cubi-diagnostic-glyph-error',
        glyphMarginHoverMessage: { value: `**${marker.source || 'Diagnostic'}**\n\n${marker.message || ''}` }
      }
    }
  }))
}

function refreshDiagnosticSummary() {
  const markers = [...localDiagnosticMarkers, ...serverDiagnosticMarkers]
    .filter(item => item.severity === monaco.MarkerSeverity.Error || item.severity === monaco.MarkerSeverity.Warning)
  const first = markers[0]
  diagnosticSummary.value = {
    count: markers.length,
    message: first?.message ? String(first.message).slice(0, 80) : ''
  }
}

function diagnosticMarkersForFix() {
  const seen = new Set()
  return [...localDiagnosticMarkers, ...serverDiagnosticMarkers]
    .filter(item => item.severity === monaco.MarkerSeverity.Error || item.severity === monaco.MarkerSeverity.Warning)
    .sort((a, b) =>
      (a.startLineNumber - b.startLineNumber) ||
      (a.startColumn - b.startColumn) ||
      String(a.message || '').localeCompare(String(b.message || ''))
    )
    .filter(item => {
      const key = `${item.startLineNumber}:${item.startColumn}:${item.message}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 20)
}

function diagnosticFixInstruction(markers = diagnosticMarkersForFix()) {
  const details = markers.length
    ? markers.map(item => `- 第 ${item.startLineNumber} 行第 ${item.startColumn} 欄：${item.message}`).join('\n')
    : '- 編輯器目前顯示錯誤紅線，請檢查全檔語法、import、未定義名稱與拼字錯誤。'

  return `請像 Codeium Quick Fix 一樣，依照目前檔案的錯誤紅線做最小必要修正。
檔案：${props.filePath}
目前診斷：
${details}

要求：
- 只修正造成紅線的真實錯誤，以及同一檔案中同類型的明顯錯字。
- 優先修正語法錯誤、import 錯誤、未定義名稱、函式或變數拼字錯誤。
- 保留原本功能與輸出格式，不要重寫無關程式。
- 回傳完整修正後檔案內容。`
}

function triggerDiagnosticFix() {
  if (!editor || !props.filePath || props.loading || props.resultLoading) return
  const markers = diagnosticMarkersForFix()
  if (!markers.length) {
    showEditorFeedback('目前沒有可修正的錯誤紅線。', 'info')
    return
  }
  diagnosticFixFeedbackPending = true
  diagnosticFixSawResultLoading = false
  showEditorFeedback('已讀取真實錯誤紅線，正在送交 Ollama 產生修正...', 'info', { persist: true })
  emit('inline-command', {
    action: 'fix',
    label: 'AI 修正錯誤',
    instruction: diagnosticFixInstruction(markers),
    selectedCode: '',
    content: editor.getValue(),
    filePath: props.filePath,
    targetFiles: [props.filePath],
    targetOnly: true,
    cursor: cursor.value,
    autoApply: true
  })
}

function canRequestServerDiagnostics() {
  return Boolean(editor && props.filePath && !props.loading && serverDiagnosticLanguages.includes(languageId.value))
}

function scheduleDiagnostics() {
  if (diagnosticsTimer) window.clearTimeout(diagnosticsTimer)
  if (localDiagnosticsTimer) window.clearTimeout(localDiagnosticsTimer)
  activeDiagnosticsController?.abort()
  activeDiagnosticsController = null

  localDiagnosticsTimer = window.setTimeout(() => {
    runLocalDiagnostics()
  }, 180)

  if (!canRequestServerDiagnostics()) {
    const model = editor?.getModel()
    if (model) monaco.editor.setModelMarkers(model, 'cubi-server-diagnostics', [])
    serverDiagnosticMarkers = []
    refreshDiagnosticDecorations()
    refreshDiagnosticSummary()
    return
  }

  diagnosticsTimer = window.setTimeout(() => {
    requestServerDiagnostics()
  }, 350)
}

function markerFromLineColumn(line, column, message, severity = 'error') {
  const startLineNumber = Math.max(1, Number(line) || 1)
  const startColumn = Math.max(1, Number(column) || 1)
  return {
    severity,
    message,
    startLineNumber,
    startColumn,
    endLineNumber: startLineNumber,
    endColumn: startColumn + 1
  }
}

const pythonKnownNames = new Set([
  'abs', 'all', 'any', 'bool', 'breakpoint', 'bytes', 'callable', 'chr', 'classmethod', 'dict', 'dir', 'divmod',
  'enumerate', 'eval', 'Exception', 'filter', 'float', 'format', 'frozenset', 'getattr', 'hasattr', 'hash', 'help',
  'id', 'input', 'int', 'isinstance', 'issubclass', 'iter', 'len', 'list', 'map', 'max', 'min', 'next', 'object',
  'open', 'ord', 'pow', 'print', 'property', 'range', 'repr', 'reversed', 'round', 'set', 'setattr', 'slice',
  'sorted', 'staticmethod', 'str', 'sum', 'super', 'tuple', 'type', 'vars', 'zip', 'True', 'False', 'None',
  '__name__', '__file__', '__package__',
  'ArithmeticError', 'AssertionError', 'AttributeError', 'BaseException', 'BlockingIOError', 'BrokenPipeError',
  'BufferError', 'BytesWarning', 'ChildProcessError', 'ConnectionAbortedError', 'ConnectionError',
  'ConnectionRefusedError', 'ConnectionResetError', 'DeprecationWarning', 'EOFError', 'EnvironmentError',
  'FileExistsError', 'FileNotFoundError', 'FloatingPointError', 'FutureWarning', 'GeneratorExit', 'IOError',
  'ImportError', 'ImportWarning', 'IndentationError', 'IndexError', 'InterruptedError', 'IsADirectoryError',
  'KeyError', 'KeyboardInterrupt', 'LookupError', 'MemoryError', 'ModuleNotFoundError', 'NameError',
  'NotADirectoryError', 'NotImplementedError', 'OSError', 'OverflowError', 'PendingDeprecationWarning',
  'PermissionError', 'ProcessLookupError', 'RecursionError', 'ReferenceError', 'ResourceWarning',
  'RuntimeError', 'RuntimeWarning', 'StopAsyncIteration', 'StopIteration', 'SyntaxError', 'SyntaxWarning',
  'SystemError', 'SystemExit', 'TabError', 'TimeoutError', 'TypeError', 'UnboundLocalError', 'UnicodeDecodeError',
  'UnicodeEncodeError', 'UnicodeError', 'UnicodeTranslateError', 'UnicodeWarning', 'UserWarning', 'ValueError',
  'Warning', 'ZeroDivisionError'
])
const pythonKeywordNames = new Set([
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
  'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass',
  'raise', 'return', 'try', 'while', 'with', 'yield'
])

function maskPythonStringsAndComments(line = '') {
  let masked = ''
  let quote = ''
  let escaped = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (!quote && char === '#') {
      masked += ' '.repeat(line.length - index)
      break
    }
    if (quote) {
      masked += ' '
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = ''
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      masked += ' '
      continue
    }
    masked += char
  }
  return masked
}

function maskPythonLinesAndComments(lines = []) {
  const maskedLines = []
  let blockQuote = ''
  for (const rawLine of lines) {
    const line = String(rawLine || '')
    let masked = ''
    let quote = ''
    let escaped = false
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index]
      const triple = line.slice(index, index + 3)
      if (blockQuote) {
        masked += ' '
        if (triple === blockQuote) {
          masked += '  '
          index += 2
          blockQuote = ''
        }
        continue
      }
      if (!quote && (triple === '"""' || triple === "'''")) {
        blockQuote = triple
        masked += '   '
        index += 2
        continue
      }
      if (!quote && char === '#') {
        masked += ' '.repeat(line.length - index)
        break
      }
      if (quote) {
        masked += ' '
        if (escaped) {
          escaped = false
        } else if (char === '\\') {
          escaped = true
        } else if (char === quote) {
          quote = ''
        }
        continue
      }
      if (char === '"' || char === "'") {
        quote = char
        masked += ' '
        continue
      }
      masked += char
    }
    maskedLines.push(masked)
  }
  return maskedLines
}

function definePythonTargetNames(target = '', definedNames) {
  const clean = String(target || '').replace(/\[[^\]]*\]/g, '')
  for (const match of clean.matchAll(/\b([A-Za-z_]\w*)\b/g)) {
    const name = match[1]
    if (!pythonKeywordNames.has(name)) definedNames.add(name)
  }
}

function collectPythonDefinedNames(lines = []) {
  const definedNames = new Set(pythonKnownNames)
  const maskedLines = maskPythonLinesAndComments(lines)
  maskedLines.forEach(line => {
    const trimmed = line.trim()
    let match
    if ((match = trimmed.match(/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)/))) {
      definedNames.add(match[1])
      match[2].split(',').forEach(part => definePythonTargetNames(part.split('=')[0], definedNames))
      return
    }
    if ((match = trimmed.match(/^class\s+([A-Za-z_]\w*)\b/))) {
      definedNames.add(match[1])
      return
    }
    if ((match = trimmed.match(/^import\s+(.+)/))) {
      match[1].split(',').forEach(part => {
        const imported = part.trim().match(/^([A-Za-z_]\w*)(?:\.[A-Za-z_]\w*)*(?:\s+as\s+([A-Za-z_]\w*))?/)
        if (imported) definedNames.add(imported[2] || imported[1])
      })
      return
    }
    if ((match = trimmed.match(/^from\s+[\w.]+\s+import\s+(.+)/))) {
      match[1].split(',').forEach(part => {
        const imported = part.trim().match(/^([A-Za-z_]\w*|\*)(?:\s+as\s+([A-Za-z_]\w*))?/)
        if (imported && imported[1] !== '*') definedNames.add(imported[2] || imported[1])
      })
      return
    }
    for (const forMatch of trimmed.matchAll(/\b(?:for|async\s+for)\s+(.+?)\s+in\s+/g)) {
      definePythonTargetNames(forMatch[1], definedNames)
    }
    if ((match = trimmed.match(/^with\s+.+?\s+as\s+(.+?)(?:\s*:|$)/))) definePythonTargetNames(match[1], definedNames)
    if ((match = trimmed.match(/^except\s+.+?\s+as\s+([A-Za-z_]\w*)/))) definedNames.add(match[1])
    if (/^[A-Za-z_0-9()[\],\s]*(?::\s*[^=]+)?\s*=/.test(trimmed) && !/[=!<>]=/.test(trimmed)) {
      definePythonTargetNames(trimmed.split('=')[0], definedNames)
    }
  })
  return definedNames
}

function pythonNameDiagnostics(lines = []) {
  const definedNames = collectPythonDefinedNames(lines)
  const markers = []
  const seen = new Set()
  const maskedLines = maskPythonLinesAndComments(lines)
  maskedLines.forEach((line, index) => {
    const trimmed = line.trim()
    if (/^(?:from|import)\s+/.test(trimmed)) return
    for (const match of line.matchAll(/\b([A-Za-z_]\w*)\s*(?=[(.])/g)) {
      const name = match[1]
      const previous = line.slice(0, match.index).trimEnd()
      if (pythonKeywordNames.has(name) || definedNames.has(name)) continue
      if (previous.endsWith('def') || previous.endsWith('class') || previous.endsWith('.')) continue
      const key = `${index + 1}:${name}`
      if (seen.has(key)) continue
      seen.add(key)
      markers.push(markerFromLineColumn(index + 1, match.index + 1, `NameError: name '${name}' is not defined`))
    }
  })
  return markers
}

function unmatchedOpening(text = '', open = '(', close = ')') {
  const stack = []
  const lines = String(text || '').split('\n')
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    for (let columnIndex = 0; columnIndex < line.length; columnIndex += 1) {
      const char = line[columnIndex]
      if (char === open) stack.push({ line: lineIndex + 1, column: columnIndex + 1 })
      if (char === close && stack.length) stack.pop()
    }
  }
  return stack.at(-1) || null
}

function pythonNestingDepthBeforeLine(lines = [], targetIndex = 0) {
  const pairs = { '(': ')', '[': ']', '{': '}' }
  const closing = new Set(Object.values(pairs))
  const stack = []
  const maskedLines = maskPythonLinesAndComments(lines)
  for (let lineIndex = 0; lineIndex < targetIndex; lineIndex += 1) {
    const line = maskedLines[lineIndex] || ''
    for (const char of line) {
      if (pairs[char]) stack.push(pairs[char])
      else if (closing.has(char) && stack.at(-1) === char) stack.pop()
    }
  }
  return stack.length
}

function javascriptQuickDiagnostics(text = '') {
  const source = String(text || '')
  if (/(^|\n)\s*(?:import|export)\b/.test(source) || /<[A-Z][A-Za-z0-9]*(?:\s|>|\/>)/.test(source) || /<\w+[\s>][\s\S]*<\/\w+>/.test(source)) {
    return []
  }
  try {
    // eslint-disable-next-line no-new-func
    new Function(source)
    return []
  } catch (error) {
    const match = String(error?.stack || error?.message || '').match(/<anonymous>:(\d+):(\d+)/)
    if (!match) return []
    return [markerFromLineColumn(match[1], match[2], error?.message || 'JavaScript syntax error')]
  }
}

function pythonQuickDiagnostics(text = '') {
  const markers = []
  const paren = unmatchedOpening(text, '(', ')')
  if (paren) {
    markers.push(markerFromLineColumn(paren.line, paren.column, "SyntaxError: '(' was never closed"))
  }
  const lines = String(text || '').split('\n')
  lines.forEach((line, index) => {
    const maskedLine = maskPythonStringsAndComments(line).trimEnd()
    if (
      pythonNestingDepthBeforeLine(lines, index) === 0 &&
      /^\s*(?:def|class|if|elif|else|for|while|try|except|finally|with)\b/.test(maskedLine) &&
      !maskedLine.endsWith(':')
    ) {
      markers.push(markerFromLineColumn(index + 1, Math.max(1, line.length), "SyntaxError: expected ':'"))
    }
  })
  markers.push(...pythonNameDiagnostics(lines))
  return markers.slice(0, 20)
}

function javaQuickDiagnostics(text = '') {
  const markers = []
  const lines = String(text || '').split('\n')
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (
      trimmed &&
      !trimmed.endsWith(';') &&
      !trimmed.endsWith('{') &&
      !trimmed.endsWith('}') &&
      !trimmed.startsWith('//') &&
      /(?:System\.out\.println|=|return\s+|new\s+)/.test(trimmed)
    ) {
      markers.push(markerFromLineColumn(index + 1, line.length, "Java syntax error: ';' expected"))
    }
  })
  return markers.slice(0, 5)
}

function runLocalDiagnostics() {
  if (!editor || !props.filePath || props.loading) {
    setLocalDiagnosticsMarkers([])
    return
  }
  const text = editor.getValue()
  const language = languageId.value
  const markers = language === 'javascript'
    ? javascriptQuickDiagnostics(text)
    : language === 'python'
      ? pythonQuickDiagnostics(text)
      : language === 'java'
        ? javaQuickDiagnostics(text)
        : []
  setLocalDiagnosticsMarkers(markers)
}

async function requestServerDiagnostics() {
  if (!canRequestServerDiagnostics()) return
  const model = editor.getModel()
  if (!model) return

  const requestSeq = ++diagnosticsSeq
  const modelVersion = model.getVersionId()
  const controller = new AbortController()
  activeDiagnosticsController = controller

  try {
    const data = await apiPost('/api/diagnostics/check', {
      file_path: props.filePath,
      language: languageId.value,
      code: model.getValue()
    }, { signal: controller.signal })

    if (controller.signal.aborted || requestSeq !== diagnosticsSeq) return
    if (editor?.getModel() !== model || model.getVersionId() !== modelVersion) return

    serverDiagnosticMarkers = (Array.isArray(data.markers) ? data.markers : []).map(item => ({
      severity: markerSeverity(item.severity),
      message: String(item.message || 'Diagnostic'),
      startLineNumber: Math.max(1, Number(item.startLineNumber || item.line || 1)),
      startColumn: Math.max(1, Number(item.startColumn || item.column || 1)),
      endLineNumber: Math.max(1, Number(item.endLineNumber || item.startLineNumber || item.line || 1)),
      endColumn: Math.max(2, Number(item.endColumn || item.startColumn || item.column || 1) + 1),
      source: data.language ? `Cubi ${data.language}` : 'Cubi diagnostics'
    }))
    monaco.editor.setModelMarkers(model, 'cubi-server-diagnostics', serverDiagnosticMarkers)
    if (serverDiagnosticLanguages.includes(languageId.value)) {
      localDiagnosticMarkers = []
      monaco.editor.setModelMarkers(model, 'cubi-local-diagnostics', [])
    }
    refreshDiagnosticDecorations()
    refreshDiagnosticSummary()
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') return
  } finally {
    if (activeDiagnosticsController === controller) activeDiagnosticsController = null
  }
}

async function formatDocument() {
  if (!editor || !props.filePath || formatBusy.value) return
  editor.focus()
  formatBusy.value = true
  showEditorFeedback('正在格式化...', 'info', { persist: true })
  const original = editor.getValue()
  let backendMessage = ''

  try {
    try {
      const data = await apiPost('/api/format', {
        file_path: props.filePath,
        language: languageId.value,
        code: original
      })
      const formatted = String(data.formatted || '')
      if (data.ok && formatted && formatted !== original) {
        replaceEditorContent(formatted, 'cubi-format-api')
        showEditorFeedback('格式化完成。', 'success')
        return
      }
      if (data.ok === false && data.error) {
        backendMessage = data.error
      }
    } catch (error) {
      backendMessage = error.message || String(error)
    }

    const beforeMonacoFormat = editor.getValue()
    const formatAction = editor.getAction('editor.action.formatDocument')
    if (formatAction) {
      suppressChange = true
      try {
        await formatAction.run()
      } finally {
        suppressChange = false
      }
    }
    const afterMonacoFormat = editor.getValue()
    if (afterMonacoFormat !== beforeMonacoFormat) {
      lastEmittedValue = afterMonacoFormat
      clearInlineSuggestion()
      updateCursor()
      emit('update:content', afterMonacoFormat)
      scheduleDiagnostics()
      showEditorFeedback('格式化完成。', 'success')
      return
    }

    const message = backendMessage
      ? `格式化未執行：${backendMessage}`
      : '格式化未產生變更；目前內容已符合格式或沒有可用格式化器。'
    showEditorFeedback(message, backendMessage ? 'warning' : 'info')
    emit('format-message', message)
  } finally {
    formatBusy.value = false
  }
}

async function triggerSuggestWidget() {
  if (!editor || !props.filePath || autocompleteBusy.value) return
  if (!autocompleteEnabled.value) {
    showEditorFeedback('Autocomplete 已停用。', 'warning')
    return
  }
  editor.focus()
  autocompleteBusy.value = true
  showEditorFeedback('正在取得補全...', 'info', { persist: true })

  try {
    triggerEditorCommand('editor.action.triggerSuggest')
    const result = await triggerInlineSuggestNow({ allowWithoutFocus: true, forceBackend: true })
    const hasSuggestion = Boolean(result?.items?.length || lastInlineSuggestion.text)
    if (hasSuggestion) {
      showEditorFeedback('已產生補全候選，按 Tab 套用。', 'success')
      return
    }
    showEditorFeedback('目前游標位置沒有可用補全。', 'info')
  } catch (error) {
    const message = String(error?.message || error || '補全失敗。')
    showEditorFeedback(`補全失敗：${message}`, 'warning')
    emit('autocomplete-error', message)
  } finally {
    autocompleteBusy.value = false
  }
}

function triggerInlineCommand() {
  if (!editor || !props.filePath || props.loading) return
  editor.focus()
  updateCursor()

  const model = editor.getModel()
  const content = editor.getValue()
  if (!String(content || '').trim()) {
    emit('format-message', 'Inline Command 需要目前檔案有實際內容。')
    return
  }
  const selection = editor.getSelection()
  const selectedCode = model && selection && !selection.isEmpty() ? model.getValueInRange(selection) : ''
  inlineCommandBox.value = {
    visible: true,
    text: selectedCode
    ? '請依照選取程式碼修正錯誤、重構或補強防呆，並產生 Diff'
    : '請針對目前完整檔案產生可確認的修改 Diff'
  }
  clearInlineSuggestion()
  nextTick(() => {
    inlineCommandInput.value?.focus()
    inlineCommandInput.value?.select()
  })
}

function submitInlineCommand() {
  if (!editor || !props.filePath || props.loading) return
  const model = editor.getModel()
  const selection = editor.getSelection()
  const selectedCode = model && selection && !selection.isEmpty() ? model.getValueInRange(selection) : ''
  const content = editor.getValue()
  const instruction = String(inlineCommandBox.value.text || '').trim()
  if (!instruction) {
    showEditorFeedback('請輸入 Ctrl+I 指令內容。', 'warning')
    return
  }

  clearInlineSuggestion()
  inlineCommandBox.value = { visible: false, text: '' }
  editor.focus()
  updateSelection()
  emit('inline-command', {
    instruction,
    selectedCode,
    content,
    filePath: props.filePath,
    cursor: cursor.value
  })
}

function cancelInlineCommand() {
  inlineCommandBox.value = { visible: false, text: '' }
  editor?.focus()
}

function toggleAutocomplete() {
  autocompleteEnabled.value = !autocompleteEnabled.value

  if (!autocompleteEnabled.value) {
    inlineRequestSeq += 1
    inlineCache = new Map()
    if (inlineTriggerTimer) {
      window.clearTimeout(inlineTriggerTimer)
      inlineTriggerTimer = null
    }
    clearInlineSuggestion()
    return
  }

  scheduleInlineSuggest()
}

function toggleMinimap() {
  minimapEnabled.value = !minimapEnabled.value
  editor?.updateOptions({
    minimap: { enabled: minimapEnabled.value, size: 'proportional', scale: 1, maxColumn: 80, showSlider: 'mouseover' }
  })
}

function registerInlineCompletionProviders() {
  inlineProviderDisposables = supportedInlineLanguages.map(language =>
    monaco.languages.registerInlineCompletionsProvider(language, {
      provideInlineCompletions: async (model, position, context, token) => {
        return provideCubiInlineCompletions(model, position, token)
      },
      freeInlineCompletions: () => {}
    })
  )
}

function registerDiagnosticHoverProviders() {
  hoverProviderDisposables = supportedInlineLanguages.map(language =>
    monaco.languages.registerHoverProvider(language, {
      provideHover: (model, position) => {
        const markers = monaco.editor.getModelMarkers({ resource: model.uri })
          .filter(item =>
            position.lineNumber >= item.startLineNumber &&
            position.lineNumber <= item.endLineNumber &&
            position.column >= item.startColumn &&
            position.column <= Math.max(item.endColumn, item.startColumn + 1)
          )
        if (!markers.length) return null
        return {
          range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column + 1),
          contents: markers.map(item => ({ value: `**${item.source || 'Diagnostic'}**\n\n${item.message}` }))
        }
      }
    })
  )
}

function registerDiagnosticCodeActionProviders() {
  codeActionProviderDisposables = supportedInlineLanguages.map(language =>
    monaco.languages.registerCodeActionProvider(language, {
      provideCodeActions: (model, range, context) => {
        const modelMarkers = Array.isArray(context?.markers) && context.markers.length
          ? context.markers
          : monaco.editor.getModelMarkers({ resource: model.uri })
        const markers = modelMarkers.filter(item =>
          (item.severity === monaco.MarkerSeverity.Error || item.severity === monaco.MarkerSeverity.Warning) &&
          item.startLineNumber <= range.endLineNumber &&
          item.endLineNumber >= range.startLineNumber
        )
        if (!markers.length) return { actions: [], dispose: () => {} }
        return {
          actions: [{
            title: 'AI 修正這些錯誤',
            kind: monaco.languages.CodeActionKind.QuickFix,
            diagnostics: markers,
            command: {
              id: 'cubi-code.fixDiagnostics',
              title: 'AI 修正錯誤'
            }
          }],
          dispose: () => {}
        }
      }
    })
  )
}

async function requestInlineSuggestionNow(options = {}) {
  if (!autocompleteEnabled.value || !editor || !props.filePath || props.loading) return emptyInlineCompletions()
  if (!options.forceBackend && triggerEditorCommand('editor.action.inlineSuggest.trigger')) return emptyInlineCompletions()
  const model = editor.getModel()
  const position = editor.getPosition()
  if (!model || !position) return emptyInlineCompletions()
  return requestInlineSuggestion(model, position, null, { bypassCache: options.forceBackend, appendCandidate: options.appendCandidate })
}

async function provideCubiInlineCompletions(model, position, token) {
  return requestInlineSuggestion(model, position, token)
}

async function requestInlineSuggestion(model, position, token = null, options = {}) {
  if (!autocompleteEnabled.value || !canRequestAutocomplete(model, position)) return emptyInlineCompletions()

  const requestSeq = ++inlineRequestSeq
  const modelVersion = model.getVersionId()
  const lineBefore = model.getLineContent(position.lineNumber).slice(0, position.column - 1)
  const lineAfter = model.getLineContent(position.lineNumber).slice(position.column - 1)
  const cacheKey = `${props.filePath}|${modelVersion}|${position.lineNumber}:${position.column}|${lineBefore}|${lineAfter.slice(0, 40)}`

  if (!options.bypassCache && inlineCache.has(cacheKey)) {
    const cachedText = inlineCache.get(cacheKey)
    return buildInlineResult(cachedText, position, modelVersion)
  }

  let suggestion = ''
  let candidates = []
  const payload = buildAutocompletePayload(model, position)
  activeAutocompleteController?.abort()
  const controller = new AbortController()
  activeAutocompleteController = controller
  const cancelSubscription = token?.onCancellationRequested?.(() => controller.abort())
  const timeout = window.setTimeout(() => controller.abort(), AUTOCOMPLETE_REQUEST_TIMEOUT_MS)

  try {
    const data = await apiPost('/api/ai/autocomplete', payload, { signal: controller.signal })

    if (data.ok === false) {
      if (isAutocompleteNoSuggestion(data)) {
        lastAutocompleteError = ''
        emit('audit-refresh')
        return emptyInlineCompletions()
      }
      throw new Error(data.error || 'Ollama 未回傳可用的自動補全內容。')
    }

    const rawCandidates = Array.isArray(data.suggestions) ? data.suggestions : []
    candidates = uniqueInlineSuggestions(rawCandidates.map(item => {
      const raw = typeof item === 'string' ? item : (item?.suggestion || item?.content || item?.insertText || '')
      return cleanInlineSuggestion(raw, lineBefore, lineAfter)
    }))
    const rawSuggestion = data.suggestion || data.content || candidates[0] || ''
    suggestion = cleanInlineSuggestion(rawSuggestion, lineBefore, lineAfter)
    candidates = uniqueInlineSuggestions([suggestion, ...candidates])
    lastAutocompleteError = ''
    emit('audit-refresh')
  } catch (error) {
    suggestion = ''
    if (controller.signal.aborted || error?.name === 'AbortError') return emptyInlineCompletions()
    const message = String(error?.message || error || 'Autocomplete 呼叫失敗。')
    if (message !== lastAutocompleteError) {
      lastAutocompleteError = message
      emit('autocomplete-error', message)
    }
    emit('audit-refresh')
  } finally {
    window.clearTimeout(timeout)
    cancelSubscription?.dispose?.()
    if (activeAutocompleteController === controller) activeAutocompleteController = null
  }

  if (token?.isCancellationRequested || requestSeq !== inlineRequestSeq) return emptyInlineCompletions()

  const currentModel = editor?.getModel()
  const currentPosition = editor?.getPosition()
  const stillSamePosition =
    currentModel === model &&
    currentPosition &&
    currentPosition.lineNumber === position.lineNumber &&
    currentPosition.column === position.column &&
    model.getVersionId() === modelVersion

  if (!stillSamePosition) return emptyInlineCompletions()

  if (suggestion) inlineCache.set(cacheKey, suggestion)
  return buildInlineResult(suggestion, position, modelVersion, { candidates, appendCandidate: options.appendCandidate })
}

function isAutocompleteNoSuggestion(data = {}) {
  const message = String(data.error || data.message || '').trim()
  const hasSuggestion = String(data.suggestion || data.content || '').trim()
  if (hasSuggestion) return false
  if (!message) return true
  return /上下文不足|未回傳可用|no useful completion|empty completion|no completion/i.test(message)
}

function uniqueInlineSuggestions(items = []) {
  const seen = new Set()
  const suggestions = []
  for (const item of items) {
    const text = String(item || '')
    const key = text.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    suggestions.push(text)
  }
  return suggestions
}

function buildInlineResult(text, position, modelVersion, options = {}) {
  const model = editor?.getModel()
  const suggestion = normalizeInlineSuggestionForInsertion(String(text || ''), model, position)
  const nextCandidates = uniqueInlineSuggestions([
    ...(options.appendCandidate ? inlineSuggestionCandidates : []),
    suggestion,
    ...(Array.isArray(options.candidates) ? options.candidates : [])
  ])

  if (!nextCandidates.length) {
    clearInlineSuggestion()
    return emptyInlineCompletions()
  }

  const candidateIndex = Math.max(0, nextCandidates.findIndex(item => item === suggestion))
  inlineSuggestionCandidates = nextCandidates
  applyInlineSuggestionCandidate(candidateIndex, position, modelVersion)

  return {
    items: nextCandidates.map(candidate => ({
      insertText: candidate,
      range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column)
    }))
  }
}

function normalizeInlineSuggestionForInsertion(text = '', model = null, position = null) {
  const suggestion = String(text || '')
  if (!suggestion || !model || !position) return suggestion
  if (suggestion.startsWith('\n') || suggestion.startsWith('\r\n')) return suggestion

  const modelLanguageId = model.getLanguageId?.() || languageId.value
  if (modelLanguageId !== 'python') return suggestion

  const lineContent = model.getLineContent(position.lineNumber)
  const linePrefix = lineContent.slice(0, position.column - 1)
  const lineAfter = lineContent.slice(position.column - 1)
  if (lineAfter.trim()) return suggestion

  const trimmedPrefix = linePrefix.trimStart()
  const trimmedSuggestion = suggestion.trimStart()
  const startsPythonStatement = startsStandaloneInlinePythonStatement(trimmedSuggestion)
  if (!startsPythonStatement) return suggestion

  if (!trimmedPrefix.startsWith('#')) {
    return looksCompleteInlinePythonLine(linePrefix) ? `\n${suggestion}` : suggestion
  }

  const indentation = linePrefix.match(/^\s*/)?.[0] || ''
  return `\n${indentation}${trimmedSuggestion}`
}

function startsStandaloneInlinePythonStatement(text = '') {
  return /^(?:from|import|def|class|if|elif|else|for|while|try|except|finally|with|async\s+def|async\s+for|match|case)\b/.test(String(text || '').trimStart())
}

function looksCompleteInlinePythonLine(line = '') {
  const text = String(line || '').trimEnd()
  if (!text.trim()) return false
  if (/^\s*#/.test(text)) return true
  if (/[.([{,=:+\-*/%\\]\s*$/.test(text)) return false
  const withoutEscaped = text.replace(/\\["']/g, '')
  const singleQuotes = (withoutEscaped.match(/'/g) || []).length
  const doubleQuotes = (withoutEscaped.match(/"/g) || []).length
  if (singleQuotes % 2 === 1 || doubleQuotes % 2 === 1) return false
  const pairs = [['(', ')'], ['[', ']'], ['{', '}']]
  return pairs.every(([open, close]) => {
    const opens = (text.match(new RegExp(`\\${open}`, 'g')) || []).length
    const closes = (text.match(new RegExp(`\\${close}`, 'g')) || []).length
    return opens <= closes
  })
}

function applyInlineSuggestionCandidate(index, position, modelVersion) {
  const total = inlineSuggestionCandidates.length
  if (!total) {
    clearInlineSuggestion()
    return
  }

  inlineSuggestionCandidateIndex = (index + total) % total
  const suggestion = inlineSuggestionCandidates[inlineSuggestionCandidateIndex]
  lastInlineSuggestion = {
    text: suggestion,
    lineNumber: position.lineNumber,
    column: position.column,
    modelVersion
  }

  const preview = normalizeGhostPreview(suggestion).replace(/\n/g, '⏎ ').slice(0, 180)
  inlineSuggestionText.value = preview
  emit('ghost', preview)
  renderInlineSuggestionDecoration()
  updateInlineSuggestWidgetPosition()
}

async function selectInlineSuggestionCandidate(delta) {
  if (!editor || !lastInlineSuggestion.text) {
    await triggerSuggestWidget()
    return
  }

  const position = editor.getPosition()
  const model = editor.getModel()
  if (!position || !model) return
  const stillSameSuggestion =
    position.lineNumber === lastInlineSuggestion.lineNumber &&
    position.column === lastInlineSuggestion.column &&
    model.getVersionId() === lastInlineSuggestion.modelVersion
  if (!stillSameSuggestion) {
    clearInlineSuggestion()
    return
  }

  if (inlineSuggestionCandidates.length > 1) {
    applyInlineSuggestionCandidate(inlineSuggestionCandidateIndex + delta, position, model.getVersionId())
    return
  }

  if (autocompleteBusy.value || !autocompleteEnabled.value || props.loading) return
  autocompleteBusy.value = true
  try {
    await triggerInlineSuggestNow({ allowWithoutFocus: true, forceBackend: true, appendCandidate: true })
    if (inlineSuggestionCandidates.length > 1) {
      const nextIndex = delta < 0 ? inlineSuggestionCandidates.length - 1 : 1
      const nextPosition = editor.getPosition()
      const nextModel = editor.getModel()
      if (nextPosition && nextModel) applyInlineSuggestionCandidate(nextIndex, nextPosition, nextModel.getVersionId())
    }
  } catch (error) {
    const message = String(error?.message || error || '補全候選切換失敗。')
    showEditorFeedback(`補全候選切換失敗：${message}`, 'warning')
  } finally {
    autocompleteBusy.value = false
  }
}

function acceptVisibleInlineSuggestion() {
  if (!editor || !lastInlineSuggestion.text) return
  const position = editor.getPosition()
  const model = editor.getModel()
  if (!position || !model) return
  const stillSameSuggestion =
    position.lineNumber === lastInlineSuggestion.lineNumber &&
    position.column === lastInlineSuggestion.column &&
    model.getVersionId() === lastInlineSuggestion.modelVersion
  if (!stillSameSuggestion) {
    clearInlineSuggestion()
    return
  }
  const text = normalizeInlineSuggestionForInsertion(lastInlineSuggestion.text, model, position)
  editor.executeEdits('cubi-inline-fallback', [{
    range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
    text,
    forceMoveMarkers: true
  }])
  clearInlineSuggestion()
  emit('update:content', editor.getValue())
}

function acceptInlineSuggestionNextWord() {
  if (!editor || !lastInlineSuggestion.text) return
  const position = editor.getPosition()
  const model = editor.getModel()
  if (!position || !model) return
  const stillSameSuggestion =
    position.lineNumber === lastInlineSuggestion.lineNumber &&
    position.column === lastInlineSuggestion.column &&
    model.getVersionId() === lastInlineSuggestion.modelVersion
  if (!stillSameSuggestion) {
    clearInlineSuggestion()
    return
  }

  const text = normalizeInlineSuggestionForInsertion(lastInlineSuggestion.text, model, position)
  const match = text.match(/^(\s+|[\w$]+\s*|[^\w$\s]+\s*)([\s\S]*)$/)
  const accepted = match ? match[1] : text
  const remaining = match ? match[2] : ''
  editor.executeEdits('cubi-inline-next-word', [{
    range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
    text: accepted,
    forceMoveMarkers: true
  }])
  emit('update:content', editor.getValue())

  if (!remaining.trim()) {
    clearInlineSuggestion()
    return
  }

  const nextPosition = editor.getPosition()
  const nextVersion = editor.getModel()?.getVersionId() || 0
  lastInlineSuggestion = {
    text: remaining,
    lineNumber: nextPosition?.lineNumber || position.lineNumber,
    column: nextPosition?.column || position.column + accepted.length,
    modelVersion: nextVersion
  }
  inlineSuggestionCandidates = [remaining]
  inlineSuggestionCandidateIndex = 0
  inlineSuggestionText.value = normalizeGhostPreview(remaining).replace(/\n/g, '⏎ ').slice(0, 180)
  emit('ghost', inlineSuggestionText.value)
  renderInlineSuggestionDecoration()
  updateInlineSuggestWidgetPosition()
}

function renderInlineSuggestionDecoration() {
  if (!editor || !inlineSuggestionDecorationCollection || !lastInlineSuggestion.text) {
    inlineSuggestionDecorationCollection?.clear()
    return
  }

  const firstLine = normalizeGhostPreview(lastInlineSuggestion.text).split('\n')[0]
  if (!firstLine.trim()) {
    inlineSuggestionDecorationCollection.clear()
    return
  }

  const range = new monaco.Range(
    lastInlineSuggestion.lineNumber,
    lastInlineSuggestion.column,
    lastInlineSuggestion.lineNumber,
    lastInlineSuggestion.column
  )
  inlineSuggestionDecorationCollection.set([{
    range,
    options: {
      after: {
        content: firstLine,
        inlineClassName: 'cubi-ghost-text',
        cursorStops: monaco.editor.InjectedTextCursorStops?.None ?? 0
      }
    }
  }])
}

function updateInlineSuggestWidgetPosition() {
  if (!editor || !editorHost.value || !lastInlineSuggestion.text) {
    inlineSuggestWidget.value = { visible: false, x: 0, y: 0 }
    return
  }

  const scrolledPosition = editor.getScrolledVisiblePosition({
    lineNumber: lastInlineSuggestion.lineNumber,
    column: lastInlineSuggestion.column
  })
  if (!scrolledPosition) {
    inlineSuggestWidget.value = { visible: false, x: 0, y: 0 }
    return
  }

  const pane = editorHost.value.parentElement
  const paneWidth = pane?.clientWidth || editorHost.value.clientWidth || 0
  const paneHeight = pane?.clientHeight || editorHost.value.clientHeight || 0
  const hostLeft = editorHost.value.offsetLeft || 0
  const hostTop = editorHost.value.offsetTop || 0
  const preferredX = hostLeft + scrolledPosition.left
  const preferredY = hostTop + scrolledPosition.top + scrolledPosition.height + 6
  const maxX = Math.max(8, paneWidth - 470)
  const belowFits = preferredY + 46 < paneHeight
  const fallbackY = hostTop + scrolledPosition.top - 46

  inlineSuggestWidget.value = {
    visible: true,
    x: Math.max(8, Math.min(preferredX, maxX)),
    y: Math.max(8, belowFits ? preferredY : fallbackY)
  }
}

function emptyInlineCompletions() {
  return { items: [] }
}

function canRequestAutocomplete(model, position) {
  if (!autocompleteEnabled.value || !props.filePath || props.loading) return false
  if (!supportedInlineLanguages.includes(languageId.value)) return false

  const fullText = model.getValue()
  if (!fullText.trim()) return false

  const line = model.getLineContent(position.lineNumber)
  const lineBefore = line.slice(0, position.column - 1)
  const trimmed = lineBefore.trim()

  const previousLine = position.lineNumber > 1 ? model.getLineContent(position.lineNumber - 1).trim() : ''
  const isPromptComment = trimmed.startsWith('#') || trimmed.startsWith('//')
  const previousIsPromptComment = previousLine.startsWith('#') || previousLine.startsWith('//')

  // Copilot / Codeium 的常見操作：
  // 使用者打一行註解後按 Enter，游標在下一個空白行，也要能出現 ghost text。
  const hasUsefulContext =
    trimmed.length >= 2 ||
    isPromptComment ||
    previousIsPromptComment ||
    previousLine.endsWith(':') ||
    previousLine.endsWith('(') ||
    previousLine.endsWith('[')
  return hasUsefulContext
}

function buildAutocompletePayload(model, position) {
  const fullText = model.getValue()
  const offset = model.getOffsetAt(position)
  const prefix = fullText.slice(Math.max(0, offset - 2400), offset)
  const suffix = fullText.slice(offset, Math.min(fullText.length, offset + 700))

  return {
    filePath: props.filePath,
    file_path: props.filePath,
    language: languageId.value,
    prefix,
    suffix
  }
}

function cleanInlineSuggestion(raw, lineBefore, lineAfter) {
  let text = String(raw || '').replace(/\r\n/g, '\n').trimEnd()

  text = text
    .replace(/^```[a-zA-Z0-9_-]*\s*/g, '')
    .replace(/```$/g, '')
    .replace(/^`|`$/g, '')

  const blockedPrefixes = ['說明：', '解釋：', '原因：', 'Explanation:', 'Here is', 'Sure,', '以下是']
  if (blockedPrefixes.some(prefix => text.trimStart().startsWith(prefix))) return ''

  const startsWithNewline = text.startsWith('\n')
  const lines = text.split('\n')
  if (startsWithNewline) lines.shift()
  text = `${startsWithNewline ? '\n' : ''}${lines.slice(0, 60).join('\n')}`

  const normalizedLineBefore = String(lineBefore || '').replace(/\t/g, '    ')
  const trimmedBefore = normalizedLineBefore.trimStart()

  if (trimmedBefore) {
    if (text.startsWith(normalizedLineBefore)) {
      text = text.slice(normalizedLineBefore.length)
    } else if (text.trimStart().startsWith(trimmedBefore)) {
      const leadingSpaces = text.length - text.trimStart().length
      text = text.slice(leadingSpaces + trimmedBefore.length)
    }
  }

  text = text.replace(/^\s*\n/, '\n')

  if (!text.trim()) return ''
  if (lineAfter && lineAfter.startsWith(text)) return ''
  if (text.length > 3000) text = text.slice(0, 3000)

  return text
}


function scheduleInlineSuggest() {
  if (!autocompleteEnabled.value || !editor || !props.filePath) return
  if (inlineTriggerTimer) window.clearTimeout(inlineTriggerTimer)

  inlineTriggerTimer = window.setTimeout(() => {
    inlineTriggerTimer = null
    triggerInlineSuggestNow({ forceBackend: true })
  }, getAutoInlineSuggestDelayMs())
}

function getAutoInlineSuggestDelayMs() {
  return 650 + Math.floor(Math.random() * 700)
}

function triggerInlineSuggestNow(options = {}) {
  if (!autocompleteEnabled.value || !editor || !props.filePath) return emptyInlineCompletions()
  if (!options.allowWithoutFocus && !editor.hasTextFocus()) return emptyInlineCompletions()
  return requestInlineSuggestionNow(options)
}

function triggerEditorCommand(commandId, payload = {}) {
  if (!editor || !commandId) return false
  try {
    const action = editor.getAction(commandId)
    if (action) {
      action.run(payload)
      return true
    }
  } catch {
  }

  return false
}

function clearInlineSuggestionIfCursorMoved() {
  if (!editor || !lastInlineSuggestion.text) return
  const position = editor.getPosition()
  const model = editor.getModel()
  if (!position || !model) return

  const moved =
    position.lineNumber !== lastInlineSuggestion.lineNumber ||
    position.column !== lastInlineSuggestion.column ||
    model.getVersionId() !== lastInlineSuggestion.modelVersion

  if (moved) clearInlineSuggestion()
}

function clearInlineSuggestion() {
  inlineSuggestionText.value = ''
  emit('ghost', '')
  inlineSuggestionDecorationCollection?.clear()
  inlineSuggestWidget.value = { visible: false, x: 0, y: 0 }
  lastInlineSuggestion = {
    text: '',
    lineNumber: 0,
    column: 0,
    modelVersion: 0
  }
  inlineSuggestionCandidates = []
  inlineSuggestionCandidateIndex = 0
}

function showEditorFeedback(message, tone = 'info', options = {}) {
  if (editorFeedbackTimer) {
    window.clearTimeout(editorFeedbackTimer)
    editorFeedbackTimer = null
  }

  editorFeedback.value = {
    message: String(message || ''),
    tone
  }

  if (!options.persist) {
    editorFeedbackTimer = window.setTimeout(() => {
      editorFeedback.value = { message: '', tone: 'info' }
      editorFeedbackTimer = null
    }, options.timeoutMs || 4500)
  }
}

function cancelInlineSuggestion() {
  inlineRequestSeq += 1
  activeAutocompleteController?.abort()
  activeAutocompleteController = null
  if (inlineTriggerTimer) {
    window.clearTimeout(inlineTriggerTimer)
    inlineTriggerTimer = null
  }
  triggerEditorCommand('editor.action.inlineSuggest.hide')
  clearInlineSuggestion()
}

function normalizeGhostPreview(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/^\n+/, '')
    .replace(/\s+$/, '')
}

function showPasteMenu(event) {
  if (!editor || props.loading) return
  event.preventDefault()
  event.stopPropagation()

  editor.focus()
  pasteMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY
  }
}

function hidePasteMenu() {
  pasteMenu.value = { ...pasteMenu.value, visible: false }
}

async function pasteFromClipboard() {
  hidePasteMenu()
  if (!editor || props.loading) return
  editor.focus()

  let text = ''
  try {
    if (navigator.clipboard?.readText) {
      text = await navigator.clipboard.readText()
    }
  } catch {
    text = ''
  }

  if (!text) {
    const manual = window.prompt('瀏覽器未允許讀取剪貼簿，請在這裡貼上文字後按確定：')
    if (manual === null) return
    text = manual
  }

  if (!text) return

  const selections = editor.getSelections() || []
  const edits = selections.map(selection => ({
    range: selection,
    text,
    forceMoveMarkers: true
  }))

  editor.executeEdits('cubi-paste', edits)
  clearInlineSuggestion()
  updateCursor()
  emit('update:content', editor.getValue())
}

function updateCursor() {
  if (!editor) return
  const position = editor.getPosition() || { lineNumber: 1, column: 1 }
  cursor.value = { line: position.lineNumber, col: position.column }
  emit('cursor', cursor.value)
}

function updateSelection() {
  if (!editor) return
  const model = editor.getModel()
  const selection = editor.getSelection()
  if (!model || !selection || selection.isEmpty()) {
    emit('selection', '')
    return
  }
  emit('selection', model.getValueInRange(selection))
}

function isImagePath(path = '') {
  return /\.(?:png|jpe?g|gif|webp)$/i.test(String(path || ''))
}

function getLanguageId(path = '') {
  const p = String(path || '').toLowerCase()
  if (isImagePath(p)) return 'image'
  if (p.endsWith('.py')) return 'python'
  if (p.endsWith('.db') || p.endsWith('.sqlite') || p.endsWith('.sqlite3')) return 'sql'
  if (p.endsWith('.vue')) return 'html'
  if (p.endsWith('.java')) return 'java'
  if (p.endsWith('.js') || p.endsWith('.mjs') || p.endsWith('.cjs')) return 'javascript'
  if (p.endsWith('.ts')) return 'typescript'
  if (p.endsWith('.json')) return 'json'
  if (p.endsWith('.md')) return 'markdown'
  if (p.endsWith('.css')) return 'css'
  if (p.endsWith('.html')) return 'html'
  if (p.endsWith('.sql')) return 'sql'
  return 'plaintext'
}

function getLanguageLabel(lang) {
  const map = {
    python: 'Python',
    java: 'Java',
    html: 'HTML / Vue',
    javascript: 'JavaScript',
    typescript: 'TypeScript',
    json: 'JSON',
    markdown: 'Markdown',
    css: 'CSS',
    sql: 'SQL',
    image: 'Image',
    plaintext: 'Text'
  }
  return map[lang] || 'Text'
}
</script>

<style scoped>
.editor-code-pane {
  position: relative;
}

.editor-actions button.active {
  color: #155eef;
  background: #eef5ff;
  box-shadow: inset 0 -2px 0 #155eef;
}

.save-editor-btn {
  color: #155eef !important;
}

.monaco-host {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #fff;
}

.monaco-host :deep(.cubi-diagnostic-glyph) {
  position: relative;
}

.monaco-host :deep(.cubi-diagnostic-glyph::before) {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 12px;
  height: 12px;
  transform: translate(-50%, -50%);
  border-radius: 999px;
  border: 2px solid #ef4444;
  background: rgba(239, 68, 68, .12);
  box-shadow: 0 0 0 2px #fff;
}

.monaco-host :deep(.cubi-diagnostic-glyph-warning::before) {
  border-color: #f59e0b;
  background: rgba(245, 158, 11, .16);
}

.editor-feature-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 6px 10px;
  border-bottom: 1px solid #e6edf7;
  background: #f8fbff;
  overflow-x: auto;
}

.feature-chip {
  flex: 0 0 auto;
  max-width: 360px;
  border: 1px solid #dbe5f3;
  border-radius: 999px;
  background: #fff;
  color: #334155;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.feature-chip.danger {
  border-color: #fecdca;
  background: #fff1f0;
  color: #b42318;
}

.feature-button {
  flex: 0 0 auto;
  border: 1px solid #bfdbfe;
  border-radius: 999px;
  background: #eef5ff;
  color: #155eef;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}

.feature-button:hover {
  background: #dbeafe;
}

.feature-button:disabled {
  cursor: default;
  opacity: .72;
}

.feature-button.busy {
  color: #175cd3;
  background: #dbeafe;
}

.editor-feedback {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 420px;
  border: 1px solid #dbe5f3;
  border-radius: 999px;
  padding: 4px 10px;
  background: #fff;
  color: #475467;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.editor-feedback.success {
  border-color: #abefc6;
  background: #ecfdf3;
  color: #067647;
}

.editor-feedback.warning {
  border-color: #fedf89;
  background: #fffaeb;
  color: #93370d;
}

.monaco-host.loading {
  opacity: .68;
}

.image-preview-pane {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  flex: 1;
  min-width: 0;
  min-height: 0;
  background: #f8fafc;
}

.image-preview-pane img {
  align-self: center;
  justify-self: center;
  max-width: calc(100% - 32px);
  max-height: calc(100% - 32px);
  object-fit: contain;
  border: 1px solid #dbe5f3;
  background: #fff;
  box-shadow: 0 10px 28px rgba(15, 23, 42, .12);
}

.image-preview-empty {
  align-self: center;
  justify-self: center;
  color: #64748b;
  font-size: 14px;
  font-weight: 800;
}

.image-preview-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  padding: 8px 12px;
  border-top: 1px solid #e6edf7;
  background: #fff;
  color: #475467;
  font-size: 12px;
}

.image-preview-meta b {
  color: #0f172a;
}

.dirty-dot {
  color: #f59e0b;
  font-size: 10px;
  line-height: 1;
}

.autocomplete-toggle {
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  padding: 2px 9px;
  background: #f8fafc;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.autocomplete-toggle.active,
.status-toggle.active {
  border-color: #99f6e4;
  background: #ecfdf5;
  color: #0f766e;
}

.status-toggle {
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  padding: 2px 9px;
  background: #f8fafc;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.editor-context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 132px;
  padding: 6px;
  border: 1px solid #d8e0ee;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 12px 28px rgba(15, 23, 42, .16);
}

.editor-context-menu button {
  width: 100%;
  border: 0;
  background: transparent;
  padding: 8px 10px;
  border-radius: 6px;
  text-align: left;
  color: #162033;
  cursor: pointer;
}

.editor-context-menu button:hover {
  background: #eef5ff;
  color: #155eef;
}

.inline-command-box {
  position: absolute;
  z-index: 30;
  left: 50%;
  top: 52px;
  display: grid;
  grid-template-columns: auto minmax(240px, 620px) auto auto;
  align-items: center;
  gap: 8px;
  width: min(760px, calc(100% - 40px));
  padding: 8px;
  border: 1px solid #c7d7fe;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 14px 36px rgba(15, 23, 42, .18);
  transform: translateX(-50%);
}

.inline-command-mark {
  border-radius: 6px;
  padding: 5px 8px;
  background: #eef5ff;
  color: #155eef;
  font-size: 12px;
  font-weight: 900;
}

.inline-command-box input {
  min-width: 0;
  height: 32px;
  border: 1px solid #d8e0ee;
  border-radius: 6px;
  padding: 0 10px;
  outline: none;
}

.inline-command-box input:focus {
  border-color: #155eef;
  box-shadow: 0 0 0 3px rgba(21, 94, 239, .12);
}

.inline-command-box button {
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  padding: 6px 10px;
  background: #eef5ff;
  color: #155eef;
  font-weight: 900;
  cursor: pointer;
}

.inline-command-box .ghost-button {
  border-color: #d8e0ee;
  background: #fff;
  color: #475467;
}

.inline-suggest-widget {
  position: absolute;
  z-index: 35;
  display: flex;
  align-items: center;
  gap: 3px;
  max-width: min(560px, calc(100% - 16px));
  padding: 3px 5px;
  border: 1px solid #d8e0ee;
  border-radius: 5px;
  background: rgba(255, 255, 255, .98);
  box-shadow: 0 8px 20px rgba(15, 23, 42, .14);
  white-space: nowrap;
  overflow: hidden;
}

.inline-suggest-widget button {
  min-width: 24px;
  height: 24px;
  border: 0;
  border-radius: 4px;
  padding: 0 6px;
  background: transparent;
  color: #475467;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.inline-suggest-widget button:hover:not(:disabled) {
  background: #eef5ff;
  color: #155eef;
}

.inline-suggest-widget button:disabled {
  color: #98a2b3;
  cursor: default;
  opacity: .65;
}

.inline-suggest-widget .accept,
.inline-suggest-widget .cancel {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #155eef;
}

.inline-suggest-widget .tool {
  color: #155eef;
}

.inline-suggest-widget .cancel {
  color: #155eef;
}

.inline-suggest-widget kbd {
  border: 1px solid #d0d5dd;
  border-radius: 3px;
  padding: 0 4px;
  background: #f8fafc;
  color: #667085;
  font-family: inherit;
  font-size: 10px;
  font-weight: 800;
  line-height: 16px;
}

:deep(.cubi-ghost-text) {
  color: #9aa3b2;
  font-style: italic;
  white-space: pre;
}
:global(.cubi-ghost-view-zone) {
  color: #9aa3b2;
  font-style: italic;
  font-family: Consolas, "Cascadia Mono", "Courier New", monospace;
  font-size: 15px;
  line-height: 24px;
  white-space: pre;
  pointer-events: none;
  padding-left: 64px;
  opacity: .9;
}

</style>
