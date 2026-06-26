import type Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin as supabase, fetchAllRows } from '@/lib/supabase-admin'
import type { ToolDef, AgentContext } from '../types'
import { resolveEventId, eventLabel } from '../util'

// Pre-event survey analysis — the old snapshot bot could see survey rows; the
// agent had no tool for them. Returns structured counts (industry, company size)
// AND the raw free-text answers so the model can theme "pain points" / goals.
const ANALYZE_SURVEYS_SCHEMA: Anthropic.Tool = {
  name: 'analyze_surveys',
  description:
    'Analyze pre-event survey responses: top industries, company-size breakdown, and the raw free-text "biggest challenge / pain point" and "workshop goal" answers (theme these yourself for top pain points). Use for "what industry are our attendees", "top pain points", "what do attendees want", "survey insights / results". Scope to one event or all events.',
  input_schema: {
    type: 'object',
    properties: {
      event_id: { type: 'string', description: 'Event id. Defaults to the active event.' },
      scope: { type: 'string', enum: ['single', 'all_time'], description: 'single = one event (default). all_time = every event combined.' },
    },
  },
}

const MAX_TEXT = 60 // cap free-text answers returned (token control)
const CLIP = 300 // truncate each free-text answer

async function analyzeSurveys(args: Record<string, unknown>, ctx: AgentContext) {
  const scope = String(args.scope ?? 'single') === 'all_time' ? 'all_time' : 'single'
  const eid = scope === 'single' ? resolveEventId(args.event_id, ctx) : null

  const { rows, error } = await fetchAllRows<Record<string, unknown>>((from, to) => {
    let qb = supabase
      .from('pre_event_survey_responses')
      .select('industry,company_size,biggest_challenge,workshop_goal,event_id,created_at')
      .order('created_at', { ascending: false })
      .range(from, to)
    if (eid) qb = qb.eq('event_id', eid)
    return qb
  })
  if (error) return { error }

  const data = rows ?? []
  const where = eid ? eventLabel(ctx, eid) : 'all events'
  if (!data.length) return { scope, event: where, response_count: 0, message: 'No survey responses yet.' }

  // Tally case-insensitively (so "Marketing" + "marketing" merge) but keep a
  // representative original-case label for display.
  const byIndustry = new Map<string, { label: string; count: number }>()
  const bySize = new Map<string, { label: string; count: number }>()
  const painPoints: string[] = []
  const goals: string[] = []
  const tally = (m: Map<string, { label: string; count: number }>, raw: string) => {
    const key = raw.toLowerCase()
    const e = m.get(key)
    if (e) e.count++
    else m.set(key, { label: raw, count: 1 })
  }
  for (const s of data) {
    const ind = String(s.industry ?? '').trim()
    if (ind) tally(byIndustry, ind)
    const sz = String(s.company_size ?? '').trim()
    if (sz) tally(bySize, sz)
    const ch = String(s.biggest_challenge ?? '').trim()
    if (ch && painPoints.length < MAX_TEXT) painPoints.push(ch.slice(0, CLIP))
    const g = String(s.workshop_goal ?? '').trim()
    if (g && goals.length < MAX_TEXT) goals.push(g.slice(0, CLIP))
  }
  const sortCounts = (m: Map<string, { label: string; count: number }>) =>
    [...m.values()].sort((a, b) => b.count - a.count).map(({ label, count }) => ({ label, count }))

  return {
    scope,
    event: where,
    response_count: data.length,
    top_industries: sortCounts(byIndustry).slice(0, 15),
    company_size: sortCounts(bySize),
    pain_points_raw: painPoints, // free-text biggest_challenge — theme these
    goals_raw: goals, // free-text workshop_goal
    note: painPoints.length >= MAX_TEXT ? `Showing the first ${MAX_TEXT} free-text answers of ${data.length} responses.` : undefined,
  }
}

export const ANALYZE_SURVEYS_TOOL: ToolDef = { schema: ANALYZE_SURVEYS_SCHEMA, handler: analyzeSurveys }
