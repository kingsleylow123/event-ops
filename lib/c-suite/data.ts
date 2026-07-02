// AI C-Suite — department data readers. Each head reads its OWN slice of the
// business from Supabase (the source of truth for workshop context). Everything is
// defensive: a missing table/column returns a soft "partial" note rather than
// crashing the board, so the C-Suite still convenes as integrations come online.

import { supabaseAdmin as supabase, fetchAllRows } from '@/lib/supabase-admin'
import { computeDeltas, projectFill, type Snapshot } from '@/lib/jarvis-trends'

function n(v: unknown): number {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}
function tally<T>(rows: T[], key: (r: T) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) {
    const k = (key(r) || 'unknown').toString()
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}
// RM sums (not line-item counts) per category — executives think in money.
function sumBy<T>(rows: T[], key: (r: T) => string | null | undefined, amount: (r: T) => number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) {
    const k = (key(r) || 'unknown').toString()
    out[k] = Math.round(((out[k] ?? 0) + amount(r)) * 100) / 100
  }
  return out
}
const DAY = 86_400_000
const daysAgo = (iso: string | null | undefined): number | null =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY) : null

export interface DeptData {
  summary: Record<string, unknown>
  status: string // 'ok' | 'partial: <what is missing>'
}

export interface ActiveEvent {
  id: string
  name: string
  date: string | null
  capacity: number | null
  current_phase: string | null
}

export async function getActiveEvent(): Promise<ActiveEvent | null> {
  const { data } = await supabase
    .from('events')
    .select('id, name, date, capacity, is_active, current_phase')
    .order('is_active', { ascending: false })
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  const e = data as { id: string; name: string; date: string | null; capacity: number | null; current_phase: string | null }
  return { id: e.id, name: e.name, date: e.date, capacity: e.capacity, current_phase: e.current_phase }
}

// ── Head of Sales ─ deal_leads (BoFu pipeline) + meetings ─────────────────────
const WON = new Set(['won', 'completed', 'closed'])

export async function salesData(): Promise<DeptData> {
  try {
    const notes: string[] = []
    // Paginate: deal_leads is a grow-forever table; a bare select() silently caps at 1000 rows.
    const [{ rows: leads, error }, meet] = await Promise.all([
      fetchAllRows<Record<string, unknown>>((from, to) =>
        supabase.from('deal_leads').select('status, updated_at, created_at, call_scheduled_at, source, client_name').range(from, to)),
      supabase.from('meetings').select('meeting_date').gt('meeting_date', new Date().toISOString()),
    ])
    if (error) return { summary: {}, status: `partial: deal_leads unreadable (${error})` }
    if (meet.error) notes.push(`meetings: ${meet.error.message}`)
    const now = Date.now()
    const byStatus = tally(leads, l => (l as { status: string }).status)
    const isStale = (l: Record<string, unknown>) => {
      const s = l.status as string
      const u = l.updated_at as string | null
      return (s === 'new' || s === 'qualified') && u != null && now - new Date(u).getTime() > 7 * DAY
    }
    const staleLeads = leads.filter(isStale)
    // Named entities → actionable rulings ("chase Adam, 9d stale"), not just counts.
    const staleNamed = staleLeads
      .map(l => ({ name: String(l.client_name ?? 'unknown'), days_stale: daysAgo(l.updated_at as string) ?? 0, status: String(l.status) }))
      .sort((a, b) => b.days_stale - a.days_stale)
      .slice(0, 5)
    const booked = leads.filter(l => {
      const c = (l as { call_scheduled_at: string | null }).call_scheduled_at
      return c != null && new Date(c).getTime() > now
    }).length
    return {
      summary: {
        total_leads: leads.length,
        by_status: byStatus,
        stale_over_7d: staleLeads.length,
        stale_named_top5: staleNamed,
        calls_booked_upcoming: booked,
        // Absent, not zero, when the read failed — a fabricated 0 would poison
        // delta lines and grade predictions 'wrong' on a transient error.
        ...(meet.error ? {} : { upcoming_meetings: (meet.data ?? []).length }),
        by_source: tally(leads, l => (l as { source: string | null }).source),
      },
      status: notes.length ? `partial: ${notes.join('; ')}` : 'ok',
    }
  } catch (e) {
    return { summary: {}, status: `partial: sales read failed (${e instanceof Error ? e.message : String(e)})` }
  }
}

