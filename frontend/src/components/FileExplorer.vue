<template>
  <div class="card sidebar-card file-card" @click="closeContextMenu">
    <div class="side-header">
      <b>檔案總管</b>
      <div class="side-icons">
        <button type="button" title="新增專案" @click.stop="$emit('create-project')">📦</button>
        <button type="button" title="開啟資料夾" @click.stop="openFolder">📁</button>
        <button type="button" title="上傳程式碼檔案" @click.stop="openCodeUpload">⇧</button>
        <button type="button" title="新增檔案" :disabled="!canCreateItem" @click.stop="beginCreate('file')">➕</button>
        <button type="button" title="新增資料夾" :disabled="!canCreateItem" @click.stop="beginCreate('folder')">📃</button>
        <button type="button" title="重新整理" @click.stop="$emit('refresh-folder')">🔄</button>
        <button type="button" title="關閉目前資料夾" @click.stop="clearExplorer">❌</button>
      </div>
      <input
        ref="folderInput"
        class="hidden-folder-input"
        type="file"
        webkitdirectory
        directory
        multiple
        @change="handleFolderChange"
      />
      <input
        ref="codeUploadInput"
        class="hidden-folder-input"
        type="file"
        multiple
        @change="handleCodeUploadChange"
      />
    </div>

    <div
      class="tree"
      :class="{ 'tree-empty': !hasProject && !creating }"
      @click.stop
      @contextmenu.prevent.stop="openBlankContextMenu"
    >
      <div v-if="!hasProject && !creating" class="explorer-blank"></div>

      <template v-else>
        <button
          v-if="showProjectRoot"
          type="button"
          class="tree-item folder-row root"
          :class="{ active: selectedPath === '' && rootSelected }"
          @click="selectRoot"
          @contextmenu.prevent.stop="openRootContextMenu"
        >
          <span class="tree-arrow">{{ rootExpanded ? '⌄' : '›' }}</span>
          <span class="folder-icon">□</span>
          <b>{{ projectLabel }}</b>
        </button>

        <template v-if="!showProjectRoot || rootExpanded">
          <div
            v-if="creating && creating.parentPath === ''"
            class="tree-create-row root-create-row"
            :style="{ paddingLeft: '14px' }"
          >
            <span class="file-icon">{{ creating.kind === 'folder' ? '□' : '◧' }}</span>
            <input
              ref="createInputRef"
              v-model.trim="creating.name"
              class="tree-create-input"
              :placeholder="creating.kind === 'folder' ? '新資料夾名稱' : '新檔案名稱，例如 bbb.py / index.html / schema.sql'"
              @keydown.enter.prevent="confirmCreate"
              @keydown.esc.prevent="cancelCreate"
              @blur="confirmCreate"
            />
          </div>

          <template v-for="item in visibleItems" :key="item.path">
            <div
              v-if="renaming && renaming.path === item.path"
              class="tree-create-row rename-row"
              :style="{ paddingLeft: getItemPadding(item) }"
            >
              <span class="tree-arrow"></span>
              <span class="file-icon">{{ item.type === 'folder' ? '□' : icon(item.path) }}</span>
              <input
                ref="renameInputRef"
                v-model.trim="renaming.name"
                class="tree-create-input"
                @keydown.enter.prevent="confirmRename"
                @keydown.esc.prevent="cancelRename"
                @blur="confirmRename"
              />
            </div>

            <button
              v-else-if="item.type === 'folder'"
              type="button"
              class="tree-item folder-row"
              :class="{ active: selectedPath === item.path }"
              :style="{ paddingLeft: getItemPadding(item) }"
              @click="selectFolder(item)"
              @contextmenu.prevent.stop="openContextMenu($event, item)"
            >
              <span class="tree-arrow">{{ isExpanded(item.path) ? '⌄' : '›' }}</span>
              <span class="folder-icon">□</span>
              <span class="file-name">{{ item.name }}</span>
            </button>

            <button
              v-else
              type="button"
              class="tree-item file"
              draggable="true"
              :class="{ active: item.path === active || selectedPath === item.path }"
              :style="{ paddingLeft: getItemPadding(item) }"
              @click="selectFile(item)"
              @dblclick="selectFile(item)"
              @dragstart="handleDragStart($event, item)"
              @contextmenu.prevent.stop="openContextMenu($event, item)"
            >
              <span class="tree-arrow"></span>
              <span class="file-icon">{{ icon(item.path) }}</span>
              <span class="file-name">{{ item.name }}</span>
            </button>

            <div
              v-if="creating && item.type === 'folder' && creating.parentPath === item.path && isExpanded(item.path)"
              class="tree-create-row"
              :style="{ paddingLeft: createInputPadding(item.path) }"
            >
              <span class="tree-arrow"></span>
              <span class="file-icon">{{ creating.kind === 'folder' ? '□' : '◧' }}</span>
              <input
                ref="createInputRef"
                v-model.trim="creating.name"
                class="tree-create-input"
                :placeholder="creating.kind === 'folder' ? '新資料夾名稱' : '新檔案名稱，例如 bbb.py / index.html / schema.sql'"
                @keydown.enter.prevent="confirmCreate"
                @keydown.esc.prevent="cancelCreate"
                @blur="confirmCreate"
              />
            </div>
          </template>
        </template>
      </template>
    </div>

    <div
      v-if="contextMenu.visible"
      class="explorer-context-menu"
      :style="contextMenuStyle"
      @click.stop
      @contextmenu.prevent.stop
    >
      <button
        v-if="contextTargetHasItem"
        type="button"
        @click="contextOpenTarget"
      >
        開啟
      </button>
      <button
        v-if="contextTargetAllowsCreate"
        type="button"
        @click="contextNewFile"
      >
        新增檔案
      </button>
      <button
        v-if="contextTargetAllowsCreate"
        type="button"
        @click="contextNewFolder"
      >
        新增資料夾
      </button>
      <button
        v-if="contextTargetAllowsCreate"
        type="button"
        @click="contextUploadFiles"
      >
        上傳檔案
      </button>
      <button
        v-if="canCreateItem"
        type="button"
        @click="contextCopyPath"
      >
        {{ contextCopyPathLabel }}
      </button>
      <div v-if="contextTargetHasItem" class="context-divider"></div>
      <button
        v-if="contextTargetHasItem && !contextTargetIsProjectRoot"
        type="button"
        @click="contextRename"
      >
        重新命名
      </button>
      <button
        v-if="contextTargetHasItem"
        type="button"
        class="danger"
        @click="contextDelete"
      >
        刪除
      </button>
      <div v-if="contextMoreAvailable" class="context-divider"></div>
      <button
        v-if="contextMoreAvailable"
        type="button"
        class="context-more-button"
        :class="{ active: contextMoreOpen }"
        @click="toggleContextMore"
      >
        {{ contextMoreOpen ? '收合更多' : '更多' }}
        <span>{{ contextMoreOpen ? '⌃' : '⌄' }}</span>
      </button>
      <template v-if="contextMoreOpen">
        <button
          v-if="contextMenu.item.type === 'folder'"
          type="button"
          @click="contextToggleFolder"
        >
          {{ contextTargetExpanded ? '收合資料夾' : '展開資料夾' }}
        </button>
        <button
          v-if="canCreateItem && workspacePath"
          type="button"
          @click="contextCopyFullPath"
        >
          複製完整路徑
        </button>
        <button
          v-if="contextTargetHasItem"
          type="button"
          @click="contextCopyProjectPath"
        >
          複製專案路徑
        </button>
        <button
          v-if="canCreateItem && canRevealPath"
          type="button"
          @click="contextRevealItem"
        >
          在檔案總管中顯示
        </button>
        <button
          v-if="canCreateItem"
          type="button"
          @click="contextRefresh"
        >
          重新整理
        </button>
      </template>
    </div>

    <div v-if="copyNotice" class="explorer-copy-notice" role="status">
      {{ copyNotice }}
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  active: String,
  files: { type: Array, default: () => [] },
  projectName: { type: String, default: '' },
  workspacePath: { type: String, default: '' },
  canRevealPath: { type: Boolean, default: false }
})

