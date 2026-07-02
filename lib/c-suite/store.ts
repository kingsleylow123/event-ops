// AI C-Suite — Supabase data access. Thin wrappers around the service-role client;
// all c_suite_* tables are server-only (RLS on, no policies). Keep raw table
// knowledge in this file only. Mirrors lib/ads-council/store.ts.

import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import type { BoardMode, BoardResult, DecisionStatus, Dept, HeadBrief, Prediction, Ruling } from './types'

// c_suite_* are RLS-on with NO policies, so the anon-key fallback in the shared
// admin client would silently no-op. Use this to fail LOUD instead.
export function serviceRoleConfigured(): boolean {
  return !!process.env.SUPABASE_SERVICE_ROLE_KEY
}

// ── Runs ──────────────────────────────────────────────────────────────────────
export async function createRun(input: {
  mode: BoardMode
  question?: string
  dryRun: boolean
  source?: string       // 'app' | 'ingest'
  fingerprint?: string  // sha256 of the ingested body (idempotency)
}): Promise<string | null> {
  const { data, error } = await supabase
    .from('c_suite_runs')
    .insert({
      mode: input.mode,
      question: input.question ?? null,
      dry_run: input.dryRun,
      source: input.source ?? 'app',
      fingerprint: input.fingerprint ?? null,
    })
    .select('id')
    .single()
  if (error) {
    console.error('[c-suite] createRun', error.message)
    return null
  }
  return data.id as string
}

// Idempotency check for ingest: has this exact body been persisted already?
export async function findRunByFingerprint(fingerprint: string): Promise<string | null> {
  const { data } = await supabase.from('c_suite_runs').select('id').eq('fingerprint', fingerprint).maybeSingle()
  return ((data as { id?: string } | null)?.id) ?? null
}

// Recover runs stranded by a hard process kill (Vercel maxDuration / cold start),
// which a try/catch in-process cannot catch. Mirrors ads-council reapStale.
// Clears the fingerprint so a retry of the SAME ingested board isn't swallowed
// by the idempotency check against a run that never actually completed.
export async function reapStale(maxMinutes = 20): Promise<void> {
  const cutoff = new Date(Date.now() - maxMinutes * 60_000).toISOString()
  await supabase.from('c_suite_runs')
    .update({ status: 'error', note: 'reaped: stranded running', fingerprint: null, finished_at: new Date().toISOString() })
    .eq('status', 'running').lt('started_at', cutoff)
}

export async function finishRun(
  runId: string,
  patch: { status: string; rounds?: number; board_brief?: string; note?: string; fingerprint?: string | null },
): Promise<void> {
  await supabase.from('c_suite_runs').update({ ...patch, finished_at: new Date().toISOString() }).eq('id', runId)
}

// ── Opinions (each head's brief) ──────────────────────────────────────────────
// Returns false on failure so persist() can count losses into the run note
// instead of stamping "done" over a partial audit trail.
export async function insertOpinion(runId: string | null, brief: HeadBrief): Promise<boolean> {
  const { error } = await supabase.from('c_suite_opinions').insert({
    run_id: runId,
    dept: brief.dept,
    headline: brief.headline,
    top_issue: brief.topIssue,
    recommended_move: brief.recommendedMove,
    confidence: Math.round(brief.confidence),
    evidence: brief.evidence,
    data_status: brief.dataStatus,
    revised: brief.revised ?? false,
  })
  if (error) console.error('[c-suite] insertOpinion', error.message)
  return !error
}

// ── Decisions (manager rulings) ───────────────────────────────────────────────
// Returns the new row id (needed for Telegram done/dismiss/snooze buttons).
export async function insertDecision(runId: string | null, r: Ruling): Promise<string | null> {
  const { data, error } = await supabase.from('c_suite_decisions').insert({
    run_id: runId,
    title: r.title,
    decision: r.decision,
    rationale: r.rationale,
    overruled: r.overruled,
    priority: r.priority,
    confidence: Math.round(r.confidence),
  }).select('id').single()
  if (error) {
    console.error('[c-suite] insertDecision', error.message)
    return null
  }
  return data.id as string
}