// ── Head of Ops ─ attendees + prep + checklist for the active event ───────────
export async function opsData(ev: ActiveEvent | null): Promise<DeptData> {
  if (!ev) return { summary: {}, status: 'partial: no active event' }
  try {
    const notes: string[] = []
    const [att, prep, chk] = await Promise.all([
      supabase.from('attendees').select('payment_status, day1_attended, day2_attended, attendance_confirmed').eq('event_id', ev.id),
      supabase.from('prep_progress').select('completed').eq('event_id', ev.id),
      supabase.from('checklist_items').select('status, due_date').eq('event_id', ev.id),
    ])
    if (att.error) notes.push(`attendees: ${att.error.message}`)
    if (prep.error) notes.push(`prep_progress: ${prep.error.message}`)
    if (chk.error) notes.push(`checklist: ${chk.error.message}`)
    const attendees = att.data ?? []
    const paid = attendees.filter(a => (a as { payment_status: string }).payment_status === 'paid').length
    const checkedIn = attendees.filter(a => (a as { day1_attended: boolean | null }).day1_attended === true).length
    const prepRows = prep.data ?? []
    const checklist = chk.data ?? []
    const now = Date.now()
    const overdue = checklist.filter(c => {
      const s = (c as { status: string }).status
      const d = (c as { due_date: string | null }).due_date
      return s !== 'done' && d != null && new Date(d).getTime() < now
    }).length
    return {
      summary: {
        event: ev.name,
        phase: ev.current_phase,
        capacity: ev.capacity,
        // Each block is absent (not zero) when its read failed — fabricated
        // zeroes corrupt delta lines and outcome grading.
        ...(att.error ? {} : {
          registered: attendees.length,
          paid,
          fill_pct: ev.capacity ? Math.round((attendees.length / ev.capacity) * 100) : null,
          checked_in_day1: checkedIn,
        }),
        ...(prep.error ? {} : {
          prep_started: prepRows.length,
          prep_completed: prepRows.filter(p => (p as { completed: boolean }).completed).length,
        }),
        ...(chk.error ? {} : {
          checklist_open: checklist.filter(c => (c as { status: string }).status !== 'done').length,
          checklist_overdue: overdue,
        }),
      },
      status: notes.length ? `partial: ${notes.join('; ')}` : 'ok',
    }
  } catch (e) {
    return { summary: {}, status: `partial: ops read failed (${e instanceof Error ? e.message : String(e)})` }
  }
}

