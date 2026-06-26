import type Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import type { ToolDef, AgentContext } from '../types'
import { resolveEventId, eventLabel, num } from '../util'

// Where an event sits in its A–Z lifecycle + a readiness ledger across the whole
// flow (tickets → survey → team/floor plan → checklist → day-of → pipeline →
// money → Bukku). The single "what's the status / what's left" answer.
const GET_EVENT_LIFECYCLE_SCHEMA: Anthropic.Tool = {
  name: 'get_event_lifecycle',
  description: 'Where an event is in its A–Z lifecycle (draft → selling → imminent → live → wrap → closed) plus a readiness ledger across the whole flow: tickets sold, survey responses, team set, floor plan set, venue set, checklist %, day-of check-ins, pipeline deals, affiliates paid, open claims, Bukku synced. Use for "where is X in the flow", "what\'s left to do for X", "is X ready", "status of X end to end".',
  input_schema: { type: 'object', properties: { event_id: { type: 'string', description: 'Event id. Defaults to active.' } } },
}

function stageOf(daysUntil: number | null): string {
  if (daysUntil == null) return 'draft'
  if (daysUntil > 7) return 'selling'
  if (daysUntil >= 1) return 'imminent'
  if (daysUntil === 0) return 'live'
  if (daysUntil >= -3) return 'wrap'
  return 'closed'
}

async function getEventLifecycle(args: Record<string, unknown>, ctx: AgentContext) {
  const eid = resolveEventId(args.event_id, ctx)
  const [evRes, attRes, surveyRes, checkRes, dealRes, payRes, claimRes] = await Promise.all([
    supabase.from('events').select('date, venue, capacity, team, floor_plan, bukku_income_id').eq('id', eid).maybeSingle(),
    supabase.from('attendees').select('payment_status, attendance_confirmed').eq('event_id', eid),
    supabase.from('pre_event_survey_responses').select('id').eq('event_id', eid),
    supabase.from('checklist_items').select('status').eq('event_id', eid),
    supabase.from('deal_leads').select('status').eq('event_id', eid),
    supabase.from('affiliate_payouts').select('paid_at').eq('event_id', eid),
    supabase.from('claims').select('status').eq('event_id', eid),
  ])
  if (evRes.error) return { error: evRes.error.message }
  const ev = evRes.data
  if (!ev) return { event: eid, found: false }

  const msPerDay = 86400000
  const todayTs = new Date(ctx.today + 'T00:00:00Z').getTime()
  const daysUntil = ev.date ? Math.round((new Date(String(ev.date)).setHours(0, 0, 0, 0) - todayTs) / msPerDay) : null
  const stage = stageOf(daysUntil)

  const att = attRes.data ?? []
  const paid = att.filter(a => a.payment_status === 'paid').length
  const registered = att.length
  const attended = att.filter(a => a.attendance_confirmed).length
  const checklist = checkRes.data ?? []
  const checkDone = checklist.filter(c => c.status === 'done').length
  const team = Array.isArray(ev.team) ? ev.team : []
  const fp = ev.floor_plan as { sections?: unknown[]; days?: unknown[] } | null
  const floorPlanSet = !!fp && ((Array.isArray(fp.sections) && fp.sections.length > 0) || (Array.isArray(fp.days) && fp.days.length > 0))
  const deals = dealRes.data ?? []
  const payouts = payRes.data ?? []
  const openClaims = (claimRes.data ?? []).filter(c => c.status === 'pending' || c.status === 'approved').length

  const readiness = {
    capacity: num(ev.capacity) || null,
    registered,
    tickets_sold: paid,
    survey_responses: (surveyRes.data ?? []).length,
    team_set: team.length > 0,
    floor_plan_set: floorPlanSet,
    venue_set: !!(ev.venue && String(ev.venue).trim()),
    checklist_pct: checklist.length ? Math.round((checkDone / checklist.length) * 100) : 0,
    checklist_items: checklist.length,
    attended: stage === 'wrap' || stage === 'closed' || stage === 'live' ? attended : null,
    pipeline_deals: deals.length,
    pipeline_won: deals.filter(d => d.status === 'won').length,
    affiliates_paid: payouts.filter(p => p.paid_at).length,
    affiliate_payouts: payouts.length,
    open_claims: openClaims,
    bukku_revenue_synced: !!ev.bukku_income_id,
  }

  // Stage-aware "what's left" hints (deterministic, not LLM).
  const next: string[] = []
  if (stage === 'selling' || stage === 'imminent') {
    if (readiness.survey_responses === 0) next.push('Survey: 0 responses — blast the survey link')
    if (!readiness.team_set) next.push('Team not set (Claude Intern tab)')
    if (!readiness.floor_plan_set) next.push('Floor plan not set')
    if (!readiness.venue_set) next.push('Venue not set')
    if (readiness.checklist_items === 0) next.push('Checklist not seeded (Load SOP)')
    else if (readiness.checklist_pct < 80) next.push(`Checklist ${readiness.checklist_pct}% done`)
  }
  if (stage === 'wrap') {
    if (readiness.pipeline_deals === 0) next.push('No pipeline deals captured — log hot leads')
    if (readiness.attended != null && readiness.attended > readiness.pipeline_deals) next.push(`${readiness.attended} attended but only ${readiness.pipeline_deals} in pipeline`)
  }
  if (stage === 'closed') {
    if (readiness.open_claims > 0) next.push(`${readiness.open_claims} open claims to clear`)
    if (readiness.affiliate_payouts > readiness.affiliates_paid) next.push('Affiliate payouts pending')
    if (!readiness.bukku_revenue_synced) next.push('Revenue not synced to Bukku')
  }

  return { event: eventLabel(ctx, eid), stage, days_until: daysUntil, readiness, next_actions: next }
}

export const GET_EVENT_LIFECYCLE_TOOL: ToolDef = { schema: GET_EVENT_LIFECYCLE_SCHEMA, handler: getEventLifecycle }
