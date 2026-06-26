import type Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { TICKET_LABELS, TICKET_PRICES, type TicketType } from '@/lib/supabase'
import type { ToolDef, AgentContext } from '../types'
import { resolveEventId, eventLabel, round2 } from '../util'

// Pure aggregation — exported for unit tests (no DB). Buckets attendees by
// ticket tier and computes paid/free counts, revenue, average actual price
// (catches discounts/overrides), conversion, and the Stripe-vs-bank split.
export interface PricingInput {
  ticket_type?: string | null
  payment_status?: string | null
  payment_amount?: unknown
  payment_method?: string | null
}

export function aggregatePricing(attendees: PricingInput[]) {
  const tiers: Record<string, { registered: number; paid: number; free: number; revenue: number }> = {}
  let totalRevenue = 0
  let stripeRevenue = 0
  let bankRevenue = 0
  let paidCount = 0

  for (const a of attendees) {
    const t = String(a.ticket_type ?? 'unknown')
    tiers[t] ??= { registered: 0, paid: 0, free: 0, revenue: 0 }
    tiers[t].registered++
    if (a.payment_status === 'paid') {
      const amt = Number(a.payment_amount ?? 0)
      tiers[t].paid++
      tiers[t].revenue += amt
      totalRevenue += amt
      paidCount++
      if (a.payment_method === 'stripe') stripeRevenue += amt
      else if (a.payment_method === 'bank_transfer') bankRevenue += amt
    } else if (a.payment_status === 'free') {
      tiers[t].free++
    }
  }

  const by_tier = Object.entries(tiers)
    .map(([ticket_type, s]) => ({
      ticket_type,
      label: TICKET_LABELS[ticket_type as TicketType] ?? ticket_type,
      list_price: TICKET_PRICES[ticket_type as TicketType] ?? null,
      registered: s.registered,
      paid: s.paid,
      free: s.free,
      revenue: round2(s.revenue),
      avg_actual_price: s.paid ? round2(s.revenue / s.paid) : 0,
      conversion_rate: s.registered ? round2(s.paid / s.registered) : 0,
      revenue_pct: totalRevenue ? Math.round((s.revenue / totalRevenue) * 100) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)

  return {
    total_revenue: round2(totalRevenue),
    paid_count: paidCount,
    stripe_revenue: round2(stripeRevenue),
    bank_revenue: round2(bankRevenue),
    by_tier,
  }
}

const ANALYZE_PRICING_SCHEMA: Anthropic.Tool = {
  name: 'analyze_pricing',
  description:
    'Analyze ticket pricing and revenue. Returns the list prices (General vs VIP at each tier), and — for an event or all-time — how many paid at each tier, revenue per tier, average actual price paid (vs list), conversion rate, and the Stripe-vs-bank revenue split. Use for ANY question about ticket prices, "which price point", Stripe revenue, or payment breakdowns. The Stripe split here means you NEVER need external Stripe access.',
  input_schema: {
    type: 'object',
    properties: {
      event_id: { type: 'string', description: 'Event id to scope to. Defaults to the active event.' },
      scope: { type: 'string', enum: ['single', 'all_time'], description: 'single = one event (default). all_time = every event combined.' },
    },
  },
}

async function analyzePricing(args: Record<string, unknown>, ctx: AgentContext) {
  const scope = String(args.scope ?? 'single') === 'all_time' ? 'all_time' : 'single'
  let sb = supabase.from('attendees').select('ticket_type,payment_status,payment_amount,payment_method,event_id')
  let label = 'all events'
  if (scope === 'single') {
    const eid = resolveEventId(args.event_id, ctx)
    sb = sb.eq('event_id', eid)
    label = eventLabel(ctx, eid)
  }
  const { data, error } = await sb
  if (error) return { error: error.message }
  return {
    scope,
    event: label,
    price_list: TICKET_PRICES,
    ...aggregatePricing((data ?? []) as PricingInput[]),
  }
}

export const ANALYZE_PRICING_TOOL: ToolDef = { schema: ANALYZE_PRICING_SCHEMA, handler: analyzePricing }
