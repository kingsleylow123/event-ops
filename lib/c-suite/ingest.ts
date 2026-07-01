// AI C-Suite — defensive normalisation of an EXTERNAL board result (posted by the
// Claude Code harness on Kingsley's subscription) before it is persisted. Pure +
// unit-tested; the POST /api/c-suite/ingest route is a thin wrapper around this.

import { DEPTS } from './types'
import type { BoardResult, BoardMode, Dept, HeadBrief, Challenge, Ruling } from './types'

const MODES: BoardMode[] = ['nightly', 'weekly', 'ondemand']
function isDept(v: unknown): v is Dept { return DEPTS.includes(v as Dept) }

export function normalizeBoardResult(b: unknown): BoardResult | null {
  if (!b || typeof b !== 'object') return null
  const o = b as Record<string, unknown>
  const mode: BoardMode = MODES.includes(o.mode as BoardMode) ? (o.mode as BoardMode) : 'ondemand'

  const briefs: HeadBrief[] = Array.isArray(o.briefs)
    ? (o.briefs as Record<string, unknown>[]).filter(x => isDept(x.dept)).map(x => ({
        dept: x.dept as Dept,
        headline: String(x.headline ?? ''),
        topIssue: String(x.topIssue ?? ''),
        recommendedMove: String(x.recommendedMove ?? ''),
        confidence: Number(x.confidence) || 0,
        evidence: Array.isArray(x.evidence) ? x.evidence.map(String).slice(0, 8) : [],
        dataStatus: String(x.dataStatus ?? 'ok'),
        revised: !!x.revised,
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

  return {
    mode,
    question: typeof o.question === 'string' ? o.question : undefined,
    briefs, challenges, rulings,
    boardBrief: String(o.boardBrief ?? '').slice(0, 2000),
    rounds: Number(o.rounds) || 1,
  }
}
