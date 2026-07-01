// Ads Council Agent — shared types (the council → executor contract).
// Plain TypeScript (this repo does not use zod). Keep this the single source of
// truth for the shapes every module passes around.

export type Scope = 'ad' | 'adset' | 'campaign'

export type ActionType =
  | 'scale'           // increase budget on a winner
  | 'pause'           // pause a fatigued/dead entity (NEVER delete)
  | 'refresh_creative'// generate + upload a fresh creative (PAUSED)
  | 'shift_budget'    // cut/reallocate budget
  | 'test_audience'   // spin up a new audience test (PAUSED)
  | 'none'            // monitor only — nothing to do
  | 'escalate'        // council could not reach a confident verdict → ask Kingsley

export type RiskTier = 'low_reversible' | 'high'

export type AutonomyMode = 'copilot' | 'risk_tiered'

export type FatigueTier = 'none' | 'watch' | 'refresh' | 'replace' | 'winner'

// A single Meta insights window (already normalised to numbers).
export interface InsightWindow {
  impressions: number
  spend: number          // account currency (e.g. RM)
  ctr: number            // %, link or all — whichever Meta returns; we use it consistently
  cpm: number            // account currency per 1000 impr
  frequency: number
  results: number        // messaging conversations started (our cost-per-DM numerator denominator)
  costPerResult: number  // spend / results (cost-per-DM); Infinity if results === 0
}

// One ad (or adset) with its current + prior comparison windows.
export interface EntityInsights {
  scope: Scope
  id: string
  name: string
  adsetId?: string
  campaignId?: string
  status: string         // ACTIVE | PAUSED | ...
  effectiveStatus?: string
  current: InsightWindow // most recent window (e.g. last 7d)
  prior: InsightWindow   // the window before it (e.g. the 7d before that)
}

// Output of the deterministic fatigue scorer.
export interface FatigueAssessment {
  tier: FatigueTier
  belowSampleFloor: boolean    // true if the entity has too little data to act on a KILL
  saturation: boolean          // CPM rising while CTR flat
  signals: {
    ctrWoW: number             // fractional change, e.g. -0.27 = down 27%
    cpmWoW: number
    costPerDmWoW: number
    frequency: number
    degradingMetrics: number   // how many of CTR/CPM/cost-per-DM are worsening
  }
  candidate: CandidateAction | null // the proposed action to debate, or null for 'none'
}

// A proposed action emitted by the fatigue scorer, BEFORE the council debates it.
export interface CandidateAction {
  scope: Scope
  targetEntityId: string
  targetName: string
  actionType: ActionType
  proposedSettings: Record<string, unknown>
  why: string                          // the scorer's plain-English reasoning
  supportingData: Record<string, number | string | boolean>
  riskTier: RiskTier
}

// One council member's opinion (the WHY each agent must justify).
export interface CouncilOpinion {
  role: 'scale_advocate' | 'kill_advocate' | 'significance_critic' | 'funnel_fit_critic'
  position: string                     // short verdict, e.g. "scale" / "pause" / "veto" / "ok"
  argument: string                     // the justification
  veto?: boolean                       // significance critic can hard-veto a kill
  metricsCited?: string[]
}

// The Judge's final, committable decision (verdict-with-reason).
export interface Decision {
  scope: Scope
  targetEntityId: string
  targetName: string
  actionType: ActionType
  proposedSettings: Record<string, unknown>
  why: string                          // carried from the candidate (fatigue scorer)
  supportingData: Record<string, number | string | boolean>
  confidence: number                   // 0-100 (the Judge's confidence)
  riskTier: RiskTier
  verdictReason: string                // the Judge's WHY — required before anything is queued
  transcript: CouncilOpinion[]         // full debate for the audit log
}

// Current live state of a Meta entity (used for snapshot/rollback + clamping).
export interface EntityState {
  scope: Scope
  id: string
  status: string                       // ACTIVE | PAUSED
  dailyBudgetMinor: number | null      // budget in MINOR units (sen for MYR), or null if lifetime/CBO
  lifetimeBudgetMinor: number | null
}

// Result of running the deterministic guardrails over a Decision.
export interface GuardrailResult {
  ok: boolean
  reasons: string[]                    // why it was blocked / what was clamped
  clampedSettings: Record<string, unknown>
  willChangeBudget: boolean
}
