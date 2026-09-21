# AI自動寫程式系統雛形

這是一套可部署於企業內部的 AI 程式開發輔助系統，整合檔案管理、程式編輯器、AI 對話、Diff 比對、終端機、測試驗證與模型設定於同一介面。使用者可直接在專案中瀏覽與編輯檔案，透過自然語言請 AI 協助產生、說明、修正、改寫與轉換程式碼，並在套用前先檢視變更內容。系統支援 Ollama，也可串接 OpenAI-compatible API，並透過 Docker Sandbox 進行隔離測試與執行，適合應用於企業內部開發輔助、原型開發、專案維護、教學展示與 AI Agent 流程驗證。

---

## 1. 專案技術棧

以下列出主系統使用的主要技術，非完整套件清單。

### 前端
- **Framework**：Vue 3 + Vite
- **Editor**：Monaco Editor
- **Terminal**：xterm.js
- **Communication**：Socket.IO Client

### 後端
- **Runtime**：Node.js + Express
- **Communication**：Socket.IO
- **Database Client**：PostgreSQL client (`pg`)
- **Terminal Integration**：node-pty

### 資料庫與 AI 執行
- **Database**：PostgreSQL 16
- **Containerization**：Docker Compose
- **LLM Inference**：Ollama / OpenAI-compatible API
- **Isolation Environment**：Docker Sandbox，用於 AI 自動測試、執行與預覽

---

## 2. 主要專案結構

```text
Cubi_Code_AI_整理版/
├── README.md
├── docker-compose.yml          # PostgreSQL 開發資料庫
├── Dockerfile.sandbox          # AI Sandbox 映像檔
├── backend/
│   ├── package.json
│   ├── package-lock.json
│   ├── patches/                # npm 套件 patch
│   ├── src/
│   │   ├── server.js          # 後端入口
│   │   ├── config.js          # 環境設定
│   │   ├── core/              # LLM client、Audit logger
│   │   ├── db/                # PostgreSQL 初始化與連線
│   │   ├── routes/            # API 路由
│   │   ├── services/          # AI、Agent、模型、Sandbox、任務邏輯
│   │   ├── tools/             # 檔案、Diff、測試、Docker 工具
│   │   └── utils/
│   ├── scripts/
│   │   └── init-db.js
│   ├── tests/
│   └── data/
│       ├── ai-function-options/
│       ├── allowed_tables.json
│       ├── chats/
│       ├── codex-connectors.json
│       ├── enterprise_allowed_tables.json
│       └── model-settings.json
└── frontend/
    ├── package.json
    ├── package-lock.json
    ├── index.html
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── src/
    │   ├── App.vue
    │   ├── main.js
    │   ├── style.css
    │   ├── api/               # 前端 API client
    │   ├── assets/
    │   ├── components/        # 編輯器、檔案總管、聊天、終端機、設定與結果面板
    │   ├── data/
    │   └── utils/             # 上下文、目標檔案、修復流程工具
    └── node_modules/          # npm install 後產生，通常不提交
```

---

## 3. 主要功能

- **AI 程式碼輔助**：可依自然語言產生、說明、改寫、修正、分析與轉換程式碼，也支援多檔上下文、選取區塊與 Ghost Text 補全。
- **檔案與專案操作**：提供檔案總管與 Monaco Editor，可瀏覽、讀取、編輯、上傳程式碼、新增資料夾 / 檔案、重新命名、刪除與整理專案檔案。
- **Diff 確認流程**：AI 產生的修改會先顯示 Diff，使用者確認後才套用，並可搭配測試結果檢查修改是否有效。
- **Agent 自動化**：支援規劃模式、建立檔案、修改程式、專案層級錯誤檢查與修復，並回報執行步驟、工具呼叫與驗證結果。
- **終端機與驗證**：內建後端主機 shell 終端機；AI 自動測試、專案檢查與部分預覽流程可透過 Docker Sandbox 隔離執行。
- **模型與安全控管**：預設支援本地 Ollama，也可設定 OpenAI-compatible API；系統提供 Audit Log 與 PostgreSQL 白名單安全查詢機制。
- **生成式應用支援**：可產生多檔案工具、頁面或小型應用，並依類型透過測試、Sandbox 執行或預覽確認可用性。

---

## 4. 啟動方式與環境部署

### 4.1 啟動 PostgreSQL
```powershell
cd D:\Cubi_Code_AI_整理版
docker compose up -d
```
預設資料庫：
- Host：`localhost`
- Port：`5433`
- Database：`cubi_postgres`
- User：`admin`
- Password：`password`

