import { TICKET_PRICES, TICKET_LABELS, type TicketType } from '@/lib/supabase'

// ── Pricing tiers ────────────────────────────────────────────────────────────
// The tier an admin can have "live" on an event. Free tickets stay manual
// (Attendees tab), so they are not a /register option.
export const PRICING_TIERS = ['super_early_bird', 'early_bird', 'standard'] as const
export type PricingTier = (typeof PRICING_TIERS)[number]

export const PRICING_TIER_LABELS: Record<PricingTier, string> = {
  super_early_bird: 'Super Early Bird',
  early_bird: 'Early Bird',
  standard: 'Public',
}

export function normalizeTier(v: unknown): PricingTier {
  const s = String(v ?? '').trim()
  return (PRICING_TIERS as readonly string[]).includes(s) ? (s as PricingTier) : 'standard'
}

export interface TierOption {
  ticket_type: TicketType
  variant: 'general' | 'vip'
  label: string
  price: number
}

// The General + VIP options for a tier, priced from the shared TICKET tables.
export function tierOptions(tier: PricingTier): TierOption[] {
  return (['general', 'vip'] as const).map(variant => {
    const ticket_type = `${tier}_${variant}` as TicketType
    return { ticket_type, variant, label: TICKET_LABELS[ticket_type], price: TICKET_PRICES[ticket_type] }
  })
}

// Server-authoritative price check: a /register request may only buy a variant
// of the event's CURRENT live tier, priced from our own table — never the amount
// the client sent. Stops a tampered POST (editing ticket_type) from buying a
// cheaper tier than the one on sale. Returns the canonical type + RM price, or
// null when the request doesn't match the live tier.
export function validatePurchase(
  requestedTicketType: unknown,
  liveTier: PricingTier,
): { ticket_type: TicketType; price: number } | null {
  const match = tierOptions(liveTier).find(o => o.ticket_type === requestedTicketType)
  return match ? { ticket_type: match.ticket_type, price: match.price } : null
}

// ── Webhook side ─────────────────────────────────────────────────────────────

// Deterministic ticket_type for an incoming payment. Trust the EventOps-generated
// checkout metadata first; for legacy Payment Links (no metadata) infer the tier
// from the amount paid (mirrors app/api/stripe/sync), with `vip` telling the VIP
// band from General.
export function resolvePaidTicketType(metadataTicketType: unknown, amountRm: number, vip: boolean): TicketType {
  const m = String(metadataTicketType ?? '')
  if (m in TICKET_PRICES) return m as TicketType
  if (vip) {
    if (amountRm <= 497) return 'super_early_bird_vip'
    if (amountRm <= 597) return 'early_bird_vip'
    return 'standard_vip'
  }
  if (amountRm <= 249) return 'super_early_bird_general'
  if (amountRm <= 297) return 'early_bird_general'
  return 'standard_general'
}

// Which event an incoming payment belongs to. The EventOps checkout stamps
// event_id into metadata → deterministic. Legacy Payment Links carry none, so we
// fall back to the soonest event still inside a 12h day-of grace and flag it as a
// guess (`resolved:'guess'`, `ambiguous` = how many upcoming events competed) so
// a wrong attach is caught fast.
export interface WebhookEventCandidate { id: string; name: string | null; date: string | null }
export interface WebhookTarget {
  event: WebhookEventCandidate | null
  resolved: 'metadata' | 'guess' | 'none'
  ambiguous: number
}

export function resolveWebhookTarget(
  metadataEventId: unknown,
  events: WebhookEventCandidate[],
  now: number,
): WebhookTarget {
  const mid = String(metadataEventId ?? '')
  if (mid) {
    const hit = events.find(e => e.id === mid)
    if (hit) return { event: hit, resolved: 'metadata', ambiguous: 0 }
    // metadata present but event deleted/missing → fall through to the guess.
  }
  const graceCutoff = now - 12 * 3600_000
  const upcoming = events
    .filter(e => e.date && new Date(e.date).getTime() >= graceCutoff)
    .sort((a, b) => new Date(a.date as string).getTime() - new Date(b.date as string).getTime())
  if (!upcoming.length) return { event: null, resolved: 'none', ambiguous: 0 }
  return { event: upcoming[0], resolved: 'guess', ambiguous: upcoming.length }
}