const emit = defineEmits([
  'create-project',
  'select',
  'select-folder',
  'open-folder',
  'open-folder-handle',
  'upload-files',
  'new-file',
  'new-folder',
  'rename-item',
  'refresh-folder',
  'reveal-item',
  'delete-selected',
  'clear-explorer'
])

const folderInput = ref(null)
const codeUploadInput = ref(null)
const rootExpanded = ref(true)
const rootSelected = ref(false)
const expandedFolders = ref(new Set())
const selectedPath = ref('')
const selectedType = ref('folder')
const creating = ref(null)
const renaming = ref(null)
const contextMoreOpen = ref(false)
const createInputRef = ref(null)
const renameInputRef = ref(null)
const copyNotice = ref('')
let copyNoticeTimer = null

const CONTEXT_MENU_WIDTH = 176
const CONTEXT_MENU_MARGIN = 8
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  item: { path: '', type: 'folder' }
})

const hasProject = computed(() => Boolean(props.projectName || props.files?.length || creating.value))
const canCreateItem = computed(() => Boolean(props.projectName))
const showProjectRoot = computed(() => Boolean(props.projectName))
const projectLabel = computed(() => props.projectName || '')
const contextTargetIsProjectRoot = computed(() => Boolean(contextMenu.value.item?.isRoot))
const contextTargetHasItem = computed(() => Boolean(contextMenu.value.item?.path || contextMenu.value.item?.isRoot))
const contextTargetAllowsCreate = computed(() => canCreateItem.value && (!contextMenu.value.item?.path || contextMenu.value.item?.type === 'folder'))
const contextTargetExpanded = computed(() => {
  const item = contextMenu.value.item
  if (item?.type !== 'folder') return false
  if (!item.path) return rootExpanded.value
  return expandedFolders.value.has(item.path)
})
const contextCopyPathLabel = computed(() => contextTargetHasItem.value ? '複製路徑' : '複製專案路徑')
const contextMoreAvailable = computed(() => canCreateItem.value)
const contextMenuStyle = computed(() => ({
  left: `${clampContextLeft(contextMenu.value.x)}px`,
  top: `${clampContextTop(contextMenu.value.y)}px`
}))

