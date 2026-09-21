<template>
  <div
    class="card chat-card"
    :class="{ 'is-drag-over': dragging }"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="handleDrop"
  >
    <div class="chat-header" :class="{ 'planning-active': planningMode }">
      <div><span class="spark">✦</span><b>{{ planningMode ? 'AI 規劃 / 指令' : 'AI 任務 / 指令' }}</b></div>
      <div class="chat-header-actions">
        <button class="clear-record-btn" type="button" :disabled="loading" @click="toggleHistory" style="margin-right: 8px;" :title="showHistoryView ? '返回任務' : '歷史紀錄'">{{ showHistoryView ? '🔙' : '🕒' }}</button>
        <button class="clear-record-btn" type="button" :disabled="loading" @click="$emit('new-chat'); showHistoryView = false" style="margin-right: 8px;" title="開啟新任務">🆕</button>
        <span class="auto-compact-pill" title="長任務紀錄超過 Token 門檻時會自動摘要舊訊息" style="cursor: help;">🗜️</span>
        <button class="clear-record-btn chat-clear-btn" type="button" :disabled="loading" @click="$emit('clear-chat'); showHistoryView = false" title="清空目前畫面">🗑️</button>
      </div>
    </div>


    <div v-if="!showHistoryView" class="chat-box" ref="chatBox">
      <template v-for="(msg, index) in messages" :key="msg.taskId || msg.createdAt || index">
      <div v-if="shouldShowModeDivider(index, msg)" class="chat-mode-divider" :class="`mode-${normalizedMessageMode(msg)}`">
        <span>{{ messageModeLabel(msg) }}</span>
      </div>
      <div class="chat-message" :class="[msg.role, `message-mode-${normalizedMessageMode(msg)}`]">
        <div class="msg-head">
          <span class="msg-icon">{{ msg.role === 'user' ? '●' : '⬡' }}</span>
          <b>{{ msg.role === 'user' ? '使用者' : '助手' }}</b>
          <span v-if="normalizedMessageMode(msg) !== 'chat'" class="message-mode-badge">{{ messageModeShortLabel(msg) }}</span>
          <span class="time">{{ timeLabel }}</span>
        </div>
        <template v-if="msg.type === 'plan_clarification'">
          <PlanClarificationCard
            :message="msg"
            @submit="answers => emit('submit-plan-answers', { index, msg, answers })"
            @cancel="emit('cancel-plan', { index, msg })"
          />
        </template>
        <template v-else-if="msg.type === 'plan_approval'">
          <PlanReviewCard
            :message="msg"
            @accept="emit('accept-plan', { index, msg })"
            @revise="emit('revise-plan', { index, msg })"
            @cancel="emit('cancel-plan', { index, msg })"
          />
        </template>
        <template v-else-if="msg.type === 'compacted_history'">
          <details style="margin-top: 8px; cursor: pointer;">
            <summary style="font-weight: bold; color: var(--color-text-muted); outline: none;">查看過去的 {{ msg.oldMessages?.length || 0 }} 則任務紀錄</summary>
            <div style="margin-top: 8px; padding-left: 12px; border-left: 2px solid var(--color-border); display: flex; flex-direction: column; gap: 8px;">
              <div v-for="(oldMsg, idx) in msg.oldMessages" :key="idx" style="font-size: 0.9em; opacity: 0.85;">
                <b style="color: var(--color-accent);">{{ oldMsg.role === 'user' ? '使用者' : '助手' }}：</b>
                <span style="white-space: pre-wrap;">{{ oldMsg.content }}</span>
              </div>
            </div>
          </details>
        </template>
        <div v-else class="message-content markdown-body" v-html="renderMessageContent(msg.content)"></div>
      </div>
      </template>

      <div v-if="loading" class="chat-message assistant">
        <div class="msg-head"><span class="msg-icon">⬡</span><b>助手</b></div>
        <div class="streamed-message" aria-live="polite">
          <div v-if="(commandLogs && commandLogs.length) || (agentSteps && agentSteps.length)" class="codex-chat-grid">
            <div v-for="(step, idx) in displayAgentSteps" :key="'step'+idx" class="codex-chat-command">
              <span v-if="step.status === 'failed'" style="background: #fff1f0; color: #b42318;">✖</span>
              <span v-else-if="step.status === 'done'" style="background: #ecfdf3; color: #067647;">✔</span>
              <span v-else-if="step.status === 'running'" class="chat-running-icon" aria-label="執行中"><i></i></span>
              <span v-else class="chat-pending-icon" aria-label="等待中">○</span>
              <div>
                <strong>{{ step.label }}</strong>
                <small>{{ step.detail }}</small>
              </div>
            </div>
            <div v-for="(log, idx) in displayCommandLogs" :key="'log'+idx" class="codex-chat-command">
              <span v-if="log.status === 'failed'" style="background: #fff1f0; color: #b42318;">✖</span>
              <span v-else-if="log.status === 'done'" style="background: #ecfdf3; color: #067647;">✔</span>
              <span v-else-if="log.status === 'running'" class="chat-running-icon" aria-label="執行中"><i></i></span>
              <span v-else class="chat-pending-icon" aria-label="等待中">○</span>
              <div>
                <strong>{{ log.statusLabel || '執行中' }}</strong>
                <small>{{ log.command }}</small>
              </div>
            </div>
            <span class="stream-line current-running-task">正在執行：{{ activeCommandLog?.command || activeAgentStep?.label || '等待下一個步驟' }}</span>
          </div>
          <span v-else class="stream-line current-running-task"><i class="inline-chat-spinner"></i>處理中...</span>
        </div>
      </div>
    </div>


    <div v-else class="chat-box chat-history-box" style="padding: 10px; overflow-y: auto;">
       <div v-if="loadingHistory" style="text-align: center; color: #667085; padding: 20px;">載入中...</div>
       <div v-else-if="historySessions.length === 0" style="text-align: center; color: #667085; padding: 20px;">尚無歷史紀錄。</div>
       <ul v-else style="list-style: none; padding: 0; margin: 0; display: grid; gap: 8px;">
         <li v-for="session in historySessions" :key="session.id" style="border: 1px solid #dbe5f3; border-radius: 8px; padding: 10px; display: flex; justify-content: space-between; align-items: center; background: #fff; cursor: pointer;" @click="loadSessionAndClose(session.id)">
           <div style="display: flex; flex-direction: column; gap: 4px; overflow: hidden;">
             <b style="color: #155eef; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{{ session.title }}</b>
             <span style="color: #667085; font-size: 11px;">{{ new Date(session.updatedAt).toLocaleString() }}</span>
           </div>
           <button @click.stop="deleteHistorySession(session.id)" style="background: #fee4e2; color: #b42318; border: none; border-radius: 4px; padding: 4px 8px; font-size: 11px; cursor: pointer; white-space: nowrap; margin-left: 10px;">刪除</button>
         </li>
       </ul>
    </div>

    <div class="bottom-command-panel">
      <div class="chat-mode-dropdown-wrap" ref="toolDropdownRef">
        <button
          type="button"
          class="chat-mode-select"
          :class="{ open: toolDropdownOpen }"
          :disabled="loading || planningMode"
          @click.stop="toggleToolDropdown"
        >
          <span class="mode-select-prefix">功能選項：</span>
          <span class="current-command-icon">{{ currentCommandIcon }}</span>
          <b>{{ currentCommandLabel }}</b>
          <span class="mode-select-chevron">⌄</span>
        </button>

        <div v-if="toolDropdownOpen" class="chat-tool-dropdown-list" @click.stop @wheel.stop>
          <button
            v-for="tool in normalizedTools"
            :key="tool.key"
            type="button"
            class="chat-tool-dropdown-item"
            :class="{ active: activeTool === tool.key }"
            :disabled="loading || planningMode"
            @click="selectTool(tool.key)"
          >
            <span>{{ tool.icon }}</span>{{ tool.label }}
          </button>
        </div>
      </div>

      <form class="input-row agent-composer-row" @submit.prevent="submit">
        <div class="agent-plus-wrap" ref="agentOptionsRef">
          <button
            type="button"
            class="agent-plus-button"
            :class="{ open: agentOptionsOpen, active: includeIdeContext || planningMode }"
            :aria-label="agentOptionsOpen ? '關閉 Agent 選項' : '開啟 Agent 選項'"
            :aria-expanded="agentOptionsOpen"
            aria-haspopup="menu"
            @click.stop="toggleAgentOptions"
          >
            ＋
          </button>

          <div v-if="agentOptionsOpen" class="agent-options-popover" role="menu" aria-label="Agent 選項" @click.stop @wheel.stop>

            <button
              type="button"
              class="agent-menu-row"
              :class="{ enabled: includeIdeContext }"
              role="menuitemcheckbox"
              :aria-checked="includeIdeContext"
              :title="includeIdeContext ? '已開啟：自動附帶目前檔案、其他開啟分頁與已加入的參考檔' : '已關閉：不自動附帶 IDE 檔案；指令明確指定的目標檔仍會使用'"
              @click="toggleIdeContext"
            >
              <span class="agent-menu-icon">⌁</span>
              <span class="agent-menu-text">
                <b>包含 IDE 上下文</b>
                <small>{{ includeIdeContext ? '自動附帶目前檔案、其他開啟分頁與已加入的參考檔' : '不自動附帶 IDE 檔案；明確指定的目標檔仍會使用' }}</small>
              </span>
              <span class="switch" :class="{ on: includeIdeContext }"><i></i></span>
            </button>
            <button
              type="button"
              class="agent-menu-row"
              :class="{ enabled: planningMode }"
              role="menuitemcheckbox"
              :aria-checked="planningMode"
              @click="togglePlanningMode"
            >
              <span class="agent-menu-icon">☷</span>
              <span class="agent-menu-text"><b>規劃模式</b><small>先產生計畫，不直接修改檔案</small></span>
              <span class="switch" :class="{ on: planningMode }"><i></i></span>
            </button>
            <div class="context-budget-line agent-budget" :class="{ warning: contextStats?.isNearLimit }">
              <span>Context：{{ formattedTotalChars }} / {{ formattedMaxChars }} chars（{{ formattedUsagePercent }}）</span>
              <span>80%（{{ formattedThresholdChars }} chars）背景自動壓縮</span>
              <span v-if="contextStats?.hasCompactedSummary">已保留 Summary＋最近 {{ contextStats?.recentMessagesKept || 16 }} 則</span>
            </div>
          </div>
        </div>

        <div class="input-with-suggest">
          <textarea
            ref="composerInput"
            v-model="text"
            class="composer-textarea"
            rows="1"
            :disabled="loading"
            :placeholder="loading ? '目前任務執行中，完成後才能送出下一個指令…' : inputPlaceholder"
            @keydown.down="moveSuggestion(1, $event)"
            @keydown.up="moveSuggestion(-1, $event)"
            @keydown.enter.exact="chooseSuggestionOrSubmit"
          ></textarea>
          <div v-if="fileSuggestions.length" class="mention-suggestions">
            <button
              v-for="(file, index) in fileSuggestions"
              :key="file.path"
              type="button"
              :class="{ active: index === suggestionIndex }"
              @mousedown.prevent="selectMention(file.path)"
            >
              @{{ file.path }}
            </button>
          </div>
        </div>
        <button type="submit" class="send-button" aria-label="send" :disabled="loading || !text.trim()">➤</button>
      </form>

      <div class="agent-enabled-line">
        <span class="agent-enabled-chip" :class="{ on: includeIdeContext }">⌁ IDE 上下文：{{ includeIdeContext ? '開啟' : '關閉' }}</span>
        <span class="agent-enabled-chip" :class="{ on: planningMode }">☷ 規劃模式：{{ planningMode ? '開啟' : '關閉' }}</span>
        <span v-if="taskHintText" class="agent-enabled-chip task-next-step" :class="{ warning: taskHintWarning }">{{ taskHintText }}</span>
      </div>
      <div class="enter-note">Enter 送出；Shift + Enter 換行</div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PlanReviewCard from './PlanReviewCard.vue'
