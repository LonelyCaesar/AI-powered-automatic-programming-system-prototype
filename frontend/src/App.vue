<template>
  <LoginPage
    v-if="!isAuthenticated"
    :loading="loading.login"
    @login="handleLogin"
  />

  <div v-else class="app">
    <TopBar
      :health="health"
      :project-name="projectName"
      :current-user="currentUser"
      @logout="logout"
      @open-settings="settingsOpen = true"
      @open-stock="activeFile = 'Stock Dashboard'"
      @switch-project="handleSwitchProject"
    />
    
    <ModelSettingsModal
      v-if="settingsOpen"
      @close="settingsOpen = false"
      @saved="handleModelSettingsSaved"
    />
    <div class="main-grid">
      <div class="left-column">
        <FileExplorer
          :active="activeFile"
          :files="files"
          :project-name="projectName"
          :workspace-path="workspacePath"
          :can-reveal-path="workspaceSource === 'backend'"
          @select="selectFile"
          @select-folder="path => selectedExplorerFolder = path"
          @open-folder="handleOpenFolder"
          @open-folder-handle="handleOpenFolderHandle"
          @upload-files="handleUploadCodeFiles"
          @new-file="createNewFile"
          @new-folder="createNewFolder"
          @rename-item="renameExplorerItem"
          @refresh-folder="refreshFolderFromExplorer"
          @reveal-item="revealExplorerItem"
          @delete-selected="deleteSelectedExplorerItem"
          @clear-explorer="clearExplorer"
          @create-project="handleCreateProject"
        />
        <SystemStatus :health="health" @refresh="refreshHealth" />
      </div>

      <div class="center workbench-layout">
        <div class="card workbench-card">
          <div class="editor-toolbar">
            <div class="editor-title">
              <button
                type="button"
                class="editor-main-label"
                :class="{ active: activeWorkbenchTab === 'editor' }"
                @click="openResultTab('editor')"
              >
                <span class="shield">◇</span>
                <b>程式碼編輯器 <small>(Monaco Editor)</small></b>
              </button>
              <button
                type="button"
                class="editor-diff-tab"
                :class="{ active: activeWorkbenchTab === 'test' }"
                @click="openResultTab('test')"
              >
                測試 / AI 執行結果
              </button>
              <button
                type="button"
                class="editor-diff-tab"
                :class="{ active: activeWorkbenchTab === 'diff', pending: Boolean(diffText && pendingNewContent) }"
                @click="openResultTab('diff')"
              >
                修改差異
              </button>
              <button
                type="button"
                class="editor-diff-tab"
                :class="{ active: activeWorkbenchTab === 'terminal' }"
                @click="openResultTab('terminal')"
              >
                終端機
              </button>
              <button
                type="button"
                class="editor-diff-tab"
                :class="{ active: activeWorkbenchTab === 'audit' }"
                @click="openResultTab('audit')"
              >
                操作紀錄
              </button>
            </div>
            
            <div v-if="activeWorkbenchTab === 'diff' && Boolean(diffText && pendingNewContent) && !selectedDiffHistoryId" class="editor-actions editor-diff-actions">
              <button class="cancel-editor-diff-btn" :disabled="loading.result" @click="cancelDiff">取消</button>
              <button class="apply-editor-diff-btn" :disabled="loading.result || !(Boolean(diffText && pendingNewContent && !selectedDiffHistoryRecord))" @click="applyDiff">
                {{ loading.result ? '處理中...' : pendingAgentApproval ? '確認套用並測試' : '套用變更' }}
              </button>
            </div>
            <div v-else-if="activeWorkbenchTab === 'diff'" class="editor-actions diff-history-actions">
              <button v-if="Boolean(diffText && pendingNewContent) && selectedDiffHistoryId" type="button" @click="selectDiffHistoryRecord('current')">目前差異</button>
              <button type="button" :disabled="diffHistoryLoading" @click="loadDiffHistory">{{ diffHistoryLoading ? '讀取中...' : '重新整理記錄' }}</button>
            </div>
            <div v-else-if="activeWorkbenchTab === 'editor'" class="editor-actions save-only-actions">
              <button class="save-editor-btn" :disabled="!activeFile || loading.file || activeFileContentType === 'image'" @click="saveCurrentFile">💾 儲存</button>
            </div>
            
            <div class="tab-actions editor-actions" v-else-if="activeWorkbenchTab === 'test'" style="border-radius: 999px;">
              <button
                v-if="testResult && !testResult.ok && !testResult.autoFixStopped && !autoFixBlockReason"
                class="apply-editor-diff-btn"
                type="button"
                :disabled="loading.result"
                @click="fixCurrentTestFailure"
                style="background: #155eef; color: white;"
              >
                {{ loading.result ? '正在修正...' : '自動修正此錯誤' }}
              </button>
              <button
                v-else-if="testResult && !testResult.ok && autoFixBlockReason"
                type="button"
                disabled
                :title="autoFixBlockReason"
              >
                環境錯誤，無法修復
              </button>
              <button type="button" :disabled="loading.result" @click="runTests">
                {{ loading.result ? '正在準備 Sandbox...' : '在 AI 沙盒執行' }}
              </button>
            </div>
            <div class="tab-actions editor-actions" v-else-if="activeWorkbenchTab === 'audit'" style="border-radius: 999px;">
              <button type="button" @click="clearAuditLogs">清除記錄</button>
            </div>
          </div>
          
          <div class="workbench-content">
            <EditorPanel
              v-show="['editor', 'diff'].includes(activeWorkbenchTab)"
              :file-path="activeFile"
              :content="fileContent"
              :content-type="activeFileContentType"
              :preview-url="activeFilePreviewUrl"
              :preview-meta="activeFilePreviewMeta"
              :loading="loading.file"
              :ghost-text="ghostText"
              :dirty="isDirty"
              :open-files="openEditorFiles"
              :dirty-files="dirtyFilePaths"
              :diff-active="activeWorkbenchTab === 'diff'"
              :has-diff="Boolean(displayedDiffText)"
              :has-pending-diff="Boolean(diffText && pendingNewContent)"
              :diff-text="displayedDiffText"
              :diff-info="displayedDiffInfo"
              :diff-file-path="displayedDiffFilePath"
              :diff-history="diffHistory"
              :selected-history-id="selectedDiffHistoryId"
              :pending-history-id="pendingDiffHistoryId"
              :history-loading="diffHistoryLoading"
              :result-loading="loading.result"
              :can-apply-diff="Boolean(diffText && pendingNewContent && !selectedDiffHistoryRecord)"
              :approval-mode="pendingAgentApproval"
              :active-tab="activeWorkbenchTab"
              @update:content="handleEditorChange"
              @save="saveCurrentFile"
              @cursor="handleEditorCursor"
              @selection="handleEditorSelection"
              @ghost="ghostText = $event"
              @autocomplete-error="handleAutocompleteError"
              @format-message="handleFormatMessage"
              @audit-refresh="loadAuditLogs"
              @inline-command="runInlineCommand"
              @tab-select="selectFile($event, { preserveCommand: true })"
              @close-file="closeEditorFile"
              @close="closeActiveFile"
              @open-editor="openResultTab('editor')"
              @open-diff="openResultTab('diff')"
              @apply-diff="applyDiff"
              @cancel-diff="cancelDiff"
              @select-diff-history="selectDiffHistoryRecord"
              @delete-diff-history="deleteDiffHistoryRecord"
              @refresh-diff-history="loadDiffHistory"
            />
            <ResultTabs
              v-show="['test', 'terminal', 'audit'].includes(activeWorkbenchTab)"
              :file-path="pendingDiffFilePath || activeFile"
              :file-content="(pendingDiffFilePath || activeFile) === activeFile ? fileContent : ''"
              :files="files"
              :project-name="projectName"
              :project-id="sandboxProjectId"
              :active-tab="activeWorkbenchTab"
              :diff-text="diffText"
              :test-result="testResult"
              :audit-logs="auditLogs"
              :loading="loading.result"
              :can-apply="Boolean(diffText && pendingNewContent)"
              :approval-mode="pendingAgentApproval"
              :diff-info="diffInfo"
              :agent-steps="agentSteps"
              :created-files="createdFiles"
              :command-logs="commandLogs"
              :file-changes="fileChanges"
              @tab="openResultTab"
              @run-tests="runTests"
              @fix-failure="fixCurrentTestFailure"
              @apply="applyDiff"
              @cancel="cancelDiff"
              @clear-audit="clearAuditLogs"
            />
          </div>
        </div>
      </div>

      <ChatCommandPanel
        :key="`chat-${projectName || 'no-project'}-${activeFile || 'no-file'}`"
        :file-path="activeFile"
        :messages="chatMessages"
        :loading="chatBusy"
        :pinned-files="pinnedContextFiles"
        :open-files="openEditorFiles"
        :available-files="files"
        :tools="toolOptions"
        :active-tool="selectedTopTool"
        :active-command="selectedTopToolLabel"
        :active-command-icon="selectedTopToolIcon"
        :include-ide-context="includeIdeContext"
        :planning-mode="planningMode"
        :context-stats="contextStats"
        :agent-steps="agentSteps"
        :command-logs="commandLogs"
        :file-changes="fileChanges"
        mode="Agent"
        @toggle-ide-context="includeIdeContext = $event"
        @toggle-planning-mode="setPlanningMode"
        @add-context-file="addPinnedContextFile"
        @submit-plan-answers="submitPlanClarificationAnswers"
        @accept-plan="acceptPlanExecution"
        @revise-plan="requestPlanRevision"
        @cancel-plan="cancelPlanExecution"
        @send="sendChat"
        @tool="handleTool"
        @clear-command="clearSelectedTopTool"
        @clear-chat="clearChatMessages"
        @new-chat="startNewChat"
        @load-session="loadChatSession"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, defineAsyncComponent, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import TopBar from './components/TopBar.vue'
import LoginPage from './components/LoginPage.vue'
import FileExplorer from './components/FileExplorer.vue'
import EditorPanel from './components/EditorPanel.vue'
import ResultTabs from './components/ResultTabs.vue'
import ChatCommandPanel from './components/ChatCommandPanel.vue'
import SystemStatus from './components/SystemStatus.vue'
import { apiDelete, apiGet, apiPost } from './api/client'
import { createManagedContextBundle } from './utils/contextManager'
import { buildIdeContextPathEntries } from './utils/ideContext'
import {
  buildTestFailureFingerprint,
  extractWorkspaceFailurePaths,
  selectTestFailureRepairTarget,
} from './utils/testFailurePaths'
import { buildProjectFixInstruction, formatProjectFixSummary, isSandboxNetworkLimitation, selectProjectFixTarget, testFailureRepairBlockReason } from './utils/projectFix'
import {
  CHAT_AUTO_COMPACT_RATIO,
  CHAT_AUTO_COMPACT_THRESHOLD_CHARS,
  CHAT_CONTEXT_MAX_CHARS,
  CHAT_RECENT_MESSAGE_COUNT,
  buildConversationContextText as buildMessagesConversationContextText,
  createCompactedChatMessages,
  estimateChatCharsFromMessages,
  shouldAutoCompactChatMessages,
} from './utils/chatCompaction'
import {
  buildAutoWorkspaceRepairInstruction,
  createWorkspaceContextRecord,
  isWorkspaceRepairRequest,
} from './utils/workspaceContext'
import {
  buildOpenEditorTargetInstruction,
  getOpenEditorFixTargetFiles,
  getOpenEditorTargetFiles,
  hasMultipleOpenEditorTargets,
} from './utils/openEditorTargets'
import {
  buildMultiFileGenerationInstruction,
  getMultiFileGenerationItems,
} from './utils/generationTargets'
import {
  convertedTargetPath,
  findAvailableGeneratedPath,
  inferConversionTarget,
  inferGeneratedTargetPath,
  isExistingFileChangeAuthorized,
  resolveRequestedWorkspacePaths,
  selectTaskTargetPaths,
  validateTaskContext,
} from './utils/aiTaskSafety'
import { aiFunctionOptions, aiFunctionLabels, aiFunctionIcons } from './data/aiFunctionOptions'

const ModelSettingsModal = defineAsyncComponent(() => import('./components/ModelSettingsModal.vue'))
const AGENT_APPLY_AND_TEST_TIMEOUT_MS = 900000

