// /api/claims — reimbursement claims for event spending.
// Claims auto-populate from the event's expenses (see /api/claims/import) and
// are marked paid once reimbursed. They do NOT create expenses (they come from
// them). Manual ad-hoc claims can still be added.
//
// GET    ?event_id=<id|all>   → list (newest first) with event name
// POST   { event_id, description, amount, paid_by?, ... } → add a manual claim
// PATCH  { id, status?, ...fields } → update; status→'paid' stamps reimbursed
// DELETE ?id=<id>             → remove the claim (never touches the expense)

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/auth/guard'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' } as const
const STATUSES = ['pending', 'approved', 'paid', 'rejected'] as const
type Status = (typeof STATUSES)[number]
const r2 = (n: number) => Math.round(n * 100) / 100

export async function GET(req: Request) {
  const g = await requireAdmin('GET /api/claims')
  if (g.response) return g.response

  const event_id = new URL(req.url).searchParams.get('event_id') || 'all'
  let q = supabaseAdmin
    .from('claims')
    .select('id, event_id, claimant_name, claimant_phone, description, category, amount, status, expense_id, submitted_at, paid_at, notes')
    .order('submitted_at', { ascending: false })
  if (event_id !== 'all') q = q.eq('event_id', event_id)

  const [{ data: claims, error }, { data: events }] = await Promise.all([
    q,
    supabaseAdmin.from('events').select('id, name'),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })

  const eventName = new Map((events ?? []).map(e => [e.id as string, e.name as string]))
  const rows = (claims ?? []).map(c => ({
    ...c,
    amount: r2(Number(c.amount ?? 0)),
    event_name: eventName.get(c.event_id as string) ?? '—',
  }))
  return NextResponse.json(rows, { headers: NO_STORE })
}

export async function POST(req: Request) {
  const g = await requireAdmin('POST /api/claims')
  if (g.response) return g.response

  const body = await req.json().catch(() => ({}))
  const { event_id, claimant_name, claimant_phone, description, category, amount, notes } = body as Record<string, unknown>

  if (!event_id || typeof event_id !== 'string') {
    return NextResponse.json({ error: 'An event is required.' }, { status: 400, headers: NO_STORE })
  }
  if (!description || !String(description).trim()) {
    return NextResponse.json({ error: 'A description is required.' }, { status: 400, headers: NO_STORE })
  }
  const amt = Number(amount)
  if (!Number.isFinite(amt) || amt < 0) {
    return NextResponse.json({ error: 'Amount must be a number ≥ 0.' }, { status: 400, headers: NO_STORE })
  }

  const insert = {
    event_id,
    claimant_name: claimant_name ? String(claimant_name).trim() : '',
    claimant_phone: claimant_phone ? String(claimant_phone).trim() : null,
    description: String(description).trim(),
    category: (category ? String(category).trim() : '') || 'Reimbursement',
    amount: r2(amt),
    notes: notes ? String(notes).trim() : null,
  }
  const { data, error } = await supabaseAdmin.from('claims').insert(insert).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })
  return NextResponse.json({ ok: true, claim: data }, { headers: NO_STORE })
}

export async function PATCH(req: Request) {
  const g = await requireAdmin('PATCH /api/claims')
  if (g.response) return g.response

  const body = await req.json().catch(() => ({}))
  const { id, status, ...rest } = body as { id?: string; status?: string } & Record<string, unknown>
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400, headers: NO_STORE })
  if (status !== undefined && !STATUSES.includes(status as Status)) {
    return NextResponse.json({ error: `status must be one of ${STATUSES.join(', ')}` }, { status: 400, headers: NO_STORE })
  }

  const updates: Record<string, unknown> = {}
  for (const k of ['claimant_name', 'claimant_phone', 'description', 'category', 'notes'] as const) {
    if (rest[k] !== undefined) updates[k] = rest[k] === null ? null : String(rest[k]).trim()
  }
  if (rest.amount !== undefined) {
    const amt = Number(rest.amount)
    if (!Number.isFinite(amt) || amt < 0) {
      return NextResponse.json({ error: 'Amount must be a number ≥ 0.' }, { status: 400, headers: NO_STORE })
    }
    updates.amount = r2(amt)
  }
  if (status !== undefined) {
    updates.status = status
    updates.paid_at = status === 'paid' ? new Date().toISOString() : null
  }

  const { data, error } = await supabaseAdmin.from('claims').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })
  return NextResponse.json({ ok: true, claim: data }, { headers: NO_STORE })
}

export async function DELETE(req: Request) {
  const g = await requireAdmin('DELETE /api/claims')
  if (g.response) return g.response

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400, headers: NO_STORE })
  const { error } = await supabaseAdmin.from('claims').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
