const config = require('../config')
const { getEffectiveModelSettings } = require('../services/modelSettings')

let ollamaModelCache = { baseUrl: '', names: [], expiresAt: 0 }

function runtimeSettings() {
  return getEffectiveModelSettings()
}

// 保留舊匯出名稱，避免其他檔案 require 失敗；目前不再限制模型品牌或家族。
// 只要是本機 Ollama 已安裝或設定頁填入的模型名稱，各功能都會使用同一套模型設定。
const mainlandModelKeywords = []

function normalizeModelName(name) {
  return String(name || '').trim().toLowerCase()
}

function isMainlandModel() {
  return false
}

function isAutoModel(name) {
  const normalized = normalizeModelName(name)
  return !normalized || ['auto', 'default', '自動'].includes(normalized)
}

function isEmbeddingOnlyModel(name) {
  const normalized = normalizeModelName(name)
  return /(^|[-_:])embed(ding)?($|[-_:])/.test(normalized)
    || normalized.startsWith('bge')
    || normalized.startsWith('mxbai-embed')
    || normalized.startsWith('nomic-embed')
    || normalized.startsWith('all-minilm')
    || normalized.startsWith('snowflake-arctic-embed')
    || normalized.startsWith('jina-embeddings')
    || normalized.startsWith('paraphrase')
    || normalized.startsWith('e5')
    || normalized.startsWith('gte')
}

function filterChatModels(names) {
  return names.filter(name => !isEmbeddingOnlyModel(name))
}

function modelFamily(name) {
  return normalizeModelName(name).split(':')[0]
}

async function fetchJson(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController()
  const { signal: externalSignal, ...fetchOptions } = options
  const abortFromExternal = () => controller.abort(externalSignal?.reason)
  if (externalSignal?.aborted) abortFromExternal()
  else externalSignal?.addEventListener('abort', abortFromExternal, { once: true })
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...fetchOptions, signal: controller.signal })
    const text = await response.text()
    let data = {}
    try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
    if (!response.ok) throw new Error(data.error || data.message || text || response.statusText)
    return data
  } finally {
    clearTimeout(timeout)
    externalSignal?.removeEventListener?.('abort', abortFromExternal)
  }
}

function ollamaErrorMessage(error) {
  const settings = runtimeSettings()
  const connectionHint = `Ollama 未連線，請確認 ${settings.ollamaBaseUrl} 是否啟動。`
  if (error?.name === 'AbortError') {
    return `Ollama 回應逾時，請確認 ${settings.ollamaBaseUrl} 已啟動且模型可正常推論。`
  }
  const message = String(error?.message || error || '').trim()
  if (!message || /fetch failed|ECONNREFUSED|ENOTFOUND|network|socket|timeout/i.test(message)) {
    return message ? `${connectionHint} (${message})` : connectionHint
  }
  return message
}

function logOllamaError(context, error) {
  const raw = error?.name === 'AbortError' ? 'timeout' : String(error?.message || error || 'unknown error')
  console.warn(`[llmClient] ${context}: ${raw}`)
}

function tokensFromOllama(data = {}) {
  return Number(data.eval_count || 0) + Number(data.prompt_eval_count || 0)
}

function logLlmRequest(prompt, model, endpoint) {
  console.log('[LLM] provider=ollama')
  console.log(`[LLM] model=${model || 'unknown'}`)
  console.log(`[LLM] endpoint=${endpoint || '/api/ai/unknown'}`)
  console.log(`[LLM] promptLength=${String(prompt || '').length}`)
}

function logLlmResponse(content) {
  console.log(`[LLM] responseLength=${String(content || '').length}`)
}

async function listOllamaModels(timeoutMs, bypassCache = false) {
  const settings = runtimeSettings()
  const now = Date.now()
  if (
    !bypassCache &&
    ollamaModelCache.baseUrl === settings.ollamaBaseUrl &&
    ollamaModelCache.names.length &&
    ollamaModelCache.expiresAt > now
  ) {
    return [...ollamaModelCache.names]
  }
  const effectiveTimeout = timeoutMs ?? Math.max(3000, settings.ollamaConnectTimeoutMs || 5000)
  try {
    const data = await fetchJson(`${settings.ollamaBaseUrl}/api/tags`, {}, effectiveTimeout)
    const names = (data.models || []).map(item => item.name).filter(Boolean)
    ollamaModelCache = {
      baseUrl: settings.ollamaBaseUrl,
      names,
      expiresAt: now + Math.max(1000, config.ollamaModelCacheTtlMs || 30000),
    }
    return [...names]
  } catch (err) {
    // If bypassCache is true (health check), return empty array so it fails correctly.
    // Otherwise, fallback to cached names if baseUrl matches, to prevent breaking normal requests when Ollama is busy.
    if (!bypassCache && ollamaModelCache.baseUrl === settings.ollamaBaseUrl) {
      return [...ollamaModelCache.names]
    }
    return []
  }
}

