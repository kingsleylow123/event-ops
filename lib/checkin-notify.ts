// Sends a real-time Telegram ping to admins each time someone is checked in,
// with the running per-day count (e.g. "Day 1: 3 / 14"). Best-effort: never
// blocks the request or throws — Telegram outages must not break check-in.

import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { notifyAdmins, esc, b } from '@/lib/telegram'

export async function pingCheckin(opts: {
  event_id: string
  name: string
  day: 1 | 2
}): Promise<void> {
  try {
    const { event_id, name, day } = opts
    const field = day === 1 ? 'day1_attended' : 'day2_attended'

    // Count of attendees registered for this event, and how many checked in
    // for the relevant day. We exclude refunded — they aren't really attendees.
    const [{ count: totalCount }, { count: dayCount }, { data: ev }] = await Promise.all([
      supabase.from('attendees').select('id', { count: 'exact', head: true })
        .eq('event_id', event_id).neq('payment_status', 'refunded'),
      supabase.from('attendees').select('id', { count: 'exact', head: true })
        .eq('event_id', event_id).eq(field, true).neq('payment_status', 'refunded'),
      supabase.from('events').select('name, floor_plan').eq('id', event_id).maybeSingle(),
    ])

    const total = totalCount ?? 0
    const arrived = dayCount ?? 0
    const fp = ev?.floor_plan as { days?: unknown[] } | null
    const isMultiDay = Array.isArray(fp?.days) && fp!.days!.length >= 2

    // Single-day events: just say "Checked in: X / Y" (no day number).
    const dayPart = isMultiDay ? `${b('Day ' + day)}` : `${b('Checked in')}`
    const msg = `✅ ${b(esc(name))} just arrived — ${dayPart}: ${b(arrived)} / ${b(total)}`

    await notifyAdmins(msg)
  } catch {
    // never block the check-in flow on telegram failure
  }
}
