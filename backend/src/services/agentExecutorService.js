const { appendCommandLog, appendFileChange, appendStep, updateTask } = require('./taskService')

async function executeAcceptedPlan({ taskId, planMessage = {}, dryRun = true } = {}) {
  appendStep(taskId, { label: '接受方案', status: 'done', detail: '使用者已按接受方案並執行' })
  appendCommandLog(taskId, {
    command: 'agent executor start',
    status: 'done',
    statusLabel: dryRun ? '展示級流程啟動' : '執行中'
  })

  const files = Array.isArray(planMessage.files) ? planMessage.files : []
  for (const file of files) {
    appendFileChange(taskId, {
      path: file,
      status: 'planned',
      description: '依 AI 實作方案預計新增或修改'
    })
  }

  appendStep(taskId, { label: '檔案變更清單', status: 'done', detail: `已整理 ${files.length} 個可能影響檔案` })
  appendStep(taskId, { label: '等待前端流程', status: 'pending', detail: '前端會接續呼叫 create-files / fix-and-test / run-tests' })

  return updateTask(taskId, {
    status: dryRun ? 'review_ready' : 'running'
  })
}

module.exports = {
  executeAcceptedPlan
}
