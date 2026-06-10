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

type Body = { event_id?: string; all?: boolean }

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
  if (!body.all && !body.event_id) {
    return NextResponse.json({ error: 'event_id is required (or pass { all: true })' }, { status: 400 })
  }

  // `all` → every event's customers; otherwise just the one event.
  let query = supabaseAdmin.from('attendees').select('name, phone, email')
  if (!body.all) query = query.eq('event_id', body.event_id!)
  const { data: attendees, error } = await query
  if (error) {
    return NextResponse.json({ error: 'Failed to load attendees', details: error.message }, { status: 500 })
  }

  // De-dupe by name (Bukku keys contacts on legal_name, so the same person
  // across events is one contact). Keep the row with the most contact info so
  // we don't drop a phone/email that another registration has.
  const best = new Map<string, { name: string; phone: string | null; email: string | null; score: number }>()
  for (const a of attendees ?? []) {
    const name = (a.name ?? '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    const score = (a.phone ? 1 : 0) + (a.email ? 1 : 0)
    const cur = best.get(key)
    if (!cur || score > cur.score) best.set(key, { name, phone: a.phone ?? null, email: a.email ?? null, score })
  }
  const rows = [...best.values()]
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No customers with a name to sync' }, { status: 422 })
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
    scope: body.all ? 'all-events' : 'event',
    total: rows.length,
    created,
    reused,
    failed_count: failed.length,
    failed: failed.slice(0, 20),
  })
}
