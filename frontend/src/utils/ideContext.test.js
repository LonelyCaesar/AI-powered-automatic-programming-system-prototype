import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { buildIdeContextPathEntries } from './ideContext.js'

test('IDE context includes open and pinned files while preserving explicit task targets', () => {
  const entries = buildIdeContextPathEntries({
    includeIdeContext: true,
    activeFile: 'src/active.js',
    openEditorFiles: ['src/active.js', 'src/open.js'],
    pinnedContextFiles: ['src/pinned.js'],
    extraPaths: ['src/explicit.js'],
  })

  assert.deepEqual(entries.map(item => item.path), [
    'src/active.js',
    'src/explicit.js',
    'src/open.js',
    'src/pinned.js',
  ])
})

test('IDE context off excludes automatic files but keeps explicit planning targets', () => {
  const entries = buildIdeContextPathEntries({
    includeIdeContext: false,
    activeFile: 'src/active.js',
    openEditorFiles: ['src/open.js'],
    pinnedContextFiles: ['src/pinned.js'],
    extraPaths: ['src/explicit.js'],
  })

  assert.deepEqual(entries, [
    { path: 'src/explicit.js', priority: 90, role: 'task_target' },
  ])
})

test('planning mode forwards mentioned files as explicit context targets', () => {
  const appSource = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
  assert.match(appSource, /const explicitPlanContextPaths = getUniquePaths/)
  assert.match(appSource, /resolveMentionedFilePaths\(instruction\)/)
  assert.match(appSource, /buildContextBundle\(explicitPlanContextPaths\)/)
})

test('accepted planning execution forbids fake data as the product result', () => {
  const appSource = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
  assert.match(appSource, /真實執行要求/)
  assert.match(appSource, /假資料/)
  assert.match(appSource, /mock data/)
  assert.match(appSource, /不能成為正式功能資料來源/)
})

test('planning clarification uses compact dynamic choice controls', () => {
  const componentSource = readFileSync(new URL('../components/PlanClarificationCard.vue', import.meta.url), 'utf8')
  const fixedPrompt = ['你希望這次', '交付到什麼程度'].join('')
  assert.match(componentSource, /currentIndex \+ 1/)
  assert.match(componentSource, /of {{ questions\.length }}/)
  assert.match(componentSource, /choice-row/)
  assert.match(componentSource, /繼續/)
  assert.equal(componentSource.includes(fixedPrompt), false)
})

test('Agent options expose their expanded and checked states to assistive technology', () => {
  const componentSource = readFileSync(new URL('../components/ChatCommandPanel.vue', import.meta.url), 'utf8')
  assert.match(componentSource, /:aria-expanded="agentOptionsOpen"/)
  assert.match(componentSource, /role="menuitemcheckbox"/)
  assert.match(componentSource, /:aria-checked="includeIdeContext"/)
  assert.match(componentSource, /:aria-checked="planningMode"/)
  assert.match(componentSource, /function togglePlanningMode\(\)[\s\S]*emit\('toggle-planning-mode'[\s\S]*closeAgentOptions\(\)/)
})