const cleanItems = computed(() => (props.files || [])
  .filter(item => item?.path)
  .map(item => ({ ...item, path: normalizePath(item.path) }))
  .filter(item => item.path)
  .filter(item => !item.path.endsWith('.bak'))
  .filter(item => !item.path.endsWith('/.gitkeep') && item.path !== '.gitkeep')
  .filter(item => !item.path.includes('__pycache__'))
  .filter(item => !item.path.includes('.pytest_cache'))
  .map(item => ({
    ...item,
    name: item.path.split('/').pop(),
    level: item.path.split('/').length
  }))
)

function parentPath(path) {
  return String(path || '').split('/').slice(0, -1).join('/')
}

const sortedItems = computed(() => [...cleanItems.value].sort((a, b) => {
  const parentA = parentPath(a.path)
  const parentB = parentPath(b.path)

  if (parentA !== parentB) return parentA.localeCompare(parentB)
  if (a.type !== b.type) return a.type === 'folder' ? -1 : 1

  return a.name.localeCompare(b.name)
}))

const visibleItems = computed(() => {
  const childrenMap = new Map()

  for (const item of sortedItems.value) {
    const parent = parentPath(item.path)
    if (!childrenMap.has(parent)) childrenMap.set(parent, [])
    childrenMap.get(parent).push(item)
  }

  const result = []

  function walk(parent) {
    const children = childrenMap.get(parent) || []

    for (const item of children) {
      result.push(item)

      if (item.type === 'folder' && expandedFolders.value.has(item.path)) {
        walk(item.path)
      }
    }
  }

  if (rootExpanded.value || !showProjectRoot.value) {
    walk('')
  }

  return result
})

const lastProjectName = ref('')

watch(
  () => [props.projectName, props.files],
  () => {
    const currentProject = props.projectName || ''

    const folderPaths = new Set(
      cleanItems.value
        .filter(item => item.type === 'folder')
        .map(item => item.path)
    )

    const itemPaths = new Set(cleanItems.value.map(item => item.path))
    if (selectedPath.value && !itemPaths.has(selectedPath.value)) {
      selectedPath.value = ''
      selectedType.value = 'folder'
      rootSelected.value = false
    }

    if (creating.value?.parentPath && !folderPaths.has(creating.value.parentPath)) {
      creating.value = { ...creating.value, parentPath: '' }
    }

    if (currentProject !== lastProjectName.value) {
      expandedFolders.value = new Set()
      lastProjectName.value = currentProject
    } else {
      expandedFolders.value = new Set(
        [...expandedFolders.value].filter(path => folderPaths.has(path))
      )
    }

    rootExpanded.value = true
    rootSelected.value = false
  },
  { immediate: true, deep: true }
)

function expandParents(path) {
  const parts = normalizePath(path).split('/').filter(Boolean)
  if (parts.length <= 1) return

  const next = new Set(expandedFolders.value)

  for (let i = 1; i < parts.length; i += 1) {
    next.add(parts.slice(0, i).join('/'))
  }

  expandedFolders.value = next
}

