const express = require('express')
const prettier = require('prettier')

const router = express.Router()

const parserByLanguage = {
  javascript: 'babel',
  typescript: 'typescript',
  json: 'json',
  html: 'html',
  css: 'css',
  markdown: 'markdown',
}

const parserByExtension = {
  js: 'babel',
  jsx: 'babel',
  mjs: 'babel',
  cjs: 'babel',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  html: 'html',
  htm: 'html',
  css: 'css',
  md: 'markdown',
}

function getExtension(filePath = '') {
  const clean = String(filePath || '').split(/[\\/]/).pop() || ''
  const index = clean.lastIndexOf('.')
  return index >= 0 ? clean.slice(index + 1).toLowerCase() : ''
}

function resolveParser(filePath = '', language = '') {
  const normalizedLanguage = String(language || '').toLowerCase()
  return parserByLanguage[normalizedLanguage] || parserByExtension[getExtension(filePath)] || ''
}

router.post('/', async (req, res) => {
  const code = String(req.body.code ?? '')
  const filePath = req.body.filePath || req.body.file_path || ''
  const language = req.body.language || req.body.language_id || ''
  const parser = resolveParser(filePath, language)

  if (!code.trim()) {
    return res.json({ ok: false, formatted: '', parser: '', error: '沒有可格式化的程式碼。' })
  }

  if (!parser) {
    return res.json({
      ok: false,
      formatted: code,
      parser: '',
      error: '目前只支援 JavaScript、TypeScript、JSON、HTML、CSS、Markdown 的真實格式化；Python 需安裝 Black、Java 需安裝 google-java-format 才會執行。',
    })
  }

  try {
    const formatted = await prettier.format(code, {
      parser,
      semi: false,
      singleQuote: true,
      tabWidth: 2,
      printWidth: 100,
    })
    res.json({ ok: true, formatted, parser })
  } catch (error) {
    res.status(400).json({
      ok: false,
      formatted: code,
      parser,
      error: error.message || 'Prettier 格式化失敗。',
    })
  }
})

module.exports = router
