// AI C-Suite — the board. The Manager (Opus) convenes the 4 heads (Sonnet),
// grills them, lets them clash cross-functionally, then synthesises ONE ruling.
// This is the part no framework ships — the adversarial debate loop is the IP.
//   gather (parallel)  →  challenge (dual-ledger + LGTM/LBTM)  →  rebuttal (rejected
//   heads revise, bounded)  →  rule (SocietyOfMind synthesis, forced tool-use).
// Copilot: recommendations only, nothing executes.

import Anthropic from '@anthropic-ai/sdk'
import type { BoardMode, BoardResult, Challenge, Dept, HeadBrief, Ruling } from './types'
import { DEPTS } from './types'
import { getCSuiteConfig, type CSuiteConfig } from './config'
import { anthropic, complete, INJECTION_GUARD, extractJson, clampInt } from './llm'
import { getActiveEvent, salesData, opsData, financeData, marketingData, type DeptData } from './data'
import { gatherHeadBrief, HEADS } from './heads'
import { recallHeadMemory } from './memory'
import { getCompanyContext } from './store'

const MANAGER_PERSONA =
  'You are the Chief of Staff / CEO of Claude Malaysia, chairing the AI C-Suite. You are a seasoned operator: you do NOT do the heads\' jobs, but your experience lets you properly evaluate their work. You are demanding — you grill each head, surface where their recommendations CONFLICT with each other, and force the trade-offs into the open. You protect the whole business, not any one function.'

async function readDeptData(): Promise<Record<Dept, DeptData>> {
  const ev = await getActiveEvent()
  const [sales, ops, finance, marketing] = await Promise.all([
    salesData(), opsData(ev), financeData(ev), marketingData(ev),
  ])
  return { sales, ops, finance, marketing }
}

function briefsBlock(briefs: HeadBrief[]): string {
  return briefs.map(b =>
    `### ${HEADS[b.dept].title} (confidence ${b.confidence}%${b.revised ? ', revised' : ''})\n` +
    `Headline: ${b.headline}\nTop issue: ${b.topIssue}\nRecommends: ${b.recommendedMove}\n` +
    `Evidence: ${b.evidence.join(' | ') || '(none cited)'}\nData: ${b.dataStatus}`,
  ).join('\n\n')
}

// ── Challenge: the dual-ledger grilling + LGTM/LBTM verdict per head ───────────
async function challenge(briefs: HeadBrief[], cfg: CSuiteConfig, context: Record<string, unknown>, question?: string): Promise<Challenge[]> {
  const system =
    `${MANAGER_PERSONA}\n${INJECTION_GUARD}\n` +
    `Run a dual-ledger review: for each head ask (a) is the real issue resolved by their move? (b) are they making genuine progress or just restating? (c) what does their move COST another function? Then issue a verdict.\n` +
    `Respond with ONLY JSON: {"challenges": [{"dept": "sales|ops|finance|marketing", "verdict": "APPROVE|REJECT", "critique": "<your grilling, <=2 sentences>", "crossFlags": ["<conflict this move creates for another function>"]}]}. ` +
    `REJECT a head whose recommendation is weak, unsupported by its evidence, or in unaddressed conflict with another function.`
  const user = [
    question ? `BOARD QUESTION: ${question}\n` : '',
    `SHARED CONTEXT: ${JSON.stringify(context)}`,
    ``,
    `THE HEADS' BRIEFS:`,
    briefsBlock(briefs),
    ``,
    `Grill each head now. Name the cross-functional conflicts explicitly.`,
  ].join('\n')

  try {
    const text = await complete({ model: cfg.managerModel, system, user, maxTokens: cfg.maxManagerTokens, temperature: 0.3 })
    const parsed = extractJson<{ challenges?: unknown[] }>(text)
    const raw = Array.isArray(parsed?.challenges) ? parsed!.challenges : []
    const byDept = new Map<Dept, Challenge>()
    for (const c of raw as Array<Record<string, unknown>>) {
      const dept = String(c.dept ?? '') as Dept
      if (!DEPTS.includes(dept)) continue
      byDept.set(dept, {
        dept,
        verdict: c.verdict === 'REJECT' ? 'REJECT' : 'APPROVE',
        critique: String(c.critique ?? '').slice(0, 500),
        crossFlags: Array.isArray(c.crossFlags) ? c.crossFlags.map(String).slice(0, 5) : [],
      })
    }
    // Any head the manager didn't mention defaults to APPROVE with no critique.
    return DEPTS.map(d => byDept.get(d) ?? { dept: d, verdict: 'APPROVE' as const, critique: '', crossFlags: [] })
  } catch (e) {
    console.error('[c-suite] challenge', e)
    return DEPTS.map(d => ({ dept: d, verdict: 'APPROVE' as const, critique: '', crossFlags: [] }))
  }
}

// ── Rule: SocietyOfMind synthesis via forced tool-use (parseable, never silent) ─
const COMMIT_BOARD_TOOL: Anthropic.Tool = {
  name: 'commit_board_ruling',
  description: 'Commit the board\'s synthesised best-practice ruling(s) after grilling the heads.',
  input_schema: {
    type: 'object',
    properties: {
      board_brief: { type: 'string', description: 'A tight narrative for Kingsley: the state of the business and the single most important move, in your voice.' },
      rulings: {
        type: 'array',
        description: 'One to three best-practice decisions, highest priority first.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            decision: { type: 'string', description: 'The concrete best-practice call.' },
            rationale: { type: 'string', description: 'Why — reconciling the heads.' },
            overruled: { type: 'array', items: { type: 'string' }, description: 'Which head/position was overruled and why (may be empty).' },
            priority: { type: 'string', enum: ['high', 'medium', 'low'] },
            confidence: { type: 'integer', description: '0-100.' },
          },
          required: ['title', 'decision', 'rationale', 'priority', 'confidence'],
        },
      },
    },
    required: ['board_brief', 'rulings'],
  },
}

