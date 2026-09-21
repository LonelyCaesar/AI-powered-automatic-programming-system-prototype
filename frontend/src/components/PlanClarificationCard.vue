<template>
  <section class="plan-choice-card">
    <header>
      <b>{{ currentQuestion.prompt }}</b>
      <span>
        <button type="button" :disabled="currentIndex === 0" @click="moveQuestion(-1)">‹</button>
        {{ currentIndex + 1 }} of {{ questions.length }}
        <button type="button" :disabled="currentIndex === questions.length - 1" @click="moveQuestion(1)">›</button>
      </span>
    </header>

    <div class="choice-list">
      <button
        v-for="(option, optionIndex) in currentQuestion.options"
        :key="option.value"
        type="button"
        class="choice-row"
        :class="{ selected: isSelected(currentQuestion, option.value) }"
        @click="toggleOption(currentQuestion, option.value)"
      >
        <span class="choice-number">{{ optionIndex + 1 }}</span>
        <span class="choice-copy">
          <b>{{ option.label }}</b>
          <small v-if="option.description">{{ option.description }}</small>
        </span>
      </button>

      <label v-if="currentQuestion.type === 'text' || currentQuestion.allow_custom" class="custom-row">
        <span>✎</span>
        <input
          v-model="customAnswers[currentQuestion.id]"
          :placeholder="currentQuestion.type === 'text' ? '輸入你的答案' : '自訂調整方向...'"
          @keydown.enter.prevent="handlePrimaryAction"
        />
      </label>
    </div>

    <p v-if="error" class="answer-error">{{ error }}</p>

    <footer>
      <small>{{ message.rationale || '選擇會影響接下來的規劃方向。' }}</small>
      <div>
        <button type="button" class="cancel-answers" @click="$emit('cancel')">解除</button>
        <button type="button" class="submit-answers" @click="handlePrimaryAction">
          {{ currentIndex < questions.length - 1 ? '下一題' : '繼續' }}
        </button>
      </div>
    </footer>
  </section>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'

const props = defineProps({ message: { type: Object, required: true } })
const emit = defineEmits(['submit', 'cancel'])
const questions = Array.isArray(props.message.questions) && props.message.questions.length
  ? props.message.questions
  : [{ id: 'fallback', prompt: '要如何調整規劃方向？', type: 'text', required: true, allow_custom: true, options: [] }]
const answers = reactive({})
const customAnswers = reactive({})
const currentIndex = ref(0)
const error = ref('')
const currentQuestion = computed(() => questions[currentIndex.value] || questions[0])

for (const question of questions) {
  answers[question.id] = question.type === 'multi' ? [] : ''
  customAnswers[question.id] = ''
}

function moveQuestion(delta) {
  currentIndex.value = Math.min(questions.length - 1, Math.max(0, currentIndex.value + delta))
  error.value = ''
}

function isSelected(question, value) {
  if (question.type === 'multi') return Array.isArray(answers[question.id]) && answers[question.id].includes(value)
  return answers[question.id] === value
}

function toggleOption(question, value) {
  if (question.type === 'multi') {
    const selected = Array.isArray(answers[question.id]) ? answers[question.id] : []
    answers[question.id] = selected.includes(value)
      ? selected.filter(item => item !== value)
      : [...selected, value]
    return
  }
  answers[question.id] = answers[question.id] === value ? '' : value
}

function selectedLabels(question) {
  const selected = question.type === 'multi'
    ? (Array.isArray(answers[question.id]) ? answers[question.id] : [])
    : [answers[question.id]].filter(Boolean)
  const labels = selected.map(value => question.options?.find(option => option.value === value)?.label || value)
  const custom = String(customAnswers[question.id] || '').trim()
  if (question.type === 'text') return custom ? [custom] : []
  if (custom) return question.type === 'single' ? [custom] : [...labels, custom]
  return labels
}

function normalizedAnswers() {
  return questions.map(question => ({
    question_id: question.id,
    prompt: question.prompt,
    values: selectedLabels(question),
  }))
}

function handlePrimaryAction() {
  const currentAnswer = normalizedAnswers()[currentIndex.value]
  if (currentQuestion.value.required && !currentAnswer.values.length) {
    error.value = '請先選擇一個方向，或輸入自訂答案。'
    return
  }
  error.value = ''
  if (currentIndex.value < questions.length - 1) {
    moveQuestion(1)
    return
  }
  const allAnswers = normalizedAnswers()
  const missing = allAnswers.filter((answer, index) => questions[index]?.required && !answer.values.length)
  if (missing.length) {
    currentIndex.value = questions.findIndex(question => question.id === missing[0].question_id)
    error.value = '還有問題尚未選擇。'
    return
  }
  emit('submit', allAnswers)
}
</script>

<style scoped>
.plan-choice-card { border: 1px solid #e6e8ef; border-radius: 18px; background: #fff; box-shadow: 0 10px 30px rgba(16, 24, 40, 0.08); overflow: hidden; }
.plan-choice-card header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px 8px; }
.plan-choice-card header b { color: #1f2937; font-size: 14px; line-height: 1.4; }
.plan-choice-card header span { color: #667085; display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; font-size: 12px; }
.plan-choice-card header button { border: 0; background: transparent; color: #667085; cursor: pointer; font-size: 18px; line-height: 1; width: 22px; height: 22px; }
.plan-choice-card header button:disabled { opacity: 0.35; cursor: default; }
.choice-list { display: grid; gap: 4px; padding: 0 10px 8px; }
.choice-row { display: grid; grid-template-columns: 24px minmax(0, 1fr); align-items: center; gap: 10px; width: 100%; border: 0; background: transparent; border-radius: 10px; padding: 7px 8px; text-align: left; cursor: pointer; }
.choice-row:hover, .choice-row.selected { background: #f3f4f6; }
.choice-number { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: #eef0f4; color: #475467; font-size: 12px; font-weight: 700; }
.choice-row.selected .choice-number { background: #344054; color: white; }
.choice-copy { min-width: 0; display: flex; align-items: baseline; gap: 10px; }
.choice-copy b { color: #344054; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.choice-copy small { color: #667085; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.custom-row { display: grid; grid-template-columns: 24px minmax(0, 1fr); align-items: center; gap: 10px; border-top: 1px solid #eef0f4; padding: 9px 8px 4px; color: #667085; }
.custom-row span { display: grid; place-items: center; width: 22px; height: 22px; }
.custom-row input { min-width: 0; border: 0; outline: 0; color: #344054; font: inherit; }
.answer-error { margin: 0 16px 8px; color: #b42318; font-size: 12px; }
.plan-choice-card footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 10px 10px 16px; border-top: 1px solid #eef0f4; }
.plan-choice-card footer small { color: #667085; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.plan-choice-card footer div { display: flex; align-items: center; gap: 7px; flex: 0 0 auto; }
.plan-choice-card footer button { border: 0; border-radius: 999px; padding: 7px 13px; cursor: pointer; font-weight: 700; }
.submit-answers { color: white; background: #0b63ce; }
.cancel-answers { color: #475467; background: #f2f4f7; }
</style>
