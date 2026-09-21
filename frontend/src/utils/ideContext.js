export function normalizeIdeContextPath(path = '') {
  return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').trim()
}

export function buildIdeContextPathEntries(options = {}) {
  const {
    includeIdeContext = true,
    activeFile = '',
    openEditorFiles = [],
    pinnedContextFiles = [],
    extraPaths = [],
    maxFiles = 24,
  } = options

  const entries = []
  const addEntry = (path, priority, role) => {
    const clean = normalizeIdeContextPath(path)
    if (!clean) return

    const existing = entries.find(item => item.path === clean)
    if (existing) {
      existing.priority = Math.max(existing.priority, priority)
      existing.role = existing.role === role ? existing.role : `${existing.role},${role}`
      return
    }

    entries.push({ path: clean, priority, role })
  }

  if (includeIdeContext && activeFile) addEntry(activeFile, 100, 'active_file')
  for (const path of extraPaths || []) addEntry(path, 90, 'task_target')

  if (includeIdeContext) {
    for (const path of openEditorFiles || []) addEntry(path, 80, 'open_editor_file')
    for (const path of pinnedContextFiles || []) addEntry(path, 70, 'pinned_file')
  }

  return entries
    .sort((a, b) => b.priority - a.priority)
    .slice(0, maxFiles)
}