function loadStoredUser() {
  try {
    const raw = window.sessionStorage.getItem('cubi_current_user')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const authToken = ref(window.sessionStorage.getItem('cubi_auth_token') || '')
const currentUser = ref(loadStoredUser())
const isAuthenticated = ref(Boolean(authToken.value))
let workspaceReady = false

const projectName = ref('')
const workspacePath = ref('')
const sandboxProjectId = ref('')
const activeFile = ref('')
const selectedExplorerFolder = ref('')
const openEditorFiles = ref([])
const editorDrafts = ref({})
const dirtyFilePaths = ref([])
const files = ref([])
const pinnedContextFiles = ref([])
const localFileMap = ref(new Map())
const localFileHandleMap = ref(new Map())
const editedLocalContentMap = ref(new Map())
const backendContentCache = new Map()
const backendPreviewCache = new Map()
const directoryHandleRef = ref(null)
const workspaceSource = ref('none')
const isDirty = ref(false)
const fileContent = ref('')
const activeFileContentType = ref('text')
const activeFilePreviewUrl = ref('')
const activeFilePreviewMeta = ref(null)
const ghostText = ref('')
const selectedCode = ref('')
const activeWorkbenchTab = ref('editor')
const selectedTopTool = ref('auto')
const includeIdeContext = ref(true)
const planningMode = ref(false)
const pendingPlanRequest = ref(null)
const pendingPlanClarification = ref(null)
const pendingPlanRevision = ref(null)
const lastContextBundle = ref({ files: [], totalChars: 0, originalChars: 0, estimatedTokens: 0, truncated: false, compacted: [], skipped: [], maxChars: 120000 })
const diffText = ref('')
const diffInfo = ref(null)
const pendingNewContent = ref('')
const pendingDiffFilePath = ref('')
const pendingExtraFiles = ref([])
const pendingAgentApproval = ref(false)
const agentSteps = ref([])
const testResult = ref(null)
const createdFiles = ref([])
const commandLogs = ref([])
const fileChanges = ref([])
const auditLogs = ref([])
const diffHistory = ref([])
const selectedDiffHistoryId = ref('')
const pendingDiffHistoryId = ref('')
const diffHistoryLoading = ref(false)
const lastRecordedDiffFingerprint = ref('')
const selectedDiffHistoryRecord = computed(() => (
  diffHistory.value.find(item => item.id === selectedDiffHistoryId.value) || null
))
const displayedDiffText = computed(() => selectedDiffHistoryRecord.value?.diff_text || diffText.value)
const displayedDiffInfo = computed(() => {
  const record = selectedDiffHistoryRecord.value
  if (!record) return diffInfo.value
  return {
    instruction: record.instruction || '',
    filePath: record.file_path || '',
    source: record.source || 'history',
    model: record.model || '',
    note: `歷史修改記錄｜${diffHistoryStatusLabel(record.status)}｜${record.created_at || ''}`,
    historyRecord: record,
  }
})
const displayedDiffFilePath = computed(() => (
  selectedDiffHistoryRecord.value?.file_path || pendingDiffFilePath.value || activeFile.value
))
const health = ref({
  api: { ok: false, status: 'unknown' },
  ollama: { ok: false, status: 'unknown' },
  postgresql: { ok: false, status: 'unknown' },
  sandbox: { ok: false, status: 'unknown' },
  docker_sandbox: { ok: false, status: 'unknown' },
  terminal: { ok: false, status: 'unknown' },
  cloud_api: { ok: false, status: 'not_configured' },
  model: 'auto',
  model_source: 'local_ollama',
  checked_at: ''
})
const loading = reactive({ file: false, chat: false, result: false, login: false })
const commandSubmissionLocked = ref(false)
const activeCommandId = ref('')
const user = ref(null)
const settingsOpen = ref(false)
const showChatHistory = ref(false)
const currentChatSessionId = ref(window.sessionStorage.getItem('cubi_current_chat_session_id') || crypto.randomUUID())
const lastChatCompactedAt = ref('')
window.sessionStorage.setItem('cubi_current_chat_session_id', currentChatSessionId.value)
let healthTimer = null
let fileTreeAutoRefreshTimer = null
let fileTreeAutoRefreshInFlight = false
let diffHistoryRecordTimer = null
const FILE_TREE_AUTO_REFRESH_MS = 1500

const autoFixBlockReason = computed(() => testFailureRepairBlockReason(testResult.value || {}))

const chatMessages = ref([
  {
    role: 'assistant',
    content: `已進入 Cubi Code。
1. 按左側「檔案總管」的 📁 圖示開啟專案資料夾。
2. 點選檔案後會在中間的程式碼編輯器開啟；按 Ctrl+S 儲存。
3. 在右側選擇 AI 功能；按「＋」設定 IDE 上下文或規劃模式。
4. 改寫或修正既有檔案時，系統會先顯示修改差異，確認後才套用並測試。`
  }
])

const topToolLabels = aiFunctionLabels
const agentEventTypeLabels = {
  start: '開始',
  thinking: '思考中',
  tool: '工具',
  action: '操作',
  observation: '觀察結果',
  info: '資訊',
  error: '錯誤',
  finish: '完成',
  file_change: '檔案變更'
}
const agentToolLabels = {
  run_command: '執行命令',
  list_dir: '列出資料夾',
  read_file: '讀取檔案',
  write_file: '寫入檔案',
  replace_file: '取代檔案內容',
  replace_file_content: '取代檔案內容',
  update_task_list: '更新任務清單',
  finish: '完成',
  stock_analysis: '股票分析'
}
const autoIntentLabels = {
  generate: '程式碼產生',
  rewrite: '程式碼改寫',
  rewrite_advice: '程式碼改寫建議',
  convert: '語言轉換',
  detect: '錯誤偵測',
  fix: '錯誤修正',
  analyze: '專案檔案分析',
  explain: '程式說明',
  test_advice: '測試案例',
  run_tests: '執行測試',
  create_files: '建立 / 修改檔案',
  multi_file_edit: '多檔案修改',
  plan: '規劃需求（僅規劃模式才啟用）',
  chat: 'AI 問答'
}

function agentEventTypeLabel(type = '') {
  const key = String(type || '').trim()
  return agentEventTypeLabels[key] || key || '事件'
}

function agentToolLabel(tool = '') {
  const key = String(tool || '').trim()
  if (!key) return '未知工具'
  return agentToolLabels[key] ? `${agentToolLabels[key]} (${key})` : key
}

function localizeAgentEventMessage(data = {}) {
  const type = String(data.type || '').trim()
  if (type === 'tool') return `呼叫工具：${agentToolLabel(data.tool)}`

  const message = String(data.message || '').trim()
  if (!message) return agentEventTypeLabel(type)

  const replacements = [
    [/^Agent loop started\.$/, 'Agent 迴圈已啟動。'],
    [/^Iteration (\d+): Thinking\.\.\.$/, '第 $1 輪：思考中...'],
    [/^Executing tool: (.+)$/, (_, tool) => `執行工具：${agentToolLabel(tool)}`],
    [/^Listing directory (.+)$/, '列出資料夾 $1'],
    [/^Reading (.+)$/, '讀取 $1'],
    [/^Writing to (.+)$/, '寫入 $1'],
    [/^Replacing content in (.+)$/, '取代 $1 的內容'],
    [/^Updated task list$/, '更新任務清單'],
    [/^File successfully written to (.+)$/, '檔案已成功寫入 $1'],
    [/^Successfully replaced target_string in (.+)$/, '已成功取代 $1 中的目標文字'],
    [/^Task list successfully updated\.$/, '任務清單已更新。'],
    [/^Command executed successfully with no output\.$/, '命令已成功執行，沒有輸出。'],
    [/^Empty directory$/, '空資料夾'],
    [/^Task completed\.$/, '任務已完成。'],
    [/^Too many consecutive errors\. Aborting loop\.$/, '連續錯誤過多，已中止流程。'],
    [/^LLM failed to respond\.$/, 'LLM 未回應。'],
    [/^Repeated failed tool call detected\. Intercepting\.\.\.$/, '偵測到重複失敗的工具呼叫，已攔截。'],
    [/^No tool call detected\. Prompting model again\.\.\.$/, '未偵測到工具呼叫，正在要求模型重新輸出。'],
    [/^Failed to parse tool JSON\. Prompting model to fix it\.\.\.$/, '工具 JSON 解析失敗，正在要求模型修正。'],
    [/^Max iterations reached\.$/, '已達最大迭代次數。']
  ]

  for (const [pattern, replacement] of replacements) {
    if (pattern.test(message)) return message.replace(pattern, replacement)
  }
  return message
}

const topToolIcons = aiFunctionIcons
const selectedTopToolLabel = computed(() => selectedTopTool.value ? topToolLabels[selectedTopTool.value] || selectedTopTool.value : '')
const selectedTopToolIcon = computed(() => selectedTopTool.value ? topToolIcons[selectedTopTool.value] || '◇' : '')
const chatBusy = computed(() => commandSubmissionLocked.value || loading.chat)
const toolOptions = computed(() => aiFunctionOptions
  .map(item => ({ key: item.key, label: item.label, icon: item.icon || '◇', description: item.description || '' })))
const contextStats = computed(() => {
  const latest = lastContextBundle.value || {}
  const conversationChars = estimateChatChars()
  const fileRecords = (latest.files || []).filter(item => item?.content_type !== 'conversation_history')
  const fileChars = includeIdeContext.value
    ? fileRecords.reduce((sum, item) => sum + Number(item?.included_chars ?? String(item?.content || '').length), 0)
    : 0
  const originalFileChars = includeIdeContext.value
    ? fileRecords.reduce((sum, item) => sum + Number(item?.original_chars ?? String(item?.content || '').length), 0)
    : 0
  const rawTotalChars = Math.max(0, conversationChars + fileChars)
  const cappedTotalChars = Math.min(rawTotalChars, CONTEXT_MAX_CHARS)
  const usageRatio = CONTEXT_MAX_CHARS ? rawTotalChars / CONTEXT_MAX_CHARS : 0
  return {
    totalChars: cappedTotalChars,
    rawTotalChars,
    conversationChars,
    fileChars,
    originalChars: conversationChars + originalFileChars,
    savedChars: latest.savedChars || 0,
    estimatedTokens: Math.ceil(cappedTotalChars / 4),
    isAtLimit: rawTotalChars >= CONTEXT_MAX_CHARS,
    isNearLimit: usageRatio >= CHAT_AUTO_COMPACT_RATIO,
    usageRatio,
    autoCompactThresholdChars: CHAT_AUTO_COMPACT_THRESHOLD_CHARS,
    autoCompactRatio: CHAT_AUTO_COMPACT_RATIO,
    recentMessagesKept: CHAT_RECENT_MESSAGE_COUNT,
    lastCompactedAt: lastChatCompactedAt.value,
    hasCompactedSummary: (chatMessages.value || []).some(item => item?.type === 'compacted_history'),
    truncated: rawTotalChars >= CONTEXT_MAX_CHARS || Boolean(latest.truncated || latest.skipped?.length),
    maxChars: CONTEXT_MAX_CHARS,
  }
})

const CHAT_COMPACT_KEEP_MESSAGES = CHAT_RECENT_MESSAGE_COUNT
const CONTEXT_MAX_FILES = 24
const ANALYSIS_MAX_FILES = 60
const CONTEXT_MAX_CHARS = CHAT_CONTEXT_MAX_CHARS
const CONTEXT_MAX_CHARS_PER_FILE = 30000
const MODEL_REQUEST_TIMEOUT_MS = 900000
const TEST_RUN_TIMEOUT_MS = 900000
const AGENT_LOOP_IDLE_TIMEOUT_MS = 150000
const AGENT_LOOP_TOTAL_TIMEOUT_MS = 900000
const PLANNING_DELIVERY_STABLE_MODE = true
const AUTO_FIX_TEST_RETRY_LIMIT = 3
let compactingChat = false
let autoCompactTimer = null
let contextPreviewTimer = null
let contextPreviewSerial = 0
let lastContextNoticeKey = ''
let lastAutocompleteErrorMessage = ''
let lastAutocompleteErrorAt = 0

function getCleanPath(path) {
  return canonicalWorkspacePath(path)
}

function getUniquePaths(paths) {
  const seen = new Set()
  const result = []
  for (const path of paths || []) {
    const clean = getCleanPath(path)
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    result.push(clean)
  }
  return result
}

function openEditorTab(path) {
  const clean = getCleanPath(path)
  if (!clean) return
  if (!openEditorFiles.value.includes(clean)) {
    openEditorFiles.value = [...openEditorFiles.value, clean]
  }
}

function hasEditorDraft(path) {
  const clean = getCleanPath(path)
  return Boolean(clean && Object.prototype.hasOwnProperty.call(editorDrafts.value, clean))
}

function getEditorDraft(path) {
  const clean = getCleanPath(path)
  return clean ? editorDrafts.value[clean] : ''
}

function setEditorDraft(path, content) {
  const clean = getCleanPath(path)
  if (!clean) return
  editorDrafts.value = { ...editorDrafts.value, [clean]: String(content ?? '') }
}

function clearEditorDraft(path) {
  const clean = getCleanPath(path)
  if (!clean || !hasEditorDraft(clean)) return
  const next = { ...editorDrafts.value }
  delete next[clean]
  editorDrafts.value = next
}

function isFileDirty(path) {
  const clean = getCleanPath(path)
  return Boolean(clean && dirtyFilePaths.value.includes(clean))
}

function setFileDirty(path, dirty) {
  const clean = getCleanPath(path)
  if (!clean) return
  if (dirty) {
    if (!dirtyFilePaths.value.includes(clean)) dirtyFilePaths.value = [...dirtyFilePaths.value, clean]
  } else {
    dirtyFilePaths.value = dirtyFilePaths.value.filter(item => item !== clean)
  }
  if (clean === activeFile.value) isDirty.value = Boolean(dirty)
}

function markFileSaved(path, content, options = {}) {
  const clean = getCleanPath(path)
  if (!clean) return
  editedLocalContentMap.value.delete(clean)
  clearEditorDraft(clean)
  setFileDirty(clean, false)
  if (options.updateBackendCache) {
    backendContentCache.set(clean, String(content ?? ''))
  }
}

function isImagePath(path = '') {
  return /\.(?:png|jpe?g|gif|webp)$/i.test(String(path || ''))
}

function clearActivePreview() {
  activeFileContentType.value = 'text'
  activeFilePreviewUrl.value = ''
  activeFilePreviewMeta.value = null
}

function setActiveImagePreview(path, previewUrl, meta = {}) {
  activeFileContentType.value = 'image'
  activeFilePreviewUrl.value = previewUrl || ''
  activeFilePreviewMeta.value = {
    path,
    mimeType: meta.mimeType || meta.mime_type || '',
    bytes: Number(meta.bytes || meta.size || 0),
  }
  fileContent.value = ''
  setFileDirty(path, false)
}

function syncActiveDirtyState() {
  isDirty.value = isFileDirty(activeFile.value)
}

function clearOpenEditors() {
  openEditorFiles.value = []
  editorDrafts.value = {}
  dirtyFilePaths.value = []
}

function resetActiveEditorState() {
  activeFile.value = ''
  fileContent.value = ''
  clearActivePreview()
  isDirty.value = false
  ghostText.value = ''
  selectedCode.value = ''
  editorCursor.value = { line: 1, col: 1 }
  diffText.value = ''
  diffInfo.value = null
  pendingNewContent.value = ''
  pendingDiffFilePath.value = ''
  pendingExtraFiles.value = []
  pendingAgentApproval.value = false
  selectedDiffHistoryId.value = ''
  pendingDiffHistoryId.value = ''
  lastRecordedDiffFingerprint.value = ''
  agentSteps.value = []
  testResult.value = null
  createdFiles.value = []
  commandLogs.value = []
  fileChanges.value = []
}

function replaceEditorDraftKeys(oldPath, newPath) {
  const next = {}
  const oldClean = getCleanPath(oldPath)
  const newClean = getCleanPath(newPath)
  for (const [key, value] of Object.entries(editorDrafts.value)) {
    next[replacePathPrefix(key, oldClean, newClean)] = value
  }
  editorDrafts.value = next
}

function removeEditorStateByPrefix(targetPath) {
  const clean = getCleanPath(targetPath)
  if (!clean) return

  openEditorFiles.value = openEditorFiles.value.filter(path => path !== clean && !path.startsWith(`${clean}/`))
  dirtyFilePaths.value = dirtyFilePaths.value.filter(path => path !== clean && !path.startsWith(`${clean}/`))

  const next = {}
  for (const [key, value] of Object.entries(editorDrafts.value)) {
    if (key === clean || key.startsWith(`${clean}/`)) continue
    next[key] = value
  }
  editorDrafts.value = next

  for (const key of backendContentCache.keys()) {
    if (key === clean || key.startsWith(`${clean}/`)) {
      backendContentCache.delete(key)
    }
  }

  for (const key of backendPreviewCache.keys()) {
    if (key === clean || key.startsWith(`${clean}/`)) {
      backendPreviewCache.delete(key)
    }
  }

  if (localFileMap.value) {
    for (const key of localFileMap.value.keys()) {
      if (key === clean || key.startsWith(`${clean}/`)) {
        localFileMap.value.delete(key)
      }
    }
  }

  if (localFileHandleMap.value) {
    for (const key of localFileHandleMap.value.keys()) {
      if (key === clean || key.startsWith(`${clean}/`)) {
        localFileHandleMap.value.delete(key)
      }
    }
  }

  if (editedLocalContentMap.value) {
    for (const key of editedLocalContentMap.value.keys()) {
      if (key === clean || key.startsWith(`${clean}/`)) {
        editedLocalContentMap.value.delete(key)
      }
    }
  }
}

function ensureDefaultPanels() {
  // 不再塞展示用假測試結果；第四階段只顯示實際 pytest 回傳。
}

// 右下角 Pinned Context 跟左側目前開啟檔案同步。
// 這裡只維護已釘選檔案，避免切檔後保留舊上下文。
watch(activeFile, value => {
  const cleanPath = normalizeLocalPath(value)
  syncActiveDirtyState()
  if (!cleanPath) return
  pinnedContextFiles.value = pinnedContextFiles.value
    .map(item => normalizeLocalPath(item))
    .filter(item => item && item !== cleanPath)
}, { flush: 'sync' })



// 對話上下文超過門檻後會自動壓縮；前端不再提供手動 Compact 按鈕。

watch([activeFile, openEditorFiles, pinnedContextFiles, includeIdeContext, fileContent, editorDrafts], () => {
  scheduleContextPreviewRefresh()
}, { deep: true })

function emptyContextBundle() {
  return { files: [], text: '', skipped: [], compacted: [], totalChars: 0, originalChars: 0, savedChars: 0, maxChars: CONTEXT_MAX_CHARS, maxCharsPerFile: CONTEXT_MAX_CHARS_PER_FILE, estimatedTokens: 0, truncated: false, strategy: 'empty context' }
}

function scheduleContextPreviewRefresh() {
  window.clearTimeout(contextPreviewTimer)
  contextPreviewTimer = window.setTimeout(() => refreshContextPreview(), 250)
}

async function refreshContextPreview() {
  const serial = ++contextPreviewSerial
  const entries = getContextPathEntries()
  if (!entries.length) {
    lastContextBundle.value = emptyContextBundle()
    return
  }

  const records = []
  for (const entry of entries) {
    try {
      const record = await readSingleContextFile(entry.path)
      if (record) records.push({ ...record, priority: entry.priority, role: entry.role })
    } catch {
      // 預覽計算不跳錯；真正送出時 buildContextBundle 會回報讀取失敗。
    }
  }
  if (serial !== contextPreviewSerial) return
  lastContextBundle.value = compactContextRecords(records)
}

function buildConversationContextText(options = {}) {
  return buildMessagesConversationContextText(chatMessages.value || [], options)
}

function estimateChatChars() {
  return estimateChatCharsFromMessages(chatMessages.value || [])
}

function buildConversationContextRecord(options = {}) {
  const fullText = buildConversationContextText(options)
  if (!fullText.trim()) return null
  const cappedText = fullText.length > CONTEXT_MAX_CHARS ? fullText.slice(-CONTEXT_MAX_CHARS) : fullText
  return {
    ok: true,
    file_path: '__conversation__/chat_history.md',
    content: cappedText,
    original_chars: fullText.length,
    source: 'chat_history',
    content_type: 'conversation_history',
    priority: 120,
    role: 'conversation_history',
    max_chars_per_file: CONTEXT_MAX_CHARS,
    preserve_tail: true,
  }
}

function compactChatMessages() {
  if (compactingChat) return
  const messages = chatMessages.value || []
  if (messages.length <= CHAT_COMPACT_KEEP_MESSAGES + 2) return

  compactingChat = true
  try {
    const compacted = createCompactedChatMessages(messages, {
      keepMessages: CHAT_COMPACT_KEEP_MESSAGES,
      projectGoal: projectName.value ? `目前專案：${projectName.value}` : '',
      modifiedFiles: getUniquePaths([
        ...(fileChanges.value || []).filter(item => ['modified', 'created', 'applied'].includes(item?.status)).map(item => item.path),
        ...(createdFiles.value || []).filter(item => ['created', 'modified', 'applied'].includes(item?.status)).map(item => item.path),
      ]),
      completedItems: (agentSteps.value || []).filter(item => item?.status === 'done').map(item => item.detail || item.label),
      currentErrors: (agentSteps.value || []).filter(item => item?.status === 'failed').map(item => item.detail || item.label),
      todos: (agentSteps.value || []).filter(item => item?.status === 'pending').map(item => item.detail || item.label),
    })
    if (compacted.length !== messages.length || compacted[0]?.type === 'compacted_history') {
      chatMessages.value = compacted
      lastChatCompactedAt.value = new Date().toISOString()
    }
  } finally {
    window.setTimeout(() => { compactingChat = false }, 0)
  }
}


function maybeAutoCompactChatMessages() {
  if (shouldAutoCompactChatMessages(chatMessages.value || [], {
    maxChars: CONTEXT_MAX_CHARS,
    thresholdRatio: CHAT_AUTO_COMPACT_RATIO,
    keepMessages: CHAT_COMPACT_KEEP_MESSAGES,
    currentUsageChars: contextStats.value.rawTotalChars,
  })) {
    compactChatMessages()
  }
}

function scheduleAutoChatCompaction() {
  window.clearTimeout(autoCompactTimer)
  autoCompactTimer = window.setTimeout(() => maybeAutoCompactChatMessages(), 50)
}

watch(() => contextStats.value.rawTotalChars, () => {
  scheduleAutoChatCompaction()
}, { flush: 'post' })

watch(pendingAgentApproval, value => {
  if (!value) pendingExtraFiles.value = []
}, { flush: 'sync' })

watch(projectName, () => {
  selectedDiffHistoryId.value = ''
  pendingDiffHistoryId.value = ''
  lastRecordedDiffFingerprint.value = ''
  loadDiffHistory().catch(() => {})
})

watch([diffText, pendingDiffFilePath, pendingNewContent], () => {
  window.clearTimeout(diffHistoryRecordTimer)
  if (!diffText.value || !pendingDiffFilePath.value || !pendingNewContent.value) return
  selectedDiffHistoryId.value = ''
  diffHistoryRecordTimer = window.setTimeout(() => {
    recordPendingDiffHistory().catch(error => {
      console.warn('record diff history failed:', error)
    })
  }, 80)
}, { flush: 'post' })


const editorCursor = ref({ line: 1, col: 1 })

onMounted(async () => {
  if (isAuthenticated.value) {
    await initializeWorkspace()
    await restoreCurrentChatSession()
  }
})


async function handleModelSettingsSaved(data) {
  if (data?.health) {
    health.value = {
      ...health.value,
      ollama: data.health,
      model: data.settings?.ollamaModel || health.value.model,
      model_source: data.settings?.modelSource || health.value.model_source,
      model_routing_mode: data.settings?.modelRoutingMode || health.value.model_routing_mode,
    }
  }
  await refreshHealth()
}

async function initializeWorkspace() {
  if (workspaceReady) return
  workspaceReady = true

  await refreshHealth()
  if (workspaceSource.value === 'none' && !projectName.value) {
    await loadTree({ ensureWorkspace: true })
  }
  await loadDiffHistory()
  auditLogs.value = []

    if (!healthTimer) {
      healthTimer = window.setInterval(refreshHealth, 10000)
    }
    startFileTreeAutoRefresh()
  }

async function handleLogin(data) {
  authToken.value = data.access_token || ''
  currentUser.value = data.user || { username: 'admin', display_name: '系統管理員' }

  window.sessionStorage.setItem('cubi_auth_token', authToken.value)
  window.sessionStorage.setItem('cubi_current_user', JSON.stringify(currentUser.value))

  isAuthenticated.value = true
  await initializeWorkspace()
  await restoreCurrentChatSession()
}

function logout() {
  window.sessionStorage.removeItem('cubi_auth_token')
  window.sessionStorage.removeItem('cubi_current_user')
  window.localStorage.removeItem('cubi_auth_token')
  window.localStorage.removeItem('cubi_current_user')
  authToken.value = ''
  currentUser.value = null
  isAuthenticated.value = false
  workspaceReady = false

    if (healthTimer) {
      window.clearInterval(healthTimer)
      healthTimer = null
    }
    stopFileTreeAutoRefresh()

  projectName.value = ''
  sandboxProjectId.value = ''
  activeFile.value = ''
  clearOpenEditors()
  files.value = []
  localFileMap.value = new Map()
  localFileHandleMap.value = new Map()
  editedLocalContentMap.value = new Map()
  directoryHandleRef.value = null
  workspaceSource.value = 'none'
  fileContent.value = ''
  clearActivePreview()
  chatMessages.value = [
    {
      role: 'assistant',
      content: '已登出。請重新登入後再使用 Cubi Code。'
    }
  ]
}

onUnmounted(() => {
  if (healthTimer) window.clearInterval(healthTimer)
  stopFileTreeAutoRefresh()
  window.clearTimeout(autoCompactTimer)
  window.clearTimeout(contextPreviewTimer)
  window.clearTimeout(diffHistoryRecordTimer)
})

async function refreshHealth() {
  try {
    const data = await apiGet('/api/health')
    health.value = data
  } catch (err) {
    health.value = {
      ...health.value,
      api: { ok: false, status: 'not_connected', error: err.message },
      ollama: { ok: false, status: 'unknown' },
      postgresql: { ok: false, status: 'unknown' },
      checked_at: new Date().toLocaleString('zh-TW', { hour12: false })
    }
  }
}

function createSandboxProjectId(name = 'project', source = 'workspace') {
  const slug = String(name || 'project')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'project'
  return `${source}-${slug}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80)
}

function ensureSandboxProjectId() {
  if (!sandboxProjectId.value) {
    sandboxProjectId.value = createSandboxProjectId(projectName.value || 'project', workspaceSource.value || 'workspace')
  }
  return sandboxProjectId.value
}
async function handleSwitchProject(newProjectName) {
  try {
    loading.file = true
    const res = await apiPost('/api/projects/switch', { project_name: newProjectName })
    if (res.ok) {
      clearExplorer()
      resetActiveEditorState()
      chatMessages.value = []
      chatMessages.value.push({ role: 'assistant', content: `已切換至專案：${newProjectName}` })
      await loadTree({ ensureWorkspace: true })
    }
  } catch (error) {
    console.error('Switch project failed:', error)
    chatMessages.value.push({ role: 'assistant', content: `切換專案失敗：${error.message}` })
  } finally {
    loading.file = false
  }
}

async function handleCreateProject() {
  const newName = prompt('請輸入新專案名稱：')
  if (!newName) return
  
  if (newName.includes('/') || newName.includes('\\') || newName.includes('..')) {
    alert('專案名稱包含不合法字元。')
    return
  }

  try {
    loading.file = true
    const res = await apiPost('/api/projects/create', { project_name: newName })
    if (res.ok) {
      clearExplorer()
      resetActiveEditorState()
      chatMessages.value = []
      chatMessages.value.push({ role: 'assistant', content: `已建立並切換至新專案：${newName}` })
      await loadTree({ ensureWorkspace: true })
    }
  } catch (error) {
    console.error('Create project failed:', error)
    alert(`建立專案失敗：${error.message}`)
    chatMessages.value.push({ role: 'assistant', content: `建立專案失敗：${error.message}` })
  } finally {
    loading.file = false
  }
  }

  function treeSignature(tree = []) {
    return (Array.isArray(tree) ? tree : [])
      .map(item => `${normalizeLocalPath(item?.path || '')}:${item?.type || ''}:${item?.content_type || ''}`)
      .filter(item => !item.startsWith(':'))
      .sort()
      .join('|')
  }

  function backendWorkspaceIsVisible() {
    return isAuthenticated.value && workspaceSource.value === 'backend' && Boolean(projectName.value)
  }

  function stopFileTreeAutoRefresh() {
    if (fileTreeAutoRefreshTimer) {
      window.clearInterval(fileTreeAutoRefreshTimer)
      fileTreeAutoRefreshTimer = null
    }
    fileTreeAutoRefreshInFlight = false
  }

  function startFileTreeAutoRefresh() {
    if (fileTreeAutoRefreshTimer) return
    fileTreeAutoRefreshTimer = window.setInterval(() => {
      refreshBackendTreeIfChanged().catch(error => {
        console.warn('silent file tree refresh failed:', error)
      })
    }, FILE_TREE_AUTO_REFRESH_MS)
  }

  async function refreshBackendTreeIfChanged() {
    if (!backendWorkspaceIsVisible() || fileTreeAutoRefreshInFlight) return
    fileTreeAutoRefreshInFlight = true
    try {
      const data = await apiGet('/api/files/tree')
      if (data.workspace_exists === false) {
        await loadTree({ silent: true })
        return
      }

      const nextTree = data.tree || []
      if (treeSignature(nextTree) === treeSignature(files.value)) return

      projectName.value = data.project_name || projectName.value || 'workspace'
      workspacePath.value = String(data.workspace_path || workspacePath.value || '')
      sandboxProjectId.value = createSandboxProjectId(projectName.value, 'backend')
      workspaceSource.value = 'backend'
      files.value = nextTree
      scheduleContextPreviewRefresh()
    } catch {
      // Automatic refresh is best-effort; the manual refresh button still shows
      // visible errors when the backend is unavailable.
    } finally {
      fileTreeAutoRefreshInFlight = false
    }
  }

  async function loadTree(options = {}) {
    try {
      const data = await apiGet(options.ensureWorkspace ? '/api/files/tree?ensure=1' : '/api/files/tree')
    if (data.workspace_exists === false) {
      projectName.value = ''
      workspacePath.value = String(data.workspace_path || '')
      sandboxProjectId.value = ''
      workspaceSource.value = 'none'
      localFileMap.value = new Map()
      localFileHandleMap.value = new Map()
      editedLocalContentMap.value = new Map()
      directoryHandleRef.value = null
      files.value = []
      activeFile.value = ''
      clearOpenEditors()
      fileContent.value = ''
      isDirty.value = false
      ghostText.value = ''
      pinnedContextFiles.value = []
      return
    }
    projectName.value = data.project_name || 'workspace'
    workspacePath.value = String(data.workspace_path || '')
    // Every backend project gets its own sandbox identity. Updating this on
    // switch/create forces terminal and AI sandbox state to follow the project.
    sandboxProjectId.value = createSandboxProjectId(projectName.value, 'backend')
    workspaceSource.value = 'backend'
    localFileMap.value = new Map()
    localFileHandleMap.value = new Map()
    editedLocalContentMap.value = new Map()
      directoryHandleRef.value = null
      files.value = data.tree || []
    } catch (err) {
      if (options.silent) return
      files.value = []
      workspacePath.value = ''
      addAssistantError(`無法讀取專案檔案樹：${err.message}`)
  }
}

async function handleOpenFolder(selectedFiles) {
  const selected = Array.from(selectedFiles || [])
  if (!selected.length) return

  const firstPath = selected[0].webkitRelativePath || selected[0].name
  const firstParts = firstPath.split('/').filter(Boolean)
  const rootName = firstParts.length > 1 ? firstParts[0] : 'local_project'
  const fileMap = new Map()
  const itemMap = new Map()

  for (const file of selected) {
    const rawPath = file.webkitRelativePath || file.name
    const parts = rawPath.split('/').filter(Boolean)
    const relPath = parts.length > 1 ? parts.slice(1).join('/') : file.name
    const normalizedPath = normalizeLocalPath(relPath)

    if (!normalizedPath || shouldSkipLocalPath(normalizedPath)) continue

    const folderParts = normalizedPath.split('/').slice(0, -1)
    for (let i = 0; i < folderParts.length; i += 1) {
      const folderPath = folderParts.slice(0, i + 1).join('/')
      if (!itemMap.has(folderPath)) itemMap.set(folderPath, { path: folderPath, type: 'folder' })
    }

    itemMap.set(normalizedPath, { path: normalizedPath, type: 'file', content_type: isImagePath(normalizedPath) ? 'image' : 'text' })
    fileMap.set(normalizedPath, file)
  }

  projectName.value = rootName
  workspacePath.value = ''
  sandboxProjectId.value = createSandboxProjectId(rootName, 'local')
  workspaceSource.value = 'local-input'
  localFileMap.value = fileMap
  localFileHandleMap.value = new Map()
  editedLocalContentMap.value = new Map()
  directoryHandleRef.value = null
  files.value = sortTreeItems(Array.from(itemMap.values()))
  activeFile.value = ''
  clearOpenEditors()
  fileContent.value = ''
  isDirty.value = false
  ghostText.value = ''
  pinnedContextFiles.value = []

  chatMessages.value.push({
    role: 'assistant',
    content: `已開啟資料夾：${rootName}。左側檔案總管可展開 / 收合資料夾，點選檔案即可在中間編輯器寫程式。注意：此瀏覽器模式只能讀取檔案；若要直接 Ctrl+S 寫回本機，請使用 Chrome / Edge 的資料夾權限模式。`
  })
}

async function handleOpenFolderHandle(directoryHandle) {
  if (!directoryHandle) return

  const itemMap = new Map()
  const fileHandleMap = new Map()

  await collectDirectoryEntries(directoryHandle, '', itemMap, fileHandleMap)

  projectName.value = directoryHandle.name || 'local_project'
  workspacePath.value = ''
  sandboxProjectId.value = createSandboxProjectId(projectName.value, 'local')
  workspaceSource.value = 'local-handle'
  localFileMap.value = new Map()
  localFileHandleMap.value = fileHandleMap
  editedLocalContentMap.value = new Map()
  directoryHandleRef.value = directoryHandle
  files.value = sortTreeItems(Array.from(itemMap.values()))
  activeFile.value = ''
  clearOpenEditors()
  fileContent.value = ''
  isDirty.value = false
  ghostText.value = ''
  pinnedContextFiles.value = []


}

function ensureUploadWorkspace() {
  if (projectName.value && workspaceSource.value !== 'none') return
  projectName.value = 'uploaded_project'
  workspacePath.value = ''
  sandboxProjectId.value = createSandboxProjectId(projectName.value, 'upload')
  workspaceSource.value = 'local-input'
  localFileMap.value = new Map()
  localFileHandleMap.value = new Map()
  editedLocalContentMap.value = new Map()
  directoryHandleRef.value = null
  files.value = []
  activeFile.value = ''
  clearOpenEditors()
  fileContent.value = ''
  isDirty.value = false
  ghostText.value = ''
  pinnedContextFiles.value = []
}

function uploadTargetPath(targetPath = '') {
  const cleanTarget = normalizeLocalPath(targetPath)
  if (cleanTarget && files.value.some(item => item?.type === 'folder' && normalizeLocalPath(item.path) === cleanTarget)) {
    return cleanTarget
  }
  return getActiveFileDirectory()
}

async function handleUploadCodeFiles(payload = {}) {
  const selectedFiles = Array.from(payload.files || [])
  if (!selectedFiles.length) return

  ensureUploadWorkspace()
  const targetFolder = uploadTargetPath(payload.targetPath)
  const uploaded = []
  const skipped = []
  loading.file = true

  try {
    for (const file of selectedFiles) {
      const fileName = normalizeLocalPath(file?.name || '').split('/').filter(Boolean).pop()
      if (!fileName) continue

      let filePath
      try {
        filePath = joinProjectPath(targetFolder, fileName)
      } catch (err) {
        skipped.push(`${fileName}（${err.message}）`)
        continue
      }

      if (shouldSkipLocalPath(filePath) || isDatabasePath(filePath)) {
        skipped.push(filePath)
        continue
      }

      const content = await file.text()
      if (workspaceSource.value === 'backend') {
        await apiPost('/api/files/write', {
          file_path: filePath,
          content
        })
        backendContentCache.set(filePath, content)
      } else if (workspaceSource.value === 'local-handle') {
        await writeLocalFileContent(filePath, content)
      } else {
        localFileMap.value.set(filePath, file)
        editedLocalContentMap.value.delete(filePath)
      }

      clearEditorDraft(filePath)
      setFileDirty(filePath, false)
      upsertExplorerItem(filePath, 'file')
      uploaded.push(filePath)
    }

    if (workspaceSource.value === 'backend') await loadTree()
    else if (workspaceSource.value === 'local-handle') await refreshOpenedFolder({ announce: false, mode: 'chat' })

    if (uploaded.length) await selectFile(uploaded[0], { preserveCommand: true, silent: true })

    const targetText = targetFolder || '專案根目錄'
    chatMessages.value.push({
      role: 'assistant',
      content: `已上傳 ${uploaded.length} 個程式碼檔案到 ${targetText}${skipped.length ? `；略過 ${skipped.length} 個不適合文字上傳的項目。` : '。'}${uploaded.length ? `\n\n${uploaded.map(path => `- ${path}`).join('\n')}` : ''}`
    })
  } catch (err) {
    addAssistantError(`上傳程式碼失敗：${err.message}`)
  } finally {
    loading.file = false
  }
}

async function collectDirectoryEntries(directoryHandle, basePath, itemMap, fileHandleMap) {
  for await (const [name, handle] of directoryHandle.entries()) {
    const normalizedPath = normalizeLocalPath(basePath ? `${basePath}/${name}` : name)
    if (!normalizedPath || shouldSkipLocalPath(normalizedPath)) continue

    if (handle.kind === 'directory') {
      itemMap.set(normalizedPath, { path: normalizedPath, type: 'folder' })
      await collectDirectoryEntries(handle, normalizedPath, itemMap, fileHandleMap)
      continue
    }

    itemMap.set(normalizedPath, { path: normalizedPath, type: 'file', content_type: isImagePath(normalizedPath) ? 'image' : 'text' })
    fileHandleMap.set(normalizedPath, handle)
  }
}

function sortTreeItems(items) {
  return [...items].sort((a, b) => {
    const parentA = a.path.split('/').slice(0, -1).join('/')
    const parentB = b.path.split('/').slice(0, -1).join('/')
    if (parentA !== parentB) return parentA.localeCompare(parentB)
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.path.localeCompare(b.path)
  })
}

function ensureParentFolders(itemMap, path) {
  const folderParts = normalizeLocalPath(path).split('/').filter(Boolean)
  if (!folderParts.length) return

  const parentParts = folderParts.slice(0, -1)
  for (let i = 0; i < parentParts.length; i += 1) {
    const folderPath = parentParts.slice(0, i + 1).join('/')
    if (!itemMap.has(folderPath)) itemMap.set(folderPath, { path: folderPath, type: 'folder' })
  }
}

function upsertExplorerItem(path, type) {
  const cleanPath = normalizeLocalPath(path)
  if (!cleanPath) return

  const itemMap = new Map(files.value.map(item => [normalizeLocalPath(item.path), {
    ...item,
    path: normalizeLocalPath(item.path)
  }]))

  ensureParentFolders(itemMap, cleanPath)
  itemMap.set(cleanPath, { path: cleanPath, type, ...(type === 'file' ? { content_type: isImagePath(cleanPath) ? 'image' : 'text' } : {}) })
  files.value = sortTreeItems(Array.from(itemMap.values()))
}

function removeExplorerItem(path) {
  const cleanPath = normalizeLocalPath(path)
  files.value = files.value.filter(item => {
    const itemPath = normalizeLocalPath(item.path)
    return itemPath !== cleanPath && !itemPath.startsWith(`${cleanPath}/`)
  })
}

function clearExplorer() {
  projectName.value = ''
  workspacePath.value = ''
  sandboxProjectId.value = ''
  activeFile.value = ''
  clearOpenEditors()
  files.value = []
  localFileMap.value = new Map()
  localFileHandleMap.value = new Map()
  editedLocalContentMap.value = new Map()
  backendContentCache.clear()
  backendPreviewCache.clear()
  directoryHandleRef.value = null
  workspaceSource.value = 'none'
  clearActivePreview()
  isDirty.value = false
  ghostText.value = ''
  selectedCode.value = ''
  selectedTopTool.value = 'auto'
  diffText.value = ''
  diffInfo.value = null
  pendingNewContent.value = ''
  pendingDiffFilePath.value = ''
  pendingExtraFiles.value = []
  pendingAgentApproval.value = false
  agentSteps.value = []
  testResult.value = null
  createdFiles.value = []
  fileContent.value = ''
  pinnedContextFiles.value = []
}

async function refreshFolderFromExplorer(options = {}) {
  const announce = options.announce !== false
  const mode = options.mode || 'chat'
  if (directoryHandleRef.value) {
    await refreshOpenedFolder({ announce, mode })
    return
  }

  if (workspaceSource.value === 'backend') {
    await loadTree()
    return
  }
  if (!projectName.value && !files.value.length) {
    await loadTree({ ensureWorkspace: true })
    return
  }

  if (announce) {
    chatMessages.value.push({
      role: 'assistant',
      mode,
      content: '目前是瀏覽器本機 / 暫存檔案樹，畫面內容已是最新。'
    })
  }
}

async function selectFile(path, options = {}) {
  const cleanPath = normalizeLocalPath(path)
  if (!cleanPath) return

  selectedExplorerFolder.value = ''
  const previousTool = selectedTopTool.value
  openEditorTab(cleanPath)
  activeFile.value = cleanPath
  if (!options.preserveCommand) selectedTopTool.value = 'auto'
  openResultTab(diffText.value ? 'diff' : 'editor')
  loading.file = true
  ghostText.value = ''
  clearActivePreview()

  try {
    if (isImagePath(cleanPath)) {
      if (localFileHandleMap.value.has(cleanPath)) {
        const file = await localFileHandleMap.value.get(cleanPath).getFile()
        const previewUrl = await readBrowserFileAsPreview(file)
        setActiveImagePreview(cleanPath, previewUrl, { mimeType: file.type, size: file.size })
        return
      }

      if (localFileMap.value.has(cleanPath)) {
        const file = localFileMap.value.get(cleanPath)
        const previewUrl = await readBrowserFileAsPreview(file)
        setActiveImagePreview(cleanPath, previewUrl, { mimeType: file.type, size: file.size })
        return
      }

      if (backendPreviewCache.has(cleanPath)) {
        setActiveImagePreview(cleanPath, backendPreviewCache.get(cleanPath).previewUrl, backendPreviewCache.get(cleanPath).meta)
        return
      }

      const data = await apiPost('/api/files/read', {
        file_path: cleanPath
      })
      if (data.content_type !== 'image' || !data.preview_url) throw new Error('後端未回傳可預覽的圖片內容')
      const meta = { mimeType: data.mime_type, bytes: data.bytes }
      backendPreviewCache.set(cleanPath, { previewUrl: data.preview_url, meta })
      setActiveImagePreview(cleanPath, data.preview_url, meta)
      await loadAuditLogs()
      return
    }

    if (hasEditorDraft(cleanPath)) {
      fileContent.value = getEditorDraft(cleanPath)
      syncActiveDirtyState()
      return
    }

    if (editedLocalContentMap.value.has(cleanPath)) {
      fileContent.value = editedLocalContentMap.value.get(cleanPath)
      setFileDirty(cleanPath, true)
      return
    }

    if (localFileHandleMap.value.has(cleanPath)) {
      const fileHandle = localFileHandleMap.value.get(cleanPath)
      const file = await fileHandle.getFile()
      fileContent.value = await readBrowserFileAsContext(cleanPath, file)
      setFileDirty(cleanPath, false)
      return
    }

    if (localFileMap.value.has(cleanPath)) {
      const file = localFileMap.value.get(cleanPath)
      fileContent.value = await readBrowserFileAsContext(cleanPath, file)
      setFileDirty(cleanPath, false)
      return
    }

    if (workspaceSource.value !== 'backend' && explorerPathExists(cleanPath)) {
      // 有些瀏覽器模式或 Agent dry-run 會先把檔案放進左側樹，
      // 但沒有實體 FileHandle；此時不要再去後端讀，避免出現「找不到檔案」。
      const draft = editedLocalContentMap.value.has(cleanPath) ? editedLocalContentMap.value.get(cleanPath) : ''
      fileContent.value = draft
      setFileDirty(cleanPath, editedLocalContentMap.value.has(cleanPath))
      return
    }

    if (backendContentCache.has(cleanPath)) {
      fileContent.value = backendContentCache.get(cleanPath)
      setFileDirty(cleanPath, false)
      return
    }

    const data = await apiPost('/api/files/read', {
      file_path: cleanPath
    })

    fileContent.value = data.content ?? ''
    backendContentCache.set(cleanPath, fileContent.value)
    setFileDirty(cleanPath, false)
    await loadAuditLogs()
  } catch (err) {
    fileContent.value = ''
    isDirty.value = false
    if (!options.silent) addAssistantError(`讀取 ${cleanPath} 失敗：${err.message}`)
  } finally {
    if (options.preserveCommand) {
      selectedTopTool.value = previousTool
    }
    diffText.value = ''
    diffInfo.value = null
    pendingNewContent.value = ''
    pendingDiffFilePath.value = ''
    pendingExtraFiles.value = []
    pendingAgentApproval.value = false
    loading.file = false
    ensureDefaultPanels()
  }
}


function closeActiveFile() {
  closeEditorFile(activeFile.value)
}

async function closeEditorFile(filePath) {
  const cleanPath = normalizeLocalPath(filePath || activeFile.value)
  if (!cleanPath) return

  if (isFileDirty(cleanPath)) {
    const ok = window.confirm(`「${cleanPath}」尚未儲存，確定要關閉並捨棄暫存內容嗎？`)
    if (!ok) return
  }

  const currentTabs = getUniquePaths(openEditorFiles.value)
  const closingIndex = currentTabs.indexOf(cleanPath)
  openEditorFiles.value = currentTabs.filter(path => path !== cleanPath)
  clearEditorDraft(cleanPath)
  setFileDirty(cleanPath, false)

  if (activeFile.value !== cleanPath) return

  const nextTabs = openEditorFiles.value
  if (nextTabs.length) {
    const nextIndex = closingIndex >= 0 ? Math.min(closingIndex, nextTabs.length - 1) : nextTabs.length - 1
    await selectFile(nextTabs[nextIndex], { preserveCommand: true, silent: true })
    return
  }

  resetActiveEditorState()
  selectedTopTool.value = 'auto'
}

function handleEditorChange(value) {
  fileContent.value = value
  const currentPath = normalizeLocalPath(activeFile.value)
  if (currentPath) {
    setEditorDraft(currentPath, value)
    setFileDirty(currentPath, true)
  }
  if (activeFile.value && (
    localFileMap.value.has(activeFile.value) ||
    localFileHandleMap.value.has(activeFile.value) ||
    editedLocalContentMap.value.has(activeFile.value) ||
    workspaceSource.value === 'virtual'
  )) {
    editedLocalContentMap.value.set(activeFile.value, value)
  }
  if (activeFile.value) setFileDirty(activeFile.value, true)
}

function handleEditorCursor(cursor) {
  editorCursor.value = cursor || { line: 1, col: 1 }
}

function handleEditorSelection(selectionText) {
  selectedCode.value = String(selectionText || '')
}

function handleAutocompleteError(message) {
  const text = String(message || 'Autocomplete 呼叫失敗。')
  const now = Date.now()
  if (text === lastAutocompleteErrorMessage && now - lastAutocompleteErrorAt < 60000) return
  lastAutocompleteErrorMessage = text
  lastAutocompleteErrorAt = now
  addAssistantError(`Autocomplete 失敗：${text}`)
}

function handleFormatMessage(message) {
  const text = String(message || '').trim()
  if (!text) return
  chatMessages.value.push({ role: 'assistant', content: text })
}

async function saveCurrentFile() {
  if (!activeFile.value) {
    addAssistantError('請先從左側檔案總管選擇一個檔案。')
    return
  }

  const targetPath = normalizeLocalPath(activeFile.value)
  if (activeFileContentType.value === 'image' || isImagePath(targetPath)) {
    addAssistantError(`圖片檔案目前以唯讀預覽開啟，不支援用文字編輯器儲存：${targetPath}`)
    return
  }

  loading.file = true
  try {
    if (editedLocalContentMap.value.has(targetPath) && !localFileHandleMap.value.has(targetPath) && !localFileMap.value.has(targetPath) && workspaceSource.value !== 'backend') {
      setEditorDraft(targetPath, fileContent.value)
      setFileDirty(targetPath, true)
      addAssistantError(`目前工作區只有畫面暫存，無法真正寫回磁碟：${targetPath}。請使用後端專案工作區，或用 Chrome / Edge 的「開啟資料夾」權限模式。`)
      return
    }

    if (localFileHandleMap.value.has(targetPath)) {
      const fileHandle = localFileHandleMap.value.get(targetPath)
      const ok = await verifyFilePermission(fileHandle)
      if (!ok) throw new Error('沒有本機檔案寫入權限')

      const writable = await fileHandle.createWritable()
      await writable.write(fileContent.value)
      await writable.close()
      const savedFile = await fileHandle.getFile()
      const savedContent = await readBrowserFileAsContext(targetPath, savedFile)
      if (savedContent !== String(fileContent.value ?? '')) throw new Error('本機檔案寫入後讀回內容不一致')

      markFileSaved(targetPath, savedContent)
      chatMessages.value.push({ role: 'assistant', content: `已儲存本機檔案：${targetPath}` })
      return
    }

    if (isDatabasePath(targetPath)) {
      throw new Error('資料庫 .db/.sqlite 不可用文字方式儲存；請產生 .sql migration / query 檔。')
    }

    if (localFileMap.value.has(targetPath)) {
      editedLocalContentMap.value.set(targetPath, fileContent.value)
      setEditorDraft(targetPath, fileContent.value)
      setFileDirty(targetPath, true)
      addAssistantError(`瀏覽器檔案上傳模式不能直接覆寫原始本機檔案：${targetPath}。已保留目前編輯內容供 AI / Docker 使用；若要真正寫回磁碟，請用 Chrome / Edge 的「開啟資料夾」權限模式。`)
      return
    }

    const writeResult = await apiPost('/api/files/write', {
      file_path: targetPath,
      content: fileContent.value
    })
    if (writeResult.ok === false) throw new Error(writeResult.error || '後端儲存失敗')

    const readResult = await apiPost('/api/files/read', {
      file_path: targetPath
    })
    const savedContent = String(readResult.content ?? '')
    if (savedContent !== String(fileContent.value ?? '')) throw new Error('後端寫入後讀回內容不一致')

    markFileSaved(targetPath, savedContent, { updateBackendCache: true })
    chatMessages.value.push({ role: 'assistant', content: `已透過後端儲存檔案：${targetPath}` })
    loadAuditLogs().catch(() => {})
  } catch (err) {
    addAssistantError(`儲存失敗：${err.message}`)
  } finally {
    loading.file = false
  }
}

async function verifyFilePermission(fileHandle) {
  const options = { mode: 'readwrite' }
  if (!fileHandle.queryPermission || !fileHandle.requestPermission) return true
  if (await fileHandle.queryPermission(options) === 'granted') return true
  return await fileHandle.requestPermission(options) === 'granted'
}

function normalizeLocalPath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '')
}

function canonicalWorkspacePath(path) {
  const clean = normalizeLocalPath(path)
  if (!clean) return ''
  const rootName = normalizeLocalPath(projectName.value || '')
  if (!rootName) return clean

  const prefix = `${rootName}/`
  if (!clean.toLowerCase().startsWith(prefix.toLowerCase())) return clean

  const stripped = clean.slice(prefix.length)
  if (!stripped) return clean
  if (explorerPathExists(clean)) return clean
  if (explorerPathExists(stripped) || ['local-handle', 'local-input', 'virtual'].includes(workspaceSource.value)) return stripped
  return clean
}

function isDatabasePath(path = '') {
  return /\.(?:db|sqlite|sqlite3)$/i.test(String(path || '').toLowerCase())
}

async function summarizeBrowserDatabaseFile(cleanPath, file) {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer.slice(0, 100))
  const header = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 16))
  const isSqlite = header === 'SQLite format 3\u0000'
  return [
    `檔案：${cleanPath}`,
    `類型：${isSqlite ? 'SQLite 資料庫檔案（binary）' : '資料庫 / 二進位檔案（binary）'}`,
    `大小：${Number(file.size || 0).toLocaleString('en-US')} bytes`,
    '',
    '處理方式：',
    '- 此檔案在瀏覽器端不會用 file.text() 直接解碼，避免二進位內容損壞。',
    '- 可加入上下文做資料庫分析、SQL 查詢、migration / seed 腳本建議。',
    '- 若要修改資料庫，系統應產生 .sql 檔，不直接覆寫 .db。',
  ].join('\n') + '\n'
}

async function readBrowserFileAsContext(cleanPath, file) {
  if (isDatabasePath(cleanPath)) return summarizeBrowserDatabaseFile(cleanPath, file)
  return file.text()
}

function summarizeImageFile(cleanPath, meta = {}) {
  const bytes = Number(meta.bytes || meta.size || 0)
  return [
    `檔案：${cleanPath}`,
    '類型：圖片檔案（binary）',
    meta.mimeType || meta.mime_type ? `MIME：${meta.mimeType || meta.mime_type}` : '',
    bytes ? `大小：${bytes.toLocaleString('en-US')} bytes` : '',
    '',
    '處理方式：',
    '- 此檔案會在編輯器中以唯讀圖片預覽開啟。',
    '- 不會把圖片二進位或 base64 內容送進程式碼編輯器，避免檔案損壞。',
  ].filter(Boolean).join('\n') + '\n'
}

function readBrowserFileAsPreview(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('無法讀取圖片檔案'))
    reader.readAsDataURL(file)
  })
}

function getActiveFileDirectory() {
  if (selectedExplorerFolder.value) {
    return selectedExplorerFolder.value
  }
  const cleanPath = normalizeLocalPath(activeFile.value || '')
  if (!cleanPath || !cleanPath.includes('/')) return ''
  return cleanPath.split('/').slice(0, -1).join('/')
}

function getCreateFilesTargetArea() {
  // 只回傳目前開啟檔案所在資料夾；不要把專案名稱當成子資料夾。
  // 這樣在空白專案 ddex/generic-demo 執行時，index.html、style.css、script.js 會建立在專案根目錄，
  // 不會變成 ddex/index.html 或 generic-demo/index.html。
  const dir = getActiveFileDirectory()
  return dir || ''
}

function shouldWriteGeneratedFilesInBrowserWorkspace() {
  return ['local-handle', 'local-input', 'virtual'].includes(workspaceSource.value)
}

function localWorkspaceFileExists(path) {
  const cleanPath = normalizeLocalPath(path)
  if (!cleanPath) return false
  return files.value.some(item => item?.type === 'file' && normalizeLocalPath(item.path) === cleanPath) ||
    localFileMap.value.has(cleanPath) ||
    localFileHandleMap.value.has(cleanPath) ||
    editedLocalContentMap.value.has(cleanPath)
}

async function readLocalWorkspaceExistingContent(path) {
  const cleanPath = normalizeLocalPath(path)
  if (!cleanPath) return { exists: false, content: '' }

  if (cleanPath === activeFile.value) {
    return { exists: true, content: String(fileContent.value || '') }
  }

  if (editedLocalContentMap.value.has(cleanPath)) {
    return { exists: true, content: String(editedLocalContentMap.value.get(cleanPath) ?? '') }
  }

  if (localFileHandleMap.value.has(cleanPath)) {
    const file = await localFileHandleMap.value.get(cleanPath).getFile()
    return { exists: true, content: await readBrowserFileAsContext(cleanPath, file) }
  }

  if (localFileMap.value.has(cleanPath)) {
    const file = localFileMap.value.get(cleanPath)
    return { exists: true, content: await readBrowserFileAsContext(cleanPath, file) }
  }

  if (files.value.some(item => item?.type === 'file' && normalizeLocalPath(item.path) === cleanPath)) {
    // 檔案只存在於畫面檔案樹，表示尚未有可讀取的本機 handle。
    // 視為空檔，讓 AI 可以把內容補進去，而不是略過或讀後端失敗。
    return { exists: true, content: '' }
  }

  return { exists: false, content: '' }
}

async function materializeGeneratedFilesInBrowserWorkspace(plannedFiles = [], overwrite = false) {
  const results = []

  for (const item of plannedFiles || []) {
    let filePath = normalizeLocalPath(item?.path || '')
    if (!filePath) continue

    try {
      let existing = await readLocalWorkspaceExistingContent(filePath)
      if (existing.exists && !overwrite && String(existing.content || '').trim()) {
        const availablePath = findAvailableGeneratedPath(filePath, [
          ...generatedTargetOccupiedPaths(),
          ...results.map(result => result.path),
        ])
        if (availablePath && normalizeLocalPath(availablePath).toLowerCase() !== filePath.toLowerCase()) {
          filePath = availablePath
          existing = await readLocalWorkspaceExistingContent(filePath)
        }
        if (existing.exists && !overwrite && String(existing.content || '').trim()) {
          results.push({ ...item, path: filePath, content: undefined, status: 'skipped' })
          continue
        }
      }

      const content = String(item?.content ?? '')
      if (workspaceSource.value === 'local-handle') {
        await writeLocalFileContent(filePath, content)
        clearEditorDraft(filePath)
        setFileDirty(filePath, false)
      } else {
        editedLocalContentMap.value.set(filePath, content)
        setEditorDraft(filePath, content)
        setFileDirty(filePath, true)
      }

      upsertExplorerItem(filePath, 'file')
      results.push({ ...item, path: filePath, content: undefined, status: 'created' })
    } catch (err) {
      results.push({ ...item, path: filePath, content: undefined, status: 'failed', error: err.message })
    }
  }

  return results
}

async function revealExplorerItem(selection) {
  const item = normalizeExplorerSelection(selection)

  if (workspaceSource.value !== 'backend') {
    addAssistantError('瀏覽器選擇的本機資料夾不會公開完整路徑，因此無法呼叫系統檔案總管。')
    return
  }

  try {
    await apiPost('/api/files/reveal', {
      file_path: item.path,
      item_type: item.type
    })
  } catch (err) {
    addAssistantError(`無法在檔案總管中顯示：${err.message}`)
  }
}

function generatedTargetOccupiedPaths() {
  return getUniquePaths([
    ...workspaceFilePaths(),
    ...openEditorFiles.value,
    ...Object.keys(editorDrafts.value || {}),
    ...localFileMap.value.keys(),
    ...localFileHandleMap.value.keys(),
    ...editedLocalContentMap.value.keys(),
  ])
}

function shouldRenameExistingPlannedCreation(instruction = '', filePath = '') {
  const text = String(instruction || '')
  if (!/(?:建立|新增|產生|另存|存成|寫入|create|generate|new\s+file|save\s+as)/i.test(text)) return false
  const hasModificationIntent = /(?:修改|更新|改寫|重構|補充|追加|調整|修正|modify|update|edit|rewrite|refactor|append|fix)/i.test(text)
  if (!hasModificationIntent) return true

  const targetName = normalizeLocalPath(filePath).split('/').filter(Boolean).pop() || ''
  if (!targetName) return false
  const escapedName = targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:建立|新增|產生|另存|存成|寫入|create|generate|new\\s+file|save\\s+as)[^，。；;\\n]{0,80}${escapedName}`, 'i').test(text)
}

function normalizeSameFolderGeneratedFiles(generatedFiles = [], expectedCount = 0, options = {}) {
  const targetDir = getActiveFileDirectory()
  const seen = new Set()
  const occupied = new Set(generatedTargetOccupiedPaths())
  const normalized = []

  for (const item of generatedFiles || []) {
    const fileName = normalizeLocalPath(item?.path || '').split('/').filter(Boolean).pop() || ''
    const content = String(item?.content ?? '')
    const key = fileName.toLowerCase()
    if (!fileName || fileName === '.' || fileName === '..' || !content.trim() || seen.has(key)) continue
    seen.add(key)
    const preferredPath = targetDir ? `${targetDir}/${fileName}` : fileName
    const availablePath = options.preserveExisting
      ? preferredPath
      : findAvailableGeneratedPath(preferredPath, [...occupied])
    occupied.add(availablePath)
    normalized.push({
      ...item,
      path: availablePath,
      content,
    })
  }

  if (expectedCount > 1 && normalized.length !== expectedCount) {
    throw new Error(`模型應回傳 ${expectedCount} 個同層程式檔案，實際收到 ${normalized.length} 個。`)
  }

  return normalized
}

async function materializeGeneratedCodeFiles(generatedFiles = []) {
  if (shouldWriteGeneratedFilesInBrowserWorkspace()) {
    return materializeGeneratedFilesInBrowserWorkspace(generatedFiles, false)
  }

  if (workspaceSource.value === 'backend') {
    const results = []
    for (const item of generatedFiles) {
      let targetPath = normalizeLocalPath(item.path)
      if (explorerPathExists(targetPath)) {
        targetPath = findAvailableGeneratedPath(targetPath, [
          ...generatedTargetOccupiedPaths(),
          ...results.map(result => result.path),
        ])
      }
      if (explorerPathExists(targetPath)) {
        results.push({ ...item, path: targetPath, content: undefined, status: 'skipped' })
        continue
      }
      try {
        await apiPost('/api/files/write', { file_path: targetPath, content: item.content })
        results.push({ ...item, path: targetPath, content: undefined, status: 'created' })
      } catch (err) {
        results.push({ ...item, path: targetPath, content: undefined, status: 'failed', error: err.message })
      }
    }
    await loadTree()
    return results
  }

  return generatedFiles.map(item => {
    applyNewContentToLocalEditor(item.path, item.content, { dirty: true })
    return { ...item, content: undefined, status: 'created' }
  })
}

async function saveGeneratedContentIfWritable(filePath, newContent) {
  const target = canonicalWorkspacePath(filePath)
  if (!target || isDatabasePath(target)) return false

  if (workspaceSource.value === 'backend') {
    const writeResult = await apiPost('/api/files/write', {
      file_path: target,
      content: newContent
    })
    if (writeResult.ok === false) throw new Error(writeResult.error || '後端自動儲存失敗')

    const readResult = await apiPost('/api/files/read', {
      file_path: target
    })
    const savedContent = String(readResult.content ?? '')
    if (savedContent !== String(newContent ?? '')) throw new Error('後端自動儲存後讀回內容不一致')

    markFileSaved(target, savedContent, { updateBackendCache: true })
    return true
  }

  if (workspaceSource.value === 'local-handle') {
    const wroteLocalFile = await writeLocalFileContent(target, newContent)
    if (wroteLocalFile) markFileSaved(target, newContent)
    return wroteLocalFile
  }

  return false
}

function stripMentionToken(token = '') {
  return normalizeLocalPath(String(token || '').replace(/[，,。；;：:)）\]】]+$/g, '').trim())
}