function sortLocalModels(names) {
  return [...new Set(names.filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

function isAutocompleteModelCandidate(name = '') {
  return /coder|codegemma|starcoder|deepseek-coder|granite-code/i.test(String(name || ''))
}

function isSmallAutocompleteModel(name = '') {
  return /(?:^|[:_-])(?:0\.5|1\.5|3|7|8|9)b(?:$|[:_-])/i.test(String(name || ''))
}

function uniqueModels(names = []) {
  const seen = new Set()
  const result = []
  for (const name of names) {
    const clean = String(name || '').trim()
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    result.push(clean)
  }
  return result
}

async function pickModel(requested, options = {}) {
  const settings = runtimeSettings()
  const names = await listOllamaModels(null, options.bypassCache)
  const localModels = sortLocalModels(names)
  const chatModels = sortLocalModels(filterChatModels(names))
  const wanted = String(requested || settings.ollamaModel || config.ollamaModel || 'auto').trim() || 'auto'

  if (!localModels.length) {
    if (isAutoModel(wanted)) {
      return {
        selected: '',
        allModels: [],
        allowedModels: [],
        embeddingModels: [],
        requestedAvailable: false,
        warning: 'Ollama /api/tags 無法連線或沒有可用模型；請啟動 Ollama，或在設定中輸入已安裝的模型名稱。',
      }
    }
    return {
      selected: wanted,
      allModels: [],
      allowedModels: [wanted],
      embeddingModels: [],
      requestedAvailable: false,
      warning: 'Ollama 模型清單暫時無法讀取，已直接嘗試呼叫設定模型。',
    }
  }

  const embeddingModels = sortLocalModels(localModels.filter(name => isEmbeddingOnlyModel(name)))

  if (!chatModels.length) {
    return {
      selected: '',
      allModels: names,
      allowedModels: [],
      embeddingModels,
      requestedAvailable: localModels.includes(wanted),
      warning: `Ollama 目前只有 embedding 模型（例如 ${embeddingModels[0] || 'bge-m3'}），不支援 Chat / 程式產生；請改用 gemma3:27b、gemma3:12b、llama3.1:8b 等文字生成模型。`,
    }
  }

  if (isAutoModel(wanted)) {
    return {
      selected: chatModels[0],
      allModels: names,
      allowedModels: chatModels,
      embeddingModels,
      requestedAvailable: true,
      warning: `未指定模型，已自動使用可對話模型 ${chatModels[0]}。`,
    }
  }

  if (chatModels.includes(wanted)) {
    return { selected: wanted, allModels: names, allowedModels: chatModels, embeddingModels, requestedAvailable: true, warning: null }
  }

  if (localModels.includes(wanted) && isEmbeddingOnlyModel(wanted)) {
    return {
      selected: wanted,
      allModels: names,
      allowedModels: [wanted, ...chatModels],
      embeddingModels,
      requestedAvailable: false,
      warning: `${wanted} 是 embedding 模型，但依據設定強制使用。`,
    }
  }

  // 依據使用者在設定中指定的模型為主，嚴格使用設定模型，不自動切換至其他模型
  return {
    selected: wanted,
    allModels: names,
    allowedModels: [wanted, ...chatModels],
    embeddingModels,
    requestedAvailable: localModels.includes(wanted),
    warning: null,
  }
}

async function pickAutocompleteModel(requested) {
  const explicitModel = String(requested || '').trim()
  if (explicitModel) return pickModel(explicitModel)

  const settings = runtimeSettings()
  const configuredModel = String(settings.ollamaModel || '').trim()
  const names = sortLocalModels(filterChatModels(await listOllamaModels()))
  const preferred = (!isAutoModel(configuredModel) && names.includes(configuredModel) ? configuredModel : '')
    || names.find(name => isAutocompleteModelCandidate(name) && isSmallAutocompleteModel(name))
    || names.find(name => isAutocompleteModelCandidate(name))
    || configuredModel
  return pickModel(preferred)
}

async function autocompleteModelCandidates(requested) {
  const settings = runtimeSettings()
  const explicitModel = String(requested || '').trim()
  const names = sortLocalModels(filterChatModels(await listOllamaModels()))
  const smallCodeModels = names.filter(name => isAutocompleteModelCandidate(name) && isSmallAutocompleteModel(name))
  const codeModels = names.filter(name => isAutocompleteModelCandidate(name))
  const configuredModel = String(settings.ollamaModel || config.ollamaModel || '').trim()

  return uniqueModels([
    explicitModel,
    (!isAutoModel(configuredModel) && names.includes(configuredModel)) ? configuredModel : '',
    ...smallCodeModels,
    ...codeModels,
    ...names,
  ]).filter(name => !isAutoModel(name))
}

function modelStatusPayload(settings, pick) {
  return {
    url: settings.ollamaBaseUrl,
    model: settings.ollamaModel,
    selected_model: pick.selected,
    model_available: pick.requestedAvailable,
    available_models: pick.allModels.slice(0, 10),
    allowed_models: pick.allowedModels.slice(0, 10),
    usable_models: pick.allowedModels.slice(0, 10),
    chat_models: pick.allowedModels.slice(0, 10),
    embedding_models: (pick.embeddingModels || []).slice(0, 10),
    local_model_only: true,
    warning: pick.warning,
    checked_at: new Date().toISOString().slice(0, 19),
  }
}

async function ollamaHealth(options = {}) {
  const settings = runtimeSettings()
  // Health checks should always bypass cache to reflect real-time status.
  const pick = await pickModel(settings.ollamaModel, { bypassCache: true })
  if (pick.allModels.length && pick.selected) {
    return { ok: true, status: 'running', ...modelStatusPayload(settings, pick) }
  }
  return {
    ok: false,
    status: pick.allModels.length ? 'no_selected_model' : 'unavailable',
    ...modelStatusPayload(settings, pick),
    warning: pick.warning || 'Ollama 未連線或沒有可用模型。',
  }
}

async function askCloud(prompt, options = {}) {
  if (!config.cloudApiEnabled || !config.cloudApiKey) {
    return { ok: false, content: '', model: config.cloudModel, source: 'cloud_api_not_configured', tokens: 0, error: 'Cloud API 未設定。' }
  }
  try {
    const data = await fetchJson(`${config.cloudApiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.cloudApiKey}` },
      signal: options.signal,
      body: JSON.stringify({
        model: config.cloudModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: options.temperature ?? 0.2,
        top_p: options.topP ?? 0.9,
        max_tokens: options.numPredict || config.ollamaNumPredict,
      }),
    }, Math.min(config.ollamaReadTimeoutMs || 2500, 3000))
    const content = data.choices?.[0]?.message?.content || ''
    return { ok: Boolean(content.trim()), content, model: config.cloudModel, source: 'cloud_openai_compatible', tokens: data.usage?.total_tokens || 0 }
  } catch (error) {
    return { ok: false, content: '', model: config.cloudModel, source: 'cloud_api_error', tokens: 0, error: error.message }
  }
}

async function callOllamaGenerate(prompt, pick, options = {}) {
  const settings = runtimeSettings()
  const data = await fetchJson(`${settings.ollamaBaseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options.signal,
    body: JSON.stringify({
      model: pick.selected,
      prompt,
      stream: false,
      ...(options.keepAlive ? { keep_alive: options.keepAlive } : {}),
      ...(options.think !== undefined ? { think: options.think } : {}),
      ...(options.formatJson ? { format: 'json' } : {}),
      options: {
        temperature: options.temperature ?? 0.2,
        top_p: options.topP ?? 0.9,
        seed: options.seed,
        num_predict: options.numPredict || settings.ollamaNumPredict,
        num_ctx: options.numCtx || settings.ollamaNumCtx || config.ollamaNumCtx || 16384,
        ...(Array.isArray(options.stop) && options.stop.length ? { stop: options.stop } : {}),
      },
    }),
  }, options.timeoutMs || settings.ollamaReadTimeoutMs || 2500)
  const content = String(data.response || '').trim() ? data.response : (data.thinking || data.message?.content || '')
  return { content: content || '', tokens: tokensFromOllama(data), endpoint: '/api/generate' }
}

async function callOllamaChat(prompt, pick, options = {}) {
  const settings = runtimeSettings()
  const messages = Array.isArray(options.messages) && options.messages.length
    ? options.messages
    : [{ role: 'user', content: prompt }]
  const data = await fetchJson(`${settings.ollamaBaseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options.signal,
    body: JSON.stringify({
      model: pick.selected,
      messages,
      stream: false,
      ...(options.keepAlive ? { keep_alive: options.keepAlive } : {}),
      ...(options.think !== undefined ? { think: options.think } : {}),
      ...(options.formatJson ? { format: 'json' } : {}),
      options: {
        temperature: options.temperature ?? 0.2,
        top_p: options.topP ?? 0.9,
        seed: options.seed,
        num_predict: options.numPredict || settings.ollamaNumPredict,
        num_ctx: options.numCtx || settings.ollamaNumCtx || config.ollamaNumCtx || 16384,
        ...(Array.isArray(options.stop) && options.stop.length ? { stop: options.stop } : {}),
      },
    }),
  }, options.timeoutMs || settings.ollamaReadTimeoutMs || 2500)
  const content = String(data.message?.content || '').trim()
    ? data.message.content
    : (data.response || data.message?.thinking || '')
  return { content: content || '', tokens: tokensFromOllama(data), endpoint: '/api/chat' }
}

async function askOllama(prompt, options = {}) {
  const settings = runtimeSettings()
  const requestedModel = options.model || settings.ollamaModel
  const pick = options.autocomplete === true
    ? await pickAutocompleteModel(options.model)
    : await pickModel(requestedModel)
  logLlmRequest(prompt, pick.selected, options.requestEndpoint)

  if (!pick.selected) {
    logLlmResponse('')
    const error = pick.warning || `Ollama 未連線，請確認 ${settings.ollamaBaseUrl} 是否啟動，或在設定中輸入已安裝的模型名稱。`
    return {
      ok: false,
      content: '',
      model: '',
      requested_model: requestedModel,
      source: 'ollama_error',
      tokens: 0,
      error,
      available_models: pick.allModels.slice(0, 10),
      allowed_models: pick.allowedModels.slice(0, 10),
      usable_models: pick.allowedModels.slice(0, 10),
      chat_models: pick.allowedModels.slice(0, 10),
      embedding_models: (pick.embeddingModels || []).slice(0, 10),
      local_model_only: true,
    }
  }

  const attempts = Math.max(1, Math.min(3, (options.maxRetries ?? settings.ollamaMaxRetries) + 1))
  const endpointOrder = options.preferChat ? ['chat', 'generate'] : ['generate', 'chat']
  let lastError = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    for (const endpoint of endpointOrder) {
      try {
        const result = endpoint === 'chat'
          ? await callOllamaChat(prompt, pick, options)
          : await callOllamaGenerate(prompt, pick, options)
        const content = result.content || ''
        if (content.trim()) {
          logLlmResponse(content)
          return {
            ok: true,
            content,
            model: pick.selected,
            requested_model: requestedModel,
            source: 'ollama',
            endpoint: result.endpoint,
            tokens: result.tokens,
            warning: pick.warning,
            available_models: pick.allModels.slice(0, 10),
            allowed_models: pick.allowedModels.slice(0, 10),
            usable_models: pick.allowedModels.slice(0, 10),
            chat_models: pick.allowedModels.slice(0, 10),
            embedding_models: (pick.embeddingModels || []).slice(0, 10),
            requested_model_available: pick.requestedAvailable,
            local_model_only: true,
          }
        }
        lastError = new Error('Ollama 回覆空白。')
      } catch (error) {
        lastError = error
        logOllamaError(`${endpoint} attempt ${attempt}`, error)
        if (error?.name === 'AbortError') break
      }
    }
  }

  logLlmResponse('')
  return {
    ok: false,
    content: '',
    model: pick.selected,
    requested_model: requestedModel,
    source: 'ollama_error',
    tokens: 0,
    error: ollamaErrorMessage(lastError),
    available_models: pick.allModels.slice(0, 10),
    allowed_models: pick.allowedModels.slice(0, 10),
    usable_models: pick.allowedModels.slice(0, 10),
    chat_models: pick.allowedModels.slice(0, 10),
    embedding_models: (pick.embeddingModels || []).slice(0, 10),
    requested_model_available: pick.requestedAvailable,
    local_model_only: true,
  }
}

