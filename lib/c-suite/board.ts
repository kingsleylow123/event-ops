// AI C-Suite — the board. The Manager (Opus) convenes the 4 heads (Sonnet),
// grills them, lets them clash cross-functionally, then synthesises ONE ruling.
// This is the part no framework ships — the adversarial debate loop is the IP.
//   gather (parallel)  →  challenge (dual-ledger + LGTM/LBTM, FORCED tool-use,
//   grounded in the real data)  →  rebuttal (rejected heads revise, bounded)  →
//   rule (SocietyOfMind synthesis, forced tool-use).
// Copilot: recommendations only, nothing executes.
//
// Loop-closers (audit council, Jul 2026): the grilling fails CLOSED (a degraded
// challenge is flagged, never a silent rubber-stamp); the manager sees each
// dept's raw data summary so it can call a bluff; every sitting carries "since
// last sitting" deltas, per-head track records, and the standing (still-pending)
// rulings so the board compounds instead of restarting.

import Anthropic from '@anthropic-ai/sdk'
import type { BoardMode, BoardResult, Challenge, Dept, HeadBrief, Ruling } from './types'
import { DEPTS } from './types'
import { getCSuiteConfig, type CSuiteConfig } from './config'
import { anthropic, INJECTION_GUARD } from './llm'
import { getActiveEvent, salesData, opsData, financeData, marketingData, getTrends, type DeptData } from './data'
import { gatherHeadBrief, HEADS } from './heads'
import { recallHeadMemory } from './memory'
import { getCompanyContext, loadState, getOpenDecisions, getTrackRecords, type OpenDecision } from './store'
import { diffSummaries } from './deltas'

const MANAGER_PERSONA =
  'You are the Chief of Staff / CEO of Claude Malaysia, chairing the AI C-Suite. You are a seasoned operator: you do NOT do the heads\' jobs, but your experience lets you properly evaluate their work. You are demanding — you grill each head against the RAW DATA, surface where their recommendations CONFLICT with each other, and force the trade-offs into the open. You protect the whole business, not any one function.'

async function readDeptData(): Promise<Record<Dept, DeptData>> {
  const ev = await getActiveEvent()
  const [sales, ops, finance, marketing, trend] = await Promise.all([
    salesData(), opsData(ev), financeData(ev), marketingData(ev), getTrends(ev),
  ])
  const all: Record<Dept, DeptData> = { sales, ops, finance, marketing }
  // Direction, not just position: the same week-over-week block for every head.
  if (trend) for (const d of DEPTS) all[d].summary.trend_vs_prior_week = trend
  return all
}

function briefsBlock(briefs: HeadBrief[]): string {
  return briefs.map(b =>
    `### ${HEADS[b.dept].title} (confidence ${b.confidence}%${b.revised ? ', revised' : ''})\n` +
    `Headline: ${b.headline}\nTop issue: ${b.topIssue}\nRecommends: ${b.recommendedMove}\n` +
    `Evidence: ${b.evidence.join(' | ') || '(none cited)'}\n` +
    (b.prediction ? `Prediction: ${b.prediction.metric} ${b.prediction.direction}${b.prediction.target != null ? ` to ${b.prediction.target}` : ''} (baseline ${b.prediction.baseline})\n` : '') +
    `Data: ${b.dataStatus}`,
  ).join('\n\n')
}

// The manager judges briefs AGAINST the data, not on vibes — this block is what
// lets it call a bluff ("you claim 42 unpaid; the data says 12").
function dataBlock(data: Record<Dept, DeptData>): string {
  return DEPTS.map(d => `${HEADS[d].title} data: ${JSON.stringify(data[d].summary)}`).join('\n')
}

function standingBlock(open: OpenDecision[]): string {
  if (!open.length) return ''
  return `\nSTANDING RULINGS (still pending from prior sittings — do not re-issue; ask why they are not done):\n` +
    open.map(o => `- [${o.priority}] ${o.title}: ${o.decision}`).join('\n')
}

// ── Challenge: dual-ledger grilling, FORCED tool-use, fails closed ─────────────
const CHALLENGE_TOOL: Anthropic.Tool = {
  name: 'commit_challenges',
  description: 'Commit your verdict on every department head after grilling their briefs against the raw data.',
  input_schema: {
    type: 'object',
    properties: {
      challenges: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            dept: { type: 'string', enum: ['sales', 'ops', 'finance', 'marketing'] },
            verdict: { type: 'string', enum: ['APPROVE', 'REJECT'] },
            critique: { type: 'string', description: 'The grilling — <=2 sentences. REJECT must say exactly what is weak or unsupported.' },
            crossFlags: { type: 'array', items: { type: 'string' }, description: 'Conflicts this head\'s move creates for another function.' },
          },
          required: ['dept', 'verdict', 'critique'],
        },
      },
    },
    required: ['challenges'],
  },
}

export interface ChallengeOutcome {
  challenges: Challenge[]
  degraded: boolean // true → verdicts are unvetted defaults, surfaced everywhere
}