function resolveMentionedFilePaths(text = '') {
  const rawMentions = [...String(text || '').matchAll(/@([^\s，,。；;]+)/g)]
    .map(match => stripMentionToken(match[1]))
    .filter(Boolean)

  if (!rawMentions.length) return []

  const fileItems = (files.value || [])
    .filter(item => item?.type === 'file' && item?.path)
    .map(item => normalizeLocalPath(item.path))

  const resolved = []
  for (const mention of rawMentions) {
    const lower = mention.toLowerCase()
    const matched = fileItems.find(path => path.toLowerCase() === lower) ||
      fileItems.find(path => path.split('/').pop()?.toLowerCase() === lower) ||
      fileItems.find(path => path.toLowerCase().endsWith(`/${lower}`))
    resolved.push(matched || mention)
  }

  return getUniquePaths(resolved)
}

function autoIncludeMentionedFiles(text = '') {
  const mentioned = getUniquePaths([
    ...resolveMentionedFilePaths(text),
    ...resolveRequestedWorkspacePaths(text, workspaceFilePaths()),
  ])
  for (const path of mentioned) {
    if (!path || path === activeFile.value || pinnedContextFiles.value.includes(path)) continue
    pinnedContextFiles.value.push(path)
  }
}

function shouldSkipLocalPath(path) {
  const hiddenParts = ['.git', '__pycache__', '.pytest_cache', 'node_modules', 'dist']
  const parts = path.split('/')
  return parts.some(part => hiddenParts.includes(part)) || path.endsWith('.bak')
}

function getContextPathEntries(extraPaths = []) {
  return buildIdeContextPathEntries({
    includeIdeContext: includeIdeContext.value,
    activeFile: activeFile.value,
    openEditorFiles: openEditorFiles.value,
    pinnedContextFiles: pinnedContextFiles.value,
    extraPaths,
    maxFiles: CONTEXT_MAX_FILES,
  })
}
async function readSingleContextFile(path) {
  const cleanPath = normalizeLocalPath(path)
  if (!cleanPath) return null

  if (cleanPath === activeFile.value) {
    if (activeFileContentType.value === 'image' || isImagePath(cleanPath)) {
      return { ok: true, file_path: cleanPath, content: summarizeImageFile(cleanPath, activeFilePreviewMeta.value || {}), source: 'image_preview', content_type: 'image_summary' }
    }
    const activeContent = String(fileContent.value || '')
    const draftContent = hasEditorDraft(cleanPath) ? getEditorDraft(cleanPath) : ''
    return { ok: true, file_path: cleanPath, content: activeContent || draftContent, source: 'active_editor' }
  }

  if (hasEditorDraft(cleanPath)) {
    return { ok: true, file_path: cleanPath, content: getEditorDraft(cleanPath), source: 'editor_draft' }
  }

  if (editedLocalContentMap.value.has(cleanPath)) {
    return { ok: true, file_path: cleanPath, content: editedLocalContentMap.value.get(cleanPath), source: 'edited_memory' }
  }

  if (localFileHandleMap.value.has(cleanPath)) {
    const file = await localFileHandleMap.value.get(cleanPath).getFile()
    if (isImagePath(cleanPath)) {
      return { ok: true, file_path: cleanPath, content: summarizeImageFile(cleanPath, { mimeType: file.type, size: file.size }), source: 'image_file_system_access', content_type: 'image_summary' }
    }
    return { ok: true, file_path: cleanPath, content: await readBrowserFileAsContext(cleanPath, file), source: isDatabasePath(cleanPath) ? 'database_summary' : 'file_system_access', content_type: isDatabasePath(cleanPath) ? 'database_summary' : 'text' }
  }

  if (localFileMap.value.has(cleanPath)) {
    const file = localFileMap.value.get(cleanPath)
    if (isImagePath(cleanPath)) {
      return { ok: true, file_path: cleanPath, content: summarizeImageFile(cleanPath, { mimeType: file.type, size: file.size }), source: 'image_browser_file_input', content_type: 'image_summary' }
    }
    return { ok: true, file_path: cleanPath, content: await readBrowserFileAsContext(cleanPath, file), source: isDatabasePath(cleanPath) ? 'database_summary' : 'browser_file_input', content_type: isDatabasePath(cleanPath) ? 'database_summary' : 'text' }
  }

  if (['local-handle', 'local-input', 'virtual'].includes(workspaceSource.value)) {
    if (files.value.some(item => item?.type === 'file' && normalizeLocalPath(item.path) === cleanPath)) {
      return { ok: true, file_path: cleanPath, content: '', source: 'local_tree_empty' }
    }
    throw new Error(`找不到本機檔案：${cleanPath}`)
  }

  if (backendContentCache.has(cleanPath)) {
    return { ok: true, file_path: cleanPath, content: backendContentCache.get(cleanPath), source: 'backend_cache' }
  }

  const data = await apiPost('/api/files/read', { file_path: cleanPath })
  if (data.content_type === 'image') {
    return { ok: true, file_path: cleanPath, content: summarizeImageFile(cleanPath, { mimeType: data.mime_type, bytes: data.bytes }), source: 'backend_image', content_type: 'image_summary' }
  }
  backendContentCache.set(cleanPath, data.content ?? '')
  return { ok: true, file_path: cleanPath, content: data.content ?? '', source: 'backend' }
}

function compactContextRecords(records = [], options = {}) {
  const requestedMaxChars = Number(options.maxChars || CONTEXT_MAX_CHARS)
  const requestedMaxCharsPerFile = Number(options.maxCharsPerFile || CONTEXT_MAX_CHARS_PER_FILE)
  return createManagedContextBundle(records, {
    ...options,
    maxChars: Math.min(CONTEXT_MAX_CHARS, Math.max(1, requestedMaxChars)),
    maxCharsPerFile: Math.min(CONTEXT_MAX_CHARS_PER_FILE, Math.max(1, requestedMaxCharsPerFile)),
  })
}

function maybeAnnounceContextBudget(bundle) {
  if (!bundle?.truncated) return
  const compactedNames = (bundle.compacted || []).map(item => item.file_path).slice(0, 6)
  const skippedNames = (bundle.skipped || []).map(item => item.file_path || item).slice(0, 6)
  const noticeKey = [
    bundle.totalChars,
    bundle.originalChars,
    compactedNames.join('|'),
    skippedNames.join('|'),
  ].join('::')
  if (noticeKey === lastContextNoticeKey) return
  lastContextNoticeKey = noticeKey

  const parts = [
    `Context Manager 已啟動：原始約 ${(bundle.originalChars || 0).toLocaleString('en-US')} chars，送出約 ${(bundle.totalChars || 0).toLocaleString('en-US')} / ${(bundle.maxChars || CONTEXT_MAX_CHARS).toLocaleString('en-US')} chars，估計約 ${(bundle.estimatedTokens || 0).toLocaleString('en-US')} tokens。`,
    compactedNames.length ? `已摘要 / 截斷：${compactedNames.join('、')}${(bundle.compacted || []).length > compactedNames.length ? '…' : ''}` : '',
    skippedNames.length ? `暫不送入模型：${skippedNames.join('、')}${(bundle.skipped || []).length > skippedNames.length ? '…' : ''}` : '',
    '保留順序：目前作用中檔案 > 目標檔案 > 其他已開啟分頁 > @ / pinned 檔案；大型檔案會先轉成摘要，避免 Token 超限。',
  ].filter(Boolean)
  chatMessages.value.push({ role: 'assistant', content: parts.join('\n') })
}


async function buildContextBundle(extraPaths = [], options = {}) {
  const excludedPaths = new Set((options.excludePaths || []).map(path => normalizeLocalPath(path)).filter(Boolean))
  const entries = (options.onlyPaths
    ? getUniquePaths(extraPaths).map(path => ({ path, priority: 90, role: 'explicit_task_target' }))
    : getContextPathEntries(extraPaths)
  ).filter(entry => !excludedPaths.has(entry.path))
  const records = []
  if (options.includeConversation !== false) {
    const conversationRecord = buildConversationContextRecord({ excludeLatestUser: true })
    if (conversationRecord) records.push(conversationRecord)
  }
  for (const entry of entries) {
    options.onFileProgress?.({ path: entry.path, status: 'reading' })
    try {
      const record = await readSingleContextFile(entry.path)
      if (record) records.push({ ...record, priority: entry.priority, role: entry.role })
      options.onFileProgress?.({ path: entry.path, status: 'read', record })
    } catch (err) {
      records.push({ ok: false, file_path: entry.path, priority: entry.priority, role: entry.role, error: err.message })
      options.onFileProgress?.({ path: entry.path, status: 'failed', error: err.message })
    }
  }
  const bundle = compactContextRecords(records, {
    maxChars: options.maxChars,
    maxCharsPerFile: options.maxCharsPerFile,
  })
  lastContextBundle.value = bundle
  maybeAnnounceContextBudget(bundle)
  return bundle
}

function testContextPaths(filePath = '') {
  const clean = normalizeLocalPath(filePath)
  const lower = clean.toLowerCase()
  if (!/\.(?:html?|css|js|mjs|cjs)$/.test(lower)) return [clean].filter(Boolean)

  const parts = clean.split('/').filter(Boolean)
  parts.pop()
  const dir = parts.join('/')
  return ['index.html', 'style.css', 'script.js'].map(name => dir ? `${dir}/${name}` : name)
}

async function buildTestContextFilesForTargets(targetFiles = []) {
  const targets = getUniquePaths(targetFiles).filter(Boolean)
  if (workspaceSource.value === 'backend') {
    const records = []
    for (const contextPath of getUniquePaths(targets.flatMap(filePath => testContextPaths(filePath)))) {
      try {
        const record = await readSingleContextFile(contextPath)
        if (record?.ok) records.push(record)
      } catch {
        // Backend will copy the project into its managed Docker workspace.
      }
    }
    return records
  }

  const allowedExtensions = /\.(?:py|js|mjs|cjs|ts|tsx|jsx|vue|html?|css|json|md|txt|csv|tsv|sql|db|sqlite3?|java|xml|svg|ya?ml|toml|ini|cfg|properties)$/i
  const candidatePaths = getUniquePaths([
    ...targets.map(path => normalizeLocalPath(path)),
    ...workspaceFilePaths().filter(path => allowedExtensions.test(path)),
  ]).slice(0, 300)
  const records = []
  let totalBytes = 0
  const maxTotalBytes = 12_000_000

  for (const contextPath of candidatePaths) {
    if (totalBytes >= maxTotalBytes) break
    try {
      if (isDatabasePath(contextPath)) {
        let file = null
        if (localFileHandleMap.value.has(contextPath)) {
          file = await localFileHandleMap.value.get(contextPath).getFile()
        } else if (localFileMap.value.has(contextPath)) {
          file = localFileMap.value.get(contextPath)
        }
        if (file && file.size <= 5_000_000 && totalBytes + file.size <= maxTotalBytes) {
          const bytes = new Uint8Array(await file.arrayBuffer())
          let binary = ''
          for (let offset = 0; offset < bytes.length; offset += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
          }
          records.push({
            ok: true,
            file_path: contextPath,
            content_base64: btoa(binary),
            encoding: 'base64',
            content_type: 'binary',
            source: 'browser_database_file',
          })
          totalBytes += file.size
        }
        continue
      }

      const record = await readSingleContextFile(contextPath)
      if (!record?.ok) continue
      const size = new Blob([String(record.content || '')]).size
      if (size > 2_000_000 || totalBytes + size > maxTotalBytes) continue
      records.push(record)
      totalBytes += size
    } catch {
      // Missing or unreadable files are omitted from the staged sandbox copy.
    }
  }
  return records
}

async function buildTestContextFiles(filePath = '') {
  return buildTestContextFilesForTargets([filePath].filter(Boolean))
}

async function ensureTaskContext(action = '', instruction = '', options = {}) {
  const resolvedReferencePaths = resolveRequestedWorkspacePaths(instruction, workspaceFilePaths(), {
    excludeDeclaredOutputs: true,
  })
  const candidatePaths = getUniquePaths([
    activeFile.value,
    ...(openEditorFiles.value || []),
    ...(pinnedContextFiles.value || []),
    ...resolvedReferencePaths,
    ...(options.extraPaths || []),
  ]).slice(0, CONTEXT_MAX_FILES)
  const contextFiles = []
  for (const path of candidatePaths) {
    try {
      const record = await readSingleContextFile(path)
      if (record) contextFiles.push(record)
    } catch {
      // validateTaskContext 會以缺少的檔案名稱產生可操作的錯誤訊息。
    }
  }
  const validation = validateTaskContext({
    action,
    instruction,
    activeFile: activeFile.value,
    selectedCode: selectedCode.value,
    currentContent: fileContent.value,
    contextFiles,
    resolvedReferencePaths,
    workspaceOpen: workspaceSource.value !== 'none' || workspaceFilePaths().length > 0,
  })
  if (!validation.ok) {
    addAssistantError(validation.error)
    return false
  }
  return true
}

async function ensureActiveFileForTask(reason = '目前需求') {
  return ensureTaskContext('run_tests', reason)
}

function diffHistoryStatusLabel(status = '') {
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

function countDiffChanges(text = '') {
  const lines = String(text || '').split('\n')
  return {
    additions: lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length,
    removals: lines.filter(line => line.startsWith('-') && !line.startsWith('---')).length,
  }
}

function mergeDiffHistoryRecord(record) {
  if (!record?.id) return
  const records = diffHistory.value.filter(item => item.id !== record.id)
  records.unshift(record)
  diffHistory.value = records
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, 100)
}

async function loadDiffHistory() {
  diffHistoryLoading.value = true
  try {
    const query = new URLSearchParams({ limit: '100' })
    if (projectName.value) query.set('project_name', projectName.value)
    const data = await apiGet(`/api/diff/history?${query.toString()}`)
    diffHistory.value = Array.isArray(data.records) ? data.records : []
    if (selectedDiffHistoryId.value && !diffHistory.value.some(item => item.id === selectedDiffHistoryId.value)) {
      selectedDiffHistoryId.value = ''
    }
  } catch (error) {
    console.warn('load diff history failed:', error)
  } finally {
    diffHistoryLoading.value = false
  }
}

function selectDiffHistoryRecord(id = '') {
  if (!id || id === 'current') {
    selectedDiffHistoryId.value = ''
    return
  }
  const record = diffHistory.value.find(item => item.id === id)
  if (!record) return
  selectedDiffHistoryId.value = id
  openResultTab('diff')
}

async function deleteDiffHistoryRecord(id = '') {
  const cleanId = String(id || '').trim()
  if (!cleanId) return
  const record = diffHistory.value.find(item => item.id === cleanId)
  if (!record) return

  const label = record.file_path || '這筆記錄'
  if (!window.confirm(`確定刪除「${label}」的歷史修改記錄？\n刪除後無法復原。`)) return

  try {
    await apiDelete(`/api/diff/history/${encodeURIComponent(cleanId)}`)
    diffHistory.value = diffHistory.value.filter(item => item.id !== cleanId)
    if (selectedDiffHistoryId.value === cleanId) selectedDiffHistoryId.value = ''
    if (pendingDiffHistoryId.value === cleanId) {
      pendingDiffHistoryId.value = ''
      lastRecordedDiffFingerprint.value = ''
    }
  } catch (error) {
    window.alert(`刪除歷史修改記錄失敗：${error.message || error}`)
  }
}

function confirmDiffAction() {
  openResultTab('diff')
}

async function recordPendingDiffHistory() {
  const text = String(diffText.value || '')
  const target = canonicalWorkspacePath(pendingDiffFilePath.value || extractDiffTargetFile(text, activeFile.value))
  const newContent = String(pendingNewContent.value || '')
  if (!text || !target || !newContent) return null

  const fingerprint = `${projectName.value}|${target}|${text}`
  if (fingerprint === lastRecordedDiffFingerprint.value && pendingDiffHistoryId.value) {
    return diffHistory.value.find(item => item.id === pendingDiffHistoryId.value) || null
  }

  const stats = countDiffChanges(text)
  const oldContent = target === canonicalWorkspacePath(activeFile.value) ? String(fileContent.value || '') : ''
  const data = await apiPost('/api/diff/history', {
    project_name: projectName.value || 'my_project',
    workspace_source: workspaceSource.value || 'backend',
    file_path: target,
    status: 'pending',
    diff_text: text,
    old_content: oldContent,
    new_content: newContent,
    instruction: diffInfo.value?.instruction || '',
    source: diffInfo.value?.source || 'frontend',
    model: diffInfo.value?.model || '',
    additions: stats.additions,
    removals: stats.removals,
    metadata: {
      note: diffInfo.value?.note || '',
      approval_mode: pendingAgentApproval.value === true,
      extra_files: pendingExtraFiles.value.map(item => ({ path: item.path, status: item.status || 'modified' })),
    },
  })

  if (data.record?.id) {
    pendingDiffHistoryId.value = data.record.id
    lastRecordedDiffFingerprint.value = fingerprint
    mergeDiffHistoryRecord(data.record)
  }
  return data.record || null
}

async function updatePendingDiffHistoryStatus(status, note = '', metadata = {}) {
  let historyId = pendingDiffHistoryId.value
  if (!historyId && diffText.value && pendingNewContent.value) {
    const record = await recordPendingDiffHistory()
    historyId = record?.id || ''
  }
  if (!historyId) return null
  try {
    const data = await apiPost(`/api/diff/history/${encodeURIComponent(historyId)}/status`, {
      status,
      note,
      metadata,
    })
    if (data.record) {
      mergeDiffHistoryRecord(data.record)
      selectedDiffHistoryId.value = data.record.id
    }
    return data.record || null
  } catch (error) {
    console.warn('update diff history status failed:', error)
    return null
  }
}

async function openResultTab(tabName) {
  if (tabName === 'diff') {
    activeWorkbenchTab.value = 'diff'
    await loadDiffHistory()
    return
  }
  activeWorkbenchTab.value = tabName
}

function shouldKeepCurrentPageForTestResult(result = {}) {
  return Boolean(result && result.ok !== true && testFailureRepairBlockReason(result))
}

function openTestResultTabUnlessEnvironmentBlocked(result = testResult.value, fallbackTab = 'editor') {
  if (shouldKeepCurrentPageForTestResult(result)) {
    const nextTab = fallbackTab && fallbackTab !== 'test' ? fallbackTab : 'editor'
    if (activeWorkbenchTab.value !== nextTab) openResultTab(nextTab)
    return false
  }
  openResultTab('test')
  return true
}

function inferLanguageId(path = '') {
  const p = String(path || '').toLowerCase()
  if (p.endsWith('.py')) return 'python'
  if (p.endsWith('.db') || p.endsWith('.sqlite') || p.endsWith('.sqlite3')) return 'sql'
  if (p.endsWith('.vue')) return 'html'
  if (p.endsWith('.js') || p.endsWith('.mjs') || p.endsWith('.cjs')) return 'javascript'
  if (p.endsWith('.ts')) return 'typescript'
  if (p.endsWith('.json')) return 'json'
  if (p.endsWith('.md')) return 'markdown'
  if (p.endsWith('.css')) return 'css'
  if (p.endsWith('.html')) return 'html'
  if (p.endsWith('.sql')) return 'sql'
  return 'plaintext'
}

function getDiffTargetFile(path) {
  return normalizeLocalPath(path || '')
}


function workspaceFilePaths() {
  return (files.value || [])
    .filter(item => item?.type === 'file' && item?.path)
    .map(item => normalizeLocalPath(item.path))
    .filter(Boolean)
}

function directoryOfPath(path = '') {
  const clean = normalizeLocalPath(path || '')
  const parts = clean.split('/').filter(Boolean)
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/')
}

function compactPathList(paths = [], max = 6) {
  const cleanPaths = getUniquePaths((paths || []).map(path => normalizeLocalPath(path)).filter(Boolean))
  if (cleanPaths.length <= max) return cleanPaths.join('、')
  return `${cleanPaths.slice(0, max).join('、')}，另 ${cleanPaths.length - max} 個`
}

function findWorkspaceFileByName(fileName = '', basePath = '') {
  const cleanName = normalizeLocalPath(fileName).split('/').filter(Boolean).pop()
  if (!cleanName) return ''
  const lowerName = cleanName.toLowerCase()
  const baseDir = directoryOfPath(basePath || activeFile.value)
  const candidates = getUniquePaths([
    ...workspaceFilePaths(),
    ...(pinnedContextFiles.value || []).map(path => normalizeLocalPath(path)),
    activeFile.value ? normalizeLocalPath(activeFile.value) : '',
  ].filter(Boolean))

  if (baseDir) {
    const sameDir = candidates.find(path => path.toLowerCase() === `${baseDir}/${lowerName}`)
    if (sameDir) return sameDir
  }
  return candidates.find(path => path.split('/').pop()?.toLowerCase() === lowerName) || ''
}

function extractExplicitFileNames(text = '') {
  const pattern = /@?([A-Za-z0-9_.\/-]+\.(?:html?|css|mjs|cjs|js|jsx|ts|tsx|vue|py|java|cs|php|go|rs|cpp|c|h|json|md|txt|sql|db|sqlite|sqlite3|yml|yaml|toml|env|csv))/gi
  const seen = new Set()
  const names = []
  let match
  while ((match = pattern.exec(String(text || ''))) !== null) {
    const raw = normalizeLocalPath(match[1] || '').replace(/^\.\/+/, '')
    if (!raw || raw.includes('..')) continue
    const key = raw.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(raw)
  }
  return names
}

function resolveInlineTargetFile(preferredPath = '', instruction = '', action = '') {
  let cleanPreferred = getDiffTargetFile(preferredPath || activeFile.value)
  if (cleanPreferred && !(workspaceFilePaths() || []).includes(cleanPreferred)) {
    const found = findWorkspaceFileByName(cleanPreferred)
    if (found) cleanPreferred = found
  }
  const text = String(instruction || '')

  const mentioned = resolveMentionedFilePaths(text)
  if (mentioned.length) return getDiffTargetFile(mentioned[0])

  for (const fileName of extractExplicitFileNames(text)) {
    const found = findWorkspaceFileByName(fileName, cleanPreferred)
    if (found) return getDiffTargetFile(found)
  }

  const lower = text.toLowerCase()
  if (/js\s*語法|javascript\s*語法|node\s+--check|script\.js|前端靜態檢查/.test(lower)) {
    const found = findWorkspaceFileByName('script.js', cleanPreferred)
    if (found) return getDiffTargetFile(found)
  }
  if (/按鈕|點擊|點選|不能按|沒反應|無反應|互動|事件|button|click|onclick/i.test(lower)) {
    const found = findWorkspaceFileByName('script.js', cleanPreferred)
    if (found) return getDiffTargetFile(found)
  }
  if (/html|title|index\.html|thought|nthought/.test(lower)) {
    const found = findWorkspaceFileByName('index.html', cleanPreferred)
    if (found) return getDiffTargetFile(found)
  }
  if (/css|style\.css|樣式|外觀/.test(lower) && action !== 'fix') {
    const found = findWorkspaceFileByName('style.css', cleanPreferred)
    if (found) return getDiffTargetFile(found)
  }

  return cleanPreferred
}

async function readInlineTargetContent(targetFile = '', fallbackContent = '') {
  const clean = normalizeLocalPath(targetFile)
  if (!clean) return String(fallbackContent ?? '')
  if (clean === activeFile.value) return String(fallbackContent ?? fileContent.value ?? '')
  try {
    const record = await readSingleContextFile(clean)
    if (record?.ok) return String(record.content ?? '')
  } catch (err) {
    addAssistantError(`讀取修正目標 ${clean} 失敗：${err.message}`)
  }
  return String(fallbackContent ?? '')
}

function extractDiffTargetFile(diffTextValue, fallback) {
  const text = String(diffTextValue || '')
  const match = text.match(/^\+\+\+\s+b\/(.+)$/m)
  return match?.[1]?.trim() || fallback || ''
}

function handleTool(action) {
  if (commandSubmissionLocked.value) {
    addAssistantError('目前任務仍在執行，完成後才能切換功能。')
    return
  }
  const requested = String(action || 'auto')
  const next = topToolLabels[requested] ? requested : 'auto'
  selectedTopTool.value = next === 'auto' ? 'auto' : (selectedTopTool.value === next ? 'auto' : next)
}

function clearSelectedTopTool() {
  selectedTopTool.value = 'auto'
}

async function executeSelectedTopTool(action, text) {
  const instruction = String(text || '').trim()
  const label = topToolLabels[action] || action

  if (action === 'auto') {
    const routed = await runSmartCommand(instruction)
    if (routed) return
    if (await ensureActiveFileForTask('AI 問答')) return askExplain(instruction)
    return
  }

  const validationAction = action === 'files' ? 'create_files' : action
  if (!(await ensureTaskContext(validationAction, instruction))) return

  announceExecutionScope(label, instruction)

  if (action === 'generate') return generateCode(instruction || '請依照目前需求與目前檔案內容產生可直接使用的程式碼。')
  if (action === 'rewrite') {
    const targetScope = withOpenEditorTargets(instruction || '請依照目前開啟檔案進行改寫，產生可確認的修改差異。', '程式碼改寫')
    return runInlineCommand({
      action: 'rewrite',
      label: '程式碼改寫',
      instruction: targetScope.instruction,
      selectedCode: selectedCode.value,
      content: fileContent.value,
      filePath: activeFile.value,
      targetFiles: targetScope.targetFiles,
      cursor: editorCursor.value
    })
  }
  if (action === 'convert') return convertCode(instruction || '請依目前開啟檔案自動判斷目標語言並轉換。')
  if (action === 'detect') return detectCode(instruction || '請檢查目前檔案可能的錯誤、風險與問題位置。')
  if (action === 'fix') {
    const asksForProjectWideFix = /(?:全|整個|完整)(?:專案|項目)|掃描(?:整個)?專案|project[- ]?wide/i.test(instruction)
    if (asksForProjectWideFix) {
      return runProjectErrorFix(instruction || '請掃描整個專案，依實際語法、測試或建置錯誤做最小必要修正並驗證。')
    }
    const targetFiles = getOpenRewriteTaskFiles()
    const targetScope = withOpenEditorTargets(
      instruction || '請逐一檢查目前程式碼編輯器中已開啟的所有檔案；有錯就修正，沒有錯就說明原因。',
      '錯誤修正',
      targetFiles,
    )
    return runInlineCommand({
      action: 'fix',
      label: '錯誤修正',
      instruction: targetScope.instruction,
      selectedCode: selectedCode.value,
      content: fileContent.value,
      filePath: activeFile.value,
      targetFiles: targetScope.targetFiles,
      cursor: editorCursor.value,
      autoApply: true,
    })
  }
  if (action === 'analyze') return askExplain(instruction || '系統可讀取或分析專案中的檔案內容，判斷目前程式結構、檔案用途與可能需要修改的位置。', { actionLabel: '專案檔案分析' })
  if (action === 'files') return createAgentFiles(instruction || '請依需求判斷要新增或修改哪些檔案，並產生對應內容。', { targetFiles: getOpenTaskFiles() })
  if (action === 'explain') return askExplain(instruction || '請解釋目前這個檔案，並告訴我缺少哪些 edge cases 與風險。', { actionLabel: '程式說明' })
  return askExplain(instruction)
}

function toolRequiresActiveFile(action) {
  return ['rewrite', 'convert', 'detect', 'fix', 'analyze', 'explain'].includes(action)
}

function getOpenTaskFiles() {
  return getOpenEditorTargetFiles({
    activeFile: activeFile.value,
    openEditorFiles: openEditorFiles.value,
    maxFiles: CONTEXT_MAX_FILES,
  })
}

function getOpenRewriteTaskFiles() {
  return getOpenEditorFixTargetFiles({
    activeFile: activeFile.value,
    openEditorFiles: openEditorFiles.value,
    maxFiles: CONTEXT_MAX_FILES,
  })
}

function getCurrentFileTaskFiles() {
  return [normalizeLocalPath(activeFile.value)].filter(Boolean)
}

function getTaskContextFiles() {
  return getUniquePaths([
    activeFile.value,
    ...(openEditorFiles.value || []),
    ...(includeIdeContext.value ? (pinnedContextFiles.value || []) : []),
  ]).slice(0, CONTEXT_MAX_FILES)
}

function withOpenEditorTargets(instruction = '', actionLabel = 'AI 任務', explicitTargets = null) {
  const usesAllOpenRewriteTargets = /(?:程式碼改寫|錯誤修正)/.test(String(actionLabel || ''))
  const mutatesSingleExistingFile = /程式語言轉換/.test(String(actionLabel || ''))
  const fallbackTargets = usesAllOpenRewriteTargets
    ? getOpenRewriteTaskFiles()
    : (mutatesSingleExistingFile ? [normalizeLocalPath(activeFile.value)].filter(Boolean) : getOpenTaskFiles())
  const requestedTargets = selectTaskTargetPaths(instruction, workspaceFilePaths(), fallbackTargets)
  const targetFiles = Array.isArray(explicitTargets)
    ? explicitTargets
    : requestedTargets
  return {
    targetFiles,
    hasMultipleTargets: hasMultipleOpenEditorTargets(targetFiles),
    instruction: buildOpenEditorTargetInstruction(instruction, targetFiles, actionLabel),
  }
}

function withCurrentFileDetectionTarget(instruction = '', explicitTargets = null) {
  const fallbackTargets = getOpenTaskFiles()
  const requestedTargets = selectTaskTargetPaths(instruction, workspaceFilePaths(), fallbackTargets)
  const targetFiles = Array.isArray(explicitTargets)
    ? explicitTargets
    : requestedTargets
  return {
    targetFiles,
    hasMultipleTargets: hasMultipleOpenEditorTargets(targetFiles),
    instruction: buildOpenEditorTargetInstruction(instruction, targetFiles, '錯誤偵測'),
  }
}

function announceExecutionScope(label = 'AI 指令', instruction = '', mode = 'chat') {
  chatMessages.value.push({
    role: 'assistant',
    mode,
    content: `準備執行「${label}」。`
  })
}

function setPlanningMode(enabled) {
  planningMode.value = Boolean(enabled)
}