import PlanClarificationCard from './PlanClarificationCard.vue'

const props = defineProps({
  filePath: String,
  messages: Array,
  loading: Boolean,
  activeCommand: String,
  activeCommandIcon: String,
  activeTool: { type: String, default: 'auto' },
  tools: { type: Array, default: () => [] },
  availableFiles: { type: Array, default: () => [] },
  pinnedFiles: { type: Array, default: () => [] },
  openFiles: { type: Array, default: () => [] },
  mode: { type: String, default: 'Agent' },
  includeIdeContext: { type: Boolean, default: true },
  planningMode: { type: Boolean, default: false },
  contextStats: { type: Object, default: () => ({}) },
  agentSteps: { type: Array, default: () => [] },
  commandLogs: { type: Array, default: () => [] },
  fileChanges: { type: Array, default: () => [] }
})

const emit = defineEmits(['send', 'add-context-file', 'clear-chat', 'clear-command', 'tool', 'toggle-ide-context', 'toggle-planning-mode', 'submit-plan-answers', 'accept-plan', 'revise-plan', 'cancel-plan', 'load-session'])
const showHistoryView = ref(false)
const historySessions = ref([])
const loadingHistory = ref(false)

async function fetchHistory() {
  loadingHistory.value = true
  try {
    const res = await fetch('/api/chat/history')
    const data = await res.json()
    if (data.ok) historySessions.value = data.sessions
  } catch (err) {
    console.error(err)
  } finally {
    loadingHistory.value = false
  }
}

