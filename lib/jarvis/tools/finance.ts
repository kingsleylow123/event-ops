import type Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import type { ToolDef, AgentContext } from '../types'
import { resolveEventId, eventLabel, num, round2 } from '../util'
import { aggregatePricing, type PricingInput } from './pricing'

const GET_FINANCE_SUMMARY_SCHEMA: Anthropic.Tool = {
  name: 'get_finance_summary',
  description:
    'Full P&L for an event (or "all" events): ticket revenue (with Stripe-vs-bank split), pending revenue, manual income, expenses by category, affiliate payouts, total costs, net profit and margin. Use for revenue / expenses / profit / "how much did we make / net" questions.',
  input_schema: {
    type: 'object',
    properties: { event_id: { type: 'string', description: 'Event id, or "all" for every event combined. Defaults to active.' } },
  },
}

async function financeSummary(args: Record<string, unknown>, ctx: AgentContext) {
  const arg = String(args.event_id ?? '')
  const all = arg.toLowerCase() === 'all'
  const eid = all ? '' : resolveEventId(args.event_id, ctx)

  // Facilitators (is_facilitator) excluded so paid_count / revenue match the Attendees page.
  const attQ = supabase.from('attendees').select('ticket_type,payment_status,payment_amount,payment_method,event_id')
    .not('is_facilitator', 'is', true)
  const expQ = supabase.from('expenses').select('amount,category,event_id')
  const finQ = supabase.from('finance_entries').select('type,amount,category,event_id')
  const payQ = supabase.from('affiliate_payouts').select('amount,event_id')

  const [att, exp, fin, pay] = await Promise.all([
    all ? attQ : attQ.eq('event_id', eid),
    all ? expQ : expQ.eq('event_id', eid),
    all ? finQ : finQ.eq('event_id', eid),
    all ? payQ : payQ.eq('event_id', eid),
  ])
  for (const r of [att, exp, fin, pay]) if (r.error) return { error: r.error.message }

  const agg = aggregatePricing((att.data ?? []) as PricingInput[])
  const pendingRevenue = round2(
    (att.data ?? []).filter(a => a.payment_status === 'pending').reduce((s, a) => s + num(a.payment_amount), 0),
  )

  const byCat: Record<string, number> = {}
  let totalExpenses = 0
  for (const e of exp.data ?? []) {
    const c = String(e.category ?? 'Other')
    byCat[c] = (byCat[c] ?? 0) + num(e.amount)
    totalExpenses += num(e.amount)
  }

  let manualIncome = 0
  let manualExpense = 0
  for (const f of fin.data ?? []) {
    if (f.type === 'income') manualIncome += num(f.amount)
    else manualExpense += num(f.amount)
  }

  const affPayouts = (pay.data ?? []).reduce((s, p) => s + num(p.amount), 0)
  const totalRevenue = round2(agg.total_revenue + manualIncome)
  const totalCosts = round2(totalExpenses + manualExpense + affPayouts)
  const net = round2(totalRevenue - totalCosts)

  return {
    event: all ? 'all events' : eventLabel(ctx, eid),
    ticket_revenue: agg.total_revenue,
    stripe_revenue: agg.stripe_revenue,
    bank_revenue: agg.bank_revenue,
    pending_revenue: pendingRevenue,
    manual_income: round2(manualIncome),
    expenses_by_category: Object.entries(byCat).map(([category, amount]) => ({ category, amount: round2(amount) })),
    total_expenses: round2(totalExpenses),
    manual_expense: round2(manualExpense),
    affiliate_payouts: round2(affPayouts),
    total_revenue: totalRevenue,
    total_costs: totalCosts,
    net_profit: net,
    margin_pct: totalRevenue ? Math.round((net / totalRevenue) * 100) : 0,
    paid_count: agg.paid_count,
    note: 'Revenue is gross — refunds are not tracked.',
  }
}

export const GET_FINANCE_SUMMARY_TOOL: ToolDef = { schema: GET_FINANCE_SUMMARY_SCHEMA, handler: financeSummary }
