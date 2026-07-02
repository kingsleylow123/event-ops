// AI C-Suite — defensive normalisation of an EXTERNAL board result (posted by the
// Claude Code harness on Kingsley's subscription) before it is persisted. Pure +
// unit-tested; the POST /api/c-suite/ingest route is a thin wrapper around this.

import { DEPTS } from './types'
import type { BoardResult, BoardMode, Dept, HeadBrief, Challenge, Prediction, Ruling } from './types'

const MODES: BoardMode[] = ['nightly', 'weekly', 'ondemand']
function isDept(v: unknown): v is Dept { return DEPTS.includes(v as Dept) }

function normalizePrediction(raw: unknown): Prediction | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const p = raw as Record<string, unknown>
  const metric = String(p.metric ?? '').slice(0, 80)
  const direction = p.direction === 'down' ? 'down' : p.direction === 'up' ? 'up' : null
  const baseline = Number(p.baseline)
  if (!metric || !direction || !Number.isFinite(baseline)) return undefined
  // Derived deltas are not level metrics — grading them is meaningless.
  if (metric.startsWith('trend_vs_prior_week')) return undefined
  // Drop degenerate targets (already met at baseline) — they'd grade 'held' for
  // a metric that never moved. Keep the directional claim.
  const target = Number(p.target)
  const targetOk = Number.isFinite(target) && (direction === 'up' ? target > baseline : target < baseline)
  return { metric, direction, baseline, ...(targetOk ? { target } : {}) }
}

export function normalizeBoardResult(b: unknown): BoardResult | null {
  if (!b || typeof b !== 'object') return null
  const o = b as Record<string, unknown>
  const mode: BoardMode = MODES.includes(o.mode as BoardMode) ? (o.mode as BoardMode) : 'ondemand'

  // One brief per dept — the first wins; a duplicate-dept payload is a harness
  // bug, not a bigger board.
  const seenDepts = new Set<Dept>()
  const briefs: HeadBrief[] = Array.isArray(o.briefs)
    ? (o.briefs as Record<string, unknown>[]).filter(x => {
        if (!isDept(x.dept) || seenDepts.has(x.dept as Dept)) return false
        seenDepts.add(x.dept as Dept)
        return true
      }).map(x => ({
        dept: x.dept as Dept,
        headline: String(x.headline ?? ''),
        topIssue: String(x.topIssue ?? ''),
        recommendedMove: String(x.recommendedMove ?? ''),
        confidence: Number(x.confidence) || 0,
        evidence: Array.isArray(x.evidence) ? x.evidence.map(String).slice(0, 8) : [],
        dataStatus: String(x.dataStatus ?? 'ok'),
        revised: !!x.revised,
        prediction: normalizePrediction(x.prediction),
      }))
    : []

  const challenges: Challenge[] = Array.isArray(o.challenges)
    ? (o.challenges as Record<string, unknown>[]).filter(x => isDept(x.dept)).map(x => ({
        dept: x.dept as Dept,
        verdict: x.verdict === 'REJECT' ? 'REJECT' : 'APPROVE',
        critique: String(x.critique ?? ''),
        crossFlags: Array.isArray(x.crossFlags) ? x.crossFlags.map(String).slice(0, 5) : [],
      }))
    : []

  const rulings: Ruling[] = Array.isArray(o.rulings)
    ? (o.rulings as Record<string, unknown>[]).map(x => {
        const p = String(x.priority ?? 'medium')
        return {
          title: String(x.title ?? 'Ruling'),
          decision: String(x.decision ?? ''),
          rationale: String(x.rationale ?? ''),
          overruled: Array.isArray(x.overruled) ? x.overruled.map(String).slice(0, 5) : [],
          priority: (p === 'high' || p === 'low' ? p : 'medium') as Ruling['priority'],
          confidence: Number(x.confidence) || 0,
        }
      }).slice(0, 5)
    : []

  // A valid board needs BOTH the gathering (heads) and the ruling (manager).
  if (!briefs.length || !rulings.length) return null

  // Optional per-dept data summaries (the harness's own reads) — kept so the
  // NEXT sitting can diff "since last sitting" against them.
  let dataSummaries: BoardResult['dataSummaries']
  if (o.dataSummaries && typeof o.dataSummaries === 'object' && !Array.isArray(o.dataSummaries)) {
    const ds: Record<string, Record<string, unknown>> = {}
    for (const [k, v] of Object.entries(o.dataSummaries as Record<string, unknown>)) {
      if (isDept(k) && v && typeof v === 'object' && !Array.isArray(v)) ds[k] = v as Record<string, unknown>
    }
    if (Object.keys(ds).length) dataSummaries = ds as BoardResult['dataSummaries']
  }

  return {
    mode,
    question: typeof o.question === 'string' ? o.question : undefined,
    briefs, challenges, rulings,
    boardBrief: String(o.boardBrief ?? '').slice(0, 2000),
    rounds: Number(o.rounds) || 1,
    challengeDegraded: o.challengeDegraded === true || undefined,
    dataSummaries,
  }
}
