// Real-time Telegram pings to admins for the attendee lifecycle:
//   pingRegistration  → fires when a new attendee is added (any source)
//   pingCheckin       → fires when an attendee checks in for a day
// Both are best-effort: wrapped in try/catch so Telegram outages or missing
// env vars can never block the underlying request.

import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { notifyAdmins, esc, b } from '@/lib/telegram'

export async function pingRegistration(opts: {
  event_id: string
  name: string
  payment_status?: string | null
  payment_amount?: number | string | null
}): Promise<void> {
  try {
    const { event_id, name, payment_status, payment_amount } = opts

    // Total registered for this event (refunded excluded — they're not really registered).
    const [{ count: totalCount }, { data: ev }] = await Promise.all([
      supabase.from('attendees').select('id', { count: 'exact', head: true })
        .eq('event_id', event_id).neq('payment_status', 'refunded'),
      supabase.from('events').select('name, capacity').eq('id', event_id).maybeSingle(),
    ])

    const total = totalCount ?? 0
    const cap = Number(ev?.capacity ?? 0)
    const left = cap > 0 ? Math.max(0, cap - total) : null
    const eventName = (ev?.name as string) || 'event'
    const amt = Number(payment_amount ?? 0)
    const status = String(payment_status ?? 'pending')
    const icon = status === 'paid' ? '✅' : status === 'pending' ? '⏳' : '🎟'
    const amountPart = amt > 0 ? ` · RM ${amt.toLocaleString('en-MY')}` : ''
    const capPart = left !== null ? `  ·  ${b(left)} seat${left === 1 ? '' : 's'} left` : ''

    const msg = `📝 ${b(esc(name))} just registered — ${esc(eventName)}\n` +
      `   ${icon} ${esc(status)}${amountPart}\n` +
      `   👥 ${b(total)} registered${capPart}`

    await notifyAdmins(msg)
  } catch {
    // never block the request on telegram failure
  }
}

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
