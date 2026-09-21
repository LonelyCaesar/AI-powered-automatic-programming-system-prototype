import test from 'node:test'
import assert from 'node:assert/strict'

import {
  detectCodeLanguage,
  extractRequestedFileReferences,
  inferConversionTarget,
  inferExplicitTargetLanguage,
  findAvailableGeneratedPath,
  inferGeneratedTargetPath,
  isExistingFileChangeAuthorized,
  resolveRequestedWorkspacePaths,
  validateTaskContext,
  extractDeclaredOutputFileReferences,
  requiredExistingFileReferences,
  selectTaskTargetPaths,
} from './aiTaskSafety.js'

test('recognizes Node.js and Express as an explicit JavaScript conversion target', () => {
  const instruction = '請將以下 Python FastAPI 路由程式碼轉換成 Node.js 的 Express 路由寫法。'
  assert.equal(inferExplicitTargetLanguage(instruction), 'JavaScript')
  assert.equal(inferConversionTarget({ instruction, sourceCode: 'from fastapi import FastAPI', filePath: 'generated.py' }), 'JavaScript')
})

test('detects language from code before a misleading extension', () => {
  const code = "const query = `SELECT * FROM users WHERE name = '${name}'`;"
  assert.equal(detectCodeLanguage(code, 'generated.py'), 'JavaScript')
  assert.equal(detectCodeLanguage("import React from 'react';\nexport default function App() {}", 'generated.py'), 'JavaScript')
})

test('generates a React component in a JSX file instead of reusing a non-empty Python file', () => {
  const target = inferGeneratedTargetPath({
    instruction: '請用 React 寫一個「範例元件 (SampleWidget)」元件。',
    activeFile: 'generated.py',
    currentContent: 'print("old")',
  })
  assert.equal(target, 'SampleWidget.jsx')
})

test('creates a new numbered file instead of reusing an unopened explorer file', () => {
  const target = inferGeneratedTargetPath({
    instruction: '用 Python tkinter 建立範例應用',
    existingPaths: ['generated.py'],
  })
  assert.equal(target, 'generated (2).py')
})

test('keeps the currently open blank file as the generation target', () => {
  const target = inferGeneratedTargetPath({
    instruction: '用 Python tkinter 建立範例應用',
    activeFile: 'blank.py',
    currentContent: '',
    existingPaths: ['blank.py', 'generated.py'],
  })
  assert.equal(target, 'blank.py')
})

test('increments generated file names until an unused path is found', () => {
  assert.equal(
    findAvailableGeneratedPath('src/generated.py', ['src/generated.py', 'src/generated (2).py']),
    'src/generated (3).py',
  )
  assert.equal(
    findAvailableGeneratedPath('src/generated (2).py', ['src/generated.py', 'src/generated (2).py']),
    'src/generated (3).py',
  )
})

test('resolves plain file references without requiring @ mentions', () => {
  const instruction = '請分析 package.json 與 docker-compose.yml'
  assert.deepEqual(extractRequestedFileReferences(instruction), ['package.json', 'docker-compose.yml'])
  assert.deepEqual(resolveRequestedWorkspacePaths(instruction, ['frontend/package.json', 'docker-compose.yml']), [
    'frontend/package.json',
    'docker-compose.yml',
  ])
})

test('rejects a source-dependent task when no code context is available', () => {
  const result = validateTaskContext({ action: 'rewrite', instruction: '請重構這段程式碼' })
  assert.equal(result.ok, false)
  assert.match(result.error, /缺少可用的程式碼上下文/)
})