async function deleteHistorySession(id) {
  if (!confirm('確定要刪除這筆任務紀錄嗎？')) return
  try {
    const res = await fetch(`/api/chat/history/${id}`, { method: 'DELETE' })
    if (res.ok) await fetchHistory()
  } catch (err) {
    console.error(err)
  }
}

function toggleHistory() {
  showHistoryView.value = !showHistoryView.value
  if (showHistoryView.value) fetchHistory()
}

function loadSessionAndClose(id) {
  emit('load-session', id)
  showHistoryView.value = false
}

const text = ref('')
const composerInput = ref(null)
const toolDropdownRef = ref(null)
const agentOptionsRef = ref(null)
const dragging = ref(false)
const suggestionIndex = ref(0)
const toolDropdownOpen = ref(false)
const agentOptionsOpen = ref(false)

const normalizedTools = computed(() => props.tools?.length ? props.tools : [
  { key: 'auto', label: '自動判斷', icon: '◇' },
])

const normalizedActiveFile = computed(() => normalizePath(props.filePath))
const hasActiveFile = computed(() => Boolean(normalizedActiveFile.value))
const fileName = computed(() => getFileName(normalizedActiveFile.value))

const normalizedOpenFiles = computed(() => {
  const seen = new Set()
  return [normalizedActiveFile.value, ...(props.openFiles || [])]
    .map(file => normalizePath(file))
    .filter(file => {
      if (!file || seen.has(file)) return false
      seen.add(file)
      return true
    })
})

const displayedOpenFiles = computed(() => normalizedOpenFiles.value
  .filter(file => file !== normalizedActiveFile.value))

