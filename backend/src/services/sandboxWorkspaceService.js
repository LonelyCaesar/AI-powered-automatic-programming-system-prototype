const fs = require('fs')
const path = require('path')
const { createHash } = require('crypto')
const config = require('../config')
const { isLikelyText } = require('../tools/fileTools')

const skipNames = new Set([
  '.git',
  '.venv',
  'venv',
  'node_modules',
  'dist',
  'build',
  '__pycache__',
  '.pytest_cache',
  '.cubi-python-packages',
  'sandbox-workspaces',
  'chats',
])

const pythonRunnerScript = `#!/usr/bin/env python3
import ast
import hashlib
import importlib.util
import os
from pathlib import Path
import site
import subprocess
import sys

NETWORK_DISABLED = ${config.dockerSandbox.networkDisabled ? 'True' : 'False'}

PACKAGE_ALIASES = {
    "bs4": "beautifulsoup4",
    "cv2": "opencv-python",
    "dateutil": "python-dateutil",
    "dotenv": "python-dotenv",
    "pandas_ta": "pandas-ta-classic",
    "PIL": "Pillow",
    "sklearn": "scikit-learn",
    "yaml": "PyYAML",
}

IMPORT_REPLACEMENTS = {
    "pandas_ta": "pandas_ta_classic",
}


def log(message):
    print(f"[Cubi 自動執行] {message}", flush=True)


def file_sha256(file_path):
    digest = hashlib.sha256()
    with open(file_path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def local_module_path(root, target, module_name):
    relative = Path(*module_name.split("."))
    for base in (target.parent, root):
        source_file = base / relative.with_suffix(".py")
        package_file = base / relative / "__init__.py"
        if source_file.exists():
            return source_file
        if package_file.exists():
            return package_file
    return None


def imported_modules(target):
    try:
        tree = ast.parse(target.read_text(encoding="utf-8"))
    except Exception as error:
        log(f"無法分析 import，將直接執行：{error}")
        return []

    modules = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            modules.add(node.module)
    return sorted(modules)


def pip_install(arguments, label, target_dir):
    command = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--target",
        str(target_dir),
        "--upgrade",
        "--disable-pip-version-check",
        "--no-warn-script-location",
        "--prefer-binary",
        *arguments,
    ]
    log(f"安裝 {label}")
    result = subprocess.run(command)
    if result.returncode != 0:
        raise SystemExit(result.returncode)


def ensure_dependencies(root, target):
    stdlib = getattr(sys, "stdlib_module_names", set())
    local_site = root / ".cubi-python-packages"
    if local_site.exists():
        site.addsitedir(str(local_site))
    req_file = root / "requirements.txt"
    if req_file.exists():
        if not NETWORK_DISABLED:
            marker_file = local_site / ".requirements.sha256"
            req_hash = file_sha256(req_file)
            marker_hash = marker_file.read_text(encoding="utf-8").strip() if marker_file.exists() else ""
            if marker_hash == req_hash and local_site.exists():
                log("requirements.txt 未變更，沿用已安裝的 Python 套件")
            else:
                pip_install(["-r", str(req_file)], "requirements.txt 內列出的套件", local_site)
                marker_file.write_text(req_hash, encoding="utf-8")
            site.addsitedir(str(local_site))

    missing_packages = []
    missing_imports = []
    pending_files = [target]
    visited_files = set()

    while pending_files:
        python_file = pending_files.pop(0).resolve()
        if python_file in visited_files:
            continue
        visited_files.add(python_file)
        for module_name in imported_modules(python_file):
            local_path = local_module_path(root, python_file, module_name)
            if local_path is not None:
                pending_files.append(local_path)
                continue
            import_name = module_name.split(".", 1)[0]
            if import_name in stdlib or importlib.util.find_spec(import_name) is not None:
                continue
            package_name = PACKAGE_ALIASES.get(import_name, import_name)
            if package_name not in missing_packages:
                missing_packages.append(package_name)
            if import_name not in missing_imports:
                missing_imports.append(import_name)

    if missing_packages:
        if NETWORK_DISABLED:
            log("CUBI_ENVIRONMENT_BLOCKED：Docker 沙盒網路已停用，無法安裝缺少套件：" + ", ".join(missing_packages))
            log("請在可連網的主機環境安裝依賴，或調整 Docker 沙盒網路設定後再測；不要修改來源程式來掩蓋此環境錯誤。")
            raise SystemExit(69)
        pip_install(missing_packages, "缺少的 Python 套件：" + ", ".join(missing_packages), local_site)
        site.addsitedir(str(local_site))
    else:
        if req_file.exists() and NETWORK_DISABLED:
            log("requirements.txt 存在且 Docker 沙盒網路已停用；本次執行需要的 import 已可載入，未進行下載安裝。")
        else:
            log("未發現需要安裝的 Python 套件")

    for import_name in missing_imports:
        replacement = IMPORT_REPLACEMENTS.get(import_name)
        if replacement and importlib.util.find_spec(import_name) is None and importlib.util.find_spec(replacement) is not None:
            log(f"程式使用 import {import_name}，但沙盒套件實際提供 import {replacement}；請修正來源程式的 import 名稱。")


def main():
    arguments = sys.argv[1:]
    gui_mode = False
    deps_only = False
    if arguments and arguments[0] == "--gui":
        gui_mode = True
        arguments.pop(0)
    if arguments and arguments[0] == "--deps-only":
        deps_only = True
        arguments.pop(0)
    if not arguments:
        raise SystemExit("用法：python3 .cubi-run-python.py [--gui|--deps-only] <程式.py> [參數...]")

    root = Path.cwd().resolve()
    target = (root / arguments[0]).resolve()
    if root not in target.parents and target != root:
        raise SystemExit("執行檔超出專案 workspace")
    if not target.is_file():
        raise SystemExit(f"找不到執行檔：{arguments[0]}")

    ensure_dependencies(root, target)
    if deps_only:
        log(f"依賴安裝 / 檢查完成：{arguments[0]}")
        raise SystemExit(0)
    command = [sys.executable, str(target), *arguments[1:]]
    if gui_mode:
        log("偵測到 GUI 程式，使用 Docker Xvfb 無頭顯示環境執行")
        command = ["xvfb-run", "-a", *command]
    log("執行：" + " ".join(command))
    env = dict(os.environ)
    local_site = str(root / ".cubi-python-packages")
    env["PYTHONPATH"] = local_site + (os.pathsep + env["PYTHONPATH"] if "PYTHONPATH" in env else "")
    env["SDL_AUDIODRIVER"] = "dummy"
    env["ALSA_CONFIG_PATH"] = "/dev/null"
    env["AUDIODEV"] = "null"
    raise SystemExit(subprocess.call(command, env=env))


if __name__ == "__main__":
    main()
`

