import type Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import type { ToolDef, AgentContext } from '../types'
import { resolveEventId, eventLabel } from '../util'

const GET_MEETINGS_SCHEMA: Anthropic.Tool = {
  name: 'get_meetings',
  description: 'Get booked meetings / implementation calls (post-workshop sales/BoFu calls) for an event: title, date, category, and attendance count. Use for "how many meetings booked", "meeting log", "who attended the calls".',
  input_schema: {
    type: 'object',
    properties: { event_id: { type: 'string', description: 'Event id, or "all" for every event. Defaults to active.' } },
  },
}

async function getMeetings(args: Record<string, unknown>, ctx: AgentContext) {
  const arg = String(args.event_id ?? '')
  const all = arg.toLowerCase() === 'all'
  const eid = all ? null : resolveEventId(args.event_id, ctx)

  let qb = supabase
    .from('meetings')
    .select('title,meeting_date,meeting_category,notes,attendance,event_id')
    .order('meeting_date', { ascending: false })
    .limit(100)
  if (eid) qb = qb.eq('event_id', eid)
  const { data, error } = await qb
  if (error) return { error: error.message }
  const rows = data ?? []

  return {
    event: all ? 'all events' : eventLabel(ctx, eid as string),
    total: rows.length,
    meetings: rows.map(m => {
      const att = Array.isArray(m.attendance) ? (m.attendance as { attended?: boolean }[]) : []
      return {
        title: m.title,
        date: m.meeting_date,
        category: m.meeting_category,
        invited: att.length,
        attended: att.filter(x => x && x.attended).length,
        notes: m.notes ?? null,
      }
    }),
  }
}

export const GET_MEETINGS_TOOL: ToolDef = { schema: GET_MEETINGS_SCHEMA, handler: getMeetings }
