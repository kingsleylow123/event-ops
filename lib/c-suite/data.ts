// AI C-Suite — department data readers. Each head reads its OWN slice of the
// business from Supabase (the source of truth for workshop context). Everything is
// defensive: a missing table/column returns a soft "partial" note rather than
// crashing the board, so the C-Suite still convenes as integrations come online.

import { supabaseAdmin as supabase, fetchAllRows } from '@/lib/supabase-admin'

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
const DAY = 86_400_000

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
export async function salesData(): Promise<DeptData> {
  try {
    // Paginate: deal_leads is a grow-forever table; a bare select() silently caps at 1000 rows.
    const { rows: leads, error } = await fetchAllRows<Record<string, unknown>>((from, to) =>
      supabase.from('deal_leads').select('status, updated_at, created_at, call_scheduled_at, source, client_name').range(from, to))
    if (error) return { summary: {}, status: `partial: deal_leads unreadable (${error})` }
    const now = Date.now()
    const byStatus = tally(leads, l => (l as { status: string }).status)
    const stale = leads.filter(l => {
      const s = (l as { status: string }).status
      const u = (l as { updated_at: string | null }).updated_at
      return (s === 'new' || s === 'qualified') && u != null && now - new Date(u).getTime() > 7 * DAY
    }).length
    const booked = leads.filter(l => {
      const c = (l as { call_scheduled_at: string | null }).call_scheduled_at
      return c != null && new Date(c).getTime() > now
    }).length
    return {
      summary: {
        total_leads: leads.length,
        by_status: byStatus,
        stale_over_7d: stale,
        calls_booked_upcoming: booked,
        by_source: tally(leads, l => (l as { source: string | null }).source),
      },
      status: 'ok',
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
        registered: attendees.length,
        paid,
        fill_pct: ev.capacity ? Math.round((attendees.length / ev.capacity) * 100) : null,
        checked_in_day1: checkedIn,
        prep_started: prepRows.length,
        prep_completed: prepRows.filter(p => (p as { completed: boolean }).completed).length,
        checklist_open: checklist.filter(c => (c as { status: string }).status !== 'done').length,
        checklist_overdue: overdue,
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
      fetchAllRows<Record<string, unknown>>((from, to) => supabase.from('attendees').select('payment_status, payment_amount, event_id').range(from, to)),
      fetchAllRows<Record<string, unknown>>((from, to) => supabase.from('expenses').select('amount, category, event_id').range(from, to)),
    ])
    if (att.error) notes.push(`attendees: ${att.error}`)
    if (exp.error) notes.push(`expenses: ${exp.error}`)
    const attendees = att.rows
    const expenses = exp.rows
    const revenueAll = attendees.filter(a => (a as { payment_status: string }).payment_status === 'paid')
      .reduce((s, a) => s + n((a as { payment_amount: unknown }).payment_amount), 0)
    const unpaidCount = attendees.filter(a => (a as { payment_status: string }).payment_status === 'pending').length
    const expenseAll = expenses.reduce((s, e) => s + n((e as { amount: unknown }).amount), 0)
    const revenueEvent = ev
      ? attendees.filter(a => (a as { event_id: string; payment_status: string }).event_id === ev.id && (a as { payment_status: string }).payment_status === 'paid')
          .reduce((s, a) => s + n((a as { payment_amount: unknown }).payment_amount), 0)
      : null
    const expenseEvent = ev
      ? expenses.filter(e => (e as { event_id: string }).event_id === ev.id).reduce((s, e) => s + n((e as { amount: unknown }).amount), 0)
      : null
    return {
      summary: {
        revenue_paid_all_events: Math.round(revenueAll),
        expenses_all_events: Math.round(expenseAll),
        net_all_events: Math.round(revenueAll - expenseAll),
        active_event: ev?.name ?? null,
        revenue_active_event: revenueEvent != null ? Math.round(revenueEvent) : null,
        expenses_active_event: expenseEvent != null ? Math.round(expenseEvent) : null,
        margin_active_event: revenueEvent != null && expenseEvent != null ? Math.round(revenueEvent - expenseEvent) : null,
        unpaid_pending_attendees: unpaidCount,
        expenses_by_category: tally(expenses, e => (e as { category: string | null }).category),
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
      fetchAllRows<Record<string, unknown>>((from, to) => supabase.from('deal_leads').select('source').range(from, to)),
    ])
    if (survey.error) notes.push(`survey: ${survey.error.message}`)
    if (leadRows.error) notes.push(`deal_leads: ${leadRows.error}`)
    const responses = survey.data ?? []

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
        survey_responses: responses.length,
        industry_mix: tally(responses, r => (r as { industry: string | null }).industry),
        company_size_mix: tally(responses, r => (r as { company_size: string | null }).company_size),
        lead_sources: tally(leadRows.rows, l => (l as { source: string | null }).source),
        ads,
      },
      status: notes.length ? `partial: ${notes.join('; ')}` : 'ok',
    }
  } catch (e) {
    return { summary: {}, status: `partial: marketing read failed (${e instanceof Error ? e.message : String(e)})` }
  }
}
