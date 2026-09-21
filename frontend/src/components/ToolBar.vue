<template>
  <div class="tool-row">
    <button :class="{ active: activeTool === 'generate' }" @click="$emit('tool', 'generate')"><span>‹›</span>程式碼生成</button>
    <button :class="{ active: activeTool === 'rewrite' }" @click="$emit('tool', 'rewrite')"><span>⇄</span>程式碼改寫</button>
    <button :class="{ active: activeTool === 'convert' }" @click="$emit('tool', 'convert')"><span>⌘</span>程式語言轉換</button>
    <button :class="{ active: activeTool === 'detect' }" @click="$emit('tool', 'detect')"><span>△</span>錯誤偵測</button>
    <button :class="{ active: activeTool === 'fix' }" @click="$emit('tool', 'fix')"><span>✎</span>編輯修正</button>
    <button :class="{ active: activeTool === 'analyze' }" title="系統可讀取或分析專案中的檔案內容，判斷目前程式結構、檔案用途與可能需要修改的位置。" @click="$emit('tool', 'analyze')"><span>▣</span>專案檔案分析</button>
    <button :class="{ active: activeTool === 'files' }" @click="$emit('tool', 'files')"><span>＋</span>產生/修改檔案</button>
    <button :class="{ active: activeTool === 'explain' }" @click="$emit('tool', 'explain')"><span>?</span>程式說明</button>
  </div>
</template>

<script setup>
defineProps({
  activeTool: { type: String, default: '' }
})
defineEmits(['tool'])
</script>
