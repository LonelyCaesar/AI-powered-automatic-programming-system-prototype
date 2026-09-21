const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const serviceSource = fs.readFileSync(path.join(__dirname, '../src/services/diffHistoryService.js'), 'utf8')
const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/diff.js'), 'utf8')
const databaseSource = fs.readFileSync(path.join(__dirname, '../src/db/postgres.js'), 'utf8')

test('diff history persists full diff records with PostgreSQL and JSON fallback', () => {
  assert.match(serviceSource, /diff-history\.json/)
  assert.match(serviceSource, /diff_text/)
  assert.match(serviceSource, /old_content/)
  assert.match(serviceSource, /new_content/)
  assert.match(serviceSource, /listDiffHistory/)
  assert.match(serviceSource, /updateDiffHistoryStatus/)
  assert.match(databaseSource, /CREATE TABLE IF NOT EXISTS diff_history/)
})

test('diff route exposes history list, detail, create and status endpoints', () => {
  assert.match(routeSource, /router\.get\('\/history'/)
  assert.match(routeSource, /router\.get\('\/history\/:id'/)
  assert.match(routeSource, /router\.post\('\/history'/)
  assert.match(routeSource, /router\.post\('\/history\/:id\/status'/)
})

function isolatedDiffService(t) {
  const config = require('../src/config')
  const database = require('../src/db/postgres')
  const originalBackendDir = config.backendDir
  const tempBackendDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubi-diff-history-test-'))
  const servicePath = require.resolve('../src/services/diffHistoryService')
  // Exercise real filesystem persistence without touching app data or PostgreSQL.
  config.backendDir = tempBackendDir
  t.mock.method(database, 'executePostgres', async () => ({ rowCount: 0 }))
  delete require.cache[servicePath]
  t.after(() => {
    config.backendDir = originalBackendDir
    delete require.cache[servicePath]
    fs.rmSync(tempBackendDir, { recursive: true, force: true })
  })
  const diffService = require('../src/services/diffHistoryService')
  assert.equal(path.dirname(path.dirname(diffService.DIFFS_DIR)), tempBackendDir)
  return { diffService, tempBackendDir }
}

test('diff history creates records in data/diffs and becomes empty when diffs folder is deleted', async (t) => {
  const { diffService } = isolatedDiffService(t)
  const testId = `test-diff-${Date.now()}`
  
  // 1. Save diff record
  const saved = await diffService.saveDiffHistory({
    id: testId,
    project_name: 'test_project',
    file_path: 'test.py',
    diff_text: '--- a/test.py\n+++ b/test.py\n@@ -1 +1 @@\n-a\n+b',
    old_content: 'a',
    new_content: 'b',
    instruction: 'test diff save',
  })
  assert.equal(saved.id, testId)
  
  // 2. Verify file exists in data/diffs
  const recordFile = path.join(diffService.DIFFS_DIR, `${testId}.json`)
  assert.equal(fs.existsSync(recordFile), true)
  
  // 3. Verify listed
  const list = await diffService.listDiffHistory({ project_name: 'test_project' })
  assert.equal(list.some(r => r.id === testId), true)
  
  // 4. Update status
  const updated = await diffService.updateDiffHistoryStatus(testId, 'applied')
  assert.equal(updated.status, 'applied')
  
  // 5. Delete single record
  const deleted = await diffService.deleteDiffHistory(testId)
  assert.equal(deleted, true)
  assert.equal(fs.existsSync(recordFile), false)

  // 6. Test folder deletion logic (same as chats folder):
  // When backend/data/diffs folder is removed, listDiffHistory returns empty array
  const tempId = `test-folder-delete-${Date.now()}`
  await diffService.saveDiffHistory({
    id: tempId,
    project_name: 'test_folder_project',
    file_path: 'folder_test.py',
    diff_text: '--- a/folder_test.py\n+++ b/folder_test.py\n@@ -1 +1 @@\n-1\n+2',
  })
  assert.equal(fs.existsSync(path.join(diffService.DIFFS_DIR, `${tempId}.json`)), true)
  
  // Now delete diffs folder
  fs.rmSync(diffService.DIFFS_DIR, { recursive: true, force: true })
  
  // List must be empty
  const emptyList = await diffService.listDiffHistory({ project_name: 'test_folder_project' })
  assert.equal(emptyList.length, 0)
})

test('diff history rejects IDs that escape its storage directory for every operation', async (t) => {
  const { diffService, tempBackendDir } = isolatedDiffService(t)
  const outsideFile = path.join(tempBackendDir, 'data', 'outside.json')
  fs.mkdirSync(diffService.DIFFS_DIR, { recursive: true })
  const original = JSON.stringify({ id: 'outside', diff_text: 'keep this record' })
  fs.writeFileSync(outsideFile, original)
  for (const id of ['../outside', '..\\outside', 'C:\\outside', '/outside', 'nested/record', 'x'.repeat(81)]) {
    const invalidId = error => error.statusCode === 400 && /id/i.test(error.message)
    await assert.rejects(diffService.getDiffHistory(id), invalidId)
    await assert.rejects(diffService.saveDiffHistory({ id, diff_text: 'replacement' }), invalidId)
    await assert.rejects(diffService.updateDiffHistoryStatus(id, 'applied'), invalidId)
    await assert.rejects(diffService.deleteDiffHistory(id), invalidId)
  }
  assert.equal(fs.readFileSync(outsideFile, 'utf8'), original)
  assert.deepEqual(fs.readdirSync(diffService.DIFFS_DIR), [])
})
