const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildVerification,
  createProjectSnapshot,
  formatDetectionReport,
  projectFacts,
  selectRelevantContents,
  selectReportTargetFiles,
} = require('../src/services/readOnlyProjectService')

test('model context metadata reports the real 24-file evidence cap', () => {
  const snapshot = {
    files: Array.from({ length: 30 }, (_, index) => ({
      path: `src/file_${String(index).padStart(2, '0')}.js`,
      content: `export const value${index} = ${index}`,
    })),
  }

  const selection = selectRelevantContents(snapshot, ['src/file_29.js'], 150000, { numberLines: true })

  assert.equal(selection.includedPaths.length, 24)
  assert.equal(selection.includedPaths[0], 'src/file_29.js')
  assert.equal(selection.truncated, true)
})

test('verification separates scan completion from program check failure', () => {
  const snapshot = { files: [{ path: 'main.js', content: 'const broken = ;' }] }
  const contextSelection = selectRelevantContents(snapshot)
  const verification = buildVerification({
    snapshot,
    contextSelection,
    test: { ok: false, commands: ['docker run --rm ... node --check main.js'] },
    aiResult: { ok: true, source: 'ollama' },
    mode: 'detection',
  })

  assert.equal(verification.scan_completed, true)
  assert.equal(verification.program_check_status, 'failed')
  assert.equal(verification.program_check_passed, false)
  assert.deepEqual(verification.evidence_sources, [
    '實際檔案內容',
    '規則式靜態分析',
    'Docker 沙盒實際檢查',
    'Ollama 模型判讀',
  ])
})

test('detection report does not claim untested code is error-free', () => {
  const snapshot = {
    files: [{ path: 'notes.txt', content: 'hello' }],
    coverageNotice: '已掃描 1 個檔案。',
  }
  const facts = { types: ['無法從目前檔案判斷'], risks: [] }
  const report = formatDetectionReport(snapshot, facts, { ok: true, commands: [] }, [])

  assert.match(report, /沒有可安全執行的檢查指令/)
  assert.doesNotMatch(report, /沒有出現任何錯誤/)
})

test('detection report groups findings under clear file headings', () => {
  const snapshot = {
    files: [
      { path: 'src/app.js', content: 'const broken = ;' },
      { path: 'src/util.js', content: 'export const value = 1' },
    ],
    coverageNotice: '已掃描 2 個檔案。',
  }
  const facts = {
    types: ['JavaScript'],
    risks: [{ path: 'src/app.js', line: 1, reason: '語法可能不完整' }],
  }
  const report = formatDetectionReport(snapshot, facts, { ok: false, commands: ['node --check src/app.js'] }, [
    { path: 'src/app.js', line: 1, reason: 'Unexpected token' },
  ])

  assert.match(report, /## 各檔案偵測結果/)
  assert.match(report, /### 檔案名稱：`src\/app\.js`/)
  assert.match(report, /### 檔案名稱：`src\/util\.js`/)
  assert.doesNotMatch(report, /\n---\n/)
})

test('project facts flag broken Taiwan map HTML CSS JS and Python wiring', () => {
  const facts = projectFacts({
    files: [
      {
        path: 'index.html',
        content: `
          <link rel="stylesheet" href="style-broken.css">
          <svg id="taiwan-map-missing"></svg>
          <p id="region-title"></p>
          <script src="scripts.js"></script>
        `,
      },
      {
        path: 'script.js',
        content: `
          const svg = document.getElementById('taiwan-map');
          fetch('taiwan_data.json');
          document.ncreateElementNS('http://www.w3.org/2000/svg', 'path');
        `,
      },
      {
        path: 'style.css',
        content: `
          body { display: center; width: ninety-percent; color: #not-a-color; }
        `,
      },
      {
        path: 'taiwan_map.py',
        content: `
          app = load_features("missing_taiwan_data.json")
          open("missing_taiwan_data.json", encoding="ascii")
        `,
      },
    ],
  })

  const reasons = facts.risks.map(risk => risk.reason).join('\n')
  assert.match(reasons, /style-broken\.css/)
  assert.match(reasons, /scripts\.js/)
  assert.match(reasons, /#taiwan-map/)
  assert.match(reasons, /taiwan_data\.json/)
  assert.match(reasons, /document\.ncreateElementNS/)
  assert.match(reasons, /display:center/)
  assert.match(reasons, /ninety-percent/)
  assert.match(reasons, /CSS 色彩值無效/)
  assert.match(reasons, /missing_taiwan_data\.json/)
  assert.match(reasons, /ASCII/)
})

test('project facts flag polluted UI text, typo assignment, and placeholder map conversion', () => {
  const facts = projectFacts({
    files: [
      {
        path: 'index.html',
        content: '<p id="region-name">請點ㅋㅋㅋㅋㅋㅋㅋㅋクリック地圖上的縣市查看詳細資訊</p>',
      },
      {
        path: 'script.js',
        content: `
          const regionDetailsDisplay = document.getElementById('region-details');
          if (regionDetailsDisplay) regionDetailslyDetailsDisplay = '已選取 台北市';
        `,
      },
      {
        path: 'taiwan_map.py',
        content: `
          if "svgPath" in item:
              feature["points"] = [10, 10, 50, 10, 50, 50, 10, 50]
        `,
      },
    ],
  })

  const reasons = facts.risks.map(risk => risk.reason).join('\n')
  assert.match(reasons, /疑似混入亂碼/)
  assert.match(reasons, /疑似拼錯變數名稱/)
  assert.match(reasons, /固定轉成同一組座標/)
})

test('report target scoping restricts outputs to opened files unless project-wide scan is requested', () => {
  const snapshot = {
    files: [
      { path: 'index.html', content: '<html></html>' },
      { path: 'script.py', content: 'print(1)' },
      { path: 'style.css', content: 'body {}' },
    ],
    activePaths: ['script.py'],
    coverageNotice: '已掃描 3 個檔案。',
  }
  const facts = projectFacts(snapshot)

  const targeted = selectReportTargetFiles(snapshot, '請檢查問題')
  assert.equal(targeted.length, 1)
  assert.equal(targeted[0].path, 'script.py')

  const report = formatDetectionReport(snapshot, facts, { ok: true, commands: [] }, [], targeted)
  assert.match(report, /### 檔案名稱：`script\.py`/)
  assert.doesNotMatch(report, /### 檔案名稱：`index\.html`/)
  assert.doesNotMatch(report, /### 檔案名稱：`style\.css`/)

  const fullTarget = selectReportTargetFiles(snapshot, '請分析整個專案的結構')
  assert.equal(fullTarget.length, 3)
})

test('current file detection scope does not pull unrelated explorer files into the scan', () => {
  const snapshot = createProjectSnapshot({
    filePath: 'calculator.py',
    code: 'def multiply(a, b):\n    return a * b\n',
    scope: 'current_file',
    contextFiles: [
      { ok: true, file_path: 'calculator.py', content: 'def multiply(a, b):\n    return a * b\n' },
      { ok: true, file_path: 'generated.js', content: 'const unsafe = new Function("return 1")' },
      { ok: true, file_path: 'generated.py', content: 'eval("1+1")' },
      { ok: true, file_path: 'script.js', content: 'document.getElementById("missing").innerText = "x"' },
    ],
  })

  assert.deepEqual(snapshot.files.map(file => file.path), ['calculator.py'])
  assert.equal(snapshot.coverage, 'current_file')
  assert.match(snapshot.coverageNotice, /目前開啟檔案：calculator\.py/)
})
