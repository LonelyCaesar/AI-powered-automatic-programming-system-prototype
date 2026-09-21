export function isSandboxNetworkLimitation(result = {}) {
  const output = `${result.stderr || ''}\n${result.stdout || ''}`
  if (hasSourceCodeFailureEvidence(output)) return false
  const networkError = /CUBI_ENVIRONMENT_BLOCKED|network is unreachable|temporary failure in name resolution|name or service not known|could not resolve host|failed to establish a new connection|connection(?:error|refused|reset)|read timed out|connect timeout|failed to get ticker|possibly delisted|curl error|yfinance/i.test(output)
  const networkDisabled = result.sandbox?.network === 'none'
    || (result.checks || []).some(check => check?.sandbox?.network === 'none')
  const isolatedDocker = result.sandbox?.isolated === true && Boolean(result.sandbox?.engine)
  const externalServiceError = /could not resolve host|failed to get ticker|guce\.yahoo\.com|yfinance|curl error|possibly delisted/i.test(output)
  return networkError && (networkDisabled || (isolatedDocker && externalServiceError))
}

export function visibleResultStderr(result = {}) {
  const stderr = String(result.stderr || '').trim()
  if (!stderr) return ''
  const output = `${stderr}\n${result.stdout || ''}`
  const cleanedStderr = hideBenignPipTargetWarnings(stderr)
  if (!cleanedStderr) return ''
  if (result.ok === true && isBenignSuccessfulPipNoise(cleanedStderr)) return ''
  const externalServiceNoise = /could not resolve host|failed to get ticker|guce\.yahoo\.com|yfinance|curl error|possibly delisted/i.test(stderr)
  if (
    externalServiceNoise
    && !hasSourceCodeFailureEvidence(output)
    && (result.ok === true || result.environmentBlocked === true || result.validationLimited === true || isSandboxNetworkLimitation(result))
  ) {
    return ''
  }
  return cleanedStderr
}

export function hideBenignPipTargetWarnings(stderr = '') {
  return String(stderr || '')
    .split(/\r?\n/)
    .filter(line => !/^WARNING:\s+Target directory \/workspace\/\.cubi-python-packages\/.+ already exists\. Specify --upgrade to force replacement\.\s*$/i.test(line.trim()))
    .join('\n')
    .trim()
}