// ── Head of Finance ─ revenue (attendees) + expenses + ledger ─────────────────
export async function financeData(ev: ActiveEvent | null): Promise<DeptData> {
  try {
    const notes: string[] = []
    // Paginate: attendees + expenses accumulate across all events and would silently cap at 1000.
    const [att, exp] = await Promise.all([
      fetchAllRows<Record<string, unknown>>((from, to) => supabase.from('attendees').select('name, payment_status, payment_amount, event_id, created_at').range(from, to)),
      fetchAllRows<Record<string, unknown>>((from, to) => supabase.from('expenses').select('amount, category, event_id').range(from, to)),
    ])
    if (att.error) notes.push(`attendees: ${att.error}`)
    if (exp.error) notes.push(`expenses: ${exp.error}`)
    const attendees = att.rows
    const expenses = exp.rows
    const revenueAll = attendees.filter(a => (a as { payment_status: string }).payment_status === 'paid')
      .reduce((s, a) => s + n((a as { payment_amount: unknown }).payment_amount), 0)
    const unpaid = attendees.filter(a => (a as { payment_status: string }).payment_status === 'pending')
    // Named receivables with aging → a chase list, not a scary number.
    const unpaidNamed = unpaid
      .map(a => ({ name: String(a.name ?? 'unknown'), rm: Math.round(n(a.payment_amount)), days_pending: daysAgo(a.created_at as string) ?? 0 }))
      .sort((a, b) => b.rm - a.rm)
      .slice(0, 10)
    const expenseAll = expenses.reduce((s, e) => s + n((e as { amount: unknown }).amount), 0)
    const revenueEvent = ev
      ? attendees.filter(a => (a as { event_id: string; payment_status: string }).event_id === ev.id && (a as { payment_status: string }).payment_status === 'paid')
          .reduce((s, a) => s + n((a as { payment_amount: unknown }).payment_amount), 0)
      : null
    const expenseEvent = ev
      ? expenses.filter(e => (e as { event_id: string }).event_id === ev.id).reduce((s, e) => s + n((e as { amount: unknown }).amount), 0)
      : null
    // fetchAllRows can error MID-pagination and hand back partial rows — money
    // computed from partial rows is a lie, so each side's keys are omitted
    // entirely when its read failed (absent → grading says 'inconclusive').
    return {
      summary: {
        active_event: ev?.name ?? null,
        ...(att.error ? {} : {
          revenue_paid_all_events: Math.round(revenueAll),
          revenue_active_event: revenueEvent != null ? Math.round(revenueEvent) : null,
          unpaid_pending_attendees: unpaid.length,
          unpaid_named_top10: unpaidNamed,
        }),
        ...(exp.error ? {} : {
          expenses_all_events: Math.round(expenseAll),
          expenses_active_event: expenseEvent != null ? Math.round(expenseEvent) : null,
          expenses_rm_by_category: sumBy(expenses, e => (e as { category: string | null }).category, e => n((e as { amount: unknown }).amount)),
        }),
        ...(att.error || exp.error ? {} : {
          net_all_events: Math.round(revenueAll - expenseAll),
          margin_active_event: revenueEvent != null && expenseEvent != null ? Math.round(revenueEvent - expenseEvent) : null,
        }),
      },
      status: notes.length ? `partial: ${notes.join('; ')}` : 'ok',
    }
  } catch (e) {
    return { summary: {}, status: `partial: finance read failed (${e instanceof Error ? e.message : String(e)})` }
  }
}

// ── Head of Marketing ─ survey demand signals + lead sources (+ ads if wired) ──
export async function marketingData(ev: ActiveEvent | null): Promise<DeptData> {
  try {
    const notes: string[] = []
    const [survey, leadRows] = await Promise.all([
      ev ? supabase.from('pre_event_survey_responses').select('industry, company_size, biggest_challenge').eq('event_id', ev.id)
         : supabase.from('pre_event_survey_responses').select('industry, company_size, biggest_challenge'),
      fetchAllRows<Record<string, unknown>>((from, to) => supabase.from('deal_leads').select('source, status').range(from, to)),
    ])
    if (survey.error) notes.push(`survey: ${survey.error.message}`)
    if (leadRows.error) notes.push(`deal_leads: ${leadRows.error}`)
    const responses = survey.data ?? []
    // Which channel produces leads that actually CLOSE, not just leads.
    const bySource = tally(leadRows.rows, l => (l as { source: string | null }).source)
    const wonBySource = tally(
      leadRows.rows.filter(l => WON.has(String((l as { status: string | null }).status ?? ''))),
      l => (l as { source: string | null }).source,
    )
    const conversionBySource: Record<string, string> = {}
    for (const src of Object.keys(bySource)) {
      conversionBySource[src] = `${wonBySource[src] ?? 0}/${bySource[src]} won`
    }

    // Meta ads insights are optional — only if the ads-council Meta creds are set.
    let ads: Record<string, unknown> | null = null
    if (process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID) {
      try {
        const { getAdsConfig } = await import('@/lib/ads-council/config')
        const { getActiveAdInsights } = await import('@/lib/ads-council/meta-api')
        const insights = await getActiveAdInsights(getAdsConfig())
        const spend = insights.reduce((s, e) => s + n(e.current.spend), 0)
        const dms = insights.reduce((s, e) => s + n(e.current.results), 0)
        ads = { active_ads: insights.length, spend_7d: Math.round(spend), dms_7d: dms, cost_per_dm: dms ? Math.round((spend / dms) * 100) / 100 : null }
      } catch (e) {
        notes.push(`ads: ${e instanceof Error ? e.message : String(e)}`)
      }
    } else {
      notes.push('ads: Meta creds not configured')
    }

    return {
      summary: {
        active_event: ev?.name ?? null,
        ...(survey.error ? {} : {
          survey_responses: responses.length,
          industry_mix: tally(responses, r => (r as { industry: string | null }).industry),
          company_size_mix: tally(responses, r => (r as { company_size: string | null }).company_size),
        }),
        ...(leadRows.error ? {} : {
          lead_sources: bySource,
          conversion_by_source: conversionBySource,
        }),
        ads,
      },
      status: notes.length ? `partial: ${notes.join('; ')}` : 'ok',
    }
  } catch (e) {
    return { summary: {}, status: `partial: marketing read failed (${e instanceof Error ? e.message : String(e)})` }
  }
}

