<template>
  <div class="codex-mini-card">
    <div class="codex-mini-head">
      <b>任務步驟</b>
      <span>{{ normalizedSteps.length }} 個步驟</span>
    </div>
    <div v-if="normalizedSteps.length" class="codex-step-list">
      <div
        v-for="(step, index) in normalizedSteps"
        :key="`${step.label}-${index}`"
        class="codex-step-row"
        :class="stepClass(step.status)"
      >
        <span class="codex-step-dot">{{ step.status === 'done' ? '✓' : step.status === 'failed' ? '!' : index + 1 }}</span>
        <div>
          <b>{{ step.label }}</b>
          <small>{{ step.detail || '等待執行' }}</small>
        </div>
      </div>
    </div>
    <div v-else class="codex-empty-small">尚未有任務步驟。</div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  steps: { type: Array, default: () => [] }
})

const normalizedSteps = computed(() => props.steps || [])

function stepClass(status) {
  if (status === 'done') return 'done'
  if (status === 'failed') return 'failed'
  return 'pending'
}
</script>
