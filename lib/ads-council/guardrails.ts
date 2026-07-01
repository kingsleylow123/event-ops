// Ads Council Agent — deterministic guardrails (pure: no I/O, fully testable).
// Sits BELOW the council so no LLM verdict can exceed these limits. Budget moves
// are clamped to ±maxBudgetChangePct, checked against the budget governor and
// Meta's minimum, and budget changes on entities without a daily budget (CBO) are
// rejected rather than guessed.

import type { AdsConfig } from './config'
import { toMinor } from './config'
import type { ActionType, EntityState, GuardrailResult, Scope } from './types'

const META_MIN_DAILY_MINOR = 100 // ~1.00 in account currency; Meta rejects lower daily budgets

export interface GuardrailInput {
  actionType: ActionType
  proposedSettings: Record<string, unknown>
  scope: Scope
}

export function runGuardrails(input: GuardrailInput, state: EntityState, cfg: AdsConfig): GuardrailResult {
  const reasons: string[] = []
  const clampedSettings: Record<string, unknown> = {}
  const willChangeBudget = input.actionType === 'scale' || input.actionType === 'shift_budget'

  // Non-budget, reversible actions: pause is always allowed; refresh_creative is
  // advisory in v1 (no live write). none/escalate are never executed.
  if (input.actionType === 'pause') {
    return { ok: true, reasons, clampedSettings, willChangeBudget: false }
  }
  if (input.actionType === 'refresh_creative') {
    return { ok: true, reasons: ['advisory: creative refresh is delivered as copy + brief, no live write in v1'], clampedSettings, willChangeBudget: false }
  }
  if (input.actionType === 'none' || input.actionType === 'escalate' || input.actionType === 'test_audience') {
    return { ok: false, reasons: [`action_type '${input.actionType}' is not executable`], clampedSettings, willChangeBudget: false }
  }

  // Budget actions (scale / shift_budget).
  if (state.dailyBudgetMinor == null) {
    reasons.push('entity has no daily budget (campaign-budget-optimised?) — cannot change a daily budget here')
    return { ok: false, reasons, clampedSettings, willChangeBudget }
  }

  const requestedPct = Number(input.proposedSettings.budgetChangePct)
  if (!Number.isFinite(requestedPct) || requestedPct === 0) {
    reasons.push('no valid budgetChangePct provided')
    return { ok: false, reasons, clampedSettings, willChangeBudget }
  }

  // shift_budget is a cost-DOWN action by definition — never let it raise spend.
  if (input.actionType === 'shift_budget' && requestedPct > 0) {
    reasons.push('shift_budget must reduce spend (positive change rejected)')
    return { ok: false, reasons, clampedSettings, willChangeBudget }
  }

  // Hard clamp to ±maxBudgetChangePct.
  const cap = Math.abs(cfg.maxBudgetChangePct)
  const clampedPct = Math.max(-cap, Math.min(cap, requestedPct))
  if (clampedPct !== requestedPct) reasons.push(`budget change clamped ${requestedPct}% → ${clampedPct}% (cap ±${cap}%)`)

  const current = state.dailyBudgetMinor
  const newMinor = Math.round(current * (1 + clampedPct / 100))

  if (newMinor < META_MIN_DAILY_MINOR) {
    reasons.push(`new daily budget below Meta minimum`)
    return { ok: false, reasons, clampedSettings, willChangeBudget }
  }

  // Budget governor (account ceiling), if configured.
  if (cfg.budgetGovernorDaily > 0) {
    const ceiling = toMinor(cfg.budgetGovernorDaily)
    if (newMinor > ceiling) {
      reasons.push(`new daily budget exceeds governor ceiling RM${cfg.budgetGovernorDaily}`)
      return { ok: false, reasons, clampedSettings, willChangeBudget }
    }
  }

  clampedSettings.newDailyBudgetMinor = newMinor
  clampedSettings.appliedPct = clampedPct
  clampedSettings.priorDailyBudgetMinor = current
  return { ok: true, reasons, clampedSettings, willChangeBudget: true }
}
