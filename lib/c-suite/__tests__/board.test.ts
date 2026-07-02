import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deliberate, type BoardDeps, type ChallengeOutcome } from '../board'
import type { BoardResult, Challenge, Dept, HeadBrief } from '../types'
import { DEPTS } from '../types'
import type { DeptData } from '../data'

// The debate loop is the IP — these tests pin its control flow using the deps
// seam (no LLM, no Supabase).

function brief(dept: Dept, over: Partial<HeadBrief> = {}): HeadBrief {
  return {
    dept, headline: `${dept} ok`, topIssue: 'issue', recommendedMove: 'move',
    confidence: 80, evidence: ['e'], dataStatus: 'ok', ...over,
  }
}
function approveAll(): ChallengeOutcome {
  return { challenges: DEPTS.map(d => ({ dept: d, verdict: 'APPROVE' as const, critique: '', crossFlags: [] })), degraded: false }
}
function rejectOnly(dept: Dept): ChallengeOutcome {
  return {
    challenges: DEPTS.map(d => ({
      dept: d,
      verdict: (d === dept ? 'REJECT' : 'APPROVE') as Challenge['verdict'],
      critique: d === dept ? 'weak evidence' : '',
      crossFlags: [],
    })),
    degraded: false,
  }
}
const DATA: Record<Dept, DeptData> = {
  sales: { summary: { total_leads: 6 }, status: 'ok' },
  ops: { summary: { paid: 31 }, status: 'ok' },
  finance: { summary: { unpaid_pending_attendees: 42 }, status: 'ok' },
  marketing: { summary: { survey_responses: 17 }, status: 'ok' },
}

function fakeDeps(over: Partial<BoardDeps> = {}): { deps: Partial<BoardDeps>; calls: { gather: Array<{ dept: Dept; critique?: string }>; challenges: number } } {
  const calls = { gather: [] as Array<{ dept: Dept; critique?: string }>, challenges: 0 }
  const deps: Partial<BoardDeps> = {
    readDeptData: async () => DATA,
    gatherHeadBrief: async (dept, _data, opts) => {
      calls.gather.push({ dept, critique: opts.critique })
      return brief(dept, { revised: !!opts.critique })
    },
    challenge: async () => { calls.challenges++; return approveAll() },
    rule: async () => ({ rulings: [{ title: 'T', decision: 'D', rationale: 'R', overruled: [], priority: 'high' as const, confidence: 90 }], boardBrief: 'brief' }),
    recallHeadMemory: async () => '(no prior memory yet)',
    getCompanyContext: async () => ({ mission: 'test' }),
    loadState: async () => null,
    getOpenDecisions: async () => [],
    getTrackRecords: async () => ({}),
    ...over,
  }
  return { deps, calls }
}

test('happy path: 4 gathers, 1 challenge, 1 round, no degrade', async () => {
  const { deps, calls } = fakeDeps()
  const r = await deliberate('nightly', undefined, deps)
  assert.equal(calls.gather.length, 4)
  assert.equal(calls.challenges, 1)
  assert.equal(r.rounds, 1)
  assert.equal(r.challengeDegraded, undefined)
  assert.equal(r.rulings.length, 1)
})

test('rebuttal: ONLY the rejected head re-gathers, then re-challenge', async () => {
  let round = 0
  const { deps, calls } = fakeDeps({
    challenge: async () => {
      calls.challenges++
      round++
      return round === 1 ? rejectOnly('finance') : approveAll()
    },
  })
  const r = await deliberate('nightly', undefined, deps)
  // 4 initial + exactly 1 re-gather (finance, carrying the critique)
  assert.equal(calls.gather.length, 5)
  const regather = calls.gather[4]
  assert.equal(regather.dept, 'finance')
  assert.equal(regather.critique, 'weak evidence')
  assert.equal(calls.challenges, 2)
  assert.equal(r.rounds, 2)
  // the revised brief replaced the original
  assert.equal(r.briefs.find(b => b.dept === 'finance')?.revised, true)
})

