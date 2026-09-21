import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const componentPath = fileURLToPath(new URL('./FileExplorer.vue', import.meta.url))
const source = fs.readFileSync(componentPath, 'utf8')

test('explorer context menu exposes useful path actions', () => {
  assert.match(source, /複製路徑/)
  assert.match(source, /更多/)
  assert.match(source, /複製專案路徑/)
  assert.match(source, /複製完整路徑/)
  assert.match(source, /在檔案總管中顯示/)
  assert.match(source, /重新整理/)
})

test('host-only path actions are hidden without backend capabilities', () => {
  assert.match(source, /v-if="canCreateItem && workspacePath"/)
  assert.match(source, /v-if="canCreateItem && canRevealPath"/)
})

test('copy path supports the clipboard API and a legacy fallback', () => {
  assert.match(source, /navigator\.clipboard\?\.writeText/)
  assert.match(source, /document\.execCommand\('copy'\)/)
  assert.match(source, /已複製\$\{label\}/)
})

test('context menu uses a compact fixed width and functional open action', () => {
  assert.match(source, /const CONTEXT_MENU_WIDTH = 176/)
  assert.match(source, /function contextOpenTarget/)
  assert.match(source, /emit\('select-folder'/)
})

test('context menu distinguishes project root from blank tree space', () => {
  assert.match(source, /contextTargetIsProjectRoot/)
  assert.match(source, /item: \{ path: '', type: 'folder', isRoot: true \}/)
  assert.match(source, /item: \{ path: '', type: 'folder', isRoot: false \}/)
  assert.match(source, /v-if="contextTargetHasItem"[\s\S]*?class="danger"[\s\S]*?刪除/)
  assert.match(source, /emit\('delete-selected', \{ path: normalizePath\(item\.path \|\| ''\), type: item\.type \|\| 'folder', isRoot: Boolean\(item\.isRoot\) \}\)/)
})

test('primary copy path uses the Docker Sandbox /workspace path', () => {
  assert.match(source, /const SANDBOX_WORKSPACE_PATH = '\/workspace'/)
  assert.match(source, /function sandboxContextPath\(\)/)
  assert.match(source, /return relativePath \? `\$\{SANDBOX_WORKSPACE_PATH\}\/\$\{relativePath\}` : SANDBOX_WORKSPACE_PATH/)
  assert.match(source, /function contextCopyPath\(\) \{[\s\S]*?copyText\(sandboxContextPath\(\), 'Sandbox 路徑'\)/)
})

test('host full path remains available as a separate context action', () => {
  assert.match(source, /function contextCopyFullPath\(\)/)
  assert.match(source, /copyText\(absoluteContextPath\(\), '完整路徑'\)/)
})