watch(() => props.active, path => {
  if (!path) {
    selectedPath.value = ''
    selectedType.value = 'folder'
    rootSelected.value = false
    return
  }

  const normalized = normalizePath(path)
  selectedPath.value = normalized
  selectedType.value = 'file'
  rootSelected.value = false
  expandParents(normalized)
}, { immediate: true })

onMounted(() => {
  window.addEventListener('click', closeContextMenu)
  window.addEventListener('keydown', handleGlobalKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('click', closeContextMenu)
  window.removeEventListener('keydown', handleGlobalKeydown)
  if (copyNoticeTimer) window.clearTimeout(copyNoticeTimer)
})

function handleGlobalKeydown(event) {
  if (event.key === 'Escape') {
    closeContextMenu()
    cancelCreate()
    cancelRename()
  }
}

function clampContextLeft(left) {
  if (typeof window === 'undefined') return left
  return Math.max(
    CONTEXT_MENU_MARGIN,
    Math.min(left, window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_MARGIN)
  )
}

function clampContextTop(top) {
  if (typeof window === 'undefined') return top
  return Math.max(CONTEXT_MENU_MARGIN, Math.min(top, window.innerHeight - CONTEXT_MENU_MARGIN))
}

async function openFolder() {
  cancelCreate()
  cancelRename()
  closeContextMenu()

  if (window.showDirectoryPicker) {
    const directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
    emit('open-folder-handle', directoryHandle)
    return
  }

  folderInput.value?.click()
}

function handleFolderChange(event) {
  const selectedFiles = Array.from(event.target.files || [])
  if (selectedFiles.length) emit('open-folder', selectedFiles)
  event.target.value = ''
}

function openCodeUpload(parentOverride = null) {
  cancelCreate()
  cancelRename()
  closeContextMenu()
  const parentPathValue = parentOverride === null ? createParentFromSelection() : normalizePath(parentOverride)
  selectedPath.value = parentPathValue
  selectedType.value = 'folder'
  rootSelected.value = !parentPathValue
  codeUploadInput.value?.click()
}

function handleCodeUploadChange(event) {
  const selectedFiles = Array.from(event.target.files || [])
  if (selectedFiles.length) {
    emit('upload-files', {
      files: selectedFiles,
      targetPath: createParentFromSelection()
    })
  }
  event.target.value = ''
}

function normalizePath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '')
}

function selectRoot() {
  selectedPath.value = ''
  selectedType.value = 'folder'
  rootSelected.value = true
  rootExpanded.value = !rootExpanded.value
  closeContextMenu()
  emit('select-folder', '')
}

