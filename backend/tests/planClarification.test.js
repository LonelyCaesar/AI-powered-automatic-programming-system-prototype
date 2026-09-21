const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizeClarificationAnswers,
  normalizeClarificationQuestions,
  tryParseJsonObject,
} = require('../src/services/codingServices')

test('clarification questions are normalized into interactive choices', () => {
  const questions = normalizeClarificationQuestions([{
    id: 'platform',
    question: '範例工具要在哪裡使用？',
    type: 'single',
    options: [
      { value: 'option_a', label: '選項甲', description: '第一種使用環境。' },
      '選項乙',
    ],
  }])

  assert.equal(questions.length, 1)
  assert.equal(questions[0].prompt, '範例工具要在哪裡使用？')
  assert.equal(questions[0].options[0].label, '選項甲')
  assert.equal(questions[0].options[1].label, '選項乙')
})

test('clarification answers discard empty and malformed responses', () => {
  const answers = normalizeClarificationAnswers([
    { question_id: 'platform', prompt: '平台？', values: ['Web 應用', ''] },
    { question_id: 'empty', values: [] },
    null,
  ])

  assert.deepEqual(answers, [{ question_id: 'platform', prompt: '平台？', values: ['Web 應用'] }])
})

test('missing model questions stay empty instead of falling back to fixed prompts', () => {
  const questions = normalizeClarificationQuestions([])
  assert.deepEqual(questions, [])
})

test('model-provided questions are preserved without hardcoded replacements', () => {
  const questions = normalizeClarificationQuestions([{
    id: 'input_format',
    prompt: '範例工具要支援哪種輸入格式？',
    type: 'single',
    options: [
      { value: 'format_a', label: '格式甲', description: '第一種輸入格式。' },
      { value: 'format_b', label: '格式乙', description: '第二種輸入格式。' },
    ],
  }])

  assert.equal(questions.length, 1)
  assert.equal(questions[0].id, 'input_format')
  assert.equal(questions[0].prompt, '範例工具要支援哪種輸入格式？')
  assert.equal(questions[0].options[0].value, 'format_a')
})

test('markdown model output can fall back without throwing', () => {
  assert.equal(tryParseJsonObject('# 實作方案\n\n這不是 JSON。'), null)
})
