// Event-time attendance pulse.
//
// Vercel cron fires this every 5 minutes, all day. The route checks whether
// "now" is within [-30, +30] minutes of an active event's day start (T) and
// sends a Telegram message to admins:
//
//   • T-30 .. T+25 (every 5 min)   → "🔔 attendance pulse · arrived 3 / 14"
//   • T+30 (the last tick)          → "⚠️ 11 people still not here — call them"
//
// Outside the window the route returns silently. Multi-day events are
// handled per day: Day N's T = event.date + (N-1) * 24h.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { notifyAdmins, esc, b } from '@/lib/telegram'
import { pickActiveEvent } from '@/lib/event'
import type { Event } from '@/lib/supabase'
import { toWhatsApp } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const MINUTE = 60 * 1000

export async function GET(req: NextRequest) {
  // Fail CLOSED: require CRON_SECRET match.
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  // Pick the active event (soonest upcoming / most recent).
  const { data: events, error: evErr } = await supabase
    .from('events').select('*').order('date', { ascending: false })
  if (evErr) return NextResponse.json({ ok: false, error: evErr.message }, { status: 500 })
  const ev = pickActiveEvent((events ?? []) as Event[])
  if (!ev || !ev.date) {
    return NextResponse.json({ ok: true, skipped: 'no active event' })
  }

  // How many days this event runs (defaults to 1 if floor_plan.days isn't set).
  const fp = ev.floor_plan as { days?: unknown[] } | null | undefined
  const dayCount = Array.isArray(fp?.days) && fp!.days!.length > 0 ? fp!.days!.length : 1

  const now = Date.now()
  const eventStart = new Date(ev.date).getTime()

  // Find which day's window (if any) we're in.
  let activeDay = 0
  let relativeMin = 0
  for (let d = 1; d <= dayCount; d++) {
    const T = eventStart + (d - 1) * 24 * 60 * MINUTE
    const rel = (now - T) / MINUTE
    if (rel >= -30 && rel <= 30) {
      activeDay = d
      relativeMin = rel
      break
    }
  }
  if (!activeDay) {
    return NextResponse.json({ ok: true, skipped: 'outside window' })
  }

  // Roster: paid/free attendees for this event. Refunded excluded.
  const { data: attendees } = await supabase
    .from('attendees')
    .select('name, phone, payment_status, day1_attended, day2_attended')
    .eq('event_id', ev.id)
    .in('payment_status', ['paid', 'free'])
  const roster = attendees ?? []
  const dayField = activeDay === 1 ? 'day1_attended' : 'day2_attended'
  const arrived = roster.filter(a => a[dayField as 'day1_attended' | 'day2_attended'])
  const missing = roster.filter(a => !a[dayField as 'day1_attended' | 'day2_attended'])

  // Pretty label for how far from the event start we are.
  const rel = Math.round(relativeMin)
  const tLabel = rel === 0 ? 'T = start time'
    : rel < 0 ? `T${rel} min (${Math.abs(rel)} min to start)`
    : `T+${rel} min (${rel} min after start)`
  const dayPart = dayCount >= 2 ? `${b('Day ' + activeDay)} · ` : ''

  // Final tick at T+30 → switch to "call them or mark no-show" reminder.
  const isFinalTick = rel >= 25

  let msg: string
  if (isFinalTick && missing.length > 0) {
    msg = `⚠️ ${dayPart}${b('30 min after start')} — ${b(missing.length)} ` +
      `${missing.length === 1 ? 'person is' : 'people are'} still not here\n` +
      `📞 ${b('Call them or mark as no-show')}:\n` +
      missing.slice(0, 15).map(a => {
        const wa = toWhatsApp(a.phone as string | null)
        const phonePart = a.phone
          ? (wa ? ` · <a href="${wa}">${esc(a.phone)}</a>` : ` · ${esc(a.phone)}`)
          : ''
        return `   • ${esc(a.name ?? '?')}${phonePart}`
      }).join('\n') +
      (missing.length > 15 ? `\n   <i>… and ${missing.length - 15} more</i>` : '') +
      `\n\n👥 Arrived: ${b(arrived.length)} / ${b(roster.length)}`
  } else if (isFinalTick) {
    // Window closed and everyone's here — celebrate, don't nag.
    msg = `✅ ${dayPart}${b('30 min after start')} — everyone here! ${b(arrived.length)} / ${b(roster.length)} arrived`
  } else {
    // Regular pulse during the window.
    msg = `🔔 ${dayPart}${b('Attendance pulse')} — ${esc(tLabel)}\n` +
      `👥 Arrived: ${b(arrived.length)} / ${b(roster.length)}`
    if (missing.length > 0 && missing.length <= 8) {
      msg += `\n<i>Missing:</i> ${missing.map(a => esc(a.name ?? '?')).join(', ')}`
    } else if (missing.length > 8) {
      msg += `\n<i>${missing.length} not yet checked in</i>`
    }
  }

  await notifyAdmins(msg)
  return NextResponse.json({
    ok: true, day: activeDay, rel_min: rel,
    arrived: arrived.length, missing: missing.length, total: roster.length,
  })
}
