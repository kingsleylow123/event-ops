// AI C-Suite — current per-dept data for OUTCOME GRADING.
// Same readers the board uses (so a predicted metric key resolves identically),
// without pulling in board.ts (avoids a run.ts ↔ board.ts cycle).
// Carries per-dept STATUS and the active event id: grading must refuse to score
// against partial data (fabricated zeroes) or a different event (metric drift).

import type { Dept } from './types'
import { getActiveEvent, salesData, opsData, financeData, marketingData, getTrends, type DeptData } from './data'
import { DEPTS } from './types'

export interface MeasureContext {
  depts: Record<Dept, DeptData>          // summary + 'ok' | 'partial: ...' per dept
  activeEventId: string | null
}

export async function readMeasureContext(): Promise<MeasureContext> {
  const ev = await getActiveEvent()
  const [sales, ops, finance, marketing, trend] = await Promise.all([
    salesData(), opsData(ev), financeData(ev), marketingData(ev), getTrends(ev),
  ])
  const depts: Record<Dept, DeptData> = { sales, ops, finance, marketing }
  if (trend) for (const d of DEPTS) depts[d].summary.trend_vs_prior_week = trend
  return { depts, activeEventId: ev?.id ?? null }
}