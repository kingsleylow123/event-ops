// GET /api/valuation?event_id=<id|all>
// Auto valuation metrics from EventOps data (ValuationAuto). Money definitions
// mirror /api/finance/dashboard so figures reconcile:
//   Revenue = paid tickets + manual income
//   Costs   = expenses + affiliate payouts + manual expenses
// Monthly series is by EVENT date (completed months only), bucketed in MYT.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/auth/guard'
import { r2 } from '@/lib/finance'
import type { ValuationAuto, MonthPoint } from '@/lib/valuation'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' } as const
const MYT = 8 * 3600 * 1000

function monthKey(ts: string | null | undefined): string | null {
  if (!ts) return null
  const t = Date.parse(ts)
  if (Number.isNaN(t)) return null
  return new Date(t + MYT).toISOString().slice(0, 7) // YYYY-MM
}

export async function GET(req: Request) {
  const g = await requireAdmin('GET /api/valuation')
  if (g.response) return g.response

  const event_id = new URL(req.url).searchParams.get('event_id') || 'all'
  const isAll = event_id === 'all'

  let attQ = supabaseAdmin.from('attendees').select('event_id, payment_amount, payment_status')
  let expQ = supabaseAdmin.from('expenses').select('amount')
  let payQ = supabaseAdmin.from('affiliate_payouts').select('amount')
  let finQ = supabaseAdmin.from('finance_entries').select('type, amount')
  let meetQ = supabaseAdmin.from('meetings').select('*', { count: 'exact', head: true })
  if (!isAll) {
    attQ = attQ.eq('event_id', event_id)
    expQ = expQ.eq('event_id', event_id)
    payQ = payQ.eq('event_id', event_id)
    finQ = finQ.eq('event_id', event_id)
    meetQ = meetQ.eq('event_id', event_id)
  }

  const [
    { data: att }, { data: exp }, { data: pay }, { data: fin }, { data: events },
    { count: leadsCount }, { count: meetingsCount },
  ] = await Promise.all([
    attQ, expQ, payQ, finQ,
    supabaseAdmin.from('events').select('id, name, date'),
    supabaseAdmin.from('leads').select('*', { count: 'exact', head: true }),
    meetQ,
  ])

  const attendees = att ?? []
  const expenses = exp ?? []
  const payouts = pay ?? []
  const finEntries = fin ?? []
  const eventsList = events ?? []
  const scope_label = isAll ? 'All events' : eventsList.find(e => e.id === event_id)?.name ?? '—'

  const paid = attendees.filter(a => a.payment_status === 'paid')
  const ticketRevenue = r2(paid.reduce((s, a) => s + Number(a.payment_amount ?? 0), 0))
  const manualIncome = r2(finEntries.filter(f => f.type === 'income').reduce((s, f) => s + Number(f.amount ?? 0), 0))
  const totalRevenue = r2(ticketRevenue + manualIncome)

  const expensesTotal = expenses.reduce((s, e) => s + Number(e.amount ?? 0), 0)
  const payoutsTotal = payouts.reduce((s, p) => s + Number(p.amount ?? 0), 0)
  const manualExpense = finEntries.filter(f => f.type === 'expense').reduce((s, f) => s + Number(f.amount ?? 0), 0)
  const costsTotal = r2(expensesTotal + payoutsTotal + manualExpense)
  const netProfit = r2(totalRevenue - costsTotal)
  const contributionMargin = totalRevenue > 0 ? r2(netProfit / totalRevenue) : 0

  const paidAttendees = paid.length
  const totalAttendees = attendees.length
  const arpa = paidAttendees > 0 ? r2(ticketRevenue / paidAttendees) : 0

  // ── Monthly revenue by EVENT date, completed months only (≤ current MYT month)
  const eventMonth = new Map<string, string | null>()
  const eventsWithSalesSet = new Set<string>()
  for (const e of eventsList) eventMonth.set(e.id, monthKey(e.date as string | null))
  const currentYm = new Date(Date.now() + MYT).toISOString().slice(0, 7)
  const byMonth = new Map<string, { revenue: number; paid: number }>()
  for (const a of paid) {
    const amt = Number(a.payment_amount ?? 0)
    if (amt <= 0) continue
    const ym = eventMonth.get(a.event_id as string) ?? null
    if (!ym || ym > currentYm) continue // skip undated + future events
    eventsWithSalesSet.add(a.event_id as string)
    const cur = byMonth.get(ym) ?? { revenue: 0, paid: 0 }
    cur.revenue += amt
    cur.paid += 1
    byMonth.set(ym, cur)
  }
  const monthly: MonthPoint[] = [...byMonth.entries()]
    .map(([ym, v]) => ({ ym, revenue: r2(v.revenue), paid: v.paid }))
    .sort((a, b) => (a.ym < b.ym ? -1 : 1))

  const payload: ValuationAuto = {
    scope: event_id,
    scope_label,
    totalRevenue,
    costsTotal,
    netProfit,
    contributionMargin,
    monthly,
    paidAttendees,
    totalAttendees,
    eventsWithSales: eventsWithSalesSet.size,
    leads: leadsCount ?? 0,
    meetings: meetingsCount ?? 0,
    arpa,
  }
  return NextResponse.json(payload, { headers: NO_STORE })
}
