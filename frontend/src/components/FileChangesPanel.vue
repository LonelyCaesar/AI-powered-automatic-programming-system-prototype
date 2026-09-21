<template>
  <div class="codex-mini-card">
    <div class="codex-mini-head">
      <b>File Changes</b>
      <span>{{ changes.length }} files</span>
    </div>
    <div v-if="changes.length" class="file-change-list">
      <div v-for="item in changes" :key="item.path" class="file-change-row" :class="item.status || 'modified'">
        <span>{{ actionLabel(item.status) }}</span>
        <code>{{ item.path }}</code>
        <small>{{ item.description || item.kind || 'AI 產生 / 修改' }}</small>
      </div>
    </div>
    <div v-else class="codex-empty-small">尚未產生檔案變更。</div>
  </div>
</template>

<script setup>
defineProps({
  changes: { type: Array, default: () => [] }
})

function actionLabel(status) {
  if (status === 'created') return '新增'
  if (status === 'deleted') return '刪除'
  if (status === 'skipped') return '略過'
  if (status === 'overwritten') return '覆寫'
  if (status === 'planned') return '預計'
  return '修改'
}
</script>
