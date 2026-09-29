<template>
  <div class="card result-card">
    <div class="panel-body" :class="{ 'panel-body-terminal': activeTab === 'terminal' }">
      <div v-show="activeTab === 'terminal'" class="terminal-panel">
        <TerminalPanel
          :key="`${projectName || 'project'}-${terminalWorkspaceId}`"
          :project-name="projectName"
          :current-file="filePath"
          :current-content="fileContent"
          :files="files"
          :initial-command="terminalCommand"
          :initial-workspace-id="terminalWorkspaceId"
          :auto-start="false"
        />
      </div>

      <div v-if="activeTab === 'diff'" class="diff-panel">
        <div v-if="diffRows.length" class="diff-wrap">
          <div class="diff-success-banner">
            <div>
              <b>✅ 修改差異已產生</b>
              <span>原始檔尚未覆蓋，請確認修改內容後再套用。</span>
            </div>
            <strong>{{ diffStats.status }}</strong>
          </div>

          <div class="diff-meta-grid">
            <div class="diff-meta-card targets">
              <span>實際修改檔案（{{ diffTargetFiles.length }}）</span>
              <b>{{ diffTargetLabel }}</b>
            </div>
            <div class="diff-meta-card add">
              <span>新增行數</span>
              <b>+{{ diffStats.additions }}</b>
            </div>
            <div class="diff-meta-card remove">
              <span>刪除行數</span>
              <b>-{{ diffStats.removals }}</b>
            </div>
            <div class="diff-meta-card">
              <span>來源 / 模型</span>
              <b>{{ diffStats.sourceLabel }}</b>
            </div>
          </div>



          <div v-if="showAgentFlow" class="agent-flow-card">
            <div class="agent-flow-head">
              <b>AI 完整流程</b>
              <span>讀檔 → 產生修改建議 → 產生修改差異 → 套用 → 執行測試 → 顯示結果</span>
            </div>
            <div class="agent-flow-steps">
              <div
                v-for="(step, index) in displayAgentSteps"
                :key="`${step.label}-${index}`"
                class="agent-flow-step"
                :class="agentStepClass(step.status)"
              >
                <span class="step-dot">{{ step.status === 'done' ? '✓' : step.status === 'failed' ? '!' : index + 1 }}</span>
                <b>{{ step.label }}</b>
                <small>{{ step.detail }}</small>
              </div>
            </div>
          </div>

          <div class="diff-file-label">多檔修改差異：{{ diffTargetLabel }}</div>
          <div class="diff-grid">
            <div class="diff-col diff-old">
              <div class="diff-head">{{ oldFileLabel }}</div>
              <div
                v-for="(row, index) in diffRows"
                :key="`old-${index}`"
                class="diff-row"
                :class="diffSideRowClass(row, 'old')"
              >
                <span class="diff-line-no" :class="{ 'changed-line-no': isChangedDiffLine(row, 'old') }">{{ row.oldNo || '' }}</span>
                <span class="diff-mark">{{ row.oldMark || ' ' }}</span>
                <code>{{ row.oldText }}</code>
              </div>
            </div>

            <div class="diff-col diff-new">
              <div class="diff-head">{{ newFileLabel }}</div>
              <div
                v-for="(row, index) in diffRows"
                :key="`new-${index}`"
                class="diff-row"
                :class="diffSideRowClass(row, 'new')"
              >
                <span class="diff-line-no" :class="{ 'changed-line-no': isChangedDiffLine(row, 'new') }">{{ row.newNo || '' }}</span>
                <span class="diff-mark">{{ row.newMark || ' ' }}</span>
                <code>{{ row.newText }}</code>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="empty-state diff-empty">
          <b>目前沒有尚未套用的修改差異。</b>
          <span>若剛完成套用，請查看「測試 / AI 執行結果」或「操作紀錄」確認驗證結果；唯讀分析不會產生差異。</span>
        </div>
      </div>

      <div v-else-if="activeTab === 'test'" class="test-panel">
        <div class="success-banner" :class="{ danger: testResult && !testResult.ok, neutral: !testResult && !resultLoading, running: resultLoading }">
          <span v-if="resultLoading" class="result-running"><i></i>正在執行 / 開啟，請稍候...</span>
          <span v-else-if="hasAgentFlowWithoutResult">AI 流程尚未產生可套用結果，未執行沙盒測試</span>
          <span v-else-if="!testResult">尚未執行 AI 檢查或測試</span>
          <span v-else-if="isCreateFilesResult && testResult.ok">✅ 檔案處理完成！（本次新增 {{ testResult.createdCount ?? testUi.passed }} 個）</span>
          <span v-else-if="isInteractiveAppResult && testResult.ok">✅ 已辨識 {{ interactiveAppLabel }}，正在本網頁終端機自動執行</span>
          <span v-else-if="isTerminalHintResult && testResult.ok">✅ 已判斷執行方式，正在本網頁「終端機」分頁執行</span>
          <span v-else-if="isAppLaunchResult && testResult.ok">✅ 已開啟，可直接使用</span>
          <span v-else-if="isFrontendStaticResult && testResult.ok">✅ 前端靜態檔案檢查通過<span v-if="hasJsSyntaxPass">；JS 語法檢查通過</span></span>
          <span v-else-if="isMultiFileResult && testResult.ok">✅ 已逐檔驗證全部 {{ testUi.total }} 個修改檔案</span>
          <span v-else-if="isPythonGuiResult && testResult.ok">✅ Python GUI 已在 Docker / Xvfb 完成隔離啟動驗證</span>
          <span v-else-if="isLongRunningPythonResult && testResult.ok">✅ 長時間執行程式已完成 {{ longRunningSmokeSeconds }} 秒真實存活與輸出驗證</span>
          <span v-else-if="isNoTestCommandResult && testResult.ok">未設定可執行測試，未執行 pytest</span>
          <span v-else-if="testResult.ok">✅ 所有測試通過！（{{ testUi.passed }} / {{ testUi.total }}）</span>
          <span v-else>⚠️ 測試尚未完全通過（通過 {{ testUi.passed }}，失敗 {{ testUi.failed }}）</span>
          <b v-if="testResult">{{ isCreateFilesResult ? '處理時間' : '執行時間' }}：{{ formatSeconds(testUi.elapsed) }}</b>
        </div>

        <div v-if="sandboxData" class="sandbox-status-card" :class="{ danger: testResult && !testResult.ok }">
          <div>
            <b>{{ isMultiFileResult ? '多檔 Docker 逐檔驗證' : isInteractiveAppResult ? `${interactiveAppLabel}執行` : isTerminalHintResult ? 'AI Sandbox 執行' : isAppLaunchResult ? '程式開啟 / 執行' : isPythonGuiResult ? 'Python GUI Docker 驗證' : isLongRunningPythonResult ? '長時間程式真實存活測試' : isFrontendStaticResult ? '前端靜態檢查' : sandboxData.isolated ? '隔離環境測試' : '測試' }}</b>
            <span>{{ sandboxStatusText }}</span>
          </div>
          <div class="sandbox-meta-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-top: 10px; padding: 10px; background: rgba(0,0,0,0.02); border-radius: 6px;">
            <span><b>沙盒引擎：</b><code>{{ sandboxData.engine || 'docker' }}</code></span>
            <span><b>隔離執行：</b><span>{{ sandboxData.isolated ? '✅ 是 (Isolated)' : '❌ 否 (Local)' }}</span></span>
            <span><b>退出碼 (Exit Code)：</b><code>{{ testResult.exitCode ?? testResult.returncode ?? '未提供' }}</code></span>
            <span v-if="isFrontendStaticResult"><b>檢查方式：</b>HTML / CSS / JavaScript</span>
            <span v-if="isAppLaunchResult"><b>啟動方式：</b>{{ launchTypeLabel }}</span>
            <span v-if="isPythonGuiResult"><b>啟動方式：</b>Docker + Xvfb 無頭啟動驗證</span>
            <span v-if="sandboxData.auto_install"><b>套件處理：</b>自動安裝 requirements.txt / package.json 與缺少套件</span>
          </div>
          <small v-if="sandboxData.error || sandboxData.warning" style="display: block; margin-top: 5px; color: #ef4444;">{{ sandboxData.error || sandboxData.warning }}</small>
        </div>

        <div v-if="showAgentFlow" class="agent-flow-card test-flow-card">
          <div class="agent-flow-head">
            <b>{{ !testResult ? 'AI 流程狀態' : testResult.ok ? '實際執行證據' : '實際失敗證據' }}</b>
            <span>{{ executionEvidenceLabel }}</span>
          </div>
          <div class="agent-flow-steps">
            <div
              v-for="(step, index) in displayAgentSteps"
              :key="`test-${step.label}-${index}`"
              class="agent-flow-step"
              :class="agentStepClass(step.status)"
            >
              <span class="step-dot">{{ step.status === 'done' ? '✓' : step.status === 'failed' ? '!' : index + 1 }}</span>
              <b>{{ step.label }}</b>
              <small>{{ step.detail }}</small>
            </div>
          </div>
        </div>


        <div v-if="displayCreatedFiles.length" class="created-files-card">
          <b>{{ isCreateFilesResult ? '自動建立 / 修改檔案成果' : 'AI 額外套用檔案' }}</b>
          <div class="created-files-grid">
            <div v-for="item in displayCreatedFiles" :key="item.path" class="created-file-item" :class="`file-${item.status || 'created'}`">
              <span>{{ item.status === 'skipped' ? '已存在，未重複新增' : item.status === 'overwritten' ? '已覆寫' : '本次新增成功' }}</span>
              <code>{{ item.path }}</code>
              <small>{{ item.kind }}｜{{ item.description }}</small>
            </div>
          </div>
        </div>

        <div v-if="testResult" class="test-command-grid">
          <div class="command-card">
            <div class="muted">{{ isCreateFilesResult ? '執行動作' : isTerminalHintResult || isAppLaunchResult ? '執行 / 開啟指令' : '測試指令' }}</div>
            <code>{{ testUi.command }}</code>
          </div>
          <div class="pass-rate-card">
            <div class="muted">通過率</div>
            <strong>{{ testUi.passRate }}%</strong>
            <div class="progress"><span :style="{ width: `${testUi.passRate}%` }"></span></div>
          </div>
        </div>

        <div v-if="testResult" class="metric-grid">
          <div class="metric-card"><div class="muted">{{ isCreateFilesResult ? '檔案數' : isTerminalHintResult || isAppLaunchResult ? '執行數' : '測試數' }}</div><strong>{{ testUi.total }}</strong></div>
          <div class="metric-card metric-ok"><div class="muted">{{ isCreateFilesResult ? '本次新增' : isTerminalHintResult ? '已送出' : isAppLaunchResult ? '已開啟' : '通過' }}</div><strong>{{ testUi.passed }}</strong></div>
          <div class="metric-card metric-fail"><div class="muted">失敗</div><strong>{{ testUi.failed }}</strong></div>
          <div class="metric-card"><div class="muted">執行時間</div><strong>{{ formatSeconds(testUi.elapsed) }}</strong></div>
        </div>

        <div class="agent-summary">
          <b>AI 執行摘要</b>
          <ul v-if="testResult">
            <li v-if="isCreateFilesResult">AI 已依本次需求建立、修改或檢查 {{ displayCreatedFiles.length }} 個檔案。</li>
            <li v-else-if="testResult.applied">已依使用者確認套用檔案：{{ testResult.filePath }}</li>
            <li v-else-if="testResult.type === 'agent_fix_and_test' && testResult.noChange">檔案已符合規則，AI 未重複修改。</li>
            <li v-else-if="testResult.type === 'agent_fix_and_test'">AI 已嘗試產生修正，但目前沒有可套用的修改差異。</li>
            <li v-if="isInteractiveAppResult">系統已辨識 {{ interactiveAppLabel }}，並在 AI Docker Sandbox 啟動隔離服務。</li>
            <li v-else-if="isTerminalHintResult">系統已判斷執行方式；AI 測試與一般使用者終端機彼此獨立。</li>
            <li v-if="isAppLaunchResult">系統已依檔案類型改成直接啟動 / 開啟，不再只做 pytest 測試。</li>
            <li v-if="isAppLaunchResult">{{ appLaunchSummary }}</li>
            <li v-if="isFrontendStaticResult">HTML / CSS / JavaScript 專案未產生 pytest 測試檔。</li>
            <li v-if="isFrontendStaticResult">已檢查 index.html、style.css、script.js 與 HTML 資源引用。</li>
            <li v-if="hasJsSyntaxPass">JS 語法檢查通過。</li>
            <li v-if="isPythonGuiResult">偵測到 tkinter / GUI 程式，已在 Docker 容器內用 Xvfb 驗證，不會直接使用主機 Python。</li>
            <li v-if="isLongRunningPythonResult">程式已在 Docker 中實際執行；系統只在持續存活且產生輸出後，才將受控停止視為通過。</li>
            <li v-if="!isCreateFilesResult && !isTerminalHintResult && !isAppLaunchResult && !isFrontendStaticResult && !isNoTestCommandResult && !isPythonGuiResult && !isLongRunningPythonResult">實際執行 {{ executionKindLabel }}，結果來自 Docker 沙盒。</li>
            <li v-if="isCreateFilesResult">左側檔案總管已重新整理，可直接點選相關檔案查看處理後內容。</li>
            <li>{{ resultOutcomeSummary }}</li>
            <li>{{ resultScopeNotice }}</li>
          </ul>
          <div v-if="testResult?.agentMessage" class="empty-small">{{ testResult.agentMessage }}</div>
          <div v-else-if="hasAgentFlowWithoutResult" class="empty-small">AI 修改流程沒有產生可套用差異，因此尚未進入沙盒測試；請依右側訊息或目前檔案內容調整後再執行。</div>
          <div v-else-if="!testResult" class="empty-small">按右上「在 AI 沙盒執行」，系統會依目前檔案與專案設定選擇語法檢查、測試或啟動方式，並在此顯示指令、結果及錯誤。</div>
        </div>

        <div v-if="testResult?.stdout" class="output-section" style="margin-top: 15px;">
          <div class="section-title" style="font-weight: bold; margin-bottom: 5px; color: #475569;">標準輸出 (stdout)</div>
          <pre class="terminal stdout-terminal" style="background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 8px; overflow-x: auto; font-family: monospace;">{{ testResult.stdout }}</pre>
        </div>
        <div v-if="displayStderr" class="output-section" style="margin-top: 15px;">
          <div class="section-title" style="font-weight: bold; margin-bottom: 5px; color: #ef4444;">標準錯誤 (stderr)</div>
          <pre class="terminal stderr-terminal" style="background: #0f172a; color: #fca5a5; padding: 12px; border-radius: 8px; border-left: 4px solid #ef4444; overflow-x: auto; font-family: monospace;">{{ displayStderr }}</pre>
        </div>
      </div>


      <div v-else-if="activeTab === 'audit'" class="audit-panel">
        <div v-if="normalizedLogs.length" class="audit-real-list">
          <table class="audit-table">
            <thead>
              <tr>
                <th>時間</th><th>使用者</th><th>操作</th><th>檔案</th><th>模型 / 服務</th><th>Token</th><th>pytest 結果</th><th>結果</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(log, index) in normalizedLogs" :key="log.id || index" :class="{ selected: index === 0 }">
                <td>{{ formatAuditTime(log.created_at) }}</td>
                <td>{{ log.user }}</td>
                <td>{{ log.operation }}</td>
                <td>{{ log.file_path }}</td>
                <td>{{ log.model }}</td>
                <td>{{ log.token_count }}</td>
                <td>{{ log.pytest_result }}</td>
                <td><span class="ok-dot" :class="log.status === 'failed' || String(log.result).startsWith('失敗') ? 'dot-bad' : 'dot-ok'"></span>{{ log.result }}</td>
              </tr>
            </tbody>
          </table>

          <div class="audit-detail">
            <div class="detail-title">操作詳情（ID: {{ selectedLog.id || '-' }}）</div>
            <div class="detail-grid">
              <div><b>操作 ID：</b><span>{{ selectedLog.id || '-' }}</span></div>
              <div><b>服務：</b><span>{{ selectedLog.service || '-' }}</span></div>
              <div><b>描述：</b><span>{{ selectedLog.detail || detailDescription }}</span></div>
              <div><b>耗時：</b><span>{{ selectedLog.elapsed || '0 秒' }}</span></div>
              <div><b>模型：</b><span>{{ selectedLog.model || '-' }}</span></div>
              <div><b>Token 使用：</b><span>Prompt {{ selectedLog.prompt_tokens || 0 }} / Completion {{ selectedLog.completion_tokens || 0 }} / Total {{ selectedLog.token_count || 0 }}</span></div>
              <div><b>pytest 結果：</b><span>{{ selectedLog.pytest_result || '-' }}</span></div>
              <div><b>狀態：</b><span>{{ selectedLog.status || 'success' }}</span></div>
            </div>
          </div>
        </div>
        <div v-else class="empty-state">
          <b>目前沒有操作紀錄。</b>
          <span>完成 AI 分析、檔案變更、測試或執行操作後，這裡會顯示時間、目標檔案、模型／服務與結果。</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import TerminalPanel from './TerminalPanel.vue'
