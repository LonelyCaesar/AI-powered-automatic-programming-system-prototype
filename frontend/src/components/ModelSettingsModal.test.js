import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const componentPath = fileURLToPath(new URL('./ModelSettingsModal.vue', import.meta.url))
const source = fs.readFileSync(componentPath, 'utf8')

test('model settings modal renders the standard 4-field form layout matching design', () => {
  // Verifies the 4 primary fields
  assert.match(source, /activeApiLabel/)
  assert.match(source, /模型名稱/)
  assert.match(source, /模型來源/)
  assert.match(source, /分流模式/)

  // Verifies extra fields are NOT present
  assert.doesNotMatch(source, /Autocomplete 模型/)
  assert.doesNotMatch(source, /規劃模型/)
  assert.doesNotMatch(source, /AUTOCOMPLETE_MODEL/)
  assert.doesNotMatch(source, /PLAN_MODEL/)
})

test('model settings modal hint box retains standard Ollama reminder and bge-m3 note', () => {
  assert.match(source, /setx OLLAMA_HOST "0\.0\.0\.0:11434"/)
  assert.match(source, /ollama pull &lt;模型名稱&gt;/)
  assert.match(source, /ollama list/)
  assert.match(source, /bge-m3 是嵌入模型，無法用於對話或程式碼生成。/)
})
