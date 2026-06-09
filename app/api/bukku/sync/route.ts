// POST /api/bukku/sync — book an event's TICKET REVENUE into Bukku as a single
// cash sale ("Ticket sales — {event}"), summarising every paid attendee.
// Idempotent on events.bukku_income_id: if already synced, returns it untouched.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/auth/guard'
import { bukkuEnabled, bukkuStatus, createIncome } from '@/lib/bukku'
import { TICKET_LABELS, type TicketType } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Body = { event_id?: string }

export async function POST(req: Request) {
  const g = await requireAdmin('POST /api/bukku/sync')
  if (g.response) return g.response

  if (!bukkuEnabled()) {
    return NextResponse.json({ error: 'Bukku not configured', status: bukkuStatus() }, { status: 503 })
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.event_id) {
    return NextResponse.json({ error: 'event_id is required' }, { status: 400 })
  }

  const { data: event, error } = await supabaseAdmin
    .from('events')
    .select('id, name, date, bukku_income_id')
    .eq('id', body.event_id)
    .single()
  if (error || !event) {
    return NextResponse.json({ error: 'Event not found', details: error?.message }, { status: 404 })
  }

  // Idempotency — already synced.
  if (event.bukku_income_id) {
    return NextResponse.json({ ok: true, idempotent: true, bukku_income_id: event.bukku_income_id })
  }

  // Sum every paid attendee, with a per-ticket-type breakdown for the description.
  const { data: attendees, error: aErr } = await supabaseAdmin
    .from('attendees')
    .select('ticket_type, payment_amount, payment_status')
    .eq('event_id', body.event_id)
    .eq('payment_status', 'paid')
  if (aErr) {
    return NextResponse.json({ error: 'Failed to load attendees', details: aErr.message }, { status: 500 })
  }

  const rows = attendees ?? []
  const total = Math.round(rows.reduce((s, a) => s + Number(a.payment_amount ?? 0), 0) * 100) / 100
  if (total <= 0) {
    return NextResponse.json({ error: 'No paid ticket revenue to sync for this event' }, { status: 422 })
  }

  // Breakdown e.g. "3× Early Bird VIP, 5× Public General"
  const counts = new Map<string, number>()
  for (const a of rows) {
    const label = TICKET_LABELS[a.ticket_type as TicketType] ?? String(a.ticket_type)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const breakdown = [...counts.entries()].map(([label, n]) => `${n}× ${label}`).join(', ')
  const description = `Ticket sales — ${event.name} (${rows.length} paid: ${breakdown})`

  let bukku_income_id: string
  try {
    bukku_income_id = await createIncome({
      date: String(event.date).slice(0, 10),
      description,
      amount: total,
    })
  } catch (e) {
    return NextResponse.json({ error: 'Bukku createIncome failed', details: (e as Error).message }, { status: 502 })
  }

  const { error: upErr } = await supabaseAdmin.from('events').update({ bukku_income_id }).eq('id', body.event_id)
  if (upErr) {
    return NextResponse.json({
      ok: true,
      partial: true,
      warning: 'Income created in Bukku but failed to persist the ID to Supabase',
      bukku_income_id,
      details: upErr.message,
    }, { status: 207 })
  }

  return NextResponse.json({ ok: true, bukku_income_id, total, paid_count: rows.length })
}
