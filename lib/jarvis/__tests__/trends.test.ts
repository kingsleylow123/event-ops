import test from 'node:test'
import assert from 'node:assert/strict'
import { computeDeltas, projectFill, rankDigestActions, type Snapshot } from '../../jarvis-trends'

const snap = (o: Partial<Snapshot>): Snapshot => ({
  registered: 0, paid_count: 0, free_count: 0, gross_revenue: 0, survey_count: 0,
  deals_new: 0, deals_contacted: 0, deals_meeting: 0, deals_won: 0, ...o,
})

// ── computeDeltas ──────────────────────────────────────────────────────────────
test('computeDeltas: null when no prior snapshot', () => {
  assert.equal(computeDeltas(snap({ paid_count: 5 }), null), null)
})

test('computeDeltas: null when nothing moved', () => {
  const s = snap({ paid_count: 5, gross_revenue: 500 })
  assert.equal(computeDeltas(s, s), null)
})

test('computeDeltas: reports paid + revenue + won movement', () => {
  const d = computeDeltas(
    snap({ paid_count: 8, gross_revenue: 950, deals_won: 1 }),
    snap({ paid_count: 5, gross_revenue: 500, deals_won: 0 }),
  )
  assert.ok(d)
  assert.equal(d!.paid, 3)
  assert.equal(d!.revenue, 450)
  assert.equal(d!.deals_won, 1)
})

// ── projectFill ─────────────────────────────────────────────────────────────────
test('projectFill: null when too close to event (daysUntil < 5)', () => {
  assert.equal(projectFill(20, 10, 7, 50, 4), null)
})

test('projectFill: null when no window-ago snapshot', () => {
  assert.equal(projectFill(20, null, 7, 50, 10), null)
})

test('projectFill: positive rate → real ETA', () => {
  const p = projectFill(28, 14, 7, 50, 12) // +14 over 7d = 2/day, 22 left → 11 days
  assert.ok(p)
  assert.equal(p!.stalled, false)
  assert.equal(p!.ratePerDay, 2)
  assert.equal(p!.daysToFull, 11)
})

test('projectFill: refund / no signups (rate <= 0) → stalled, never negative ETA', () => {
  const p = projectFill(18, 20, 7, 50, 10) // paid went DOWN (refund)
  assert.ok(p)
  assert.equal(p!.stalled, true)
  assert.equal(p!.daysToFull, null)
})

// ── rankDigestActions ────────────────────────────────────────────────────────────
test('rankDigestActions: money-in-hand outranks a pile of cold leads', () => {
  const a = rankDigestActions({ pendingCount: 2, pendingRevenue: 1998, postEventGap: 0, paceBehindPct: null, agedLeads: 6, openClaims: 0, daysUntil: 10 })
  assert.ok(a && a.includes('pending payment'))
})

test('rankDigestActions: surfaces the post-event gap when no pending', () => {
  const a = rankDigestActions({ pendingCount: 0, pendingRevenue: 0, postEventGap: 5, paceBehindPct: null, agedLeads: 2, openClaims: 0, daysUntil: -3 })
  assert.ok(a && a.includes('not yet in the pipeline'))
})

test('rankDigestActions: null when nothing actionable', () => {
  assert.equal(rankDigestActions({ pendingCount: 0, pendingRevenue: 0, postEventGap: 0, paceBehindPct: null, agedLeads: 0, openClaims: 0, daysUntil: 10 }), null)
})