const displayedPinnedFiles = computed(() => {
  const opened = new Set(normalizedOpenFiles.value)
  return (props.pinnedFiles || [])
    .map(file => normalizePath(file))
    .filter(file => file && !opened.has(file))
})
const contextSummaryFiles = computed(() => {
  const chips = []
  if (normalizedActiveFile.value) {
    chips.push({
      kind: 'active-file',
      path: normalizedActiveFile.value,
      label: `目前 ${getFileName(normalizedActiveFile.value)}`
    })
  }
  for (const file of displayedOpenFiles.value.slice(0, 2)) {
    chips.push({
      kind: 'open-file',
      path: file,
      label: `開啟 ${getFileName(file)}`
    })
  }
  for (const file of displayedPinnedFiles.value.slice(0, 3)) {
    chips.push({
      kind: 'pinned-file',
      path: file,
      label: `@ ${getFileName(file)}`
    })
  }
  return chips.slice(0, 6)
})

const hasActiveCommand = computed(() => Boolean(String(props.activeCommand || '').trim()))
const currentCommandLabel = computed(() => String(props.activeCommand || '').trim())
const currentCommandIcon = computed(() => String(props.activeCommandIcon || '').trim() || '◇')
const isCommandExecutable = computed(() => true)
const commandStatusLabel = computed(() => props.activeTool === 'auto' ? '語意自動判斷' : 'AI 啟用')
const isFilesTool = computed(() => props.activeTool === 'files')
const hasWorkspaceContext = computed(() => hasActiveFile.value || (props.availableFiles || []).some(item => item?.path))
const formattedTotalChars = computed(() => Number(props.contextStats?.totalChars || 0).toLocaleString('en-US'))
const formattedMaxChars = computed(() => Number(props.contextStats?.maxChars || 120000).toLocaleString('en-US'))
const formattedThresholdChars = computed(() => Number(props.contextStats?.autoCompactThresholdChars || 96000).toLocaleString('en-US'))
const formattedUsagePercent = computed(() => `${Math.min(100, Math.max(0, Number(props.contextStats?.usageRatio || 0) * 100)).toFixed(1)}%`)
const inputPlaceholder = computed(() => {
  if (props.planningMode) return '規劃模式：只產生實作計畫，不會直接改檔...'
  if (isFilesTool.value && !hasWorkspaceContext.value) return '先開啟專案資料夾，再輸入要建立、修改或補齊的檔案需求...'
  if (isFilesTool.value) return '描述要建立、修改或補齊哪些檔案...'
  if (props.activeTool === 'auto') return '自動判斷：輸入任務需求；可輸入 @ 檔名 加入上下文...'
  return hasActiveCommand.value
    ? `輸入「${currentCommandLabel.value}」的任務指令...`
    : '輸入任務指令：分析、修改、產生修改差異或測試目前檔案...'
})
const taskHintWarning = computed(() => isFilesTool.value && !hasWorkspaceContext.value)
const taskHintText = computed(() => {
  if (!isFilesTool.value) return ''
  if (!hasWorkspaceContext.value) return '下一步：先開啟專案資料夾'
  return '下一步：輸入檔案需求，送出後檢查修改差異與測試結果'
})
const timeLabel = computed(() => new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }))

const mentionMatch = computed(() => {
  const raw = text.value || ''
  const match = raw.match(/(?:^|\s)@([^\s@]*)$/)
  return match ? match[1].toLowerCase() : null
})

const fileSuggestions = computed(() => {
  if (mentionMatch.value === null) return []
  const query = mentionMatch.value
  const included = new Set([...normalizedOpenFiles.value, ...displayedPinnedFiles.value])
  return (props.availableFiles || [])
    .filter(item => item?.type === 'file' && item?.path)
    .map(item => ({ ...item, path: normalizePath(item.path) }))
    .filter(item => item.path && !included.has(item.path))
    .filter(item => item.path.toLowerCase().includes(query))
    .slice(0, 8)
})

watch(fileSuggestions, () => { suggestionIndex.value = 0 })
watch(text, () => { nextTick(resizeComposer) })
watch(() => props.planningMode, enabled => {
  if (enabled) closeFloatingMenus()
})

function normalizePath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').trim()
}

function getFileName(path) {
  return normalizePath(path).split('/').filter(Boolean).pop() || ''
}

function submit() {
  if (props.loading || !String(text.value || '').trim()) return
  emit('send', text.value)
  text.value = ''
  closeFloatingMenus()
}