function toggleFolder(path) {
  const next = new Set(expandedFolders.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  expandedFolders.value = next
}

function isExpanded(path) {
  return expandedFolders.value.has(path)
}

function getItemDepth(path) {
  const normalized = normalizePath(path)
  if (!normalized) return 0

  return Math.max(0, normalized.split('/').filter(Boolean).length - 1)
}

function getItemPadding(item) {
  return `${8 + getItemDepth(item.path) * 18}px`
}

function createInputPadding(parentPathValue) {
  const parent = normalizePath(parentPathValue)
  if (!parent) return '26px'
  return `${26 + (getItemDepth(parent) + 1) * 18}px`
}

function icon(path) {
  if (path.endsWith('.py')) return '🐍'
  if (/\.(?:db|sqlite|sqlite3)$/i.test(path)) return 'DB'
  if (path.endsWith('.vue')) return 'V'
  if (path.endsWith('.js')) return 'JS'
  if (path.endsWith('.json')) return '{}'
  if (path.endsWith('.md')) return 'M↓'
  if (path.endsWith('.txt')) return '◫'
  return '◧'
}

function selectFolder(item) {
  selectedPath.value = item.path
  selectedType.value = 'folder'
  rootSelected.value = false
  toggleFolder(item.path)
  closeContextMenu()
  emit('select-folder', item.path)
}

function selectFile(item) {
  selectedPath.value = item.path
  selectedType.value = 'file'
  rootSelected.value = false
  closeContextMenu()
  emit('select', item.path)
}

function handleDragStart(event, item) {
  if (!item?.path) return
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData('application/x-cubi-file-path', item.path)
  event.dataTransfer.setData('text/plain', item.path)
}

function selectedItemPayload() {
  return {
    path: selectedPath.value,
    type: selectedType.value
  }
}

function parentOf(path) {
  const parts = normalizePath(path).split('/').filter(Boolean)
  parts.pop()
  return parts.join('/')
}

function createParentFromSelection() {
  const item = selectedItemPayload()
  if (!item.path) return ''
  return item.type === 'folder' ? item.path : parentOf(item.path)
}

function folderPathExists(path) {
  const target = normalizePath(path)
  if (!target) return true
  return cleanItems.value.some(item => item.type === 'folder' && item.path === target)
}

function resolveCreateParent(path) {
  const target = normalizePath(path)
  return folderPathExists(target) ? target : ''
}

function beginCreate(kind, parentOverride = null) {
  if (!canCreateItem.value) return

  cancelRename()
  closeContextMenu()

  const requestedParentPath = parentOverride === null ? createParentFromSelection() : normalizePath(parentOverride)
  const parentPathValue = resolveCreateParent(requestedParentPath)
  rootExpanded.value = true
  rootSelected.value = false

  if (parentPathValue) {
    const next = new Set(expandedFolders.value)
    next.add(parentPathValue)
    expandedFolders.value = next
  }

  creating.value = {
    kind,
    parentPath: parentPathValue,
    name: ''
  }

  nextTick(() => {
    const input = Array.isArray(createInputRef.value) ? createInputRef.value[0] : createInputRef.value
    input?.focus()
    input?.select?.()
  })
}

function cancelCreate() {
  creating.value = null
}

function confirmCreate() {
  if (!creating.value) return

  const name = String(creating.value.name || '').trim()
  const payload = {
    path: creating.value.parentPath,
    type: 'folder',
    name
  }
  const kind = creating.value.kind

  creating.value = null

  if (!name) return

  if (kind === 'file') emit('new-file', payload)
  else emit('new-folder', payload)
}

function startRename(item) {
  cancelCreate()
  closeContextMenu()

  if (!item?.path) return

  selectedPath.value = item.path
  selectedType.value = item.type
  rootSelected.value = false

  renaming.value = {
    path: item.path,
    type: item.type,
    name: item.name || item.path.split('/').pop()
  }

  expandParents(item.path)

  nextTick(() => {
    const input = Array.isArray(renameInputRef.value) ? renameInputRef.value[0] : renameInputRef.value
    input?.focus()
    input?.select?.()
  })
}

function cancelRename() {
  renaming.value = null
}

function confirmRename() {
  if (!renaming.value) return

  const payload = {
    path: renaming.value.path,
    type: renaming.value.type,
    name: String(renaming.value.name || '').trim()
  }

  const originalName = payload.path.split('/').pop()
  renaming.value = null

  if (!payload.name || payload.name === originalName) return
  emit('rename-item', payload)
}

function clearExplorer() {
  cancelCreate()
  cancelRename()
  closeContextMenu()
  selectedPath.value = ''
  selectedType.value = 'folder'
  rootSelected.value = false
  expandedFolders.value = new Set()
  emit('clear-explorer')
}

function deleteSelected() {
  if (!selectedPath.value) return
  emit('delete-selected', selectedItemPayload())
}

function setSelectionFromItem(item) {
  const normalized = normalizePath(item?.path || '')
  selectedPath.value = normalized
  selectedType.value = item?.type || 'folder'
  rootSelected.value = false
}

function openContextMenu(event, item) {
  cancelCreate()
  cancelRename()
  contextMoreOpen.value = false
  setSelectionFromItem(item)
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    item: {
      path: normalizePath(item.path),
      type: item.type,
      name: item.name || item.path.split('/').pop()
    }
  }
}

function openRootContextMenu(event) {
  if (!canCreateItem.value) return

  cancelCreate()
  cancelRename()
  contextMoreOpen.value = false
  selectedPath.value = ''
  selectedType.value = 'folder'
  rootSelected.value = true

  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    item: { path: '', type: 'folder', isRoot: true }
  }
}

function openBlankContextMenu(event) {
  if (!canCreateItem.value) return
  if (event.target.closest('.tree-item, .tree-create-row, .explorer-context-menu')) return

  cancelCreate()
  cancelRename()
  contextMoreOpen.value = false
  selectedPath.value = ''
  selectedType.value = 'folder'
  rootSelected.value = false

  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    item: { path: '', type: 'folder', isRoot: false }
  }
}

function closeContextMenu() {
  contextMoreOpen.value = false
  contextMenu.value = {
    ...contextMenu.value,
    visible: false
  }
}

