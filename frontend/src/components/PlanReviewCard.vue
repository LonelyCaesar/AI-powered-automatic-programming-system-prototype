<template>
  <div class="codex-plan-card" :class="`plan-${message.status || 'pending'}`">
    <div class="codex-plan-head">
      <div>
        <b>☷ 是否實作此方案？</b>
        <small>{{ message.summary || '先規劃，確認後才開始執行。' }}</small>
      </div>
      <span class="plan-status">{{ planStatusLabel(message.status) }}</span>
    </div>


    <div v-if="workspaceObservations.length" class="codex-plan-section">
      <b>工作區觀察</b>
      <ul>
        <li v-for="(item, index) in workspaceObservations" :key="`observation-${index}`">{{ item }}</li>
      </ul>
    </div>

    <div class="codex-plan-section">
      <b>實作方案內容</b>
      <div style="padding-top: 8px; white-space: pre-wrap; line-height: 1.6; word-break: break-word;">
        {{ message.content || normalizedSteps.join('\n') }}
      </div>
    </div>

    <div v-if="normalizedFiles.length" class="codex-plan-files">
      <b>可能影響檔案</b>
      <div>
        <code v-for="file in normalizedFiles" :key="file.path" :title="file.reason">
          {{ file.path }}<span v-if="file.action"> · {{ file.action }}</span>
        </code>
      </div>
    </div>

    <div v-if="riskItems.length || testItems.length || commandItems.length" class="codex-plan-grid">
      <section v-if="riskItems.length">
        <b>風險</b>
        <ul>
          <li v-for="(risk, index) in riskItems" :key="`risk-${index}`">{{ risk }}</li>
        </ul>
      </section>
      <section v-if="testItems.length">
        <b>測試 / 驗證</b>
        <ul>
          <li v-for="(test, index) in testItems" :key="`test-${index}`">{{ test }}</li>
        </ul>
      </section>
      <section v-if="commandItems.length">
        <b>建議命令 / 查證</b>
        <ul>
          <li v-for="(command, index) in commandItems" :key="`command-${index}`"><code>{{ command }}</code></li>
        </ul>
      </section>
    </div>



    <div v-if="(message.status || 'pending') === 'pending'" class="codex-plan-actions">
      <button type="button" class="plan-accept" @click="$emit('accept')">是的，實作此方案</button>
      <button type="button" class="plan-revise" @click="$emit('revise')">否，請修改方案</button>
      <button type="button" class="plan-cancel" @click="$emit('cancel')">取消</button>
    </div>
    <div v-else class="codex-plan-final">
      {{ planFinalText(message.status) }}
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  message: { type: Object, required: true }
})

defineEmits(['accept', 'revise', 'cancel'])

function normalizeList(value, fallback = []) {
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

function normalizeFilePath(file) {
  return String(typeof file === 'string' ? file : (file?.path || file?.file_path || file?.file || ''))
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim()
}

const normalizedSteps = computed(() => {
  const structured = normalizeList(props.message.steps, [])
  if (structured.length) return structured
  return [String(props.message.content || '').trim()]
})

const normalizedFiles = computed(() => {
  if (Array.isArray(props.message.files) && props.message.files.length) {
    return props.message.files
      .map(file => {
        const path = normalizeFilePath(file)
        if (!path) return null
        if (typeof file === 'string') return { path, action: '', reason: '' }
        return {
          path,
          action: String(file.action || file.status || '').trim(),
          reason: String(file.reason || file.description || file.purpose || '').trim()
        }
      })
      .filter(Boolean)
  }
  const matches = String(props.message.content || '').match(/[A-Za-z0-9_\-/]+\.(?:py|js|ts|vue|html|css|json|md|txt|env|yml|yaml|java|sql)/g) || []
  return Array.from(new Set(matches)).slice(0, 12).map(path => ({ path, action: '', reason: '' }))
})

const workspaceObservations = computed(() => normalizeList(
  props.message.workspaceObservations || props.message.workspace_observations,
  []
))
const riskItems = computed(() => normalizeList(props.message.risks, []))
const testItems = computed(() => normalizeList(props.message.tests, []))
const commandItems = computed(() => normalizeList(props.message.commandsToRun || props.message.commands_to_run, []))
const reconnaissanceText = computed(() => {
  const data = props.message.reconnaissance || {}
  const treeCount = Number(data.treeCount || 0)
  const filesRead = Number(data.filesRead || 0)
  const contextFiles = Number(data.contextFiles || 0)
  if (!treeCount && !filesRead && !contextFiles) return '等待使用者確認'
  return `讀取 ${treeCount} 個項目、${filesRead} 個重要檔案、${contextFiles} 個上下文`
})

function planStatusLabel(status) {
  if (status === 'accepted') return '已接受'
  if (status === 'canceled') return '已取消'
  if (status === 'revision_requested') return '重新規劃'
  return '等待確認'
}

function planFinalText(status) {
  if (status === 'accepted') return '方案已接受，Agent 已開始執行。'
  if (status === 'canceled') return '方案已取消，沒有修改任何檔案。'
  if (status === 'revision_requested') return '已要求重新規劃，沒有修改任何檔案。'
  return '方案已處理。'
}
</script>

<style scoped>
.codex-plan-card {
  margin: 10px 0 0 39px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
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

.plan-status,
.codex-plan-meta span {
  border: 1px solid #bfdbfe;
  background: #eef5ff;
  color: #155eef;
  border-radius: 999px;
  padding: 3px 9px;
  font-size: 12px;
  font-weight: 900;
}

.codex-plan-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.codex-plan-section,
.codex-plan-grid section {
  display: grid;
  gap: 6px;
  margin-top: 10px;
}

.codex-plan-section > b,
.codex-plan-files > b,
.codex-plan-grid b {
  color: #334155;
  font-size: 13px;
}

.codex-plan-section ol,
.codex-plan-section ul,
.codex-plan-grid ul {
  margin: 0;
  padding-left: 20px;
}

.codex-plan-section li,
.codex-plan-grid li {
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

.codex-plan-files code,
.codex-plan-grid code {
  border: 1px solid #dbe5f3;
  border-radius: 999px;
  background: #fff;
  color: #155eef;
  padding: 3px 8px;
  font-size: 12px;
  white-space: normal;
  overflow-wrap: anywhere;
}

.codex-plan-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
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
  border-radius: 8px;
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
  border: 1px solid #155eef;
  background: #155eef;
  color: #fff;
}

.plan-revise {
  border: 1px solid #dbe5f3;
  background: #fff;
  color: #334155;
}

.plan-cancel {
  border: 1px solid #fee4e2;
  background: #fff1f0;
  color: #b42318;
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
</style>