function chooseSuggestionOrSubmit(event) {
  if (event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  if (fileSuggestions.value.length) {
    const file = fileSuggestions.value[suggestionIndex.value]
    if (file) selectMention(file.path)
    return
  }
  submit()
}

function resizeComposer() {
  const input = composerInput.value
  if (!input) return
  input.style.height = 'auto'
  const maxHeight = 120
  input.style.height = `${Math.min(input.scrollHeight, maxHeight)}px`
  input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden'
}

function moveSuggestion(delta, event) {
  if (!fileSuggestions.value.length) return
  event?.preventDefault()
  const total = fileSuggestions.value.length
  suggestionIndex.value = (suggestionIndex.value + delta + total) % total
}

function closeAgentOptions() {
  agentOptionsOpen.value = false
}

function toggleToolDropdown() {
  if (props.loading || props.planningMode) return
  toolDropdownOpen.value = !toolDropdownOpen.value
  if (toolDropdownOpen.value) agentOptionsOpen.value = false
}

function toggleAgentOptions() {
  agentOptionsOpen.value = !agentOptionsOpen.value
  if (agentOptionsOpen.value) toolDropdownOpen.value = false
}

function closeFloatingMenus(event) {
  const target = event?.target
  if (!target) {
    toolDropdownOpen.value = false
    agentOptionsOpen.value = false
    return
  }
  if (toolDropdownOpen.value && !toolDropdownRef.value?.contains(target)) {
    toolDropdownOpen.value = false
  }
  if (agentOptionsOpen.value && !agentOptionsRef.value?.contains(target)) {
    agentOptionsOpen.value = false
  }
}

function toggleIdeContext() {
  emit('toggle-ide-context', !props.includeIdeContext)
}

function togglePlanningMode() {
  emit('toggle-planning-mode', !props.planningMode)
  closeAgentOptions()
}

function addContextFromMenu() {
  emit('add-context-file')
  closeAgentOptions()
}


function normalizedPlanSteps(msg = {}) {
  if (Array.isArray(msg.steps) && msg.steps.length) return msg.steps.slice(0, 8)
  return String(msg.content || '')
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^[-*]\s*/, '').replace(/^\d+[.)、]\s*/, ''))
    .filter(line => line.length >= 6)
    .slice(0, 6)
}

function normalizedPlanFiles(msg = {}) {
  if (Array.isArray(msg.files) && msg.files.length) return msg.files.slice(0, 12)
  const matches = String(msg.content || '').match(/[A-Za-z0-9_\-/]+\.(?:py|js|ts|vue|html|css|json|md|txt|env|yml|yaml|java|sql)/g) || []
  return Array.from(new Set(matches)).slice(0, 12)
}

function planStatusLabel(status = 'pending') {
  if (status === 'accepted') return '已接受'
  if (status === 'revision_requested') return '重新規劃'
  if (status === 'canceled') return '已取消'
  return '等待確認'
}

function planFinalText(status = 'pending') {
  if (status === 'accepted') return '方案已接受，Agent 正在或已經開始執行。'
  if (status === 'revision_requested') return '已要求重新規劃，沒有修改任何檔案。'
  if (status === 'canceled') return '已取消，沒有修改任何檔案。'
  return ''
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderInlineMarkdown(value = '') {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

function renderMessageContent(content = '') {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n')
  const html = []
  let listType = ''
  let inCode = false
  let codeLines = []

  const closeList = () => {
    if (!listType) return
    html.push(`</${listType}>`)
    listType = ''
  }

  const openList = type => {
    if (listType === type) return
    closeList()
    listType = type
    html.push(`<${type}>`)
  }

  for (const line of lines) {
    const codeFence = line.match(/^\s*```/)
    if (codeFence) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
        codeLines = []
        inCode = false
      } else {
        closeList()
        inCode = true
      }
      continue
    }

    if (inCode) {
      codeLines.push(line)
      continue
    }

    const trimmed = line.trim()
    if (!trimmed) {
      closeList()
      continue
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      closeList()
      const level = Math.min(4, heading[1].length + 1)
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`)
      continue
    }

    const ordered = trimmed.match(/^\d+[.)、]\s+(.+)$/)
    if (ordered) {
      openList('ol')
      html.push(`<li>${renderInlineMarkdown(ordered[1])}</li>`)
      continue
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/)
    if (unordered) {
      openList('ul')
      html.push(`<li>${renderInlineMarkdown(unordered[1])}</li>`)
      continue
    }

    closeList()
    html.push(`<p>${renderInlineMarkdown(trimmed)}</p>`)
  }

  if (inCode) html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
  closeList()
  return html.join('')
}

function normalizedMessageMode(message = {}) {
  const mode = String(message?.mode || '').trim().toLowerCase()
  return ['plan', 'execution'].includes(mode) ? mode : 'chat'
}

function messageModeLabel(message = {}) {
  return normalizedMessageMode(message) === 'plan' ? '☷ 規劃模式' : '▶ 已接受方案 · 正式執行'
}

function messageModeShortLabel(message = {}) {
  return normalizedMessageMode(message) === 'plan' ? '規劃' : '執行'
}

function shouldShowModeDivider(index, message = {}) {
  const mode = normalizedMessageMode(message)
  if (mode === 'chat') return false
  const previous = index > 0 ? normalizedMessageMode(props.messages?.[index - 1]) : 'chat'
  return previous !== mode
}


const displayAgentSteps = computed(() => (props.agentSteps || []).filter(Boolean).slice(0, 8))
const activeAgentStep = computed(() => (
  displayAgentSteps.value.find(step => step.status === 'running')
  || displayAgentSteps.value.find(step => step.status === 'pending')
))
const displayCommandLogs = computed(() => (props.commandLogs || []).filter(Boolean).slice(-24))
const activeCommandLog = computed(() => (
  displayCommandLogs.value.find(log => log.status === 'running')
  || displayCommandLogs.value.find(log => log.status === 'pending')
))
const displayFileChanges = computed(() => (props.fileChanges || []).filter(item => item?.path).slice(0, 10))
const showExecutionInChat = computed(() => !props.planningMode && Boolean(displayAgentSteps.value.length || displayCommandLogs.value.length || displayFileChanges.value.length))

