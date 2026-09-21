const express = require('express')
const path = require('path')
const { logAction } = require('../core/auditLogger')
const { indexWorkspace, retrieveRelevantContext } = require('../services/ragService')
const config = require('../config')

const router = express.Router()

router.post('/index', async (req, res) => {
  const rootDir = req.body.root_dir || path.resolve(process.cwd(), '..')
  try {
    const result = await indexWorkspace(rootDir)
    logAction('admin', 'RAG 建立索引', rootDir, 'system', 0, `成功建立 ${result.files} 個檔案、${result.chunks} 個 chunk 索引`, { service: 'rag_service', status: 'success' })
    res.json({ ok: true, ...result })
  } catch (error) {
    logAction('admin', 'RAG 建立索引', rootDir, 'system', 0, `失敗: ${error.message}`, { service: 'rag_service', status: 'error' })
    res.status(500).json({ ok: false, error: error.message })
  }
})

router.post('/search', async (req, res) => {
  const query = req.body.query || ''
  const limit = req.body.limit || 5
  if (!query) {
    return res.status(400).json({ ok: false, error: '缺少 query 參數' })
  }
  
  try {
    const result = await retrieveRelevantContext(query, limit)
    if (result.ok) {
      logAction('admin', 'RAG 檢索', '', 'system', 0, `成功檢索 ${result.results.length} 筆資料`, { service: 'rag_service', status: 'success' })
      res.json(result)
    } else {
      res.status(500).json(result)
    }
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

module.exports = router
