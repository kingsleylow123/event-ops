// AI C-Suite — pure loop-closing math (no I/O, unit-tested).
// 1) diffSummaries: "since last sitting" — programmatic numeric diff of a dept's
//    data summary vs the prior snapshot, rendered as compact delta lines.
// 2) gradePrediction: deterministic arithmetic grading of a head's falsifiable
//    prediction (held | wrong | inconclusive). No LLM grader — numbers only.

import type { Prediction } from './types'

// Diff numeric keys (top-level only; nested objects like by_status are diffed
// per-key one level down). Returns compact lines like "paid 31→35 (+4)".
export function diffSummaries(
  prior: Record<string, unknown> | null | undefined,
  current: Record<string, unknown> | null | undefined,
): string[] {
  if (!prior || !current) return []
  const lines: string[] = []
  for (const key of Object.keys(current)) {
    const cur = current[key]
    const prev = prior[key]
    if (typeof cur === 'number' && typeof prev === 'number') {
      if (cur !== prev) lines.push(fmt(key, prev, cur))
    } else if (isRecord(cur) && isRecord(prev)) {
      for (const sub of Object.keys(cur)) {
        const c = cur[sub]
        const p = prev[sub]
        if (typeof c === 'number' && typeof p === 'number' && c !== p) {
          lines.push(fmt(`${key}.${sub}`, p, c))
        }
      }
    }
  }
  return lines.slice(0, 12) // cap: a brief, not a ledger
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function fmt(key: string, prev: number, cur: number): string {
  const d = Math.round((cur - prev) * 100) / 100
  return `${key} ${prev}→${cur} (${d > 0 ? '+' : ''}${d})`
}

export type OutcomeVerdict = 'held' | 'wrong' | 'inconclusive'

// Grade a prediction against the metric's current value.
// - metric missing / non-numeric → inconclusive (data changed shape, don't guess)
// - target set: held iff the target is reached AND the metric actually moved in
//   the predicted direction (a target already met at baseline can't score 'held'
//   for free — that would inflate track records)
// - no target: held iff the metric moved in the predicted direction, wrong iff it
//   moved the opposite way, inconclusive iff unchanged (no noise-band pretence)
export function gradePrediction(p: Prediction, currentValue: unknown): OutcomeVerdict {
  const cur = Number(currentValue)
  if (!Number.isFinite(cur) || !Number.isFinite(Number(p.baseline))) return 'inconclusive'
  const base = Number(p.baseline)
  if (typeof p.target === 'number' && Number.isFinite(p.target)) {
    return p.direction === 'up'
      ? (cur >= p.target && cur > base ? 'held' : cur < base ? 'wrong' : 'inconclusive')
      : (cur <= p.target && cur < base ? 'held' : cur > base ? 'wrong' : 'inconclusive')
  }
  if (cur === base) return 'inconclusive'
  const movedUp = cur > base
  return (p.direction === 'up') === movedUp ? 'held' : 'wrong'
}

// Read a (possibly dotted) metric key out of a data summary.
export function readMetric(summary: Record<string, unknown> | null | undefined, metric: string): unknown {
  if (!summary) return undefined
  if (!metric.includes('.')) return summary[metric]
  const [head, ...rest] = metric.split('.')
  let v: unknown = summary[head]
  for (const part of rest) {
    if (!isRecord(v)) return undefined
    v = v[part]
  }
  return v
}