// ── Trends ─ jarvis_daily_snapshots → deltas + fill projection ────────────────
// Snapshots without trends read like status reports; executives need direction.
// Reuses the unit-tested math from lib/jarvis-trends.ts (Jarvis digest).
export interface TrendBlock {
  since: string | null                 // date of the compared snapshot
  window_days: number                  // actual span of the comparison (honest label)
  deltas: Record<string, number> | null
  fill: { rate_per_day: number; spots_left: number; days_to_full: number | null; stalled: boolean } | null
}

export async function getTrends(ev: ActiveEvent | null): Promise<TrendBlock | null> {
  if (!ev) return null
  try {
    // Bounded to a real week: cron gaps must not stretch "prior week" into a
    // month, and a stale newest-snapshot (>2 days old) is worse than no trend.
    const eightDaysAgo = new Date(Date.now() - 8 * DAY).toISOString().slice(0, 10)
    const { data } = await supabase
      .from('jarvis_daily_snapshots')
      .select('snapshot_date, registered, paid_count, free_count, gross_revenue, survey_count, deals_new, deals_contacted, deals_meeting, deals_won')
      .eq('event_id', ev.id)
      .gte('snapshot_date', eightDaysAgo)
      .order('snapshot_date', { ascending: false })
      .limit(8)
    const rows = (data ?? []) as Array<Snapshot & { snapshot_date: string }>
    if (rows.length < 2) return null
    const today = rows[0]
    if (Date.now() - new Date(today.snapshot_date).getTime() > 2 * DAY) return null
    const weekAgo = rows[rows.length - 1] // oldest in the bounded window
    const deltas = computeDeltas(today, weekAgo)
    const windowDays = Math.max(1, Math.round((new Date(today.snapshot_date).getTime() - new Date(weekAgo.snapshot_date).getTime()) / DAY))
    const daysUntil = ev.date ? Math.round((new Date(ev.date).getTime() - Date.now()) / DAY) : 0
    const fillRaw = ev.capacity ? projectFill(today.paid_count, weekAgo.paid_count, windowDays, ev.capacity, daysUntil) : null
    return {
      since: weekAgo.snapshot_date,
      window_days: windowDays,
      deltas: deltas as unknown as Record<string, number> | null,
      fill: fillRaw ? { rate_per_day: fillRaw.ratePerDay, spots_left: fillRaw.spotsLeft, days_to_full: fillRaw.daysToFull, stalled: fillRaw.stalled } : null,
    }
  } catch (e) {
    console.error('[c-suite] getTrends', e)
    return null
  }
}
