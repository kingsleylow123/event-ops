import type Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import type { ToolDef, AgentContext } from '../types'
import { resolveEventId, eventLabel } from '../util'

// Mirrors prepAggregate / GET /api/prep: 6-step pre-workshop readiness.
const STEP_LABELS: Record<string, string> = { '1': 'Install', '2': 'Pro', '3': 'Dev tools', '4': 'Survey', '5': 'Data', '6': '9:30am' }

const GET_PREP_STATUS_SCHEMA: Anthropic.Tool = {
  name: 'get_prep_status',
  description: 'Get pre-workshop prep readiness for an event: how many attendees started/completed the 6 setup steps, per-step completion, and who hasn\'t finished. Use for "who is workshop-ready", "prep status", "who hasn\'t done their setup / prep".',
  input_schema: {
    type: 'object',
    properties: { event_id: { type: 'string', description: 'Event id. Defaults to active.' } },
  },
}

async function getPrepStatus(args: Record<string, unknown>, ctx: AgentContext) {
  const eid = resolveEventId(args.event_id, ctx)
  const { data, error } = await supabase
    .from('prep_progress')
    .select('name,phone,steps,completed')
    .eq('event_id', eid)
  if (error) return { error: error.message }
  const rows = data ?? []
  const where = eventLabel(ctx, eid)
  if (!rows.length) return { event: where, started: 0, message: 'Nobody has started prep yet.' }

  const per: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0 }
  for (const r of rows) {
    const s = (r.steps ?? {}) as Record<string, boolean>
    for (const k of Object.keys(per)) if (s[k]) per[k]++
  }
  return {
    event: where,
    started: rows.length,
    completed: rows.filter(r => r.completed).length,
    per_step: Object.fromEntries(Object.entries(STEP_LABELS).map(([k, lbl]) => [lbl, per[k]])),
    still_pending: rows.filter(r => !r.completed).map(r => (r.name as string) || (r.phone as string)),
  }
}

export const GET_PREP_STATUS_TOOL: ToolDef = { schema: GET_PREP_STATUS_SCHEMA, handler: getPrepStatus }
