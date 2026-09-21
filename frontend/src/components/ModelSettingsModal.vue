<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <b>設定</b>
          <p>管理模型服務與 GitHub 連接器。</p>
        </div>
        <button type="button" class="close-btn" aria-label="關閉設定" title="關閉" @click="$emit('close')">×</button>
      </div>

      <div class="settings-layout">
        <main class="settings-content" aria-label="設定內容，可用滑鼠滾輪上下捲動">
          <section class="settings-section">
            <div class="section-head">
              <div>
                <b>模型 / API 設定</b>
                <p>設定後端要連線的本機 Ollama 或雲端相容 API，以及使用的模型名稱。</p>
              </div>
            </div>

            <div class="form-grid">
              <label>
                <span>{{ activeApiLabel }}</span>
                <input v-model="activeModelApiUrl" :placeholder="activeApiPlaceholder" />
              </label>
              <label>
                <span>模型名稱</span>
                <input v-model="activeModelName" :placeholder="activeModelPlaceholder" />
              </label>
              <label>
                <span>模型來源</span>
                <select v-model="form.modelSource">
                  <option value="local_ollama">本機 Ollama</option>
                  <option value="cloud_api">雲端相容 API</option>
                </select>
              </label>
              <label>
                <span>分流模式</span>
                <select v-model="form.modelRoutingMode">
                  <option value="local_first">本機優先 / 雲端需核准</option>
                  <option value="local_only">只用本機模型</option>
                </select>
              </label>
            </div>

            <div class="hint-box">
              <b>{{ activeHintTitle }}</b>
              <template v-if="isCloudModelSource">
                <code>CLOUD_API_KEY=your-api-key</code>
                <code>CLOUD_API_BASE_URL={{ form.cloudApiBaseUrl }}</code>
                <code>CLOUD_MODEL={{ form.cloudModel }}</code>
                <span>雲端相容 API 的 API Key 請在後端 .env 設定；此雛型畫面共用 API 網址與模型名稱欄位。</span>
              </template>
              <template v-else>
                <code>setx OLLAMA_HOST "0.0.0.0:11434"</code>
                <code>ollama pull &lt;模型名稱&gt;</code>
                <code>ollama list</code>
                <span>模型名稱需包含標籤，例如 gemma3:27b；bge-m3 是嵌入模型，無法用於對話或程式碼生成。</span>
              </template>
            </div>

            <div v-if="message" class="message" :class="messageTone">
              {{ message }}
            </div>

            <div class="current-status">
              <span>目前狀態：</span>
              <b :class="health?.ok ? 'ok-text' : 'bad-text'">
                {{ activeStatusText }}
              </b>
              <small v-if="health?.warning && !message">{{ health.warning }}</small>
            </div>
          </section>

          <section class="settings-section connector-section">
            <div class="section-head">
              <div>
                <b>連接器</b>
                <p>管理 GitHub 連接狀態與專案存取設定。</p>
              </div>
              <button type="button" class="secondary small" @click="loadCodexConnectors">重新整理</button>
            </div>

            <div class="connector-note">
              Cubi Code 僅儲存連接狀態與專案資訊；GitHub 授權仍需在 Codex 或 ChatGPT 工作區完成。完成授權後，請在此確認連接狀態。
            </div>

            <div class="connector-list">
              <article
                v-for="connector in connectorList"
                :key="connector.key"
                class="connector-card"
                :class="{ connected: connector.connected }"
              >
                <div class="connector-top">
                  <div>
                    <b>{{ connector.name }}</b>
                    <p>{{ connector.description }}</p>
                  </div>
                  <span class="connector-status" :class="connector.connected ? 'ok' : 'idle'">
                    {{ connector.connected ? '已連線' : '未連線' }}
                  </span>
                </div>

                <div class="connector-fields">
                  <label>
                    <span>Repository / 組織</span>
                    <input v-model="connector.repo" placeholder="例如：company/project" />
                  </label>
                </div>

                <div class="connector-actions">
                  <button type="button" class="primary small" @click="openSetup(connector.setupUrl)">
                    {{ connector.connected ? '設定' : `與 ${connector.name} 連線` }}
                  </button>
                  <button
                    type="button"
                    class="secondary small"
                    @click="saveConnector(connector, !connector.connected)"
                  >
                    {{ connector.connected ? '中斷連線' : '確認已完成授權' }}
                  </button>
                  <button type="button" class="secondary small" @click="saveConnector(connector, connector.connected)">儲存</button>
                </div>
              </article>
            </div>

            <div v-if="connectorMessage" class="message connector-message" :class="connectorMessageOk ? 'ok' : 'bad'">
              {{ connectorMessage }}
            </div>
          </section>
        </main>
      </div>

      <div class="actions">
        <button type="button" class="secondary" @click="$emit('close')">{{ hasSaved ? '關閉' : '取消' }}</button>
        <button type="button" class="primary" :disabled="loading" @click="save">
          {{ loading ? '正在測試連線…' : '儲存並測試連線' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { apiGet, apiPost } from '../api/client'

const emit = defineEmits(['close', 'saved'])

const form = reactive({
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'auto',
  modelSource: 'local_ollama',
  modelRoutingMode: 'local_first',
  cloudApiEnabled: false,
  cloudApiProvider: 'OpenAI / Azure OpenAI API',
  cloudApiBaseUrl: 'https://api.openai.com/v1',
  cloudApiKey: '',
  cloudApiKeyConfigured: false,
  cloudModel: 'gpt-4.1-mini',
  requireCloudApproval: true
})

const loading = ref(false)
const message = ref('')
const messageTone = ref('warning')
const hasSaved = ref(false)
const health = ref(null)
const connectors = ref({})
const connectorMessage = ref('')
const connectorMessageOk = ref(true)
const connectorList = computed(() => Object.values(connectors.value || {}).filter(item => item.key === 'github'))
const isCloudModelSource = computed(() => form.modelSource === 'cloud_api')
const activeModelApiUrl = computed({
  get() {
    return isCloudModelSource.value ? form.cloudApiBaseUrl : form.ollamaBaseUrl
  },
  set(value) {
    if (isCloudModelSource.value) form.cloudApiBaseUrl = value
    else form.ollamaBaseUrl = value
  }
})
const activeModelName = computed({
  get() {
    return isCloudModelSource.value ? form.cloudModel : form.ollamaModel
  },
  set(value) {
    if (isCloudModelSource.value) form.cloudModel = value
    else form.ollamaModel = value
  }
})
const activeApiLabel = computed(() => isCloudModelSource.value ? '雲端 API 網址' : 'Ollama 服務網址')
const activeApiPlaceholder = computed(() => isCloudModelSource.value ? '請輸入雲端相容 API 網址' : '請輸入 Ollama API 網址')
const activeModelPlaceholder = computed(() => isCloudModelSource.value ? '例如 gpt-4.1-mini' : 'auto 或 Ollama 模型名稱')
const activeHintTitle = computed(() => isCloudModelSource.value ? '雲端模型設定提醒：' : 'Ollama 設定提醒：')
const activeStatusText = computed(() => {
  if (isCloudModelSource.value) {
    if (health.value?.ok) return '雲端模型已連線'
    return '雲端模型未連線'
  }
  return health.value?.ok ? 'Ollama 已連線' : 'Ollama 未連線'
})

function applySettings(settings = {}) {
  form.ollamaBaseUrl = settings.ollamaBaseUrl || 'http://localhost:11434'
  form.ollamaModel = settings.ollamaModel || 'auto'
  form.modelSource = settings.modelSource || 'local_ollama'
  form.modelRoutingMode = settings.modelRoutingMode || 'local_first'
  form.cloudApiEnabled = Boolean(settings.cloudApiEnabled)
  form.cloudApiProvider = settings.cloudApiProvider || 'OpenAI / Azure OpenAI API'
  form.cloudApiBaseUrl = settings.cloudApiBaseUrl || 'https://api.openai.com/v1'
  form.cloudApiKey = ''
  form.cloudApiKeyConfigured = Boolean(settings.cloudApiKeyConfigured)
  form.cloudModel = settings.cloudModel || 'gpt-4.1-mini'
  form.requireCloudApproval = settings.requireCloudApproval !== false
}

onMounted(async () => {
  try {
    const data = await apiGet('/api/model/settings')
    applySettings(data.settings || {})
    if (data.health) health.value = data.health
  } catch (error) {
    message.value = `讀取設定失敗：${error.message}`
    messageTone.value = 'bad'
  }
  await loadCodexConnectors()
})

async function loadCodexConnectors() {
  try {
    const data = await apiGet('/api/codex/connectors')
    connectors.value = data.connectors || {}
    connectorMessage.value = ''
    connectorMessageOk.value = true
  } catch (error) {
    connectorMessage.value = `Codex 連接器讀取失敗：${error.message}`
    connectorMessageOk.value = false
  }
}

async function saveConnector(connector, connected) {
  try {
    const data = await apiPost(`/api/codex/connectors/${connector.key}`, {
      connected,
      workspace: connector.workspace || '',
      repo: connector.repo || '',
    })
    connectors.value = data.connectors || {}
    connectorMessage.value = `${connector.name} 設定已儲存：${connected ? '已連線' : '未連線'}`
    connectorMessageOk.value = true
  } catch (error) {
    connectorMessage.value = `${connector.name} 設定失敗：${error.message}`
    connectorMessageOk.value = false
  }
}

function openSetup(url) {
  if (!url) return
  window.open(url, '_blank', 'noopener,noreferrer')
}

function normalizeOllamaModel(model) {
  const raw = String(model || '').trim() || 'auto'
  if (!raw.includes(':') && /^[a-zA-Z0-9_-]+\.(\d+(?:\.\d+)?b)$/i.test(raw)) {
    return raw.replace(/\.(\d+(?:\.\d+)?b)$/i, ':$1')
  }
  return raw
}

function normalizeBaseUrl(url, fallback = 'http://localhost:11434') {
  return String(url || '').trim().replace(/\/+$/, '') || fallback
}

async function save() {
  loading.value = true
  message.value = ''
  try {
    const payload = {
      ...form,
      ollamaBaseUrl: normalizeBaseUrl(form.ollamaBaseUrl),
      ollamaModel: normalizeOllamaModel(form.ollamaModel),
      cloudApiEnabled: isCloudModelSource.value || form.cloudApiEnabled,
      cloudApiBaseUrl: normalizeBaseUrl(form.cloudApiBaseUrl, 'https://api.openai.com/v1'),
      cloudModel: form.cloudModel.trim() || 'gpt-4.1-mini',
      requireCloudApproval: true,
    }
    const data = await apiPost('/api/model/settings', payload)
    applySettings(data.settings || {})
    health.value = data.health || null
    hasSaved.value = true
    messageTone.value = data.health?.ok ? 'ok' : 'warning'
    const connectedUrl = activeModelApiUrl.value
    const connectedModel = data.health?.selected_model || activeModelName.value
    const serviceName = isCloudModelSource.value ? '雲端模型服務' : 'Ollama'
    message.value = data.health?.ok
      ? `設定已儲存，已連線至 ${connectedUrl}，使用模型 ${connectedModel}。`
      : `設定已儲存，但無法連線至 ${serviceName}。請確認服務網址、服務是否已啟動，以及模型名稱是否正確。`
    emit('saved', data)
  } catch (error) {
    messageTone.value = 'bad'
    message.value = `儲存失敗：${error.message}`
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(15, 23, 42, .45);
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal-card {
  width: 1120px;
  max-width: calc(100vw - 32px);
  height: min(760px, calc(100vh - 20px));
  max-height: calc(100vh - 20px);
  background: #fff;
  border: 1px solid #dbe5f3;
  border-radius: 14px;
  box-shadow: 0 24px 80px rgba(15, 23, 42, .22);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.modal-head {
  flex: 0 0 auto;
  padding: 12px 18px;
  border-bottom: 1px solid #e6edf7;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}
.modal-head b { font-size: 22px; color: #0f172a; }
.modal-head p { margin: 6px 0 0; color: #64748b; font-size: 13px; }
.close-btn { border: 0; background: transparent; font-size: 28px; line-height: 1; color: #64748b; }
.settings-layout {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: scroll !important;
  overflow-x: hidden;
  background: #fff;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: #94a3b8 #f1f5f9;
}
.settings-side { display: none; }
.settings-layout::-webkit-scrollbar { width: 14px; }
.settings-layout::-webkit-scrollbar-track { background: #f1f5f9; border-left: 1px solid #e6edf7; }
.settings-layout::-webkit-scrollbar-thumb { background: #94a3b8; border-radius: 999px; border: 3px solid #f1f5f9; }
.settings-layout::-webkit-scrollbar-thumb:hover { background: #64748b; }
.settings-content {
  min-height: 0;
  overflow: visible;
  padding: 18px 28px 28px 20px;
  display: grid;
  align-content: start;
  gap: 18px;
  box-sizing: border-box;
}
.settings-section { border: 1px solid #e6edf7; border-radius: 12px; background: #fff; overflow: hidden; }
.section-head { padding: 16px 18px; border-bottom: 1px solid #e6edf7; display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.section-head b { color: #0f172a; font-size: 18px; }
.section-head p { margin: 6px 0 0; color: #64748b; font-size: 13px; line-height: 1.5; }
.form-grid { padding: 16px 18px 10px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
label span { display: block; margin-bottom: 6px; font-weight: 800; color: #334155; font-size: 13px; }
input, select { width: 100%; height: 42px; border: 1px solid #dbe5f3; border-radius: 8px; padding: 0 12px; font: inherit; color: #0f172a; background: #fff; }
.hint-box { margin: 6px 18px 12px; padding: 12px; border: 1px solid #bfdbfe; border-radius: 10px; background: #eff6ff; display: grid; gap: 6px; color: #1e3a8a; font-size: 13px; }
.hint-box code { display: inline-block; width: fit-content; padding: 4px 8px; border-radius: 6px; background: #fff; color: #0f172a; }
.message { margin: 0 18px 12px; padding: 10px 12px; border-radius: 8px; font-size: 13px; }
.message.ok { background: #ecfdf3; color: #067647; border: 1px solid #abefc6; }
.message.warning { background: #fffaeb; color: #93370d; border: 1px solid #fedf89; }
.message.bad { background: #fff1f3; color: #b42318; border: 1px solid #fecdd6; }
.current-status { margin: 0 18px 16px; padding: 10px 12px; border-top: 1px solid #e6edf7; color: #475467; font-size: 13px; }
.current-status small { display: block; margin-top: 4px; color: #64748b; }
.ok-text { color: #067647; }
.bad-text { color: #b42318; }
.connector-note { margin: 14px 18px 0; padding: 10px 12px; border: 1px solid #fedf89; background: #fffaeb; color: #93370d; border-radius: 10px; font-size: 13px; line-height: 1.55; }
.connector-list { padding: 14px 18px 18px; display: grid; gap: 12px; }
.connector-card { border: 1px solid #e4e7ec; border-radius: 12px; background: #fff; padding: 14px; display: grid; gap: 12px; }
.connector-card.connected { border-color: #abefc6; background: #fcfffd; }
.connector-top { display: flex; justify-content: space-between; gap: 12px; }
.connector-top b { font-size: 18px; color: #0f172a; }
.connector-top p { margin: 6px 0 0; color: #667085; line-height: 1.5; font-size: 13px; }
.connector-status { height: 28px; border-radius: 999px; padding: 5px 10px; font-size: 12px; font-weight: 800; white-space: nowrap; }
.connector-status.ok { color: #067647; background: #ecfdf3; border: 1px solid #abefc6; }
.connector-status.idle { color: #475467; background: #f8fafc; border: 1px solid #e4e7ec; }
.connector-fields { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
.connector-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.actions { flex: 0 0 auto; padding: 16px 20px 20px; border-top: 1px solid #e6edf7; display: flex; justify-content: flex-end; gap: 10px; background: #fff; }
.actions button, .small { height: 40px; padding: 0 16px; border-radius: 8px; font-weight: 800; }
.small { height: 34px; padding: 0 12px; font-size: 13px; }
.secondary { border: 1px solid #dbe5f3; background: #fff; color: #334155; }
.primary { border: 1px solid #155eef; background: #155eef; color: #fff; }
.connector-message { margin-top: -4px; }
@media (max-width: 900px) {
  .modal-card { height: calc(100vh - 20px); max-width: calc(100vw - 20px); }
  .form-grid { grid-template-columns: 1fr; }
}
</style>
