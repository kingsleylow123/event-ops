import type Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import type { ToolDef, AgentContext } from '../types'
import { resolveEventId, eventLabel } from '../util'

// Reads the daily metric snapshots the digest cron writes, so the reactive agent
// can answer "show me the fill/revenue/pipeline trend" with a real time-series.
const GET_TREND_SCHEMA: Anthropic.Tool = {
  name: 'get_trend',
  description:
    'Get the day-by-day metric trend for an event from daily snapshots: registered, paid, revenue, survey count, and pipeline stages over time — plus the net change across the window. Use for "show me the fill trend", "is signup pace accelerating", "how is revenue trending", "pipeline momentum". Defaults to the active event.',
  input_schema: {
    type: 'object',
    properties: {
      event_id: { type: 'string', description: 'Event id. Defaults to the active event.' },
      days: { type: 'integer', description: 'How many recent days of snapshots to return (default 14, max 60).' },
    },
  },
}

async function getTrend(args: Record<string, unknown>, ctx: AgentContext) {
  const eid = resolveEventId(args.event_id, ctx)
  const days = Math.max(2, Math.min(60, Number(args.days ?? 14) || 14))
  const { data, error } = await supabase
    .from('jarvis_daily_snapshots')
    .select('snapshot_date, registered, paid_count, free_count, gross_revenue, survey_count, deals_new, deals_contacted, deals_meeting, deals_won')
    .eq('event_id', eid)
    .order('snapshot_date', { ascending: false })
    .limit(days)
  if (error) return { error: error.message }
  const rows = (data ?? []).reverse() // chronological
  if (!rows.length) {
    return { event: eventLabel(ctx, eid), days: 0, message: 'No snapshots yet — the daily digest writes one per day, so trends appear once it has run at least twice.' }
  }
  const first = rows[0]
  const last = rows[rows.length - 1]
  return {
    event: eventLabel(ctx, eid),
    days: rows.length,
    from: first.snapshot_date,
    to: last.snapshot_date,
    change_over_window: {
      paid: Number(last.paid_count) - Number(first.paid_count),
      revenue: Math.round((Number(last.gross_revenue) - Number(first.gross_revenue)) * 100) / 100,
      registered: Number(last.registered) - Number(first.registered),
      survey: Number(last.survey_count) - Number(first.survey_count),
      deals_won: Number(last.deals_won) - Number(first.deals_won),
    },
    series: rows.map(r => ({
      date: r.snapshot_date,
      registered: r.registered,
      paid: r.paid_count,
      revenue: Number(r.gross_revenue),
      survey: r.survey_count,
      pipeline: { new: r.deals_new, contacted: r.deals_contacted, meeting: r.deals_meeting, won: r.deals_won },
    })),
  }
}

export const GET_TREND_TOOL: ToolDef = { schema: GET_TREND_SCHEMA, handler: getTrend }
