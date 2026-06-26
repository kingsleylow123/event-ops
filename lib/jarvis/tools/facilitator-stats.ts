import type Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import type { ToolDef } from '../types'

// Facilitators tab — cross-event leaderboard (mirrors /api/facilitator-stats).
// A facilitator = attendees.is_facilitator = true. "Huda" is suppressed (she runs
// the dashboard and doesn't want her name in facilitator widgets).
const GET_FACILITATOR_STATS_SCHEMA: Anthropic.Tool = {
  name: 'get_facilitator_stats',
  description: 'Cross-event facilitator leaderboard: per facilitator — total events run, current streak, longest streak, and 2-day (GLCC) completions. Use for "facilitator stats", "who has the longest streak", "how many events has X facilitated".',
  input_schema: { type: 'object', properties: {} },
}

type EventRow = { id: string; name: string | null; date: string | null; floor_plan: { days?: unknown[] } | null }
type FacilRow = { name: string | null; event_id: string; day1_attended: boolean | null; day2_attended: boolean | null }

async function getFacilitatorStats() {
  const [eventsRes, facilsRes] = await Promise.all([
    supabase.from('events').select('id, name, date, floor_plan').order('date', { ascending: true }),
    supabase.from('attendees').select('name, event_id, day1_attended, day2_attended').eq('is_facilitator', true),
  ])
  if (eventsRes.error) return { error: eventsRes.error.message }
  if (facilsRes.error) return { error: facilsRes.error.message }

  const allEvents = (eventsRes.data ?? []) as EventRow[]
  const EXCLUDED = new Set(['huda'])
  const norm = (s: string | null) => (s ?? '').trim().toLowerCase()
  const facilRows = ((facilsRes.data ?? []) as FacilRow[]).filter(r => !EXCLUDED.has(norm(r.name)))
  const isMultiDay = (e: EventRow) => Array.isArray(e.floor_plan?.days) && (e.floor_plan?.days?.length ?? 0) >= 2

  const byName = new Map<string, { display: string; eventIds: Set<string> }>()
  for (const f of facilRows) {
    const key = norm(f.name)
    if (!key) continue
    if (!byName.has(key)) byName.set(key, { display: (f.name ?? '').trim(), eventIds: new Set() })
    byName.get(key)!.eventIds.add(f.event_id)
  }

  const completions = new Map<string, Set<string>>()
  for (const ev of allEvents.filter(isMultiDay)) {
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

  const facilitatedEventIds = new Set(facilRows.map(r => r.event_id))
  const orderedIds = allEvents.filter(e => facilitatedEventIds.has(e.id)).map(e => e.id)

  const stats = [...byName.entries()].map(([key, { display, eventIds }]) => {
    const presence = orderedIds.map(id => eventIds.has(id))
    let longest = 0, run = 0
    for (const p of presence) { if (p) { run++; if (run > longest) longest = run } else run = 0 }
    let current = 0
    for (let i = presence.length - 1; i >= 0; i--) { if (presence[i]) current++; else break }
    return {
      name: display,
      total_events: eventIds.size,
      current_streak: current,
      longest_streak: longest,
      two_day_completions: (completions.get(key) ?? new Set()).size,
    }
  })
  stats.sort((a, b) => b.total_events - a.total_events || b.current_streak - a.current_streak)
  return { facilitators: stats.slice(0, 20) }
}

export const GET_FACILITATOR_STATS_TOOL: ToolDef = { schema: GET_FACILITATOR_STATS_SCHEMA, handler: getFacilitatorStats }