// Status transition guarded by the expected current status (optimistic
// concurrency — two taps on the same Telegram button can't both fire).
// Tri-state so callers can tell "someone else decided" from "Supabase errored"
// and answer the human honestly.
export type TransitionResult = 'moved' | 'conflict' | 'error'

export async function transitionDecision(
  id: string,
  from: DecisionStatus,
  to: DecisionStatus,
  decidedBy: string,
): Promise<TransitionResult> {
  const { data, error } = await supabase
    .from('c_suite_decisions')
    .update({ status: to, decided_by: decidedBy, decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', from)
    .select('id')
  if (error) {
    console.error('[c-suite] transitionDecision', error.message)
    return 'error'
  }
  return data && data.length > 0 ? 'moved' : 'conflict'
}

export interface OpenDecision {
  id: string
  title: string | null
  decision: string | null
  priority: string | null
  created_at: string
}

// Standing rulings: still-open decisions from PRIOR runs, injected into the
// next sitting so the board knows what it already asked for (no groundhog day).
// Snoozed counts as open — that's the whole promise of the snooze button.
export async function getOpenDecisions(limit = 8): Promise<OpenDecision[]> {
  const { data, error } = await supabase
    .from('c_suite_decisions')
    .select('id, title, decision, priority, created_at')
    .in('status', ['pending', 'snoozed'])
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('[c-suite] getOpenDecisions', error.message)
    return []
  }
  return (data ?? []) as OpenDecision[]
}

export async function getDecision(id: string): Promise<{ id: string; title: string | null; status: string; decided_by: string | null } | null> {
  const { data } = await supabase.from('c_suite_decisions').select('id, title, status, decided_by').eq('id', id).maybeSingle()
  return (data as { id: string; title: string | null; status: string; decided_by: string | null }) ?? null
}

// ── Shared company context (app_id scope) ─────────────────────────────────────
export async function getCompanyContext(): Promise<Record<string, unknown>> {
  const { data } = await supabase.from('c_suite_company_context').select('context').eq('id', 'default').maybeSingle()
  return ((data as { context?: Record<string, unknown> } | null)?.context) ?? {}
}

// ── Per-head memory (agent_id scope) ──────────────────────────────────────────
export async function loadHeadMemory(dept: Dept, limit = 8): Promise<string[]> {
  const { data, error } = await supabase
    .from('c_suite_head_memory')
    .select('learning')
    .eq('dept', dept)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('[c-suite] loadHeadMemory', error.message)
    return []
  }
  return (data ?? []).map(r => (r as { learning: string }).learning).reverse()
}

export async function saveHeadMemory(dept: Dept, learning: string, runId: string | null, source = 'app'): Promise<void> {
  const trimmed = learning.trim().slice(0, 500)
  if (!trimmed) return
  await supabase.from('c_suite_head_memory').insert({ dept, learning: trimmed, run_id: runId, source })
}

// ── Outcomes (predicted vs actual — the learning loop) ────────────────────────
export async function recordPrediction(
  runId: string | null,
  dept: Dept,
  predicted: Record<string, unknown> & { prediction?: Prediction },
): Promise<void> {
  await supabase.from('c_suite_outcomes').insert({ run_id: runId, dept, predicted })
}

export interface UngradedOutcome {
  id: string
  dept: Dept
  created_at: string
  predicted: { recommendedMove?: string; prediction?: Prediction; event_id?: string }
}