test('rounds are bounded even if the manager keeps rejecting', async () => {
  const { deps, calls } = fakeDeps({
    challenge: async () => { calls.challenges++; return rejectOnly('sales') },
  })
  const r = await deliberate('nightly', undefined, deps)
  // debateRounds defaults to 1 → initial challenge + exactly 1 re-challenge
  assert.equal(calls.challenges, 2)
  assert.equal(r.rounds, 2)
})

test('a degraded challenge is flagged on the result, never silent', async () => {
  const { deps } = fakeDeps({
    challenge: async () => ({ challenges: approveAll().challenges, degraded: true }),
  })
  const r = await deliberate('nightly', undefined, deps)
  assert.equal(r.challengeDegraded, true)
})

test('data summaries are snapshotted for the next sitting', async () => {
  const { deps } = fakeDeps()
  const r = await deliberate('nightly', undefined, deps)
  assert.equal(r.dataSummaries?.finance?.unpaid_pending_attendees, 42)
})

test('prior state feeds "last sitting" context into the heads', async () => {
  const prior: BoardResult = {
    mode: 'nightly', briefs: [brief('ops', { headline: 'oversold 50/40', recommendedMove: 'ultimatum' })],
    challenges: [], rulings: [], boardBrief: '', rounds: 1,
    dataSummaries: { ops: { paid: 28 } },
  }
  const seen: Record<string, string | undefined> = {}
  const { deps } = fakeDeps({
    loadState: async () => prior,
    gatherHeadBrief: async (dept, _data, opts) => {
      seen[dept] = opts.lastSitting
      return brief(dept)
    },
  })
  await deliberate('nightly', undefined, deps)
  assert.ok(seen.ops?.includes('oversold 50/40'))
  assert.ok(seen.ops?.includes('paid 28→31 (+3)'))
  // sales had no prior brief and no prior summary → no last-sitting block
  assert.equal(seen.sales, undefined)
})

test('no prior snapshot → no "none of your numbers moved" claim', async () => {
  // Prior sitting exists but carried no dataSummaries (pre-v2 state): the head
  // must NOT be told its numbers didn't move — there was nothing to compare.
  const prior: BoardResult = {
    mode: 'nightly', briefs: [brief('ops', { headline: 'old take', recommendedMove: 'old move' })],
    challenges: [], rulings: [], boardBrief: '', rounds: 1,
  }
  const seen: Record<string, string | undefined> = {}
  const { deps } = fakeDeps({
    loadState: async () => prior,
    gatherHeadBrief: async (dept, _data, opts) => {
      seen[dept] = opts.lastSitting
      return brief(dept)
    },
  })
  await deliberate('nightly', undefined, deps)
  assert.ok(seen.ops?.includes('old take'))
  assert.ok(!seen.ops?.includes('none of your numbers moved'))
  assert.ok(!seen.ops?.includes('Measured change'))
})

test('a degraded rebuttal does not erase the head\'s real brief', async () => {
  let round = 0
  const { deps } = fakeDeps({
    challenge: async () => {
      round++
      return round === 1 ? rejectOnly('finance') : approveAll()
    },
    gatherHeadBrief: async (dept, _data, opts) => {
      if (opts.critique) {
        // the rebuttal call fails → degraded stub
        return brief(dept, { headline: `${dept} head: could not complete brief`, confidence: 0, revised: true })
      }
      return brief(dept, { headline: `${dept} real take` })
    },
  })
  const r = await deliberate('nightly', undefined, deps)
  // original brief survives; the confidence-0 stub was discarded
  assert.equal(r.briefs.find(b => b.dept === 'finance')?.headline, 'finance real take')
})

test('track records flow into head prompts as earned credibility', async () => {
  const seen: Record<string, string | undefined> = {}
  const { deps } = fakeDeps({
    getTrackRecords: async () => ({ sales: { held: 6, wrong: 2, inconclusive: 1 } }),
    gatherHeadBrief: async (dept, _data, opts) => {
      seen[dept] = opts.trackRecord
      return brief(dept)
    },
  })
  await deliberate('nightly', undefined, deps)
  assert.equal(seen.sales, '6 held / 2 wrong / 1 inconclusive')
  assert.equal(seen.ops, undefined)
})