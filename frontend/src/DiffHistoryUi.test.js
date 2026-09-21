import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const appSource = fs.readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
const editorSource = fs.readFileSync(new URL('./components/EditorPanel.vue', import.meta.url), 'utf8')

test('App persists and reloads modification difference history', () => {
  assert.match(appSource, /apiGet\(`\/api\/diff\/history\?\$\{query\.toString\(\)\}`\)/)
  assert.match(appSource, /apiPost\('\/api\/diff\/history'/)
  assert.match(appSource, /updatePendingDiffHistoryStatus\('applied'/)
  assert.match(appSource, /updatePendingDiffHistoryStatus\('cancelled'/)
  assert.match(appSource, /updatePendingDiffHistoryStatus\('rolled_back'/)
})

test('Editor modification tab shows selectable past records', () => {
  assert.match(editorSource, /歷史修改記錄/)
  assert.match(editorSource, /v-for="record in historyRecords"/)
  assert.match(editorSource, /formatHistoryTime\(record\.created_at\)/)
  assert.match(editorSource, /historyStatusLabel\(/)
  assert.match(editorSource, /\+{{ record\.additions \|\| 0 }}/)
  assert.match(editorSource, /-{{ record\.removals \|\| 0 }}/)
})