export function isBenignSuccessfulPipNoise(stderr = '') {
  const lines = String(stderr || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  if (!lines.length) return false
  return lines.every(line =>
    /^ERROR:\s+pip's dependency resolver does not currently take into account all the packages that are installed\./i.test(line)
    || /^This behaviour is the source of the following dependency conflicts\./i.test(line)
    || /^[A-Za-z0-9_.-]+\s+\S+\s+requires\s+.+,\s+but you have\s+.+\s+which is incompatible\.$/i.test(line)
    || /^WARNING:\s+Running pip as the ['"]?root['"]? user/i.test(line)
    || /^WARNING:\s+The script .+ is installed in .+ which is not on PATH\./i.test(line)
  )
}

export function hasSourceCodeFailureEvidence(output = '') {
  return /(?:SyntaxError|IndentationError|TabError|NameError):/i.test(String(output || ''))
}

export function isCliArgumentMissing(result = {}) {
  const output = `${result.stderr || ''}\n${result.stdout || ''}`
  const isolatedDocker = result.sandbox?.isolated === true && Boolean(result.sandbox?.engine)
  return isolatedDocker && /(?:usage:\s+.+\n)?(?:.+:\s+)?error:\s+the following arguments are required:/i.test(output)
}

export function isGuiDisplayLimitation(result = {}) {
  const output = `${result.stderr || ''}\n${result.stdout || ''}`
  const isolated = result.sandbox?.isolated === true || Boolean(result.sandbox?.engine)
  const guiError = /no display detected|tkinter requires a gui environment|no display name and no \$?DISPLAY environment variable|could(?:n't| not) connect to display|cannot open display|_tkinter\.TclError/i.test(output)
  return isolated && guiError
}

export function isPytestNoTestsCollected(result = {}) {
  const output = `${result.stderr || ''}\n${result.stdout || ''}`
  const kind = String(result.testKind || result.kind || '').toLowerCase()
  const exitCode = Number(result.returncode ?? result.exitCode ?? -1)
  const passed = Number(result.passed || 0)
  const failed = Number(result.failed || 0)
  return kind === 'pytest'
    && passed === 0
    && failed === 0
    && (exitCode === 5 || /(?:no tests ran|collected 0 items|no tests collected)/i.test(output))
}

export function isPytestCaptureTempfileFailure(result = {}) {
  const output = `${result.stderr || ''}\n${result.stdout || ''}`
  const kind = String(result.testKind || result.kind || '').toLowerCase()
  const isolated = result.sandbox?.isolated === true || Boolean(result.sandbox?.engine)
  return kind === 'pytest'
    && isolated
    && /_pytest[\/\\]capture\.py|site-packages[\/\\]_pytest[\/\\]capture\.py/i.test(output)
    && /tmpfile\.truncate\(\)|pop_outerr_to_orig|stop_global_capturing/i.test(output)
    && /FileNotFoundError:\s*\[Errno 2\]\s*No such file or directory/i.test(output)
}

export function testFailureRepairBlockReason(result = {}) {
  if (isSandboxNetworkLimitation(result)) {
    return '這是 Docker 隔離沙盒中的外部網路／Yahoo Finance 連線錯誤，修改程式碼無法修復，也不應用固定資料或假資料掩蓋。請在可連網環境重測，或明確改成使用 mock 測試資料。'
  }
  if (isPytestNoTestsCollected(result)) {
    return '這次 pytest 沒有收集到任何測試案例，因此不是可由自動修正處理的程式錯誤。請新增或開啟實際測試檔後重跑，或直接以程式啟動/語法檢查作為驗收。'
  }
  if (isPytestCaptureTempfileFailure(result)) {
    return '這是 Docker 沙盒中 pytest 輸出擷取暫存檔遺失造成的測試執行器錯誤，不是來源程式碼錯誤；系統會改用關閉 pytest capture 的方式重新驗證，不應把它送進 AI 改碼。'
  }
  if (isCliArgumentMissing(result)) {
    return '這次失敗是 Python 程式需要命令列參數，但沙盒自動執行沒有收到參數；這不是程式碼錯誤。請提供執行參數後重跑，例如股票代碼。'
  }
  if (isGuiDisplayLimitation(result)) {
    return '這是 Tkinter/桌面 GUI 程式在 Docker 或無視窗環境中執行造成的顯示環境限制，不是來源程式碼錯誤；請改用 GUI 預覽模式或在 Windows 主機直接執行。'
  }
  const output = `${result.stderr || ''}\n${result.stdout || ''}`
  const isolated = result.sandbox?.isolated === true || Boolean(result.sandbox?.engine)
  if (isolated && /no default input device|invalid input device|no such audio device|alsa.*(?:error|cannot)|jack server|microphone.*(?:unavailable|permission)/i.test(output)) {
    return '這是隔離沙盒無法存取主機麥克風造成的硬體環境錯誤，不能靠修改來源程式修復；請改在主機環境進行實際錄音驗收。'
  }
  return ''
}

export function selectProjectFixTarget(inspection = {}, fallbackTarget = '') {
  const errors = Array.isArray(inspection.error_files) ? inspection.error_files : []
  const isTestPath = filePath => /(^|\/)(?:tests?(?:\/|_)|test_[^/]*\.py$|[^/]*_test\.py$)/i.test(String(filePath || ''))
  const sourceLocation = errors.find(item => item?.path && item?.line && !isTestPath(item.path))
  const located = sourceLocation || errors.find(item => item?.path && item?.line) || errors.find(item => item?.path)
  return String(located?.path || fallbackTarget || '').replace(/\\/g, '/')
}

export function buildProjectFixInstruction(userInstruction, inspection = {}) {
  const errors = (inspection.error_files || []).map(item => {
    const location = item.line ? `:${item.line}${item.column ? `:${item.column}` : ''}` : ''
    return `- ${item.path}${location}：${item.reason || '測試定位到此檔案'}`
  }).join('\n')
  const related = (inspection.related_files || []).map(item => `- ${item.path}：${item.reason || '相關檔案'}`).join('\n')
  const test = inspection.test || {}
  const output = [test.stderr ? `stderr:\n${test.stderr}` : '', test.stdout ? `stdout:\n${test.stdout}` : '']
    .filter(Boolean)
    .join('\n\n')
    .slice(-10000)
  const editScope = inspection.target_only
    ? `唯一允許修改的檔案：${inspection.target_file}。不得修改、新增或刪除任何其他檔案。`
    : '只修改實際錯誤直接涉及的檔案，不要重寫無關檔案。'

  return `${userInstruction || '錯誤修正'}

這是 AI Docker Sandbox 錯誤修正。請只做通過實際檢查所需的最小修改，不可刪除、略過或弱化測試。
${editScope}

已執行指令：
${(inspection.commands || []).map(command => `- ${command}`).join('\n') || '- 未找到指令'}

錯誤位置：
${errors || '- 測試輸出未提供可解析的位置，請依輸出判斷'}

必須一起檢查的關聯檔案：
${related || '- 目前作用中檔案'}

實際終端輸出：
${output || '沒有額外輸出'}`
}

export function formatProjectFixSummary(report = {}, result = {}) {
  const commands = [...new Set(report.commands || [])]
  const errors = report.errorFiles || []
  const modified = [...new Set(report.modifiedFiles || [])]
  const reasons = report.reasons || {}
  const lines = [
    '錯誤修正完成報告',
    `是否通過：${result.ok ? '是' : '否'}`,
    `最後測試結果：${result.passed || 0} passed / ${result.failed || 0} failed（Exit Code ${result.exitCode ?? '未知'}）`,
    `指定檔案實際執行：${result.targetRuntimeValidated ? `是（${result.targetFile || '目前檔案'}）` : '否'}`,
    `執行過的測試指令：${commands.length ? commands.join('；') : '無'}`,
    `找到的錯誤檔案：${errors.length ? errors.map(item => `${item.path}${item.line ? `:${item.line}` : ''}`).join('、') : '無'}`,
    `修改過的檔案：${modified.length ? modified.join('、') : '無'}`,
  ]
  if (modified.length) {
    lines.push('各檔案修正原因：')
    for (const filePath of modified) lines.push(`- ${filePath}：${reasons[filePath] || '依實際測試錯誤進行最小必要修正'}`)
  }
  if (result.targetRuntimeValidated || result.targetStdout || result.targetStderr) {
    lines.push(`真實 stdout：\n${String(result.targetStdout || '').trim() || '（空）'}`)
    lines.push(`真實 stderr：\n${String(result.targetStderr || '').trim() || '（空）'}`)
  }
  return lines.join('\n')
}