async function askLlm(prompt, options = {}) {
  const settings = runtimeSettings()
  if (settings.modelSource === 'cloud_api') {
    const cloud = await askCloud(prompt, options)
    if (cloud.ok || options.allowLocalFallback === false) return cloud
    const local = await askOllama(prompt, options)
    return local.ok ? { ...local, cloud_warning: cloud.error } : { ...cloud, local_warning: local.error }
  }

  const local = await askOllama(prompt, options)
  if (local.ok) return local

  if (options.allowCloud === true && config.cloudApiEnabled && !config.requireCloudApproval) {
    const cloud = await askCloud(prompt, options)
    if (cloud.ok) return { ...cloud, local_warning: local.error }
  }

  return local
}

async function askAutocompleteLlm(prompt, options = {}) {
  const autocompleteOptions = {
    ...options,
    autocomplete: true,
    model: options.model || config.autocompleteModel || undefined,
    temperature: options.temperature ?? 0.15,
    numPredict: options.numPredict || config.autocompleteNumPredict || 48,
    numCtx: options.numCtx || config.autocompleteNumCtx || 4096,
    timeoutMs: options.timeoutMs || config.autocompleteTimeoutMs || 16000,
    maxRetries: options.maxRetries ?? 0,
    think: options.think ?? false,
    keepAlive: options.keepAlive || config.autocompleteKeepAlive || '10m',
    stop: options.stop || ['Here is', 'Sure,', 'Explanation:', '說明：', '解釋：', '\nNote:'],
  }
  const primary = await askOllama(prompt, autocompleteOptions)
  if (primary.ok || options.model || config.autocompleteModel || primary.error !== 'Ollama 回覆空白。') return primary

  const tried = new Set([primary.model].filter(Boolean))
  const candidates = await autocompleteModelCandidates('')
  for (const model of candidates) {
    if (!model || tried.has(model)) continue
    tried.add(model)
    const result = await askOllama(prompt, { ...autocompleteOptions, model })
    if (result.ok) {
      return {
        ...result,
        warning: [result.warning, `Autocomplete 第一個模型 ${primary.model || 'unknown'} 回覆空白，已改用 ${result.model}。`].filter(Boolean).join(' '),
      }
    }
    if (result.error !== 'Ollama 回覆空白。') return { ...result, autocomplete_tried_models: [...tried] }
  }

  return { ...primary, autocomplete_tried_models: [...tried] }
}

