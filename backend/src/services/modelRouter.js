const config = require('../config')

function buildModelRoutingPlan(payload = {}) {
  const sensitive = Boolean(payload.contains_sensitive_data)
  const large = Boolean(payload.needs_large_reasoning)
  const external = Boolean(payload.requires_external_api)
  const cloudEnabled = Boolean(config.cloudApiEnabled && config.cloudApiKey)
  const requireApproval = Boolean(config.requireCloudApproval)
  const routingMode = config.modelRoutingMode || 'local_first'
  let decision = '本地模型優先'
  let selectedSource = 'local_ollama'
  let selectedModel = config.ollamaModel
  let reason = '一般程式說明、Diff、Autocomplete 與企業內部資料預設留在本地 Ollama。'

  if (routingMode === 'local_only') {
    decision = '只用本地模型'
    reason = '目前分流模式設定為 local_only，不會自動使用雲端模型。'
  } else if (routingMode === 'manual' && (large || external) && cloudEnabled && !sensitive) {
    decision = '等待使用者選擇模型'
    selectedSource = 'manual'
    selectedModel = ''
    reason = '目前分流模式設定為 manual，大型或外部 API 任務需由使用者手動選擇本地或雲端。'
  } else if ((large || external) && cloudEnabled && !sensitive && !requireApproval) {
    decision = '可使用雲端模型'
    selectedSource = 'cloud_api'
    selectedModel = config.cloudModel
    reason = '任務需要較大推理能力，且雲端 API 已啟用、不含敏感資料、不需人工核准。'
  } else if ((large || external) && cloudEnabled && requireApproval) {
    decision = '雲端需人工核准'
    selectedSource = 'local_ollama'
    reason = '雲端 API 已設定，但目前 require approval=true，先維持本地模型。'
  } else if (sensitive) {
    decision = '敏感資料留本地'
    reason = '偵測到密碼、token、資料庫或個資等敏感上下文，避免自動送雲端。'
  }

  return {
    ok: true,
    type: 'model_routing_plan',
    task: payload.task || '一般程式說明與修改',
    file_path: payload.file_path || '',
    context_chars: payload.context_chars || 0,
    contains_sensitive_data: sensitive,
    needs_large_reasoning: large,
    requires_external_api: external,
    local_model: config.ollamaModel,
    cloud_model: config.cloudModel,
    cloud_api_enabled: cloudEnabled,
    cloud_api_provider: config.cloudApiProvider,
    require_cloud_approval: requireApproval,
    model_routing_mode: config.modelRoutingMode,
    route: { decision, selected_source: selectedSource, selected_model: selectedModel, reason },
    local_tasks: [
      { task: 'Autocomplete / Ghost Text', reason: '需要低延遲與本機程式上下文，適合先走地端 Ollama。' },
      { task: '程式碼說明與錯誤初查', reason: '可避免內部原始碼與敏感資訊外流。' },
      { task: 'Diff 產生與小範圍重構', reason: '修改前仍需人工確認，地端模型成本可控。' },
      { task: 'pytest / 檔案操作', reason: '實際執行與寫檔應留在本機受控環境。' },
    ],
    cloud_tasks: [
      { task: '大型跨檔架構分析', reason: '需要更長 context 或更強推理時，可在核准後送雲端。' },
      { task: '複雜語言轉換', reason: '例如 Python 轉 Java 並補型別、例外處理與框架差異。' },
      { task: '高風險修正審查', reason: '可用雲端模型做第二意見，但不應自動套用。' },
    ],
    comparison: [
      { item: '隱私', local: '原始碼留在內網 / 本機', cloud: '需控管送出的程式碼、log 與授權' },
      { item: '成本', local: '硬體固定成本，推論速度受設備限制', cloud: '按 token / 請求計費，尖峰成本較高' },
      { item: '品質', local: '適合一般補全與小改動，模型大小受限', cloud: '通常較適合長上下文與複雜推理' },
      { item: '延遲', local: '近端低網路延遲，但取決於 GPU/CPU', cloud: '網路與服務狀態會影響回應時間' },
      { item: '治理', local: '容易做企業內部控管', cloud: '需要人工核准、遮罩與稽核紀錄' },
    ],
    guardrails: [
      '預設 local_first：一般程式碼產生、說明、Diff、Autocomplete 先使用本地模型。',
      '偵測到 password、secret、token、資料庫或個資時，不自動送雲端。',
      '雲端 API 即使已設定，也可透過 REQUIRE_CLOUD_APPROVAL 保持人工核准。',
      '任何模型產生的檔案修改都先產生 Diff，使用者確認後才寫入。',
    ],
    cloud_provider: config.cloudApiProvider,
    summary: `${decision}：${reason}`,
  }
}

module.exports = { buildModelRoutingPlan }
