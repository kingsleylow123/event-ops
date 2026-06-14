// GET /api/finance/dashboard?event_id=<id|all>
// Computes the full Finance dashboard payload (DashboardData) from EventOps data:
//   Revenue  = paid tickets (attendees) + manual income (finance_entries)
//   Costs    = expenses + affiliate payouts + manual expenses
// All money figures are bucketed by Malaysia time (UTC+8) so days align with en-MY.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/auth/guard'
import {
  r2, groupByCategory,
  type DashboardData, type DailyPoint, type ForecastPoint, type AgingBuckets, type Row,
} from '@/lib/finance'

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
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function labelFor(key: string): string {
  const [, m, d] = key.split('-')
  return `${d} ${MONTHS[Number(m) - 1]}`
}

// Deposit already paid, parsed from an attendee note like "Deposit 500".
function parseDeposit(notes: string | null | undefined): number {
  if (!notes) return 0
  const m = notes.match(/dep(?:osit)?[^\d]*([\d,]+(?:\.\d+)?)/i)
  if (!m) return 0
  const n = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export async function GET(req: Request) {
  const g = await requireAdmin('GET /api/finance/dashboard')
  if (g.response) return g.response

  const event_id = new URL(req.url).searchParams.get('event_id') || 'all'
  const isAll = event_id === 'all'

  let attQ = supabaseAdmin.from('attendees').select('name, payment_amount, payment_status, paid_at, created_at, notes')
  let expQ = supabaseAdmin.from('expenses').select('amount, category, created_at')
  let payQ = supabaseAdmin.from('affiliate_payouts').select('amount, paid_at')
  let finQ = supabaseAdmin.from('finance_entries').select('type, category, amount, entry_date')
  let claimQ = supabaseAdmin.from('claims').select('amount, status, submitted_at')
  if (!isAll) {
    attQ = attQ.eq('event_id', event_id)
    expQ = expQ.eq('event_id', event_id)
    payQ = payQ.eq('event_id', event_id)
    finQ = finQ.eq('event_id', event_id)
    claimQ = claimQ.eq('event_id', event_id)
  }

  const [{ data: att }, { data: exp }, { data: pay }, { data: fin }, { data: claimsData }, { data: events }] = await Promise.all([
    attQ, expQ, payQ, finQ, claimQ,
    supabaseAdmin.from('events').select('id, name'),
  ])

  const attendees = att ?? []
  const expenses = exp ?? []
  const payouts = pay ?? []
  const finEntries = fin ?? []
  const claims = claimsData ?? []
  const scope_label = isAll ? 'All events' : (events ?? []).find(e => e.id === event_id)?.name ?? '—'

  // ── Totals & cash on hand ──────────────────────────────────────────────────
  const paid = attendees.filter(a => a.payment_status === 'paid')
  const pending = attendees.filter(a => a.payment_status === 'pending')
  const paidRevenue = paid.reduce((s, a) => s + Number(a.payment_amount ?? 0), 0)
  const manualIncome = finEntries.filter(f => f.type === 'income').reduce((s, f) => s + Number(f.amount ?? 0), 0)
  const expensesTotal = expenses.reduce((s, e) => s + Number(e.amount ?? 0), 0)
  const payoutsTotal = payouts.reduce((s, p) => s + Number(p.amount ?? 0), 0)
  const manualExpense = finEntries.filter(f => f.type === 'expense').reduce((s, f) => s + Number(f.amount ?? 0), 0)
  const cashOnHand = r2(paidRevenue + manualIncome - expensesTotal - payoutsTotal - manualExpense)

  // ── Outstanding invoices + aging (by age of created_at) ────────────────────
  const now = Date.now()
  const ageDays = (ts: string | null | undefined) => (ts ? (now - Date.parse(ts)) / 86400000 : 0)
  const invoiceAging: AgingBuckets = { upcoming: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91_plus: 0 }
  let outstanding = 0
  for (const p of pending) {
    // Real amount still owed = ticket price − deposit already paid.
    const amt = Math.max(0, r2(Number(p.payment_amount ?? 0) - parseDeposit(p.notes)))
    outstanding += amt
    const a = ageDays(p.created_at)
    if (a < 1) invoiceAging.upcoming += amt
    else if (a < 30) invoiceAging.d1_30 += amt
    else if (a < 60) invoiceAging.d31_60 += amt
    else if (a < 90) invoiceAging.d61_90 += amt
    else invoiceAging.d91_plus += amt
  }
  for (const k of Object.keys(invoiceAging) as (keyof AgingBuckets)[]) invoiceAging[k] = r2(invoiceAging[k])
  const invoicesDue = r2(invoiceAging.upcoming + invoiceAging.d1_30)
  const invoicesOverdue = r2(invoiceAging.d31_60 + invoiceAging.d61_90 + invoiceAging.d91_plus)
  // Outstanding bills = unpaid reimbursement claims, aged by submitted_at.
  const billAging: AgingBuckets = { upcoming: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91_plus: 0 }
  for (const c of claims) {
    if (c.status !== 'pending' && c.status !== 'approved') continue
    const amt = Number(c.amount ?? 0)
    const a = ageDays(c.submitted_at)
    if (a < 1) billAging.upcoming += amt
    else if (a < 30) billAging.d1_30 += amt
    else if (a < 60) billAging.d31_60 += amt
    else if (a < 90) billAging.d61_90 += amt
    else billAging.d91_plus += amt
  }
  for (const k of Object.keys(billAging) as (keyof AgingBuckets)[]) billAging[k] = r2(billAging[k])
  const billsDue = r2(billAging.upcoming + billAging.d1_30)
  const billsOverdue = r2(billAging.d31_60 + billAging.d61_90 + billAging.d91_plus)

  // ── Daily series, last 30 days (MYT) ───────────────────────────────────────
  const todayKey = new Date(now + MYT).toISOString().slice(0, 10)
  const axis: string[] = []
  for (let i = 29; i >= 0; i--) {
    axis.push(new Date(Date.parse(todayKey + 'T00:00:00Z') - i * 86400000).toISOString().slice(0, 10))
  }
  const incomeByDay = new Map<string, number>()
  const costsByDay = new Map<string, number>()
  const add = (m: Map<string, number>, k: string | null, v: number) => { if (k) m.set(k, (m.get(k) ?? 0) + v) }
  for (const a of paid) add(incomeByDay, dayKey(a.paid_at ?? a.created_at), Number(a.payment_amount ?? 0))
  for (const f of finEntries) if (f.type === 'income') add(incomeByDay, dayKey(f.entry_date), Number(f.amount ?? 0))
  for (const e of expenses) add(costsByDay, dayKey(e.created_at), Number(e.amount ?? 0))
  for (const p of payouts) add(costsByDay, dayKey(p.paid_at), Number(p.amount ?? 0))
  for (const f of finEntries) if (f.type === 'expense') add(costsByDay, dayKey(f.entry_date), Number(f.amount ?? 0))

  const netOverWindow = axis.reduce((s, k) => s + ((incomeByDay.get(k) ?? 0) - (costsByDay.get(k) ?? 0)), 0)
  let running = r2(cashOnHand - netOverWindow) // so the last day's cumulative == cashOnHand
  const daily: DailyPoint[] = axis.map(k => {
    const income = r2(incomeByDay.get(k) ?? 0)
    const costs = r2(costsByDay.get(k) ?? 0)
    const net = r2(income - costs)
    running = r2(running + net)
    return { label: labelFor(k), income, costs, net, cumulative: running }
  })

  // ── 14-day forecast: flat from cash on hand, with outstanding invoices
  //    expected to land as one inflow ~7 days out. Clearly a projection. ──────
  const forecast: ForecastPoint[] = []
  for (let i = 1; i <= 14; i++) {
    const k = new Date(Date.parse(todayKey + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10)
    const balance = r2(cashOnHand + (i >= 7 ? outstanding : 0))
    forecast.push({ label: labelFor(k), balance, projected: true })
  }

  // ── Recent sales (paid tickets) with synthesized invoice refs ──────────────
  const paidSorted = [...paid].sort((a, b) =>
    Date.parse(a.paid_at ?? a.created_at ?? '') - Date.parse(b.paid_at ?? b.created_at ?? ''))
  const refByIdx = new Map<number, string>()
  paidSorted.forEach((_, i) => refByIdx.set(i, `IV-${String(i + 1).padStart(5, '0')}`))
  const recent_sales = paidSorted
    .map((a, i) => ({ a, ref: refByIdx.get(i)! }))
    .slice(-6).reverse()
    .map(({ a, ref }) => {
      const k = dayKey(a.paid_at ?? a.created_at)
      return {
        ref,
        date: k ? `${k.slice(8, 10)}/${k.slice(5, 7)}/${k.slice(0, 4)}` : '—',
        label: a.name?.trim() || 'Ticket sale',
        amount: r2(Number(a.payment_amount ?? 0)),
      }
    })

  // ── Breakdowns over 7 / 14 / 30-day windows ────────────────────────────────
  const within = (key: string | null, days: number) => {
    if (!key) return false
    const idx = axis.indexOf(key)
    return idx >= 0 && idx >= axis.length - days
  }
  function incomeRows(days: number): Row[] {
    const rows: { category: string; amount: number }[] = []
    for (const a of paid) if (within(dayKey(a.paid_at ?? a.created_at), days)) rows.push({ category: 'Ticket sales', amount: Number(a.payment_amount ?? 0) })
    for (const f of finEntries) if (f.type === 'income' && within(dayKey(f.entry_date), days)) rows.push({ category: f.category, amount: Number(f.amount ?? 0) })
    return groupByCategory(rows)
  }
  function expenseRows(days: number): Row[] {
    const rows: { category: string; amount: number }[] = []
    for (const e of expenses) if (within(dayKey(e.created_at), days)) rows.push({ category: e.category, amount: Number(e.amount ?? 0) })
    for (const p of payouts) if (within(dayKey(p.paid_at), days)) rows.push({ category: 'Affiliate payouts', amount: Number(p.amount ?? 0) })
    for (const f of finEntries) if (f.type === 'expense' && within(dayKey(f.entry_date), days)) rows.push({ category: f.category, amount: Number(f.amount ?? 0) })
    return groupByCategory(rows)
  }

  const payload: DashboardData = {
    scope: event_id,
    scope_label,
    kpis: {
      cash_on_hand: cashOnHand,
      outstanding_invoices: r2(outstanding),
      invoices_due: invoicesDue,
      invoices_overdue: invoicesOverdue,
      bills_due: 0,
      bills_overdue: r2(billsDue + billsOverdue),
    },
    aging: { invoices: invoiceAging, bills: billAging },
    daily,
    forecast,
    recent_sales,
    breakdowns: {
      income: { d7: incomeRows(7), d14: incomeRows(14), d30: incomeRows(30) },
      expense: { d7: expenseRows(7), d14: expenseRows(14), d30: expenseRows(30) },
    },
  }

  return NextResponse.json(payload, { headers: NO_STORE })
}
