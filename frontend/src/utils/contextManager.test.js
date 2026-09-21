import test from 'node:test'
import assert from 'node:assert/strict'
import { createManagedContextBundle } from './contextManager.js'

test('the serialized context budget includes separators between many small files', () => {
  const records = Array.from({ length: 3000 }, (_, index) => ({
    ok: true,
    file_path: `f${index}.txt`,
    content: 'x'.repeat(20),
  }))
  const bundle = createManagedContextBundle(records)
  assert.ok(bundle.text.length <= bundle.maxChars)
  assert.ok(bundle.files.length > 0)
  assert.ok(bundle.skipped.length > 0)
  assert.equal(bundle.estimatedTokens, Math.ceil(bundle.text.length / 4))
})

test('stale original size metadata cannot bypass the context budget', () => {
  const content = 'x'.repeat(200000)
  const bundle = createManagedContextBundle([
    { ok: true, file_path: 'large.txt', content, original_chars: 10 },
  ])
  assert.ok(bundle.text.length <= bundle.maxChars)
  assert.ok(bundle.totalChars <= bundle.maxChars)
  assert.ok(bundle.originalChars >= content.length)
  assert.ok(bundle.truncated)
})

test('tail excerpts retain the newest text while allowing for headers and separators', () => {
  const content = `${'older\n'.repeat(500)}LATEST MESSAGE`
  const bundle = createManagedContextBundle([
    { ok: true, file_path: 'first.txt', content: 'first', priority: 10 },
    { ok: true, file_path: 'history.md', content, preserve_tail: true },
  ], { maxChars: 1200, minSummaryChars: 1 })
  assert.equal(bundle.files.length, 2)
  assert.ok(bundle.text.length <= bundle.maxChars)
  assert.ok(bundle.files[1].content.endsWith('LATEST MESSAGE'))
  assert.equal(bundle.files[1].content_mode, 'excerpt')
})
