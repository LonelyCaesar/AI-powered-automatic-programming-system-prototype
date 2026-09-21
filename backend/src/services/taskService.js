const crypto = require('crypto')

const tasks = new Map()

function now() {
  return new Date().toISOString()
}

function createTask({ title = 'Codex Plan Task', instruction = '', plan = '' } = {}) {
  const id = `task_${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(8).toString('hex')}`
  const task = {
    id,
    title,
    instruction,
    plan,
    status: 'pending',
    createdAt: now(),
    updatedAt: now(),
    steps: [
      { label: '1 建立任務', status: 'done', detail: '已建立 Codex 類任務' },
      { label: '2 等待確認', status: 'pending', detail: '尚未接受方案' },
      { label: '3 Agent 執行', status: 'pending', detail: '尚未開始' },
      { label: '4 檔案變更', status: 'pending', detail: '尚未產生' },
      { label: '5 測試 / 結果', status: 'pending', detail: '尚未執行' }
    ],
    commandLogs: [],
    fileChanges: []
  }
  tasks.set(id, task)
  return task
}

function getTask(id) {
  return tasks.get(id) || null
}

function updateTask(id, patch = {}) {
  const task = getTask(id)
  if (!task) return null
  Object.assign(task, patch, { updatedAt: now() })
  tasks.set(id, task)
  return task
}

function appendStep(id, step) {
  const task = getTask(id)
  if (!task) return null
  task.steps.push(step)
  task.updatedAt = now()
  return task
}

function appendCommandLog(id, log) {
  const task = getTask(id)
  if (!task) return null
  task.commandLogs.push({ time: now(), status: 'pending', ...log })
  task.updatedAt = now()
  return task
}

function appendFileChange(id, change) {
  const task = getTask(id)
  if (!task) return null
  task.fileChanges.push({ status: 'modified', ...change })
  task.updatedAt = now()
  return task
}

module.exports = {
  createTask,
  getTask,
  updateTask,
  appendStep,
  appendCommandLog,
  appendFileChange
}
