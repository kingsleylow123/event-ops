// AI C-Suite — shared types (the single source of truth for shapes every module
// passes around). Plain TypeScript (this repo does not use zod), mirroring
// lib/ads-council/types.ts.

export type Dept = 'sales' | 'ops' | 'finance' | 'marketing'
export type BoardMode = 'nightly' | 'weekly' | 'ondemand'

export const DEPTS: Dept[] = ['sales', 'ops', 'finance', 'marketing']

// One head's brief for a run: its OWN read of the data + its recommendation.
export interface HeadBrief {
  dept: Dept
  headline: string          // one-line status of this function
  topIssue: string          // the single most important issue this head sees
  recommendedMove: string   // what this head recommends the business do
  confidence: number        // 0-100
  evidence: string[]        // bullet metrics/facts cited (from real data)
  dataStatus: string        // 'ok' | 'partial: ...' — provenance / degrade note
  revised?: boolean         // true if rewritten after a manager REJECT
}

// The manager's challenge of one head (the LGTM/LBTM verdict + cross-flags).
export interface Challenge {
  dept: Dept
  verdict: 'APPROVE' | 'REJECT'
  critique: string          // why — the grilling
  crossFlags: string[]      // cross-functional conflicts this head's move creates
}

// One manager ruling (a synthesised best-practice decision).
export interface Ruling {
  title: string
  decision: string          // the best-practice call
  rationale: string
  overruled: string[]       // which heads/positions were overruled and why
  priority: 'high' | 'medium' | 'low'
  confidence: number
}

// The full output of a board sitting.
export interface BoardResult {
  mode: BoardMode
  question?: string
  briefs: HeadBrief[]
  challenges: Challenge[]
  rulings: Ruling[]
  boardBrief: string        // the manager's overall narrative (for Telegram)
  rounds: number
}
