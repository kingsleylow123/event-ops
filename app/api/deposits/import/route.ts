// POST /api/deposits/import  { event_id?: 'all' | <id> }
// Syncs the deposit tracker with attendees (the source of truth):
//   • new pending attendees      → inserted
//   • existing attendee-backed   → total + deposit-paid + status refreshed from
//     the attendee (deposit parsed from the note; fully-paid attendees settle)
//   • manually-added deposits    → left untouched (no matching attendee)
//   • the manual "Pay by" date    → always preserved
// Idempotent: safe to run on every page load.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/auth/guard'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' } as const
const r2 = (n: number) => Math.round(n * 100) / 100

// Pull a deposit amount out of a free-text note: "Deposit 500" / "dep RM3,799".
function parseDeposit(notes: string | null | undefined): number {
  if (!notes) return 0
  const m = notes.match(/dep(?:osit)?[^\d]*([\d,]+(?:\.\d+)?)/i)
  if (!m) return 0
  const n = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : 0
}
const key = (eventId: string, name: string) => `${eventId}|${name.trim().toLowerCase()}`

type Att = { name: string | null; event_id: string | null; payment_amount: number | null; payment_status: string | null; notes: string | null; phone: string | null }

// What a deposit row should look like given its attendee.
function desired(a: Att) {
  const total = r2(Number(a.payment_amount ?? 0))
  const isPaid = a.payment_status === 'paid'
  const deposit = isPaid ? total : Math.min(parseDeposit(a.notes), total)
  const status: 'partial' | 'paid' = isPaid || deposit >= total ? 'paid' : 'partial'
  return { total, deposit: r2(deposit), status }
}

export async function POST(req: Request) {
  const g = await requireAdmin('POST /api/deposits/import')
  if (g.response) return g.response

  const body = await req.json().catch(() => ({}))
  const event_id = (body as { event_id?: string }).event_id || 'all'

  let attQ = supabaseAdmin.from('attendees').select('name, event_id, payment_amount, payment_status, notes, phone')
  let depQ = supabaseAdmin.from('deposits').select('id, event_id, name, total_amount, deposit_paid, status, paid_at, phone')
  if (event_id !== 'all') {
    attQ = attQ.eq('event_id', event_id)
    depQ = depQ.eq('event_id', event_id)
  }
  const [{ data: attendees, error: attErr }, { data: existing, error: depErr }] = await Promise.all([attQ, depQ])
  if (attErr || depErr) {
    return NextResponse.json({ error: (attErr ?? depErr)!.message }, { status: 500, headers: NO_STORE })
  }

  // First attendee wins for a given event+name.
  const attByKey = new Map<string, Att>()
  for (const a of (attendees ?? []) as Att[]) {
    if (!a.name || !a.event_id) continue
    const k = key(a.event_id, a.name)
    if (!attByKey.has(k)) attByKey.set(k, a)
  }

  const nowIso = new Date().toISOString()

  // 1) Refresh existing attendee-backed deposits (preserve due_date).
  const updates: PromiseLike<unknown>[] = []
  const existingKeys = new Set<string>()
  for (const d of existing ?? []) {
    const k = key(d.event_id as string, d.name as string)
    existingKeys.add(k)
    const a = attByKey.get(k)
    if (!a) continue // manual deposit — leave it alone
    if (d.status === 'refunded') continue // keep refunded deposits as-is
    const want = desired(a)
    const sameTotal = r2(Number(d.total_amount ?? 0)) === want.total
    const samePaid = r2(Number(d.deposit_paid ?? 0)) === want.deposit
    const sameStatus = d.status === want.status
    const samePhone = ((d.phone as string | null) ?? null) === (a.phone ?? null)
    if (sameTotal && samePaid && sameStatus && samePhone) continue
    updates.push(
      supabaseAdmin.from('deposits').update({
        total_amount: want.total,
        deposit_paid: want.deposit,
        status: want.status,
        phone: a.phone ?? null,
        paid_at: want.status === 'paid' ? ((d.paid_at as string | null) ?? nowIso) : null,
      }).eq('id', d.id)
    )
  }

  // 2) Insert pending attendees not yet tracked.
  const rows: Record<string, unknown>[] = []
  for (const a of (attendees ?? []) as Att[]) {
    if (a.payment_status !== 'pending') continue
    const total = r2(Number(a.payment_amount ?? 0))
    if (!a.name || !a.event_id || total <= 0) continue
    const k = key(a.event_id, a.name)
    if (existingKeys.has(k)) continue
    existingKeys.add(k)
    const want = desired(a)
    rows.push({
      event_id: a.event_id,
      name: a.name.trim(),
      phone: a.phone ?? null,
      total_amount: total,
      deposit_paid: want.deposit,
      status: want.status,
      paid_at: want.status === 'paid' ? nowIso : null,
    })
  }

  const updated = updates.length
  if (updates.length) await Promise.all(updates)

  let imported = 0
  if (rows.length) {
    const { error: insErr } = await supabaseAdmin.from('deposits').insert(rows)
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500, headers: NO_STORE })
    imported = rows.length
  }

  return NextResponse.json({ ok: true, imported, updated }, { headers: NO_STORE })
}
