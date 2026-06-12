import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { requireUser } from '@/lib/auth/guard'
import { normPhone } from '@/lib/format'
import { notifyAdmins, esc, b } from '@/lib/telegram'
import { rateLimit, clientIp, tooManyResponse, tooLong } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

const STATUSES = ['new', 'contacted', 'meeting', 'won', 'lost'] as const
type Status = (typeof STATUSES)[number]

// POST (public): a team rep logs a hot lead from an event. No auth gate — the
// rep self-identifies by name + phone (identity tag only). Writes via service
// role (bypasses RLS), auto-links the client to an attendee by phone, and pings
// the admins on Telegram instantly so deals can be closed at the back table.
export async function POST(req: NextRequest) {
  // Burst protection — each POST pings the founder's Telegram, so floods are
  // doubly costly. 20/min covers several closers sharing the venue IP.
  if (!(await rateLimit(`pipeline:${clientIp(req)}`, 20))) return tooManyResponse()

  const body = await req.json().catch(() => ({}))
  const { event_id, rep_name, rep_phone, client_name, client_phone, needs } = body as {
    event_id?: string; rep_name?: string; rep_phone?: string
    client_name?: string; client_phone?: string; needs?: string
  }

  if (!event_id || !rep_name?.trim() || !client_name?.trim() || !client_phone?.trim() || !needs?.trim()) {
    return NextResponse.json(
      { error: 'event_id, rep_name, client_name, client_phone and needs are required' },
      { status: 400, headers: NO_STORE },
    )
  }
  const oversized = tooLong({
    rep_name: [rep_name, 80], rep_phone: [rep_phone, 40],
    client_name: [client_name, 120], client_phone: [client_phone, 40], needs: [needs, 2000],
  })
  if (oversized) {
    return NextResponse.json({ error: `${oversized} too long` }, { status: 400, headers: NO_STORE })
  }

  const client_phone_norm = normPhone(client_phone)
  const rep_phone_norm = normPhone(rep_phone)

  // Auto-link the client to an attendee of this event by normalized phone.
  let attendee_id: string | null = null
  if (client_phone_norm) {
    const { data: atts } = await supabase
      .from('attendees').select('id, phone').eq('event_id', event_id)
    const match = atts?.find(a => normPhone(a.phone as string) === client_phone_norm)
    if (match) attendee_id = match.id as string
  }

  const { data: inserted, error } = await supabase
    .from('deal_leads')
    .insert({
      event_id,
      client_name: client_name.trim(),
      client_phone: client_phone.trim(),
      client_phone_norm,
      needs: needs.trim(),
      rep_name: rep_name.trim(),
      rep_phone: rep_phone?.trim() || null,
      rep_phone_norm,
      attendee_id,
      status: 'new',
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })

  // Instant Telegram ping (best-effort — never fail the capture on a ping error).
  try {
    const { data: ev } = await supabase.from('events').select('name').eq('id', event_id).single()
    const msg =
      `🔥 ${b('New hot lead')}${ev?.name ? ` — ${esc(ev.name)}` : ''}\n` +
      `${b(esc(client_name.trim()))} · ${esc(client_phone.trim())}\n` +
      `${b('Needs')}: ${esc(needs.trim())}\n` +
      `${b('Logged by')}: ${esc(rep_name.trim())}` +
      (attendee_id ? `\n<i>✓ matched to an attendee</i>` : '')
    await notifyAdmins(msg)
  } catch { /* ping failure must not fail the insert */ }

  return NextResponse.json({ ok: true, id: inserted?.id }, { headers: NO_STORE })
}

// GET ?event_id= (admin): the founder pipeline for one event.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const event_id = searchParams.get('event_id')
  if (!event_id) return NextResponse.json({ error: 'event_id required' }, { status: 400, headers: NO_STORE })

  const g = await requireUser('GET /api/pipeline'); if (g.response) return g.response

  const { data, error } = await supabase
    .from('deal_leads')
    .select('id, client_name, client_phone, client_phone_norm, needs, rep_name, status, founder_notes, attendee_id, created_at')
    .eq('event_id', event_id)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })

  const leads = data ?? []
  const byStatus: Record<Status, number> = { new: 0, contacted: 0, meeting: 0, won: 0, lost: 0 }
  for (const l of leads) {
    const s = (l.status as Status)
    if (s in byStatus) byStatus[s]++
  }

  return NextResponse.json({ leads, summary: { total: leads.length, byStatus } }, { headers: NO_STORE })
}

// PATCH (admin): move a lead's status or save founder follow-up notes.
export async function PATCH(req: NextRequest) {
  const g = await requireUser('PATCH /api/pipeline'); if (g.response) return g.response

  const body = await req.json().catch(() => ({}))
  const { id, status, founder_notes } = body as { id?: string; status?: string; founder_notes?: string }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400, headers: NO_STORE })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (status !== undefined) {
    if (!STATUSES.includes(status as Status)) {
      return NextResponse.json({ error: 'invalid status' }, { status: 400, headers: NO_STORE })
    }
    patch.status = status
  }
  if (founder_notes !== undefined) patch.founder_notes = founder_notes

  const { data, error } = await supabase
    .from('deal_leads').update(patch).eq('id', id)
    .select('id, client_name, client_phone, client_phone_norm, needs, rep_name, status, founder_notes, attendee_id, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })

  return NextResponse.json(data, { headers: NO_STORE })
}
