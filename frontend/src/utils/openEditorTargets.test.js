import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildOpenEditorTargetInstruction,
  getOpenEditorFixTargetFiles,
} from './openEditorTargets.js'

test('rewrite targets preserve the visible Monaco tab order and include every open file', () => {
  const targets = getOpenEditorFixTargetFiles({
    activeFile: 'teee.py',
    openEditorFiles: ['generated_2.py', 'generated_3.py', 'generated.py', 'teee.py'],
  })

  assert.deepEqual(targets, ['generated_2.py', 'generated_3.py', 'generated.py', 'teee.py'])
})

test('rewrite instruction explicitly prevents collapsing multiple open tabs to the active file', () => {
  const targets = ['generated_2.py', 'generated_3.py', 'generated.py', 'teee.py']
  const instruction = buildOpenEditorTargetInstruction('請改善程式碼', targets, '程式碼改寫')

  assert.match(instruction, /不要只處理 active tab/)
  assert.match(instruction, /每一個目標都必須產生.*實際改寫/)
  for (const target of targets) assert.ok(instruction.includes(target))
})

test('fix instruction checks every Monaco file but keeps correct files unchanged with a reason', () => {
  const targets = ['app.py', 'app.js', 'style.css', 'index.html', 'data.db']
  const instruction = buildOpenEditorTargetInstruction('都修正', targets, '錯誤修正')

  assert.match(instruction, /逐一檢查每一個目標檔案/)
  assert.match(instruction, /沒有錯誤就保持內容不變並回報具體原因/)
  assert.match(instruction, /不可只修 active tab/)
  for (const target of targets) assert.ok(instruction.includes(target))
})

test('detect instruction remains read-only when explicit multiple files are targeted', () => {
  const targets = ['calculator.py', 'generated.js']
  const instruction = buildOpenEditorTargetInstruction('只檢查風險，不要修改', targets, '錯誤偵測')

  assert.match(instruction, /只產出錯誤與風險報告/)
  assert.match(instruction, /不可修改檔案、不可產生 Diff/)
  assert.match(instruction, /不可把未列出的檔案納入掃描範圍/)
  assert.doesNotMatch(instruction, /必須產生.*實際改寫/)
})
