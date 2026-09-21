<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <b>歷史紀錄</b>
          <p>載入或管理過去的 AI 任務紀錄。</p>
        </div>
        <button type="button" class="close-btn" @click="$emit('close')">×</button>
      </div>

      <div class="settings-layout">
        <main class="settings-content">
          <div v-if="loading" class="loading-text">載入中...</div>
          <div v-else-if="sessions.length === 0" class="empty-text">尚無歷史紀錄。</div>
          <ul v-else class="session-list">
            <li v-for="session in sessions" :key="session.id" class="session-item">
              <div class="session-info" @click="$emit('load-session', session.id)">
                <b>{{ session.title }}</b>
                <span>{{ new Date(session.updatedAt).toLocaleString() }}</span>
              </div>
              <button class="delete-btn" @click.stop="deleteSession(session.id)">刪除</button>
            </li>
          </ul>
        </main>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'

const emit = defineEmits(['close', 'load-session'])
const sessions = ref([])
const loading = ref(true)

async function fetchSessions() {
  loading.value = true
  try {
    const res = await fetch('/api/chat/history')
    const data = await res.json()
    if (data.ok) {
      sessions.value = data.sessions
    }
  } catch (err) {
    console.error('Failed to fetch chat sessions', err)
  } finally {
    loading.value = false
  }
}

async function deleteSession(id) {
  if (!confirm('確定要刪除這筆任務紀錄嗎？')) return
  try {
    const res = await fetch(`/api/chat/history/${id}`, { method: 'DELETE' })
    if (res.ok) {
      await fetchSessions()
    }
  } catch (err) {
    console.error('Failed to delete chat session', err)
  }
}

onMounted(() => {
  fetchSessions()
})
</script>

<style scoped>
.modal-mask {
  position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
  background: rgba(0,0,0,0.5); z-index: 9999;
  display: flex; align-items: center; justify-content: center;
}
.modal-card {
  background: var(--bg-color, #1e1e1e);
  color: var(--text-color, #ccc);
  border: 1px solid var(--border-color, #333);
  border-radius: 8px; width: 600px; max-width: 90vw;
  max-height: 80vh; display: flex; flex-direction: column;
}
.modal-head {
  padding: 1rem; border-bottom: 1px solid var(--border-color, #333);
  display: flex; justify-content: space-between; align-items: flex-start;
}
.modal-head b { font-size: 1.1rem; color: #fff; }
.modal-head p { margin: 4px 0 0; font-size: 0.9rem; color: #888; }
.close-btn {
  background: none; border: none; color: #888; font-size: 1.5rem; cursor: pointer;
}
.close-btn:hover { color: #fff; }
.settings-layout { padding: 1rem; overflow-y: auto; }
.session-list { list-style: none; padding: 0; margin: 0; }
.session-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 0.8rem; border-bottom: 1px solid var(--border-color, #333);
  transition: background 0.2s;
}
.session-item:hover { background: rgba(255,255,255,0.05); }
.session-info {
  flex: 1; cursor: pointer; display: flex; flex-direction: column; gap: 4px;
}
.session-info b { color: #fff; font-size: 0.95rem; }
.session-info span { color: #888; font-size: 0.8rem; }
.delete-btn {
  background: #c0392b; color: #fff; border: none; padding: 4px 10px;
  border-radius: 4px; cursor: pointer; font-size: 0.85rem;
}
.delete-btn:hover { background: #e74c3c; }
.empty-text, .loading-text { padding: 2rem; text-align: center; color: #888; }
</style>