import AgentStepsPanel from './AgentStepsPanel.vue'
import CommandLogPanel from './CommandLogPanel.vue'
import FileChangesPanel from './FileChangesPanel.vue'
import { testFailureRepairBlockReason, visibleResultStderr } from '../utils/projectFix'

  const props = defineProps({
    filePath: String,
    fileContent: { type: String, default: '' },
    files: { type: Array, default: () => [] },
    projectName: String,
    projectId: String,
  activeTab: String,
  diffText: String,
  canApply: Boolean,
    testResult: Object,
    auditLogs: Array,
    loading: Boolean,
    approvalMode: Boolean,
    diffInfo: Object,
    agentSteps: { type: Array, default: () => [] },
  createdFiles: { type: Array, default: () => [] },
  commandLogs: { type: Array, default: () => [] },
  fileChanges: { type: Array, default: () => [] }
})

  defineEmits(['tab', 'run-tests', 'fix-failure', 'apply', 'cancel', 'clear-audit'])
  
  const resultLoading = computed(() => Boolean(props.loading))
  const autoFixBlockReason = computed(() => testFailureRepairBlockReason(props.testResult || {}))
const displayStderr = computed(() => visibleResultStderr(props.testResult || {}))

function pad2(value) {
  return String(value).padStart(2, '0')
}

