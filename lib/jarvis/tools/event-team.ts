import type Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { TEAM_ROLE_LABELS, type TeamRole } from '@/lib/supabase'
import type { ToolDef, AgentContext } from '../types'
import { resolveEventId, eventLabel } from '../util'

// "Claude Intern" tab — the per-event internal roster (speaker / facilitator /
// content creator / videographer), stored as events.team JSONB.
const GET_EVENT_TEAM_SCHEMA: Anthropic.Tool = {
  name: 'get_event_team',
  description: 'Get the internal team roster for an event (speaker, facilitator, content creator, videographer) — the "Claude Intern" tab. Use for "who is the speaker/facilitator for X", "who is running X", "who is on the crew".',
  input_schema: { type: 'object', properties: { event_id: { type: 'string', description: 'Event id. Defaults to active.' } } },
}

async function getEventTeam(args: Record<string, unknown>, ctx: AgentContext) {
  const eid = resolveEventId(args.event_id, ctx)
  const { data, error } = await supabase.from('events').select('team').eq('id', eid).maybeSingle()
  if (error) return { error: error.message }
  const team = Array.isArray(data?.team) ? (data!.team as { role: TeamRole; name: string; phone: string | null }[]) : []
  if (!team.length) return { event: eventLabel(ctx, eid), members: [], message: 'No team set for this event yet — set it on the Claude Intern tab.' }
  return {
    event: eventLabel(ctx, eid),
    members: team.map(m => ({ role: TEAM_ROLE_LABELS[m.role] ?? m.role, name: m.name, phone: m.phone ?? null })),
  }
}

export const GET_EVENT_TEAM_TOOL: ToolDef = { schema: GET_EVENT_TEAM_SCHEMA, handler: getEventTeam }