test('requires both files when the analysis request explicitly says two files', () => {
  const result = validateTaskContext({
    action: 'analyze',
    instruction: '分析這兩個專案設定檔',
    activeFile: 'package.json',
    currentContent: '{}',
    workspaceOpen: true,
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /2 個檔案/)
})

test('authorizes only explicitly requested existing-file modifications', () => {
  const instruction = '請建立 .gitignore，並修改 README.md 加入啟動說明'
  assert.equal(isExistingFileChangeAuthorized({ instruction, filePath: 'README.md' }), true)
  assert.equal(isExistingFileChangeAuthorized({ instruction, filePath: 'package.json' }), false)
})

test('does not authorize a file that the user explicitly says not to modify', () => {
  const instruction = '請建立 test_generated.py，為 generated.py 加入測試，但不要修改 generated.py。'
  assert.equal(isExistingFileChangeAuthorized({ instruction, filePath: 'generated.py' }), false)
  assert.equal(isExistingFileChangeAuthorized({ instruction: 'generated.py 不得被覆寫，請新增測試檔', filePath: 'generated.py' }), false)
})

test('treats a conversion output path as a new file instead of missing input context', () => {
  const instruction = '請將 @python/api.py 轉換成 Node.js Express，輸出為 src/api.js，不要覆寫原始檔。'
  assert.deepEqual(extractDeclaredOutputFileReferences(instruction), ['src/api.js'])
  assert.deepEqual(requiredExistingFileReferences(instruction), ['python/api.py'])

  const result = validateTaskContext({
    action: 'convert',
    instruction,
    activeFile: 'python/api.py',
    currentContent: 'app = FastAPI()',
    contextFiles: [{ ok: true, file_path: 'python/api.py', content: 'app = FastAPI()' }],
    resolvedReferencePaths: ['python/api.py'],
    workspaceOpen: true,
  })
  assert.equal(result.ok, true)
})

test('treats natural phrasing conversion target in parentheses as an output file', () => {
  const instruction = '請將 test3.py 的電子溫度計程式碼轉換成 JavaScript (test.js)，使用 setInterval 模擬溫度每秒更新，並詳細說明轉換後的語法差異。'
  assert.deepEqual(extractDeclaredOutputFileReferences(instruction), ['test.js'])
  assert.deepEqual(requiredExistingFileReferences(instruction), ['test3.py'])

  const result = validateTaskContext({
    action: 'convert',
    instruction,
    activeFile: 'test3.py',
    currentContent: 'class DigitalThermometer:',
    contextFiles: [{ ok: true, file_path: 'test3.py', content: 'class DigitalThermometer:' }],
    resolvedReferencePaths: ['test3.py'],
    workspaceOpen: true,
  })
  assert.equal(result.ok, true)
})

test('still rejects a missing conversion source file', () => {
  const result = validateTaskContext({
    action: 'convert',
    instruction: '請將 missing/api.py 轉換成 Node.js，輸出為 src/api.js',
    activeFile: 'python/api.py',
    currentContent: 'app = FastAPI()',
    resolvedReferencePaths: [],
    workspaceOpen: true,
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /missing\/api\.py/)
  assert.doesNotMatch(result.error, /src\/api\.js/)
})

test('does not require files mentioned as missing-data fallback evidence', () => {
  const instruction = `
請直接修正目前台灣地圖專案，不要重新規劃。

失敗證據：
1. Tkinter 視窗顯示 No GeoJSON data loaded，不能是空白。
2. index.html 用檔案方式開啟時顯示 Failed to fetch。
3. script.js 曾出現 document.ncreateElementNS is not a function。

修正要求：
- 不可只依賴 fetch('map_data.json')；fetch 失敗時要有內建 fallback 地圖資料。
- Tkinter 版沒有 taiwan_data.json 時，也要顯示內建台灣地圖，不可空白。
`
  assert.deepEqual(requiredExistingFileReferences(instruction), ['index.html', 'script.js'])

  const result = validateTaskContext({
    action: 'fix',
    instruction,
    activeFile: 'script.js',
    currentContent: 'document.createElementNS("http://www.w3.org/2000/svg", "path")',
    resolvedReferencePaths: ['index.html', 'script.js'],
    workspaceOpen: true,
  })

  assert.equal(result.ok, true)
})

test('resolves CSS files named in multi-file detection requests', () => {
  const instruction = '請偵測目前 my_project 內 index.html、map_data.json、script.js、style.css、taiwan_map.py 的錯誤。'
  const workspace = ['index.html', 'map_data.json', 'script.js', 'style.css', 'taiwan_map.py']

  assert.deepEqual(requiredExistingFileReferences(instruction), workspace)
  assert.deepEqual(resolveRequestedWorkspacePaths(instruction, workspace, { excludeDeclaredOutputs: true }), workspace)
})

test('uses the explicitly named rewrite file instead of every open editor', () => {
  const workspace = ['src/OrderService.js', 'src/java/Algorithm.java']
  const targets = selectTaskTargetPaths(
    '請改寫 OrderService.js，保持既有行為不變',
    workspace,
    ['src/OrderService.js', 'src/java/Algorithm.java'],
  )
  assert.deepEqual(targets, ['src/OrderService.js'])
})

test('selects the conversion source and excludes the requested new output path', () => {
  const workspace = ['python/api.py', 'src/api.js', 'src/OrderService.js']
  const targets = selectTaskTargetPaths(
    '請將 @python/api.py 轉換成 Node.js，輸出為 src/api.js',
    workspace,
    ['src/OrderService.js'],
  )
  assert.deepEqual(targets, ['python/api.py'])
})

test('rejects program analysis when no file in file explorer is open even if workspace is open', () => {
  const result = validateTaskContext({
    action: 'analyze',
    instruction: '請分析',
    activeFile: '',
    selectedCode: '',
    currentContent: '',
    contextFiles: [],
    resolvedReferencePaths: [],
    workspaceOpen: true,
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /尚未在檔案總管開啟任何檔案/)
})

test('allows program analysis when an active file is open with code', () => {
  const result = validateTaskContext({
    action: 'analyze',
    instruction: '請分析目前檔案',
    activeFile: 'src/main.js',
    currentContent: 'console.log("hello")',
    contextFiles: [{ ok: true, file_path: 'src/main.js', content: 'console.log("hello")' }],
    workspaceOpen: true,
  })
  assert.equal(result.ok, true)
})

test('allows program analysis when a file is referenced via @mention', () => {
  const result = validateTaskContext({
    action: 'analyze',
    instruction: '請分析 @src/main.js',
    activeFile: '',
    contextFiles: [{ ok: true, file_path: 'src/main.js', content: 'console.log("hello")' }],
    resolvedReferencePaths: ['src/main.js'],
    workspaceOpen: true,
  })
  assert.equal(result.ok, true)
})

