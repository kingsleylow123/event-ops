import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { notifyAdmins, esc, b } from '@/lib/telegram'
import { pickActiveEvent } from '@/lib/event'
import { rm, fmtDate } from '@/lib/format'
import type { Event } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Daily readiness digest to admins (08:00 MYT = 00:00 UTC).
// Pulls the active event (is_active → soonest upcoming → most recent),
// then sends a compact brief covering fill, revenue, survey, checklist, payments.
export async function GET(req: NextRequest) {
  // Fail CLOSED: require CRON_SECRET to be set AND match.
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  // ── Pick the active event (same rule as pickActiveEvent / Jarvis) ─────────
  const { data: events, error: evErr } = await supabase
    .from('events')
    .select('*')
    .order('date', { ascending: false })
  if (evErr) return NextResponse.json({ ok: false, error: evErr.message }, { status: 500 })

  const ev = pickActiveEvent((events ?? []) as Event[])
  if (!ev) {
    return NextResponse.json({ ok: true, skipped: 'no active event' })
  }

  const eventId = ev.id as string
  const eventName = ev.name as string
  const eventDate = ev.date as string
  const capacity = Number(ev.capacity ?? 0)

  // ── Load attendees, checklist, survey in parallel ─────────────────────────
  const today = new Date().toISOString().slice(0, 10)
  const todayTs = new Date().setHours(0, 0, 0, 0)
  const eventTs = new Date(eventDate).setHours(0, 0, 0, 0)
  const msPerDay = 86400000
  // daysUntil: positive = future, 0 = today, negative = past
  const daysUntil = Math.round((eventTs - todayTs) / msPerDay)

  const [attRes, checkRes, surveyRes, claimsRes] = await Promise.all([
    supabase.from('attendees').select('payment_status, payment_amount, attendance_confirmed').eq('event_id', eventId),
    supabase.from('checklist_items').select('item, category, due_date, status').eq('event_id', eventId),
    supabase.from('pre_event_survey_responses').select('id').eq('event_id', eventId),
    supabase.from('claims').select('amount, status, submitted_at').eq('event_id', eventId),
  ])

  if (attRes.error) return NextResponse.json({ ok: false, error: attRes.error.message }, { status: 500 })

  const attendees = attRes.data ?? []
  const checklist = checkRes.data ?? []
  const surveyCount = (surveyRes.data ?? []).length
  // Open claims = submitted but not yet paid/rejected.
  const openClaims = (claimsRes.data ?? []).filter(c => c.status === 'pending' || c.status === 'approved')

  // ── Attendance breakdown ───────────────────────────────────────────────────
  const paid = attendees.filter(a => a.payment_status === 'paid')
  const pending = attendees.filter(a => a.payment_status === 'pending')
  const free = attendees.filter(a => a.payment_status === 'free')
  const registered = attendees.length
  const grossRevenue = paid.reduce((s, a) => s + Number(a.payment_amount ?? 0), 0)
  const fillPct = capacity ? Math.round((registered / capacity) * 100) : 0

  // Overdue checklist = due_date < today AND status != done
  const overdueItems = checklist.filter(
    c => c.due_date && String(c.due_date) < today && c.status !== 'done'
  )

  // ── Build message ─────────────────────────────────────────────────────────
  // Header — T-label
  let tLabel: string
  if (daysUntil > 1) tLabel = `T-${daysUntil} days`
  else if (daysUntil === 1) tLabel = 'T-1 — <b>Tomorrow!</b>'
  else if (daysUntil === 0) tLabel = 'T-0 — <b>Today!</b>'
  else tLabel = `T+${Math.abs(daysUntil)} (post-event)`

  let msg = `📋 ${b('Daily Digest')} — ${esc(eventName)}\n`
  msg += `📅 ${esc(fmtDate(eventDate))}  ·  ${tLabel}\n\n`

  // Attendance + revenue
  msg += `👥 ${b('Registered')}: ${esc(registered)}${capacity ? ` / ${esc(capacity)} (${fillPct}%)` : ''}\n`
  msg += `  ✅ Paid: ${b(paid.length)}   ⏳ Pending: ${b(pending.length)}   🎟 Free: ${b(free.length)}\n`
  msg += `💰 ${b('Gross revenue')}: ${esc(rm(grossRevenue))}\n\n`

  // Survey
  msg += `📋 Survey responses: ${b(surveyCount)}\n`

  // Overdue checklist
  if (overdueItems.length) {
    msg += `\n⚠️ ${b('Overdue checklist')} (${overdueItems.length}):\n`
    for (const c of overdueItems.slice(0, 10)) {
      msg += `  • ${esc(c.item)}${c.category ? ` <i>(${esc(c.category)})</i>` : ''}\n`
    }
    if (overdueItems.length > 10) msg += `  <i>… and ${overdueItems.length - 10} more</i>\n`
  } else {
    msg += `✅ No overdue checklist items\n`
  }

  // Payment-pending count (already in breakdown above — add a call-to-action if any)
  if (pending.length) {
    msg += `\n⏳ ${b(pending.length + ' pending payment' + (pending.length !== 1 ? 's' : ''))} — follow up needed`
  }

  // Open expense claims awaiting reimbursement
  if (openClaims.length) {
    const claimTotal = openClaims.reduce((s, c) => s + Number(c.amount ?? 0), 0)
    const oldest = Math.max(
      ...openClaims.map(c => Math.round((todayTs - new Date(c.submitted_at).setHours(0, 0, 0, 0)) / msPerDay))
    )
    msg += `\n💸 ${b(openClaims.length + ' claim' + (openClaims.length !== 1 ? 's' : '') + ' to reimburse')} — ${esc(rm(claimTotal))}`
    if (oldest >= 3) msg += ` <i>(oldest ${oldest}d)</i>`
  }

  // T-1 special reminder
  if (daysUntil === 1) {
    msg += `\n\n🔔 ${b("Tomorrow's the day!")} Last chance to confirm payments + checklist.`
  }

  // T+1 recap: final attended vs registered
  if (daysUntil === -1) {
    const attended = attendees.filter(a => a.attendance_confirmed).length
    msg += `\n\n🏁 ${b('T+1 Recap')}: ${b(attended)} attended of ${b(registered)} registered`
    if (paid.length) msg += ` · ${b(paid.length)} paid`
  }

  await notifyAdmins(msg)

  return NextResponse.json({
    ok: true,
    event: eventName,
    daysUntil,
    registered,
    paid: paid.length,
    pending: pending.length,
    surveyCount,
    overdueChecklist: overdueItems.length,
    openClaims: openClaims.length,
  })
}
