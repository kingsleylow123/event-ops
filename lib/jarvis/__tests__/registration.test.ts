import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  tierOptions,
  validatePurchase,
  resolvePaidTicketType,
  resolveWebhookTarget,
  normalizeTier,
} from '../../registration'

test('tierOptions: general + VIP for a tier, priced from the shared table', () => {
  const opts = tierOptions('early_bird')
  assert.equal(opts.length, 2)
  assert.deepEqual(opts.map(o => o.ticket_type), ['early_bird_general', 'early_bird_vip'])
  assert.equal(opts[0].price, 297)
  assert.equal(opts[1].price, 597)
  assert.equal(opts[1].variant, 'vip')
})

test('normalizeTier: unknown / null falls back to standard', () => {
  assert.equal(normalizeTier('early_bird'), 'early_bird')
  assert.equal(normalizeTier(null), 'standard')
  assert.equal(normalizeTier('hacker_tier'), 'standard')
})

test('validatePurchase: only a variant of the LIVE tier is allowed (anti-undercut)', () => {
  // Buying VIP at the live early_bird tier → ok, price pinned from our table.
  assert.deepEqual(validatePurchase('early_bird_vip', 'early_bird'), { ticket_type: 'early_bird_vip', price: 597 })
  // Trying to buy the cheaper super_early_bird while standard is live → rejected.
  assert.equal(validatePurchase('super_early_bird_general', 'standard'), null)
  // Free tickets are never a /register purchase.
  assert.equal(validatePurchase('free_general', 'standard'), null)
  // Garbage input → rejected.
  assert.equal(validatePurchase('', 'early_bird'), null)
})

test('resolvePaidTicketType: metadata wins; legacy falls back to amount band', () => {
  // Metadata is authoritative even when the amount looks like another tier.
  assert.equal(resolvePaidTicketType('early_bird_vip', 999, false), 'early_bird_vip')
  // Legacy Payment Link (no metadata) → infer from amount + vip flag.
  assert.equal(resolvePaidTicketType(null, 249, false), 'super_early_bird_general')
  assert.equal(resolvePaidTicketType('', 297, false), 'early_bird_general')
  assert.equal(resolvePaidTicketType(undefined, 347, false), 'standard_general')
  assert.equal(resolvePaidTicketType(null, 600, true), 'standard_vip')
  assert.equal(resolvePaidTicketType(null, 497, true), 'super_early_bird_vip')
})

test('resolveWebhookTarget: metadata event_id is deterministic', () => {
  const now = Date.parse('2026-06-27T00:00:00Z')
  const events = [
    { id: 'a', name: '5 Jul', date: '2026-07-05T09:30:00Z' },
    { id: 'b', name: '12 Jul', date: '2026-07-12T09:30:00Z' },
  ]
  const r = resolveWebhookTarget('b', events, now)
  assert.equal(r.event?.id, 'b')
  assert.equal(r.resolved, 'metadata')
})

test('resolveWebhookTarget: no metadata → soonest upcoming, flagged as a guess', () => {
  const now = Date.parse('2026-06-27T00:00:00Z')
  const events = [
    { id: 'a', name: '5 Jul', date: '2026-07-05T09:30:00Z' },
    { id: 'b', name: '12 Jul', date: '2026-07-12T09:30:00Z' },
  ]
  const r = resolveWebhookTarget(null, events, now)
  assert.equal(r.event?.id, 'a') // soonest
  assert.equal(r.resolved, 'guess')
  assert.equal(r.ambiguous, 2) // both competed → admin ping warns
})

test('resolveWebhookTarget: missing metadata event falls back to the guess', () => {
  const now = Date.parse('2026-06-27T00:00:00Z')
  const events = [{ id: 'a', name: '5 Jul', date: '2026-07-05T09:30:00Z' }]
  const r = resolveWebhookTarget('deleted-id', events, now)
  assert.equal(r.event?.id, 'a')
  assert.equal(r.resolved, 'guess')
})

test('resolveWebhookTarget: all events past the grace → none', () => {
  const now = Date.parse('2026-06-27T00:00:00Z')
  const events = [{ id: 'a', name: 'Jan', date: '2026-01-01T00:00:00Z' }]
  const r = resolveWebhookTarget(null, events, now)
  assert.equal(r.event, null)
  assert.equal(r.resolved, 'none')
})
