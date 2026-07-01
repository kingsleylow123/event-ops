// GET /api/cashflow?event_id=<id|all>&period=<all|month|30|90>
// Cash-basis money-flow for the Cashflow Sankey. Mirrors the revenue/cost
// definitions in /api/finance/dashboard so Net Profit (period=all) reconciles
// with that dashboard's cash_on_hand:
//   Revenue = paid tickets (grouped by tier) + manual income (finance_entries)
//   Costs   = expenses (already include mirrored paid claims & facilitator
//             payouts) + affiliate payouts + manual expenses
// All dates are bucketed in Malaysia time (UTC+8) so windows align with en-MY.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/auth/guard'
import { groupByCategory, type Row } from '@/lib/finance'
import { buildSankey, type CashflowData, type CashflowPeriod } from '@/lib/cashflow'
import { TICKET_LABELS, type TicketType } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' } as const

const MYT = 8 * 3600 * 1000
// Calendar day key (YYYY-MM-DD) in Malaysia time for any timestamp/date string.
function dayKey(ts: string | null | undefined): string | null {
  if (!ts) return null
  const t = Date.parse(ts)
  if (Number.isNaN(t)) return null
  return new Date(t + MYT).toISOString().slice(0, 10)
}

const PERIODS: CashflowPeriod[] = ['all', 'month', '30', '90']

// Predicate: is this MYT day-key within the selected period?
// 'all' admits everything (incl. rows with no date — matches the dashboard's
// all-time totals); time-boxed periods reject null keys.
function makeInPeriod(period: CashflowPeriod): (key: string | null) => boolean {
  if (period === 'all') return () => true
  const nowKey = new Date(Date.now() + MYT).toISOString().slice(0, 10)
  if (period === 'month') {
    const ym = nowKey.slice(0, 7) // YYYY-MM
    return key => !!key && key.slice(0, 7) === ym
  }
  const days = period === '30' ? 30 : 90
  const startKey = new Date(Date.parse(nowKey + 'T00:00:00Z') - (days - 1) * 86400000).toISOString().slice(0, 10)
  return key => !!key && key >= startKey && key <= nowKey
}

export async function GET(req: Request) {
  const g = await requireAdmin('GET /api/cashflow')
  if (g.response) return g.response

  const url = new URL(req.url)
  const event_id = url.searchParams.get('event_id') || 'all'
  const periodParam = (url.searchParams.get('period') || 'all') as CashflowPeriod
  const period: CashflowPeriod = PERIODS.includes(periodParam) ? periodParam : 'all'
  const isAll = event_id === 'all'
  const inPeriod = makeInPeriod(period)

  let attQ = supabaseAdmin.from('attendees').select('event_id, ticket_type, payment_amount, payment_status, paid_at, created_at')
  let expQ = supabaseAdmin.from('expenses').select('amount, category, created_at')
  let payQ = supabaseAdmin.from('affiliate_payouts').select('amount, paid_at')
  let finQ = supabaseAdmin.from('finance_entries').select('type, category, amount, entry_date')
  if (!isAll) {
    attQ = attQ.eq('event_id', event_id)
    expQ = expQ.eq('event_id', event_id)
    payQ = payQ.eq('event_id', event_id)
    finQ = finQ.eq('event_id', event_id)
  }

  const [{ data: att }, { data: exp }, { data: pay }, { data: fin }, { data: events }] = await Promise.all([
    attQ, expQ, payQ, finQ,
    supabaseAdmin.from('events').select('id, name'),
  ])

  const attendees = att ?? []
  const expenses = exp ?? []
  const payouts = pay ?? []
  const finEntries = fin ?? []
  const scope_label = isAll ? 'All events' : (events ?? []).find(e => e.id === event_id)?.name ?? '—'

  // ── Income (cash in): paid tickets by tier + manual income by category ──────
  const incomeRaw: { category: string; amount: number }[] = []
  for (const a of attendees) {
    if (a.payment_status !== 'paid') continue
    const amt = Number(a.payment_amount ?? 0)
    if (amt <= 0) continue
    if (!inPeriod(dayKey(a.paid_at ?? a.created_at))) continue
    incomeRaw.push({ category: TICKET_LABELS[a.ticket_type as TicketType] ?? 'Ticket sales', amount: amt })
  }
  for (const f of finEntries) {
    if (f.type !== 'income' || !inPeriod(dayKey(f.entry_date))) continue
    incomeRaw.push({ category: f.category || 'Other income', amount: Number(f.amount ?? 0) })
  }

  // ── Expense (cash out): expenses + affiliate payouts + manual expenses ──────
  const expenseRaw: { category: string; amount: number }[] = []
  for (const e of expenses) {
    if (!inPeriod(dayKey(e.created_at))) continue
    expenseRaw.push({ category: e.category || 'Other', amount: Number(e.amount ?? 0) })
  }
  for (const p of payouts) {
    // 'all' counts every payout row (matches dashboard cash_on_hand); time-boxed
    // periods bucket by paid_at, so unpaid payouts (null paid_at) drop out.
    if (!inPeriod(dayKey(p.paid_at))) continue
    expenseRaw.push({ category: 'Affiliate payouts', amount: Number(p.amount ?? 0) })
  }
  for (const f of finEntries) {
    if (f.type !== 'expense' || !inPeriod(dayKey(f.entry_date))) continue
    expenseRaw.push({ category: f.category || 'Other', amount: Number(f.amount ?? 0) })
  }

  const incomeRows: Row[] = groupByCategory(incomeRaw)
  const expenseRows: Row[] = groupByCategory(expenseRaw)
  const { nodes, links, totals } = buildSankey(incomeRows, expenseRows)

  const payload: CashflowData = { scope: event_id, scope_label, period, nodes, links, totals }
  return NextResponse.json(payload, { headers: NO_STORE })
}
