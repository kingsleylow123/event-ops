import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBoardResult } from '../ingest'

// A well-formed external board result (as the /csuite harness would POST).
function validRaw(): Record<string, unknown> {
  return {
    mode: 'nightly',
    briefs: [{ dept: 'sales', headline: 'h', topIssue: 't', recommendedMove: 'm', confidence: 80, evidence: ['e1'] }],
    challenges: [{ dept: 'sales', verdict: 'REJECT', critique: 'c', crossFlags: ['x'] }],
    rulings: [{ title: 'T', decision: 'D', rationale: 'R', priority: 'high', confidence: 90 }],
    boardBrief: 'brief',
    rounds: 2,
  }
}

test('normalises a valid board result', () => {
  const r = normalizeBoardResult(validRaw())
  assert.ok(r)
  assert.equal(r.mode, 'nightly')
  assert.equal(r.briefs.length, 1)
  assert.equal(r.rulings[0].priority, 'high')
  assert.equal(r.challenges[0].verdict, 'REJECT')
})

test('rejects non-objects', () => {
  assert.equal(normalizeBoardResult(null), null)
  assert.equal(normalizeBoardResult('x'), null)
  assert.equal(normalizeBoardResult(42), null)
})

test('rejects a partial board missing rulings', () => {
  const raw = validRaw(); raw.rulings = []
  assert.equal(normalizeBoardResult(raw), null)
})

test('rejects a partial board missing briefs', () => {
  const raw = validRaw(); raw.briefs = []
  assert.equal(normalizeBoardResult(raw), null)
})

test('drops briefs with an invalid department', () => {
  const raw = validRaw()
  raw.briefs = [
    { dept: 'legal', headline: 'h', topIssue: 't', recommendedMove: 'm', confidence: 1, evidence: [] },
    { dept: 'sales', headline: 'h', topIssue: 't', recommendedMove: 'm', confidence: 1, evidence: [] },
  ]
  const r = normalizeBoardResult(raw)
  assert.ok(r)
  assert.equal(r.briefs.length, 1)
  assert.equal(r.briefs[0].dept, 'sales')
})

test('defaults an unknown verdict to APPROVE and unknown priority to medium', () => {
  const raw = validRaw()
  raw.challenges = [{ dept: 'sales', verdict: 'MAYBE', critique: '', crossFlags: [] }]
  raw.rulings = [{ title: 'T', decision: 'D', rationale: 'R', priority: 'urgent', confidence: 5 }]
  const r = normalizeBoardResult(raw)
  assert.ok(r)
  assert.equal(r.challenges[0].verdict, 'APPROVE')
  assert.equal(r.rulings[0].priority, 'medium')
})

test('caps boardBrief at 2000 chars and rulings at 5', () => {
  const raw = validRaw()
  raw.boardBrief = 'a'.repeat(5000)
  raw.rulings = Array.from({ length: 9 }, (_, i) => ({ title: 'T' + i, decision: 'D', rationale: 'R', priority: 'low', confidence: 1 }))
  const r = normalizeBoardResult(raw)
  assert.ok(r)
  assert.equal(r.boardBrief.length, 2000)
  assert.equal(r.rulings.length, 5)
})

test('falls back to ondemand for an invalid mode', () => {
  const raw = validRaw(); raw.mode = 'garbage'
  const r = normalizeBoardResult(raw)
  assert.ok(r)
  assert.equal(r.mode, 'ondemand')
})

test('coerces a non-array evidence to []', () => {
  const raw = validRaw()
  raw.briefs = [{ dept: 'ops', headline: 'h', topIssue: 't', recommendedMove: 'm', confidence: 50, evidence: 'not-an-array' }]
  const r = normalizeBoardResult(raw)
  assert.ok(r)
  assert.deepEqual(r.briefs[0].evidence, [])
})

test('keeps only ONE brief per dept (first wins)', () => {
  const raw = validRaw()
  raw.briefs = [
    { dept: 'sales', headline: 'first', topIssue: 't', recommendedMove: 'm', confidence: 1, evidence: [] },
    { dept: 'sales', headline: 'second', topIssue: 't', recommendedMove: 'm', confidence: 1, evidence: [] },
  ]
  const r = normalizeBoardResult(raw)
  assert.ok(r)
  assert.equal(r.briefs.length, 1)
  assert.equal(r.briefs[0].headline, 'first')
})

test('passes a valid prediction through and drops a malformed one', () => {
  const raw = validRaw()
  raw.briefs = [
    { dept: 'sales', headline: 'h', topIssue: 't', recommendedMove: 'm', confidence: 1, evidence: [], prediction: { metric: 'calls_booked_upcoming', direction: 'up', baseline: 0, target: 3 } },
    { dept: 'ops', headline: 'h', topIssue: 't', recommendedMove: 'm', confidence: 1, evidence: [], prediction: { metric: '', direction: 'sideways', baseline: 'x' } },
  ]
  const r = normalizeBoardResult(raw)
  assert.ok(r)
  assert.deepEqual(r.briefs[0].prediction, { metric: 'calls_booked_upcoming', direction: 'up', baseline: 0, target: 3 })
  assert.equal(r.briefs[1].prediction, undefined)
})

test('drops a degenerate target (already met at baseline) but keeps the direction', () => {
  const raw = validRaw()
  raw.briefs = [
    { dept: 'ops', headline: 'h', topIssue: 't', recommendedMove: 'm', confidence: 1, evidence: [], prediction: { metric: 'fill_pct', direction: 'up', baseline: 90, target: 85 } },
  ]
  const r = normalizeBoardResult(raw)
  assert.ok(r)
  assert.deepEqual(r.briefs[0].prediction, { metric: 'fill_pct', direction: 'up', baseline: 90 })
})

test('rejects predictions on derived trend keys', () => {
  const raw = validRaw()
  raw.briefs = [
    { dept: 'ops', headline: 'h', topIssue: 't', recommendedMove: 'm', confidence: 1, evidence: [], prediction: { metric: 'trend_vs_prior_week.deltas.paid', direction: 'up', baseline: 2 } },
  ]
  const r = normalizeBoardResult(raw)
  assert.ok(r)
  assert.equal(r.briefs[0].prediction, undefined)
})

test('passes challengeDegraded + per-dept dataSummaries through, dropping junk', () => {
  const raw = validRaw()
  raw.challengeDegraded = true
  raw.dataSummaries = { sales: { total_leads: 6 }, legal: { x: 1 }, ops: 'junk' }
  const r = normalizeBoardResult(raw)
  assert.ok(r)
  assert.equal(r.challengeDegraded, true)
  assert.deepEqual(r.dataSummaries, { sales: { total_leads: 6 } })
})
