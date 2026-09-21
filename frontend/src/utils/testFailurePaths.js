function normalizePath(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim()
}

export function extractWorkspaceFailurePaths(result = {}, workspacePaths = []) {
  const text = `${result?.stderr || ''}\n${result?.stdout || ''}`
  const available = new Map((workspacePaths || [])
    .map(path => normalizePath(path))
    .filter(Boolean)
    .map(path => [path.toLowerCase(), path]))
  const candidates = []
  const add = value => {
    const clean = normalizePath(value).replace(/^workspace\//i, '')
    const matched = available.get(clean.toLowerCase())
    if (matched && !candidates.includes(matched)) candidates.push(matched)
  }

  for (const match of text.matchAll(/\/workspace\/([^:\r\n"']+?\.[A-Za-z0-9_+-]+)(?::\d+)?/g)) add(match[1])
  for (const match of text.matchAll(/(?:^|[\s"'(])((?:src|tests?)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9_+-]+)/gm)) add(match[1])
  const normalizedText = text.replace(/\\/g, '/')
  for (const path of available.values()) {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pathPattern = new RegExp(`(?:^|[\\s"'(:=])${escaped}(?=$|[\\s"'):=])`, 'm')
    if (pathPattern.test(normalizedText)) add(path)
  }
  return candidates
}

function isDependencyManifestPath(path = '') {
  const clean = normalizePath(path).toLowerCase()
  return /(^|\/)(requirements(?:[-_.][a-z0-9]+)?\.txt|pyproject\.toml|poetry\.lock|pipfile(?:\.lock)?|package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock)$/i.test(clean)
}

function resultReturnCode(result = {}) {
  return Number(result?.returncode ?? result?.exitCode ?? result?.exit_code ?? (result?.ok === true ? 0 : 1))
}

function failedChildResultPaths(result = {}, available = new Map()) {
  const groups = [
    result?.testResults,
    result?.results,
    result?.test?.results,
  ].filter(Array.isArray)
  const paths = []
  const add = value => {
    const clean = normalizePath(value)
    const matched = available.get(clean.toLowerCase())
    if (matched && !paths.includes(matched)) paths.push(matched)
  }

  for (const group of groups) {
    for (const record of group) {
      const test = record?.test && typeof record.test === 'object' ? record.test : record
      if (resultReturnCode(test) === 0) continue
      add(record?.path || record?.filePath || record?.file_path || record?.targetFile || test?.target_file)
    }
  }
  return paths
}

export function selectTestFailureRepairTarget(result = {}, activeFile = '', workspacePaths = []) {
  const available = new Map((workspacePaths || [])
    .map(path => normalizePath(path))
    .filter(Boolean)
    .map(path => [path.toLowerCase(), path]))
  const explicitCandidates = [result?.filePath, result?.targetFile, activeFile]
    .map(path => normalizePath(path))
    .filter(Boolean)

  // Tracebacks are ordered from the entry point to the deepest frame. The
  // deepest workspace frame is normally where the exception was raised, so it
  // is a better repair target than the file the user originally executed.
  const tracebackPaths = extractWorkspaceFailurePaths(result, workspacePaths)
  const tracebackTarget = tracebackPaths.filter(path => !isDependencyManifestPath(path)).at(-1)
  if (tracebackTarget) return tracebackTarget

  const failedChildTarget = failedChildResultPaths(result, available)
    .filter(path => !isDependencyManifestPath(path))[0]
  if (failedChildTarget) return failedChildTarget

  for (const candidate of explicitCandidates) {
    const matched = available.get(candidate.toLowerCase())
    if (matched && !isDependencyManifestPath(matched)) return matched
  }
  for (const candidate of explicitCandidates) {
    const matched = available.get(candidate.toLowerCase())
    if (matched) return matched
  }
  return explicitCandidates[0] || ''
}

export function buildTestFailureFingerprint(result = {}) {
  const output = `${result?.stderr || ''}\n${result?.stdout || ''}`
    .replace(/\\/g, '/')
    .replace(/\/workspace\//gi, '')
    .replace(/line\s+\d+/gi, 'line #')
    .replace(/:\d+(?::\d+)?(?=[\s,)])/g, ':#')
    .replace(/0x[0-9a-f]+/gi, '0x#')
    .replace(/\s+/g, ' ')
    .trim()
  const errorSignals = [...output.matchAll(/(?:[A-Za-z_][A-Za-z0-9_.]*(?:Error|Exception)|FAILED|Error):?[^|]{0,500}/g)]
    .map(match => match[0].trim())
    .filter(Boolean)
  const signal = errorSignals.at(-1) || output.slice(-1200)
  return `${String(result?.command || '').replace(/\s+/g, ' ').trim()}|${signal}`.toLowerCase()
}
