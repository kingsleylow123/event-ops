import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runGuardrails } from '../guardrails'
import type { AdsConfig } from '../config'
import type { EntityState } from '../types'

const cfg: AdsConfig = {
  accessToken: 'x', adAccountId: '123', graphVersion: 'v23.0', pageId: '', igUserId: '', currency: 'MYR',
  mode: 'copilot', dryRun: false, maxBudgetChangePct: 20, cooldownHours: 24, budgetGovernorDaily: 0,
  minImpressions: 1000, minResults: 5, minSpend: 50, targetCostPerDm: 0, maxCandidatesPerRun: 12,
  resultActionType: 'messaging_conversation_started', debaterModel: 'claude-haiku-4-5', judgeModel: 'claude-sonnet-4-6',
}

const adset = (dailyMinor: number | null): EntityState => ({
  scope: 'adset', id: 'as_1', status: 'ACTIVE', dailyBudgetMinor: dailyMinor, lifetimeBudgetMinor: null,
})

test('pause is always allowed and changes no budget', () => {
  const r = runGuardrails({ actionType: 'pause', proposedSettings: {}, scope: 'ad' }, adset(5000), cfg)
  assert.equal(r.ok, true)
  assert.equal(r.willChangeBudget, false)
})

test('scale +20% within cap computes new daily budget', () => {
  const r = runGuardrails({ actionType: 'scale', proposedSettings: { budgetChangePct: 20 }, scope: 'adset' }, adset(5000), cfg)
  assert.equal(r.ok, true)
  assert.equal(r.clampedSettings.newDailyBudgetMinor, 6000)
})

test('scale +50% is clamped to the +20% cap', () => {
  const r = runGuardrails({ actionType: 'scale', proposedSettings: { budgetChangePct: 50 }, scope: 'adset' }, adset(5000), cfg)
  assert.equal(r.ok, true)
  assert.equal(r.clampedSettings.appliedPct, 20)
  assert.equal(r.clampedSettings.newDailyBudgetMinor, 6000)
  assert.ok(r.reasons.some(x => x.includes('clamped')))
})

test('budget governor blocks an over-ceiling increase', () => {
  const withGov: AdsConfig = { ...cfg, budgetGovernorDaily: 55 } // RM55 ceiling
  const r = runGuardrails({ actionType: 'scale', proposedSettings: { budgetChangePct: 20 }, scope: 'adset' }, adset(5000), withGov)
  // 5000 minor (RM50) +20% = 6000 minor (RM60) > RM55 ceiling → blocked
  assert.equal(r.ok, false)
  assert.ok(r.reasons.some(x => x.includes('governor')))
})

test('budget change on a CBO entity (no daily budget) is rejected, not guessed', () => {
  const r = runGuardrails({ actionType: 'shift_budget', proposedSettings: { budgetChangePct: -50 }, scope: 'adset' }, adset(null), cfg)
  assert.equal(r.ok, false)
  assert.ok(r.reasons.some(x => x.includes('no daily budget')))
})

test('shift_budget must be cost-down: a positive pct is rejected', () => {
  const r = runGuardrails({ actionType: 'shift_budget', proposedSettings: { budgetChangePct: 20 }, scope: 'adset' }, adset(5000), cfg)
  assert.equal(r.ok, false)
  assert.ok(r.reasons.some(x => x.includes('reduce spend')))
})

test('shift_budget cost-down (negative pct) computes a lower budget', () => {
  const r = runGuardrails({ actionType: 'shift_budget', proposedSettings: { budgetChangePct: -20 }, scope: 'adset' }, adset(5000), cfg)
  assert.equal(r.ok, true)
  assert.equal(r.clampedSettings.newDailyBudgetMinor, 4000)
})

test('escalate / none are never executable', () => {
  for (const at of ['escalate', 'none'] as const) {
    const r = runGuardrails({ actionType: at, proposedSettings: {}, scope: 'ad' }, adset(5000), cfg)
    assert.equal(r.ok, false)
  }
})