const nodeRunnerScript = `#!/bin/sh
set -eu

target="\${1:-}"
if [ -z "$target" ]; then
  echo "用法：sh .cubi-run-node.sh <程式.js> [參數...]" >&2
  exit 2
fi
shift

target_dir="$(dirname "$target")"
target_name="$(basename "$target")"
if [ -f "$target_dir/package.json" ]; then
  cd "$target_dir"
  run_target="$target_name"
elif [ -f "package.json" ]; then
  run_target="$target"
else
  echo "[Cubi 自動執行] 未找到 package.json，直接執行 Node.js"
  exec node "$target" "$@"
fi

echo "[Cubi 自動執行] 依 package.json 自動安裝 Node.js 套件"
npm install --no-audit --no-fund
echo "[Cubi 自動執行] 執行：node $run_target"
exec node "$run_target" "$@"
`

function normalizeWorkspaceId(value = '') {
  const clean = String(value || '').trim().replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-')
  return clean.slice(0, 80)
}

function workspaceIdFor(options = {}) {
  const supplied = normalizeWorkspaceId(options.projectId || options.workspaceId)
  if (supplied) return supplied
  const seed = `${options.workspaceSource || 'workspace'}:${options.projectName || 'project'}`
  const digest = createHash('sha256').update(seed).digest('hex').slice(0, 12)
  return `${normalizeWorkspaceId(options.projectName || 'project') || 'project'}-${digest}`
}

function ensureWorkspacesRoot() {
  fs.mkdirSync(config.sandboxWorkspacesDir, { recursive: true })
  return path.resolve(config.sandboxWorkspacesDir)
}

function resolveProjectWorkspace(workspaceId = '') {
  const id = normalizeWorkspaceId(workspaceId)
  if (!id) throw new Error('Docker Sandbox workspace_id 不可空白')
  const root = ensureWorkspacesRoot()
  const target = path.resolve(root, id)
  if (!(target === root || target.startsWith(root + path.sep))) {
    throw new Error('Docker Sandbox workspace_id 超出允許範圍')
  }
  fs.mkdirSync(target, { recursive: true })
  return { id, path: target }
}

