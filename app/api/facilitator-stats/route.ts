import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireUser } from '@/lib/auth/guard'

export const dynamic = 'force-dynamic'

// Aggregates facilitator activity across every event for the streak / total /
// 2-day-completion badges shown on the Facilitators view. A facilitator row
// is identified by ticket_type IS NULL on the attendees table.
export async function GET() {
  const g = await requireUser('GET /api/facilitator-stats'); if (g.response) return g.response

  const [eventsRes, facilsRes] = await Promise.all([
    supabaseAdmin.from('events').select('id, name, date, floor_plan').order('date', { ascending: true }),
    supabaseAdmin.from('attendees').select('name, event_id, day1_attended, day2_attended').eq('is_facilitator', true),
  ])

  if (eventsRes.error) return NextResponse.json({ error: eventsRes.error.message }, { status: 500 })
  if (facilsRes.error) return NextResponse.json({ error: facilsRes.error.message }, { status: 500 })

  type EventRow = { id: string; name: string | null; date: string | null; floor_plan: { days?: unknown[] } | null }
  type FacilRow = { name: string | null; event_id: string; day1_attended: boolean | null; day2_attended: boolean | null }

  const allEvents = (eventsRes.data ?? []) as EventRow[]
  const facilRows = (facilsRes.data ?? []) as FacilRow[]

  const norm = (s: string | null) => (s ?? '').trim().toLowerCase()
  const isMultiDay = (e: EventRow) => Array.isArray(e.floor_plan?.days) && (e.floor_plan?.days?.length ?? 0) >= 2
  const eventName = (id: string) => allEvents.find(e => e.id === id)?.name ?? ''

  // Per-name → unique event ids facilitated (GLCC has 2 rows per crew, one per day — dedupe).
  const byName = new Map<string, { display: string; eventIds: Set<string> }>()
  for (const f of facilRows) {
    const key = norm(f.name)
    if (!key) continue
    if (!byName.has(key)) byName.set(key, { display: (f.name ?? '').trim(), eventIds: new Set() })
    byName.get(key)!.eventIds.add(f.event_id)
  }

  // Per-name → set of multi-day event ids where they were present on BOTH days.
  // We collapse all rows the same person has for an event (the GLCC split-row case)
  // and check if day1+day2 coverage is complete.
  const completions = new Map<string, Set<string>>()
  const multiDayEvents = allEvents.filter(isMultiDay)
  for (const ev of multiDayEvents) {
    const coverage = new Map<string, { d1: boolean; d2: boolean }>()
    for (const f of facilRows.filter(r => r.event_id === ev.id)) {
      const key = norm(f.name)
      if (!key) continue
      const cur = coverage.get(key) ?? { d1: false, d2: false }
      if (f.day1_attended) cur.d1 = true
      if (f.day2_attended) cur.d2 = true
      coverage.set(key, cur)
    }
    for (const [key, { d1, d2 }] of coverage) {
      if (d1 && d2) {
        if (!completions.has(key)) completions.set(key, new Set())
        completions.get(key)!.add(ev.id)
      }
    }
  }

  // Only consider events that actually had facilitators when computing streaks —
  // empty-team events shouldn't count as a "broken streak".
  const facilitatedEventIds = new Set(facilRows.map(r => r.event_id))
  const orderedIds = allEvents.filter(e => facilitatedEventIds.has(e.id)).map(e => e.id)

  const stats = Array.from(byName.entries()).map(([key, { display, eventIds }]) => {
    const presence = orderedIds.map(id => eventIds.has(id))

    let longest = 0
    let run = 0
    for (const p of presence) {
      if (p) { run++; if (run > longest) longest = run } else run = 0
    }

    let current = 0
    for (let i = presence.length - 1; i >= 0; i--) {
      if (presence[i]) current++
      else break
    }

    const completedEventIds = Array.from(completions.get(key) ?? [])
    return {
      name: display,
      total_events: eventIds.size,
      current_streak: current,
      longest_streak: longest,
      two_day_completions: completedEventIds.length,
      two_day_event_names: completedEventIds.map(eventName).filter(Boolean),
    }
  })

  stats.sort((a, b) => b.total_events - a.total_events || b.current_streak - a.current_streak)

  return NextResponse.json(stats, { headers: { 'Cache-Control': 'no-store' } })
}