async function callOllamaEmbeddings(text, pick, options = {}) {
  const settings = runtimeSettings()
  const data = await fetchJson(`${settings.ollamaBaseUrl}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: pick.selected,
      input: text,
      options: {
        num_ctx: settings.ollamaNumCtx || config.ollamaNumCtx || 8192,
      },
    }),
  }, options.timeoutMs || 10000)
  return { ok: true, embeddings: data.embeddings || [], tokens: tokensFromOllama(data) }
}

async function callCloudEmbeddings(text, options = {}) {
  const settings = runtimeSettings()
  const apiUrl = settings.cloudApiBaseUrl || config.cloudApiBaseUrl || 'https://api.openai.com/v1'
  const apiKey = settings.cloudApiKey || config.cloudApiKey || ''
  if (!apiKey) return { ok: false, error: '未設定 Cloud API Key' }
  const data = await fetchJson(`${apiUrl}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: options.model || 'text-embedding-3-small',
      input: text,
    }),
  }, options.timeoutMs || 10000)
  return { ok: true, embeddings: data.data ? [data.data[0].embedding] : [], tokens: data.usage?.total_tokens || 0 }
}

async function generateEmbeddings(text, options = {}) {
  const settings = runtimeSettings()
  if (settings.modelSource === 'cloud_api' || options.useCloud) {
    return callCloudEmbeddings(text, options)
  }
  
  // Use local Ollama
  const requestedModel = options.model || settings.ollamaModel
  let pick
  try {
    const names = await listOllamaModels()
    const embeddingModels = sortLocalModels(names.filter(name => isEmbeddingOnlyModel(name)))
    // Try to pick the requested model if it's an embedding model, otherwise pick the first available embedding model
    if (names.includes(requestedModel) && isEmbeddingOnlyModel(requestedModel)) {
      pick = { selected: requestedModel }
    } else if (embeddingModels.length > 0) {
      pick = { selected: embeddingModels[0] }
    } else {
      // Fallback to the text model if no dedicated embedding model is found (Ollama supports /api/embed on text models too, though not ideal)
      pick = await pickModel(requestedModel)
    }
  } catch (err) {
    return { ok: false, error: `Ollama 模型連線失敗: ${err.message}` }
  }

  if (!pick?.selected) {
    return { ok: false, error: 'Ollama 找不到可用的 embedding 模型' }
  }

  try {
    return await callOllamaEmbeddings(text, pick, options)
  } catch (err) {
    return { ok: false, error: `Ollama Embeddings API 失敗: ${err.message}` }
  }
}

module.exports = { askLlm, askAutocompleteLlm, ollamaHealth, isMainlandModel, mainlandModelKeywords, generateEmbeddings }
