// Ads Council Agent — deterministic creative-fatigue scorer.
// Pure function (no I/O) so it is unit-testable. Thresholds are reconciled from
// the research (Triple Whale + meta-ads-kit + Madgicx) but RE-ANCHORED to
// cost-per-DM (messaging conversations), NOT ROAS. Leading→lagging order:
// CTR decay first → CPM/frequency → cost-per-result last as the confirming signal.

import type { AdsConfig } from './config'
import type { CandidateAction, EntityInsights, FatigueAssessment, InsightWindow } from './types'

// Fractional week-over-week change. Returns 0 when prior is non-positive (can't
// compute a meaningful ratio).
function wow(curr: number, prior: number): number {
  if (!Number.isFinite(prior) || prior <= 0) return 0
  if (!Number.isFinite(curr)) return 1 // curr Infinity (e.g. cost-per-DM with 0 results) = worst case
  return (curr - prior) / prior
}

function round(n: number, dp = 3): number {
  const f = Math.pow(10, dp)
  return Math.round(n * f) / f
}

export function assessFatigue(e: EntityInsights, cfg: AdsConfig): FatigueAssessment {
  const c: InsightWindow = e.current
  const p: InsightWindow = e.prior

  const ctrWoW = wow(c.ctr, p.ctr)               // negative = CTR decaying
  const cpmWoW = wow(c.cpm, p.cpm)               // positive = CPM rising (bad)
  const costPerDmWoW = wow(c.costPerResult, p.costPerResult) // positive = getting more expensive (bad)
  const frequency = c.frequency

  const degradingMetrics =
    (ctrWoW <= -0.05 ? 1 : 0) + (cpmWoW >= 0.05 ? 1 : 0) + (costPerDmWoW >= 0.05 ? 1 : 0)

  const belowSampleFloor =
    c.impressions < cfg.minImpressions || c.results < cfg.minResults || c.spend < cfg.minSpend

  const saturation = cpmWoW >= 0.5 && Math.abs(ctrWoW) < 0.05

  const signals = {
    ctrWoW: round(ctrWoW),
    cpmWoW: round(cpmWoW),
    costPerDmWoW: round(costPerDmWoW),
    frequency: round(frequency, 2),
    degradingMetrics,
  }

  const supportingData = {
    ctr_wow: signals.ctrWoW,
    cpm_wow: signals.cpmWoW,
    cost_per_dm_wow: signals.costPerDmWoW,
    frequency: signals.frequency,
    spend_7d: round(c.spend, 2),
    impressions_7d: c.impressions,
    dms_7d: c.results,
    cost_per_dm: Number.isFinite(c.costPerResult) ? round(c.costPerResult, 2) : -1,
    cost_per_dm_prior: Number.isFinite(p.costPerResult) ? round(p.costPerResult, 2) : -1,
  }

  // ── REPLACE (most severe): creative exhausted → pause + replace ────────────
  const replace = ctrWoW <= -0.3 || cpmWoW >= 1.0 || frequency > 4 || costPerDmWoW >= 0.5
  // ── REFRESH: degrading on multiple fronts → new creative + trim spend ──────
  const refresh = (ctrWoW <= -0.2 && degradingMetrics >= 2) || frequency > 3.0 || costPerDmWoW >= 0.15

  if (replace) {
    const candidate: CandidateAction = {
      scope: 'ad',
      targetEntityId: e.id,
      targetName: e.name,
      actionType: 'pause',
      proposedSettings: { suggestRefreshCreative: true },
      why:
        `Creative looks exhausted — CTR ${pct(ctrWoW)} WoW, frequency ${frequency.toFixed(1)}, ` +
        `cost/DM ${costStr(c.costPerResult)} (${pct(costPerDmWoW)} WoW). Pause and replace with a fresh creative.`,
      supportingData,
      riskTier: 'low_reversible',
    }
    return { tier: 'replace', belowSampleFloor, saturation, signals, candidate }
  }

  if (refresh) {
    const candidate: CandidateAction = {
      scope: 'ad',
      targetEntityId: e.id,
      targetName: e.name,
      actionType: 'refresh_creative',
      proposedSettings: { suggestBudgetCutPct: 50 },
      why:
        `Fatigue setting in — CTR ${pct(ctrWoW)} WoW, ${degradingMetrics} metrics degrading, ` +
        `frequency ${frequency.toFixed(1)}, cost/DM ${costStr(c.costPerResult)}. Refresh the creative${saturation ? ' (audience looks saturated — CPM rising while CTR flat)' : ''}.`,
      supportingData,
      riskTier: 'high',
    }
    return { tier: 'refresh', belowSampleFloor, saturation, signals, candidate }
  }

  // ── WINNER: cheap, stable DMs → scale the adset budget ─────────────────────
  // Require a real comparison: either a finite prior cost/DM baseline, or the
  // current cost/DM already beats an explicit target. Without one, a single good
  // week off an Infinity prior (no DMs last week) must NOT read as a winner.
  const hasBaseline = Number.isFinite(p.costPerResult) || (cfg.targetCostPerDm > 0 && c.costPerResult <= cfg.targetCostPerDm)
  const isWinner =
    !belowSampleFloor &&
    Number.isFinite(c.costPerResult) &&
    hasBaseline &&
    c.results >= cfg.minResults &&
    costPerDmWoW <= 0.05 &&
    ctrWoW >= -0.05 &&
    frequency < 2.0 &&
    (cfg.targetCostPerDm <= 0 || c.costPerResult <= cfg.targetCostPerDm)

  if (isWinner && e.adsetId) {
    const candidate: CandidateAction = {
      scope: 'adset',
      targetEntityId: e.adsetId,
      targetName: e.name,
      actionType: 'scale',
      proposedSettings: { budgetChangePct: 20 },
      why:
        `Winning ad — cost/DM ${costStr(c.costPerResult)}${cfg.targetCostPerDm > 0 ? ` (target ${costStr(cfg.targetCostPerDm)})` : ''}, ` +
        `CTR ${pct(ctrWoW)} WoW, frequency ${frequency.toFixed(1)}. Consider scaling the adset budget.`,
      supportingData,
      riskTier: 'high',
    }
    return { tier: 'winner', belowSampleFloor, saturation, signals, candidate }
  }

  // ── WATCH: early signal, monitor only (no action queued in v1) ─────────────
  if (ctrWoW <= -0.1 || frequency >= 2.5 || saturation) {
    return { tier: 'watch', belowSampleFloor, saturation, signals, candidate: null }
  }

  return { tier: 'none', belowSampleFloor, saturation, signals, candidate: null }
}

function pct(frac: number): string {
  const p = Math.round(frac * 100)
  return (p > 0 ? '+' : '') + p + '%'
}
function costStr(v: number): string {
  return Number.isFinite(v) ? 'RM' + v.toFixed(2) : 'RM∞ (no DMs)'
}