async function rule(
  briefs: HeadBrief[], challenges: Challenge[], cfg: CSuiteConfig, context: Record<string, unknown>, question?: string,
): Promise<{ rulings: Ruling[]; boardBrief: string }> {
  const challengeBlock = challenges.map(c =>
    `- ${HEADS[c.dept].title}: ${c.verdict}${c.critique ? ` — ${c.critique}` : ''}${c.crossFlags.length ? ` [conflicts: ${c.crossFlags.join('; ')}]` : ''}`,
  ).join('\n')

  const system =
    `${MANAGER_PERSONA}\n${INJECTION_GUARD}\n` +
    `You have grilled the heads. Now hide the argument and surface ONE clear position (SocietyOfMind): the best-practice ruling(s) for the whole business, citing which head you overruled and why. ` +
    `You are advisory only — recommend, do not execute. Commit via the tool.`
  const user = [
    question ? `BOARD QUESTION: ${question}\n` : '',
    `SHARED CONTEXT: ${JSON.stringify(context)}`,
    ``,
    `HEADS' BRIEFS:`,
    briefsBlock(briefs),
    ``,
    `YOUR CHALLENGE VERDICTS:`,
    challengeBlock,
    ``,
    `Commit the board ruling now.`,
  ].join('\n')

  try {
    const resp = await anthropic().messages.create({
      model: cfg.managerModel,
      max_tokens: cfg.maxManagerTokens,
      temperature: 0.3,
      tools: [COMMIT_BOARD_TOOL],
      tool_choice: { type: 'tool', name: 'commit_board_ruling' },
      system,
      messages: [{ role: 'user', content: user }],
    })
    const toolUse = resp.content.find(c => c.type === 'tool_use') as Anthropic.ToolUseBlock | undefined
    const input = toolUse?.input as { board_brief?: string; rulings?: unknown[] } | undefined
    if (!input) return escalate('Manager produced no parseable ruling.')
    const rulings: Ruling[] = (Array.isArray(input.rulings) ? input.rulings : []).slice(0, 3).map((r) => {
      const x = r as Record<string, unknown>
      const p = String(x.priority ?? 'medium')
      return {
        title: String(x.title ?? '').slice(0, 200) || 'Ruling',
        decision: String(x.decision ?? '').slice(0, 800),
        rationale: String(x.rationale ?? '').slice(0, 800),
        overruled: Array.isArray(x.overruled) ? x.overruled.map(String).slice(0, 5) : [],
        priority: (p === 'high' || p === 'low' ? p : 'medium') as Ruling['priority'],
        confidence: clampInt(x.confidence, 0, 100),
      }
    })
    if (!rulings.length) return escalate('Manager committed an empty ruling set.')
    return { rulings, boardBrief: String(input.board_brief ?? '').slice(0, 2000) }
  } catch (e) {
    console.error('[c-suite] rule', e)
    return escalate(`Manager ruling failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function escalate(why: string): { rulings: Ruling[]; boardBrief: string } {
  return {
    rulings: [{ title: 'Escalate to Kingsley', decision: 'The board could not reach a confident ruling this run.', rationale: why, overruled: [], priority: 'high', confidence: 0 }],
    boardBrief: `⚠️ ${why}`,
  }
}

// ── The full sitting ──────────────────────────────────────────────────────────
export async function deliberate(mode: BoardMode, question?: string): Promise<BoardResult> {
  const cfg = getCSuiteConfig()
  const [context, data, ...mems] = await Promise.all([
    getCompanyContext(),
    readDeptData(),
    ...DEPTS.map(d => recallHeadMemory(d)),
  ])
  const memory: Record<Dept, string> = { sales: mems[0], ops: mems[1], finance: mems[2], marketing: mems[3] }

  // 1) Gather — every head reads its own data + memory in parallel.
  let briefs = await Promise.all(DEPTS.map(d => gatherHeadBrief(d, data[d], { cfg, memory: memory[d], context, question })))

  // 2) Challenge — the manager grills them and surfaces conflicts.
  let challenges = await challenge(briefs, cfg, context, question)

  // 3) Rebuttal — rejected heads revise, bounded by C_SUITE_DEBATE_ROUNDS.
  let rounds = 1
  for (let r = 0; r < cfg.debateRounds; r++) {
    const rejected = challenges.filter(c => c.verdict === 'REJECT').map(c => c.dept)
    if (!rejected.length) break
    const revised = await Promise.all(rejected.map(d =>
      gatherHeadBrief(d, data[d], { cfg, memory: memory[d], context, question, critique: challenges.find(c => c.dept === d)!.critique }),
    ))
    briefs = briefs.map(b => revised.find(rv => rv.dept === b.dept) ?? b)
    challenges = await challenge(briefs, cfg, context, question)
    rounds++
  }

  // 4) Rule — SocietyOfMind synthesis.
  const { rulings, boardBrief } = await rule(briefs, challenges, cfg, context, question)

  return { mode, question, briefs, challenges, rulings, boardBrief, rounds }
}