function formatDateObject(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

function formatAuditTime(value) {
  if (!value) return '-'
  const text = String(value).trim()
  if (!text || text === '-') return '-'

  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(text)) {
    return text
  }

  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text}Z`
    : text
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return text.replace('T', ' ')
  return formatDateObject(date)
}

const normalizedLogs = computed(() => (props.auditLogs || []).map(log => ({
  id: log.operation_id || log.id,
  created_at: log.created_at || log.time || '-',
  user: log.user || log.username || 'admin',
  operation: log.operation || log.action || '-',
  file_path: log.file_path || props.filePath || '-',
  model: log.model || log.service || '-',
  service: log.service || log.model || '-',
  token_count: log.token_count ?? log.tokens ?? 0,
  prompt_tokens: log.prompt_tokens ?? 0,
  completion_tokens: log.completion_tokens ?? 0,
  pytest_result: log.pytest_result || '-',
  result: log.result || '-',
  status: log.status || 'success',
  detail: log.detail || log.result || '',
  elapsed: (log.elapsed || log.elapsed_seconds) ? `${log.elapsed || log.elapsed_seconds} 秒` : '0 秒'
})))

const selectedLog = computed(() => normalizedLogs.value[0] || {})
const detailDescription = computed(() => `依需求處理 ${props.filePath?.split('/').pop() || '目前檔案'}，並記錄模型呼叫、Token 與操作結果。`)
const diffTargetFiles = computed(() => {
  const paths = Array.isArray(props.diffInfo?.modifiedFiles) && props.diffInfo.modifiedFiles.length
    ? props.diffInfo.modifiedFiles
    : (Array.isArray(props.diffInfo?.targetFiles) && props.diffInfo.targetFiles.length
        ? props.diffInfo.targetFiles
        : [props.diffInfo?.filePath || props.filePath])
  return [...new Set(paths.map(path => String(path || '').trim()).filter(Boolean))]
})
const diffTargetLabel = computed(() => diffTargetFiles.value.join('、') || '目前檔案')
const oldFileLabel = computed(() => firstDiffHeader(props.diffText, '---') || `--- a/${props.filePath || '目前檔案'}`)
const newFileLabel = computed(() => firstDiffHeader(props.diffText, '+++') || `+++ b/${props.filePath || '目前檔案'}`)
const diffRows = computed(() => parseUnifiedDiff(props.diffText || ''))
const showAgentFlow = computed(() => props.approvalMode || Boolean(props.agentSteps?.length) || ['agent_apply_and_test', 'agent_create_files'].includes(props.testResult?.type))
const displayAgentSteps = computed(() => {
  if (props.agentSteps?.length) return props.agentSteps
  if (props.testResult?.steps?.length) return props.testResult.steps
  return []
})
const hasAgentFlowWithoutResult = computed(() => !props.testResult && Boolean(displayAgentSteps.value.length))
const isCreateFilesResult = computed(() => props.testResult?.type === 'agent_create_files')
const isMultiFileResult = computed(() => props.testResult?.testKind === 'multi_file')
const isFrontendStaticResult = computed(() => props.testResult?.testKind === 'frontend_static')
const isPythonGuiResult = computed(() => props.testResult?.testKind === 'python_gui' || props.testResult?.sandbox?.launch_type === 'gui_web_app')
const isLongRunningPythonResult = computed(() => props.testResult?.testKind === 'python_long_running')
const longRunningSmokeSeconds = computed(() => Number(props.testResult?.sandbox?.smoke_seconds || 3))
const isAppLaunchResult = computed(() => props.testResult?.testKind === 'app_launch' || props.testResult?.sandbox?.engine === 'app_launcher')
const isNoTestCommandResult = computed(() => props.testResult?.testKind === 'no_test_command')
const isTerminalHintResult = computed(() => props.testResult?.testKind === 'terminal_hint' || props.testResult?.sandbox?.launch_type === 'terminal_hint' || /右下方.*終端機|不會用系統預設程式開啟/.test(String(props.testResult?.stdout || props.testResult?.agentMessage || '')))
const isInteractiveAppResult = computed(() => isTerminalHintResult.value && Boolean(props.testResult?.sandbox?.interactive))
const interactiveAppLabel = computed(() => {
  const framework = String(props.testResult?.sandbox?.framework || '').toLowerCase()
  if (framework === 'streamlit') return 'Streamlit 網頁應用'
  return '互動式程式'
})
const terminalCommand = computed(() => isTerminalHintResult.value ? String(props.testResult?.command || '').trim() : '')
const terminalWorkspaceId = computed(() => String(props.testResult?.sandbox?.workspace_id || props.projectId || 'default-project').trim())
const hasJsSyntaxPass = computed(() => (props.testResult?.messages || []).includes('JS 語法檢查通過'))
const displayCreatedFiles = computed(() => props.createdFiles?.length ? props.createdFiles : (props.testResult?.createdFiles || props.testResult?.extraFiles || []))
const displayCommandLogs = computed(() => {
  if (props.commandLogs?.length) return props.commandLogs
  const command = props.testResult?.command
  if (command) {
    return [{
      time: '最後執行',
      command,
      status: props.testResult?.ok ? 'done' : 'failed',
      statusLabel: props.testResult?.ok ? '完成' : '失敗'
    }]
  }
  return []
})
const displayFileChanges = computed(() => {
  if (props.fileChanges?.length) return props.fileChanges
  if (displayCreatedFiles.value.length) {
    return displayCreatedFiles.value.map(item => ({
      ...item,
      status: item.status || 'created'
    }))
  }
  if (diffTargetFiles.value.length) {
    return diffTargetFiles.value.map(path => ({
      path,
      status: props.diffText ? 'modified' : 'planned',
      description: props.diffText ? '已產生 Diff，等待套用' : '預計處理檔案',
    }))
  }
  if (props.diffInfo?.filePath || props.filePath) {
    return [{
      path: props.diffInfo?.filePath || props.filePath,
      status: props.diffText ? 'modified' : 'planned',
      description: props.diffText ? '已產生 Diff，等待套用' : '目前開啟 / 預計處理檔案'
    }]
  }
  return []
})
const showCodexExecutionDashboard = computed(() => Boolean(displayAgentSteps.value.length || displayCommandLogs.value.length || displayFileChanges.value.length))
const sandboxData = computed(() => props.testResult?.sandbox || null)

const executionKindLabel = computed(() => {
  const kind = String(props.testResult?.testKind || '')
  const labels = {
    pytest: 'pytest',
    python: 'Python 程式',
    python_syntax: 'Python 語法檢查',
    python_implementation: 'Python 未完成實作檢查',
    node: 'Node.js 程式',
    node_syntax: 'Node.js 語法檢查',
    npm_test: 'npm test',
    npm_build: 'npm run build',
    java: 'Java 編譯與執行',
    database: '資料庫驗證',
    project_check: '專案檢查',
  }
  return labels[kind] || kind || '顯示的測試指令'
})

const executionEvidenceLabel = computed(() => {
  if (!props.testResult) return hasAgentFlowWithoutResult.value ? '尚未進入測試階段' : '尚無執行結果'
  const exitCode = props.testResult.exitCode ?? props.testResult.returncode
  const result = props.testResult.ok ? '通過' : '失敗'
  return `${result}｜退出碼 ${exitCode ?? '未提供'}｜通過 ${testUi.value.passed}｜失敗 ${testUi.value.failed}`
})

const resultOutcomeSummary = computed(() => {
  if (!props.testResult) return '尚無執行結果。'
  if (!props.testResult.ok) return '實際執行失敗；請依退出碼與原始 stderr 判斷原因。'
  if (isMultiFileResult.value) return `已對 ${testUi.value.total} 個實際修改檔案逐一執行驗證；通過 ${testUi.value.passed}，失敗 ${testUi.value.failed}。`
  if (isCreateFilesResult.value) return '建立 / 修改檔案流程完成；實際檔案清單如上。'
  if (isInteractiveAppResult.value) return `${interactiveAppLabel.value}已在 AI Sandbox 啟動。`
  if (isTerminalHintResult.value) return 'AI Sandbox 已準備執行畫面顯示的指令。'
  if (isAppLaunchResult.value) return '程式或網站已完成啟動步驟。'
  if (isFrontendStaticResult.value) return '前端必要檔案、資源引用與已列出的語法檢查通過。'
  if (isPythonGuiResult.value) return 'Python GUI 已通過容器內無頭啟動驗證。'
  if (isLongRunningPythonResult.value) return `程式在 Docker 內持續執行 ${longRunningSmokeSeconds.value} 秒，並產生了上方顯示的真實 stdout。`
  if (props.testResult.testKind === 'pytest') return `已執行 ${testUi.value.total} 項 pytest；通過 ${testUi.value.passed}，失敗 ${testUi.value.failed}。`
  return `畫面顯示的指令已執行完成，退出碼為 ${props.testResult.exitCode ?? props.testResult.returncode ?? '未提供'}。`
})

const resultScopeNotice = computed(() => {
  if (!props.testResult?.ok) return '沒有把失敗包裝成通過；原始輸出完整保留在下方。'
  if (isMultiFileResult.value) return '通過範圍僅限於實際執行證據中逐一列出的修改檔案與指令。'
  if (isLongRunningPythonResult.value) return '此結果只證明程式可持續存活並產生輸出，不宣稱溫度值正確或所有邊界條件已測試。'
  if (isPythonGuiResult.value) return '此結果只證明 GUI 能啟動，不代表所有互動功能均已測試。'
  if (isCreateFilesResult.value) return '此結果只證明檔案已建立，不代表檔案內容的功能測試已完成。'
  if (props.testResult.testKind === 'pytest') return '通過範圍僅限本次實際執行的 pytest 測試案例。'
  return '通過範圍僅限畫面列出的實際指令；不推論未執行的功能或邊界條件。'
})

const launchTypeLabel = computed(() => {
  const type = props.testResult?.sandbox?.launch_type || props.testResult?.launchType || ''
  const map = {
    static_website: '開啟網站 / 瀏覽器',
    npm_web_app: '啟動前端專案並開啟瀏覽器',
    node_server_web_app: '啟動 Node.js 後端網站',
    streamlit_web_app: 'Server 端 Streamlit 預覽',
    python_script: '開啟 Python 終端機',
    node_script: '開啟 Node.js 終端機',
    default_app: '系統預設程式',
    terminal_hint: '右下方終端機',
    gui_web_app: 'Docker + Xvfb 背景啟動（不自動開啟網頁）',
  }
  return map[type] || '自動開啟'
})
const appLaunchSummary = computed(() => {
  const type = props.testResult?.sandbox?.launch_type || props.testResult?.launchType || ''
  if (type === 'static_website') return 'HTML / CSS / JavaScript 網站會直接開啟瀏覽器。'
  if (type === 'npm_web_app') return '有 package.json 的前端專案會啟動 npm dev / start，並嘗試開啟 localhost。'
  if (type === 'node_server_web_app') return '有 package.json + server.js 的專案會啟動 Node.js 後端，通過 health check 後提供預覽網址。'
  if (type === 'streamlit_web_app') return 'Streamlit 在 Server 端 Docker Sandbox 執行，並透過 Cubi 反向代理顯示於本頁。'
  if (type === 'python_script') return '一般 Python 程式會開啟終端機視窗執行。'
  if (type === 'node_script') return '一般 JavaScript 程式會開啟 Node.js 終端機視窗執行。'
  if (type === 'terminal_hint') return '程式碼 / 文字檔不會用系統預設程式開啟，請在右下方終端機分頁執行。'
  if (type === 'gui_web_app') return 'Python GUI 已在 Docker + Xvfb 背景啟動；結果頁不會自動彈出網頁。'
  return '其他檔案會用系統預設程式開啟。'
})
const sandboxStatusText = computed(() => {
  if (!sandboxData.value) return ''
  if (isInteractiveAppResult.value) return `已辨識 ${interactiveAppLabel.value}；系統會切到本網頁終端機並自動送出啟動指令。`
  if (isTerminalHintResult.value) return '此檔案不會開啟 VS Code；系統會切到本網頁終端機分頁執行顯示的指令。'
  if (isAppLaunchResult.value) return props.testResult?.ok ? '已啟動或開啟成功，可直接操作。' : '啟動或開啟失敗，請查看下方輸出。'
  if (isFrontendStaticResult.value) return props.testResult?.ok ? '前端靜態檔案與 JavaScript 語法檢查完成。' : '前端靜態檢查失敗，請查看下方輸出。'
  if (isPythonGuiResult.value) return props.testResult?.ok ? '已在 Docker + Xvfb 完成無頭啟動驗證，未直接使用主機環境。' : 'Python GUI 容器驗證失敗，請查看下方輸出。'
  if (isLongRunningPythonResult.value) return props.testResult?.ok ? `已在 Docker 實際執行 ${longRunningSmokeSeconds.value} 秒並確認持續產生輸出。` : '長時間程式存活測試失敗，請查看原始輸出。'
  if (props.testResult?.ok && sandboxData.value.isolated) return '測試已通過，並已在隔離環境中執行。'
  if (!props.testResult?.ok && sandboxData.value.isolated) return '測試未通過，錯誤訊息已顯示在下方輸出。'
  return '隔離環境尚未就緒，系統已改用本機測試或回傳錯誤。'
})

const diffStats = computed(() => {
  const lines = String(props.diffText || '').split('\n')
  let additions = 0
  let removals = 0
  let hunks = 0

  for (const line of lines) {
    if (line.startsWith('@@')) {
      hunks += 1
      continue
    }
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) additions += 1
    if (line.startsWith('-')) removals += 1
  }

  const source = props.diffInfo?.source || 'backend'
  const model = props.diffInfo?.model || 'local_ollama'
  return {
    additions,
    removals,
    hunks,
    status: props.approvalMode ? '等待確認並測試' : '等待人工確認套用',
    sourceLabel: model && model !== source ? `${source} / ${model}` : source
  }
})

const testUi = computed(() => {
  const result = props.testResult || {}
  const passed = toNumber(result.passed, 0)
  const failed = toNumber(result.failed, 0)
  const total = toNumber(result.total, passed + failed || 0)
  const elapsed = toNumber(result.elapsed, 0)
  const passRate = total ? Math.round((passed / total) * 100) : 0
  const failRate = total ? Math.round((failed / total) * 100) : 0
  return { command: formatCommand(result.command || 'test dispatcher'), passed, failed, total, elapsed, passRate, failRate }
})

function formatSeconds(value) {
  const number = toNumber(value, 0)
  return `${number.toFixed(number % 1 === 0 ? 0 : 2)} 秒`
}

function formatCommand(command) {
  let text = String(command || '').trim()
  if (!text) return '測試指令尚未產生'
  text = text.replace(/[A-Za-z]:\\[^\s]+python(?:\.exe)?\s+-m\s+pytest/ig, 'pytest')
  text = text.replace(/(?:^|\s)(?:[\w./-]*python(?:\d+(?:\.\d+)?)?)\s+-m\s+pytest/ig, ' pytest')
  text = text.replace(/\s+/g, ' ').trim()
  if (/test dispatcher/i.test(text)) return '依專案類型自動判斷'
  return text
}

function agentStepClass(status) {
  if (status === 'done') return 'step-done'
  if (status === 'failed') return 'step-failed'
  return 'step-pending'
}

function firstDiffHeader(text, prefix) {
  return String(text || '').split('\n').find(line => line.startsWith(prefix) && !line.startsWith(`${prefix}${prefix[0]}`)) || ''
}

function toNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function parseUnifiedDiff(text) {
  const rows = []
  if (!text?.trim()) return rows
  let oldLine = 0
  let newLine = 0
  let pendingRemoves = []
  let pendingAdds = []

  const flushChangeBlock = () => {
    rows.push(...buildAlignedDiffRows(pendingRemoves, pendingAdds))
    pendingRemoves = []
    pendingAdds = []
  }

  for (const raw of text.split('\n')) {
    if (!raw || raw.startsWith('---') || raw.startsWith('+++') || raw.startsWith('diff --git') || raw.startsWith('index ')) continue
    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) {
      flushChangeBlock()
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      rows.push({ type: 'hunk', oldType: 'hunk', newType: 'hunk', oldText: raw, newText: raw, oldMark: '', newMark: '' })
      continue
    }
    if (raw.startsWith('-')) {
      pendingRemoves.push({ no: oldLine++, text: raw.slice(1) })
      continue
    }
    if (raw.startsWith('+')) {
      pendingAdds.push({ no: newLine++, text: raw.slice(1) })
      continue
    }
    flushChangeBlock()
    const textValue = raw.startsWith(' ') ? raw.slice(1) : raw
    rows.push({ type: 'context', oldType: 'context', newType: 'context', oldNo: oldLine++, newNo: newLine++, oldText: textValue, newText: textValue, oldMark: ' ', newMark: ' ' })
  }
  flushChangeBlock()
  return rows
}

function buildAlignedDiffRows(oldEntries, newEntries) {
  if (!oldEntries.length && !newEntries.length) return []
  const matchCounts = Array.from({ length: oldEntries.length + 1 }, () => Array(newEntries.length + 1).fill(0))

  for (let oldIndex = 1; oldIndex <= oldEntries.length; oldIndex += 1) {
    for (let newIndex = 1; newIndex <= newEntries.length; newIndex += 1) {
      if (oldEntries[oldIndex - 1].text === newEntries[newIndex - 1].text) {
        matchCounts[oldIndex][newIndex] = matchCounts[oldIndex - 1][newIndex - 1] + 1
      } else {
        matchCounts[oldIndex][newIndex] = Math.max(matchCounts[oldIndex - 1][newIndex], matchCounts[oldIndex][newIndex - 1])
      }
    }
  }

  const reversedRows = []
  let oldIndex = oldEntries.length
  let newIndex = newEntries.length

  while (oldIndex > 0 || newIndex > 0) {
    const oldEntry = oldEntries[oldIndex - 1]
    const newEntry = newEntries[newIndex - 1]
    if (oldIndex > 0 && newIndex > 0 && oldEntry.text === newEntry.text) {
      reversedRows.push({
        type: 'context',
        oldType: 'context',
        newType: 'context',
        oldNo: oldEntry.no,
        newNo: newEntry.no,
        oldMark: ' ',
        newMark: ' ',
        oldText: oldEntry.text,
        newText: newEntry.text
      })
      oldIndex -= 1
      newIndex -= 1
    } else if (newIndex > 0 && (oldIndex === 0 || matchCounts[oldIndex][newIndex - 1] >= matchCounts[oldIndex - 1][newIndex])) {
      reversedRows.push({
        type: 'add',
        oldType: 'empty',
        newType: 'add',
        oldNo: '',
        newNo: newEntry.no,
        oldMark: '',
        newMark: '+',
        oldText: '',
        newText: newEntry.text
      })
      newIndex -= 1
    } else {
      reversedRows.push({
        type: 'remove',
        oldType: 'remove',
        newType: 'empty',
        oldNo: oldEntry.no,
        newNo: '',
        oldMark: '-',
        newMark: '',
        oldText: oldEntry.text,
        newText: ''
      })
      oldIndex -= 1
    }
  }

  return reversedRows.reverse()
}

function diffSideRowClass(row, side) {
  if (row?.type === 'hunk') return 'row-hunk'
  const type = side === 'old' ? row?.oldType : row?.newType
  if (type === 'remove' || type === 'change-remove') return 'row-remove'
  if (type === 'add' || type === 'change-add') return 'row-add'
  if (type === 'empty') return 'row-empty'
  return ''
}

function isChangedDiffLine(row, side) {
  const type = side === 'old' ? row?.oldType : row?.newType
  if (side === 'old') return type === 'remove'
  return type === 'add' || type === 'change-add'
}
</script>
