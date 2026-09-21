<template>
  <div class="topbar">
    <div class="topbar-left">
      <img :src="logoUrl" class="logo" alt="Cubi Code" />
      <div class="topbar-title">AI 自動寫程式系統雛形</div>
    </div>

    <div class="topbar-right">
      <div class="project-selector">
        <button ref="projectBtn" class="select-pill" @click="toggleProjectMenu">
          專案：<b>{{ projectName || '尚未開啟' }}</b><span class="chev">⌄</span>
        </button>
        <Teleport to="body">
          <div v-if="projectMenuOpen" class="project-dropdown-menu" :style="menuStyle">
            <button 
              v-for="proj in availableProjects" 
              :key="proj" 
              class="project-item"
              :class="{ active: proj === projectName }"
              @click="selectProject(proj)"
            >
              {{ proj }}
            </button>
            <div v-if="!availableProjects.length" class="project-item empty">無其他專案</div>
          </div>
        </Teleport>
      </div>
      <button class="select-pill"><span class="status-dot" :class="overallOk ? 'dot-ok' : 'dot-bad'"></span>連線狀態：<b>{{ overallOk ? '連線正常' : '部分服務未連線' }}</b></button>
      <button class="select-pill">模型：<b>{{ health?.ollama?.selected_model || health?.model || 'auto' }}</b><span class="chev">⌄</span></button>
      <button class="select-pill">模型來源：<b>{{ modelSource }}</b><span class="chev">⌄</span></button>
      <button class="icon-pill" title="設定" @click="$emit('open-settings')">⚙<span>設定</span></button>
      <button class="admin-pill" title="目前登入帳號">
        <span class="avatar">●</span>
        <b>{{ currentUserName }}</b>
      </button>
      <button class="logout-pill" title="登出" @click="$emit('logout')">登出</button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { apiGet } from '../api/client'
import logoUrl from '../assets/cubi-logo.svg?url'

const props = defineProps({ health: Object, projectName: String, currentUser: Object })
const emit = defineEmits(['logout', 'open-settings', 'switch-project'])

const overallOk = computed(() => Boolean(props.health?.api?.ok && props.health?.postgresql?.ok && props.health?.ollama?.ok))
const currentUserName = computed(() => props.currentUser?.display_name || props.currentUser?.username || 'admin')
const modelSource = computed(() => {
  const mode = props.health?.model_routing_mode || 'local_first'
  const routingMap = {
    local_first: '本機優先',
    local_only: '只用本機',
    cloud_for_large_context: '大型任務雲端',
    manual: '手動選擇'
  }
  const routing = routingMap[mode] || mode
  const cloud = props.health?.cloud_api?.ok ? '雲端可用' : '雲端未啟用'
  return `${routing} / ${cloud}`
})



const projectMenuOpen = ref(false)
const availableProjects = ref([])
const projectBtn = ref(null)
const menuStyle = ref({ top: '0px', left: '0px' })

async function fetchProjects() {
  try {
    const res = await apiGet('/api/projects/list')
    availableProjects.value = res.projects || []
  } catch (err) {
    console.error('Failed to load projects', err)
  }
}

function toggleProjectMenu() {
  if (!projectMenuOpen.value) {
    fetchProjects()
    if (projectBtn.value) {
      const rect = projectBtn.value.getBoundingClientRect()
      menuStyle.value = {
        top: `${rect.bottom + 4}px`,
        left: `${rect.left}px`,
        minWidth: `${rect.width}px`
      }
    }
  }
  projectMenuOpen.value = !projectMenuOpen.value
}

function closeProjectMenu() {
  projectMenuOpen.value = false
}

function selectProject(proj) {
  closeProjectMenu()
  if (proj !== props.projectName) {
    emit('switch-project', proj)
  }
}

function handleClickOutside(event) {
  if (projectMenuOpen.value) {
    const isClickOnBtn = projectBtn.value && projectBtn.value.contains(event.target)
    const isClickOnMenu = event.target.closest('.project-dropdown-menu')
    if (!isClickOnBtn && !isClickOnMenu) {
      closeProjectMenu()
    }
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  fetchProjects()
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.project-dropdown-menu {
  position: fixed;
  top: calc(100% + 4px);
  left: 0;
  min-width: 160px;
  background: white;
  border: 1px solid #dbe5f3;
  border-radius: 8px;
  box-shadow: 0 10px 25px rgba(0,0,0,0.1);
  z-index: 1000;
  padding: 8px 0;
  display: flex;
  flex-direction: column;
}
.project-item {
  background: transparent;
  border: none;
  text-align: left;
  padding: 8px 16px;
  font-size: 14px;
  color: #1e293b;
  cursor: pointer;
  transition: background 0.2s;
  font-family: 'Outfit', sans-serif;
  font-weight: 500;
}
.project-item:hover {
  background: #f1f5f9;
}
.project-item.active {
  background: #e0f2fe;
  color: #0284c7;
  font-weight: 700;
}
.project-item.empty {
  color: #94a3b8;
  cursor: default;
}
.project-item.empty:hover {
  background: transparent;
}
</style>