### 4.2 建置 Docker Sandbox
```powershell
cd D:\Cubi_Code_AI_整理版
docker build -f Dockerfile.sandbox -t cubi-code-pytest-sandbox:latest .
```
使用者透過網頁上傳或建立檔案後，後端會先在主機建立專屬專案工作資料夾，預設位置是 `backend/data/sandbox-workspaces/default-project/`。網頁檔案總管顯示的是這個主機工作資料夾內容；執行程式時，系統再把工作資料夾掛載到 Docker 沙盒的 `/workspace`。

後端執行使用者上傳或 AI 產生的程式碼時，會用 Docker 啟動一次性容器執行。預設執行策略包含 `--rm`、CPU / memory / PID 限制、`--cap-drop ALL`、`--security-opt no-new-privileges`、唯讀容器檔案系統、`/tmp` tmpfs，以及 `--network none`。網頁終端機也預設使用 Docker Sandbox，指令會在容器中的 `/workspace` 執行，而不是直接在網站主機作業系統執行。

若確定需要讓沙盒連網下載套件或呼叫外部服務，可在 `backend/.env` 明確設定：
```env
DOCKER_SANDBOX_NETWORK_DISABLED=false
```

### 4.3 啟動後端
```powershell
cd D:\Cubi_Code_AI_整理版\backend
npm install
npm run init-db
npm run dev
```
- **後端預設位址**：`http://127.0.0.1:8000`
- **健康檢查**：`http://127.0.0.1:8000/api/health`

### 4.4 啟動前端
另開一個終端機：
```powershell
cd D:\Cubi_Code_AI_整理版\frontend
npm install
npm run dev
```
- **前端預設位址**：`http://127.0.0.1:5173`
- 啟動完成後，瀏覽器可開啟 `http://localhost:5173` 進入登入頁。

### 4.5 開始使用
完成前後端啟動後，開啟 `http://localhost:5173` 並使用管理者帳密登入。進入系統後，可先在左側檔案總管開啟專案資料夾，也可用「上傳程式碼檔案」把單檔或多檔放進目前選取資料夾。接著透過右側 AI 任務區輸入需求；AI 產生修改時會先顯示在「修改差異」，確認後即可套用，並可視需要到「測試 / AI 執行結果」或「終端機」執行驗證。終端機輸入的指令會透過 WebSocket 送到後端，並在 Docker Sandbox 中即時執行與回傳輸出。

若要先審核 AI 的做法，可在右側「AI 任務 / 指令」按 `＋` 開啟「規劃模式」。系統會先顯示「是否實作此方案？」；點選「是的，實作此方案」後，才會啟動 Agent 逐項讀檔、寫檔與在 Docker Sandbox 內驗證。

---

## 5. 初始登入與模型設定

### 5.1 初始登入
預設帳密：
- 帳號：`admin`
- 密碼：`cubi1234`

可在 `backend/.env` 修改：
```env
CUBI_LOGIN_USERNAME=admin
CUBI_LOGIN_PASSWORD=cubi1234
```

### 5.2 模型設定
系統預設使用本地 Ollama。

常用設定：
```env
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=auto
AUTOCOMPLETE_MODEL=
MODEL_SOURCE=local_ollama
MODEL_ROUTING_MODE=local_first
```

如需使用雲端模型，可啟用 Cloud API：
```env
CLOUD_API_ENABLED=true
CLOUD_API_BASE_URL=https://api.openai.com/v1
CLOUD_API_KEY=your_api_key
CLOUD_MODEL=gpt-4.1-mini
REQUIRE_CLOUD_APPROVAL=true
```
模型設定也可透過前端的模型設定視窗調整。

---

## 6. 疑難排解

### Q1. 前端無法連到後端
- **解決方式**：
  - 確認後端已啟動於 `http://127.0.0.1:8000`
  - 開啟 `http://127.0.0.1:8000/api/health` 檢查狀態
  - 確認前端 Vite proxy 設定是否仍指向 `localhost:8000`

### Q2. PostgreSQL 連線失敗
- **解決方式**：
  - 確認 Docker Desktop 已啟動
  - 確認資料庫容器狀態：`docker compose ps`
  - 若 `5433` port 被占用，需同步修改 `docker-compose.yml` 與 `backend/.env`

### Q3. Ollama 無法使用
- **解決方式**：
  - 確認 Ollama 已啟動
  - 確認模型已下載：執行 `ollama list`
  - 若使用遠端 Ollama，請調整 `OLLAMA_BASE_URL`

### Q4. Sandbox 執行失敗
- **解決方式**：
  - 確認 Docker Desktop 已啟動
  - 確認已建置 sandbox image：
    ```powershell
    docker build -f Dockerfile.sandbox -t cubi-code-pytest-sandbox:latest .
    ```

### Q5. 前端 build 後產生大量檔案
- **說明**：`frontend/dist/` 是建置產物，不建議提交到版本控制。
