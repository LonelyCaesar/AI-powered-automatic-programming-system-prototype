<template>
  <div class="card status-card">
    <div class="status-head">
      <div>
        <b>系統狀態燈</b>
        <span>{{ checkedAtText }}</span>
      </div>
      <button class="collapse" type="button" title="重新檢查服務狀態" @click="$emit('refresh')">↻</button>
    </div>

    <div class="status-list">
      <div
        v-for="service in services"
        :key="service.key"
        class="status-row"
        :class="{ healthy: service.ok }"
      >
        <span class="status-name">
          <i class="status-dot" :class="dotClass(service.ok)"></i>
          {{ service.label }}
        </span>
        <b>{{ service.text }}</b>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
const props = defineProps({ health: Object })
defineEmits(['refresh'])

const apiOk = computed(() => Boolean(props.health?.api?.ok))
const ollamaOk = computed(() => Boolean(props.health?.ollama?.ok))
const postgresqlOk = computed(() => Boolean(props.health?.postgresql?.ok))
const sandboxOk = computed(() => Boolean(props.health?.docker_sandbox?.ok))

const apiText = computed(() => apiOk.value ? '運行中' : '未連線')
const ollamaText = computed(() => ollamaOk.value ? '運行中' : '未連線')
const postgresqlText = computed(() => postgresqlOk.value ? '運行中' : '未連線')
const sandboxText = computed(() => sandboxOk.value ? '運行中' : '未找到')
const services = computed(() => [
  { key: 'api', label: 'API', ok: apiOk.value, text: apiText.value },
  { key: 'ollama', label: 'Ollama', ok: ollamaOk.value, text: ollamaText.value },
  { key: 'postgresql', label: 'PostgreSQL', ok: postgresqlOk.value, text: postgresqlText.value },
  { key: 'sandbox', label: 'Docker Sandbox', ok: sandboxOk.value, text: sandboxText.value }
])
const checkedAtText = computed(() => {
  const raw = props.health?.checked_at
  if (!raw) return '即時健康檢查'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return '即時健康檢查'
  return `更新 ${date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}`
})

function dotClass(ok) {
  return ok ? 'dot-ok' : 'dot-bad'
}
</script>
