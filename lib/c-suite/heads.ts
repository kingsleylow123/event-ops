// AI C-Suite — the four department heads. Each is a role/goal/backstory persona
// (the CrewAI-style template) with a mandate, its KPIs, and READ-ONLY permission.
// gatherHeadBrief() reads the head's data + its own memory + shared context and
// returns a structured brief. Heads never write anything.

import type { Dept, HeadBrief } from './types'
import type { DeptData } from './data'
import type { CSuiteConfig } from './config'
import { complete, INJECTION_GUARD, extractJson, clampInt } from './llm'

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

export async function gatherHeadBrief(
  dept: Dept,
  data: DeptData,
  opts: { cfg: CSuiteConfig; memory: string; context: Record<string, unknown>; question?: string; critique?: string },
): Promise<HeadBrief> {
  const head = HEADS[dept]
  const model = opts.cfg.perHeadModel[dept]

  const system =
    `${head.persona}\n\n` +
    `Your KPIs: ${head.kpis}\n` +
    `You sit on Kingsley's AI C-Suite. You are READ-ONLY: you recommend, you never execute.\n` +
    `${INJECTION_GUARD}\n` +
    `Respond with ONLY a JSON object: {"headline": "<one line status>", "topIssue": "<the single most important issue you see>", "recommendedMove": "<one concrete move you recommend>", "confidence": <0-100 integer>, "evidence": ["<fact/metric>", "..."]}. ` +
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
  if (opts.question) parts.push('', `THE MANAGER IS ASKING THE BOARD: ${opts.question}`, `Answer specifically from your function's angle.`)
  if (opts.critique) parts.push('', `THE MANAGER PUSHED BACK ON YOUR LAST BRIEF: ${opts.critique}`, `Defend or revise your recommendation. Concede if the critique is fair.`)

  let text = ''
  try {
    text = await complete({ model, system, user: parts.join('\n'), maxTokens: opts.cfg.maxHeadTokens, temperature: 0.4 })
  } catch (e) {
    return degraded(dept, `head model call failed: ${e instanceof Error ? e.message : String(e)}`)
  }
  const parsed = extractJson<Partial<HeadBrief> & { evidence?: unknown }>(text)
  if (!parsed) return degraded(dept, 'could not parse head brief', data.status)

  return {
    dept,
    headline: String(parsed.headline ?? '').slice(0, 300) || '(no headline)',
    topIssue: String(parsed.topIssue ?? '').slice(0, 500),
    recommendedMove: String(parsed.recommendedMove ?? '').slice(0, 500),
    confidence: clampInt(parsed.confidence, 0, 100),
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String).slice(0, 8) : [],
    dataStatus: data.status,
    revised: !!opts.critique,
  }
}

function degraded(dept: Dept, why: string, dataStatus = 'partial'): HeadBrief {
  return {
    dept,
    headline: `${HEADS[dept].title}: could not complete brief`,
    topIssue: why,
    recommendedMove: 'Escalate — insufficient data/model output this run.',
    confidence: 0,
    evidence: [],
    dataStatus,
  }
}
