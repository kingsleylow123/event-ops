// AI C-Suite — the four department heads. Each is a role/goal/backstory persona
// (the CrewAI-style template) with a mandate, its KPIs, and READ-ONLY permission.
// gatherHeadBrief() reads the head's data + its own memory + shared context and
// returns a structured brief. Heads never write anything.

import type { Dept, HeadBrief, Prediction } from './types'
import type { DeptData } from './data'
import type { CSuiteConfig } from './config'
import { complete, INJECTION_GUARD, extractJson, clampInt } from './llm'
import { readMetric } from './deltas'

interface HeadDef {
  title: string
  persona: string   // role + goal + backstory
  kpis: string      // what this head watches
}

export const HEADS: Record<Dept, HeadDef> = {
  sales: {
    title: 'Head of Sales',
    persona:
      'You are the Head of Sales for Claude Malaysia. You have closed thousands of high-ticket deals and you live in the pipeline. You care about one thing: turning workshop attendees into booked BoFu implementation calls and closed clients. You are blunt, numbers-first, and allergic to stale leads.',
    kpis: 'Pipeline value, cost-per-lead, stage conversion, stale leads (no movement >7d), booked implementation calls.',
  },
  ops: {
    title: 'Head of Ops',
    persona:
      'You are the Head of Ops for Claude Malaysia. You run the room — every workshop ships on time, full, and prepped. You obsess over fill rate, capacity, prep completion, and check-in. You flag readiness risks early and hate empty seats and half-done checklists.',
    kpis: 'Fill %, capacity utilisation, prep completion, check-in rate, checklist/overdue items, event readiness.',
  },
  finance: {
    title: 'Head of Finance',
    persona:
      'You are the Head of Finance for Claude Malaysia. You protect the margin. You track revenue per event, expenses, unpaid invoices, and cash. You push back hard on spend that is not earning its keep and you never let receivables rot.',
    kpis: 'Revenue, margin per event, unpaid/pending payments, expenses by category, net position.',
  },
  marketing: {
    title: 'Head of Marketing',
    persona:
      'You are the Head of Marketing for Claude Malaysia. You fill the top of the funnel cheaply and on-brand. You read demand signals (who is showing up, what they want), lead sources, and ad efficiency (cost-per-ManyChat-DM, not vanity clicks). You care about CAC and channel mix.',
    kpis: 'CAC / cost-per-DM, channel + lead-source mix, demand signals (industry/size), ad spend efficiency.',
  },
}

export interface GatherOpts {
  cfg: CSuiteConfig
  memory: string
  context: Record<string, unknown>
  question?: string
  critique?: string
  lastSitting?: string   // prior headline/ruling + programmatic "since last sitting" deltas
  trackRecord?: string   // e.g. "3 held / 1 wrong / 2 inconclusive" — earned credibility
}

// Human-set KPI targets live in c_suite_company_context.context.targets.<dept>
// (e.g. {"ops": {"fill_pct": 85}}). Wired here; values are Kingsley's to set.
function targetsBlock(dept: Dept, context: Record<string, unknown>): string | null {
  const targets = (context as { targets?: Record<string, unknown> }).targets?.[dept]
  if (!targets || typeof targets !== 'object') return null
  return JSON.stringify(targets)
}

