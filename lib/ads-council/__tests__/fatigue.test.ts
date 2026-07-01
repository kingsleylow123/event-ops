import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assessFatigue } from '../fatigue'
import type { AdsConfig } from '../config'
import type { EntityInsights, InsightWindow } from '../types'

const cfg: AdsConfig = {
  accessToken: 'x', adAccountId: '123', graphVersion: 'v23.0', pageId: '', igUserId: '', currency: 'MYR',
  mode: 'copilot', dryRun: false, maxBudgetChangePct: 20, cooldownHours: 24, budgetGovernorDaily: 0,
  minImpressions: 1000, minResults: 5, minSpend: 50, targetCostPerDm: 0, maxCandidatesPerRun: 12,
  resultActionType: 'messaging_conversation_started', debaterModel: 'claude-haiku-4-5', judgeModel: 'claude-sonnet-4-6',
}

function win(p: Partial<InsightWindow>): InsightWindow {
  const spend = p.spend ?? 100
  const results = p.results ?? 10
  return {
    impressions: p.impressions ?? 5000,
    spend,
    ctr: p.ctr ?? 1.5,
    cpm: p.cpm ?? 20,
    frequency: p.frequency ?? 1.5,
    results,
    costPerResult: p.costPerResult ?? (results > 0 ? spend / results : Infinity),
  }
}

function entity(current: InsightWindow, prior: InsightWindow): EntityInsights {
  return { scope: 'ad', id: 'ad_1', name: 'Test Ad', adsetId: 'as_1', campaignId: 'c_1', status: 'ACTIVE', current, prior }
}

test('winner → scale candidate on the adset', () => {
  const a = assessFatigue(entity(
    win({ ctr: 2.0, frequency: 1.4, results: 25, spend: 100, costPerResult: 4 }),
    win({ ctr: 2.0, frequency: 1.3, results: 25, spend: 100, costPerResult: 4 }),
  ), cfg)
  assert.equal(a.tier, 'winner')
  assert.equal(a.candidate?.actionType, 'scale')
  assert.equal(a.candidate?.scope, 'adset')
  assert.equal(a.candidate?.targetEntityId, 'as_1')
})

test('CTR collapse + high frequency → replace (pause) candidate', () => {
  const a = assessFatigue(entity(
    win({ ctr: 0.6, frequency: 5, results: 5, spend: 100, costPerResult: 20 }),
    win({ ctr: 1.2, frequency: 3, results: 12, spend: 100, costPerResult: 8 }),
  ), cfg)
  assert.equal(a.tier, 'replace')
  assert.equal(a.candidate?.actionType, 'pause')
  assert.equal(a.candidate?.scope, 'ad')
})

test('moderate decay across metrics → refresh candidate', () => {
  const a = assessFatigue(entity(
    win({ ctr: 0.8, cpm: 30, frequency: 2.8, results: 8, spend: 64, costPerResult: 8 }),
    win({ ctr: 1.0, cpm: 24, frequency: 2.4, results: 10, spend: 60, costPerResult: 6 }),
  ), cfg)
  assert.equal(a.tier, 'refresh')
  assert.equal(a.candidate?.actionType, 'refresh_creative')
})

test('below sample floor is flagged (so the significance critic can veto)', () => {
  const a = assessFatigue(entity(
    win({ impressions: 200, results: 1, spend: 10, ctr: 0.5, frequency: 5 }),
    win({ ctr: 1.5 }),
  ), cfg)
  assert.equal(a.belowSampleFloor, true)
})

test('stable-but-mediocre ad → none (no card)', () => {
  const a = assessFatigue(entity(
    win({ ctr: 0.93, frequency: 2.0, results: 8, costPerResult: 5 }),
    win({ ctr: 1.0, frequency: 2.0, results: 8, costPerResult: 5 }),
  ), cfg)
  assert.equal(a.tier, 'none')
  assert.equal(a.candidate, null)
})

test('no winner without a real prior baseline (prior week had zero DMs)', () => {
  const a = assessFatigue(entity(
    win({ ctr: 2.0, frequency: 1.4, results: 25, spend: 100, costPerResult: 4 }),
    win({ ctr: 2.0, frequency: 1.3, results: 0, spend: 80, costPerResult: Infinity }),
  ), cfg)
  assert.notEqual(a.tier, 'winner')
})

test('saturation: CPM rising while CTR flat is detected', () => {
  const a = assessFatigue(entity(
    win({ ctr: 1.0, cpm: 40, frequency: 2.0, results: 8 }),
    win({ ctr: 1.0, cpm: 24, frequency: 2.0, results: 8 }),
  ), cfg)
  assert.equal(a.saturation, true)
})
