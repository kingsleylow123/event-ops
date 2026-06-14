// /api/deposits — deposit / balance tracker per event.
//   balance = total_amount - deposit_paid ; overdue = partial AND due_date < today
//
// GET    ?event_id=<id|all>   → list (newest first) with event name, balance, overdue
// POST   { event_id, name, total_amount, deposit_paid, due_date, ... } → create
// PATCH  { id, deposit_paid?, due_date?, status?, ... } → update; auto-marks 'paid'
//        once deposit_paid ≥ total_amount
// DELETE ?id=<id>

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/auth/guard'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' } as const

const STATUSES = ['partial', 'paid', 'refunded'] as const
type Status = (typeof STATUSES)[number]
const r2 = (n: number) => Math.round(n * 100) / 100
const todayKey = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10) // MYT

export async function GET(req: Request) {
  const g = await requireAdmin('GET /api/deposits')
  if (g.response) return g.response

  const event_id = new URL(req.url).searchParams.get('event_id') || 'all'
  let q = supabaseAdmin
    .from('deposits')
    .select('id, event_id, name, phone, total_amount, deposit_paid, due_date, status, notes, paid_at, created_at')
    .order('created_at', { ascending: false })
  if (event_id !== 'all') q = q.eq('event_id', event_id)

  const [{ data: deposits, error }, { data: events }] = await Promise.all([
    q,
    supabaseAdmin.from('events').select('id, name'),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })

  const today = todayKey()
  const eventName = new Map((events ?? []).map(e => [e.id as string, e.name as string]))
  const rows = (deposits ?? []).map(d => {
    const total = r2(Number(d.total_amount ?? 0))
    const paid = r2(Number(d.deposit_paid ?? 0))
    const balance = r2(total - paid)
    const overdue = d.status === 'partial' && !!d.due_date && String(d.due_date) < today
    return { ...d, total_amount: total, deposit_paid: paid, balance, overdue, event_name: eventName.get(d.event_id as string) ?? '—' }
  })
  return NextResponse.json(rows, { headers: NO_STORE })
}

export async function POST(req: Request) {
  const g = await requireAdmin('POST /api/deposits')
  if (g.response) return g.response

  const body = await req.json().catch(() => ({}))
  const { event_id, name, phone, total_amount, deposit_paid, due_date, notes } = body as Record<string, unknown>

  if (!event_id || typeof event_id !== 'string') {
    return NextResponse.json({ error: 'An event is required.' }, { status: 400, headers: NO_STORE })
  }
  if (!name || !String(name).trim()) {
    return NextResponse.json({ error: 'A name is required.' }, { status: 400, headers: NO_STORE })
  }
  const total = Number(total_amount)
  const paid = deposit_paid === undefined || deposit_paid === '' ? 0 : Number(deposit_paid)
  if (!Number.isFinite(total) || total <= 0) {
    return NextResponse.json({ error: 'Total amount must be greater than 0.' }, { status: 400, headers: NO_STORE })
  }
  if (!Number.isFinite(paid) || paid < 0) {
    return NextResponse.json({ error: 'Deposit must be a number ≥ 0.' }, { status: 400, headers: NO_STORE })
  }

  const fullyPaid = paid >= total
  const insert = {
    event_id,
    name: String(name).trim(),
    phone: phone ? String(phone).trim() : null,
    total_amount: r2(total),
    deposit_paid: r2(paid),
    due_date: due_date ? String(due_date) : null,
    status: (fullyPaid ? 'paid' : 'partial') as Status,
    paid_at: fullyPaid ? new Date().toISOString() : null,
    notes: notes ? String(notes).trim() : null,
  }
  const { data, error } = await supabaseAdmin.from('deposits').insert(insert).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })
  return NextResponse.json({ ok: true, deposit: data }, { headers: NO_STORE })
}

export async function PATCH(req: Request) {
  const g = await requireAdmin('PATCH /api/deposits')
  if (g.response) return g.response

  const body = await req.json().catch(() => ({}))
  const { id, status, ...rest } = body as { id?: string; status?: string } & Record<string, unknown>
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400, headers: NO_STORE })
  if (status !== undefined && !STATUSES.includes(status as Status)) {
    return NextResponse.json({ error: `status must be one of ${STATUSES.join(', ')}` }, { status: 400, headers: NO_STORE })
  }

  const { data: current, error: loadErr } = await supabaseAdmin
    .from('deposits').select('event_id, name, total_amount, deposit_paid, status, paid_at, refund_entry_id').eq('id', id).single()
  if (loadErr || !current) {
    return NextResponse.json({ error: loadErr?.message ?? 'Deposit not found.' }, { status: 404, headers: NO_STORE })
  }

  const updates: Record<string, unknown> = {}
  for (const k of ['name', 'phone', 'notes'] as const) {
    if (rest[k] !== undefined) updates[k] = rest[k] === null ? null : String(rest[k]).trim()
  }
  if (rest.due_date !== undefined) updates.due_date = rest.due_date ? String(rest.due_date) : null
  for (const k of ['total_amount', 'deposit_paid'] as const) {
    if (rest[k] !== undefined) {
      const n = Number(rest[k])
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: `${k.replace('_', ' ')} must be a number ≥ 0.` }, { status: 400, headers: NO_STORE })
      }
      updates[k] = r2(n)
    }
  }

  // Resolve status: explicit wins; otherwise derive from paid-vs-total so it
  // flips to 'paid' the moment the balance clears. A refund is a returned
  // customer deposit (a liability), not a P&L expense — it just drops the person
  // from receivables (handled by the Finance dashboard). So no expense is logged.
  // A 'refunded' deposit is never auto-changed by an amount edit.
  const total = (updates.total_amount as number) ?? Number(current.total_amount ?? 0)
  const paid = (updates.deposit_paid as number) ?? Number(current.deposit_paid ?? 0)
  const wasRefunded = current.status === 'refunded'

  if (status !== undefined) {
    updates.status = status
    updates.paid_at = status === 'paid' ? (current.paid_at ?? new Date().toISOString()) : null
  } else if ((rest.total_amount !== undefined || rest.deposit_paid !== undefined) && !wasRefunded) {
    const fullyPaid = total > 0 && paid >= total
    updates.status = fullyPaid ? 'paid' : 'partial'
    updates.paid_at = fullyPaid ? (current.paid_at ?? new Date().toISOString()) : null
  }

  const { data, error } = await supabaseAdmin.from('deposits').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })
  return NextResponse.json({ ok: true, deposit: data }, { headers: NO_STORE })
}

export async function DELETE(req: Request) {
  const g = await requireAdmin('DELETE /api/deposits')
  if (g.response) return g.response
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400, headers: NO_STORE })
  const { error } = await supabaseAdmin.from('deposits').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
