const test = require('node:test')
const assert = require('node:assert/strict')

const { validateGeneratedArtifact, validateGeneratedFiles } = require('../src/services/generatedCodeValidation')

test('rejects the previously observed truncated React output', () => {
  const result = validateGeneratedArtifact({
    filePath: 'WeatherCard.jsx',
    code: "import React from 'react';\nconst WeatherCard = () => {\n  const style = { width: '26",
  })
  assert.equal(result.ok, false)
  assert.equal(result.errors.some(error => /語法錯誤|未關閉|截斷/.test(error)), true)
})

test('accepts complete JSX output', () => {
  const result = validateGeneratedArtifact({
    filePath: 'WeatherCard.jsx',
    code: "import React from 'react';\nexport default function WeatherCard() { return <div>Sunny</div>; }",
  })
  assert.equal(result.ok, true)
})

test('accepts apostrophes inside JSX text', () => {
  const result = validateGeneratedArtifact({ filePath: 'Message.jsx', code: "export default function Message() { return <div>Don't stop</div>; }" })
  assert.equal(result.ok, true)
})

test('accepts a complete JavaScript file whose final line is a period-ended comment', () => {
  const result = validateGeneratedArtifact({
    filePath: 'generated.js',
    code: 'function add(a, b) { return a + b; }\n// Numeric types map to JavaScript number.',
  })
  assert.equal(result.ok, true)
})

test('rejects file output wrappers inside generated source content', () => {
  const result = validateGeneratedArtifact({
    filePath: 'generated.html',
    code: '<file_output>\ngenerated.js\n<!DOCTYPE html><html><body>bad</body></html>\n</file_output>',
  })
  assert.equal(result.ok, false)
  assert.equal(result.errors.some(error => /file_output/.test(error)), true)
})

test('reports which file is invalid in multi-file output', () => {
  const result = validateGeneratedFiles([
    { path: 'valid.js', content: 'export const value = 1;' },
    { path: 'broken.js', content: 'export const value = {' },
  ])
  assert.equal(result.ok, false)
  assert.equal(result.errors.some(error => error.startsWith('broken.js:')), true)
})

test('accepts short data-file schemas such as CSV headers', () => {
  const result = validateGeneratedArtifact({
    filePath: 'sales.csv',
    code: 'item,amount',
  })
  assert.equal(result.ok, true)
})

test('rejects tkinter code that skips GUI solely because DISPLAY is missing', () => {
  const result = validateGeneratedArtifact({
    filePath: 'generated.py',
    code: [
      'import os',
      'import tkinter as tk',
      '',
      'def run_app():',
      '    if os.environ.get("DISPLAY", "") == "":',
      '        print("No DISPLAY environment variable found. Skipping GUI execution.")',
      '        return',
      '    root = tk.Tk()',
      '    root.mainloop()',
    ].join('\n'),
  })
  assert.equal(result.ok, false)
  assert.equal(result.errors.some(error => /DISPLAY.*Windows|Windows.*DISPLAY/.test(error)), true)
})

test('accepts tkinter headless guard when it excludes Windows', () => {
  const result = validateGeneratedArtifact({
    filePath: 'generated.py',
    code: [
      'import os',
      'import sys',
      'import tkinter as tk',
      '',
      'def run_app():',
      '    if sys.platform != "win32" and not os.environ.get("DISPLAY"):',
      '        print("No DISPLAY environment variable found. Skipping GUI execution.")',
      '        return',
      '    root = tk.Tk()',
      '    root.mainloop()',
    ].join('\n'),
  })
  assert.equal(result.ok, true)
})

test('accepts Python comments and docstrings containing parentheses or apostrophes', () => {
  const result = validateGeneratedArtifact({
    filePath: 'compass.py',
    code: [
      '# 建立電子指南針函式 (Python)',
      '# It\'s a simple compass function (0-360 degrees)',
      'def get_compass_direction(angle):',
      '    """',
      '    方位判斷 (0-360)',
      '    """',
      '    directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]',
      '    return directions[int(((angle + 22.5) % 360) // 45)]',
    ].join('\n'),
  })
  assert.equal(result.ok, true)
})

test('accepts HTML counter CSS ID selectors, hex colors and ordinary text punctuation', () => {
  const code = `<!doctype html>
<html><head><style>
#counter {
  color: #333;
  background: url(https://example.test/image.png);
}
</style></head><body>
<p>Don't stop! Choose (one) or {anything.</p>
<button id="counter" title="Don't stop (">0</button>
<script>
const counter = document.getElementById('counter');
counter.addEventListener('click', () => { counter.textContent = Number(counter.textContent) + 1; });
</script></body></html>`
  for (const target of [{ filePath: 'index.html' }, { language: 'html' }]) {
    const result = validateGeneratedArtifact({ code, ...target })
    assert.equal(result.ok, true, result.errors.join('\n'))
  }
})

test('accepts standalone CSS without treating selectors, colors or URLs as comments', () => {
  const result = validateGeneratedArtifact({
    filePath: 'style.css',
    code: '#counter { color: #333; background: url(https://example.test/image.png); }',
  })
  assert.equal(result.ok, true, result.errors.join('\n'))
})

test('HTML validation rejects broken embedded JavaScript and CSS', () => {
  for (const code of [
    '<html><script>const count = ;</script></html>',
    '<html><style>#counter { color: #333;</style></html>',
    '<html><script>const count = 0;',
  ]) {
    const result = validateGeneratedArtifact({ filePath: 'index.html', code })
    assert.equal(result.ok, false)
    assert.match(result.errors.join('\n'), /script|style/i)
  }
})

test('HTML validation distinguishes executable scripts from data, comments and raw text', () => {
  const result = validateGeneratedArtifact({
    filePath: 'index.html',
    code: `<html><body>
<!-- <script>invalid JavaScript here</script> -->
<textarea><script>invalid JavaScript here</script></textarea>
<script src="app.js">ignored fallback text</script>
<script type="application/ld+json">{"name":"test"}</script>
<script type="module">export const count = 0;</script>
</body></html>`,
  })
  assert.equal(result.ok, true, result.errors.join('\n'))
})

test('HTML validation rejects embedded JavaScript with undeclared slash identifier typos like is/workMode', () => {
  const result = validateGeneratedArtifact({
    filePath: 'generated.html',
    code: `<!DOCTYPE html><html><body><script>
      let isWorkMode = true;
      const message = is/workMode ? '工作結束' : '休息結束';
    </script></body></html>`,
  })
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /is\/workMode/)
})

test('Python validation rejects full-width punctuation and invalid syntax', () => {
  const result = validateGeneratedArtifact({
    filePath: 'attendance.py',
    code: `import tkinter as tk\nclass AttendanceApp:\n    def __init__(self, root):\n        self.frame = tk.．Frame(root)\n`,
  })
  assert.equal(result.ok, false)
  assert.equal(result.errors.some(error => /Python 語法解析失敗/.test(error)), true)
})

test('Python validation rejects truncated function/class blocks', () => {
  const result = validateGeneratedArtifact({
    filePath: 'attendance.py',
    code: `import tkinter as tk\nclass AttendanceApp:\n    def setup_ui(self):\n`,
  })
  assert.equal(result.ok, false)
  assert.equal(result.errors.some(error => /Python 語法解析失敗/.test(error)), true)
})
