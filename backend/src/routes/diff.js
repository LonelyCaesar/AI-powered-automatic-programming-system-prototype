const express = require('express')
const { logAction } = require('../core/auditLogger')
const { makeInlineDiff, makeInlineDiffFromContent, applyInlineEdit } = require('../services/codingServices')
const {
  saveDiffHistory,
  listDiffHistory,
  getDiffHistory,
  updateDiffHistoryStatus,
  deleteDiffHistory,
} = require('../services/diffHistoryService')

const router = express.Router()

function resultText(result) {
  return result.ok === false ? `失敗：${result.error || result.source || '未產生 Diff'}` : '成功'
}

router.get('/history', async (req, res) => {
  try {
    const records = await listDiffHistory({
      limit: req.query.limit,
      project_name: req.query.project_name || '',
    })
    res.json({ ok: true, records })
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, error: error.message })
  }
})

router.get('/history/:id', async (req, res) => {
  try {
    const record = await getDiffHistory(req.params.id)
    if (!record) return res.status(404).json({ ok: false, error: '找不到修改差異紀錄' })
    res.json({ ok: true, record })
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, error: error.message })
  }
})

router.post('/history', async (req, res) => {
  try {
    const record = await saveDiffHistory(req.body || {})
    res.json({ ok: true, record })
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, error: error.message })
  }
})

router.post('/history/:id/status', async (req, res) => {
  try {
    const record = await updateDiffHistoryStatus(req.params.id, req.body?.status, {
      note: req.body?.note,
      metadata: req.body?.metadata,
    })
    if (!record) return res.status(404).json({ ok: false, error: '找不到修改差異紀錄' })
    res.json({ ok: true, record })
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, error: error.message })
  }
})

router.delete('/history/:id', async (req, res) => {
  try {
    const deleted = await deleteDiffHistory(req.params.id)
    if (!deleted) return res.status(404).json({ ok: false, error: '找不到歷史修改記錄' })
    res.json({ ok: true, deleted: true, id: req.params.id })
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, error: error.message })
  }
})

router.post('/generate', async (req, res) => {
  let result
  try {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'code')) {
      result = await makeInlineDiffFromContent(req.body.file_path, req.body.instruction || '', req.body.code || '', '', req.body.context_files || [])
    } else {
      result = await makeInlineDiff(req.body.file_path, req.body.instruction || '')
    }
  } catch (error) {
    result = { ok: false, file_path: req.body.file_path, old_content: req.body.code || '', new_content: req.body.code || '', diff: '', model: 'local_ollama', source: 'node_diff_route_guard', tokens: 0, error: `Diff 產生失敗：${error.message}` }
  }
  logAction('admin', 'Inline Edit / Diff', req.body.file_path || '', result.model || 'system', result.tokens || 0, resultText(result), { service: result.source || 'node_local_ollama', detail: '依目前開啟檔案產生紅綠 Diff，等待人工確認後才套用。', status: result.ok === false ? 'failed' : 'success' })
  res.json(result)
})

router.post('/apply', (req, res) => {
  try {
    const result = applyInlineEdit(req.body.file_path, req.body.new_content || '')
    logAction('admin', '套用 Diff', req.body.file_path || '', 'system', 0, '成功', { service: 'node_file_system', detail: '使用者確認後套用 Diff 到檔案。' })
    res.json(result)
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, error: error.message, detail: error.message })
  }
})

module.exports = router