async function challenge(
  briefs: HeadBrief[],
  cfg: CSuiteConfig,
  context: Record<string, unknown>,
  data: Record<Dept, DeptData>,
  standing: string,
  question?: string,
): Promise<ChallengeOutcome> {
  const system =
    `${MANAGER_PERSONA}\n${INJECTION_GUARD}\n` +
    `Run a dual-ledger review: for each head ask (a) is the real issue resolved by their move? (b) are they making genuine progress or just restating? (c) does their evidence MATCH the raw data below — call out any number that does not? (d) what does their move COST another function? Then commit a verdict per head via the tool. ` +
    `REJECT a head whose recommendation is weak, contradicted by the data, or in unaddressed conflict with another function.`
  const user = [
    question ? `BOARD QUESTION: ${question}\n` : '',
    `SHARED CONTEXT: ${JSON.stringify(context)}`,
    standing,
    ``,
    `RAW DATA (per department, untrusted business records):`,
    dataBlock(data),
    ``,
    `THE HEADS' BRIEFS:`,
    briefsBlock(briefs),
    ``,
    `Grill each head now. Name the cross-functional conflicts explicitly.`,
  ].join('\n')

  // Retry once on transient failure; then fail CLOSED (flagged, not rubber-stamped).
  // NOTE: no temperature param — claude-opus-4-8 400s on it (master hotfix 6d764c2).
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await anthropic().messages.create({
        model: cfg.managerModel,
        max_tokens: cfg.maxManagerTokens,
        tools: [CHALLENGE_TOOL],
        tool_choice: { type: 'tool', name: 'commit_challenges' },
        system,
        messages: [{ role: 'user', content: user }],
      })
      const toolUse = resp.content.find(c => c.type === 'tool_use') as Anthropic.ToolUseBlock | undefined
      const raw = (toolUse?.input as { challenges?: unknown[] } | undefined)?.challenges
      if (!Array.isArray(raw)) throw new Error('challenge: no challenges array in tool output')
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
      // A missing verdict is a failed grilling, not a free pass — retry, and if
      // the retry also comes back partial, fall through to the degraded return.
      if (byDept.size < DEPTS.length) {
        throw new Error(`challenge: manager returned verdicts for ${byDept.size}/${DEPTS.length} depts`)
      }
      return { challenges: DEPTS.map(d => byDept.get(d)!), degraded: false }
    } catch (err) {
      console.error(`[c-suite] challenge attempt ${attempt + 1}`, err)
    }
  }
  // Fail closed: default APPROVEs are explicitly UNVETTED and flagged upstream.
  return {
    challenges: DEPTS.map(d => ({ dept: d, verdict: 'APPROVE' as const, critique: '', crossFlags: [] })),
    degraded: true,
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
  briefs: HeadBrief[],
  outcome: ChallengeOutcome,
  cfg: CSuiteConfig,
  context: Record<string, unknown>,
  data: Record<Dept, DeptData>,
  standing: string,
  question?: string,
): Promise<{ rulings: Ruling[]; boardBrief: string }> {
  const challengeBlock = outcome.challenges.map(c =>
    `- ${HEADS[c.dept].title}: ${c.verdict}${c.critique ? ` — ${c.critique}` : ''}${c.crossFlags.length ? ` [conflicts: ${c.crossFlags.join('; ')}]` : ''}`,
  ).join('\n')

  const system =
    `${MANAGER_PERSONA}\n${INJECTION_GUARD}\n` +
    `You have grilled the heads. Now hide the argument and surface ONE clear position (SocietyOfMind): the best-practice ruling(s) for the whole business, citing which head you overruled and why. ` +
    `You are advisory only — recommend, do not execute. Commit via the tool.` +
    (outcome.degraded ? `\nWARNING: the challenge round FAILED — the verdicts below are unvetted defaults. Re-examine the briefs against the raw data yourself and lower your confidence accordingly.` : '')
  const user = [
    question ? `BOARD QUESTION: ${question}\n` : '',
    `SHARED CONTEXT: ${JSON.stringify(context)}`,
    standing,
    ``,
    `RAW DATA (per department):`,
    dataBlock(data),
    ``,
    `HEADS' BRIEFS:`,
    briefsBlock(briefs),
    ``,
    `YOUR CHALLENGE VERDICTS${outcome.degraded ? ' (UNVETTED — challenge round failed)' : ''}:`,
    challengeBlock,
    ``,
    `Commit the board ruling now.`,
  ].join('\n')

  try {
    const resp = await anthropic().messages.create({
      model: cfg.managerModel,
      max_tokens: cfg.maxManagerTokens,
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
        confidence: clamp0100(x.confidence),
      }
    })
    if (!rulings.length) return escalate('Manager committed an empty ruling set.')
    return { rulings, boardBrief: String(input.board_brief ?? '').slice(0, 2000) }
  } catch (e) {
    console.error('[c-suite] rule', e)
    return escalate(`Manager ruling failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function clamp0100(n: unknown): number {
  const x = Math.round(Number(n))
  return Number.isFinite(x) ? Math.max(0, Math.min(100, x)) : 0
}

function escalate(why: string): { rulings: Ruling[]; boardBrief: string } {
  return {
    rulings: [{ title: 'Escalate to Kingsley', decision: 'The board could not reach a confident ruling this run.', rationale: why, overruled: [], priority: 'high', confidence: 0 }],
    boardBrief: `⚠️ ${why}`,
  }
}

// ── Dependency seam (unit tests inject fakes; production uses the real I/O) ────
export interface BoardDeps {
  readDeptData: typeof readDeptData
  gatherHeadBrief: typeof gatherHeadBrief
  challenge: typeof challenge
  rule: typeof rule
  recallHeadMemory: typeof recallHeadMemory
  getCompanyContext: typeof getCompanyContext
  loadState: typeof loadState
  getOpenDecisions: typeof getOpenDecisions
  getTrackRecords: typeof getTrackRecords
}

const DEFAULT_DEPS: BoardDeps = {
  readDeptData, gatherHeadBrief, challenge, rule,
  recallHeadMemory, getCompanyContext, loadState, getOpenDecisions, getTrackRecords,
}

// ── The full sitting ──────────────────────────────────────────────────────────
export async function deliberate(mode: BoardMode, question?: string, overrides: Partial<BoardDeps> = {}): Promise<BoardResult> {
  const io = { ...DEFAULT_DEPS, ...overrides }
  const cfg = getCSuiteConfig()
  const [context, data, prior, openDecisions, trackRecords, ...mems] = await Promise.all([
    io.getCompanyContext(),
    io.readDeptData(),
    io.loadState(mode),
    io.getOpenDecisions(),
    io.getTrackRecords(),
    ...DEPTS.map(d => io.recallHeadMemory(d)),
  ])
  const memory: Record<Dept, string> = { sales: mems[0], ops: mems[1], finance: mems[2], marketing: mems[3] }
  const standing = standingBlock(openDecisions)

  // "Since last sitting": prior brief + programmatic numeric deltas per dept.
  // "None of your numbers moved" is only claimed when a prior snapshot actually
  // exists to compare against — no prior data is NOT the same as no movement.
  const lastSitting: Partial<Record<Dept, string>> = {}
  for (const d of DEPTS) {
    const pb = prior?.briefs?.find(b => b.dept === d)
    const priorSummary = prior?.dataSummaries?.[d]
    const deltas = diffSummaries(priorSummary, data[d].summary)
    const measuredLine = !priorSummary ? ''
      : deltas.length ? `Measured change since: ${deltas.join(' · ')}`
      : 'Measured change since: none of your numbers moved.'
    if (!pb && !measuredLine) continue
    lastSitting[d] = [
      pb ? `You said: "${pb.headline}" → recommended: ${pb.recommendedMove}` : '',
      measuredLine,
    ].filter(Boolean).join('\n')
  }

  const gatherOpts = (d: Dept, critique?: string) => ({
    cfg,
    memory: memory[d],
    context,
    question,
    critique,
    lastSitting: lastSitting[d],
    trackRecord: trackRecords[d] ? `${trackRecords[d].held} held / ${trackRecords[d].wrong} wrong / ${trackRecords[d].inconclusive} inconclusive` : undefined,
  })

  // 1) Gather — every head reads its own data + memory in parallel.
  let briefs = await Promise.all(DEPTS.map(d => io.gatherHeadBrief(d, data[d], gatherOpts(d))))

  // 2) Challenge — the manager grills them against the raw data.
  let outcome = await io.challenge(briefs, cfg, context, data, standing, question)

  // 3) Rebuttal — rejected heads revise, bounded by C_SUITE_DEBATE_ROUNDS.
  let rounds = 1
  for (let r = 0; r < cfg.debateRounds; r++) {
    const rejected = outcome.challenges.filter(c => c.verdict === 'REJECT').map(c => c.dept)
    if (!rejected.length) break
    const revised = await Promise.all(rejected.map(d =>
      io.gatherHeadBrief(d, data[d], gatherOpts(d, outcome.challenges.find(c => c.dept === d)?.critique)),
    ))
    // A failed rebuttal (confidence-0 degraded stub) must not erase the head's
    // real brief from the audit trail — keep the original in that case.
    briefs = briefs.map(b => {
      const rv = revised.find(x => x.dept === b.dept)
      if (!rv) return b
      const rvDegraded = rv.confidence === 0 && rv.headline.includes('could not complete brief')
      return rvDegraded ? b : rv
    })
    outcome = await io.challenge(briefs, cfg, context, data, standing, question)
    rounds++
  }

  // 4) Rule — SocietyOfMind synthesis (told when verdicts are unvetted).
  const { rulings, boardBrief } = await io.rule(briefs, outcome, cfg, context, data, standing, question)

  return {
    mode,
    question,
    briefs,
    challenges: outcome.challenges,
    rulings,
    boardBrief,
    rounds,
    challengeDegraded: outcome.degraded || undefined,
    dataSummaries: Object.fromEntries(DEPTS.map(d => [d, data[d].summary])) as BoardResult['dataSummaries'],
  }
}