function addPinnedContextFile(filePath = '') {
  const inputPath = filePath || window.prompt(
    '請輸入要加入上下文的檔案路徑，例如：utils.py 或 src/app.py',
    activeFile.value || ''
  )

  if (!inputPath) return

  const cleanPath = normalizeLocalPath(inputPath)
  if (!cleanPath) return

  if (pinnedContextFiles.value.includes(cleanPath)) {
    addAssistantError(`此檔案已在上下文中：${cleanPath}`)
    return
  }

  pinnedContextFiles.value.push(cleanPath)

  chatMessages.value.push({
    role: 'assistant',
    content: `已加入多檔案上下文：${cleanPath}`
  })
}

async function sendChat(text) {
  const instruction = String(text || '').trim()
  if (!instruction) return
  if (commandSubmissionLocked.value) {
    addAssistantError('目前已有一個 AI 任務在執行，請等待完成後再送出下一個指令。')
    return
  }

  const requestedTool = selectedTopTool.value || 'auto'
  if (isPlaceholderTaskInstruction(requestedTool, instruction)) {
    addAssistantError(placeholderTaskGuidance(requestedTool))
    return
  }

  const commandId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  activeCommandId.value = commandId
  commandSubmissionLocked.value = true

  try {
    const messageMode = planningMode.value ? 'plan' : 'chat'
    chatMessages.value.push({ role: 'user', mode: messageMode, content: instruction, taskId: commandId })
    autoIncludeMentionedFiles(instruction)
    scheduleAutoChatCompaction()

    if (planningMode.value) {
      const revisionBase = pendingPlanRevision.value
      pendingPlanRevision.value = null
      announceExecutionScope(revisionBase ? '重新規劃' : '規劃模式', instruction, 'plan')
      return await runPlanningMode(revisionBase?.instruction || instruction, revisionBase ? {
        revisionRequest: instruction,
        clarificationAnswers: revisionBase.clarificationAnswers || [],
        planningSessionId: revisionBase.planningSessionId || '',
        previousPlan: revisionBase.content || '',
      } : {})
    }

    if (requestedTool !== 'auto') {
      return await executeSelectedTopTool(requestedTool, instruction)
    }

    const routed = await runSmartCommand(instruction)
    if (routed) return true
    return await askExplain(instruction)
  } finally {
    if (activeCommandId.value === commandId) {
      activeCommandId.value = ''
      commandSubmissionLocked.value = false
      loading.chat = false
      if (selectedTopTool.value === requestedTool) selectedTopTool.value = 'auto'
    }
  }
}

function isPlaceholderTaskInstruction(tool = 'auto', instruction = '') {
  const text = String(instruction || '').trim()
  if (!text) return false
  const normalized = text.replace(/\s+/g, '')
  const placeholderPatterns = [
    /^描述要建立、修改或補齊哪些檔案[，,]?例如[:：]?建立登入頁並補齊CSS\/JS[.。…]*$/i,
    /^先開啟專案資料夾，再輸入要建立、修改或補齊的檔案需求[.。…]*$/i,
    /^輸入「.+」的任務指令[.。…]*$/i,
    /^自動判斷[:：]輸入任務需求[；;]?可輸入@檔名加入上下文[.。…]*$/i,
  ]
  if (placeholderPatterns.some(pattern => pattern.test(normalized))) return true
  if (tool === 'files' && /^描述要建立、修改或補齊哪些檔案/.test(text)) return true
  return false
}

function placeholderTaskGuidance(tool = 'auto') {
  if (tool === 'files') {
    return '這句是輸入提示，不是實際任務。請改輸入具體需求，例如：建立 login.html、style.css、script.js，做一個登入頁並可直接開啟使用。'
  }
  return '這句看起來像輸入提示，不是實際任務。請改輸入你要 AI 執行的具體需求。'
}

function extractPlanSteps(planText = '') {
  const lines = String(planText || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  const steps = []
  for (const line of lines) {
    const clean = line
      .replace(/^#{1,6}\s*/, '')
      .replace(/^[-*]\s*/, '')
      .replace(/^\d+[.)、]\s*/, '')
      .trim()
    if (!clean) continue
    if (/^(實作方案|規劃|風險|測試|影響檔案|Affected|Plan)$/i.test(clean)) continue
    if (clean.length < 6) continue
    steps.push(clean)
    if (steps.length >= 6) break
  }

  return steps.length ? steps : [
    '分析目前專案資料夾、README 與開啟中的檔案',
    '依需求決定要新增或修改的檔案',
    '產生檔案內容或修改差異',
    '顯示變更檔案清單與 Diff',
    '執行測試或啟動檢查',
    '回報完成結果與後續建議'
  ]
}

function extractLikelyFiles(planText = '') {
  const matches = String(planText || '').match(/[A-Za-z0-9_\-/]+\.(?:py|js|ts|vue|html|css|json|md|txt|env|yml|yaml|java|sql)/g) || []
  return Array.from(new Set(matches)).slice(0, 12)
}

function planFilePath(file) {
  return normalizeLocalPath(typeof file === 'string' ? file : (file?.path || file?.file_path || file?.file || ''))
}

function normalizePlanFileEntries(files = [], fallbackText = '') {
  const raw = Array.isArray(files) ? files : []
  const entries = raw
    .map(item => {
      const path = planFilePath(item)
      if (!path) return null
      if (typeof item === 'string') {
        return { path, action: 'planned', reason: 'AI 規劃中可能會新增或修改' }
      }
      return {
        path,
        action: String(item.action || item.status || 'planned').trim() || 'planned',
        reason: String(item.reason || item.description || item.purpose || 'AI 規劃中可能會新增或修改').trim()
      }
    })
    .filter(Boolean)

  if (entries.length) return entries.slice(0, 20)
  return extractLikelyFiles(fallbackText).map(path => ({ path, action: 'planned', reason: '從方案文字推測的可能影響檔案' }))
}

function expectedPlanImplementationFiles(files = []) {
  const implementationActions = /^(?:create|created|add|added|new|write|modify|modified|update|updated|edit|replace|planned|建立|新增|寫入|修改|更新)$/i
  const generatedArtifactHints = /(?:output|artifact|result|generated|rendered|export|save|saved|產出|輸出|結果|生成|產物|儲存|瀏覽器開啟|最終結果)/i
  return (files || [])
    .filter(file => {
      const action = String(file?.action || '').trim()
      const reason = String(file?.reason || '').trim()
      if (action && !implementationActions.test(action)) return false
      return !generatedArtifactHints.test(`${action} ${reason}`)
    })
    .map(file => file.path)
    .filter(Boolean)
}

function normalizePlanList(value, fallback = []) {
  if (!Array.isArray(value)) return fallback
  const normalized = value
    .map(item => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object') return item.label || item.title || item.step || item.description || item.reason || item.command || item.path || ''
      return ''
    })
    .map(item => String(item || '').trim())
    .filter(Boolean)
  return normalized.length ? normalized : fallback
}

function selectPlanWorkspaceFiles(tree = []) {
  const textFiles = tree
    .filter(item => item?.type === 'file' && (!item.content_type || item.content_type === 'text') && item.path)
    .map(item => normalizeLocalPath(item.path))
    .filter(Boolean)
  const priorityNames = [
    'README.md',
    'package.json',
    'backend/package.json',
    'frontend/package.json',
    'docker-compose.yml',
    'vite.config.js',
    'frontend/vite.config.js',
    'backend/src/server.js',
    'backend/src/config.js',
    'frontend/src/App.vue',
  ]
  const picked = []
  const add = path => {
    if (path && textFiles.includes(path) && !picked.includes(path)) picked.push(path)
  }

  priorityNames.forEach(add)
  textFiles
    .filter(path => /(^|\/)(README|package-lock|package|vite\.config|tailwind\.config|postcss\.config|docker-compose)\.(md|json|js|yml|yaml)$/i.test(path))
    .forEach(add)
  return picked.slice(0, 12)
}

function selectAnalysisWorkspaceFiles(tree = []) {
  const preferred = selectPlanWorkspaceFiles(tree)
  const allowed = /(?:^|\/)(?:Dockerfile|\.env\.example)$|\.(?:py|js|mjs|cjs|jsx|ts|tsx|vue|java|go|cs|php|rs|html?|css|json|md|sql|ya?ml|toml|ini|properties)$/i
  const skipped = /(^|\/)(?:node_modules|\.git|\.venv|venv|dist|build|coverage|__pycache__|\.pytest_cache)(\/|$)/i
  const candidates = (tree || [])
    .filter(item => item?.type === 'file' && item.path)
    .map(item => normalizeLocalPath(item.path))
    .filter(path => allowed.test(path) && !skipped.test(path))
    .sort((left, right) => {
      const score = path => {
        let value = 0
        if (/(?:package\.json|requirements\.txt|pyproject\.toml|docker-compose|Dockerfile|README)/i.test(path)) value += 50
        if (/(^|\/)tests?\//i.test(path) || /(?:\.test|\.spec)\./i.test(path)) value += 30
        if (/\.(?:py|js|ts|tsx|jsx|vue|java|go)$/i.test(path)) value += 20
        return value
      }
      return score(right) - score(left) || left.localeCompare(right)
    })
  return getUniquePaths([...preferred, ...candidates]).slice(0, ANALYSIS_MAX_FILES)
}

function formatPlanWorkspaceContext(workspace = {}) {
  const tree = Array.isArray(workspace.tree) ? workspace.tree : []
  const files = Array.isArray(workspace.files) ? workspace.files : []
  const treeLines = tree.slice(0, 160).map(item => `${item.type === 'folder' ? 'dir ' : 'file'} ${item.path}`)
  const fileSections = files
    .filter(item => item?.ok && item.content)
    .map(item => `--- ${item.file_path || item.path} ---\n${String(item.content || '').slice(0, 12000)}`)

  return [
    `Project: ${workspace.projectName || projectName.value || '(unknown)'}`,
    `Workspace tree entries: ${tree.length}`,
    treeLines.length ? `Workspace tree sample:\n${treeLines.join('\n')}${tree.length > treeLines.length ? '\n...' : ''}` : 'Workspace tree sample: (empty)',
    fileSections.length ? `Important files:\n${fileSections.join('\n\n')}` : 'Important files: (none read)',
    workspace.error ? `Workspace reconnaissance warning: ${workspace.error}` : ''
  ].filter(Boolean).join('\n\n')
}

async function collectPlanWorkspaceContext() {
  const workspace = { tree: [], files: [], projectName: projectName.value, error: '' }
  try {
    if (workspaceSource.value === 'local-handle') {
      workspace.tree = files.value.map(item => ({ path: item.path, type: item.type }))
      const importantPaths = selectPlanWorkspaceFiles(workspace.tree)
      if (importantPaths.length) {
        for (const path of importantPaths) {
          const handle = localFileHandleMap.value.get(path)
          if (handle) {
            try {
              const file = await handle.getFile()
              const content = await file.text()
              workspace.files.push({ path, content, ok: true })
            } catch (e) {
              workspace.files.push({ path, error: e.message, ok: false })
            }
          }
        }
      }
    } else {
      const treeData = await apiGet('/api/files/tree')
      workspace.tree = Array.isArray(treeData.tree) ? treeData.tree : []
      workspace.projectName = treeData.project_name || workspace.projectName
      const importantPaths = selectPlanWorkspaceFiles(workspace.tree)
      if (importantPaths.length) {
        const readData = await apiPost('/api/files/read-many', {
          file_paths: importantPaths,
          max_files: 12,
          max_chars_per_file: 12000
        })
        workspace.files = Array.isArray(readData.files) ? readData.files : []
      }
    }
  } catch (error) {
    workspace.error = error.message
  }
  workspace.text = formatPlanWorkspaceContext(workspace)
  return workspace
}

function buildAcceptedPlanExecutionInstruction(planMessage = {}, options = {}) {
  const files = normalizePlanFileEntries(planMessage.files || [], planMessage.content || '')
  const requireValidation = options.requireValidation === true
  const originalInstruction = String(planMessage.instruction || '請依照剛才的實作方案開始執行。')
    .replace(/(?:，|,)?\s*(?:請)?(?:先|只)?規劃[^。.!]*(?:不要|不可|無須)修改(?:任何|現有)?檔案[。.!]?/gi, '')
    .replace(/(?:，|,)?\s*(?:請)?(?:不要|不可|無須)修改(?:任何|現有)?檔案[。.!]?/gi, '')
    .trim()
  const lines = [
    requireValidation
      ? '【執行階段契約】使用者已按下「是的，實作此方案」。先前「只規劃、不要修改檔案」之類限制只適用於規劃階段，現在已明確失效。你必須實際使用 write_file / replace_file_content 將方案寫入目前專案資料夾，完成可行測試後才可呼叫 finish；不得只重述方案或宣稱完成。'
      : '【交付穩定模式】使用者已按下「是的，實作此方案」。先前「只規劃、不要修改檔案」之類限制只適用於規劃階段，現在已明確失效。你必須實際使用 write_file / replace_file_content 將方案寫入目前專案資料夾；不要自動安裝外部套件或反覆執行不穩定命令。若驗證需要網路、外部資料、GUI、長時間服務或缺少套件，請完成檔案寫入後在 finish 訊息中列出建議手動驗證命令與環境限制。',
    `使用者要實作的功能：${originalInstruction || '請依照已接受的方案完成實作。'}`,
    '以下是使用者已接受的實作方案。請嚴格依照此方案執行；若遇到資料來源、API schema、套件或現有專案狀態不明，先查證再實作，不要改成固定範本。',
    '真實執行要求：不得用假資料、mock data、sample data、固定 seed、固定成功結果、展示用假內容或硬寫死範例來冒充完成。若真實資料來源或外部服務目前不可用，請實作真實輸入/設定/匯入/API 接入邊界，並在結果中明確回報環境限制；mock 只能出現在測試外部邊界時，不能成為正式功能資料來源。',
    planMessage.summary ? `摘要：${planMessage.summary}` : '',
    normalizePlanList(planMessage.workspaceObservations || planMessage.workspace_observations, []).length
      ? `工作區觀察：\n${normalizePlanList(planMessage.workspaceObservations || planMessage.workspace_observations, []).map(item => `- ${item}`).join('\n')}`
      : '',
    normalizePlanList(planMessage.steps, []).length
      ? `實作步驟：\n${normalizePlanList(planMessage.steps, []).map((item, index) => `${index + 1}. ${item}`).join('\n')}`
      : '',
    files.length
      ? `可能影響檔案：\n${files.map(item => `- ${item.path}${item.action ? `（${item.action}）` : ''}${item.reason ? `：${item.reason}` : ''}`).join('\n')}`
      : '',
    normalizePlanList(planMessage.risks, []).length
      ? `風險與注意事項：\n${normalizePlanList(planMessage.risks, []).map(item => `- ${item}`).join('\n')}`
      : '',
    normalizePlanList(planMessage.tests, []).length
      ? `測試 / 驗證：\n${normalizePlanList(planMessage.tests, []).map(item => `- ${item}`).join('\n')}`
      : '',
    normalizePlanList(planMessage.commandsToRun || planMessage.commands_to_run, []).length
      ? `建議執行命令或查證：\n${normalizePlanList(planMessage.commandsToRun || planMessage.commands_to_run, []).map(item => `- ${item}`).join('\n')}`
      : '',
    planMessage.content ? `完整規劃內容：\n${planMessage.content}` : ''
  ].filter(Boolean)

  return lines.join('\n\n')
}

async function runPlanningMode(instruction, options = {}) {
  if (!projectName.value || workspaceSource.value === 'none' || (workspaceSource.value === 'local-handle' && !directoryHandleRef.value)) {
    chatMessages.value.push({ role: 'assistant', mode: 'plan', content: '錯誤：請先從左側檔案總管「開啟本機資料夾」，再使用規劃模式。' })
    return false
  }

  loading.chat = true
  openResultTab('test')
  diffText.value = ''
  diffInfo.value = null
  pendingNewContent.value = ''
  pendingDiffFilePath.value = ''
  pendingAgentApproval.value = false
  testResult.value = null
  createdFiles.value = []
  agentSteps.value = [
    { label: '1 偵查工作區', status: 'pending', detail: '讀取專案樹、README、package 與重要設定檔' },
    { label: '2 讀取 IDE 上下文', status: 'pending', detail: includeIdeContext.value ? '收集開啟分頁與加入檔案' : 'IDE 上下文關閉，只使用文字需求與工作區摘要' },
    { label: '3 產生方案', status: 'pending', detail: '正在讓 AI 產生可執行方案' },
    { label: '4 等待確認', status: 'pending', detail: '尚未接受方案，不會改檔' },
    { label: '5 Agent 執行', status: 'pending', detail: '等待使用者接受方案' },
    { label: '6 檔案變更', status: 'pending', detail: '尚未產生檔案變更' },
    { label: '7 測試 / 結果', status: 'pending', detail: '尚未執行測試' }
  ]
  const treeCmd = workspaceSource.value === 'local-handle' ? 'LOCAL FileSystem' : 'GET /api/files/tree'
  const readCmd = workspaceSource.value === 'local-handle' ? 'LOCAL ReadFiles' : 'POST /api/files/read-many'
  
  commandLogs.value = [
    { time: '規劃中', command: treeCmd, status: 'running', statusLabel: '讀取專案樹' },
    { time: '規劃中', command: readCmd, status: 'pending', statusLabel: '讀取重要檔案' },
    { time: '規劃中', command: 'POST /api/ai/plan', status: 'pending', statusLabel: '產生方案中' }
  ]
  fileChanges.value = []

  try {
    const workspaceContext = await collectPlanWorkspaceContext()
    commandLogs.value = [
      { time: '規劃', command: treeCmd, status: workspaceContext.error ? 'failed' : 'done', statusLabel: workspaceContext.error || `已讀取 ${workspaceContext.tree.length} 個項目` },
      { time: '規劃', command: readCmd, status: workspaceContext.error ? 'failed' : 'done', statusLabel: `已讀取 ${workspaceContext.files.filter(item => item.ok).length} 個重要檔案` },
      { time: '規劃中', command: 'POST /api/ai/plan', status: 'running', statusLabel: '產生方案中' }
    ]
    agentSteps.value = agentSteps.value.map((step, index) => {
      if (index === 0) return { ...step, status: workspaceContext.error ? 'failed' : 'done', detail: workspaceContext.error || `已讀取 ${workspaceContext.tree.length} 個專案項目、${workspaceContext.files.filter(item => item.ok).length} 個重要檔案` }
      return step
    })

    const explicitPlanContextPaths = getUniquePaths([
      ...resolveMentionedFilePaths(instruction),
      ...resolveRequestedWorkspacePaths(instruction, workspaceFilePaths()),
    ])
    const contextBundle = await buildContextBundle(explicitPlanContextPaths)
    agentSteps.value = agentSteps.value.map((step, index) => {
      if (index === 1) return { ...step, status: 'done', detail: `已讀取 ${contextBundle.files?.length || 0} 個 IDE / 對話上下文檔案` }
      return step
    })
    const data = await apiPost('/api/ai/plan', {
      instruction,
      file_path: activeFile.value,
      selected_tool: selectedTopTool.value,
      code: includeIdeContext.value ? fileContent.value : '',
      selected_code: includeIdeContext.value ? selectedCode.value : '',
      include_ide_context: includeIdeContext.value,
      pinned_files: includeIdeContext.value ? pinnedContextFiles.value : [],
      context_files: contextBundle.files,
      workspace_context: workspaceContext.text,
      planning_session_id: options.planningSessionId || '',
      clarification_answers: options.clarificationAnswers || [],
      revision_request: options.revisionRequest || '',
      previous_plan: options.previousPlan || '',
      force_plan: options.forcePlan === true,
    })
    if (data.ok === false) throw new Error(data.error || data.content || '規劃失敗')

    if (data.needs_clarification === true || data.type === 'plan_clarification') {
      const clarificationMessage = {
        role: 'assistant',
        mode: 'plan',
        type: 'plan_clarification',
        status: 'pending',
        title: '需求確認',
        instruction,
        rationale: data.rationale || '開始規劃前，需要先確認幾個會影響成品的重要選擇。',
        questions: Array.isArray(data.questions) ? data.questions : [],
        planningSessionId: data.planning_session_id || options.planningSessionId || '',
        createdAt: Date.now(),
      }
      pendingPlanClarification.value = clarificationMessage
      pendingPlanRequest.value = null
      chatMessages.value.push(clarificationMessage)
      agentSteps.value = [
        { label: '1 偵查工作區', status: 'done', detail: `已讀取 ${workspaceContext.tree.length} 個項目、${workspaceContext.files.filter(item => item.ok).length} 個重要檔案` },
        { label: '2 讀取 IDE 上下文', status: 'done', detail: `已讀取 ${contextBundle.files?.length || 0} 個上下文檔案` },
        { label: '3 釐清需求', status: 'pending', detail: `等待回答 ${clarificationMessage.questions.length} 個關鍵問題` },
        { label: '4 產生方案', status: 'pending', detail: '回答完成後才會規劃' },
        { label: '5 等待確認', status: 'pending', detail: '尚未產生方案' },
        { label: '6 Agent 執行', status: 'pending', detail: '不會在釐清階段修改檔案' },
        { label: '7 測試 / 結果', status: 'pending', detail: '尚未執行' },
      ]
      commandLogs.value = [
        { time: '規劃', command: treeCmd, status: 'done', statusLabel: '工作區偵查完成' },
        { time: '規劃', command: 'POST /api/ai/plan', status: 'done', statusLabel: '需要使用者確認需求' },
      ]
      return true
    }

    const structuredPlan = data.plan && typeof data.plan === 'object' ? data.plan : {}
    const planText = formatModelResponse(data.content || (typeof data.plan === 'string' ? data.plan : '') || '已產生實作計畫。', data)
    const planSteps = normalizePlanList(data.steps || structuredPlan.steps, extractPlanSteps(planText))
    const planFiles = normalizePlanFileEntries(data.files || structuredPlan.files, planText)
    const planRisks = normalizePlanList(data.risks || structuredPlan.risks, [])
    const planTests = normalizePlanList(data.tests || structuredPlan.tests, [])
    const commandsToRun = normalizePlanList(data.commands_to_run || structuredPlan.commands_to_run, [])
    const workspaceObservations = normalizePlanList(data.workspace_observations || structuredPlan.workspace_observations, [])
    const planMessage = {
      role: 'assistant',
      mode: 'plan',
      type: 'plan_approval',
      status: 'pending',
      title: '實作方案',
      content: planText,
      summary: data.summary || structuredPlan.summary || '我已先完成規劃；目前尚未修改任何檔案。請確認是否依此方案開始執行。',
      instruction,
      planningSessionId: data.planning_session_id || options.planningSessionId || '',
      clarificationAnswers: data.clarification_answers || options.clarificationAnswers || [],
      steps: planSteps,
      files: planFiles,
      risks: planRisks,
      tests: planTests,
      commandsToRun,
      workspaceObservations,
      reconnaissance: {
        treeCount: workspaceContext.tree.length,
        filesRead: workspaceContext.files.filter(item => item.ok).length,
        contextFiles: contextBundle.files?.length || 0,
      },
      needsApproval: data.needs_approval !== false,
      createdAt: Date.now()
    }

    pendingPlanRequest.value = planMessage
    chatMessages.value.push(planMessage)
    agentSteps.value = [
      { label: '1 偵查工作區', status: 'done', detail: `已讀取 ${workspaceContext.tree.length} 個項目、${workspaceContext.files.filter(item => item.ok).length} 個重要檔案` },
      { label: '2 讀取 IDE 上下文', status: 'done', detail: `已讀取 ${contextBundle.files?.length || 0} 個上下文檔案` },
      { label: '3 產生方案', status: 'done', detail: 'AI 已產生結構化實作方案' },
      { label: '4 等待確認', status: 'pending', detail: '請按「接受方案並執行」才會開始改檔' },
      { label: '5 Agent 執行', status: 'pending', detail: '尚未執行 command / file edit' },
      { label: '6 檔案變更', status: 'pending', detail: '尚未產生新增或修改檔案' },
      { label: '7 測試 / 結果', status: 'pending', detail: '尚未執行測試' }
    ]
    commandLogs.value = [
      { time: '規劃', command: treeCmd, status: 'done', statusLabel: `已讀取 ${workspaceContext.tree.length} 個項目` },
      { time: '規劃', command: readCmd, status: 'done', statusLabel: `已讀取 ${workspaceContext.files.filter(item => item.ok).length} 個重要檔案` },
      { time: '規劃', command: 'read open files / pinned context', status: 'done', statusLabel: `已讀取 ${contextBundle.files?.length || 0} 個 IDE 上下文檔案` },
      { time: '規劃', command: 'POST /api/ai/plan', status: 'done', statusLabel: '方案已產生' }
    ]
    fileChanges.value = planMessage.files.map(file => ({ path: planFilePath(file), status: 'planned', description: file.reason || 'AI 規劃中可能會新增或修改' })).filter(item => item.path)
  } catch (err) {
    agentSteps.value = agentSteps.value.map((step, index) => index === 2 ? { ...step, status: 'failed', detail: err.message } : step)
    chatMessages.value.push({ role: 'assistant', mode: 'plan', content: `錯誤：規劃模式失敗：${err.message}` })
  } finally {
    loading.chat = false
    await loadAuditLogs()
    await refreshHealth()
  }
}

async function submitPlanClarificationAnswers(payload = {}) {
  const clarificationMessage = payload.msg || pendingPlanClarification.value
  if (!clarificationMessage || clarificationMessage.status !== 'pending') return
  const answers = Array.isArray(payload.answers) ? payload.answers : []
  clarificationMessage.status = 'answered'
  clarificationMessage.answers = answers
  pendingPlanClarification.value = null
  chatMessages.value.push({
    role: 'user',
    mode: 'plan',
    content: `已確認規劃需求：\n${answers.map(answer => `- ${answer.prompt}：${answer.values.join('、')}`).join('\n')}`,
  })
  await runPlanningMode(clarificationMessage.instruction, {
    clarificationAnswers: answers,
    planningSessionId: clarificationMessage.planningSessionId,
    forcePlan: true,
  })
}

function completeRunningCommandLogs(finalStatus = 'done') {
  commandLogs.value = commandLogs.value.map(log => (
    log.status === 'running' ? { ...log, status: finalStatus } : log
  ))
}

function appendRunningCommandLog(command, statusLabel) {
  completeRunningCommandLogs('done')
  commandLogs.value.push({
    time: new Date().toLocaleTimeString(),
    command,
    status: 'running',
    statusLabel,
  })
}

function recordAgentFileChange(path, status = 'modified') {
  const cleanPath = normalizeLocalPath(path)
  if (!cleanPath) return
  const existingIndex = fileChanges.value.findIndex(item => normalizeLocalPath(item.path) === cleanPath)
  const entry = {
    path: cleanPath,
    status,
    description: status === 'created' ? 'Agent 已新增檔案' : 'Agent 已寫入檔案',
  }
  if (existingIndex >= 0) fileChanges.value.splice(existingIndex, 1, entry)
  else fileChanges.value.push(entry)
}

async function startAgentLoop(instruction, options = {}) {
  loading.result = true
  loading.chat = true
  openResultTab('test')
  commandLogs.value = []
  agentSteps.value = [
    { label: '1 啟動 Agent', status: 'done', detail: '準備執行自動化流程' },
    { label: '2 執行中', status: 'pending', detail: 'Agent 正在思考與操作' }
  ]

  const defaultDir = getActiveFileDirectory() || ''
  const pendingLocalWrites = []
  const changedFilePaths = new Set()
  
  try {
    const contextFiles = await buildTestContextFiles(activeFile.value)
    const initRes = await fetch('/api/agent/loop/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: instruction,
        default_dir: defaultDir,
        is_local_handle: workspaceSource.value === 'local-handle',
        workspace_source: workspaceSource.value,
        project_id: ensureSandboxProjectId(),
        project_name: projectName.value || 'project',
        file_path: activeFile.value || '',
        code: activeFile.value ? fileContent.value : undefined,
        context_files: contextFiles,
        require_file_changes: options.requireFileChanges === true,
        require_validation: options.requireValidation === true,
        expected_files: Array.isArray(options.expectedFiles) ? options.expectedFiles : [],
        validation_commands: Array.isArray(options.validationCommands) ? options.validationCommands : [],
      })
    })
    
    if (!initRes.ok) {
      throw new Error(`初始化 Agent 迴圈失敗：${initRes.statusText}`)
    }
    
    const { id, sandbox } = await initRes.json()
    commandLogs.value.push({
      time: new Date().toLocaleTimeString(),
      command: `準備 AI Docker Sandbox ${sandbox?.workspace_id || ''}`.trim(),
      status: 'done',
      statusLabel: `已同步 ${sandbox?.synced_count || 0} 個檔案`,
    })
    const source = new EventSource(`/api/agent/loop/stream?id=${id}`)
    let agentLoopSettled = false
    let idleTimer = null
    let totalTimer = null
    const closeAgentLoopStream = () => {
      window.clearTimeout(idleTimer)
      window.clearTimeout(totalTimer)
      source.close()
    }
    const failAgentLoop = (message, command = 'Agent 執行逾時') => {
      if (agentLoopSettled) return
      agentLoopSettled = true
      closeAgentLoopStream()
      completeRunningCommandLogs('failed')
      loading.result = false
      loading.chat = false
      agentSteps.value[1].status = 'failed'
      agentSteps.value[1].detail = message
      agentSteps.value.push({ label: '3 失敗', status: 'failed', detail: message })
      commandLogs.value.push({ time: new Date().toLocaleTimeString(), command, status: 'failed', statusLabel: '已停止等待' })
      chatMessages.value.push({ role: 'assistant', mode: 'execution', content: `Agent 執行失敗！\n\n${message}` })
    }
    const resetAgentLoopIdleTimer = () => {
      window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(() => {
        failAgentLoop(`Agent 串流已 ${Math.round(AGENT_LOOP_IDLE_TIMEOUT_MS / 1000)} 秒沒有新進度，系統已停止等待；請查看後端模型或 Docker 沙盒狀態後重試。`, 'Agent idle timeout')
      }, AGENT_LOOP_IDLE_TIMEOUT_MS)
    }
    totalTimer = window.setTimeout(() => {
      failAgentLoop(`Agent 執行已超過 ${Math.round(AGENT_LOOP_TOTAL_TIMEOUT_MS / 60000)} 分鐘，系統已停止等待，避免畫面無限轉圈。`, 'Agent total timeout')
    }, AGENT_LOOP_TOTAL_TIMEOUT_MS)
    resetAgentLoopIdleTimer()

    source.onmessage = async (e) => {
      if (agentLoopSettled) return
      resetAgentLoopIdleTimer()
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'heartbeat') {
          return
        }
        if (data.type === 'done') {
        agentLoopSettled = true
        closeAgentLoopStream()
        completeRunningCommandLogs(data.result?.ok === false ? 'failed' : 'done')
        const writeResults = await Promise.allSettled(pendingLocalWrites)
        const writeFailures = writeResults.filter(item => item.status === 'rejected')
        for (const path of (data.result?.changedFiles || [])) changedFilePaths.add(normalizeLocalPath(path))
        loading.result = false
        loading.chat = false
        if (data.result?.ok === false || writeFailures.length) {
          const errorMessage = writeFailures.length
            ? `有 ${writeFailures.length} 個檔案無法寫回本機資料夾。`
            : (data.result?.error || data.result?.finalMessage || 'Agent 未完成要求。')
          agentSteps.value[1].status = 'failed'
          agentSteps.value[1].detail = errorMessage
          agentSteps.value.push({ label: '3 失敗', status: 'failed', detail: errorMessage })
          commandLogs.value.push({ time: new Date().toLocaleTimeString(), command: 'Agent 執行結果', status: 'failed', statusLabel: '執行失敗' })
          chatMessages.value.push({ role: 'assistant', mode: 'execution', content: `Agent 執行失敗！\n\n${errorMessage}` })
          return
        }

        const changedFiles = Array.from(changedFilePaths).filter(Boolean)
        agentSteps.value[1].status = 'done'
        agentSteps.value.push({ label: '3 完成', status: 'done', detail: changedFiles.length ? `已寫入 ${changedFiles.length} 個檔案` : '執行完畢' })
        commandLogs.value.push({ time: new Date().toLocaleTimeString(), command: 'Agent 執行結果', status: 'done', statusLabel: changedFiles.length ? `已寫入 ${changedFiles.length} 個檔案` : '執行完成' })
        await refreshFolderFromExplorer({ announce: false, mode: 'execution' })
        if (changedFiles.length) {
          await selectFile(changedFiles[0], { preserveCommand: true, silent: true })
        }
        const savedSummary = changedFiles.length
          ? `\n\n已實際寫入資料夾「${projectName.value}」：\n${changedFiles.map(path => `- ${path}`).join('\n')}`
          : ''
        chatMessages.value.push({ role: 'assistant', mode: 'execution', content: `Agent 執行完成！\n\n${data.result?.finalMessage || ''}${savedSummary}` })
      } else if (data.type === 'error') {
        agentLoopSettled = true
        closeAgentLoopStream()
        completeRunningCommandLogs('failed')
        loading.result = false
        loading.chat = false
        agentSteps.value[1].status = 'failed'
        agentSteps.value[1].detail = data.error || data.message || '發生錯誤'
        commandLogs.value.push({ time: new Date().toLocaleTimeString(), command: '錯誤', status: 'failed', statusLabel: data.error || data.message || '發生錯誤' })
        chatMessages.value.push({ role: 'assistant', mode: 'execution', content: `Agent 執行失敗！\n\n${data.error || data.message || '發生錯誤'}` })
      } else if (data.type === 'file_change') {
        const changedPath = normalizeLocalPath(data.path)
        if (changedPath) changedFilePaths.add(changedPath)
        recordAgentFileChange(changedPath, data.isNew ? 'created' : 'modified')
        completeRunningCommandLogs('done')
        commandLogs.value.push({
          time: new Date().toLocaleTimeString(),
          command: changedPath || '檔案變更',
          status: 'done',
          statusLabel: data.isNew ? '已新增檔案' : '已修改檔案',
        })
        if (workspaceSource.value === 'local-handle') {
          const writePromise = writeTextToLocalFile(data.path, data.content).then(() => (
            refreshFolderFromExplorer({ announce: false, mode: 'execution' })
          ))
          pendingLocalWrites.push(writePromise)
        } else {
          refreshFolderFromExplorer({ announce: false, mode: 'execution' })
        }
      } else {
        const cmd = localizeAgentEventMessage(data)
        appendRunningCommandLog(cmd, agentEventTypeLabel(data.type))
      }
      } catch (err) {
        console.error('SSE parse error:', err)
      }
    }

    source.onerror = () => {
      failAgentLoop('SSE 連線中斷。', 'SSE 連線錯誤')
    }
  } catch (err) {
    loading.result = false
    loading.chat = false
    agentSteps.value[1].status = 'failed'
    agentSteps.value[1].detail = err.message
    commandLogs.value.push({ time: new Date().toLocaleTimeString(), command: '初始化錯誤', status: 'failed', statusLabel: '初始化失敗' })
    chatMessages.value.push({ role: 'assistant', mode: 'execution', content: `Agent 執行失敗！\n\n${err.message}` })
    console.error('Failed to start agent loop:', err)
  }
}

