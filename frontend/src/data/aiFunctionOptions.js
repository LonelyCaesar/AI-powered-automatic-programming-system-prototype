export const aiFunctionOptions = [
  { key: 'auto', intent: 'auto', label: '自動判斷', icon: '◇', description: 'AI 依目前檔案、IDE 上下文與已開啟資料夾，自動判斷分析、修復、補檔、補依賴或外部資料錯誤處理' },
  { key: 'generate', intent: 'generate', label: '程式碼生成', icon: '‹›', description: '產生程式碼' },
  { key: 'rewrite', intent: 'rewrite', label: '程式碼改寫', icon: '⇄', description: '修改／重構目前程式' },
  { key: 'convert', intent: 'convert', label: '程式語言轉換', icon: '⌘', description: '依指定目標語言轉換程式' },
  { key: 'detect', intent: 'detect', label: '錯誤偵測', icon: '△', description: '檢查程式、環境與外部資料查詢錯誤' },
  { key: 'fix', intent: 'fix', label: '錯誤修正', icon: '✎', description: '修正程式錯誤、輸入驗證、stderr 噪音並產生 Diff' },
  { key: 'analyze', intent: 'analyze', label: '專案檔案分析', icon: '▣', description: '系統可讀取或分析專案中的檔案內容，判斷目前程式結構、檔案用途與可能需要修改的位置。' },
  { key: 'files', intent: 'create_files', label: '建立 / 修改檔案', icon: '＋', description: '自動判斷新增、修改或補齊專案檔案' },
  { key: 'explain', intent: 'explain', label: '程式說明', icon: '?', description: '解釋程式碼用途與風險' },
]

export const aiFunctionOptionMap = Object.fromEntries(aiFunctionOptions.map(item => [item.key, item]))
export const aiFunctionLabels = Object.fromEntries(aiFunctionOptions.map(item => [item.key, item.label]))
export const aiFunctionIcons = Object.fromEntries(aiFunctionOptions.map(item => [item.key, item.icon]))