onMounted(() => {
  document.addEventListener('click', closeFloatingMenus)
  nextTick(resizeComposer)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeFloatingMenus)
})

function selectTool(toolKey) {
  if (props.loading) return
  emit('tool', toolKey)
  toolDropdownOpen.value = false
}

function selectMention(filePath) {
  const cleanPath = normalizePath(filePath)
  if (!cleanPath) return
  emit('add-context-file', cleanPath)
  text.value = String(text.value || '').replace(/(?:^|\s)@([^\s@]*)$/, match => match.startsWith(' ') ? ` @${getFileName(cleanPath)} ` : `@${getFileName(cleanPath)} `)
}

function handleDrop(event) {
  dragging.value = false
  const path = normalizePath(event.dataTransfer?.getData('application/x-cubi-file-path') || event.dataTransfer?.getData('text/plain') || '')
  if (path) {
    emit('add-context-file', path)
    return
  }
  const dropped = Array.from(event.dataTransfer?.files || [])
    .map(file => normalizePath(file.webkitRelativePath || file.name))
    .filter(Boolean)
  for (const item of dropped) emit('add-context-file', item)
}
</script>

<style scoped>
.task-control-surface {
  display: grid;
  gap: 8px;
  padding: 12px 14px 10px;
  border-bottom: 1px solid #e6edf7;
  background: #fbfdff;
}

.task-control-surface .chat-mode-dropdown-wrap {
  padding: 0;
  border-bottom: 0;
  background: transparent;
}

.task-control-surface .chat-mode-select {
  min-height: 40px;
  background: #fff;
}