// Predictions old enough to grade (>= minHours) that nothing has measured yet.
export async function getUngradedOutcomes(minHours = 20): Promise<UngradedOutcome[]> {
  const cutoff = new Date(Date.now() - minHours * 3600_000).toISOString()
  const { data, error } = await supabase
    .from('c_suite_outcomes')
    .select('id, dept, created_at, predicted')
    .is('actual', null)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(50)
  if (error) {
    console.error('[c-suite] getUngradedOutcomes', error.message)
    return []
  }
  return (data ?? []) as UngradedOutcome[]
}

export async function gradeOutcome(
  id: string,
  actual: Record<string, unknown>,
  verdict: 'held' | 'wrong' | 'inconclusive',
): Promise<void> {
  // Guarded on verdict IS NULL — the first grader wins, concurrent re-grades no-op.
  await supabase.from('c_suite_outcomes')
    .update({ actual, verdict, measured_at: new Date().toISOString() })
    .eq('id', id)
    .is('verdict', null)
}

// Per-head track record ("Sales: 6/9 held") — injected into head prompts and the
// dashboard so confidence is EARNED, not asserted. Windowed to the most recent
// 400 graded outcomes: recent form is the better signal, and an unbounded read
// would silently truncate at PostgREST's 1000-row cap anyway.
export async function getTrackRecords(): Promise<Record<string, { held: number; wrong: number; inconclusive: number }>> {
  const { data, error } = await supabase
    .from('c_suite_outcomes')
    .select('dept, verdict')
    .not('verdict', 'is', null)
    .order('measured_at', { ascending: false })
    .limit(400)
  if (error) {
    console.error('[c-suite] getTrackRecords', error.message)
    return {}
  }
  const out: Record<string, { held: number; wrong: number; inconclusive: number }> = {}
  for (const row of (data ?? []) as Array<{ dept: string; verdict: string }>) {
    const rec = out[row.dept] ?? { held: 0, wrong: 0, inconclusive: 0 }
    if (row.verdict === 'held') rec.held++
    else if (row.verdict === 'wrong') rec.wrong++
    else rec.inconclusive++
    out[row.dept] = rec
  }
  return out
}

// ── State snapshot (save_state / load_state) ──────────────────────────────────
export async function saveState(mode: BoardMode, snapshot: BoardResult): Promise<void> {
  await supabase.from('c_suite_state').upsert({
    id: mode, mode, snapshot, updated_at: new Date().toISOString(),
  })
}
export async function loadState(mode: BoardMode): Promise<BoardResult | null> {
  const { data } = await supabase.from('c_suite_state').select('snapshot').eq('id', mode).maybeSingle()
  return ((data as { snapshot?: BoardResult } | null)?.snapshot) ?? null
}

// ── Dashboard reads ───────────────────────────────────────────────────────────
export interface RunRow {
  id: string
  started_at: string
  finished_at: string | null
  mode: string
  status: string
  question: string | null
  rounds: number | null
  dry_run: boolean
  board_brief: string | null
  note: string | null
  source: string | null
}

const RUN_COLS = 'id, started_at, finished_at, mode, status, question, rounds, dry_run, board_brief, note, source'

export async function getRecentRuns(limit = 20): Promise<RunRow[]> {
  const { data, error } = await supabase
    .from('c_suite_runs')
    .select(RUN_COLS)
    .order('started_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('[c-suite] getRecentRuns', error.message)
    return []
  }
  return (data ?? []) as RunRow[]
}

export async function getRunDetail(runId: string): Promise<{
  run: RunRow | null
  opinions: unknown[]
  decisions: unknown[]
}> {
  const [run, opinions, decisions] = await Promise.all([
    supabase.from('c_suite_runs').select(RUN_COLS).eq('id', runId).maybeSingle(),
    supabase.from('c_suite_opinions').select('*').eq('run_id', runId).order('dept'),
    supabase.from('c_suite_decisions').select('*').eq('run_id', runId).order('created_at'),
  ])
  return {
    run: (run.data as RunRow) ?? null,
    opinions: opinions.data ?? [],
    decisions: decisions.data ?? [],
  }
}
