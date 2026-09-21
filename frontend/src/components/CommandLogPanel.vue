<template>
  <div class="codex-mini-card command-log-card">
    <div class="codex-mini-head">
      <b>執行紀錄</b>
      <span>{{ logs.length }} 筆</span>
    </div>
    <div v-if="logs.length" class="command-log-list">
      <div v-for="(log, index) in logs" :key="`${log.command}-${index}`" class="command-log-row">
        <span class="command-time">{{ log.time || '--:--' }}</span>
        <code>{{ log.command }}</code>
        <small :class="{ ok: log.status === 'done', failed: log.status === 'failed' }">{{ log.statusLabel || statusText(log.status) }}</small>
      </div>
    </div>
    <div v-else class="codex-empty-small">尚未有執行紀錄。</div>
  </div>
</template>

<script setup>
defineProps({
  logs: { type: Array, default: () => [] }
})

function statusText(status) {
  if (status === 'done') return '完成'
  if (status === 'failed') return '失敗'
  return '等待'
}
</script>