async function acceptPlanExecution(payload = {}) {
  const planMessage = payload.msg || pendingPlanRequest.value
  if (!planMessage || planMessage.status !== 'pending') return

  planMessage.status = 'accepted'
  pendingPlanRequest.value = null
  planningMode.value = false
  openResultTab('test')
  commandLogs.value = [
    { time: '確認', command: 'user accepted plan', status: 'done', statusLabel: '已接受方案' },
    { time: '執行', command: '啟動自動化 Agent 迴圈', status: 'pending', statusLabel: '準備進入自動化操作' }
  ]
  const planFiles = normalizePlanFileEntries(planMessage.files || [], planMessage.content || '')
  fileChanges.value = planFiles.map(file => ({ path: file.path, status: 'planned', description: file.reason || '等待 Agent 執行' }))
  
  chatMessages.value.push({
    role: 'assistant',
    mode: 'execution',
    content: '已接受方案，現在啟動 Agent 迴圈。接下來 Agent 會自行決定要使用的工具並修改檔案，您可以在下方看到它的即時進度。'
  })

  const requireValidation = !PLANNING_DELIVERY_STABLE_MODE
  const instruction = buildAcceptedPlanExecutionInstruction(planMessage, { requireValidation })
  await startAgentLoop(instruction, {
    requireFileChanges: true,
    requireValidation,
    expectedFiles: expectedPlanImplementationFiles(planFiles),
    validationCommands: requireValidation ? normalizePlanList(planMessage.commandsToRun || planMessage.commands_to_run, []) : [],
  })
}

