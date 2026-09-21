const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  detectEmptyInnerHtmlGuardRisks,
  extractLocalHtmlAssets,
  inspectDocumentApiCalls,
  runStaticHtmlCheck,
} = require('../src/services/sandboxService')
const { runTests } = require('../src/tools/testRunner')
const { resolveProjectWorkspace } = require('../src/services/sandboxWorkspaceService')

test('static HTML inspection follows actual local assets instead of fixed filenames', () => {
  const html = `
    <link rel="stylesheet" href="./assets/thermometer.css?v=2">
    <link rel="preconnect" href="https://fonts.example.com">
    <script src="./main.js" defer></script>
    <script type="module" src="/shared/app.mjs#boot"></script>
    <script src="https://cdn.example.com/library.js"></script>
  `

  assert.deepEqual(extractLocalHtmlAssets(html, 'electronic_apps/thermometer/index.html'), {
    scripts: ['electronic_apps/thermometer/main.js', 'shared/app.mjs'],
    styles: ['electronic_apps/thermometer/assets/thermometer.css'],
  })
})

test('static HTML inspection ignores paths that escape the project', () => {
  const html = '<script src="../../../outside.js"></script>'
  assert.deepEqual(extractLocalHtmlAssets(html, 'app/index.html'), { scripts: [], styles: [] })
})

test('static HTML inspection catches comment-only containers guarded by innerHTML equality', () => {
  const html = `
    <div id="clock-container">
      <!-- Clock cards will be injected here by JavaScript -->
    </div>
    <script>
      function updateClocks() {
        const container = document.getElementById('clock-container');
        if (container.innerHTML === '') {
          container.appendChild(document.createElement('div'));
        }
      }
      updateClocks();
    </script>
  `

  const risks = detectEmptyInnerHtmlGuardRisks(html)
  assert.equal(risks.length, 1)
  assert.equal(risks[0].ok, false)
  assert.match(risks[0].message, /#clock-container/)
  assert.match(risks[0].message, /空白頁/)
})

test('static HTML check validates the requested html file instead of always reading index.html', async () => {
  const workspaceId = `static-html-file-${Date.now()}`
  const workspace = resolveProjectWorkspace(workspaceId)
  try {
    fs.writeFileSync(path.join(workspace.path, 'index.html'), '<!doctype html><p>healthy index</p>', 'utf8')
    fs.writeFileSync(path.join(workspace.path, 'generated.html'), `
      <!doctype html>
      <div id="clock-container"><!-- injected later --></div>
      <script>
        const container = document.getElementById('clock-container');
        if (container.innerHTML === '') {
          container.textContent = 'ready';
        }
      </script>
    `, 'utf8')

    const result = await runStaticHtmlCheck('generated.html', { workspaceId })
    assert.equal(result.ok, false)
    assert.match(result.stdout, /generated\.html 存在/)
    assert.match(result.stdout, /#clock-container/)
    assert.doesNotMatch(result.stdout, /index\.html 存在/)
  } finally {
    fs.rmSync(workspace.path, { recursive: true, force: true })
  }
})

test('static HTML check rejects model file_output wrappers', async () => {
  const workspaceId = `static-html-wrapper-${Date.now()}`
  const workspace = resolveProjectWorkspace(workspaceId)
  try {
    fs.writeFileSync(path.join(workspace.path, 'generated.html'), `
      <file_output>
      generated.html
      <!doctype html>
      <html><body>broken wrapper</body></html>
    `, 'utf8')

    const result = await runStaticHtmlCheck('generated.html', { workspaceId })
    assert.equal(result.ok, false)
    assert.match(result.stdout, /generated\.html 不含模型輸出包裝標籤/)
  } finally {
    fs.rmSync(workspace.path, { recursive: true, force: true })
  }
})

test('static HTML check catches misspelled document DOM APIs in referenced scripts', async () => {
  const workspaceId = `static-html-dom-api-${Date.now()}`
  const workspace = resolveProjectWorkspace(workspaceId)
  try {
    fs.writeFileSync(path.join(workspace.path, 'index.html'), `
      <!doctype html>
      <svg id="map"></svg>
      <script src="script.js"></script>
    `, 'utf8')
    fs.writeFileSync(path.join(workspace.path, 'script.js'), `
      const svg = document.getElementById('map');
      const path = document.ncreateElementNS('http://www.w3.org/2000/svg', 'path');
      svg.appendChild(path);
    `, 'utf8')

    const result = await runStaticHtmlCheck('index.html', { workspaceId })
    assert.equal(result.ok, false)
    assert.match(result.stdout, /script\.js 使用未知 document\.ncreateElementNS\(\)/)
  } finally {
    fs.rmSync(workspace.path, { recursive: true, force: true })
  }
})

test('targeted static HTML validation catches syntax errors in renamed referenced scripts', async () => {
  const result = await runTests(
    'generated.html',
    '<!doctype html><html><head><script src="script (2).js"></script></head><body>ok</body></html>',
    null,
    [
      { ok: true, file_path: 'style (2).css', content: 'body { color: #111; }' },
      { ok: true, file_path: 'script (2).js', content: 'document.addEventListener("click", request' },
    ],
    {
      workspaceSource: 'backend',
      projectId: `targeted-static-html-${Date.now()}`,
      staticHtmlCheck: true,
    },
  )

  assert.equal(result.ok, false)
  assert.equal(result.kind, 'html_check')
  assert.match(`${result.stdout}\n${result.stderr}`, /script \(2\)\.js/)
  assert.match(`${result.stdout}\n${result.stderr}`, /語法錯誤|SyntaxError|Unexpected token/)
})

test('document API inspection allows common DOM methods', () => {
  const checks = inspectDocumentApiCalls(`
    document.addEventListener('DOMContentLoaded', () => {});
    document.querySelector('#app');
    document.createElementNS('http://www.w3.org/2000/svg', 'path');
  `)
  assert.deepEqual(checks, [])
})
