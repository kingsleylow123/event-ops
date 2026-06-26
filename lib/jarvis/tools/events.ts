import type Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import type { ToolDef, AgentContext } from '../types'
import { num, round2 } from '../util'

type Totals = { registered: number; paid: number; pending: number; free: number; revenue: number }
function emptyTotals(): Totals { return { registered: 0, paid: 0, pending: 0, free: 0, revenue: 0 } }

async function totalsByEvent(eventIds?: string[]) {
  let sb = supabase.from('attendees').select('event_id,payment_status,payment_amount')
  if (eventIds && eventIds.length) sb = sb.in('event_id', eventIds)
  const { data, error } = await sb
  if (error) throw new Error(error.message)
  const map = new Map<string, Totals>()
  for (const a of data ?? []) {
    const k = a.event_id as string
    const g = map.get(k) ?? emptyTotals()
    g.registered++
    if (a.payment_status === 'paid') { g.paid++; g.revenue += num(a.payment_amount) }
    else if (a.payment_status === 'pending') g.pending++
    else if (a.payment_status === 'free') g.free++
    map.set(k, g)
  }
  return map
}

const LIST_EVENTS_SCHEMA: Anthropic.Tool = {
  name: 'list_events',
  description: 'List all events with registration/paid/revenue totals. Use to find an event id, or to scan headcount/revenue across events. Optional query filters by name/date fragment.',
  input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Optional name/date fragment filter' } } },
}

async function listEvents(args: Record<string, unknown>, ctx: AgentContext) {
  let totals: Map<string, Totals>
  try { totals = await totalsByEvent() } catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
  const q = String(args.query ?? '').trim().toLowerCase()
  let events = ctx.allEvents
  if (q) events = events.filter(e => e.name.toLowerCase().includes(q) || (e.date || '').includes(q))
  return {
    total: events.length,
    events: events.map(e => {
      const t = totals.get(e.id) ?? emptyTotals()
      return { id: e.id, name: e.name, date: e.date, active: e.id === ctx.activeEvent.id, registered: t.registered, paid: t.paid, pending: t.pending, free: t.free, revenue: round2(t.revenue) }
    }),
  }
}

const COMPARE_EVENTS_SCHEMA: Anthropic.Tool = {
  name: 'compare_events',
  description: 'Compare two or more events side by side on registration, paid count, and revenue. Pass the event ids (use list_events to find them).',
  input_schema: {
    type: 'object',
    properties: { event_ids: { type: 'array', items: { type: 'string' }, description: 'Two or more event ids' } },
    required: ['event_ids'],
  },
}

async function compareEvents(args: Record<string, unknown>, ctx: AgentContext) {
  const ids = Array.isArray(args.event_ids) ? args.event_ids.map(String) : []
  if (ids.length < 2) return { error: 'Provide at least two event_ids.' }
  let totals: Map<string, Totals>
  try { totals = await totalsByEvent(ids) } catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
  const names = new Map(ctx.allEvents.map(e => [e.id, e]))
  return {
    events: ids.map(id => {
      const t = totals.get(id) ?? emptyTotals()
      const ev = names.get(id)
      return { id, name: ev?.name ?? id, date: ev?.date ?? null, registered: t.registered, paid: t.paid, revenue: round2(t.revenue), fill_paid_pct: t.registered ? Math.round((t.paid / t.registered) * 100) : 0 }
    }),
  }
}

export const LIST_EVENTS_TOOL: ToolDef = { schema: LIST_EVENTS_SCHEMA, handler: listEvents }
export const COMPARE_EVENTS_TOOL: ToolDef = { schema: COMPARE_EVENTS_SCHEMA, handler: compareEvents }
