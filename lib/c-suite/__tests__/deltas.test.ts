import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffSummaries, gradePrediction, readMetric } from '../deltas'

// ── diffSummaries: "since last sitting" ────────────────────────────────────────
test('diffs top-level numeric keys that changed', () => {
  const lines = diffSummaries({ paid: 31, registered: 50 }, { paid: 35, registered: 50 })
  assert.deepEqual(lines, ['paid 31→35 (+4)'])
})

test('diffs one level into nested records (by_status etc.)', () => {
  const lines = diffSummaries(
    { by_status: { new: 2, meeting: 4 } },
    { by_status: { new: 1, meeting: 6 } },
  )
  assert.ok(lines.includes('by_status.new 2→1 (-1)'))
  assert.ok(lines.includes('by_status.meeting 4→6 (+2)'))
})

test('returns [] when prior is missing or nothing moved', () => {
  assert.deepEqual(diffSummaries(null, { a: 1 }), [])
  assert.deepEqual(diffSummaries({ a: 1 }, { a: 1 }), [])
})

test('ignores non-numeric and array values', () => {
  const lines = diffSummaries(
    { name: 'July', list: [1, 2], n: 1 },
    { name: 'August', list: [3], n: 2 },
  )
  assert.deepEqual(lines, ['n 1→2 (+1)'])
})

test('caps output at 12 lines', () => {
  const prior: Record<string, number> = {}
  const cur: Record<string, number> = {}
  for (let i = 0; i < 20; i++) { prior[`k${i}`] = i; cur[`k${i}`] = i + 1 }
  assert.equal(diffSummaries(prior, cur).length, 12)
})

// ── gradePrediction: the deterministic learning loop ───────────────────────────
test('directional: held when the metric moved the predicted way', () => {
  assert.equal(gradePrediction({ metric: 'calls', direction: 'up', baseline: 0 }, 3), 'held')
  assert.equal(gradePrediction({ metric: 'unpaid', direction: 'down', baseline: 42 }, 35), 'held')
})

test('directional: wrong when it moved the opposite way', () => {
  assert.equal(gradePrediction({ metric: 'calls', direction: 'up', baseline: 5 }, 2), 'wrong')
})

test('directional: inconclusive when unchanged', () => {
  assert.equal(gradePrediction({ metric: 'calls', direction: 'up', baseline: 5 }, 5), 'inconclusive')
})

test('with target: held only when the target is reached', () => {
  assert.equal(gradePrediction({ metric: 'fill_pct', direction: 'up', baseline: 70, target: 85 }, 86), 'held')
  // moved up but short of target → inconclusive, not held
  assert.equal(gradePrediction({ metric: 'fill_pct', direction: 'up', baseline: 70, target: 85 }, 80), 'inconclusive')
  // moved backwards → wrong
  assert.equal(gradePrediction({ metric: 'fill_pct', direction: 'up', baseline: 70, target: 85 }, 60), 'wrong')
})

test('degenerate target (already met at baseline) cannot score held for free', () => {
  // baseline 90, target 85 ("up"): metric FELL to 88 — target branch must not
  // award 'held'; the fall is 'wrong'. (Track-record inflation guard.)
  assert.equal(gradePrediction({ metric: 'fill_pct', direction: 'up', baseline: 90, target: 85 }, 88), 'wrong')
  // unchanged at 90 with target already met → inconclusive, not held
  assert.equal(gradePrediction({ metric: 'fill_pct', direction: 'up', baseline: 90, target: 85 }, 90), 'inconclusive')
  // mirror for 'down': baseline 10, target 20, metric rose to 15 → wrong
  assert.equal(gradePrediction({ metric: 'unpaid', direction: 'down', baseline: 10, target: 20 }, 15), 'wrong')
})

test('inconclusive when the metric is missing or non-numeric', () => {
  assert.equal(gradePrediction({ metric: 'gone', direction: 'up', baseline: 1 }, undefined), 'inconclusive')
  assert.equal(gradePrediction({ metric: 'gone', direction: 'up', baseline: 1 }, 'n/a'), 'inconclusive')
})

// ── readMetric ─────────────────────────────────────────────────────────────────
test('reads flat and dotted metric keys', () => {
  const summary = { paid: 31, by_status: { meeting: 4 } }
  assert.equal(readMetric(summary, 'paid'), 31)
  assert.equal(readMetric(summary, 'by_status.meeting'), 4)
  assert.equal(readMetric(summary, 'by_status.missing'), undefined)
  assert.equal(readMetric(null, 'paid'), undefined)
})