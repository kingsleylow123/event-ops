import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireUser } from '@/lib/auth/guard'

export const dynamic = 'force-dynamic'

// Aggregates facilitator activity across every event for the streak/total badges
// shown on the Facilitators view. A facilitator row is identified by
// ticket_type IS NULL on the attendees table.
export async function GET() {
  const g = await requireUser('GET /api/facilitator-stats'); if (g.response) return g.response

  const [eventsRes, facilsRes] = await Promise.all([
    supabaseAdmin.from('events').select('id, date').order('date', { ascending: true }),
    supabaseAdmin.from('attendees').select('name, event_id').is('ticket_type', null),
  ])

  if (eventsRes.error) return NextResponse.json({ error: eventsRes.error.message }, { status: 500 })
  if (facilsRes.error) return NextResponse.json({ error: facilsRes.error.message }, { status: 500 })

  const allEvents = eventsRes.data ?? []
  const facilRows = (facilsRes.data ?? []) as { name: string | null; event_id: string }[]

  const norm = (s: string | null) => (s ?? '').trim().toLowerCase()

  // Per-name → unique event ids facilitated (GLCC has 2 rows per crew, one per day — dedupe).
  const byName = new Map<string, { display: string; eventIds: Set<string> }>()
  for (const f of facilRows) {
    const key = norm(f.name)
    if (!key) continue
    if (!byName.has(key)) byName.set(key, { display: (f.name ?? '').trim(), eventIds: new Set() })
    byName.get(key)!.eventIds.add(f.event_id)
  }

  // Only consider events that actually had facilitators when computing streaks —
  // empty-team events shouldn't count as a "broken streak".
  const facilitatedEventIds = new Set(facilRows.map(r => r.event_id))
  const orderedIds = allEvents.filter(e => facilitatedEventIds.has(e.id)).map(e => e.id)

  const stats = Array.from(byName.values()).map(({ display, eventIds }) => {
    const presence = orderedIds.map(id => eventIds.has(id))

    let longest = 0
    let run = 0
    for (const p of presence) {
      if (p) { run++; if (run > longest) longest = run } else run = 0
    }

    // Current streak: trailing consecutive presences from the most recent event.
    // If the latest facilitated event wasn't this person's, current = 0.
    let current = 0
    for (let i = presence.length - 1; i >= 0; i--) {
      if (presence[i]) current++
      else break
    }

    return {
      name: display,
      total_events: eventIds.size,
      current_streak: current,
      longest_streak: longest,
    }
  })

  // Highest total first, then current streak.
  stats.sort((a, b) => b.total_events - a.total_events || b.current_streak - a.current_streak)

  return NextResponse.json(stats, { headers: { 'Cache-Control': 'no-store' } })
}
