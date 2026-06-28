import type Anthropic from '@anthropic-ai/sdk'
import type { ToolDef, AgentContext } from '../types'
import { buildFunnel, weakLinkLine } from '@/lib/funnel'

// Whole-business by default; pass event_id to scope to one event.
function scopeArg(args: Record<string, unknown>): string | undefined {
  const v = args.event_id
  return typeof v === 'string' && v ? v : undefined
}

const GET_FUNNEL_SCHEMA: Anthropic.Tool = {
  name: 'get_funnel',
  description:
    'Get the whole-business ToFu→MoFu→BoFu funnel: leads → 1-day workshop seats → 2-day GLCC class → B2B deals, with the conversion between each stage, revenue, and the affiliate share of revenue. Use for "show me the funnel", "how is the whole pipeline doing", "lead to sale conversion". Whole-business by default; pass event_id to scope to one event.',
  input_schema: {
    type: 'object',
    properties: { event_id: { type: 'string', description: 'Optional. Scope to one event; omit for the whole business.' } },
  },
}

const GET_WEAK_LINK_SCHEMA: Anthropic.Tool = {
  name: 'get_weak_link',
  description:
    'Find the single weakest link / biggest constraint in the funnel — the stage transition leaking the most money — plus the RM upside if fixed and concrete fixes. Use for "where is my funnel leaking", "what is my biggest bottleneck", "what should I fix first".',
  input_schema: {
    type: 'object',
    properties: { event_id: { type: 'string', description: 'Optional. Scope to one event; omit for the whole business.' } },
  },
}

async function getFunnel(args: Record<string, unknown>, _ctx: AgentContext) {
  const r = await buildFunnel({ eventId: scopeArg(args) })
  return {
    scope: r.scope.eventName || 'whole business',
    stages: r.stages.map(s => ({ stage: s.label, count: s.count, revenue_rm: s.revenue, conv_from_prev_pct: s.convFromPct, measures: s.convNote })),
    totals: r.totals,
    affiliate_share_pct: r.attribution.affiliatePct,
    weakest_link: r.weakLink,
  }
}

async function getWeakLink(args: Record<string, unknown>, _ctx: AgentContext) {
  const r = await buildFunnel({ eventId: scopeArg(args) })
  return {
    scope: r.scope.eventName || 'whole business',
    summary: weakLinkLine(r),
    weakest_link: r.weakLink,
    runner_up: r.runnerUp,
    risks: r.risks,
  }
}

export const GET_FUNNEL_TOOL: ToolDef = { schema: GET_FUNNEL_SCHEMA, handler: getFunnel }
export const GET_WEAK_LINK_TOOL: ToolDef = { schema: GET_WEAK_LINK_SCHEMA, handler: getWeakLink }
