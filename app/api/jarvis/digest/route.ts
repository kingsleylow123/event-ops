import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { notifyAdmins, esc, b } from '@/lib/telegram'
import { pickActiveEvent } from '@/lib/event'
import { rm, fmtDate, normPhone } from '@/lib/format'
import { computeDeltas, projectFill, rankDigestActions } from '@/lib/jarvis-trends'
import type { Event } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Daily readiness digest to admins (08:00 MYT = 00:00 UTC).
// Pulls the active event, sends a compact brief covering fill, revenue, survey,
// checklist, payments — plus trend signals (deltas vs yesterday, pace vs the last
// event, projected fill) and a single "TODAY" action. All deterministic SQL/math,
// no LLM. Writes a daily metric snapshot so tomorrow's digest has a baseline.
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
  // Local 4-day grace (slightly wider than the global 3-day EVENT_GRACE_MS) so the
  // T+3 post-event branch survives the Hobby cron's ±1h drift. The daysUntil<-3
  // guard below bounds it so we never send for a long-dead event.
  const DIGEST_GRACE_MS = 4 * 86400000
  if (!ev.date || Date.now() - new Date(ev.date as string).getTime() > DIGEST_GRACE_MS) {
    return NextResponse.json({ ok: true, skipped: 'active event >4d past' })
  }

  const eventId = ev.id as string
  const eventName = ev.name as string
  const eventDate = ev.date as string
  const capacity = Number(ev.capacity ?? 0)

  // ── Time math ──────────────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10)
  const todayTs = new Date().setHours(0, 0, 0, 0)
  const eventTs = new Date(eventDate).setHours(0, 0, 0, 0)
  const msPerDay = 86400000
  // daysUntil: positive = future, 0 = today, negative = past
  const daysUntil = Math.round((eventTs - todayTs) / msPerDay)
  // Bound the extra grace day: never send for events more than 3 days past.
  if (daysUntil < -3) {
    return NextResponse.json({ ok: true, skipped: 'post-event window closed' })
  }

  // ── Load attendees, checklist, survey in parallel ─────────────────────────
  const agedCutoff = new Date(Date.now() - 48 * 3600_000).toISOString()
  const [attRes, checkRes, surveyRes, prepRes, agedLeadsRes, claimsRes, dealsRes] = await Promise.all([
    supabase.from('attendees').select('name, phone, payment_status, payment_amount, attendance_confirmed').eq('event_id', eventId),
    supabase.from('checklist_items').select('item, category, due_date, status').eq('event_id', eventId),
    supabase.from('pre_event_survey_responses').select('id, phone').eq('event_id', eventId),
    supabase.from('prep_progress').select('phone_norm, name, completed').eq('event_id', eventId),
    // Deal leads stuck in 'new' for >48h — across ALL events (deals outlive events).
    supabase.from('deal_leads').select('client_name, client_phone, needs, rep_name, created_at').eq('status', 'new').lt('created_at', agedCutoff),
    supabase.from('claims').select('amount, status, submitted_at').eq('event_id', eventId),
    // This event's pipeline by stage — for momentum deltas + the snapshot.
    supabase.from('deal_leads').select('status').eq('event_id', eventId),
  ])

  if (attRes.error) return NextResponse.json({ ok: false, error: attRes.error.message }, { status: 500 })

  const attendees = attRes.data ?? []
  const checklist = checkRes.data ?? []
  const surveyCount = (surveyRes.data ?? []).length
  const prepRows = prepRes.data ?? []
  const agedLeads = agedLeadsRes.data ?? []
  // Open claims = submitted but not yet paid/rejected.
  const openClaims = (claimsRes.data ?? []).filter(c => c.status === 'pending' || c.status === 'approved')
  const dealRows = dealsRes.data ?? []
  const dealsNew = dealRows.filter(d => d.status === 'new').length
  const dealsContacted = dealRows.filter(d => d.status === 'contacted').length
  const dealsMeeting = dealRows.filter(d => d.status === 'meeting').length
  const dealsWon = dealRows.filter(d => d.status === 'won').length

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

  // Payment-pending call-to-action
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

  // ── Ops leak-killers: who needs chasing, by name ──────────────────────────
  const eligible = attendees.filter(a => a.payment_status === 'paid' || a.payment_status === 'free')

  if (daysUntil >= 0 && daysUntil <= 3 && eligible.length) {
    const prepByPhone = new Map(prepRows.map(p => [p.phone_norm as string, p]))
    const laggards = eligible
      .map(a => {
        const p = prepByPhone.get(normPhone(a.phone as string))
        if (p?.completed) return null
        return { name: (a.name as string) || (a.phone as string) || '?', started: !!p }
      })
      .filter((x): x is { name: string; started: boolean } => x !== null)
    if (laggards.length) {
      msg += `\n\n🎓 ${b(`Prep laggards (${laggards.length})`)} — nudge them:\n`
      msg += laggards.slice(0, 12).map(l => `  • ${esc(l.name)}${l.started ? ' <i>(started)</i>' : ' <i>(not started)</i>'}`).join('\n')
      if (laggards.length > 12) msg += `\n  <i>… and ${laggards.length - 12} more</i>`
    } else {
      msg += `\n\n🎓 Everyone is workshop-ready ✅`
    }

    const surveyNorms = new Set((surveyRes.data ?? []).map(s => normPhone(s.phone as string)).filter(Boolean))
    const noSurvey = eligible.filter(a => {
      const n = normPhone(a.phone as string)
      return n && !surveyNorms.has(n)
    })
    if (noSurvey.length) {
      msg += `\n\n📋 ${b(`No survey yet (${noSurvey.length})`)}:\n`
      msg += noSurvey.slice(0, 10).map(a => `  • ${esc((a.name as string) || (a.phone as string))}`).join('\n')
      if (noSurvey.length > 10) msg += `\n  <i>… and ${noSurvey.length - 10} more</i>`
    }
  }

  // No-shows — for 3 days after the event: paid people who never checked in.
  if (daysUntil < 0 && daysUntil >= -3) {
    const noShows = attendees.filter(a => a.payment_status === 'paid' && !a.attendance_confirmed)
    if (noShows.length) {
      msg += `\n\n👻 ${b(`No-shows (${noShows.length})`)} — re-engage or offer next date:\n`
      msg += noShows.slice(0, 10).map(a => `  • ${esc((a.name as string) || '?')}${a.phone ? ` · ${esc(a.phone as string)}` : ''}`).join('\n')
      if (noShows.length > 10) msg += `\n  <i>… and ${noShows.length - 10} more</i>`
    }
  }

  // Aged deal leads — stuck in 'new' >48h (all events). Money going cold.
  if (agedLeads.length) {
    msg += `\n\n🔥 ${b(`Deal leads going cold (${agedLeads.length})`)} — still 'new' after 48h:\n`
    msg += agedLeads.slice(0, 8).map(l => {
      const days = Math.floor((Date.now() - new Date(l.created_at as string).getTime()) / 86400000)
      return `  • ${esc(l.client_name as string)} · ${esc((l.client_phone as string) || '')} <i>(${days}d, by ${esc(l.rep_name as string)})</i>`
    }).join('\n')
    if (agedLeads.length > 8) msg += `\n  <i>… and ${agedLeads.length - 8} more</i>`
    msg += `\n  → /pipeline to work them`
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

  // ── Trend signals (memory + math — deterministic, no LLM) ─────────────────
  const todaySnap = {
    registered, paid_count: paid.length, free_count: free.length,
    gross_revenue: grossRevenue, survey_count: surveyCount,
    deals_new: dealsNew, deals_contacted: dealsContacted, deals_meeting: dealsMeeting, deals_won: dealsWon,
  }
  const yDate = new Date(todayTs - msPerDay).toISOString().slice(0, 10)
  const wDate = new Date(todayTs - 7 * msPerDay).toISOString().slice(0, 10)
  const [ySnapRes, wSnapRes, priorEvRes] = await Promise.all([
    supabase.from('jarvis_daily_snapshots').select('*').eq('event_id', eventId).eq('snapshot_date', yDate).maybeSingle(),
    supabase.from('jarvis_daily_snapshots').select('paid_count').eq('event_id', eventId).eq('snapshot_date', wDate).maybeSingle(),
    supabase.from('events').select('id, name, date').lt('date', eventDate).order('date', { ascending: false }).limit(1).maybeSingle(),
  ])

  const trendLines: string[] = []
  let paceBehindPct: number | null = null
  let postEventGap = 0

  // 📈 Delta since yesterday
  const prevSnap = ySnapRes.data
    ? {
        registered: Number(ySnapRes.data.registered ?? 0),
        paid_count: Number(ySnapRes.data.paid_count ?? 0),
        free_count: Number(ySnapRes.data.free_count ?? 0),
        gross_revenue: Number(ySnapRes.data.gross_revenue ?? 0),
        survey_count: Number(ySnapRes.data.survey_count ?? 0),
        deals_new: Number(ySnapRes.data.deals_new ?? 0),
        deals_contacted: Number(ySnapRes.data.deals_contacted ?? 0),
        deals_meeting: Number(ySnapRes.data.deals_meeting ?? 0),
        deals_won: Number(ySnapRes.data.deals_won ?? 0),
      }
    : null
  const deltas = computeDeltas(todaySnap, prevSnap)
  if (deltas) {
    const bits: string[] = []
    if (deltas.paid) bits.push(`${deltas.paid > 0 ? '+' : ''}${deltas.paid} paid`)
    if (deltas.revenue) bits.push(`${deltas.revenue > 0 ? '+' : '−'}${esc(rm(Math.abs(deltas.revenue)))}`)
    if (deltas.survey) bits.push(`${deltas.survey > 0 ? '+' : ''}${deltas.survey} survey`)
    if (deltas.deals_meeting) bits.push(`${deltas.deals_meeting > 0 ? '+' : ''}${deltas.deals_meeting} mtg`)
    if (deltas.deals_won) bits.push(`${deltas.deals_won > 0 ? '+' : ''}${deltas.deals_won} won`)
    if (bits.length) trendLines.push(`📈 Since yesterday: ${bits.join(' · ')}`)
  }

  // 📊 Pace vs the last event at the same T-minus (directional — "vs last event")
  if (priorEvRes.data && daysUntil >= 3 && daysUntil <= 21) {
    const pe = priorEvRes.data
    const peTs = new Date(pe.date as string).setHours(0, 0, 0, 0)
    const peCutoff = new Date(peTs - daysUntil * msPerDay).toISOString()
    const { count: priorPaid } = await supabase
      .from('attendees').select('id', { count: 'exact', head: true })
      .eq('event_id', pe.id as string).eq('payment_status', 'paid').lte('created_at', peCutoff)
    if (priorPaid != null && priorPaid > 0) {
      const diffPct = Math.round(((paid.length - priorPaid) / priorPaid) * 100)
      if (diffPct < 0) paceBehindPct = -diffPct
      trendLines.push(`📊 Pace: ${paid.length} paid at T-${daysUntil} vs ${priorPaid} same point last event (${diffPct >= 0 ? '+' : ''}${diffPct}%)`)
    }
  }

  // 🔮 Projected fill (7-day window; guards rate<=0 → "stalled", never a neg ETA)
  const proj = projectFill(paid.length, wSnapRes.data ? Number(wSnapRes.data.paid_count) : null, 7, capacity, daysUntil)
  if (proj) {
    if (proj.stalled) {
      trendLines.push(`🔮 Pace stalled (${proj.ratePerDay}/day) — ${proj.spotsLeft} seat${proj.spotsLeft !== 1 ? 's' : ''} still open`)
    } else if (proj.daysToFull != null && proj.daysToFull < daysUntil) {
      const eta = new Date(todayTs + proj.daysToFull * msPerDay)
      trendLines.push(`🔮 At ${proj.ratePerDay}/day: sells out in ~${proj.daysToFull}d (${esc(fmtDate(eta.toISOString()))})`)
    } else {
      const projected = Math.min(capacity, paid.length + Math.round(proj.ratePerDay * daysUntil))
      trendLines.push(`🔮 At ${proj.ratePerDay}/day: ~${projected}/${capacity} seats by event day`)
    }
  }

  // 🎯 T+3 post-event pipeline gap (attended + paid but not in the pipeline)
  if (daysUntil === -3) {
    const { data: dlRows } = await supabase.from('deal_leads').select('client_phone').eq('event_id', eventId)
    const inPipeline = new Set((dlRows ?? []).map(d => normPhone(d.client_phone as string)).filter(Boolean))
    const gap = attendees.filter(a => a.payment_status === 'paid' && a.attendance_confirmed && !inPipeline.has(normPhone(a.phone as string)))
    postEventGap = gap.length
    if (gap.length) {
      const { data: seenGap } = await supabase.from('jarvis_alerts').select('id')
        .eq('event_id', eventId).eq('kind', 'post_event_gap').eq('ref', 't3').maybeSingle()
      if (!seenGap) {
        trendLines.push(`🎯 ${b('T+3 pipeline gap')}: ${gap.length} attended + paid but NOT in pipeline — follow up now, window closing`)
        await supabase.from('jarvis_alerts').insert({ event_id: eventId, kind: 'post_event_gap', ref: 't3', fired_at: new Date().toISOString(), severity: 'WARN' })
      }
    }
  }

  if (trendLines.length) {
    msg += `\n`
    for (const l of trendLines) msg += `\n${l}`
  }

  // ⚡ TODAY — the single highest-impact action (money-in-hand weighted)
  const pendingRevenue = pending.reduce((s, a) => s + Number(a.payment_amount ?? 0), 0)
  const todayAction = rankDigestActions({
    pendingCount: pending.length,
    pendingRevenue,
    postEventGap,
    paceBehindPct,
    agedLeads: agedLeads.length,
    openClaims: openClaims.length,
    daysUntil,
  })
  if (todayAction) msg += `\n\n⚡ ${b('TODAY')}: ${esc(todayAction)}`

  await notifyAdmins(msg)

  // Memory: store today's snapshot AFTER the send (a DB hiccup can't block the digest).
  await supabase.from('jarvis_daily_snapshots').upsert({
    event_id: eventId, snapshot_date: today,
    registered, paid_count: paid.length, free_count: free.length,
    gross_revenue: grossRevenue, survey_count: surveyCount,
    deals_new: dealsNew, deals_contacted: dealsContacted, deals_meeting: dealsMeeting, deals_won: dealsWon,
  }, { onConflict: 'event_id,snapshot_date' })

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
    agedDealLeads: agedLeads.length,
    trendLines: trendLines.length,
  })
}
