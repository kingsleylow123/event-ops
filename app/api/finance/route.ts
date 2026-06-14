// /api/finance — Profit & Loss for one event or all events.
//
// Revenue  = paid ticket sales (attendees) + manual income (finance_entries)
// Costs    = event expenses + affiliate payouts + manual expenses (finance_entries)
// Net      = Revenue − Costs
//
// GET    ?event_id=<id|all>     → computed P&L + the manual entries list
// POST   { event_id?, type, category, description, amount, entry_date? } → add entry
// DELETE ?id=<id>               → remove a manual entry

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/auth/guard'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' } as const

const r2 = (n: number) => Math.round(n * 100) / 100

type Row = { category: string; amount: number }
// Sum amounts into a category→total map, then return as sorted line items.
function groupByCategory(rows: { category?: string | null; amount?: number | null }[]): Row[] {
  const m = new Map<string, number>()
  for (const r of rows) {
    const cat = (r.category || 'Other').trim() || 'Other'
    m.set(cat, (m.get(cat) ?? 0) + Number(r.amount ?? 0))
  }
  return [...m.entries()]
    .map(([category, amount]) => ({ category, amount: r2(amount) }))
    .sort((a, b) => b.amount - a.amount)
}

export async function GET(req: Request) {
  const g = await requireAdmin('GET /api/finance')
  if (g.response) return g.response

  const event_id = new URL(req.url).searchParams.get('event_id') || 'all'
  const isAll = event_id === 'all'

  let attQ = supabaseAdmin.from('attendees').select('payment_amount, payment_status')
  let expQ = supabaseAdmin.from('expenses').select('amount, category')
  let payQ = supabaseAdmin.from('affiliate_payouts').select('amount')
  let finQ = supabaseAdmin
    .from('finance_entries')
    .select('id, event_id, type, category, description, amount, entry_date')
    .order('entry_date', { ascending: false })

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

  const eventName = new Map((events ?? []).map(e => [e.id as string, e.name as string]))

  // Revenue
  const paid = (att ?? []).filter(a => a.payment_status === 'paid')
  const pendingRows = (att ?? []).filter(a => a.payment_status === 'pending')
  const ticketRevenue = r2(paid.reduce((s, a) => s + Number(a.payment_amount ?? 0), 0))
  const pendingRevenue = r2(pendingRows.reduce((s, a) => s + Number(a.payment_amount ?? 0), 0))

  const manualIncome = (fin ?? []).filter(f => f.type === 'income')
  const manualExpense = (fin ?? []).filter(f => f.type === 'expense')
  const manualIncomeTotal = r2(manualIncome.reduce((s, f) => s + Number(f.amount ?? 0), 0))

  // Costs
  const eventExpensesTotal = r2((exp ?? []).reduce((s, e) => s + Number(e.amount ?? 0), 0))
  const payoutsTotal = r2((pay ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0))
  const manualExpenseTotal = r2(manualExpense.reduce((s, f) => s + Number(f.amount ?? 0), 0))

  const revenueTotal = r2(ticketRevenue + manualIncomeTotal)
  const costsTotal = r2(eventExpensesTotal + payoutsTotal + manualExpenseTotal)
  const netProfit = r2(revenueTotal - costsTotal)
  const margin = revenueTotal > 0 ? r2((netProfit / revenueTotal) * 100) : 0

  // Breakdown line items
  const incomeBreakdown: Row[] = [
    ...(ticketRevenue > 0 ? [{ category: 'Ticket sales', amount: ticketRevenue }] : []),
    ...groupByCategory(manualIncome),
  ]
  const costBreakdown: Row[] = [
    ...groupByCategory(exp ?? []),
    ...(payoutsTotal > 0 ? [{ category: 'Affiliate payouts', amount: payoutsTotal }] : []),
    ...groupByCategory(manualExpense),
  ]

  return NextResponse.json({
    scope: event_id,
    revenue: {
      tickets: ticketRevenue,
      pending: pendingRevenue,
      manual: manualIncomeTotal,
      total: revenueTotal,
    },
    costs: {
      expenses: eventExpensesTotal,
      payouts: payoutsTotal,
      manual: manualExpenseTotal,
      total: costsTotal,
    },
    net_profit: netProfit,
    margin,
    income_breakdown: incomeBreakdown,
    cost_breakdown: costBreakdown,
    entries: (fin ?? []).map(f => ({
      id: f.id,
      event_id: f.event_id,
      event_name: f.event_id ? (eventName.get(f.event_id as string) ?? '—') : 'General',
      type: f.type,
      category: f.category,
      description: f.description,
      amount: r2(Number(f.amount ?? 0)),
      entry_date: f.entry_date,
    })),
  }, { headers: NO_STORE })
}

export async function POST(req: Request) {
  const g = await requireAdmin('POST /api/finance')
  if (g.response) return g.response

  const body = await req.json().catch(() => ({}))
  const { event_id, type, category, description, amount, entry_date } = body as {
    event_id?: string | null
    type?: string
    category?: string
    description?: string
    amount?: number | string
    entry_date?: string
  }

  if (type !== 'income' && type !== 'expense') {
    return NextResponse.json({ error: "type must be 'income' or 'expense'." }, { status: 400, headers: NO_STORE })
  }
  if (!description || !description.trim()) {
    return NextResponse.json({ error: 'A description is required.' }, { status: 400, headers: NO_STORE })
  }
  const amt = Number(amount)
  if (!Number.isFinite(amt) || amt < 0) {
    return NextResponse.json({ error: 'Amount must be a number ≥ 0.' }, { status: 400, headers: NO_STORE })
  }

  const insert: Record<string, unknown> = {
    event_id: event_id || null,
    type,
    category: (category || 'Other').trim() || 'Other',
    description: description.trim(),
    amount: r2(amt),
  }
  if (entry_date) insert.entry_date = entry_date

  const { data, error } = await supabaseAdmin.from('finance_entries').insert(insert).select().single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })
  }
  return NextResponse.json({ ok: true, entry: data }, { headers: NO_STORE })
}

export async function DELETE(req: Request) {
  const g = await requireAdmin('DELETE /api/finance')
  if (g.response) return g.response

  const id = new URL(req.url).searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400, headers: NO_STORE })
  }
  const { error } = await supabaseAdmin.from('finance_entries').delete().eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
