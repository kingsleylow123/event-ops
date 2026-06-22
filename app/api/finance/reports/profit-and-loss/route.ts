// GET /api/finance/reports/profit-and-loss?from=YYYY-MM-DD&to=YYYY-MM-DD&event_id=<id|all>
// Returns the income + expense line items for a Bukku-style P&L over the date range.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/auth/guard'
import { r2 } from '@/lib/finance'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' } as const
const MYT = 8 * 3600 * 1000

export type PLLine = { code: string; name: string; amount: number }
export type PLPayload = {
  scope_label: string
  from: string // YYYY-MM-DD
  to: string
  income: { lines: PLLine[]; total: number }
  expense: { lines: PLLine[]; total: number }
  net: number
}

function dayKey(ts: string | null | undefined): string | null {
  if (!ts) return null
  const t = Date.parse(ts)
  if (Number.isNaN(t)) return null
  return new Date(t + MYT).toISOString().slice(0, 10)
}

function inRange(key: string | null, from: string, to: string): boolean {
  return !!key && key >= from && key <= to
}

// Stable account code assigned by category name → keeps codes consistent run to run.
function codeFor(prefix: number, name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return String(prefix + (h % 90))
}

function groupLines(prefix: number, rows: { name: string; amount: number }[]): PLLine[] {
  const m = new Map<string, number>()
  for (const r of rows) {
    const key = (r.name || 'Other').trim() || 'Other'
    m.set(key, (m.get(key) ?? 0) + Number(r.amount || 0))
  }
  return [...m.entries()]
    .map(([name, amount]) => ({ code: codeFor(prefix, name), name, amount: r2(amount) }))
    .sort((a, b) => b.amount - a.amount)
}

export async function GET(req: Request) {
  const g = await requireAdmin('GET /api/finance/reports/profit-and-loss')
  if (g.response) return g.response

  const url = new URL(req.url)
  const event_id = url.searchParams.get('event_id') || 'all'
  const isAll = event_id === 'all'
  const lifetime = url.searchParams.get('lifetime') === '1' && !isAll
  const today = new Date(Date.now() + MYT).toISOString().slice(0, 10)
  const from = lifetime ? '1900-01-01' : (url.searchParams.get('from') || today.slice(0, 8) + '01')
  const to = lifetime ? '2999-12-31' : (url.searchParams.get('to') || today)

  let attQ = supabaseAdmin.from('attendees').select('event_id, payment_amount, payment_status, paid_at, created_at')
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

  const scope_label = isAll ? 'All events' : (events ?? []).find(e => e.id === event_id)?.name ?? '—'

  const incomeRows: { name: string; amount: number }[] = []
  for (const a of att ?? []) {
    if (a.payment_status !== 'paid') continue
    const key = dayKey(a.paid_at ?? a.created_at)
    if (inRange(key, from, to)) incomeRows.push({ name: 'Ticket Sales', amount: Number(a.payment_amount ?? 0) })
  }
  for (const f of fin ?? []) {
    if (f.type !== 'income') continue
    if (inRange(dayKey(f.entry_date), from, to)) incomeRows.push({ name: f.category || 'Other Income', amount: Number(f.amount ?? 0) })
  }

  const expenseRows: { name: string; amount: number }[] = []
  for (const e of exp ?? []) {
    if (inRange(dayKey(e.created_at), from, to)) expenseRows.push({ name: e.category || 'Other Expense', amount: Number(e.amount ?? 0) })
  }
  for (const p of pay ?? []) {
    if (inRange(dayKey(p.paid_at), from, to)) expenseRows.push({ name: 'Affiliate Payouts', amount: Number(p.amount ?? 0) })
  }
  for (const f of fin ?? []) {
    if (f.type !== 'expense') continue
    if (inRange(dayKey(f.entry_date), from, to)) expenseRows.push({ name: f.category || 'Other Expense', amount: Number(f.amount ?? 0) })
  }

  const incomeLines = groupLines(5000, incomeRows)
  const expenseLines = groupLines(6500, expenseRows)
  const incomeTotal = r2(incomeLines.reduce((s, l) => s + l.amount, 0))
  const expenseTotal = r2(expenseLines.reduce((s, l) => s + l.amount, 0))

  const payload: PLPayload = {
    scope_label,
    from,
    to,
    income: { lines: incomeLines, total: incomeTotal },
    expense: { lines: expenseLines, total: expenseTotal },
    net: r2(incomeTotal - expenseTotal),
  }
  return NextResponse.json(payload, { headers: NO_STORE })
}
