const fs = require('fs')
const path = require('path')

const CHATS_DIR = path.join(__dirname, '../../data/chats')

function ensureChatsDir() {
  if (!fs.existsSync(CHATS_DIR)) {
    fs.mkdirSync(CHATS_DIR, { recursive: true })
  }
}

function saveChatSession(id, messages, title = '未命名對話') {
  ensureChatsDir()
  const filePath = path.join(CHATS_DIR, `${id}.json`)
  const now = new Date().toISOString()
  
  let existingData = {}
  if (fs.existsSync(filePath)) {
    try {
      existingData = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    } catch (e) {
      console.warn('Failed to parse existing chat file:', filePath)
    }
  }

  const dataToSave = {
    id,
    title: existingData.title && existingData.title !== '未命名對話' ? existingData.title : title,
    createdAt: existingData.createdAt || now,
    updatedAt: now,
    messages
  }

  // Auto-generate title if it's the first user message
  if (dataToSave.title === '未命名對話' && messages && messages.length > 0) {
    const firstUserMsg = messages.find(m => m.role === 'user')
    if (firstUserMsg && firstUserMsg.content) {
      dataToSave.title = firstUserMsg.content.slice(0, 30) + (firstUserMsg.content.length > 30 ? '...' : '')
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2), 'utf8')
  return dataToSave
}

function listChatSessions() {
  ensureChatsDir()
  const files = fs.readdirSync(CHATS_DIR).filter(f => f.endsWith('.json'))
  const sessions = files.map(file => {
    try {
      const content = fs.readFileSync(path.join(CHATS_DIR, file), 'utf8')
      const data = JSON.parse(content)
      return {
        id: data.id,
        title: data.title || '未命名對話',
        createdAt: data.createdAt,
        updatedAt: data.updatedAt
      }
    } catch (e) {
      return null
    }
  }).filter(Boolean)

  // Sort by updatedAt descending
  sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
  return sessions
}

function getChatSession(id) {
  ensureChatsDir()
  const filePath = path.join(CHATS_DIR, `${id}.json`)
  if (!fs.existsSync(filePath)) {
    return null
  }
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(content)
  } catch (e) {
    return null
  }
}

function deleteChatSession(id) {
  ensureChatsDir()
  const filePath = path.join(CHATS_DIR, `${id}.json`)
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
    return true
  }
  return false
}

module.exports = {
  saveChatSession,
  listChatSessions,
  getChatSession,
  deleteChatSession
}