.task-toggle-strip {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.task-toggle-button {
  min-width: 0;
  min-height: 38px;
  padding: 7px 9px;
  border: 1px solid #dbe5f3;
  border-radius: 8px;
  background: #fff;
  color: #475467;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  text-align: left;
  cursor: pointer;
}

.task-toggle-button span {
  color: #667085;
  font-weight: 900;
}

.task-toggle-button b {
  min-width: 0;
  overflow: hidden;
  color: #1f2937;
  font-size: 12px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-toggle-button small {
  justify-self: end;
  border-radius: 999px;
  background: #f2f4f7;
  color: #667085;
  padding: 2px 7px;
  font-size: 11px;
  font-weight: 900;
  white-space: nowrap;
}

.task-toggle-button.on {
  border-color: #84caff;
  background: #eef5ff;
}

.task-toggle-button.on span,
.task-toggle-button.on b {
  color: #155eef;
}

.task-toggle-button.on small {
  background: #155eef;
  color: #fff;
}

.context-injection-strip {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}

.context-add-button {
  height: 32px;
  padding: 0 10px;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: #fff;
  color: #155eef;
  font-size: 12px;
  font-weight: 900;
  white-space: nowrap;
  cursor: pointer;
}

.context-chip-list {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}

.context-tag,
.context-empty-chip {
  min-width: 0;
  max-width: 130px;
  overflow: hidden;
  border: 1px solid #e4e7ec;
  border-radius: 999px;
  background: #fff;
  color: #64748b;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-tag.active-file {
  border-color: #84caff;
  background: #eef5ff;
  color: #155eef;
}

.context-tag.open-file {
  border-color: #a7f3d0;
  background: #ecfdf5;
  color: #047857;
}

.context-tag.pinned-file {
  border-color: #c7d7fe;
  background: #f5f7ff;
  color: #3442a8;
}

.task-next-line {
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: #eef5ff;
  color: #155eef;
  padding: 6px 9px;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.35;
}

.task-next-line.warning {
  border-color: #fed7aa;
  background: #fff7ed;
  color: #9a3412;
}

.agent-plus-wrap {
  position: relative;
  flex: 0 0 auto;
}
.agent-plus-button {
  width: 36px !important;
  height: 36px;
  border: 1px solid #dbe5f3 !important;
  border-radius: 999px;
  background: #fff !important;
  color: #475467 !important;
  font-size: 22px !important;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.agent-plus-button:hover,
.agent-plus-button.open,
.agent-plus-button.active {
  border-color: #84caff !important;
  color: #155eef !important;
  background: #eef5ff !important;
}
.agent-options-popover {
  position: absolute;
  left: 0;
  bottom: calc(100% + 10px);
  width: 285px;
  z-index: 60;
  padding: 8px;
  border: 1px solid #dbe5f3;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 18px 45px rgba(15, 23, 42, .16);
}
.agent-menu-row {
  width: 100% !important;
  min-height: 46px;
  border: 0 !important;
  border-radius: 9px;
  background: transparent !important;
  color: #334155 !important;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 6px !important;
  text-align: left;
  cursor: pointer;
}
.agent-menu-row:hover { background: #f8fbff !important; }
.agent-menu-row.enabled b { color: #0f172a; }
.agent-menu-icon {
  width: 22px;
  color: #667085;
  display: inline-flex;
  justify-content: center;
  font-size: 14px;
}
.agent-menu-text {
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.agent-menu-text b {
  color: #1f2937;
  font-size: 14px;
  line-height: 1.2;
}
.agent-menu-text small {
  color: #667085;
  font-size: 11px;
  line-height: 1.25;
}
.switch {
  flex: 0 0 auto;
  width: 38px;
  height: 22px;
  padding: 2px;
  border-radius: 999px;
  background: #d0d5dd;
  display: inline-flex;
  align-items: center;
  transition: background .15s ease;
}
.switch i {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(16, 24, 40, .18);
  transition: transform .15s ease;
}
.switch.on { background: #155eef; }
.switch.on i { transform: translateX(16px); }
.context-budget-line {
  margin: 8px 4px 2px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  color: #64748b;
  font-size: 12px;
}
.context-budget-line span {
  border: 1px solid #e4e7ec;
  background: #f8fafc;
  border-radius: 999px;
  padding: 3px 8px;
}
.context-budget-line.warning span {
  border-color: #fed7aa;
  background: #fff7ed;
  color: #9a3412;
}
.agent-budget { margin-top: 6px; }
.agent-composer-row {
  align-items: center;
}
.agent-enabled-line {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 2px 18px 2px 62px;
}
.agent-enabled-chip {
  border: 1px solid #e4e7ec;
  background: #f8fafc;
  color: #64748b;
  border-radius: 999px;
  padding: 3px 9px;
  font-size: 12px;
  font-weight: 800;
}
.agent-enabled-chip.on {
  border-color: #bfdbfe;
  background: #eef5ff;
  color: #155eef;
}
.agent-enabled-chip.task-next-step {
  border-color: #bfdbfe;
  background: #eef5ff;
  color: #155eef;
}
.agent-enabled-chip.task-next-step.warning {
  border-color: #fed7aa;
  background: #fff7ed;
  color: #9a3412;
}
.send-button {
  flex: 0 0 auto;
  color: #667085 !important;
}
.send-button:not(:disabled) {
  color: #155eef !important;
}
.composer-textarea {
  display: block;
  width: 100%;
  min-height: 42px;
  max-height: 120px;
  box-sizing: border-box;
  border: 1px solid #dbe5f3;
  border-radius: 8px;
  padding: 10px 14px;
  outline: none;
  resize: none;
  overflow-y: hidden;
  color: inherit;
  background: #fff;
  font: inherit;
  font-size: 14px;
  line-height: 20px;
}
.composer-textarea:focus {
  border-color: #84caff;
}

.codex-plan-card {
  margin: 10px 0 0 39px;
  border: 1px solid #dbeafe;
  border-radius: 14px;
  background: #f8fbff;
  padding: 12px;
  color: #1f2937;
}
.codex-plan-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #e6edf7;
  padding-bottom: 10px;
  margin-bottom: 10px;
}
.codex-plan-head > div {
  display: grid;
  gap: 4px;
}
.codex-plan-head b {
  color: #155eef;
  font-size: 15px;
}
.codex-plan-head small {
  color: #475467;
  line-height: 1.45;
}
.plan-status {
  flex: 0 0 auto;
  border: 1px solid #bfdbfe;
  background: #eef5ff;
  color: #155eef;
  border-radius: 999px;
  padding: 3px 9px;
  font-size: 12px;
  font-weight: 900;
}
.codex-plan-section {
  display: grid;
  gap: 6px;
}
.codex-plan-section > b,
.codex-plan-files > b {
  color: #334155;
  font-size: 13px;
}
.codex-plan-section ol {
  margin: 0;
  padding-left: 20px;
}
.codex-plan-section li {
  margin: 4px 0;
  line-height: 1.55;
}
.codex-plan-files {
  margin-top: 10px;
  display: grid;
  gap: 6px;
}
.codex-plan-files > div {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.codex-plan-files code {
  border: 1px solid #dbe5f3;
  border-radius: 999px;
  background: #fff;
  color: #155eef;
  padding: 3px 8px;
  font-size: 12px;
}
.codex-plan-detail {
  margin-top: 10px;
  border-top: 1px solid #e6edf7;
  padding-top: 8px;
}
.codex-plan-detail summary {
  cursor: pointer;
  color: #475467;
  font-weight: 800;
  font-size: 12px;
}
.codex-plan-detail pre {
  margin: 8px 0 0;
  white-space: pre-wrap;
  max-height: 220px;
  overflow: auto;
  border-radius: 10px;
  background: #0f172a;
  color: #e2e8f0;
  padding: 10px;
  font-size: 12px;
  line-height: 1.55;
}
.codex-plan-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.codex-plan-actions button {
  border-radius: 999px;
  padding: 7px 12px;
  cursor: pointer;
  font-weight: 900;
}
.plan-accept {
  border: 1px solid #155eef !important;
  background: #155eef !important;
  color: #fff !important;
}
.plan-revise {
  border: 1px solid #dbe5f3 !important;
  background: #fff !important;
  color: #334155 !important;
}
.plan-cancel {
  border: 1px solid #fee4e2 !important;
  background: #fff1f0 !important;
  color: #b42318 !important;
}
.codex-plan-final {
  margin-top: 10px;
  color: #475467;
  font-size: 12px;
  font-weight: 800;
}
.plan-accepted {
  border-color: #a6f4c5;
  background: #ecfdf3;
}
.plan-canceled {
  border-color: #fecdca;
  background: #fff1f0;
}


.streamed-message,
.message-content {
  display: grid;
  gap: 4px;
  line-height: 1.65;
  white-space: pre-wrap;
}
.chat-header.planning-active {
  background: #f8fbff;
  box-shadow: inset 3px 0 0 #155eef;
}
.chat-mode-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 3px;
  color: #155eef;
  font-size: 12px;
  font-weight: 900;
}
.chat-mode-divider::before,
.chat-mode-divider::after {
  content: '';
  height: 1px;
  background: #c7d7fe;
  flex: 1 1 auto;
}
.chat-mode-divider.mode-execution { color: #067647; }
.chat-mode-divider.mode-execution::before,
.chat-mode-divider.mode-execution::after { background: #a6f4c5; }
.message-mode-badge {
  border-radius: 999px;
  background: #eef4ff;
  color: #155eef;
  padding: 1px 7px;
  font-size: 10px;
  font-weight: 900;
}
.message-mode-execution .message-mode-badge {
  background: #ecfdf3;
  color: #067647;
}
.stream-line { display: block; }
.message-content.markdown-body {
  display: block;
  white-space: normal;
  font-size: 14px;
  line-height: 1.65;
}
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  margin: 8px 0 6px;
  color: #1d2939;
  font-size: 14px;
  line-height: 1.35;
}
.markdown-body :deep(p) {
  margin: 4px 0;
  font-size: 14px;
  line-height: 1.65;
}
.markdown-body :deep(ol),
.markdown-body :deep(ul) {
  margin: 4px 0 8px;
  padding-left: 22px;
  font-size: 14px;
  line-height: 1.65;
}
.markdown-body :deep(li) {
  margin: 3px 0;
  font-size: 14px;
  line-height: 1.65;
}
.markdown-body :deep(code) {
  border: 1px solid #e4e7ec;
  border-radius: 5px;
  background: #f8fafc;
  color: #344054;
  padding: 1px 4px;
  font-size: 14px;
}
.markdown-body :deep(pre) {
  margin: 8px 0;
  overflow: auto;
  border-radius: 8px;
  background: #0f172a;
  padding: 10px;
  font-size: 14px;
}
.markdown-body :deep(pre code) {
  border: 0;
  background: transparent;
  color: #e2e8f0;
  padding: 0;
  font-size: 14px;
  white-space: pre;
}
.codex-chat-execution {
  border-color: #c7d7fe !important;
  background: #f8fbff !important;
}
.codex-chat-grid {
  display: grid;
  gap: 10px;
  margin-top: 6px;
  min-width: 0;
}
.current-running-task {
  margin-top: 4px;
  color: #155eef;
  font-weight: 800;
}
.chat-running-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #eef4ff !important;
}
.chat-pending-icon {
  background: #f8fafc !important;
  color: #98a2b3 !important;
}
.chat-running-icon i,
.inline-chat-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid #155eef;
  border-right-color: transparent;
  border-radius: 999px;
  animation: chatSpin .75s linear infinite;
}
.inline-chat-spinner {
  display: inline-block;
  margin-right: 7px;
  vertical-align: -2px;
}
@keyframes chatSpin {
  to { transform: rotate(360deg); }
}
.codex-chat-section {
  border: 1px solid #dbe5f3;
  background: #fff;
  border-radius: 12px;
  padding: 10px;
  display: grid;
  gap: 7px;
}
.codex-chat-section > b {
  color: #155eef;
  font-size: 13px;
}
.codex-chat-line,
.codex-chat-command,
.codex-chat-file {
  display: grid;
  grid-template-columns: 26px 1fr;
  gap: 8px;
  align-items: start;
}
.codex-chat-command > div {
  min-width: 0;
}
.codex-chat-command small {
  display: block;
  overflow-wrap: anywhere;
}
.codex-chat-line > span,
.codex-chat-command > span,
.codex-chat-file > span {
  width: 22px;
  min-height: 22px;
  border-radius: 999px;
  background: #eef4ff;
  color: #155eef;
  font-weight: 900;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
}
.codex-chat-line.done > span,
.codex-chat-command .done > span { background: #ecfdf3; color: #067647; }
.codex-chat-line.failed > span { background: #fff1f0; color: #b42318; }
.codex-chat-line strong {
  display: block;
  color: #1d2939;
  font-size: 13px;
}
.codex-chat-line small,
.codex-chat-command small {
  display: block;
  color: #667085;
  font-size: 12px;
  line-height: 1.45;
}
.codex-chat-command code,
.codex-chat-file code {
  display: block;
  color: #344054;
  background: #f8fafc;
  border: 1px solid #e4e7ec;
  border-radius: 8px;
  padding: 5px 7px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.codex-chat-file {
  grid-template-columns: 42px 1fr;
}
.codex-chat-file > span {
  width: 36px;
  border-radius: 8px;
}

.chat-card button:disabled,
.chat-card input:disabled,
.chat-card textarea:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.chat-panel-dashboard {
  margin: 10px;
  border-top: 1px solid var(--color-border);
  padding-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
