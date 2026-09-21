const fs = require('fs-extra')
const path = require('path')
const { queryPostgres, executePostgres } = require('../db/postgres')
const { generateEmbeddings } = require('../core/llmClient')
const { getTargetFiles } = require('./relatedContextService')

function chunkFileContent(content, maxChunkLength = 1000, overlap = 100) {
  if (!content) return []
  const lines = content.split('\n')
  const chunks = []
  let currentChunk = ''
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if ((currentChunk.length + line.length + 1) > maxChunkLength && currentChunk.length > 0) {
      chunks.push(currentChunk)
      // overlap
      const prevLines = currentChunk.split('\n')
      currentChunk = prevLines.slice(-Math.max(1, Math.floor(overlap / 50))).join('\n') + '\n' + line
    } else {
      currentChunk += (currentChunk ? '\n' : '') + line
    }
  }
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk)
  }
  return chunks
}

function formatVector(arr) {
  return `[${arr.join(',')}]`
}

async function indexFile(filePath, content, projectRoot) {
  const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, '/')
  const chunks = chunkFileContent(content)
  
  // delete existing chunks for this file
  await executePostgres('DELETE FROM project_file_chunks WHERE file_path = $1', [relativePath])
  
  let indexedCount = 0
  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i]
    const result = await generateEmbeddings(chunkText)
    if (result.ok && result.embeddings && result.embeddings.length > 0) {
      const embeddingArray = result.embeddings[0] || result.embeddings
      await executePostgres(
        'INSERT INTO project_file_chunks (file_path, chunk_index, content, embedding) VALUES ($1, $2, $3, $4)',
        [relativePath, i, chunkText, formatVector(embeddingArray)]
      )
      indexedCount++
    } else {
      console.warn(`[ragService] 檔案 ${relativePath} 的 chunk ${i} embedding 失敗:`, result.error)
    }
  }
  return indexedCount
}

async function indexWorkspace(rootDir) {
  const files = await getTargetFiles(rootDir)
  let totalFiles = 0
  let totalChunks = 0
  
  for (const filePath of files) {
    try {
      const content = await fs.readFile(filePath, 'utf8')
      const chunksIndexed = await indexFile(filePath, content, rootDir)
      totalChunks += chunksIndexed
      totalFiles++
    } catch (err) {
      console.warn(`[ragService] 無法讀取或索引檔案 ${filePath}:`, err.message)
    }
  }
  return { files: totalFiles, chunks: totalChunks }
}

async function retrieveRelevantContext(query, limit = 5) {
  const result = await generateEmbeddings(query)
  if (!result.ok || !result.embeddings || result.embeddings.length === 0) {
    return { ok: false, error: result.error || 'Failed to generate embedding for query' }
  }
  
  const queryVector = formatVector(result.embeddings[0] || result.embeddings)
  
  try {
    // using <=> (cosine distance)
    const rows = await queryPostgres(
      `SELECT file_path, content, embedding <=> $1 AS distance 
       FROM project_file_chunks 
       ORDER BY distance ASC 
       LIMIT $2`,
      [queryVector, limit]
    )
    return { ok: true, results: rows }
  } catch (err) {
    return { ok: false, error: `資料庫查詢失敗: ${err.message}` }
  }
}

module.exports = {
  chunkFileContent,
  indexFile,
  indexWorkspace,
  retrieveRelevantContext
}
