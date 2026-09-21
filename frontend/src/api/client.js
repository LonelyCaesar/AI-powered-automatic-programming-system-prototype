const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

function getAuthHeaders() {
  const token = window.sessionStorage.getItem('cubi_auth_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function parseJson(res) {
  const text = await res.text()
  let data = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { raw: text }
  }

  if (!res.ok) {
    const detail = data.detail || data.error || data.message || data.raw || res.statusText
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return data
}

export async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      ...getAuthHeaders()
    }
  })
  return parseJson(res)
}

export async function apiPost(path, payload, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders()
    },
    body: JSON.stringify(payload),
    signal: options.signal
  })
  return parseJson(res)
}

export async function apiDelete(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: {
      ...getAuthHeaders()
    },
    signal: options.signal
  })
  return parseJson(res)
}

export function getApiBaseUrl() {
  return API_BASE || window.location.origin
}
