export const CHAT_CONTEXT_MAX_CHARS = 120000
export const CHAT_AUTO_COMPACT_RATIO = 0.8
export const CHAT_AUTO_COMPACT_THRESHOLD_CHARS = Math.floor(CHAT_CONTEXT_MAX_CHARS * CHAT_AUTO_COMPACT_RATIO)
export const CHAT_RECENT_MESSAGE_COUNT = 16

export function isInitialWelcomeMessage(item = {}, index = -1) {
  return index === 0
    && item?.role === 'assistant'
    && String(item?.content || '').startsWith('已進入 Cubi Code。')
}

function flattenConversationMessages(messages = []) {
  const flattened = []
  for (const message of messages || []) {
    if (message?.type === 'compacted_history' && Array.isArray(message.oldMessages)) {
      flattened.push(...flattenConversationMessages(message.oldMessages))
      continue
    }
    if (message?.content) flattened.push(message)
  }
  return flattened
}

function compactLine(value = '', limit = 320) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

function uniqueRecent(values = [], limit = 10) {
  const seen = new Set()
  const result = []
  for (const value of [...values].reverse()) {
    const clean = compactLine(value)
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    result.push(clean)
    if (result.length >= limit) break
  }
  return result.reverse()
}

function matchingMessageSnippets(messages = [], pattern, limit = 8) {
  return uniqueRecent((messages || [])
    .filter(item => pattern.test(String(item?.content || '')))
    .map(item => item.content), limit)
}

function modifiedFilePaths(messages = []) {
  const filePattern = /(?:^|[\s`'"（(])@?((?:[A-Za-z0-9_.+-]+[\\/])*\.?[A-Za-z0-9_.+-]+\.(?:py|js|jsx|ts|tsx|vue|java|go|cs|php|rs|cpp|c|h|html?|css|json|md|ya?ml|toml|ini|sql|env))/gi
  const paths = []
  for (const item of messages || []) {
    const content = String(item?.content || '')
    if (!/(?:已|成功)?(?:修改|改寫|重構|修正|建立|新增|產生|寫入|套用|儲存|rollback|回復|還原)|modified|created|written|applied|restored/i.test(content)) continue
    let match
    while ((match = filePattern.exec(content)) !== null) paths.push(match[1].replace(/\\/g, '/'))
  }
  return [...new Set(paths)].slice(-24)
}

function section(title, values = [], emptyText = '無明確紀錄') {
  return [
    `## ${title}`,
    ...(values.length ? values.map(value => `- ${compactLine(value, 500)}`) : [`- ${emptyText}`]),
  ].join('\n')
}

export function buildStructuredConversationSummary(messages = [], options = {}) {
  const flattened = flattenConversationMessages(messages)
    .filter((item, index) => !isInitialWelcomeMessage(item, index) && item?.type !== 'plan_approval')
  const userMessages = flattened.filter(item => item.role === 'user')
  const assistantMessages = flattened.filter(item => item.role !== 'user')
  const firstUser = compactLine(userMessages[0]?.content || '', 700)
  const latestUser = compactLine(userMessages.at(-1)?.content || '', 1000)
  const projectGoals = uniqueRecent([
    options.projectGoal,
    firstUser,
    ...matchingMessageSnippets(userMessages, /(?:目標|需求|請|要|希望|建立|開發|修正|分析)/i, 3),
  ], 4)
  const files = [...new Set([...(options.modifiedFiles || []), ...modifiedFilePaths(flattened)])]
  const completed = uniqueRecent([
    ...(options.completedItems || []),
    ...matchingMessageSnippets(assistantMessages, /(?:已完成|完成|成功|通過|已建立|已修改|已修正|已套用|已儲存|PASS)/i, 10),
  ], 10)
  const errors = uniqueRecent([
    ...(options.currentErrors || []),
    ...matchingMessageSnippets(flattened, /(?:錯誤|失敗|異常|警告|FAIL|Error|rollback|回復|找不到|未通過)/i, 8),
  ], 8)
  const todos = uniqueRecent([
    ...(options.todos || []),
    ...matchingMessageSnippets(flattened, /(?:TODO|待辦|尚未|接下來|下一步|需要|需確認|重測|未完成)/i, 8),
  ], 8)
  const keepMessages = Number(options.keepMessages || CHAT_RECENT_MESSAGE_COUNT)

  return [
    '# 對話壓縮 Summary',
    `壓縮規則：固定上限 ${CHAT_CONTEXT_MAX_CHARS.toLocaleString('en-US')} chars；使用量達 ${Math.round(CHAT_AUTO_COMPACT_RATIO * 100)}% 自動壓縮；最近 ${keepMessages} 則對話保留原文。`,
    section('專案目標', projectGoals),
    section('已修改檔案', files, '尚無已修改檔案紀錄'),
    section('已完成事項', completed, '尚無已完成事項紀錄'),
    section('目前錯誤', errors, '目前沒有明確錯誤紀錄'),
    section('TODO', todos, '目前沒有明確 TODO'),
    section('使用者最新需求', latestUser ? [latestUser] : [], '尚無使用者需求'),
  ].join('\n\n')
}

export function buildConversationContextText(messages = [], options = {}) {
  const excludeLatestUser = Boolean(options.excludeLatestUser)
  const lastUserIndex = excludeLatestUser ? messages.map(item => item?.role).lastIndexOf('user') : -1

  return (messages || [])
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => item?.content && !isInitialWelcomeMessage(item, index) && index !== lastUserIndex && item.type !== 'plan_approval')
    .map(({ item, index }) => {
      const roleLabel = item.role === 'user' ? '使用者' : '助手'
      const content = String(item.content || '').trim()
      return `### ${roleLabel} ${index + 1}\n${content}`
    })
    .join('\n\n')
}

export function estimateChatCharsFromMessages(messages = []) {
  return buildConversationContextText(messages).length
}

export function createCompactedChatMessages(messages = [], options = {}) {
  const keepMessages = Math.min(20, Math.max(10, Number(options.keepMessages || CHAT_RECENT_MESSAGE_COUNT)))
  const flattened = flattenConversationMessages(messages)
  const keep = flattened.slice(-keepMessages)
  const old = flattened.slice(0, Math.max(0, flattened.length - keepMessages))
  if (!old.length) return flattened

  const summary = buildStructuredConversationSummary(flattened, { ...options, keepMessages })
  return [{
    role: 'assistant',
    content: summary,
    type: 'compacted_history',
    oldMessages: old,
    compactedAt: new Date().toISOString(),
  }, ...keep]
}

export function shouldAutoCompactChatMessages(messages = [], options = {}) {
  const maxChars = Number(options.maxChars || CHAT_CONTEXT_MAX_CHARS)
  const thresholdRatio = Number(options.thresholdRatio || CHAT_AUTO_COMPACT_RATIO)
  const thresholdChars = Math.floor(maxChars * thresholdRatio)
  const keepMessages = Math.min(20, Math.max(10, Number(options.keepMessages || CHAT_RECENT_MESSAGE_COUNT)))
  const currentUsageChars = Number(options.currentUsageChars ?? estimateChatCharsFromMessages(messages))
  return currentUsageChars >= thresholdChars
    && flattenConversationMessages(messages).length > keepMessages + 2
}