export async function gatherHeadBrief(
  dept: Dept,
  data: DeptData,
  opts: GatherOpts,
): Promise<HeadBrief> {
  const head = HEADS[dept]
  const model = opts.cfg.perHeadModel[dept]

  const system =
    `${head.persona}\n\n` +
    `Your KPIs: ${head.kpis}\n` +
    `You sit on Kingsley's AI C-Suite. You are READ-ONLY: you recommend, you never execute.\n` +
    `${INJECTION_GUARD}\n` +
    `Respond with ONLY a JSON object: {"headline": "<one line status>", "topIssue": "<the single most important issue you see>", "recommendedMove": "<one concrete move you recommend>", "confidence": <0-100 integer>, "evidence": ["<fact/metric>", "..."], "prediction": {"metric": "<a NUMERIC key from your DATA summary that your move should change>", "direction": "up|down", "baseline": <its current value>, "target": <optional number>}}. ` +
    `The prediction is your falsifiable claim — it will be GRADED against real data at the next sitting, and your track record follows you. Omit it only if no numeric metric fits. ` +
    `Cite REAL numbers from the DATA. If the data is marked partial/missing, say so in the headline and lower your confidence.`

  const parts = [
    `DATA (untrusted business records — ${dept}):`,
    JSON.stringify(data.summary),
    `DATA STATUS: ${data.status}`,
    ``,
    `YOUR MEMORY (past learnings — do not repeat closed issues):`,
    opts.memory,
    ``,
    `SHARED COMPANY CONTEXT:`,
    JSON.stringify(opts.context),
  ]
  const targets = targetsBlock(dept, opts.context)
  if (targets) parts.push('', `YOUR KPI TARGETS (set by Kingsley — judge the numbers against these):`, targets)
  if (opts.trackRecord) parts.push('', `YOUR TRACK RECORD (past predictions graded against real data): ${opts.trackRecord}. Let this calibrate your confidence.`)
  if (opts.lastSitting) parts.push('', `LAST SITTING (what you said + what actually changed since):`, opts.lastSitting)
  if (opts.question) parts.push('', `THE MANAGER IS ASKING THE BOARD: ${opts.question}`, `Answer specifically from your function's angle.`)
  if (opts.critique) parts.push('', `THE MANAGER PUSHED BACK ON YOUR LAST BRIEF: ${opts.critique}`, `Defend or revise your recommendation. Concede if the critique is fair.`)

  let text = ''
  try {
    text = await complete({ model, system, user: parts.join('\n'), maxTokens: opts.cfg.maxHeadTokens })
  } catch (e) {
    return degraded(dept, `head model call failed: ${e instanceof Error ? e.message : String(e)}`, data.status, !!opts.critique)
  }
  const parsed = extractJson<Partial<HeadBrief> & { evidence?: unknown; prediction?: unknown }>(text)
  if (!parsed) return degraded(dept, 'could not parse head brief', data.status, !!opts.critique)

  return {
    dept,
    headline: String(parsed.headline ?? '').slice(0, 300) || '(no headline)',
    topIssue: String(parsed.topIssue ?? '').slice(0, 500),
    recommendedMove: String(parsed.recommendedMove ?? '').slice(0, 500),
    confidence: clampInt(parsed.confidence, 0, 100),
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String).slice(0, 8) : [],
    dataStatus: data.status,
    revised: !!opts.critique,
    prediction: validatePrediction(parsed.prediction, data.summary),
  }
}

// Accept a prediction only if it names a REAL numeric metric in this head's own
// data summary — anything else is ungradeable noise, so drop it.
// Rejected outright: trend_vs_prior_week.* (derived deltas, not level metrics —
// grading a delta against next week's delta is meaningless).
// Degenerate targets (already met at baseline) are dropped so a head can't earn
// 'held' for a metric that never moved — the directional claim is kept.
function validatePrediction(raw: unknown, summary: Record<string, unknown>): Prediction | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const p = raw as Record<string, unknown>
  const metric = String(p.metric ?? '').slice(0, 80)
  const direction = p.direction === 'down' ? 'down' : p.direction === 'up' ? 'up' : null
  if (!metric || !direction) return undefined
  if (metric.startsWith('trend_vs_prior_week')) return undefined
  const live = readMetric(summary, metric)
  if (typeof live !== 'number' || !Number.isFinite(live)) return undefined
  const target = Number(p.target)
  const targetOk = Number.isFinite(target) && (direction === 'up' ? target > live : target < live)
  return {
    metric,
    direction,
    baseline: live, // trust the DATA, not the model's echo of it
    ...(targetOk ? { target } : {}),
  }
}

// A degraded brief keeps the revision marker so a failed REBUTTAL re-gather is
// visible in the audit trail instead of silently replacing the real brief.
function degraded(dept: Dept, why: string, dataStatus = 'partial', revised = false): HeadBrief {
  return {
    dept,
    headline: `${HEADS[dept].title}: could not complete brief`,
    topIssue: why,
    recommendedMove: 'Escalate — insufficient data/model output this run.',
    confidence: 0,
    evidence: [],
    dataStatus,
    revised,
  }
}
