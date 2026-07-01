import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractJson, clampInt } from '../llm'

test('extractJson parses a bare object', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 })
})

test('extractJson strips ```json fences', () => {
  assert.deepEqual(extractJson('here:\n```json\n{"a":2}\n```\nthanks'), { a: 2 })
})

test('extractJson extracts an object embedded in prose', () => {
  assert.deepEqual(extractJson('sure — {"headline":"ok","confidence":80} done'), { headline: 'ok', confidence: 80 })
})

test('extractJson returns null on malformed / absent JSON', () => {
  assert.equal(extractJson('no json here'), null)
  assert.equal(extractJson('{not valid}'), null)
  assert.equal(extractJson(''), null)
})

test('extractJson strips prototype-pollution keys', () => {
  const r = extractJson('{"__proto__":{"x":1},"ok":true}') as Record<string, unknown>
  assert.equal(r.ok, true)
  assert.ok(!Object.prototype.hasOwnProperty.call(r, '__proto__'))
})

test('clampInt clamps to range and rounds', () => {
  assert.equal(clampInt(150, 0, 100), 100)
  assert.equal(clampInt(-5, 0, 100), 0)
  assert.equal(clampInt(42.6, 0, 100), 43)
})

test('clampInt returns lo for non-finite input', () => {
  assert.equal(clampInt('abc', 0, 100), 0)
  assert.equal(clampInt(undefined, 10, 100), 10)
  assert.equal(clampInt(NaN, 3, 100), 3)
})
