import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregatePricing } from '../tools/pricing'
import { isStagedWrite } from '../types'
import { matchTransactions } from '../../reconcile'

// ── aggregatePricing (the pricing-intelligence tool, failure #1) ───────────────
test('aggregatePricing: paid revenue + stripe/bank split + conversion', () => {
  const a = aggregatePricing([
    { ticket_type: 'standard_general', payment_status: 'paid', payment_amount: 347, payment_method: 'stripe' },
    { ticket_type: 'standard_general', payment_status: 'paid', payment_amount: 347, payment_method: 'bank_transfer' },
    { ticket_type: 'standard_vip', payment_status: 'paid', payment_amount: 697, payment_method: 'stripe' },
    { ticket_type: 'standard_general', payment_status: 'pending', payment_amount: 347, payment_method: 'stripe' },
  ])
  assert.equal(a.total_revenue, 347 + 347 + 697)
  assert.equal(a.paid_count, 3)
  assert.equal(a.stripe_revenue, 347 + 697)
  assert.equal(a.bank_revenue, 347)
  const general = a.by_tier.find(t => t.ticket_type === 'standard_general')!
  assert.equal(general.paid, 2)
  assert.equal(general.registered, 3) // includes the pending one
  assert.equal(general.list_price, 347)
  assert.equal(general.conversion_rate, Math.round((2 / 3) * 100) / 100)
})

test('aggregatePricing: free ticket (amount 0) is NOT counted as unpaid/lost revenue', () => {
  const a = aggregatePricing([
    { ticket_type: 'free_general', payment_status: 'free', payment_amount: 0, payment_method: 'free' },
    { ticket_type: 'free_general', payment_status: 'paid', payment_amount: 0, payment_method: 'free' },
  ])
  assert.equal(a.total_revenue, 0)
  const free = a.by_tier.find(t => t.ticket_type === 'free_general')!
  assert.equal(free.free, 1)
  assert.equal(free.paid, 1) // amount-0 paid still counts as paid, revenue 0
  assert.equal(free.revenue, 0)
})

test('aggregatePricing: discounted/negotiated amount surfaces in avg_actual_price', () => {
  const a = aggregatePricing([
    { ticket_type: 'standard_vip', payment_status: 'paid', payment_amount: 500, payment_method: 'stripe' },
  ])
  const vip = a.by_tier.find(t => t.ticket_type === 'standard_vip')!
  assert.equal(vip.avg_actual_price, 500)
  assert.equal(vip.list_price, 697) // below list → admin can see the discount
})

// ── matchTransactions (money write: who gets marked paid) ──────────────────────
test('matchTransactions: exact name + amount → single match', () => {
  const r = matchTransactions([{ payer: 'Ahmad Razak', amount: 347 }], [{ id: '1', name: 'Ahmad Razak', amount: 347 }])
  assert.equal(r.matches.length, 1)
  assert.equal(r.matches[0].attendee_id, '1')
  assert.equal(r.stillPending.length, 0)
  assert.equal(r.unmatchedTxns.length, 0)
})

test('matchTransactions: amount mismatch → no match, both unresolved', () => {
  const r = matchTransactions([{ payer: 'Ahmad Razak', amount: 100 }], [{ id: '1', name: 'Ahmad Razak', amount: 347 }])
  assert.equal(r.matches.length, 0)
  assert.equal(r.unmatchedTxns.length, 1)
  assert.equal(r.stillPending.length, 1)
})

test('matchTransactions: two same-amount same-score people → ambiguous, left unmatched', () => {
  const r = matchTransactions(
    [{ payer: 'Jeremy', amount: 297 }],
    [{ id: '1', name: 'Jeremy Lim', amount: 297 }, { id: '2', name: 'Jeremy Tan', amount: 297 }],
  )
  assert.equal(r.matches.length, 0) // never auto-pick between two Jeremys
  assert.equal(r.stillPending.length, 2)
})

test('matchTransactions: strips MY bank-statement noise (DuitNow / bin)', () => {
  const r = matchTransactions(
    [{ payer: 'DUITNOW TRANSFER FROM AHMAD BIN ALI', amount: 497 }],
    [{ id: '9', name: 'Ahmad Ali', amount: 497 }],
  )
  assert.equal(r.matches.length, 1)
  assert.equal(r.matches[0].attendee_id, '9')
})

test('matchTransactions: empty inputs are safe', () => {
  const r = matchTransactions([], [])
  assert.equal(r.matches.length, 0)
  assert.equal(r.unmatchedTxns.length, 0)
  assert.equal(r.stillPending.length, 0)
})

// ── isStagedWrite guard (write tools must never mutate inline) ──────────────────
test('isStagedWrite: distinguishes staged writes from plain tool data', () => {
  assert.equal(isStagedWrite({ __staged: true, kind: 'mark_paid', preview: 'x', pending: {} }), true)
  assert.equal(isStagedWrite({ ok: false, reason: 'already paid' }), false)
  assert.equal(isStagedWrite(null), false)
  assert.equal(isStagedWrite('staged'), false)
})
