import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { notifyAdmins, esc, b } from '@/lib/telegram'
import { pickActiveEvent, isPingableEvent, EVENT_GRACE_MS } from '@/lib/event'
import { normPhone, normEmail } from '@/lib/format'
import type { Event } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Severity = 'CRITICAL' | 'WARN' | 'INFO'
const SEV_ORDER: Record<Severity, number> = { CRITICAL: 0, WARN: 1, INFO: 2 }
const DAY = 86400000

// Per-kind snooze window: how long an alert stays quiet after it fires, before it
// is allowed to re-surface. This replaces the old fire-once dedup (which silenced
// a still-open issue forever).
function snoozeMs(kind: string, ref: string): number {
  switch (kind) {
    case 'duplicate': return 7 * DAY
    case 'overdue': return 3 * DAY
    case 'stalled_survey': return 1 * DAY
    case 'unpaid_claim': return 3 * DAY
    case 'capacity': return ref === 'over' ? 999 * DAY : 7 * DAY
    default: return 3 * DAY
  }
}

// Anomaly sweep (08:30 MYT = 00:30 UTC).
// Detects duplicates, overdue checklist, capacity, stalled survey, unpaid claims.
// TTL-snooze via jarvis_alerts (event_id, kind, ref UNIQUE): an open issue re-pings
// after its snooze window instead of being silenced once. Severity orders the ping.
// A weekly "all clear" heartbeat confirms the cron is alive during quiet stretches.
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

  // Self-heal: clear expired manual pins so the DB never carries a stale active flag.
  await supabase
    .from('events')
    .update({ is_active: false })
    .eq('is_active', true)
    .lt('date', new Date(Date.now() - EVENT_GRACE_MS).toISOString())

  const ev = pickActiveEvent((events ?? []) as Event[])
  if (!ev) {
    return NextResponse.json({ ok: true, skipped: 'no active event' })
  }
  // Stop pinging once the active event is >3 days past (nothing upcoming).
  if (!isPingableEvent(ev)) {
    return NextResponse.json({ ok: true, skipped: 'active event >3d past' })
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
  const [attRes, checkRes, surveyRes, claimsRes] = await Promise.all([
    supabase.from('attendees').select('id, name, phone, email, payment_status').eq('event_id', eventId),
    supabase.from('checklist_items').select('id, item, category, due_date, status').eq('event_id', eventId),
    supabase.from('pre_event_survey_responses').select('id').eq('event_id', eventId),
    supabase.from('claims').select('id, claimant_name, amount, status, submitted_at').eq('event_id', eventId),
  ])

  if (attRes.error) return NextResponse.json({ ok: false, error: attRes.error.message }, { status: 500 })

  const attendees = attRes.data ?? []
  const checklist = checkRes.data ?? []
  const surveyCount = (surveyRes.data ?? []).length
  const claims = claimsRes.data ?? []
  const registered = attendees.length

  // ── Detect anomalies ───────────────────────────────────────────────────────
  // ref is stable so (event_id, kind, ref) uniquely identifies the alert.
  const detected: Array<{ kind: string; ref: string; label: string; severity: Severity }> = []

  // 1) Duplicate attendees (same normalized phone OR normalized email)
  const phoneGroups = new Map<string, string[]>()
  const emailGroups = new Map<string, string[]>()
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
        severity: 'CRITICAL',
      })
    }
  }
  for (const [em, names] of emailGroups) {
    if (names.length > 1) {
      detected.push({
        kind: 'duplicate',
        ref: `email:${em}`,
        label: `Duplicate email ${esc(em)}: ${names.slice(0, 3).map(esc).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`,
        severity: 'CRITICAL',
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
      severity: 'WARN',
    })
  }

  // 3) Fill% at or over capacity, or > 95%. ref is normalized (no count) so the
  //    snooze survives headcount changes.
  if (capacity > 0) {
    const fillPct = Math.round((registered / capacity) * 100)
    if (registered >= capacity) {
      detected.push({
        kind: 'capacity',
        ref: 'over',
        label: `At/over capacity: ${esc(registered)} registered vs ${esc(capacity)} cap (${fillPct}%)`,
        severity: 'CRITICAL',
      })
    } else if (fillPct >= 95) {
      detected.push({
        kind: 'capacity',
        ref: 'near95',
        label: `Near capacity: ${esc(registered)} / ${esc(capacity)} (${fillPct}%) — only ${esc(capacity - registered)} spots left`,
        severity: 'INFO',
      })
    }
  }

  // 4) Stalled survey: 0 responses with < 3 days to go (and event is upcoming)
  if (daysUntil >= 0 && daysUntil < 3 && surveyCount === 0 && registered > 0) {
    detected.push({
      kind: 'stalled_survey',
      ref: `zero:d${daysUntil}`,
      label: `0 survey responses with ${daysUntil === 0 ? 'event today' : `${daysUntil}d to go`} (${esc(registered)} registered)`,
      severity: 'WARN',
    })
  }

  // 5) Expense claims pending reimbursement ≥ 7 days
  for (const c of claims) {
    if (c.status !== 'pending' && c.status !== 'approved') continue
    const ageDays = Math.round((todayTs - new Date(c.submitted_at as string).setHours(0, 0, 0, 0)) / msPerDay)
    if (ageDays >= 7) {
      detected.push({
        kind: 'unpaid_claim',
        ref: `claim:${c.id as string}`,
        label: `Unpaid claim (${ageDays}d): ${esc(c.claimant_name as string)} — RM ${Number(c.amount ?? 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        severity: 'WARN',
      })
    }
  }

  const nowIso = new Date().toISOString()

  // ── Nothing detected → weekly all-clear heartbeat ──────────────────────────
  if (!detected.length) {
    const { data: lastFired } = await supabase
      .from('jarvis_alerts').select('fired_at')
      .eq('event_id', eventId).not('fired_at', 'is', null)
      .order('fired_at', { ascending: false }).limit(1).maybeSingle()
    const daysQuiet = lastFired?.fired_at
      ? Math.floor((Date.now() - new Date(lastFired.fired_at as string).getTime()) / DAY)
      : 999
    const { data: hb } = await supabase.from('jarvis_alerts').select('snooze_until')
      .eq('event_id', eventId).eq('kind', 'heartbeat').eq('ref', 'weekly').maybeSingle()
    const hbSnoozed = !!hb?.snooze_until && new Date(hb.snooze_until as string).getTime() > Date.now()
    if (daysQuiet >= 7 && !hbSnoozed) {
      await notifyAdmins(`✅ ${b('Anomaly check')} — all clear on ${esc(eventName)}. ${daysQuiet >= 999 ? 'No issues yet.' : `Quiet ${daysQuiet}d.`} Cron healthy.`)
      await supabase.from('jarvis_alerts').upsert(
        { event_id: eventId, kind: 'heartbeat', ref: 'weekly', fired_at: nowIso, snooze_until: new Date(Date.now() + 6 * DAY).toISOString(), severity: 'INFO' },
        { onConflict: 'event_id,kind,ref' },
      )
      return NextResponse.json({ ok: true, new: 0, heartbeat: true })
    }
    return NextResponse.json({ ok: true, new: 0 })
  }

  // ── TTL-snooze dedup: act only on anomalies not currently snoozed ──────────
  const { data: existingAlerts } = await supabase
    .from('jarvis_alerts')
    .select('kind, ref, snooze_until')
    .eq('event_id', eventId)
  // A row suppresses its anomaly only while snooze_until is in the future. Rows
  // with no snooze_until (pre-migration) or an expired one are allowed to re-fire.
  const snoozed = new Set(
    (existingAlerts ?? [])
      .filter(r => r.snooze_until && String(r.snooze_until) > nowIso)
      .map(r => `${r.kind as string}|${r.ref as string}`)
  )
  const newAnomalies = detected.filter(d => !snoozed.has(`${d.kind}|${d.ref}`))

  if (!newAnomalies.length) {
    return NextResponse.json({ ok: true, new: 0 })
  }

  // ── Upsert alert rows with fresh fired_at + snooze window ──────────────────
  const rows = newAnomalies.map(d => ({
    event_id: eventId,
    kind: d.kind,
    ref: d.ref,
    fired_at: nowIso,
    snooze_until: new Date(Date.now() + snoozeMs(d.kind, d.ref)).toISOString(),
    severity: d.severity,
  }))
  const { error: upErr } = await supabase.from('jarvis_alerts').upsert(rows, { onConflict: 'event_id,kind,ref' })
  if (upErr) {
    console.error('[jarvis/anomaly] upsert alerts failed', upErr)
    // Still send the notification so admins aren't silenced by a bookkeeping error.
  }

  // ── Send one consolidated notification, CRITICAL first ─────────────────────
  newAnomalies.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity])
  let msg = `🚨 ${b('Anomaly Alert')} — ${esc(eventName)} (${newAnomalies.length} new)\n`
  for (const a of newAnomalies) {
    const icon =
      a.severity === 'CRITICAL' ? '🚨' :
      a.kind === 'overdue' ? '⚠️' :
      a.kind === 'capacity' ? '🔴' :
      a.kind === 'stalled_survey' ? '📋' :
      a.kind === 'unpaid_claim' ? '💸' : '❗'
    msg += `\n${icon} ${a.label}`
  }

  await notifyAdmins(msg)

  return NextResponse.json({ ok: true, new: newAnomalies.length, anomalies: newAnomalies.map(a => ({ kind: a.kind, ref: a.ref, severity: a.severity })) })
}