function toggleContextMore() {
  contextMoreOpen.value = !contextMoreOpen.value
}

function contextParentPath() {
  const item = contextMenu.value.item || { path: '', type: 'folder' }
  if (!item.path) return ''
  return item.type === 'folder' ? item.path : parentOf(item.path)
}

function contextNewFile() {
  if (!canCreateItem.value) return

  const parent = contextParentPath()
  beginCreate('file', parent)
}

function contextNewFolder() {
  if (!canCreateItem.value) return

  const parent = contextParentPath()
  beginCreate('folder', parent)
}

function contextUploadFiles() {
  const parent = contextParentPath()
  openCodeUpload(parent)
}

function contextOpenTarget() {
  const item = contextMenu.value.item
  if (!item?.path) {
    rootExpanded.value = true
    selectedPath.value = ''
    selectedType.value = 'folder'
    rootSelected.value = true
    closeContextMenu()
    emit('select-folder', '')
    return
  }

  if (item.type === 'file') {
    selectFile(item)
    return
  }

  selectedPath.value = item.path
  selectedType.value = 'folder'
  rootSelected.value = false
  expandedFolders.value = new Set([...expandedFolders.value, item.path])
  closeContextMenu()
  emit('select-folder', item.path)
}

function contextToggleFolder() {
  const item = contextMenu.value.item
  if (item?.type !== 'folder') return

  if (!item.path) {
    rootExpanded.value = !rootExpanded.value
  } else {
    toggleFolder(item.path)
  }
  closeContextMenu()
}

const SANDBOX_WORKSPACE_PATH = '/workspace'

function relativeContextPath() {
  return normalizePath(contextMenu.value.item?.path || '') || '.'
}

function sandboxContextPath() {
  const relativePath = normalizePath(contextMenu.value.item?.path || '')
  return relativePath ? `${SANDBOX_WORKSPACE_PATH}/${relativePath}` : SANDBOX_WORKSPACE_PATH
}

function projectContextPath() {
  const relativePath = normalizePath(contextMenu.value.item?.path || '')
  return relativePath ? `${props.projectName}/${relativePath}` : props.projectName
}

function absoluteContextPath() {
  const root = String(props.workspacePath || '').replace(/[\\/]+$/, '')
  const relativePath = normalizePath(contextMenu.value.item?.path || '')
  if (!relativePath) return root
  const separator = root.includes('\\') ? '\\' : '/'
  return `${root}${separator}${relativePath.replace(/\//g, separator)}`
}

function showCopyNotice(message) {
  copyNotice.value = message
  if (copyNoticeTimer) window.clearTimeout(copyNoticeTimer)
  copyNoticeTimer = window.setTimeout(() => {
    copyNotice.value = ''
    copyNoticeTimer = null
  }, 1800)
}

function copyText(text, label) {
  const value = String(text || '')
  if (!value) return

  let copied = false

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  try {
    copied = document.execCommand('copy')
  } catch (e) {
  } finally {
    textarea.remove()
  }

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(value).catch(() => {})
    copied = true
  }

  if (copied) {
    showCopyNotice(`已複製${label}：${value}`)
  } else {
    showCopyNotice('複製失敗，請檢查瀏覽器剪貼簿權限')
  }

  setTimeout(() => {
    closeContextMenu()
  }, 10)
}

function contextCopyPath() {
  return copyText(sandboxContextPath(), 'Sandbox 路徑')
}

function contextCopyProjectPath() {
  return copyText(projectContextPath(), '專案路徑')
}

function contextCopyFullPath() {
  return copyText(absoluteContextPath(), '完整路徑')
}

function contextRevealItem() {
  const item = contextMenu.value.item || { path: '', type: 'folder' }
  closeContextMenu()
  emit('reveal-item', { path: normalizePath(item.path || ''), type: item.type || 'folder' })
}

function contextRefresh() {
  closeContextMenu()
  emit('refresh-folder')
}

function contextRename() {
  const item = contextMenu.value.item
  if (!item?.path) return
  startRename({
    ...item,
    name: item.name || item.path.split('/').pop()
  })
}

function contextDelete() {
  const item = contextMenu.value.item
  closeContextMenu()
  if (!item?.path && !item?.isRoot) return

  selectedPath.value = ''
  selectedType.value = 'folder'
  rootSelected.value = false

  emit('delete-selected', { path: normalizePath(item.path || ''), type: item.type || 'folder', isRoot: Boolean(item.isRoot) })
}
</script>



