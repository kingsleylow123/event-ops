// GET /api/finance/reports/profit-and-loss?from=YYYY-MM-DD&to=YYYY-MM-DD&event_id=<id|all>
// Senior-finance shape: Income → Cost of Sales → Gross Profit → Operating Expenses → Net Profit.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/auth/guard'
import { r2 } from '@/lib/finance'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' } as const
const MYT = 8 * 3600 * 1000

export type PLLine = { code: string; name: string; amount: number }
export type PLSection = { lines: PLLine[]; total: number }
export type PLPayload = {
  scope_label: string
  from: string
  to: string
  income: PLSection
  cost_of_sales: PLSection
  gross_profit: number
  operating_expense: PLSection
  net: number
}

// Categories that count as direct event-delivery cost (Cost of Sales).
// Anything else falls under Operating Expenses.
const COST_OF_SALES = new Set(['Venue Rental', 'Catering', 'Materials', 'Production', 'Transport & Logistics'])

// Stable, human-readable account codes by category.
// 5xxx Revenue · 6xxx Cost of Sales · 7xxx Operating Expenses
const ACCOUNT_CODES: Record<string, string> = {
  'Ticket Sales': '5010',
  'Other Income': '5090',

  'Venue Rental': '6010',
  'Catering': '6020',
  'Materials': '6030',
  'Production': '6040',
  'Transport & Logistics': '6050',

  'Affiliate Commission': '7010',
  'Hospitality': '7020',
  'Marketing': '7030',
  'Admin': '7040',
  'Other Expense': '7090',
}

function codeFor(name: string, fallbackPrefix: number): string {
  if (ACCOUNT_CODES[name]) return ACCOUNT_CODES[name]
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return String(fallbackPrefix + (h % 89) + 1)
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

function groupLines(rows: { name: string; amount: number }[], fallbackPrefix: number): PLLine[] {
  const m = new Map<string, number>()
  for (const r of rows) {
    const key = (r.name || 'Other').trim() || 'Other'
    m.set(key, (m.get(key) ?? 0) + Number(r.amount || 0))
  }
  return [...m.entries()]
    .map(([name, amount]) => ({ code: codeFor(name, fallbackPrefix), name, amount: r2(amount) }))
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

  let attQ = supabaseAdmin.from('attendees').select('id, event_id, payment_amount, payment_status, paid_at, created_at')
  let expQ = supabaseAdmin.from('expenses').select('amount, category, created_at')
  let attribQ = supabaseAdmin.from('affiliate_attributions').select('event_id, attendee_id, affiliate_id')
  let finQ = supabaseAdmin.from('finance_entries').select('type, category, amount, entry_date')
  if (!isAll) {
    attQ = attQ.eq('event_id', event_id)
    expQ = expQ.eq('event_id', event_id)
    attribQ = attribQ.eq('event_id', event_id)
    finQ = finQ.eq('event_id', event_id)
  }

  const [{ data: att }, { data: exp }, { data: attribs }, { data: affs }, { data: fin }, { data: events }] = await Promise.all([
    attQ, expQ, attribQ,
    supabaseAdmin.from('affiliates').select('id, commission_rate'),
    finQ,
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

  const cosRows: { name: string; amount: number }[] = []
  const opexRows: { name: string; amount: number }[] = []
  const pushExpense = (name: string, amount: number) => {
    if (amount <= 0) return
    ;(COST_OF_SALES.has(name) ? cosRows : opexRows).push({ name, amount })
  }

  for (const e of exp ?? []) {
    if (!inRange(dayKey(e.created_at), from, to)) continue
    pushExpense(e.category || 'Other Expense', Number(e.amount ?? 0))
  }
  const rateByAffiliate = new Map<string, number>((affs ?? []).map(a => [a.id as string, Number(a.commission_rate ?? 0)]))
  const attendeeById = new Map<string, { payment_status: string | null; payment_amount: number | null; paid_at: string | null; created_at: string | null }>(
    (att ?? []).map(a => [a.id as string, a as any])
  )
  for (const ab of attribs ?? []) {
    const a = attendeeById.get(ab.attendee_id as string)
    if (!a || a.payment_status !== 'paid') continue
    const key = dayKey(a.paid_at ?? a.created_at)
    if (!inRange(key, from, to)) continue
    const rate = rateByAffiliate.get(ab.affiliate_id as string) ?? 0
    pushExpense('Affiliate Commission', Number(a.payment_amount ?? 0) * rate)
  }
  for (const f of fin ?? []) {
    if (f.type !== 'expense') continue
    if (!inRange(dayKey(f.entry_date), from, to)) continue
    pushExpense(f.category || 'Other Expense', Number(f.amount ?? 0))
  }

  const incomeLines = groupLines(incomeRows, 5000)
  const cosLines    = groupLines(cosRows, 6000)
  const opexLines   = groupLines(opexRows, 7000)
  const incomeTotal = r2(incomeLines.reduce((s, l) => s + l.amount, 0))
  const cosTotal    = r2(cosLines.reduce((s, l) => s + l.amount, 0))
  const opexTotal   = r2(opexLines.reduce((s, l) => s + l.amount, 0))
  const grossProfit = r2(incomeTotal - cosTotal)
  const net         = r2(grossProfit - opexTotal)

  const payload: PLPayload = {
    scope_label,
    from,
    to,
    income:           { lines: incomeLines, total: incomeTotal },
    cost_of_sales:    { lines: cosLines,    total: cosTotal },
    gross_profit:     grossProfit,
    operating_expense:{ lines: opexLines,   total: opexTotal },
    net,
  }
  return NextResponse.json(payload, { headers: NO_STORE })
}
