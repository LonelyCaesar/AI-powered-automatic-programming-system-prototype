import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildMultiFileGenerationInstruction,
  extractNumberedGenerationItems,
  getMultiFileGenerationItems,
} from './generationTargets.js'

test('extracts inline Chinese numbered generation requests', () => {
  const instruction = '1.建立python工具甲、2.建立python工具乙、3.建立python工具丙。每一種建立一個資料檔案，多個程式不能放在同一個資料檔案。'

  assert.deepEqual(extractNumberedGenerationItems(instruction), [
    '建立python工具甲',
    '建立python工具乙',
    '建立python工具丙',
  ])
  assert.equal(getMultiFileGenerationItems(instruction).length, 3)
})

test('does not split a numbered feature checklist for one program', () => {
  const instruction = '建立一個工具，需求：1. 輸入資料、2. 顯示結果、3. 匯出紀錄。'
  assert.deepEqual(getMultiFileGenerationItems(instruction), [])
})

test('adds an explicit same-folder multi-file contract for multi-program generation', () => {
  const items = ['建立 Python 工具甲', '建立 Python 工具乙', '建立 Python 工具丙']
  const result = buildMultiFileGenerationInstruction(items.join('\n'), items)

  assert.match(result, /目前已開啟的同一個資料夾內/)
  assert.match(result, /剛好建立 3 個同層檔案/)
  assert.match(result, /不可建立子資料夾/)
  assert.match(result, /不可把多個程式合併到任何單一共用檔案/)
})