async function requestPlanRevision(payload = {}) {
  if (commandSubmissionLocked.value || loading.chat) {
    addAssistantError('目前任務仍在執行，完成後才能重新規劃。')
    return
  }
  const planMessage = payload.msg || pendingPlanRequest.value
  if (!planMessage || planMessage.status !== 'pending') return

  const commandId = `replan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  activeCommandId.value = commandId
  commandSubmissionLocked.value = true
  planMessage.status = 'revision_requested'
  pendingPlanRequest.value = null
  pendingPlanRevision.value = null
  planningMode.value = true
  const revisionRequest = '重新規劃'
  chatMessages.value.push({ role: 'user', mode: 'plan', content: revisionRequest, taskId: commandId })
  announceExecutionScope('重新規劃', revisionRequest, 'plan')
  agentSteps.value = agentSteps.value.map((step, index) => index >= 2 ? { ...step, status: 'failed', detail: '使用者要求修改方案' } : step)

  try {
    await runPlanningMode(planMessage.instruction || revisionRequest, {
      revisionRequest,
      clarificationAnswers: planMessage.clarificationAnswers || [],
      planningSessionId: planMessage.planningSessionId || '',
      previousPlan: planMessage.content || '',
      forcePlan: true,
    })
  } finally {
    if (activeCommandId.value === commandId) {
      activeCommandId.value = ''
      commandSubmissionLocked.value = false
      loading.chat = false
    }
  }
}

function cancelPlanExecution(payload = {}) {
  const planMessage = payload.msg || pendingPlanRequest.value || pendingPlanClarification.value
  if (planMessage) planMessage.status = 'canceled'
  pendingPlanRequest.value = null
  pendingPlanClarification.value = null
  pendingPlanRevision.value = null
  chatMessages.value.push({ role: 'assistant', mode: 'plan', content: '已取消本次方案，沒有修改任何檔案。' })
  agentSteps.value = agentSteps.value.map((step, index) => index >= 2 ? { ...step, status: 'failed', detail: '使用者取消方案' } : step)
}

async function classifyAutoIntent(instruction) {
  const contextBundle = await buildContextBundle(getOpenTaskFiles())
  const workspaceContext = (workspaceSource.value !== 'none' || files.value.length || projectName.value)
    ? await collectPlanWorkspaceContext()
    : null
  const data = await apiPost('/api/ai/auto-intent', {
    instruction,
    file_path: activeFile.value,
    code: includeIdeContext.value ? fileContent.value : '',
    selected_code: includeIdeContext.value ? selectedCode.value : '',
    pinned_files: includeIdeContext.value ? pinnedContextFiles.value : [],
    context_files: contextBundle.files,
    workspace_context: workspaceContext?.text || '',
  })

  if (data.ok === false) {
    throw new Error(data.error || data.reason || 'Auto 模型沒有完成判斷')
  }

  const intent = String(data.intent || 'chat').trim()
  const label = autoIntentLabels[intent] || intent || 'AI 問答'
  const confidence = Number(data.confidence || 0)
  const confidenceText = confidence ? `；信心 ${Math.round(confidence * 100)}%` : ''
  const reasonText = data.reason ? `；原因：${data.reason}` : ''

  chatMessages.value.push({
    role: 'assistant',
    content: formatModelResponse(`Auto 模型判斷：${label}${confidenceText}${reasonText}`, data)
  })

  return { intent, data }
}

async function runSmartCommand(instruction) {
  try {
    const { intent, data } = await classifyAutoIntent(instruction)
    const confidence = Number(data.confidence || 0)
    const isDeterministic = data.source === 'deterministic_router'
    if (!isDeterministic && confidence < 0.65) {
      chatMessages.value.push({
        role: 'assistant',
        content: `Auto 對任務類型的信心只有 ${Math.round(confidence * 100)}%，因此沒有自動執行或修改檔案。請補充要處理的檔名／程式碼，或從「功能選項」明確選擇功能後再送出。`,
      })
      return true
    }
    const routed = await runSmartCommandByIntent(instruction, intent, data)
    if (routed) return true
    throw new Error(`Auto 模型回傳未知功能：${intent}`)
  } catch (err) {
    console.warn('[auto-intent] model router failed:', err.message)
    chatMessages.value.push({
      role: 'assistant',
      content: `自動模式需要由本機模型判斷功能，但目前模型判斷失敗：${err.message}

請確認 Ollama / Codex 連線正常後再試，或手動選擇左上功能執行。`
    })
    return true
  }
}

async function runSmartCommandByIntent(instruction, intent, autoData = {}) {
  if (!(await ensureTaskContext(intent, instruction))) return true
  announceExecutionScope(autoIntentLabels[intent] || 'AI 問答', instruction)
  switch (intent) {
    case 'multi_file_edit':
    case 'create_files':
      await createAgentFiles(instruction, {
        autoWorkspaceRepair: isWorkspaceRepairRequest(instruction),
        autoReason: autoData.reason || '',
      })
      return true

    case 'convert':
      await convertCode(instruction)
      return true

    case 'plan':
      // 規劃模式只能由上方「規劃模式」開關控制。
      // 沒開規劃模式時，一律留在 AI AI Agent 模式，不自動切到 Plan。
      await askExplain(instruction)
      return true

    case 'rewrite_advice':
      await askRewriteAdvice(instruction)
      return true

    case 'test_advice':
      await askTestAdvice(instruction)
      return true

    case 'rewrite':
      {
        const targetScope = withOpenEditorTargets(instruction, '程式碼改寫')
        await runInlineCommand({
          action: 'rewrite',
          label: '程式碼改寫',
          instruction: targetScope.instruction,
          selectedCode: selectedCode.value,
          content: fileContent.value,
          filePath: activeFile.value,
          targetFiles: targetScope.targetFiles,
          cursor: editorCursor.value
        })
      }
      return true

    case 'run_tests':
      await runTests()
      return true

    case 'detect':
      await detectCode(instruction, { actionLabel: '錯誤偵測' })
      return true

    case 'fix':
      if (/(?:全|整個|完整)(?:專案|項目)|掃描(?:整個)?專案|project[- ]?wide/i.test(instruction)) {
        await runProjectErrorFix(instruction)
      } else {
        const targetFiles = getOpenRewriteTaskFiles()
        const targetScope = withOpenEditorTargets(instruction, '錯誤修正', targetFiles)
        await runInlineCommand({
          action: 'fix',
          label: '錯誤修正',
          instruction: targetScope.instruction,
          selectedCode: selectedCode.value,
          content: fileContent.value,
          filePath: activeFile.value,
          targetFiles: targetScope.targetFiles,
          cursor: editorCursor.value,
          autoApply: true,
        })
      }
      return true


    case 'generate':
      await generateCode(instruction)
      return true

    case 'analyze':
      await askExplain(instruction, { actionLabel: '專案檔案分析' })
      return true


    case 'explain':
      await askExplain(instruction, { actionLabel: '程式說明' })
      return true

    case 'chat':
      await askExplain(instruction)
      return true

    default:
      return false
  }
}

function extractGeneratedCode(content) {
  let text = String(content || '').replace(/\r\n/g, '\n').trim()
  if (!text) return ''

  const fenced = text.match(/```[a-zA-Z0-9_+.#-]*\s*([\s\S]*?)```/)
  if (fenced) text = fenced[1].trim()

  text = text
    .replace(/^```[a-zA-Z0-9_+.#-]*\s*/g, '')
    .replace(/```$/g, '')
    .trim()

  const stopMarkers = ['\n說明：', '\nExplanation:', '\n注意：', '\nNote:']
  for (const marker of stopMarkers) {
    const idx = text.indexOf(marker)
    if (idx > 0) text = text.slice(0, idx).trim()
  }

  return text
}

function makeWholeFileDiff(filePath, oldContent, newContent) {
  const oldLines = String(oldContent || '').replace(/\r\n/g, '\n').split('\n')
  const newLines = String(newContent || '').replace(/\r\n/g, '\n').split('\n')
  while (oldLines.length && oldLines[oldLines.length - 1] === '') oldLines.pop()
  while (newLines.length && newLines[newLines.length - 1] === '') newLines.pop()
  const oldCount = Math.max(oldLines.length, 1)
  const newCount = Math.max(newLines.length, 1)
  const lines = [
    `--- a/${filePath || '目前檔案'}`,
    `+++ b/${filePath || '目前檔案'}`,
    `@@ -1,${oldCount} +1,${newCount} @@`,
    ...oldLines.map(line => `-${line}`),
    ...newLines.map(line => `+${line}`)
  ]
  return lines.join('\n') + '\n'
}

function stageGeneratedContentDiff(targetFile, newContent, instruction, modelInfo = 'local_ollama') {
  const target = normalizeLocalPath(targetFile || activeFile.value || 'current_file.py')
  const oldContent = target === activeFile.value ? fileContent.value : ''
  const source = typeof modelInfo === 'string' ? modelInfo : (modelInfo?.source || 'local_ollama')
  const model = typeof modelInfo === 'string' ? modelInfo : (modelInfo?.model || source)
  diffText.value = makeWholeFileDiff(target, oldContent, newContent)
  diffInfo.value = {
    instruction,
    filePath: target,
    source,
    model,
    tokens: typeof modelInfo === 'string' ? 0 : (modelInfo?.tokens ?? 0),
    note: '先產生修改差異，等待使用者確認後才套用。'
  }
  pendingNewContent.value = String(newContent || '').replace(/\s*$/g, '') + '\n'
  pendingDiffFilePath.value = target
  pendingAgentApproval.value = false
  openResultTab('diff')
}

function convertedFilePath(sourcePath, targetLanguage) {
  return convertedTargetPath(sourcePath, targetLanguage)
}

function inferGeneratedTargetFile(instruction = '') {
  return inferGeneratedTargetPath({
    instruction,
    activeFile: activeFile.value,
    currentContent: fileContent.value,
    existingPaths: generatedTargetOccupiedPaths(),
  })
}

function shouldReplaceGeneratedContent(instruction = '', currentContent = '') {
  return !String(currentContent || '').trim()
}

async function generateCode(instruction) {
  const multiFileItems = getMultiFileGenerationItems(instruction)
  const requestInstruction = multiFileItems.length > 1
    ? buildMultiFileGenerationInstruction(instruction, multiFileItems)
    : instruction
  loading.chat = true
  loading.result = true
  openResultTab('diff')

  try {
    let targetFile = inferGeneratedTargetFile(instruction)
    const editsCurrentFile = Boolean(activeFile.value && targetFile === activeFile.value)
    const currentTargetContent = editsCurrentFile ? fileContent.value : ''
    const currentTargetSelection = editsCurrentFile ? selectedCode.value : ''
    if (!activeFile.value) {
      projectName.value = projectName.value || 'generated_workspace'
      sandboxProjectId.value = sandboxProjectId.value || createSandboxProjectId(projectName.value, 'virtual')
      if (workspaceSource.value === 'none') workspaceSource.value = 'virtual'
    }

    const contextBundle = await buildContextBundle(getUniquePaths([
      ...(editsCurrentFile ? [targetFile] : []),
      activeFile.value,
    ]))
    const data = await apiPost('/api/ai/generate', {
      prompt: requestInstruction,
      currentFilePath: targetFile,
      currentFileContent: multiFileItems.length > 1 ? '' : currentTargetContent,
      selectedText: multiFileItems.length > 1 ? '' : currentTargetSelection,
      language: inferLanguageId(targetFile),
      mode: 'code-generation',
      file_path: targetFile,
      instruction: requestInstruction,
      context: [multiFileItems.length > 1 ? '' : currentTargetContent, contextBundle.text].filter(Boolean).join('\n\n'),
      context_files: contextBundle.files,
      code: multiFileItems.length > 1 ? '' : currentTargetContent,
      multi_file_items: multiFileItems,
      output_directory: getActiveFileDirectory(),
      variants: 1,
      style: 'auto',
      temperature: 0.45,
    })

    if (data.ok === false) throw new Error(data.content || data.error || '產碼失敗')

    const responseTargetFile = normalizeLocalPath(data.file_path || '')
    if (responseTargetFile && responseTargetFile !== targetFile) {
      targetFile = findAvailableGeneratedPath(
        responseTargetFile,
        generatedTargetOccupiedPaths(),
        responseTargetFile === activeFile.value ? activeFile.value : '',
      )
    }

    const supportFiles = normalizeSameFolderGeneratedFiles(data.support_files || data.supportFiles || [], 0, {
      preserveExisting: true,
    })
    const supportResults = supportFiles.length
      ? await materializeGeneratedCodeFiles(supportFiles)
      : []

    if (data.files && data.files.length > 0) {
      const generatedFiles = normalizeSameFolderGeneratedFiles(data.files, multiFileItems.length)
      const results = await materializeGeneratedCodeFiles(generatedFiles)
      fileChanges.value = [...results, ...supportResults].map(file => ({
        path: file.path,
        status: file.status || 'created',
        description: file.status === 'skipped' ? '檔案已存在，未覆寫' : 'AI 生成的新檔案'
      }))
      const firstCreatedFile = results.find(file => file.status === 'created')?.path || results.find(file => file.path)?.path
      if (firstCreatedFile) await selectFile(firstCreatedFile)
      const createdCount = results.filter(file => file.status === 'created').length
      const skippedCount = results.filter(file => file.status === 'skipped').length
      chatMessages.value.push({
        role: 'assistant',
        content: formatModelResponse(`已在目前資料夾建立 ${createdCount} 個程式檔案${skippedCount ? `，另有 ${skippedCount} 個同名檔案未覆寫` : ''}。請查看左側檔案總管。`, data)
      })
      return
    }

    if (multiFileItems.length > 1) {
      throw new Error(`需求包含 ${multiFileItems.length} 個程式，但模型沒有回傳 ${multiFileItems.length} 個獨立檔案；未建立任何預設替代檔案。`)
    }

    const generatedCode = data.new_content || data.generated_code || extractGeneratedCode(data.content || '')
    if (!generatedCode.trim()) {
      chatMessages.value.push({
        role: 'assistant',
        content: formatModelResponse(data.content || '模型有回覆，但沒有抽出可放入編輯器的程式碼。', data)
      })
      return
    }

    const current = targetFile === activeFile.value ? String(fileContent.value || '') : ''
    const generated = `${generatedCode.replace(/\s*$/g, '')}\n`
    const nextContent = data.new_content || data.generated_code
      ? generated
      : shouldReplaceGeneratedContent(instruction, current)
        ? generated
        : `${current.replace(/\s*$/g, '')}\n\n${generated}`

    // 程式碼產生要直接放進 Monaco Editor，避免只出現在 Chat 裡。
    // 同時保留 Diff，使用者可看修改內容，再按保存 / Ctrl+S 寫回檔案。
    stageGeneratedContentDiff(targetFile, nextContent, instruction, data)
    let generatedSaved = false
    try {
      generatedSaved = await saveGeneratedContentIfWritable(targetFile, nextContent)
    } catch (saveErr) {
      addAssistantError(`自動儲存生成檔案失敗：${saveErr.message}`)
    }
    applyNewContentToLocalEditor(targetFile, nextContent, { dirty: !generatedSaved })
    if (generatedSaved) markFileSaved(targetFile, nextContent, { updateBackendCache: workspaceSource.value === 'backend' })
    fileChanges.value = [
      { path: targetFile, status: current.trim() ? 'modified' : 'created', description: 'AI 生成的主程式' },
      ...supportResults.map(file => ({
        path: file.path,
        status: file.status || 'created',
        description: file.status === 'skipped' ? '已使用現有資料檔，未重複建立' : 'AI 自動建立的配套資料檔',
      })),
    ]

    chatMessages.value.push({
      role: 'assistant',
      content: formatModelResponse(
        `${data.content || '已產生程式碼。'}\n\n已把程式碼放進編輯器：${targetFile}。${supportResults.length ? `\n配套資料檔：${supportResults.map(file => `${file.path}（${file.status === 'skipped' ? '使用現有檔' : '已建立'}）`).join('、')}。` : ''}\n${generatedSaved ? '主程式已自動儲存。' : '主程式目前尚未儲存，確認後請按「保存」或 Ctrl+S。'}`,
        data
      )
    })
  } catch (err) {
    addAssistantError(`程式碼生成失敗：${err.message}`)
  } finally {
    loading.chat = false
    loading.result = false
    await loadAuditLogs()
    await refreshHealth()
  }
}

function inferConvertTargetLanguage(instruction, sourceCode = selectedCode.value || fileContent.value, sourceFile = activeFile.value) {
  return inferConversionTarget({
    instruction,
    sourceCode,
    filePath: sourceFile,
  })
}

async function convertCode(instruction) {
  loading.chat = true
  try {
    const targetScope = withOpenEditorTargets(instruction, '程式語言轉換')
    if (targetScope.hasMultipleTargets) {
      loading.chat = false
      return createAgentFiles(targetScope.instruction, {
        targetFiles: targetScope.targetFiles,
      })
    }
    const sourceFile = targetScope.targetFiles[0] || activeFile.value
    const sourceIsActive = sourceFile === activeFile.value
    const sourceCode = sourceIsActive && selectedCode.value
      ? selectedCode.value
      : await readInlineTargetContent(sourceFile, sourceIsActive ? fileContent.value : '')
    const target = inferConvertTargetLanguage(instruction, sourceCode, sourceFile)
    if (!target) throw new Error('無法判斷目標語言。請在指令中明確寫出要轉換成 JavaScript、Python、Java、Go 等語言。')
    const contextBundle = await buildContextBundle([], {
      includeConversation: true,
      excludePaths: [sourceFile],
      maxChars: 20000,
      maxCharsPerFile: 10000,
    })
    const data = await apiPost('/api/ai/convert', {
      file_path: sourceFile,
      instruction,
      code: sourceCode,
      context_files: contextBundle.files,
      target_language: target,
    })
    if (data.ok === false) throw new Error(data.content || data.error || '轉換失敗')
    
    if (data.files && data.files.length > 0) {
      fileChanges.value = []
      for (const file of data.files) {
        applyNewContentToLocalEditor(file.path, file.content, { dirty: true })
        fileChanges.value.push({ path: file.path, status: 'created', description: 'AI 轉換的新檔案' })
      }
      chatMessages.value.push({
        role: 'assistant',
        content: formatModelResponse(`已成功將程式碼轉換並拆分為 ${data.files.length} 個檔案！請查看左側檔案總管。`, data)
      })
      return
    }

    const convertedCode = data.new_content || data.generated_code || extractGeneratedCode(data.content || '')
    let writeNote = ''
    if (convertedCode && sourceFile) {
      const targetFile = data.converted_files?.[0] || convertedFilePath(sourceFile, data.target_language || target)
      stageGeneratedContentDiff(targetFile, convertedCode, instruction, data.source || 'convert')
      writeNote = `\n\n已將轉換結果放到 ${targetFile} 的修改差異，原始檔未修改；確認後請按「套用變更」。`
    }
    chatMessages.value.push({ role: 'assistant', content: formatModelResponse((data.content || '已完成語言轉換。') + writeNote, data) })
  } catch (err) {
    addAssistantError(`程式語言轉換失敗：${err.message}`)
  } finally {
    loading.chat = false
    await loadAuditLogs()
    await refreshHealth()
  }
}

async function detectCode(instruction, options = {}) {
  loading.chat = true
  try {
    const targetScope = withCurrentFileDetectionTarget(instruction, options.targetFiles)
    const contextBundle = await buildContextBundle(targetScope.targetFiles, {
      onlyPaths: true,
      includeConversation: false,
    })
    const codePayload = targetScope.hasMultipleTargets ? '' : (selectedCode.value || fileContent.value)
    const data = await apiPost('/api/ai/detect', {
      file_path: targetScope.targetFiles.join(', ') || activeFile.value,
      instruction: targetScope.instruction,
      code: codePayload,
      context: [codePayload, contextBundle.text].filter(Boolean).join('\n\n'),
      context_files: contextBundle.files,
      scope: targetScope.hasMultipleTargets ? 'explicit_files' : 'current_file',
    })
    if (data.ok === false) throw new Error(data.content || data.error || '偵測失敗')
    chatMessages.value.push({ role: 'assistant', content: formatModelResponse(data.content || '已完成錯誤偵測。', data) })
  } catch (err) {
    addAssistantError(`錯誤偵測失敗：${err.message}`)
  } finally {
    loading.chat = false
    await loadAuditLogs()
    await refreshHealth()
  }
}

async function askRewriteAdvice(instruction, options = {}) {
  loading.chat = true
  try {
    const targetScope = withOpenEditorTargets(instruction, options.actionLabel || '程式碼改寫建議', options.targetFiles)
    const contextBundle = await buildContextBundle(targetScope.targetFiles)
    const codePayload = targetScope.hasMultipleTargets ? '' : (selectedCode.value || fileContent.value)
    const data = await apiPost('/api/ai/rewrite-advice', {
      file_path: targetScope.targetFiles.join(', ') || activeFile.value,
      instruction: targetScope.instruction,
      code: codePayload,
      context: [codePayload, contextBundle.text].filter(Boolean).join('\n\n'),
      context_files: contextBundle.files,
    })
    if (data.ok === false) throw new Error(data.content || data.error || '改寫建議失敗')
    chatMessages.value.push({ role: 'assistant', content: formatModelResponse(data.content || '已完成程式碼改寫建議。', data) })
  } catch (err) {
    addAssistantError(`程式碼改寫建議失敗：${err.message}`)
  } finally {
    loading.chat = false
    await loadAuditLogs()
    await refreshHealth()
  }
}

async function askTestAdvice(instruction, options = {}) {
  loading.chat = true
  openResultTab('test')
  try {
    const targetScope = withOpenEditorTargets(instruction, options.actionLabel || '測試案例', options.targetFiles)
    const contextBundle = await buildContextBundle(targetScope.targetFiles)
    const codePayload = targetScope.hasMultipleTargets ? '' : (selectedCode.value || fileContent.value)
    const data = await apiPost('/api/ai/test-advice', {
      file_path: targetScope.targetFiles.join(', ') || activeFile.value,
      instruction: targetScope.instruction,
      code: codePayload,
      context: [codePayload, contextBundle.text].filter(Boolean).join('\n\n'),
      context_files: contextBundle.files,
    })
    if (data.ok === false) throw new Error(data.content || data.error || '測試案例產生失敗')
    testResult.value = {
      type: data.type || 'test_case_advice',
      ok: true,
      command: 'pytest case advice',
      passed: 1,
      failed: 0,
      total: 1,
      elapsed: 0,
      stdout: data.content || '已產生測試案例建議。',
      stderr: '',
      agentMessage: data.content || '已產生測試案例建議。',
    }
    chatMessages.value.push({ role: 'assistant', content: formatModelResponse(data.content || '已完成測試案例設計。', data) })
  } catch (err) {
    addAssistantError(`測試案例失敗：${err.message}`)
  } finally {
    loading.chat = false
    await loadAuditLogs()
    await refreshHealth()
  }
}

async function askExplain(question, options = {}) {
  loading.chat = true
  try {
    const isAnalysis = options.actionLabel === '專案檔案分析' || options.actionLabel === '程式分析' || options.actionLabel === '檔案分析'
    const referencedPaths = resolveRequestedWorkspacePaths(question, workspaceFilePaths())
    const wantsProjectScope = /(?:整(?:體|個)(?:專案|系統|項目)?|所有檔案|全域|全案|全部檔案)/.test(String(question || ''))
    const defaultExplainFiles = [normalizeLocalPath(activeFile.value)].filter(Boolean)
    const openFiles = Array.isArray(options.targetFiles)
      ? options.targetFiles
      : (wantsProjectScope ? getOpenTaskFiles() : (openEditorFiles.value.length ? openEditorFiles.value : defaultExplainFiles))
    if (isAnalysis && openFiles.length === 0 && referencedPaths.length === 0) {
      addAssistantError('尚未在檔案總管開啟任何檔案。請先在檔案總管開啟要分析的檔案，或用 @檔名 指定分析目標。')
      return
    }
    const workspaceAnalysisPaths = (isAnalysis && wantsProjectScope && openFiles.length > 0) ? selectAnalysisWorkspaceFiles(files.value) : []
    const explicitTargets = getUniquePaths([
      ...openFiles,
      ...referencedPaths,
      ...workspaceAnalysisPaths,
    ]).slice(0, isAnalysis ? ANALYSIS_MAX_FILES : CONTEXT_MAX_FILES)
    const targetScope = withOpenEditorTargets(question, options.actionLabel || '程式說明', explicitTargets)
    const contextBundle = await buildContextBundle(targetScope.targetFiles, {
      onlyPaths: !wantsProjectScope,
      includeConversation: !isAnalysis,
      maxChars: isAnalysis ? 180000 : undefined,
      maxCharsPerFile: isAnalysis ? 12000 : undefined,
    })
    const data = await apiPost('/api/ai/explain', {
      file_path: targetScope.targetFiles.join(', ') || activeFile.value,
      question: targetScope.instruction,
      code: targetScope.hasMultipleTargets ? '' : fileContent.value,
      selected_code: targetScope.hasMultipleTargets ? '' : selectedCode.value,
      pinned_files: pinnedContextFiles.value,
      context_files: contextBundle.files,
      mode: isAnalysis ? 'analysis' : 'explanation',
      scope: wantsProjectScope ? 'project' : (targetScope.hasMultipleTargets ? 'explicit_files' : 'current_file'),
    })
    if (data.ok === false) throw new Error(data.content || data.answer || '本機模型未連線')
    chatMessages.value.push({ role: 'assistant', content: formatModelResponse(data.content || data.answer || '已完成程式說明。', data) })
  } catch (err) {
    addAssistantError(formatAiChatError(err))
  } finally {
    loading.chat = false
    await loadAuditLogs()
    await refreshHealth()
  }
}


function buildGeneratedTestPath(sourcePath) {
  const clean = normalizeLocalPath(sourcePath || activeFile.value || 'current_file.py')
  const fileName = clean.split('/').pop() || 'current_file.py'
  const stem = fileName.replace(/\.[^.]+$/g, '').replace(/[^A-Za-z0-9_]/g, '_') || 'current_file'
  const lower = clean.toLowerCase()
  if (/\.(js|jsx|ts|tsx|vue)$/.test(lower)) return `tests/${stem}.test.js`
  return `tests/test_${stem}.py`
}

async function generateTestsForCurrentFile(instruction) {
  const sourcePath = activeFile.value || ''
  if (!sourcePath) {
    addAssistantError('請先開啟任一可測試的檔案，再產生測試。')
    return
  }
  const targetPath = buildGeneratedTestPath(sourcePath)
  const sourceCode = String(fileContent.value || '')
  const fullInstruction = `${instruction}

Source file: ${sourcePath}

Source code:
\`\`\`${sourcePath.toLowerCase().match(/\.(js|jsx|ts|tsx|vue)$/) ? 'javascript' : 'python'}
${sourceCode}
\`\`\``
  return generateDiff(fullInstruction, targetPath, { code: '' })
}

async function generateDiff(instruction, explicitTargetFile = null, options = {}) {
  loading.result = true
  loading.chat = true
  openResultTab('diff')

  const targetFile = explicitTargetFile || getDiffTargetFile(activeFile.value)
  if (!targetFile) {
    loading.result = false
    loading.chat = false
    addAssistantError('請先從左側檔案總管開啟要修改的檔案。')
    return
  }

  chatMessages.value.push({
    role: 'assistant',
    content: `正在呼叫後端產生修改差異：${instruction}`
  })

  try {
    const contextBundle = await buildContextBundle([targetFile])
    const payload = {
      file_path: targetFile,
      instruction,
      context_files: contextBundle.files
    }

    // Fix Issues / Refactor 要以目前 Monaco Editor 看到的內容為準。
    // 若 targetFile 是目前開啟檔案，就把畫面內容一起送到後端，避免後端讀到舊檔案而回 no_change。
    // Generate Tests 可指定空字串，讓後端以「新增測試檔」方式產生修改差異。
    if (Object.prototype.hasOwnProperty.call(options, 'code')) {
      payload.code = options.code
    } else if (targetFile === activeFile.value) {
      payload.code = fileContent.value
    }

    const data = await withTimeout(
      apiPost('/api/diff/generate', payload),
      MODEL_REQUEST_TIMEOUT_MS,
      '後端產生修改差異逾時'
    )

    if (data.no_change) {
      diffText.value = ''
      diffInfo.value = null
      pendingNewContent.value = ''
      pendingDiffFilePath.value = ''
      pendingExtraFiles.value = []
      pendingAgentApproval.value = false
      agentSteps.value = []
      chatMessages.value.push({
        role: 'assistant',
        content: `目前檔案已符合這個需求，沒有新的可套用修改差異。${data.error ? '原因：' + data.error : ''}`
      })
      return
    }

    if (data.ok === false || !data.diff) {
      throw new Error(data.content || data.error || '未產生修改差異，請確認本機模型是否已連線')
    }

    diffText.value = data.diff
    diffInfo.value = {
      instruction,
      filePath: payload.targetOnly ? targetFile : (data.file_path || targetFile),
      source: data.source || 'backend',
      model: data.model || 'local_ollama',
      tokens: data.tokens ?? 0,
      note: data.note || ''
    }
    pendingNewContent.value = data.new_content || ''
    if (!pendingNewContent.value) {
      throw new Error('後端已產生修改差異，但沒有回傳可套用的新檔案內容')
    }
    pendingDiffFilePath.value = data.file_path || extractDiffTargetFile(data.diff, targetFile)
    pendingAgentApproval.value = false
    agentSteps.value = []

    chatMessages.value.push({
      role: 'assistant',
      content: `已由 ${data.source || 'backend'} 產生修改差異。目標檔案：${pendingDiffFilePath.value}。請確認後再按「套用變更」。`
    })
  } catch (err) {
    diffText.value = ''
    diffInfo.value = null
    pendingNewContent.value = ''
    pendingDiffFilePath.value = ''
    pendingAgentApproval.value = false
    agentSteps.value = []

    addAssistantError(`產生修改差異失敗：${err.message}`)
  } finally {
    loading.result = false
    loading.chat = false

    // 這兩個只是狀態更新，不要阻塞畫面。
    loadAuditLogs().catch(() => {})
    refreshHealth().catch(() => {})
  }
}


function isLocalWorkspaceTarget(filePath) {
  const target = canonicalWorkspacePath(filePath || '')
  if (!target) return false
  if (workspaceSource.value === 'backend') return false
  return workspaceSource.value !== 'none' || localFileMap.value.has(target) || localFileHandleMap.value.has(target) || editedLocalContentMap.value.has(target)
}

function applyNewContentToLocalEditor(filePath, newContent, options = {}) {
  const target = canonicalWorkspacePath(filePath || activeFile.value || 'current_file.py')
  if (!target) return false
  const dirty = options.dirty ?? true
  upsertExplorerItem(target, 'file')
  openEditorTab(target)
  activeFile.value = target
  fileContent.value = newContent
  if (dirty) {
    editedLocalContentMap.value.set(target, newContent)
    setEditorDraft(target, newContent)
  } else {
    editedLocalContentMap.value.delete(target)
    clearEditorDraft(target)
  }
  setFileDirty(target, dirty)
  ghostText.value = ''
  return true
}

async function getOrCreateLocalFileHandle(path) {
  const cleanPath = canonicalWorkspacePath(path)
  if (!cleanPath || !directoryHandleRef.value) return null

  const existing = localFileHandleMap.value.get(cleanPath)
  if (existing) return existing

  const parts = cleanPath.split('/').filter(Boolean)
  if (!parts.length) return null

  let currentDir = directoryHandleRef.value
  for (const folderName of parts.slice(0, -1)) {
    currentDir = await currentDir.getDirectoryHandle(folderName, { create: true })
  }

  const fileHandle = await currentDir.getFileHandle(parts[parts.length - 1], { create: true })
  localFileHandleMap.value.set(cleanPath, fileHandle)
  return fileHandle
}

async function writeLocalFileContent(filePath, newContent) {
  const target = canonicalWorkspacePath(filePath)
  if (!target || workspaceSource.value !== 'local-handle') return false
  if (isDatabasePath(target)) throw new Error('資料庫 .db/.sqlite 不可用文字方式寫入；請產生 .sql migration / query 檔。')

  const fileHandle = await getOrCreateLocalFileHandle(target)
  if (!fileHandle) return false

  const ok = await verifyFilePermission(fileHandle)
  if (!ok) throw new Error('沒有本機檔案寫入權限')

  const writable = await fileHandle.createWritable()
  await writable.write(newContent)
  await writable.close()

  const savedFile = await fileHandle.getFile()
  const savedContent = await readBrowserFileAsContext(target, savedFile)
  if (savedContent !== String(newContent ?? '')) throw new Error('本機檔案寫入後讀回內容不一致')

  editedLocalContentMap.value.delete(target)
  localFileMap.value.delete(target)
  upsertExplorerItem(target, 'file')
  return true
}

async function runTestsForEditorCode(task, filePath, code, options = {}) {
  const targetFiles = getUniquePaths([
    filePath,
    ...(options.validateEveryTarget === true && Array.isArray(options.targetFiles) ? options.targetFiles : []),
  ])
  const contextFiles = options.projectWide
    ? await buildTestContextFilesForTargets(workspaceFilePaths())
    : await buildTestContextFilesForTargets(targetFiles)
  const data = await withTimeout(
    apiPost('/api/agent/run-tests', {
      task,
      file_path: filePath,
      code,
      context_files: contextFiles,
      target_files: targetFiles,
      validate_every_target: options.validateEveryTarget === true,
      workspace_source: workspaceSource.value,
      project_id: ensureSandboxProjectId(),
      project_name: projectName.value || 'project',
      prefer_project_tests: true,
      mode: options.projectWide ? 'fix_error' : '',
      project_wide: options.projectWide === true,
      target_only: options.targetOnly === true,
    }),
    TEST_RUN_TIMEOUT_MS,
    '執行測試逾時，可能仍在安裝 Python / Node 依賴；請稍後查看結果或重新執行。'
  )
  const stdout = data.test?.stdout || ''
  const stderr = data.test?.stderr || ''
  const passed = Number(data.passed ?? data.test?.passed ?? 0)
  const failed = Number(data.failed ?? data.test?.failed ?? 0)
  const total = Number(data.total ?? data.test?.total ?? (passed + failed))
  return {
    type: data.type || 'agent_test_only',
    ok: data.ok === true,
    command: data.test?.command || 'pytest -q',
    testKind: data.test?.kind || 'pytest',
    messages: data.test?.messages || [],
    passed,
    failed,
    total,
    exitCode: data.test?.exitCode ?? data.test?.returncode ?? null,
    returncode: data.test?.returncode ?? data.test?.exitCode ?? null,
    elapsed: data.test?.elapsed_seconds ?? 0,
    stdout,
    stderr,
    sandbox: data.test?.sandbox || data.sandbox || null,
    environmentBlocked: data.environment_blocked === true || data.test?.environment_blocked === true,
    validationLimited: data.validation_limited === true || data.test?.validation_limited === true,
    targetFile: data.test?.target_file || filePath,
    targetOnly: data.test?.target_only === true,
    targetRuntimeValidated: data.test?.target_runtime_validated === true,
    targetImplementationValidated: data.test?.target_implementation_validated === true,
    targetStdout: data.test?.target_stdout || '',
    targetStderr: data.test?.target_stderr || '',
    applied: true,
    filePath,
    agentMessage: data.content || '已使用目前編輯器內容執行測試。',
    steps: data.steps || [],
    commands: data.test?.commands || [data.test?.command].filter(Boolean),
    checks: data.test?.checks || [],
    testResults: data.test?.results || [],
  }
}

async function captureLocalChangeSnapshots(paths = []) {
  const snapshots = []
  for (const path of getUniquePaths(paths)) {
    const existing = await readWorkspaceExistingForChange(path)
    snapshots.push({ path: normalizeLocalPath(path), existed: existing.exists, content: String(existing.content || '') })
  }
  return snapshots
}

async function rollbackLocalChanges(snapshots = []) {
  const restored = []
  for (const snapshot of [...snapshots].reverse()) {
    try {
      if (snapshot.existed) {
        const wrote = await writeLocalFileContent(snapshot.path, snapshot.content)
        if (!wrote) editedLocalContentMap.value.set(snapshot.path, snapshot.content)
        setEditorDraft(snapshot.path, snapshot.content)
        setFileDirty(snapshot.path, !wrote)
      } else {
        if (workspaceSource.value === 'local-handle' && directoryHandleRef.value) {
          await removeLocalEntryByPath(snapshot.path)
        }
        editedLocalContentMap.value.delete(snapshot.path)
        localFileMap.value.delete(snapshot.path)
        localFileHandleMap.value.delete(snapshot.path)
        clearEditorDraft(snapshot.path)
        setFileDirty(snapshot.path, false)
        removeExplorerItem(snapshot.path)
      }
      if (activeFile.value === snapshot.path) fileContent.value = snapshot.content
      restored.push(snapshot.path)
    } catch {
      // 回報實際恢復數量，不把部分失敗誤報成完整 rollback。
    }
  }
  return restored
}

async function applyDiff(options = {}) {
  if (!pendingNewContent.value) {
    addAssistantError('目前沒有可套用的新檔案內容。')
    return
  }

  const rawTargetFile =
    pendingDiffFilePath.value ||
    extractDiffTargetFile(diffText.value, activeFile.value)
  const targetFile = canonicalWorkspacePath(rawTargetFile)

  loading.result = true
  await updatePendingDiffHistoryStatus('applying', '使用者已按下套用變更。')

  try {
    if (isLocalWorkspaceTarget(targetFile)) {
      if (pendingAgentApproval.value && workspaceSource.value !== 'local-handle') {
        addAssistantError('目前工作區沒有本機資料夾寫入權限，不能確認套用成已修正。請用支援資料夾權限的 Chrome / Edge 按左側 📁 重新開啟專案資料夾；修改差異已保留，尚未寫入磁碟。')
        openResultTab('diff')
        return
      }
      const changeSnapshots = pendingAgentApproval.value
        ? await captureLocalChangeSnapshots([targetFile, ...pendingExtraFiles.value.map(item => canonicalWorkspacePath(item.path))])
        : []
      let wroteLocalFile = false
      try {
        wroteLocalFile = await writeLocalFileContent(targetFile, pendingNewContent.value)
        upsertExplorerItem(targetFile, 'file')
      } catch (writeErr) {
        addAssistantError(`本機檔案寫回失敗，已先套用到編輯器：${writeErr.message}`)
      }

      applyNewContentToLocalEditor(targetFile, pendingNewContent.value, { dirty: !wroteLocalFile })
      if (wroteLocalFile) {
        editedLocalContentMap.value.delete(canonicalWorkspacePath(targetFile))
        isDirty.value = false
      }

      if (pendingAgentApproval.value) {
        for (const extraFile of pendingExtraFiles.value) {
          const extraPath = canonicalWorkspacePath(extraFile.path)
          const extraContent = String(extraFile.content || '')
          if (!extraPath) continue
          try {
            const wroteExtraFile = await writeLocalFileContent(extraPath, extraContent)
            if (wroteExtraFile) editedLocalContentMap.value.delete(extraPath)
            else editedLocalContentMap.value.set(extraPath, extraContent)
            
            if (extraPath === activeFile.value) {
              fileContent.value = extraContent
            }
            
            setEditorDraft(extraPath, extraContent)
            setFileDirty(extraPath, !wroteExtraFile)
            upsertExplorerItem(extraPath, 'file')
          } catch (writeErr) {
            addAssistantError(`檔案 ${extraPath} 寫回失敗：${writeErr.message}`)
          }
        }
        const appliedTargetFiles = [targetFile, ...pendingExtraFiles.value.map(item => canonicalWorkspacePath(item.path))]
        testResult.value = await runTestsForEditorCode('使用者確認後，逐檔以目前編輯器內容執行測試驗證', targetFile, pendingNewContent.value, {
          projectWide: options?.projectWide === true,
          targetOnly: options?.targetOnly === true,
          targetFiles: appliedTargetFiles,
          validateEveryTarget: options?.projectWide !== true,
        })
        if (!testResult.value.ok) {
          const blockReason = testFailureRepairBlockReason(testResult.value)
          if (blockReason) {
            testResult.value.autoFixStopped = true
            testResult.value.validationLimited = true
            testResult.value.applied = true
            testResult.value.agentMessage = `已套用修改，但完整驗證受環境限制：${blockReason}`
            commandLogs.value = [
              ...commandLogs.value.filter(Boolean),
              { time: '套用', command: `write file ${targetFile}`, status: wroteLocalFile ? 'done' : 'pending', statusLabel: wroteLocalFile ? '已寫回本機' : '已套用到編輯器' },
              { time: '驗證', command: testResult.value.command, status: 'done', statusLabel: '有限驗證；停止自動回修' },
            ]
            fileChanges.value = [
              { path: targetFile, status: 'modified', description: '已套用修改；完整 runtime 驗證受環境限制' },
              ...pendingExtraFiles.value.map(item => ({
                path: canonicalWorkspacePath(item.path),
                status: item.status || 'modified',
                description: item.description || 'AI 同次產生的多檔修正',
              })),
            ]
            agentSteps.value = [
              { label: '1 套用修改', status: 'done', detail: compactPathList(changeSnapshots.map(item => item.path)) },
              { label: '2 執行驗證', status: 'done', detail: 'Docker 沙盒環境限制，停止重複自動修正' },
              { label: '3 保留修改', status: 'done', detail: '未 rollback；請在可連網或具備依賴的環境重測完整 runtime' },
            ]
            openTestResultTabUnlessEnvironmentBlocked(testResult.value, 'editor')
            chatMessages.value.push({
              role: 'assistant',
              content: `已套用修改，但完整驗證受環境限制，系統不會繼續重複自動修正。\n${blockReason}`,
            })
            await updatePendingDiffHistoryStatus('validation_limited', blockReason, { test_ok: false, applied: true })
            diffText.value = ''
            diffInfo.value = null
            pendingNewContent.value = ''
            pendingDiffFilePath.value = ''
            pendingExtraFiles.value = []
            pendingAgentApproval.value = false
            return
          }
          const attempt = (options.autoRepairAttempt || 0) + 1
          if (attempt <= 3) {
            chatMessages.value.push({
              role: 'assistant',
              content: `套用後測試未通過 (嘗試 ${attempt}/3)。系統將保留目前修改，並根據新錯誤再次進行自動修正...`,
            })
            await updatePendingDiffHistoryStatus('applied', `已套用；測試失敗後進入第 ${attempt} 次自動修正。`, { test_ok: false, auto_repair_attempt: attempt })
            diffText.value = ''
            diffInfo.value = null
            pendingNewContent.value = ''
            pendingDiffFilePath.value = ''
            pendingExtraFiles.value = []
            pendingAgentApproval.value = false
            
            await runInlineCommand({
              action: 'fix',
              label: `自動修正測試錯誤 (第 ${attempt} 次重試)`,
              instruction: buildAutomaticTestRepairInstruction(options.instruction || '錯誤修正', testResult.value),
              selectedCode: '',
              content: '',
              filePath: targetFile,
              targetFiles: appliedTargetFiles,
              autoApply: true,
              autoRepairAttempt: attempt,
              projectWideFix: options.projectWide === true,
              targetOnly: options.targetOnly === true,
              testFailureFix: true,
              previousFailureFingerprint: buildTestFailureFingerprint(testResult.value),
            })
            return
          }

          const restoredFiles = await rollbackLocalChanges(changeSnapshots)
          testResult.value.rolledBack = true
          testResult.value.restoredFiles = restoredFiles
          testResult.value.applied = false
          commandLogs.value = [
            ...commandLogs.value.filter(Boolean),
            { time: '測試', command: testResult.value.command, status: 'failed', statusLabel: '測試失敗' },
            { time: '回復', command: `rollback ${restoredFiles.join(' ')}`, status: restoredFiles.length === changeSnapshots.length ? 'done' : 'failed', statusLabel: '已自動回復' },
          ]
          fileChanges.value = restoredFiles.map(path => ({ path, status: 'rolled-back', description: '測試失敗，已恢復套用前內容' }))
          agentSteps.value = [
            { label: '1 套用修改', status: 'done', detail: compactPathList(changeSnapshots.map(item => item.path)) },
            { label: '2 執行測試', status: 'failed', detail: testResult.value.command },
            { label: '3 自動 rollback', status: restoredFiles.length === changeSnapshots.length ? 'done' : 'failed', detail: `已恢復 ${restoredFiles.length}/${changeSnapshots.length} 個檔案` },
          ]
          openResultTab('test')
          chatMessages.value.push({
            role: 'assistant',
            content: `套用後測試未通過，系統已自動回復 ${restoredFiles.length}/${changeSnapshots.length} 個檔案；原修改差異未保留為已套用狀態。`,
          })
          await updatePendingDiffHistoryStatus('rolled_back', '套用後測試失敗，已自動回復原內容。', { restored_files: restoredFiles })
          diffText.value = ''
          diffInfo.value = null
          pendingNewContent.value = ''
          pendingDiffFilePath.value = ''
          pendingExtraFiles.value = []
          pendingAgentApproval.value = false
          return
        }
        const appliedExtraFiles = pendingExtraFiles.value.map(item => ({
          path: canonicalWorkspacePath(item.path),
          kind: item.kind || 'source',
          description: item.description || 'AI 同次產生的多檔修正',
          status: item.status || 'modified'
        }))
        if (appliedExtraFiles.length) {
          createdFiles.value = appliedExtraFiles
          testResult.value.extraFiles = appliedExtraFiles
        }
        commandLogs.value = [
          ...commandLogs.value.filter(Boolean),
          { time: '套用', command: `write file ${targetFile}`, status: wroteLocalFile ? 'done' : 'pending', statusLabel: wroteLocalFile ? '已寫回本機' : '已套用到編輯器' },
          { time: '測試', command: testResult.value.command, status: testResult.value.ok ? 'done' : 'failed', statusLabel: testResult.value.ok ? '測試通過' : '測試失敗' }
        ]
        fileChanges.value = [
          { path: targetFile, status: 'modified', description: '已依 AI Diff 套用修改' },
          ...appliedExtraFiles
        ]
        agentSteps.value = testResult.value.steps?.length ? testResult.value.steps : [
          { label: '1 讀檔', status: 'done', detail: `已使用目前編輯器內容：${targetFile}` },
          { label: '2 產生修改建議', status: 'done', detail: '修改差異已在套用前產生' },
          { label: '3 產生修改差異', status: 'done', detail: '修改差異已產生' },
          { label: '4 套用', status: 'done', detail: '已套用到目前的程式碼編輯器；請按 Ctrl+S 儲存本機檔案' },
          { label: '5 執行測試', status: testResult.value.ok ? 'done' : 'failed', detail: testResult.value.command },
          { label: '6 顯示結果', status: testResult.value.ok ? 'done' : 'failed', detail: '結果已顯示在測試 / AI 執行結果分頁' }
        ]
        openResultTab('test')
        chatMessages.value.push({
          role: 'assistant',
          content: wroteLocalFile
              ? `已一次套用並寫回本機檔案：${compactPathList([targetFile, ...appliedExtraFiles.map(item => item.path)])}。${testResult.value.agentMessage}`
              : `已套用到目前編輯器 ${targetFile}。${testResult.value.agentMessage} 請確認後自行 Ctrl+S 儲存。`
        })
      } else {
        openResultTab('diff')
        chatMessages.value.push({
          role: 'assistant',
          content: wroteLocalFile
              ? `已套用變更並寫回本機檔案 ${targetFile}。`
              : `已套用到目前編輯器 ${targetFile}。請確認後自行 Ctrl+S 儲存。`
        })
      }

      await updatePendingDiffHistoryStatus('applied', wroteLocalFile ? '已套用並寫回本機檔案。' : '已套用到編輯器，等待使用者儲存。', { wrote_local_file: wroteLocalFile })
      diffText.value = ''
      diffInfo.value = null
      pendingNewContent.value = ''
      pendingDiffFilePath.value = ''
      pendingExtraFiles.value = []
      pendingAgentApproval.value = false
      loadAuditLogs().catch(() => {})
      return
    }

    if (pendingAgentApproval.value) {
      const data = await withTimeout(
        apiPost('/api/agent/apply-and-test', {
          file_path: targetFile,
          new_content: pendingNewContent.value,
          extra_files: pendingExtraFiles.value
        }),
        AGENT_APPLY_AND_TEST_TIMEOUT_MS,
        'AI 套用變更與執行測試逾時，後端可能仍在處理；請稍後查看操作紀錄或重新整理。'
      )

      if (data.applied === false) {
        if (data.rolled_back) {
          const restoredFiles = data.restored_files || []
          testResult.value = {
            type: data.type || 'agent_apply_and_test',
            ok: false,
            command: data.test?.command || 'apply-and-test',
            passed: Number(data.passed || 0),
            failed: Number(data.failed || 1),
            total: Number(data.total || 1),
            stdout: data.test?.stdout || '',
            stderr: data.test?.stderr || data.content || '',
            rolledBack: true,
            restoredFiles,
            applied: false,
            agentMessage: data.content,
          }
          fileChanges.value = restoredFiles.map(path => ({ path, status: 'rolled-back', description: '套用或測試失敗，已回復原內容' }))
          agentSteps.value = data.steps || [
            { label: '1 套用修改', status: 'failed', detail: data.content },
            { label: '2 自動 rollback', status: 'done', detail: `已恢復 ${restoredFiles.length} 個檔案` },
          ]
          diffText.value = ''
          diffInfo.value = null
          pendingNewContent.value = ''
          pendingDiffFilePath.value = ''
          pendingExtraFiles.value = []
          pendingAgentApproval.value = false
          openResultTab('test')
          chatMessages.value.push({ role: 'assistant', content: data.content || '套用失敗，已自動回復原始檔案。' })
          await updatePendingDiffHistoryStatus('rolled_back', data.content || '套用失敗，已自動回復原始檔案。', { restored_files: restoredFiles })
          return
        }
        throw new Error(data.apply?.error || data.content || 'AI 套用變更失敗')
      }

      const readResult = await withTimeout(
        apiPost('/api/files/read', {
          file_path: targetFile
        }),
        8000,
        '重新讀取檔案逾時'
      )

      const stdout = data.test?.stdout || ''
      const stderr = data.test?.stderr || ''
      const passed = Number(data.passed ?? 0)
      const failed = Number(data.failed ?? 0)
      const total = Number(data.total ?? (passed + failed))

      activeFile.value = targetFile
      fileContent.value = readResult.content ?? pendingNewContent.value
      markFileSaved(targetFile, fileContent.value, { updateBackendCache: true })
      ghostText.value = ''

      agentSteps.value = data.steps || agentSteps.value

      testResult.value = {
        type: data.type || 'agent_apply_and_test',
        ok: data.ok === true,
        command: data.test?.command || 'pytest -q',
        testKind: data.test?.kind || 'pytest',
        messages: data.test?.messages || [],
        passed,
        failed,
        total,
        exitCode: data.test?.exitCode ?? data.test?.returncode ?? null,
        returncode: data.test?.returncode ?? data.test?.exitCode ?? null,
        elapsed: data.test?.elapsed_seconds ?? 0,
        stdout,
        stderr,
        sandbox: data.test?.sandbox || data.sandbox || null,
        environmentBlocked: data.environment_blocked === true || data.test?.environment_blocked === true,
        validationLimited: data.validation_limited === true || data.test?.validation_limited === true,
        applied: data.applied === true,
        extraFiles: data.extra_files || [],
        filePath: data.file_path || targetFile,
        agentMessage: data.content || '使用者確認後已套用變更並執行測試。',
        steps: data.steps || [],
        testResults: data.test?.results || []
      }
      createdFiles.value = (data.extra_files || []).map(item => ({
        path: normalizeLocalPath(item.path),
        kind: item.kind || 'source',
        description: item.description || 'AI 同次產生的多檔修正',
        status: item.status || 'modified'
      }))
      commandLogs.value = [
        ...commandLogs.value.filter(Boolean),
        { time: '套用', command: `POST /api/agent/apply-and-test ${targetFile}`, status: data.applied ? 'done' : 'failed', statusLabel: data.applied ? '已套用' : '套用失敗' },
        { time: '測試', command: testResult.value.command, status: testResult.value.ok ? 'done' : 'failed', statusLabel: testResult.value.ok ? '測試通過' : '測試失敗' }
      ]
      fileChanges.value = [
        { path: targetFile, status: 'modified', description: '已由 Agent 套用主要檔案修改' },
        ...createdFiles.value
      ]

      await updatePendingDiffHistoryStatus(data.validation_limited ? 'validation_limited' : 'applied', data.content || '已由 Agent 套用變更並執行測試。', { test_ok: data.ok === true, applied: data.applied === true })
      diffText.value = ''
      diffInfo.value = null
      pendingNewContent.value = ''
      pendingDiffFilePath.value = ''
      pendingExtraFiles.value = []
      pendingAgentApproval.value = false

      openTestResultTabUnlessEnvironmentBlocked(testResult.value, 'editor')

      chatMessages.value.push({
        role: 'assistant',
        content: data.content || `已確認套用變更並執行測試：通過 ${passed}，失敗 ${failed}。`
      })
      return
    }

    const applyResult = await withTimeout(
      apiPost('/api/diff/apply', {
        file_path: targetFile,
        new_content: pendingNewContent.value
      }),
      8000,
      '套用修改差異逾時'
    )

    if (applyResult.ok === false) {
      throw new Error(applyResult.error || '後端套用失敗')
    }

    const readResult = await withTimeout(
      apiPost('/api/files/read', {
        file_path: targetFile
      }),
      8000,
      '重新讀取檔案逾時'
    )

    activeFile.value = targetFile
    fileContent.value = readResult.content ?? pendingNewContent.value
    markFileSaved(targetFile, fileContent.value, { updateBackendCache: true })
    openEditorTab(targetFile)

    await updatePendingDiffHistoryStatus('applied', '已套用變更並重新讀取正式專案檔案。', { applied: true })
    diffText.value = ''
    diffInfo.value = null
    pendingNewContent.value = ''
    pendingDiffFilePath.value = ''
    pendingExtraFiles.value = []
    pendingAgentApproval.value = false
    agentSteps.value = []
    ghostText.value = ''

    openResultTab('audit')

    chatMessages.value.push({
      role: 'assistant',
      content: `已套用變更並重新讀取 ${targetFile}。`
    })
  } catch (err) {
    await updatePendingDiffHistoryStatus('failed', err.message, { applied: false })
    addAssistantError(`套用修改差異失敗：${err.message}`)
  } finally {
    loading.result = false

    // 操作紀錄只是更新紀錄，不要讓它卡住按鈕狀態。
    loadAuditLogs().catch(() => {})
  }
}

async function cancelDiff() {
  await updatePendingDiffHistoryStatus('cancelled', '使用者取消本次修改差異，未寫入檔案。', { applied: false })
  diffText.value = ''
  diffInfo.value = null
  createdFiles.value = []
  commandLogs.value = []
  fileChanges.value = []
  pendingNewContent.value = ''
  pendingDiffFilePath.value = ''
  pendingExtraFiles.value = []
  pendingAgentApproval.value = false
  agentSteps.value = []
  openResultTab('diff')
}

async function runTests() {
  if (!(await ensureActiveFileForTask('執行測試'))) return
  const previousWorkbenchTab = activeWorkbenchTab.value
  loading.result = true
  try {
    // The Test action follows the file selected in Explorer/Monaco. Other
    // workspace files are still staged as read-only test context below, but
    // they must not silently become repair targets when this test fails.
    const targetFiles = getUniquePaths([activeFile.value])
    const testInstruction = buildOpenEditorTargetInstruction('依專案類型執行測試並回報結果', targetFiles, '執行測試')
    const contextFiles = await buildTestContextFilesForTargets(targetFiles)
    const primaryFile = targetFiles[0] || activeFile.value
    const primaryCode = primaryFile && primaryFile === activeFile.value ? fileContent.value : undefined
    const data = await withTimeout(
      apiPost('/api/agent/run-tests', {
        task: testInstruction,
        file_path: primaryFile,
        code: primaryCode,
        context_files: contextFiles,
        workspace_source: workspaceSource.value,
        project_id: ensureSandboxProjectId(),
        project_name: projectName.value || 'project',
        prefer_project_tests: true,
      }),
      TEST_RUN_TIMEOUT_MS,
      '執行測試逾時，可能仍在安裝 Python / Node 依賴；請稍後查看結果或重新執行。'
    )
    const stdout = data.test?.stdout || ''
    const stderr = data.test?.stderr || ''
    const passed = Number(data.passed ?? data.test?.passed ?? (stdout.match(/(\d+) passed/) || [0, 0])[1])
    const failed = Number(data.failed ?? data.test?.failed ?? (stdout.match(/(\d+) failed/) || [0, 0])[1])
    const total = Number(data.total ?? data.test?.total ?? (passed + failed))
    testResult.value = {
      type: data.type || 'agent_test_only',
      ok: data.ok === true,
      command: data.test?.command || 'pytest -q',
      testKind: data.test?.kind || 'pytest',
      messages: data.test?.messages || [],
      passed,
      failed,
      total,
      exitCode: data.test?.exitCode ?? null,
      returncode: data.test?.returncode ?? data.test?.exitCode ?? null,
      elapsed: data.test?.elapsed_seconds ?? 0,
      stdout,
      stderr,
      sandbox: data.test?.sandbox || data.sandbox || null,
      environmentBlocked: data.environment_blocked === true || data.test?.environment_blocked === true,
      validationLimited: data.validation_limited === true || data.test?.validation_limited === true,
      targetFile: data.test?.target_file || primaryFile,
      filePath: primaryFile,
      targetFiles,
      agentMessage: data.content || ''
    }
    commandLogs.value = [
      { time: '測試', command: testResult.value.command, status: testResult.value.ok ? 'done' : 'failed', statusLabel: testResult.value.ok ? '測試通過' : '測試失敗' }
    ]
    fileChanges.value = targetFiles.map(path => ({ path, status: 'modified', description: '本次測試使用的開啟目標檔案' }))
    agentSteps.value = [
      { label: '1 讀取檔案', status: 'done', detail: targetFiles.length ? targetFiles.join('、') : primaryFile },
      { label: '2 選擇測試方式', status: 'done', detail: testResult.value.testKind || 'auto' },
      { label: '3 執行 command', status: testResult.value.ok ? 'done' : 'failed', detail: testResult.value.command },
      { label: '4 顯示結果', status: testResult.value.ok ? 'done' : 'failed', detail: `通過 ${passed}，失敗 ${failed}` }
    ]
    const blockReason = testFailureRepairBlockReason(testResult.value)
    openTestResultTabUnlessEnvironmentBlocked(testResult.value, previousWorkbenchTab)
    chatMessages.value.push({
      role: 'assistant',
      content: blockReason
        ? `${data.content || `系統已完成測試：通過 ${passed}，失敗 ${failed}。`}\n\n${blockReason}\n\n已保留在目前頁面；需要原始 stdout / stderr 時，可手動開啟「測試 / AI 執行結果」。`
        : data.content || `系統已完成測試：通過 ${passed}，失敗 ${failed}。`
    })
  } catch (err) {
    testResult.value = null
    addAssistantError(`執行測試失敗：${err.message}`)
  } finally {
    loading.result = false
    loadAuditLogs().catch(() => {})
  }
}

async function fixCurrentTestFailure() {
  const failedResult = testResult.value
  if (!failedResult || failedResult.ok) {
    addAssistantError('目前沒有可供自動修正的失敗測試。')
    return
  }
  if (failedResult.autoFixStopped) {
    addAssistantError('這次錯誤的自動修正已停止。請先手動調整或重新執行測試，取得新的失敗結果後再試。')
    return
  }
  const repairBlockReason = testFailureRepairBlockReason(failedResult)
  if (repairBlockReason) {
    failedResult.autoFixStopped = true
    failedResult.agentMessage = repairBlockReason
    chatMessages.value.push({ role: 'assistant', content: `未啟動程式碼自動修正：${repairBlockReason}` })
    openResultTab('test')
    return
  }
  const output = [failedResult.stderr, failedResult.stdout]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join('\n\n')
    .slice(-8000)
  const workspacePaths = workspaceFilePaths()
  const targetFile = selectTestFailureRepairTarget(failedResult, activeFile.value, workspacePaths)
  if (!targetFile) {
    addAssistantError('無法從這次失敗測試判斷要修正的檔案。')
    return
  }
  const tracebackPaths = extractWorkspaceFailurePaths(failedResult, workspacePaths)
  const readOnlyDependencies = tracebackPaths.filter(path => path !== targetFile)
  const targetContent = await readInlineTargetContent(
    targetFile,
    targetFile === activeFile.value ? fileContent.value : '',
  )
  const instruction = `請只修正這次失敗測試的主要目標檔案 ${targetFile}，並以實際 traceback 為依據做最小必要修改。其他檔案只能當作讀取上下文，不可扩大成全專案批次改寫；不可刪除、略過、弱化測試或用假 Mock 掩蓋錯誤。

原始失敗指令：${failedResult.command || 'project test'}

實際失敗輸出：
${output || '測試失敗，但沒有額外輸出。'}`
  chatMessages.value.push({
    role: 'assistant',
    content: `開始定向修正 ${targetFile}；${readOnlyDependencies.length ? `traceback 關聯檔案 ${readOnlyDependencies.join('、')} 只作為讀取上下文。` : '不會掃描或改寫整個專案。'}`,
  })
  await runInlineCommand({
    action: 'fix',
    label: '自動修正測試錯誤',
    instruction,
    selectedCode: '',
    content: targetContent,
    filePath: targetFile,
    targetFiles: [targetFile],
    validationDependencyPaths: readOnlyDependencies,
    autoApply: true,
    autoRepairAttempt: 0,
    projectWideFix: false,
    targetOnly: true,
    testFailureFix: true,
    previousFailureFingerprint: buildTestFailureFingerprint(failedResult),
  })
}

async function runAgentFixAndTest(instruction, explicitTargetFile = null) {
  loading.result = true
  loading.chat = true
  openResultTab('diff')

  const targetFile = explicitTargetFile || getDiffTargetFile(activeFile.value)
  if (!targetFile) {
    loading.result = false
    loading.chat = false
    addAssistantError('請先開啟要讓 AI 分析的檔案。')
    return
  }
  agentSteps.value = [
    { label: '1 讀檔', status: 'pending', detail: `準備讀取 ${targetFile}` },
    { label: '2 產生修改建議', status: 'pending', detail: '等待 AI 分析' },
    { label: '3 產生修改差異', status: 'pending', detail: '尚未產生修改差異' },
    { label: '4 套用', status: 'pending', detail: '等待人工確認' },
    { label: '5 執行測試', status: 'pending', detail: '尚未執行' },
    { label: '6 顯示結果', status: 'pending', detail: '等待測試結果' }
  ]
  commandLogs.value = [
    { time: '準備', command: `read file ${targetFile}`, status: 'pending', statusLabel: '準備讀檔' },
    { time: 'AI', command: 'POST /api/agent/prepare-fix', status: 'pending', statusLabel: '等待 AI 產生 Diff' }
  ]
  fileChanges.value = [{ path: targetFile, status: 'planned', description: '錯誤修正預計修改檔案' }]
  chatMessages.value.push({
    role: 'assistant',
    content: `AI 開始分析並產生修改差異，尚未寫入檔案：${targetFile}`
  })

  try {
    const contextBundle = await buildContextBundle([targetFile])
    const data = await withTimeout(
      apiPost('/api/agent/prepare-fix', {
        task: instruction || '請自動修正目前檔案；先產生修改差異，等待使用者確認後再套用。',
        file_path: targetFile,
        code: targetFile === activeFile.value ? fileContent.value : null,
        context_files: contextBundle.files
      }),
      MODEL_REQUEST_TIMEOUT_MS,
      'AI 產生修改建議逾時'
    )

    if (data.ok === false || !data.diff_text || !data.new_content) {
      diffText.value = ''
      diffInfo.value = null
      pendingNewContent.value = ''
      pendingDiffFilePath.value = ''
      pendingExtraFiles.value = []
      pendingAgentApproval.value = false
      throw new Error(data.content || data.diff?.error || 'AI 未產生可確認的修改差異')
    }

    diffText.value = data.diff_text || data.diff?.diff || ''
    diffInfo.value = {
      instruction,
      filePath: data.file_path || targetFile,
      source: data.source || data.diff?.source || 'agent',
      model: data.model || data.diff?.model || 'local_ollama',
      tokens: data.tokens ?? data.diff?.tokens ?? 0,
      note: data.content || ''
    }
    pendingNewContent.value = data.new_content || data.diff?.new_content || ''
    pendingDiffFilePath.value = data.file_path || targetFile
    pendingExtraFiles.value = Array.isArray(data.extra_files) ? data.extra_files : []
    pendingAgentApproval.value = true
    agentSteps.value = data.steps || agentSteps.value
    testResult.value = null

    chatMessages.value.push({
      role: 'assistant',
      content: pendingExtraFiles.value.length
        ? `AI 已產生修改建議與 ${pendingExtraFiles.value.length} 個測試檔修改差異，但尚未套用。請先檢查下方修改差異，再按「套用變更」；套用後系統會寫入主檔、測試檔並依專案類型執行測試。`
        : `AI 已產生修改建議，但尚未套用。請先檢查下方修改差異，再按「套用變更」；套用後系統會依專案類型執行測試。`
    })
  } catch (err) {
    testResult.value = null
    agentSteps.value = agentSteps.value.map((step, index) => index === 1 ? { ...step, status: 'failed', detail: err.message } : step)
    addAssistantError(`AI 產生修改建議失敗：${err.message}`)
  } finally {
    loading.result = false
    loading.chat = false
    loadAuditLogs().catch(() => {})
    refreshHealth().catch(() => {})
  }
}


async function runProjectErrorFix(instruction = '請自動分析整個專案並修正實際錯誤。') {
  const projectFiles = workspaceFilePaths()
  const fallbackTarget = normalizeLocalPath(activeFile.value) || projectFiles.find(path => /\.(?:py|js|mjs|cjs|ts|tsx|jsx|vue|html?|css|json)$/i.test(path)) || projectFiles[0]
  const targetFile = resolveInlineTargetFile(fallbackTarget, instruction, 'fix') || fallbackTarget
  if (!targetFile || !projectFiles.length) {
    addAssistantError('目前專案沒有可掃描的檔案，請先從左側開啟專案資料夾。')
    return
  }

  loading.result = true
  loading.chat = true
  openResultTab('test')
  agentSteps.value = [
    { label: '1 掃描專案', status: 'pending', detail: `準備讀取 ${projectFiles.length} 個專案檔案` },
    { label: '2 判斷並執行檢查', status: 'pending', detail: '專案檢查 → 未完成實作檢查 → 指定檔案 Docker 實際執行' },
    { label: '3 定位錯誤與關聯檔案', status: 'pending', detail: '等待 AI Docker Sandbox 輸出' },
    { label: '4 最小必要修改', status: 'pending', detail: '尚未交給 Ollama' },
    { label: '5 重新執行相同檢查', status: 'pending', detail: '最多回修 3 次' },
    { label: '6 回報結果', status: 'pending', detail: '等待最後驗證' },
  ]
  chatMessages.value.push({
    role: 'assistant',
    content: `準備執行「錯誤修正」：先依指令確認可修改範圍，再於 AI Docker Sandbox 做專案檢查、未完成實作檢查，最後實際執行指定檔案 ${targetFile}；只有語法通過不會結案。`,
  })

  try {
    const contextFiles = await buildTestContextFilesForTargets(projectFiles)
    const targetContent = await readInlineTargetContent(targetFile, targetFile === activeFile.value ? fileContent.value : '')
    const inspection = await withTimeout(
      apiPost('/api/agent/project-fix/inspect', {
        mode: 'fix_error',
        project_wide: true,
        task: instruction,
        userInstruction: instruction,
        file_path: targetFile,
        filePath: targetFile,
        code: targetContent,
        fullText: targetContent,
        context_files: contextFiles,
        workspace_source: workspaceSource.value,
        project_id: ensureSandboxProjectId(),
        project_name: projectName.value || 'project',
      }),
      120000,
      '全專案掃描與測試逾時'
    )

    const test = inspection.test || {}
    testResult.value = {
      type: inspection.type || 'project_fix_inspection',
      ok: inspection.passed === true,
      command: test.command || inspection.commands?.at(-1) || 'project check',
      commands: inspection.commands || [test.command].filter(Boolean),
      checks: inspection.checks || [],
      testKind: test.kind || 'project_check',
      passed: Number(test.passed || 0),
      failed: Number(test.failed || 0),
      total: Number(test.total || 0),
      exitCode: test.exitCode ?? test.returncode ?? null,
      elapsed: test.elapsed_seconds || 0,
      stdout: test.stdout || '',
      stderr: test.stderr || '',
      sandbox: test.sandbox || null,
      targetFile: test.target_file || inspection.target_file || targetFile,
      targetOnly: inspection.target_only === true,
      targetRuntimeValidated: test.target_runtime_validated === true,
      targetImplementationValidated: test.target_implementation_validated === true,
      targetStdout: test.target_stdout || '',
      targetStderr: test.target_stderr || '',
      agentMessage: '',
    }
    commandLogs.value = (inspection.checks || []).map((check, index) => ({
      time: `檢查 ${index + 1}`,
      command: check.command,
      status: check.ok ? 'done' : 'failed',
      statusLabel: check.ok ? '通過' : '失敗',
    }))
    agentSteps.value = [
      { label: '1 掃描專案', status: 'done', detail: `已讀取 ${inspection.project_files?.length || projectFiles.length} 個檔案；類型：${inspection.project_types?.join('、') || '未辨識'}` },
      { label: '2 判斷並執行檢查', status: inspection.passed ? 'done' : 'failed', detail: inspection.commands?.join('；') || '沒有可執行指令' },
      { label: '3 定位錯誤與關聯檔案', status: inspection.passed ? 'done' : 'pending', detail: inspection.error_files?.length ? inspection.error_files.map(item => `${item.path}${item.line ? `:${item.line}` : ''}`).join('、') : '沒有錯誤位置' },
      { label: '4 最小必要修改', status: inspection.passed ? 'done' : 'pending', detail: inspection.passed ? '不需要修改' : '準備交給 Ollama' },
      { label: '5 重新執行相同檢查', status: inspection.passed ? 'done' : 'pending', detail: inspection.passed ? '初次檢查已通過' : '最多回修 3 次' },
      { label: '6 回報結果', status: inspection.passed ? 'done' : 'pending', detail: inspection.passed ? '已通過' : '等待修正' },
    ]

    const report = {
      commands: inspection.commands || [],
      errorFiles: inspection.error_files || [],
      modifiedFiles: [],
      reasons: Object.fromEntries((inspection.related_files || []).map(item => [item.path, item.reason])),
      targetOnly: inspection.target_only === true,
    }

    if (inspection.passed) {
      const summary = formatProjectFixSummary(report, testResult.value)
      testResult.value.agentMessage = summary
      chatMessages.value.push({ role: 'assistant', content: summary })
      return
    }

    if (inspection.environment_limited) {
      const message = inspection.environment_limitation?.message || '目前沙盒網路被關閉，需要改用 mock 或開啟網路。'
      testResult.value.agentMessage = message
      chatMessages.value.push({ role: 'assistant', content: `${message}\n\n${formatProjectFixSummary(report, testResult.value)}` })
      return
    }

    const relatedPaths = getUniquePaths((inspection.related_files || []).map(item => item.path))
    const repairTarget = selectProjectFixTarget(inspection, targetFile)
    const repairTargetContent = repairTarget === targetFile
      ? targetContent
      : await readInlineTargetContent(repairTarget, repairTarget === activeFile.value ? fileContent.value : '')
    chatMessages.value.push({
      role: 'assistant',
      content: `檢查失敗，已定位錯誤檔案：${compactPathList((inspection.error_files || []).map(item => item.path)) || '終端輸出未含路徑'}。主要修正目標：${repairTarget}；接下來只讀取 ${compactPathList(relatedPaths) || repairTarget} 做最小必要修改並自動重測。`,
    })
    await runInlineCommand({
      action: 'fix',
      label: '錯誤修正',
      instruction: buildProjectFixInstruction(instruction, inspection),
      selectedCode: '',
      content: repairTargetContent,
      filePath: repairTarget,
      autoApply: true,
      autoRepairAttempt: 0,
      validationDependencyPaths: relatedPaths,
      projectWideFix: true,
      targetOnly: inspection.target_only === true,
      projectFixReport: report,
    })
  } catch (err) {
    addAssistantError(`全專案錯誤修正失敗：${err.message}`)
  } finally {
    loading.result = false
    loading.chat = false
    loadAuditLogs().catch(() => {})
    refreshHealth().catch(() => {})
  }
}


function buildAutomaticTestRepairInstruction(originalInstruction, result) {
  const stderr = String(result?.stderr || '').trim()
  const stdout = String(result?.stdout || '').trim()
  const output = [stderr ? `stderr:\n${stderr}` : '', stdout ? `stdout:\n${stdout}` : '']
    .filter(Boolean)
    .join('\n\n')
    .slice(-8000)
  return `${originalInstruction}

上一次多檔修正已套用，但實際專案測試失敗。請依下方測試證據再次檢查所有可編輯檔案，修正直接錯誤以及同類型的明顯錯字、未定義名稱、無效常值、錯誤 import 與測試不一致；不可刪除、略過或弱化測試。

實際測試指令：${result?.command || 'pytest'}
${output || '測試回傳失敗，但沒有額外輸出。'}`
}

async function runSequentialOpenEditorFix(payload, instruction, inlineLabel, targetFiles) {
  const targets = getUniquePaths(targetFiles)
  const targetSet = new Set(targets.map(path => normalizeLocalPath(path).toLowerCase()))
  const sourceRecords = new Map()
  const results = []
  const modifications = []
  let totalTokens = 0
  let modelName = 'local_ollama'
  let modelSource = 'inline_command'

  const setFileProgress = (filePath, status, statusLabel, commandPrefix = '檢查') => {
    const key = normalizeLocalPath(filePath).toLowerCase()
    commandLogs.value = commandLogs.value.map(log => (
      normalizeLocalPath(log.path).toLowerCase() === key
        ? { ...log, status, statusLabel, command: `${commandPrefix} ${filePath}` }
        : log
    ))
  }

  loading.result = true
  loading.chat = true
  openResultTab('diff')
  diffText.value = ''
  diffInfo.value = null
  pendingNewContent.value = ''
  pendingDiffFilePath.value = ''
  pendingExtraFiles.value = []
  pendingAgentApproval.value = false
  testResult.value = null
  fileChanges.value = []
  commandLogs.value = targets.map((path, index) => ({
    path,
    time: `${index + 1}/${targets.length}`,
    command: `等待讀取 ${path}`,
    status: 'pending',
    statusLabel: `排程第 ${index + 1} 個`,
  }))
  agentSteps.value = [
    { label: '1 依分頁順序讀取', status: 'running', detail: `由左到右讀取 ${targets.length} 個 Monaco 檔案` },
    { label: '2 Ollama 逐檔檢查', status: 'pending', detail: '一次只執行一個檔案' },
    { label: '3 彙整修改差異', status: 'pending', detail: '等待所有檔案完成' },
    { label: '4 確認套用', status: 'pending', detail: '尚未產生修改差異' },
    { label: '5 執行測試', status: 'pending', detail: '套用後才執行' },
    { label: '6 操作紀錄', status: 'pending', detail: '逐檔請求會分別留下紀錄' },
  ]
  chatMessages.value.push({
    role: 'assistant',
    content: `${inlineLabel} 已觸發。\n選取程式碼：${String(payload.selectedCode || '').length ? String(payload.selectedCode).length + ' 字' : '未選取'}；\n執行順序（Monaco 由左到右）：${targets.join(' → ')}。`,
  })

  try {
    const contextBundle = await buildContextBundle(targets, {
      onlyPaths: true,
      includeConversation: true,
      onFileProgress: ({ path, status, record, error }) => {
        if (!targetSet.has(normalizeLocalPath(path).toLowerCase())) return
        if (status === 'reading') setFileProgress(path, 'running', `正在讀取 ${path}`, '讀取')
        if (status === 'read') {
          sourceRecords.set(normalizeLocalPath(path).toLowerCase(), record)
          setFileProgress(path, 'pending', `已讀取 ${path}，等待 Ollama`, '等待檢查')
        }
        if (status === 'failed') setFileProgress(path, 'failed', `讀取失敗：${error}`, '讀取失敗')
      },
    })
    agentSteps.value[0] = {
      ...agentSteps.value[0],
      status: commandLogs.value.some(log => log.status === 'failed') ? 'failed' : 'done',
      detail: `已依序讀取 ${sourceRecords.size}/${targets.length} 個檔案`,
    }
    agentSteps.value[1] = { ...agentSteps.value[1], status: 'running', detail: `準備檢查第 1/${targets.length} 個檔案` }

    let workingContextFiles = (contextBundle.files || []).map(item => ({ ...item }))
    for (let index = 0; index < targets.length; index += 1) {
      const currentPath = targets[index]
      const currentKey = normalizeLocalPath(currentPath).toLowerCase()
      const sourceRecord = sourceRecords.get(currentKey)
      if (!sourceRecord?.ok) {
        results.push({ path: currentPath, status: 'failed', reason: sourceRecord?.error || '無法讀取檔案內容' })
        continue
      }

      const currentContent = String(sourceRecord.content ?? '')
      setFileProgress(currentPath, 'running', `Ollama 正在檢查 ${currentPath}`, '執行')
      agentSteps.value[1] = {
        ...agentSteps.value[1],
        status: 'running',
        detail: `正在執行第 ${index + 1}/${targets.length} 個：${currentPath}`,
      }

      const fileInstruction = `錯誤修正：正在逐檔檢查第 ${index + 1}/${targets.length} 個檔案「${currentPath}」。請針對此檔案進行嚴格檢查；若無實質錯誤，請保持原內容 100% 不變，嚴禁作假修正或添加多餘改寫。\n\n任務資訊：\n${instruction}`

      try {
        const data = await withTimeout(
          apiPost('/api/agent/inline-command', {
            userInstruction: fileInstruction,
            filePath: currentPath,
            selectedText: currentPath === activeFile.value ? String(payload.selectedCode ?? selectedCode.value ?? '') : '',
            fullText: currentContent,
            language: inferLanguageId(currentPath),
            task: fileInstruction,
            file_path: currentPath,
            selected_code: currentPath === activeFile.value ? String(payload.selectedCode ?? selectedCode.value ?? '') : '',
            code: currentContent,
            cursor_line: currentPath === activeFile.value ? (payload.cursor?.line ?? editorCursor.value.line) : 1,
            cursor_col: currentPath === activeFile.value ? (payload.cursor?.col ?? editorCursor.value.col) : 1,
            context_files: workingContextFiles,
            target_files: [currentPath],
            mode: 'fix_error',
            project_wide: false,
            project_inspected: false,
            target_only: true,
            sequential_target_only: true,
          }),
          MODEL_REQUEST_TIMEOUT_MS,
          `${inlineLabel}檢查 ${currentPath} 逾時`,
        )
        totalTokens += Number(data.tokens ?? data.diff?.tokens ?? 0)
        modelName = data.model || data.diff?.model || modelName
        modelSource = data.source || data.diff?.source || modelSource
        const fileResult = (Array.isArray(data.file_results) ? data.file_results : [])
          .find(item => normalizeLocalPath(item?.path).toLowerCase() === currentKey)
        const rawReason = String(fileResult?.reason || data.content || data.diff?.error || '').trim()
        const sanitizeReason = (text, isModified) => {
          const clean = String(text || '').trim()
          if (!isModified) {
            const claimsChange = /(?:已?(?:修正|修改|重整|消除|解決|更新|移除|更正|修復)|補上|新增|刪除|改為|改成|替換)/i.test(clean)
            if (!clean || claimsChange) {
              return '完整內容已檢查，未發現需要修正的實質錯誤，保持原內容'
            }
          }
          return clean || (isModified ? '已依檢查結果做最小必要修正' : '未發現錯誤')
        }

        if (data.no_change === true) {
          const safeReason = sanitizeReason(rawReason, false)
          results.push({ path: currentPath, status: 'unchanged', reason: safeReason })
          setFileProgress(currentPath, 'done', `檢查完成，內容不變：${safeReason}`, '完成')
          continue
        }
        if (data.ok === false || !data.diff_text || !data.new_content) {
          const error = data.content || data.diff?.error || '未產生有效修改結果'
          results.push({ path: currentPath, status: 'failed', reason: error })
          setFileProgress(currentPath, 'failed', `檢查失敗：${error}`, '失敗')
          continue
        }

        const newContent = String(data.new_content || data.diff?.new_content || '')
        const changeReason = sanitizeReason(rawReason, true)
        const change = {
          path: normalizeLocalPath(data.file_path || currentPath),
          content: newContent,
          diff: String(data.diff_text || data.diff?.diff || ''),
          reason: changeReason,
        }
        modifications.push(change)
        results.push({ path: currentPath, status: 'modified', reason: change.reason })
        setFileProgress(currentPath, 'done', `已產生修改：${change.reason}`, '完成')
        workingContextFiles = workingContextFiles.map(item => (
          normalizeLocalPath(item?.file_path || item?.path).toLowerCase() === currentKey
            ? { ...item, content: newContent }
            : item
        ))
      } catch (error) {
        results.push({ path: currentPath, status: 'failed', reason: error.message })
        setFileProgress(currentPath, 'failed', `執行失敗：${error.message}`, '失敗')
      }
    }

    const failedCount = results.filter(item => item.status === 'failed').length
    agentSteps.value[1] = {
      ...agentSteps.value[1],
      status: failedCount ? 'failed' : 'done',
      detail: `完成 ${results.length}/${targets.length}；失敗 ${failedCount}`,
    }
    agentSteps.value[2] = {
      ...agentSteps.value[2],
      status: 'done',
      detail: modifications.length ? `產生 ${modifications.length} 個檔案的修改差異` : '沒有可套用修改',
    }

    const resultLines = results.map(item => `- ${item.path}：${item.status === 'modified' ? '已修正' : item.status === 'unchanged' ? '未修改' : '失敗'} — ${item.reason}`)
    const report = [
      `${inlineLabel}逐檔執行完成。`,
      `真實執行順序：${targets.join(' → ')}。`,
      '逐檔結果：',
      ...resultLines,
    ].join('\n')
    fileChanges.value = results.map(item => ({ path: item.path, status: item.status, description: item.reason }))

    if (!modifications.length) {
      agentSteps.value[3] = { ...agentSteps.value[3], status: 'done', detail: '沒有變更，無需套用' }
      agentSteps.value[4] = { ...agentSteps.value[4], status: 'done', detail: '沒有變更，無需執行套用後測試' }
      agentSteps.value[5] = { ...agentSteps.value[5], status: 'done', detail: '逐檔操作紀錄已寫入' }
      chatMessages.value.push({ role: 'assistant', content: report })
      return
    }

    const [primary, ...extras] = modifications
    diffText.value = modifications.map(item => item.diff).filter(Boolean).join('\n')
    diffInfo.value = {
      instruction,
      filePath: primary.path,
      targetFiles: targets,
      modifiedFiles: modifications.map(item => item.path),
      source: modelSource,
      model: modelName,
      tokens: totalTokens,
      note: `已依 Monaco 分頁順序逐檔執行；成功修改 ${modifications.length} 個，失敗 ${failedCount} 個。`,
    }
    pendingNewContent.value = primary.content
    pendingDiffFilePath.value = primary.path
    pendingExtraFiles.value = extras.map(item => ({
      path: item.path,
      content: item.content,
      kind: 'source',
      description: item.reason,
      status: 'modified',
    }))
    pendingAgentApproval.value = true
    agentSteps.value[5] = { ...agentSteps.value[5], status: 'done', detail: '逐檔操作紀錄已寫入' }
    
    if (payload.autoApply) {
      agentSteps.value[3] = { ...agentSteps.value[3], status: 'done', detail: '自動套用逐檔修改' }
      chatMessages.value.push({
        role: 'assistant',
        content: `${report}\n\n已產生 ${modifications.length} 個檔案的修改差異，正在自動套用並測試...`,
      })
      await applyDiff({
        projectWide: payload.projectWideFix === true,
        targetOnly: payload.targetOnly === true,
      })
    } else {
      agentSteps.value[3] = { ...agentSteps.value[3], status: 'pending', detail: '等待確認套用逐檔修改' }
      chatMessages.value.push({
        role: 'assistant',
        content: `${report}\n\n已產生 ${modifications.length} 個檔案的修改差異，請確認後按「確認套用並測試」。`,
      })
    }
  } finally {
    loading.result = false
    loading.chat = false
    loadAuditLogs().catch(() => {})
    refreshHealth().catch(() => {})
  }
}

async function runInlineCommand(payload = {}) {
  const instruction = payload.instruction || (payload.action === 'fix'
    ? '錯誤修正：請依照目前選取程式碼或目前檔案修正錯誤，並直接套用修改。'
    : '程式碼改寫：請依照選取程式碼產生可確認的修改差異。')
  const inlineLabel = payload.label || (payload.action === 'fix' ? '錯誤修正' : '程式碼改寫')
  const autoApply = Boolean(payload.autoApply)
  const autoRepairAttempt = Math.max(0, Number(payload.autoRepairAttempt || 0))
  const payloadTargetFiles = getUniquePaths(payload.targetFiles || [])
  const multiTargetPrimary = payloadTargetFiles.length > 1
    ? (payloadTargetFiles.find(path => !isDatabasePath(path)) || payloadTargetFiles[0])
    : ''
  const targetFile = multiTargetPrimary || resolveInlineTargetFile(payload.filePath || activeFile.value, instruction, payload.action)
  const targetIsActive = targetFile && targetFile === activeFile.value
  const selected = targetIsActive ? String(payload.selectedCode ?? selectedCode.value ?? '') : ''

  if (!targetFile) {
    addAssistantError('請先從左側檔案總管選擇一個檔案，或在指令中用 @檔名 指定要修正的檔案。')
    return
  }

  const targetContent = await readInlineTargetContent(targetFile, targetIsActive ? (payload.content ?? fileContent.value) : '')
  if (!String(targetContent || '').trim()) {
    addAssistantError(`${inlineLabel}需要實際程式碼內容。請先開啟正確檔案、選取程式碼，或用 @檔名 加入上下文。`)
    return
  }
  const validationDependencyPaths = getUniquePaths(payload.validationDependencyPaths || [])
  const requestedTargetFiles = getUniquePaths(
    payloadTargetFiles.length ? payloadTargetFiles : (payload.action === 'fix' && !payload.projectWideFix ? getOpenRewriteTaskFiles() : [])
  )
  const primaryContextTargetFiles = payload.action === 'fix'
    ? (payload.projectWideFix
        ? (validationDependencyPaths.length ? validationDependencyPaths : [targetFile])
        : (requestedTargetFiles.length ? requestedTargetFiles : [targetFile]))
    : (requestedTargetFiles.length ? requestedTargetFiles : [targetFile])
  const contextTargetFiles = getUniquePaths([
    ...primaryContextTargetFiles,
    ...validationDependencyPaths,
  ]).slice(0, CONTEXT_MAX_FILES)
  const repairFileLabel = compactPathList(contextTargetFiles)

  if (payload.action === 'fix' && !payload.projectWideFix && primaryContextTargetFiles.length > 1) {
    return runSequentialOpenEditorFix(payload, instruction, inlineLabel, primaryContextTargetFiles)
  }

  loading.result = true
  loading.chat = true
  openResultTab('diff')
  diffText.value = ''
  diffInfo.value = null
  pendingNewContent.value = ''
  pendingDiffFilePath.value = ''
  pendingExtraFiles.value = []
  pendingAgentApproval.value = false
  if (!payload.testFailureFix) testResult.value = null
  fileChanges.value = []
  commandLogs.value = primaryContextTargetFiles.map(path => ({
    time: '排程',
    command: `檢查 ${path}`,
    status: 'pending',
    statusLabel: '等待讀取檔案',
  }))

  agentSteps.value = payload.projectWideFix
    ? [
        { label: '1 掃描專案', status: 'done', detail: '已於修改前完成全專案掃描' },
        { label: '2 執行檢查', status: 'done', detail: payload.projectFixReport?.commands?.join('；') || '已取得失敗輸出' },
        { label: '3 找相關檔案', status: 'done', detail: repairFileLabel || targetFile },
        { label: '4 最小必要修改', status: 'pending', detail: '等待後端產生修改差異' },
        { label: '5 重新測試', status: 'pending', detail: `目前回修 ${autoRepairAttempt} / ${AUTO_FIX_TEST_RETRY_LIMIT}` },
        { label: '6 回報結果', status: 'pending', detail: '等待最後驗證' },
      ]
    : [
        { label: '1 取得主要修正檔案', status: 'pending', detail: repairFileLabel || targetFile },
        { label: `2 ${inlineLabel}`, status: 'pending', detail: instruction },
        { label: '3 產生修改差異', status: 'pending', detail: '等待後端產生修改差異' },
        { label: autoApply ? '4 自動套用' : '4 確認套用', status: 'pending', detail: autoApply ? '產生差異後直接寫入檔案' : '等待人工確認' },
        { label: '5 執行測試', status: 'pending', detail: '尚未執行' },
        { label: '6 操作紀錄', status: 'pending', detail: '等待寫入操作紀錄' },
      ]

  chatMessages.value.push({
    role: 'assistant',
    content: autoApply
      ? (payload.testFailureFix
          ? `${inlineLabel} 已觸發；這次只允許修改 ${targetFile}，產生差異後會自動套用並重跑相同測試。${validationDependencyPaths.length ? `\n只讀 traceback 上下文：${compactPathList(validationDependencyPaths)}。` : ''}`
          : `${inlineLabel} 已觸發，Ollama 會一次檢查並產生多檔修改後直接套用。\n選取程式碼：${selected ? selected.length + ' 字' : '未選取'}；\n主要修正檔案：${compactPathList(primaryContextTargetFiles) || targetFile}。${validationDependencyPaths.length ? `\n測試回修依賴：${compactPathList(validationDependencyPaths)}。` : ''}`)
      : `${inlineLabel} 已觸發。\n選取程式碼：${selected ? selected.length + ' 字' : '未選取'}；\n主要修正檔案：${repairFileLabel || targetFile}。`
  })

  try {
    const contextBundle = await buildContextBundle(contextTargetFiles, {
      onlyPaths: payload.action === 'fix',
      includeConversation: true,
    })
    agentSteps.value = agentSteps.value.map((step, index) => index === 0
      ? { ...step, status: 'done', detail: `已讀取：${repairFileLabel || targetFile}` }
      : step)
    commandLogs.value = [
      {
        path: '__ollama_batch__',
        time: 'Ollama',
        command: payload.testFailureFix
          ? `Ollama 定向分析 ${targetFile}`
          : `Ollama 批次分析 ${primaryContextTargetFiles.length} 個檔案`,
        status: 'running',
        statusLabel: payload.testFailureFix
          ? `模型正依測試錯誤修正 ${targetFile}`
          : '模型正在產生整批結果（無法宣稱目前正在處理哪一個檔案）',
      },
      ...primaryContextTargetFiles.map(path => ({
        path,
        time: '等待',
        command: payload.testFailureFix ? `等待定向修正 ${path}` : `等待批次結果 ${path}`,
        status: 'pending',
        statusLabel: '等待模型回傳',
      })),
    ]
    agentSteps.value = agentSteps.value.map((step, index) => index === 1
      ? { ...step, status: 'running', detail: `Ollama 正在逐一檢查 ${primaryContextTargetFiles.length} 個 Monaco 檔案` }
      : step)
    const data = await withTimeout(
      apiPost('/api/agent/inline-command', {
        userInstruction: instruction,
        filePath: targetFile,
        selectedText: selected,
        fullText: targetContent,
        language: inferLanguageId(targetFile),
        task: instruction,
        file_path: targetFile,
        selected_code: selected,
        code: targetContent,
        cursor_line: targetIsActive ? (payload.cursor?.line ?? editorCursor.value.line) : 1,
        cursor_col: targetIsActive ? (payload.cursor?.col ?? editorCursor.value.col) : 1,
        context_files: contextBundle.files,
        target_files: primaryContextTargetFiles,
        mode: payload.action === 'fix' ? 'fix_error' : '',
        project_wide: payload.projectWideFix === true,
        project_inspected: payload.projectWideFix === true,
        target_only: payload.targetOnly === true,
      }),
      MODEL_REQUEST_TIMEOUT_MS,
      `${inlineLabel} 產生修改差異逾時`
    )

    const returnedFileResults = Array.isArray(data.file_results)
      ? data.file_results.map(item => ({
          path: normalizeLocalPath(item?.path),
          status: item?.status === 'modified' ? 'modified' : 'unchanged',
          reason: String(item?.reason || '').trim() || (item?.status === 'modified' ? '已依檢查結果修正' : '未發現需要修正的錯誤'),
        })).filter(item => item.path)
      : []
    if (returnedFileResults.length) {
      commandLogs.value = returnedFileResults.map(item => ({
        time: item.status === 'modified' ? '已修改' : '已檢查',
        command: item.path,
        status: 'done',
        statusLabel: item.status === 'modified' ? `已產生修改：${item.reason}` : `內容不變：${item.reason}`,
      }))
    }

    if (data.no_change === true) {
      diffText.value = ''
      diffInfo.value = null
      pendingNewContent.value = ''
      pendingDiffFilePath.value = ''
      pendingExtraFiles.value = []
      pendingAgentApproval.value = false
      fileChanges.value = returnedFileResults.map(item => ({
        path: item.path,
        status: 'unchanged',
        description: item.reason,
      }))
      agentSteps.value = (data.steps || agentSteps.value).map(step => {
        if (payload.testFailureFix && /(執行測試|顯示結果|操作紀錄)/.test(step.label)) {
          return { ...step, status: 'failed', detail: '測試仍失敗，且模型未產生任何可套用修改' }
        }
        if (/執行測試/.test(step.label)) return { ...step, status: 'done', detail: '沒有變更，無需執行套用後測試' }
        if (/Audit Log|操作紀錄/.test(step.label)) return { ...step, status: 'done', detail: '已寫入本次逐檔檢查紀錄' }
        if (step.status === 'pending' || step.status === 'running') {
          return { ...step, status: 'done', detail: step.label.includes('Diff') ? '所有檔案皆不需修改' : step.detail }
        }
        return step
      })
      chatMessages.value.push({
        role: 'assistant',
        content: payload.testFailureFix
          ? `自動修正未完成：${targetFile} 未產生任何修改，原失敗測試仍保留；系統不會把這次結果宣稱為已修正。${data.content ? `\n模型說明：${data.content}` : ''}`
          : (data.content || `${inlineLabel}已完成：所有開啟檔案皆未發現需要修正的錯誤。`),
      })
      if (payload.testFailureFix) {
        if (testResult.value) testResult.value.autoFixStopped = true
        openResultTab(testResult.value ? 'test' : 'editor')
      }
      return
    }

    if (data.ok === false || !data.diff_text || !data.new_content) {
      diffText.value = ''
      diffInfo.value = null
      pendingNewContent.value = ''
      pendingDiffFilePath.value = ''
      pendingExtraFiles.value = []
      pendingAgentApproval.value = false
      agentSteps.value = data.steps || agentSteps.value.map((step, index) => index === 2 ? { ...step, status: 'failed', detail: data.content || '未產生修改差異' } : step)
      throw new Error(data.content || data.diff?.error || 'Inline Command 未產生可確認的修改差異')
    }

    const returnedModifiedFiles = getUniquePaths(data.modified_files || data.diff?.modified_files || [])
    if (payload.action === 'rewrite' && primaryContextTargetFiles.length > 1) {
      const modifiedKeys = new Set(returnedModifiedFiles.map(path => normalizeLocalPath(path).toLowerCase()))
      const missingModifiedFiles = primaryContextTargetFiles.filter(path => !modifiedKeys.has(normalizeLocalPath(path).toLowerCase()))
      if (missingModifiedFiles.length) {
        throw new Error(`後端未實際改寫所有 Monaco 開啟檔案，缺少：${missingModifiedFiles.join('、')}`)
      }
    }

    diffText.value = data.diff_text || data.diff?.diff || ''
    diffInfo.value = {
      instruction,
      filePath: data.file_path || targetFile,
      targetFiles: primaryContextTargetFiles,
      modifiedFiles: returnedModifiedFiles,
      source: data.source || data.diff?.source || 'inline_command',
      model: data.model || data.diff?.model || 'local_ollama',
      tokens: data.tokens ?? data.diff?.tokens ?? 0,
      note: data.content || `${inlineLabel}；selected=${data.selected_chars ?? selected.length}`
    }
    pendingNewContent.value = data.new_content || data.diff?.new_content || ''
    pendingDiffFilePath.value = data.file_path || targetFile
    const returnedExtraFiles = Array.isArray(data.extra_files)
      ? data.extra_files
      : (Array.isArray(data.diff?.extra_files) ? data.diff.extra_files : [])
    pendingExtraFiles.value = payload.targetOnly ? [] : returnedExtraFiles
    fileChanges.value = returnedFileResults.length
      ? returnedFileResults.map(item => ({
          path: item.path,
          status: item.status,
          description: item.status === 'modified' ? `已產生實際 Diff：${item.reason}` : item.reason,
        }))
      : returnedModifiedFiles.map(path => ({
          path,
          status: 'modified',
          description: '已產生實際 Diff，等待確認套用',
        }))
    pendingAgentApproval.value = true
    agentSteps.value = (data.steps || agentSteps.value).map(step => step.label === '2 程式碼改寫' ? { ...step, label: `2 ${inlineLabel}` } : step)

    if (autoApply) {
      const reportedModifiedFiles = getUniquePaths(data.modified_files || [
        pendingDiffFilePath.value,
        ...pendingExtraFiles.value.map(item => item.path),
      ])
      const currentModifiedFiles = payload.targetOnly ? [targetFile] : reportedModifiedFiles
      const currentReport = payload.projectWideFix
        ? {
            ...(payload.projectFixReport || {}),
            modifiedFiles: getUniquePaths([
              ...(payload.projectFixReport?.modifiedFiles || []),
              ...currentModifiedFiles,
            ]),
            reasons: {
              ...(payload.projectFixReport?.reasons || {}),
              ...Object.fromEntries(currentModifiedFiles.map(filePath => [
                filePath,
                payload.projectFixReport?.reasons?.[filePath] || `第 ${autoRepairAttempt + 1} 輪依 terminal 錯誤進行最小必要修正`,
              ])),
            },
          }
        : null
      chatMessages.value.push({
        role: 'assistant',
        content: `${inlineLabel} 已產生修改差異，正在套用 ${compactPathList(currentModifiedFiles.length ? currentModifiedFiles : [pendingDiffFilePath.value])} 並執行測試。`
      })
      // Preserve the candidate in memory before applyDiff. A failed validation
      // rolls the real file back, but a later repair attempt must improve the
      // candidate that was just tested instead of starting from the same
      // original source again.
      const attemptedPrimaryContent = pendingNewContent.value
      await applyDiff({
        projectWide: payload.projectWideFix === true,
        targetOnly: payload.targetOnly === true,
      })
      if (testResult.value && !testResult.value.ok) {
        const blockReason = testFailureRepairBlockReason(testResult.value)
        if (blockReason) {
          const message = `自動修正已停止：完整驗證受目前環境限制，系統不會把同一個錯誤重複送給 Ollama。\n${blockReason}`
          testResult.value.agentMessage = message
          testResult.value.autoFixStopped = true
          testResult.value.validationLimited = true
          agentSteps.value = [
            { label: '1 套用候選修改', status: 'done', detail: targetFile },
            { label: '2 執行驗證', status: 'failed', detail: testResult.value.command },
            { label: '3 判斷錯誤類型', status: 'done', detail: '環境限制，不是可由來源碼自動修復的錯誤' },
            { label: '4 停止自動回修', status: 'done', detail: '避免重複修改同一批檔案' },
          ]
          chatMessages.value.push({ role: 'assistant', content: message })
          openTestResultTabUnlessEnvironmentBlocked(testResult.value, 'editor')
          return
        }
      }
      if (payload.projectWideFix && testResult.value) {
        currentReport.commands = [...new Set([
          ...(currentReport.commands || []),
          ...(testResult.value.commands || [testResult.value.command].filter(Boolean)),
        ].filter(Boolean))]
        if (isSandboxNetworkLimitation(testResult.value)) {
          const message = '目前 Docker 沙盒網路被關閉，真實 API、yfinance 或外部網址無法連線。請改用 mock 測試資料，或開啟沙盒網路後再驗證真實資料。'
          testResult.value.agentMessage = message
          fileChanges.value = currentReport.modifiedFiles.map(path => ({ path, status: 'modified', description: currentReport.reasons[path] }))
          chatMessages.value.push({ role: 'assistant', content: `${message}\n\n${formatProjectFixSummary(currentReport, testResult.value)}` })
          return
        }
      }
      const nextFailureFingerprint = testResult.value && !testResult.value.ok
        ? buildTestFailureFingerprint(testResult.value)
        : ''
      const repeatedSameFailure = Boolean(
        payload.testFailureFix
        && payload.previousFailureFingerprint
        && nextFailureFingerprint
        && nextFailureFingerprint === payload.previousFailureFingerprint
      )
      if (repeatedSameFailure) {
        const message = `自動修正已停止：${targetFile} 的候選修改套用後仍出現完全相同的測試錯誤，系統已回復原檔，不再重複把同一批檔案送給 Ollama。`
        testResult.value.agentMessage = message
        testResult.value.autoFixStopped = true
        agentSteps.value = [
          { label: '1 取得失敗目標', status: 'done', detail: targetFile },
          { label: '2 產生定向修改', status: 'done', detail: `已產生 ${targetFile} 候選修改` },
          { label: '3 套用候選修改', status: 'failed', detail: '驗證失敗，候選修改已回復' },
          { label: '4 重跑相同測試', status: 'failed', detail: testResult.value.command },
          { label: '5 比對錯誤', status: 'failed', detail: '修正前後錯誤完全相同' },
          { label: '6 回報結果', status: 'failed', detail: '停止無效循環，未宣稱修正完成' },
        ]
        chatMessages.value.push({ role: 'assistant', content: message })
        return
      }
      if (testResult.value && !testResult.value.ok && autoRepairAttempt < AUTO_FIX_TEST_RETRY_LIMIT) {
        const failedTestResult = testResult.value
        const retryInstruction = buildAutomaticTestRepairInstruction(instruction, failedTestResult)
        const tracebackDependencyPaths = extractWorkspaceFailurePaths(failedTestResult, workspaceFilePaths())
        const retryDependencyPaths = getUniquePaths([
          ...validationDependencyPaths,
          ...tracebackDependencyPaths,
        ]).filter(path => !payload.testFailureFix || path !== targetFile)
        if (currentReport && tracebackDependencyPaths.length) {
          const knownErrors = new Set((currentReport.errorFiles || []).map(item => item.path))
          currentReport.errorFiles = [
            ...(currentReport.errorFiles || []),
            ...tracebackDependencyPaths
              .filter(filePath => !knownErrors.has(filePath))
              .map(filePath => ({ path: filePath, line: null, reason: '後續重測 traceback 指向此檔案' })),
          ]
          for (const filePath of tracebackDependencyPaths) {
            if (!currentReport.reasons[filePath]) currentReport.reasons[filePath] = '後續重測 traceback 指向此檔案'
          }
        }
        if (tracebackDependencyPaths.length) {
          chatMessages.value.push({
            role: 'assistant',
            content: `pytest traceback 指向：${tracebackDependencyPaths.join('、')}。這些檔案會只加入第二階段「測試回修依賴」，不改變首次主要修正範圍。`
          })
        }
        chatMessages.value.push({
          role: 'assistant',
          content: payload.testFailureFix
            ? `第 ${autoRepairAttempt + 1} 次驗證出現不同的後續錯誤，系統會沿用上一版候選內容繼續修正 ${targetFile}，其他檔案仍只讀。`
            : `第 ${autoRepairAttempt + 1} 次驗證未通過，已把實際 pytest / traceback 回送 Ollama，現在會連同其他關聯檔案自動修正後再測一次。`
        })
        await runInlineCommand({
          ...payload,
          action: 'fix',
          label: payload.testFailureFix ? '自動修正測試錯誤（後續回修）' : '錯誤修正（測試回修）',
          instruction: retryInstruction,
          selectedCode: '',
          content: payload.testFailureFix ? attemptedPrimaryContent : (targetFile === activeFile.value ? fileContent.value : undefined),
          filePath: targetFile,
          autoApply: true,
          autoRepairAttempt: autoRepairAttempt + 1,
          validationDependencyPaths: retryDependencyPaths,
          projectFixReport: currentReport || payload.projectFixReport,
          previousFailureFingerprint: nextFailureFingerprint,
        })
      } else if (payload.testFailureFix && testResult.value && !testResult.value.ok) {
        const message = `自動修正未通過最後驗證：${targetFile} 的候選修改已全部回復，最終保留修改為 0；系統不會將它標示為已修正。`
        testResult.value.agentMessage = message
        testResult.value.autoFixStopped = true
        agentSteps.value = [
          { label: '1 取得失敗目標', status: 'done', detail: targetFile },
          { label: '2 產生定向修改', status: 'done', detail: `已完成 ${autoRepairAttempt + 1} 輪候選修改` },
          { label: '3 套用與回復', status: 'failed', detail: '候選修改驗證失敗，均已回復' },
          { label: '4 重跑相同測試', status: 'failed', detail: testResult.value.command },
          { label: '5 最終保留修改', status: 'failed', detail: '0 個檔案' },
          { label: '6 回報結果', status: 'failed', detail: '未通過，不宣稱修正完成' },
        ]
        chatMessages.value.push({ role: 'assistant', content: message })
      } else if (payload.projectWideFix && testResult.value) {
        const summary = formatProjectFixSummary(currentReport, testResult.value)
        testResult.value.agentMessage = summary
        fileChanges.value = currentReport.modifiedFiles.map(path => ({
          path,
          status: 'modified',
          description: currentReport.reasons[path] || '依實際測試錯誤進行最小必要修正',
        }))
        agentSteps.value = [
          { label: '1 掃描專案', status: 'done', detail: '已掃描專案檔案清單' },
          { label: '2 執行檢查', status: 'done', detail: currentReport.commands.join('；') },
          { label: '3 找相關檔案', status: 'done', detail: (currentReport.errorFiles || []).map(item => `${item.path}${item.line ? `:${item.line}` : ''}`).join('、') || '已依 terminal 輸出判斷' },
          { label: '4 最小必要修改', status: 'done', detail: currentReport.modifiedFiles.join('、') || '無修改' },
          { label: '5 重新測試', status: testResult.value.ok ? 'done' : 'failed', detail: `已回修 ${autoRepairAttempt} 次；${testResult.value.command}` },
          { label: '6 回報結果', status: testResult.value.ok ? 'done' : 'failed', detail: testResult.value.ok ? '全部通過' : `達到最多 ${AUTO_FIX_TEST_RETRY_LIMIT} 次回修` },
        ]
        chatMessages.value.push({ role: 'assistant', content: summary })
      }
    } else {
      chatMessages.value.push({
        role: 'assistant',
        content: `${data.content || `${inlineLabel} 已完成逐檔檢查。`}\n\n已產生 ${returnedModifiedFiles.length} 個檔案的實際修改差異。\n實際修改檔案：${compactPathList(returnedModifiedFiles)}。\n請先確認修改內容，再按「確認套用並測試」；套用後會依專案類型執行測試並寫入操作紀錄。`
      })
    }
  } catch (err) {
    commandLogs.value = commandLogs.value.map(log => (
      log.status === 'running' || log.status === 'pending'
        ? { ...log, status: 'failed', statusLabel: err.message }
        : log
    ))
    addAssistantError(`${inlineLabel} 失敗：${err.message}`)
  } finally {
    loading.result = false
    loading.chat = false
    loadAuditLogs().catch(() => {})
    refreshHealth().catch(() => {})
  }
}


async function readWorkspaceExistingForChange(filePath) {
  const cleanPath = normalizeLocalPath(filePath)
  if (!cleanPath) return { exists: false, content: '' }
  if (['local-handle', 'local-input', 'virtual'].includes(workspaceSource.value)) {
    return readLocalWorkspaceExistingContent(cleanPath)
  }
  if (workspaceSource.value === 'backend' || explorerPathExists(cleanPath)) {
    try {
      const data = await apiPost('/api/files/read', { file_path: cleanPath })
      return { exists: true, content: String(data.content ?? '') }
    } catch {
      return { exists: explorerPathExists(cleanPath), content: '' }
    }
  }
  return { exists: false, content: '' }
}

async function prepareControlledAgentFileChanges(plannedFiles = [], instruction = '', options = {}, modelInfo = {}) {
  const explicitTargetFiles = getUniquePaths(options.targetFiles || getOpenTaskFiles())
  const normalized = []
  const blocked = []
  const unchanged = []
  const modifications = []
  const creations = []

  for (const item of plannedFiles || []) {
    const path = normalizeLocalPath(item?.path || '')
    const content = String(item?.content ?? '')
    if (!path || !content.trim()) continue
    const existing = await readWorkspaceExistingForChange(path)
    const oldContent = String(existing.content || '')
    if (existing.exists && oldContent === content) {
      unchanged.push({ ...item, path, content: undefined, status: 'unchanged' })
      continue
    }
    const record = { ...item, path, content, oldContent, exists: existing.exists && Boolean(oldContent.trim()) }
    normalized.push(record)
    if (!record.exists) {
      creations.push(record)
      continue
    }
    const authorized = isExistingFileChangeAuthorized({
      instruction,
      filePath: path,
      activeFile: activeFile.value,
      explicitTargetFiles,
    })
    if (!authorized) {
      if (shouldRenameExistingPlannedCreation(instruction, path)) {
        const availablePath = findAvailableGeneratedPath(path, [
          ...generatedTargetOccupiedPaths(),
          ...normalized.map(file => file.path),
        ])
        if (availablePath && normalizeLocalPath(availablePath).toLowerCase() !== path.toLowerCase()) {
          const renamedRecord = {
            ...item,
            path: availablePath,
            content,
            oldContent: '',
            exists: false,
            originalPath: path,
          }
          normalized.push(renamedRecord)
          creations.push(renamedRecord)
          continue
        }
      }
      blocked.push(path)
      continue
    }
    modifications.push(record)
  }

  if (blocked.length) {
    throw new Error(`模型嘗試修改未經明確授權的既有檔案：${blocked.join('、')}。請在指令中直接寫出要修改的檔名。`)
  }

  if (!modifications.length) {
    return { requiresApproval: false, creations, unchanged }
  }

  const pendingFiles = [...modifications, ...creations]
  const primary = modifications[0]
  diffText.value = pendingFiles
    .map(item => makeWholeFileDiff(item.path, item.oldContent || '', item.content))
    .join('\n')
  diffInfo.value = {
    instruction,
    filePath: primary.path,
    source: modelInfo.source || 'node_file_agent',
    model: modelInfo.model || 'local_ollama',
    tokens: modelInfo.tokens || 0,
    note: `受控檔案修改：${modifications.length} 個既有檔案、${creations.length} 個新檔案，等待使用者確認。`,
  }
  pendingNewContent.value = primary.content
  pendingDiffFilePath.value = primary.path
  pendingExtraFiles.value = pendingFiles.slice(1).map(item => ({
    ...item,
    oldContent: undefined,
    exists: undefined,
    status: item.exists ? 'modified' : 'created',
  }))
  pendingAgentApproval.value = true
  createdFiles.value = pendingFiles.map(item => ({
    path: item.path,
    kind: item.kind || 'source',
    description: item.exists ? '等待確認修改既有檔案' : '等待確認建立新檔案',
    status: item.exists ? 'planned-modification' : 'planned-creation',
  }))
  fileChanges.value = createdFiles.value.map(item => ({
    path: item.path,
    status: item.status,
    description: item.description,
  }))
  agentSteps.value = [
    { label: '1 分析需求', status: 'done', detail: instruction },
    { label: '2 規劃檔案清單', status: 'done', detail: pendingFiles.map(item => item.path).join('、') },
    { label: '3 產生修改差異', status: 'done', detail: `已產生 ${primary.path} 的 Diff` },
    { label: '4 等待確認', status: 'pending', detail: '尚未寫入任何既有檔案' },
  ]
  openResultTab('diff')
  return { requiresApproval: true, modifications, creations, unchanged }
}

async function createAgentFiles(instruction = '請自動新增測試檔、README、設定檔、範例程式與新程式檔。', options = {}) {
  const autoWorkspaceRepair = Boolean(options.autoWorkspaceRepair)
  const targetFiles = getUniquePaths(Array.isArray(options.targetFiles) ? options.targetFiles : getOpenTaskFiles()).filter(Boolean)
  const targetScope = withOpenEditorTargets(instruction, '建立 / 修改檔案', targetFiles)
  const agentInstruction = autoWorkspaceRepair
    ? buildAutoWorkspaceRepairInstruction(targetScope.instruction)
    : targetScope.instruction
  loading.result = true
  loading.chat = true
  openResultTab('test')
  diffText.value = ''
  diffInfo.value = null
  pendingNewContent.value = ''
  pendingDiffFilePath.value = ''
  pendingExtraFiles.value = []
  pendingAgentApproval.value = false
  testResult.value = null
  createdFiles.value = []

  agentSteps.value = [
    { label: '1 分析需求', status: 'pending', detail: autoWorkspaceRepair ? '準備巡檢目前資料夾與專案設定' : '準備判斷需要新增哪些檔案' },
    { label: '2 規劃檔案清單', status: 'pending', detail: autoWorkspaceRepair ? '依資料夾內容判斷缺檔、缺設定與缺依賴' : '依需求與專案樹動態決定' },
    { label: '3 寫入檔案', status: 'pending', detail: '等待模型回傳檔案內容' }
  ]

  const defaultDir = getActiveFileDirectory()
  const targetArea = getCreateFilesTargetArea()
  const useBrowserWorkspace = shouldWriteGeneratedFilesInBrowserWorkspace()

  chatMessages.value.push({
    role: 'assistant',
    content: autoWorkspaceRepair
      ? `Auto 將巡檢目前資料夾，判斷缺少的檔案、設定、依賴與可修復問題；預設放在目前開啟檔案的資料夾：${defaultDir || '專案根目錄'}。`
      : `依需求與專案樹動態規劃要新增或更新的檔案；預設放在目前開啟檔案的資料夾：${defaultDir || '專案根目錄'}。`
  })

  try {
    const contextBundle = await buildContextBundle(targetFiles)
    const workspaceContext = autoWorkspaceRepair
      ? await collectPlanWorkspaceContext()
      : null
    const workspaceContextRecord = createWorkspaceContextRecord(workspaceContext)
    const contextFiles = [
      ...(workspaceContextRecord ? [workspaceContextRecord] : []),
      ...(Array.isArray(options.extraContextFiles) ? options.extraContextFiles.filter(Boolean) : []),
      ...contextBundle.files,
    ]
    const data = await withTimeout(
      apiPost('/api/agent/create-files', {
        task: agentInstruction,
        target: targetArea,
        current_file_path: activeFile.value,
        default_dir: defaultDir,
        target_files: targetFiles,
        anchor_to_current_dir: Boolean(activeFile.value),
        overwrite: false,
        dry_run: true,
        return_content: true,
        context_files: contextFiles
      }),
      MODEL_REQUEST_TIMEOUT_MS,
      'AI 自動處理檔案逾時'
    )

    if (data.ok === false) throw new Error(data.content || data.error || 'AI 未能處理檔案')

    const plannedFiles = data.created_files || []
    const controlled = await prepareControlledAgentFileChanges(plannedFiles, instruction, {
      ...options,
      targetFiles,
    }, data)
    if (controlled.requiresApproval) {
      chatMessages.value.push({
        role: 'assistant',
        content: `AI 已規劃 ${controlled.modifications.length} 個既有檔案修改與 ${controlled.creations.length} 個新檔案，但尚未寫入。請先檢查「修改差異」，再按「套用變更」；確認後才會一次寫入並執行測試。`,
      })
      return
    }

    let files = await materializeGeneratedCodeFiles(controlled.creations)
    files = [...files, ...controlled.unchanged]

    createdFiles.value = files
    agentSteps.value = data.steps || agentSteps.value

    const createdCount = files.filter(item => item.status === 'created').length
    const skippedCount = files.filter(item => ['skipped', 'unchanged'].includes(item.status)).length
    const failedCount = files.filter(item => item.status === 'failed').length
    const addedLines = files
      .filter(item => item.status === 'created')
      .reduce((sum, item) => sum + Number(item.line_count || 0), 0)
    const fileListText = files.length
      ? files.map(item => `- ${item.path}（${item.status || 'created'}）`).join('\n')
      : '- 無'
    const isStaticWebProject = files.some(item => /(^|\/)index\.html$/i.test(item.path || '')) &&
      files.some(item => /\.css$/i.test(item.path || '')) &&
      files.some(item => /\.(?:js|mjs|cjs)$/i.test(item.path || ''))
    const hasFileChanges = files.length > 0
    const testGuide = hasFileChanges
      ? (isStaticWebProject
          ? '1. 用瀏覽器開啟 index.html。\n2. 依需求操作頁面功能。\n3. 按「在 AI 沙盒執行」檢查 HTML/CSS/JavaScript 資源與 JS 語法。'
          : '1. 點選左側檔案確認新增或修改後的內容。\n2. 按「在 AI 沙盒執行」，系統會依專案類型選擇可用測試。')
      : ''

    testResult.value = {
      type: data.type || 'agent_create_files',
      ok: failedCount === 0,
      command: useBrowserWorkspace ? 'agent create files -> current folder' : 'agent create files',
      passed: createdCount,
      failed: failedCount,
      total: files.length,
      elapsed: data.elapsed_seconds ?? 0,
      stdout: files.map(item => `${item.status || 'created'}: ${item.path} (${item.kind})`).join('\n'),
      stderr: '',
      agentMessage: data.content || `AI 已完成 ${files.length} 個檔案處理，其中新增 ${createdCount} 個。`,
      steps: data.steps || [],
      createdFiles: files,
      createdCount,
      skippedCount
    }

    if (useBrowserWorkspace) {
      files.forEach(item => item.path && upsertExplorerItem(item.path, 'file'))
    } else {
      await loadTree()
    }

    const firstCreatedFile = files.find(item => item.status === 'created' && item.path)?.path || files.find(item => item.path)?.path
    if (firstCreatedFile) await selectFile(firstCreatedFile)
    createdFiles.value = files
    openResultTab('test')

    chatMessages.value.push({
      role: 'assistant',
      content: `${autoWorkspaceRepair ? 'Auto 專案巡檢已完成檔案處理' : 'AI 已完成檔案處理'}，位置：${defaultDir || '專案根目錄'}。

檔案處理清單：
${fileListText}

修改差異摘要：
新增 ${createdCount} 個、略過 ${skippedCount} 個、失敗 ${failedCount} 個；約 +${addedLines} 行 / -0 行。${testGuide ? `\n\n測試方式：\n${testGuide}` : '\n\n未新增或修改檔案，因此不需要執行測試。'}`
    })
  } catch (err) {
    agentSteps.value = agentSteps.value.map((step, index) => index === 1 ? { ...step, status: 'failed', detail: err.message } : step)
    createdFiles.value = []
    testResult.value = {
      type: 'agent_create_files',
      ok: false,
      command: 'agent create files',
      passed: 0,
      failed: 1,
      total: 1,
      elapsed: 0,
      stdout: '',
      stderr: err.message,
      agentMessage: `AI 處理檔案失敗：${err.message}`,
      steps: agentSteps.value,
      createdFiles: []
    }
    openResultTab('test')
    addAssistantError(`AI 處理檔案失敗：${err.message}`)
  } finally {
    loading.result = false
    loading.chat = false
    loadAuditLogs().catch(() => {})
    refreshHealth().catch(() => {})
  }
}


async function clearAuditLogs() {
  try {
    await apiPost('/api/audit/clear', {})
  } catch (err) {
    // 即使後端清除失敗，前端畫面仍先清空，避免操作紀錄殘留。
    console.warn('clear audit logs failed:', err)
  } finally {
    auditLogs.value = []
  }
}

function clearChatMessages() {
  if (commandSubmissionLocked.value) {
    addAssistantError('目前任務仍在執行，完成後才能清空任務紀錄。')
    return
  }
  chatMessages.value = []
  agentSteps.value = []
  commandLogs.value = []
  fileChanges.value = []
}

function startNewChat() {
  if (commandSubmissionLocked.value) {
    addAssistantError('目前任務仍在執行，完成後才能開啟新任務。')
    return
  }
  currentChatSessionId.value = crypto.randomUUID()
  window.sessionStorage.setItem('cubi_current_chat_session_id', currentChatSessionId.value)
  clearChatMessages()
  chatMessages.value.push({
    role: 'assistant',
    content: `已開啟新任務。`
  })
}

async function loadChatSession(id) {
  if (commandSubmissionLocked.value) {
    addAssistantError('目前任務仍在執行，完成後才能切換任務紀錄。')
    return
  }
  try {
    const res = await fetch(`/api/chat/history/${id}`)
    const data = await res.json()
    if (data.ok) {
      currentChatSessionId.value = data.session.id
      window.sessionStorage.setItem('cubi_current_chat_session_id', currentChatSessionId.value)
      chatMessages.value = data.session.messages || []
      agentSteps.value = []
      commandLogs.value = []
      showChatHistory.value = false
    }
  } catch (err) {
    console.error('Failed to load chat session', err)
  }
}

async function restoreCurrentChatSession() {
  const id = String(currentChatSessionId.value || '').trim()
  if (!id) return
  try {
    const res = await fetch(`/api/chat/history/${id}`)
    if (!res.ok) return
    const data = await res.json()
    if (!data.ok || !Array.isArray(data.session?.messages) || !data.session.messages.length) return
    chatMessages.value = data.session.messages
  } catch (err) {
    console.warn('Failed to restore current chat session', err)
  }
}

watch(chatMessages, async (newMessages) => {
  if (newMessages.length === 0) return
  if (newMessages.length === 1 && newMessages[0].role === 'assistant' && newMessages[0].content === '已開啟新任務。') return
  try {
    await fetch(`/api/chat/history/${currentChatSessionId.value}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: newMessages })
    })
  } catch (err) {
    console.error('Failed to save chat session', err)
  }
}, { deep: true })

async function loadAuditLogs() {
  try {
    const data = await apiGet('/api/audit/logs?limit=20')
    auditLogs.value = data.logs || []
    return auditLogs.value
  } catch {
    auditLogs.value = []
    return []
  }
}

function addAssistantError(message) {
  chatMessages.value.push({ role: 'assistant', content: `⚠️ ${message}` })
}

function formatAiChatError(err) {
  const message = String(err?.message || err || '未知錯誤')
  if (/Ollama 未連線|ollama_error|沒有可用模型|未產生 AI 回覆/i.test(message)) {
    return 'Ollama 未連線，未產生 AI 回覆。請先啟動 Ollama 或修正模型設定後再試。'
  }
  if (/(Ollama|地端模型|本機模型).*(呼叫)?(逾時|未回覆|沒有回應|timeout)|AbortError/i.test(message)) {
    return '本機模型暫時沒有回應，請稍後再試。'
  }
  return `AI Chat 失敗：${message}`
}

function isModelUnavailableResponse(data = {}) {
  const source = String(data?.source || '').toLowerCase()
  const model = String(data?.model || '').toLowerCase()
  const errorText = `${data?.error || ''}\n${data?.llm_error || ''}\n${data?.model_error || ''}`
  return source === 'ollama_error'
    || source === 'cloud_api_error'
    || source === 'cloud_api_not_configured'
    || model === 'deterministic_project_scanner'
    || /Ollama 未連線|沒有可用模型|api\/tags 無法連線|未產生 AI 回覆|模型判斷失敗/i.test(errorText)
}

function assertModelResponseAvailable(data = {}) {
  if (!isModelUnavailableResponse(data)) return
  const reason = data?.error || data?.llm_error || data?.model_error || 'Ollama 未連線'
  throw new Error(`Ollama 未連線，未產生 AI 回覆。${reason ? `（${reason}）` : ''}`)
}

function formatModelResponse(content, data) {
  assertModelResponseAvailable(data)
  const verification = data?.verification
  const compactReadOnlyResponse = ['analysis', 'explanation'].includes(String(verification?.mode || ''))
    || ['project_file_analysis', 'program_explanation'].includes(String(data?.type || ''))
  const model = data?.model ? `；模型：${data.model}` : ''
  const source = data?.source && !compactReadOnlyResponse ? `\n\n來源：${data.source}${model}；Token：${data.tokens ?? 0}` : ''
  const verificationText = verification && !compactReadOnlyResponse
    ? [
        '',
        '驗證資訊：',
        `- 掃描流程：${verification.scan_completed ? '已完成' : '未完成'}`,
        verification.mode === 'detection'
          ? `- 程式檢查：${verification.program_check_status === 'passed' ? '通過' : verification.program_check_status === 'failed' ? '未通過' : '未執行（沒有可安全執行的指令）'}`
          : '- 程式檢查：未執行（此功能為唯讀分析）',
        `- 實際載入檔案：${verification.loaded_file_count ?? 0}；送入模型內容：${verification.model_context_file_count ?? 0}${verification.model_context_truncated ? '（有截斷）' : ''}`,
        `- 證據來源：${(verification.evidence_sources || []).join('、') || '未提供'}`,
      ].join('\n')
    : ''
  const note = data?.note ? `\n備註：${data.note}` : ''
  const warning = data?.warning ? `\n警告：${data.warning}` : ''
  const error = data?.llm_error || data?.error ? `\n本機模型狀態：${data.llm_error || data.error}` : ''
  return `${content}${verificationText}${source}${note}${warning}${error}`
}

function withTimeout(promise, ms, message) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer))
}

async function refreshOpenedFolder(options = {}) {
  if (!directoryHandleRef.value) {
    addAssistantError('目前不是資料夾權限模式，請先按左上資料夾圖示重新開啟資料夾。')
    return
  }

  const itemMap = new Map()
  const fileHandleMap = new Map()

  await collectDirectoryEntries(directoryHandleRef.value, '', itemMap, fileHandleMap)

  localFileHandleMap.value = fileHandleMap
  files.value = sortTreeItems(Array.from(itemMap.values()))

  if (options.announce !== false) {
    chatMessages.value.push({
      role: 'assistant',
      mode: options.mode || 'chat',
      content: `已重新整理資料夾：${projectName.value}`
    })
  }
}


function normalizeExplorerSelection(selection) {
  if (!selection) return { path: '', type: 'folder' }

  if (typeof selection === 'string') {
    const normalizedPath = normalizeLocalPath(selection)
    const found = files.value.find(item => normalizeLocalPath(item.path) === normalizedPath)
    return {
      path: normalizedPath,
      type: found?.type || 'file'
    }
  }

  const normalizedPath = normalizeLocalPath(selection.path || '')
  return {
    path: normalizedPath,
    type: selection.type || (files.value.find(item => normalizeLocalPath(item.path) === normalizedPath)?.type) || 'file',
    isRoot: Boolean(selection.isRoot)
  }
}

function parentFolderOf(path) {
  const parts = normalizeLocalPath(path).split('/').filter(Boolean)
  parts.pop()
  return parts.join('/')
}

function baseFolderForNewItem(selection) {
  const item = normalizeExplorerSelection(selection)
  if (!item.path) return ''
  return item.type === 'folder' ? item.path : parentFolderOf(item.path)
}

function joinProjectPath(folderPath, name) {
  const cleanName = normalizeLocalPath(name).trim()
  if (!cleanName) throw new Error('名稱不可空白')
  if (cleanName.includes('..')) throw new Error('名稱不可包含 ..')
  const cleanFolder = normalizeLocalPath(folderPath)
  return cleanFolder ? `${cleanFolder}/${cleanName}` : cleanName
}

async function getLocalDirectoryHandleByPath(folderPath, create = false) {
  let dir = directoryHandleRef.value
  const parts = normalizeLocalPath(folderPath).split('/').filter(Boolean)

  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create })
  }

  return dir
}

async function createLocalFileByPath(filePath) {
  const folderPath = parentFolderOf(filePath)
  const fileName = normalizeLocalPath(filePath).split('/').pop()
  if (!fileName) throw new Error('檔名不可空白')

  const dir = await getLocalDirectoryHandleByPath(folderPath, true)
  const fileHandle = await dir.getFileHandle(fileName, { create: true })
  const ok = await verifyFilePermission(fileHandle)
  if (!ok) throw new Error('沒有本機檔案寫入權限')

  const writable = await fileHandle.createWritable()
  await writable.write('')
  await writable.close()
}

async function createLocalFolderByPath(folderPath) {
  await getLocalDirectoryHandleByPath(folderPath, true)
}

async function createNewFile(selection) {
  if (!projectName.value || workspaceSource.value === 'none') {
    addAssistantError('請先按左上角「開啟資料夾」，選擇資料夾後才能新增檔案。')
    return
  }

  const baseFolder = baseFolderForNewItem(selection)
  const requestedName = normalizeLocalPath(selection?.name || '').trim()
  const hint = baseFolder ? `${baseFolder}/` : '根目錄/'
  const fileName = requestedName || window.prompt(`請輸入新檔案名稱，將建立在：${hint}\n例如：new_file.py、index.html、script.js、style.css、schema.sql`)

  if (!fileName) return

  let filePath
  try {
    filePath = joinProjectPath(baseFolder, fileName)
    if (explorerPathExists(filePath)) {
      filePath = findAvailableGeneratedPath(filePath, generatedTargetOccupiedPaths())
    }
  } catch (err) {
    addAssistantError(`新增檔案失敗：${err.message}`)
    return
  }

  loading.file = true

  try {
    if (directoryHandleRef.value) {
      await createLocalFileByPath(filePath)
      await refreshOpenedFolder()
    } else if (workspaceSource.value === 'backend') {
      await apiPost('/api/files/write', {
        file_path: filePath,
        content: ''
      })
      await loadTree()
    } else {
      upsertExplorerItem(filePath, 'file')
      editedLocalContentMap.value.set(filePath, '')
    }

    await selectFile(filePath)

    chatMessages.value.push({
      role: 'assistant',
      content: `已新增檔案：${filePath}`
    })
  } catch (err) {
    addAssistantError(`新增檔案失敗：${err.message}`)
  } finally {
    loading.file = false
  }
}

async function createNewFolder(selection) {
  if (!projectName.value || workspaceSource.value === 'none') {
    addAssistantError('請先按左上角「開啟資料夾」，選擇資料夾後才能新增資料夾。')
    return
  }

  const baseFolder = baseFolderForNewItem(selection)
  const requestedName = normalizeLocalPath(selection?.name || '').trim()
  const hint = baseFolder ? `${baseFolder}/` : '根目錄/'
  const folderName = requestedName || window.prompt(`請輸入新資料夾名稱，將建立在：${hint}\n例如：features`)

  if (!folderName) return

  let folderPath
  try {
    folderPath = joinProjectPath(baseFolder, folderName)
  } catch (err) {
    addAssistantError(`新增資料夾失敗：${err.message}`)
    return
  }

  loading.file = true

  try {
    if (directoryHandleRef.value) {
      await createLocalFolderByPath(folderPath)
      await refreshOpenedFolder()
    } else if (workspaceSource.value === 'backend') {
      await apiPost('/api/files/write', {
        file_path: `${folderPath.replace(/\/$/, '')}/.gitkeep`,
        content: ''
      })
      await loadTree()
    } else {
      upsertExplorerItem(folderPath, 'folder')
    }

    chatMessages.value.push({
      role: 'assistant',
      content: `已新增資料夾：${folderPath}`
    })
  } catch (err) {
    addAssistantError(`新增資料夾失敗：${err.message}`)
  } finally {
    loading.file = false
  }
}

function explorerPathExists(path) {
  const cleanPath = normalizeLocalPath(path)
  return files.value.some(item => normalizeLocalPath(item.path) === cleanPath)
}

function replacePathPrefix(path, oldPath, newPath) {
  const cleanPath = normalizeLocalPath(path)
  const cleanOld = normalizeLocalPath(oldPath)
  const cleanNew = normalizeLocalPath(newPath)

  if (cleanPath === cleanOld) return cleanNew
  if (cleanPath.startsWith(`${cleanOld}/`)) {
    return `${cleanNew}${cleanPath.slice(cleanOld.length)}`
  }
  return cleanPath
}

function renameMapKeys(sourceMap, oldPath, newPath) {
  const next = new Map()

  for (const [key, value] of sourceMap.entries()) {
    next.set(replacePathPrefix(key, oldPath, newPath), value)
  }

  return next
}

function renameExplorerItems(oldPath, newPath) {
  files.value = sortTreeItems(files.value.map(item => ({
    ...item,
    path: replacePathPrefix(item.path, oldPath, newPath)
  })))
}

function updateActivePathAfterRename(oldPath, newPath) {
  openEditorFiles.value = openEditorFiles.value.map(path => replacePathPrefix(path, oldPath, newPath))
  dirtyFilePaths.value = dirtyFilePaths.value.map(path => replacePathPrefix(path, oldPath, newPath))
  replaceEditorDraftKeys(oldPath, newPath)

  if (activeFile.value === oldPath || activeFile.value.startsWith(`${oldPath}/`)) {
    activeFile.value = replacePathPrefix(activeFile.value, oldPath, newPath)
  }

  pinnedContextFiles.value = pinnedContextFiles.value.map(path => replacePathPrefix(path, oldPath, newPath))

  if (pendingDiffFilePath.value === oldPath || pendingDiffFilePath.value.startsWith(`${oldPath}/`)) {
    pendingDiffFilePath.value = replacePathPrefix(pendingDiffFilePath.value, oldPath, newPath)
  }
}

async function getLocalEntryHandleByPath(targetPath, type) {
  const parts = normalizeLocalPath(targetPath).split('/').filter(Boolean)
  const name = parts.pop()
  if (!name) throw new Error('路徑不正確')

  const dir = await getLocalDirectoryHandleByPath(parts.join('/'), false)
  if (type === 'folder') return await dir.getDirectoryHandle(name)
  return await dir.getFileHandle(name)
}

async function writeTextToLocalFile(filePath, content) {
  const folderPath = parentFolderOf(filePath)
  const fileName = normalizeLocalPath(filePath).split('/').pop()
  if (!fileName) throw new Error('檔名不可空白')

  const dir = await getLocalDirectoryHandleByPath(folderPath, true)
  const fileHandle = await dir.getFileHandle(fileName, { create: true })
  const ok = await verifyFilePermission(fileHandle)
  if (!ok) throw new Error('沒有本機檔案寫入權限')

  const writable = await fileHandle.createWritable()
  await writable.write(content)
  await writable.close()
}

async function copyLocalDirectory(sourceHandle, targetPath) {
  await createLocalFolderByPath(targetPath)

  for await (const [name, handle] of sourceHandle.entries()) {
    const childTargetPath = joinProjectPath(targetPath, name)

    if (handle.kind === 'directory') {
      await copyLocalDirectory(handle, childTargetPath)
      continue
    }

    const file = await handle.getFile()
    await writeTextToLocalFile(childTargetPath, await file.text())
  }
}

async function renameLocalHandleEntry(oldPath, newPath, type) {
  const sourceHandle = await getLocalEntryHandleByPath(oldPath, type)

  if (type === 'folder') {
    await copyLocalDirectory(sourceHandle, newPath)
  } else {
    const file = await sourceHandle.getFile()
    await writeTextToLocalFile(newPath, await file.text())
  }

  await removeLocalEntryByPath(oldPath)
}

async function renameExplorerItem(selection) {
  const item = normalizeExplorerSelection(selection)
  const oldPath = item.path
  const newName = normalizeLocalPath(selection?.name || '').trim()

  if (!oldPath || !newName) return

  let newPath
  try {
    newPath = joinProjectPath(parentFolderOf(oldPath), newName)
  } catch (err) {
    addAssistantError(`重新命名失敗：${err.message}`)
    return
  }

  if (oldPath === newPath) return

  if (explorerPathExists(newPath)) {
    addAssistantError(`重新命名失敗：${newPath} 已經存在。`)
    return
  }

  loading.file = true

  try {
    if (directoryHandleRef.value) {
      await renameLocalHandleEntry(oldPath, newPath, item.type)
      await refreshOpenedFolder()
    } else if (workspaceSource.value === 'backend') {
      await apiPost('/api/files/rename', {
        old_path: oldPath,
        new_path: newPath
      })
      await loadTree()
    } else {
      renameExplorerItems(oldPath, newPath)
    }

    localFileMap.value = renameMapKeys(localFileMap.value, oldPath, newPath)
    localFileHandleMap.value = renameMapKeys(localFileHandleMap.value, oldPath, newPath)
    editedLocalContentMap.value = renameMapKeys(editedLocalContentMap.value, oldPath, newPath)
    updateActivePathAfterRename(oldPath, newPath)

    chatMessages.value.push({
      role: 'assistant',
      content: `已重新命名：${oldPath} → ${newPath}`
    })
  } catch (err) {
    addAssistantError(`重新命名失敗：${err.message}`)
  } finally {
    loading.file = false
  }
}


async function deleteSelectedExplorerItem(selection) {
  const item = normalizeExplorerSelection(selection)
  const targetPath = item.path

  if (!targetPath && !item.isRoot) {
    addAssistantError('請先在左側檔案總管選擇要刪除的檔案或資料夾。')
    return
  }

  const deleteLabel = item.isRoot
    ? (workspacePath.value || projectName.value || '目前專案資料夾')
    : targetPath
  const ok = window.confirm(`確定要刪除這個項目嗎？\n\n${deleteLabel}`)
  if (!ok) return

  loading.file = true

  try {
    if (item.isRoot && directoryHandleRef.value) {
      throw new Error('瀏覽器資料夾權限模式無法刪除目前開啟的根資料夾，請在作業系統檔案總管刪除。')
    } else if (directoryHandleRef.value) {
      await removeLocalEntryByPath(targetPath)
      await refreshOpenedFolder()
    } else if (workspaceSource.value === 'backend') {
      await apiPost('/api/files/delete', {
        file_path: targetPath,
        allow_root: item.isRoot
      })
      if (item.isRoot) clearExplorer()
      else await loadTree()
    } else if (item.isRoot) {
      clearExplorer()
    } else {
      removeExplorerItem(targetPath)
    }

    localFileMap.value.delete(targetPath)
    localFileHandleMap.value.delete(targetPath)
    editedLocalContentMap.value.delete(targetPath)
    removeEditorStateByPrefix(targetPath)

    if (activeFile.value === targetPath || activeFile.value.startsWith(`${targetPath}/`)) {
      resetActiveEditorState()
    }

    chatMessages.value.push({
      role: 'assistant',
      content: `已刪除：${deleteLabel}`
    })
  } catch (err) {
    addAssistantError(`刪除失敗：${err.message}`)
  } finally {
    loading.file = false
  }
}

async function removeLocalEntryByPath(targetPath) {
  const parts = normalizeLocalPath(targetPath).split('/').filter(Boolean)
  const name = parts.pop()

  if (!name) {
    throw new Error('路徑不正確')
  }

  const dir = await getLocalDirectoryHandleByPath(parts.join('/'), false)
  await dir.removeEntry(name, { recursive: true })
}

</script>
