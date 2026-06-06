import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { notifyAdmins, esc, b } from '@/lib/telegram'
import { pickActiveEvent } from '@/lib/event'
import { normPhone, normEmail } from '@/lib/format'
import type { Event } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Anomaly sweep (08:30 MYT = 00:30 UTC).
// Detects: duplicate attendees (same normalized phone/email), overdue checklist
// items, fill% at/over capacity or > 95%, stalled survey (0 responses with < 3
// days to go). Dedupes alerts via jarvis_alerts (event_id, kind, ref UNIQUE) so
// the same anomaly is only pinged once per event lifecycle.
export async function GET(req: NextRequest) {
  // Fail CLOSED: require CRON_SECRET to be set AND match.
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  // ── Pick the active event ──────────────────────────────────────────────────
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

  const todayTs = new Date().setHours(0, 0, 0, 0)
  const eventTs = new Date(eventDate).setHours(0, 0, 0, 0)
  const msPerDay = 86400000
  const daysUntil = Math.round((eventTs - todayTs) / msPerDay)
  const today = new Date().toISOString().slice(0, 10)

  // ── Load attendees, checklist, survey in parallel ─────────────────────────
  const [attRes, checkRes, surveyRes] = await Promise.all([
    supabase.from('attendees').select('id, name, phone, email, payment_status').eq('event_id', eventId),
    supabase.from('checklist_items').select('id, item, category, due_date, status').eq('event_id', eventId),
    supabase.from('pre_event_survey_responses').select('id').eq('event_id', eventId),
  ])

  if (attRes.error) return NextResponse.json({ ok: false, error: attRes.error.message }, { status: 500 })

  const attendees = attRes.data ?? []
  const checklist = checkRes.data ?? []
  const surveyCount = (surveyRes.data ?? []).length
  const registered = attendees.length

  // ── Detect anomalies ───────────────────────────────────────────────────────
  // Each anomaly: { kind: string, ref: string, label: string }
  // kind = 'duplicate' | 'overdue' | 'capacity' | 'stalled_survey'
  // ref  = stable string so (event_id, kind, ref) uniquely identifies the alert
  const detected: Array<{ kind: string; ref: string; label: string }> = []

  // 1) Duplicate attendees (same normalized phone OR normalized email)
  const phoneGroups = new Map<string, string[]>() // normPhone → [name, ...]
  const emailGroups = new Map<string, string[]>() // normEmail → [name, ...]
  for (const a of attendees) {
    const ph = normPhone(a.phone as string | undefined)
    const em = normEmail(a.email as string | undefined)
    if (ph) {
      const g = phoneGroups.get(ph) ?? []
      g.push((a.name as string) || a.id as string)
      phoneGroups.set(ph, g)
    }
    if (em) {
      const g = emailGroups.get(em) ?? []
      g.push((a.name as string) || a.id as string)
      emailGroups.set(em, g)
    }
  }
  for (const [ph, names] of phoneGroups) {
    if (names.length > 1) {
      detected.push({
        kind: 'duplicate',
        ref: `phone:${ph}`,
        label: `Duplicate phone ${esc(ph)}: ${names.slice(0, 3).map(esc).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`,
      })
    }
  }
  for (const [em, names] of emailGroups) {
    if (names.length > 1) {
      detected.push({
        kind: 'duplicate',
        ref: `email:${em}`,
        label: `Duplicate email ${esc(em)}: ${names.slice(0, 3).map(esc).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`,
      })
    }
  }

  // 2) Overdue checklist items (due_date < today, status != done)
  const overdueItems = checklist.filter(
    c => c.due_date && String(c.due_date) < today && c.status !== 'done'
  )
  for (const c of overdueItems) {
    detected.push({
      kind: 'overdue',
      ref: `item:${c.id as string}`,
      label: `Overdue task: "${esc(c.item)}"${c.category ? ` [${esc(c.category)}]` : ''} (due ${esc(String(c.due_date))})`,
    })
  }

  // 3) Fill% at or over capacity, or > 95%
  if (capacity > 0) {
    const fillPct = Math.round((registered / capacity) * 100)
    if (registered >= capacity) {
      detected.push({
        kind: 'capacity',
        ref: `over:${registered}`,
        label: `At/over capacity: ${esc(registered)} registered vs ${esc(capacity)} cap (${fillPct}%)`,
      })
    } else if (fillPct >= 95) {
      detected.push({
        kind: 'capacity',
        ref: `near95:${registered}`,
        label: `Near capacity: ${esc(registered)} / ${esc(capacity)} (${fillPct}%) — only ${esc(capacity - registered)} spots left`,
      })
    }
  }

  // 4) Stalled survey: 0 responses with < 3 days to go (and event is upcoming)
  if (daysUntil >= 0 && daysUntil < 3 && surveyCount === 0 && registered > 0) {
    detected.push({
      kind: 'stalled_survey',
      ref: `zero:d${daysUntil}`,
      label: `0 survey responses with ${daysUntil === 0 ? 'event today' : `${daysUntil}d to go`} (${esc(registered)} registered)`,
    })
  }

  if (!detected.length) {
    return NextResponse.json({ ok: true, new: 0 })
  }

  // ── Dedupe: only act on anomalies not yet recorded in jarvis_alerts ────────
  const { data: existingAlerts } = await supabase
    .from('jarvis_alerts')
    .select('kind, ref')
    .eq('event_id', eventId)

  const seen = new Set((existingAlerts ?? []).map(r => `${r.kind as string}|${r.ref as string}`))
  const newAnomalies = detected.filter(d => !seen.has(`${d.kind}|${d.ref}`))

  if (!newAnomalies.length) {
    return NextResponse.json({ ok: true, new: 0 })
  }

  // ── Insert new alert rows (UNIQUE constraint guards against race/double-run) ─
  const rows = newAnomalies.map(d => ({ event_id: eventId, kind: d.kind, ref: d.ref }))
  const { error: insErr } = await supabase.from('jarvis_alerts').insert(rows)
  if (insErr && !String(insErr.message).includes('duplicate') && !String(insErr.message).includes('unique')) {
    console.error('[jarvis/anomaly] insert alerts failed', insErr)
    // Non-duplicate insert error — still send the notification so admins aren't silenced
  }

  // ── Send one consolidated notification ────────────────────────────────────
  let msg = `🚨 ${b('Anomaly Alert')} — ${esc(eventName)} (${newAnomalies.length} new)\n`
  for (const a of newAnomalies) {
    const icon =
      a.kind === 'duplicate' ? '👥' :
      a.kind === 'overdue' ? '⚠️' :
      a.kind === 'capacity' ? '🔴' :
      a.kind === 'stalled_survey' ? '📋' : '❗'
    msg += `\n${icon} ${a.label}`
  }

  await notifyAdmins(msg)

  return NextResponse.json({ ok: true, new: newAnomalies.length, anomalies: newAnomalies.map(a => ({ kind: a.kind, ref: a.ref })) })
}