function safeRelativePath(value = '') {
  const clean = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim()
  if (!clean || clean === '.' || path.posix.isAbsolute(clean)) return ''
  const normalized = path.posix.normalize(clean)
  if (normalized === '..' || normalized.startsWith('../')) return ''
  return normalized
}

function writeWorkspaceFile(workspaceDir, relativePath, content, encoding = 'utf8') {
  const clean = safeRelativePath(relativePath)
  if (!clean) return null
  const target = path.resolve(workspaceDir, ...clean.split('/'))
  const root = path.resolve(workspaceDir)
  if (!(target === root || target.startsWith(root + path.sep))) return null
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content, encoding)
  return clean
}

function syncBackendProject(sourceRoot, workspaceDir) {
  const written = []
  const workspaceRoot = path.resolve(config.sandboxWorkspacesDir)

  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (skipNames.has(entry.name) || entry.name.endsWith('.bak') || entry.name.endsWith('.log')) continue
      const source = path.join(current, entry.name)
      if (source === workspaceRoot || source.startsWith(workspaceRoot + path.sep)) continue
      if (entry.isDirectory()) {
        walk(source)
        continue
      }
      const stat = fs.statSync(source)
      if (stat.size > 2_000_000 || !isLikelyText(source)) continue
      const relative = path.relative(sourceRoot, source).replace(/\\/g, '/')
      const saved = writeWorkspaceFile(workspaceDir, relative, fs.readFileSync(source))
      if (saved) written.push(saved)
    }
  }

  walk(sourceRoot)
  return written
}

function clearWorkspaceContents(workspaceDir) {
  fs.mkdirSync(workspaceDir, { recursive: true })
  const preserveNames = new Set(['.cubi-python-packages'])
  for (const entry of fs.readdirSync(workspaceDir)) {
    if (preserveNames.has(entry)) continue
    fs.rmSync(path.join(workspaceDir, entry), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 250,
    })
  }
}

function stageProjectWorkspace(options = {}) {
  const workspaceId = workspaceIdFor(options)
  const workspace = resolveProjectWorkspace(workspaceId)
  // Recreate the managed copy for each execution so deleted/stale project files
  // cannot leak into a later sandbox run. Keep the workspace root itself in
  // place because Docker Desktop on Windows can temporarily lock a bind-mounted
  // directory even after the previous container has stopped.
  clearWorkspaceContents(workspace.path)
  const written = []

  if (options.workspaceSource === 'backend') {
    written.push(...syncBackendProject(path.resolve(config.sandboxDir), workspace.path))
  }

  for (const item of Array.isArray(options.contextFiles) ? options.contextFiles : []) {
    if (!item || item.ok === false) continue
    const relative = safeRelativePath(item.file_path || item.path)
    if (!relative) continue
    const isBase64 = item.encoding === 'base64' || item.content_base64
    const content = isBase64
      ? Buffer.from(String(item.content_base64 || item.content || ''), 'base64')
      : String(item.content ?? '')
    const saved = writeWorkspaceFile(workspace.path, relative, content, isBase64 ? undefined : 'utf8')
    if (saved) written.push(saved)
  }

  const activeFile = safeRelativePath(options.filePath)
  if (activeFile && options.code !== null && options.code !== undefined) {
    const saved = writeWorkspaceFile(workspace.path, activeFile, String(options.code), 'utf8')
    if (saved) written.push(saved)
  }

  writeWorkspaceFile(workspace.path, '.cubi-run-python.py', pythonRunnerScript, 'utf8')
  writeWorkspaceFile(workspace.path, '.cubi-run-node.sh', nodeRunnerScript, 'utf8')

  const manifest = {
    workspace_id: workspace.id,
    project_name: String(options.projectName || ''),
    workspace_source: String(options.workspaceSource || ''),
    active_file: activeFile,
    updated_at: new Date().toISOString(),
    synced_files: [...new Set(written)].sort(),
  }
  fs.writeFileSync(path.join(workspace.path, '.cubi-workspace.json'), JSON.stringify(manifest, null, 2), 'utf8')

  return {
    id: workspace.id,
    path: workspace.path,
    activeFile,
    syncedFiles: manifest.synced_files,
  }
}

module.exports = {
  normalizeWorkspaceId,
  workspaceIdFor,
  resolveProjectWorkspace,
  stageProjectWorkspace,
}
