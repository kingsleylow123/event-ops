// POST /api/bukku/contacts — push every attendee of an event into Bukku as
// customer contacts (name → legal_name, phone, email). De-dupes by name via
// findOrCreateContactDetailed, so re-running is safe: existing names are reused,
// not duplicated. Returns created / reused / failed tallies.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/auth/guard'
import { bukkuEnabled, bukkuStatus, findOrCreateContactDetailed } from '@/lib/bukku'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Body = { event_id?: string }

export async function POST(req: Request) {
  const g = await requireAdmin('POST /api/bukku/contacts')
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

  const { data: attendees, error } = await supabaseAdmin
    .from('attendees')
    .select('name, phone, email')
    .eq('event_id', body.event_id)
  if (error) {
    return NextResponse.json({ error: 'Failed to load attendees', details: error.message }, { status: 500 })
  }

  // Bukku contacts key on legal_name, so a blank name can't become a contact.
  const rows = (attendees ?? []).filter(a => a.name && a.name.trim())
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No attendees with a name to sync for this event' }, { status: 422 })
  }

  // Sequential on purpose — keeps us well under Bukku's rate limit and means a
  // single failure doesn't take down the rest of the batch.
  let created = 0
  let reused = 0
  const failed: Array<{ name: string; error: string }> = []

  for (const a of rows) {
    try {
      const r = await findOrCreateContactDetailed({
        name: a.name,
        phone: a.phone ?? undefined,
        email: a.email ?? undefined,
        types: ['customer'],
      })
      if (r.created) created++
      else reused++
    } catch (e) {
      failed.push({ name: a.name, error: (e as Error).message })
    }
  }

  return NextResponse.json({
    ok: true,
    total: rows.length,
    created,
    reused,
    failed_count: failed.length,
    failed: failed.slice(0, 20),
  })
}
