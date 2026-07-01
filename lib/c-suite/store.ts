// AI C-Suite — Supabase data access. Thin wrappers around the service-role client;
// all c_suite_* tables are server-only (RLS on, no policies). Keep raw table
// knowledge in this file only. Mirrors lib/ads-council/store.ts.

import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import type { BoardMode, BoardResult, Dept, HeadBrief, Ruling } from './types'

// c_suite_* are RLS-on with NO policies, so the anon-key fallback in the shared
// admin client would silently no-op. Use this to fail LOUD instead.
export function serviceRoleConfigured(): boolean {
  return !!process.env.SUPABASE_SERVICE_ROLE_KEY
}

// ── Runs ──────────────────────────────────────────────────────────────────────
export async function createRun(input: { mode: BoardMode; question?: string; dryRun: boolean }): Promise<string | null> {
  const { data, error } = await supabase
    .from('c_suite_runs')
    .insert({ mode: input.mode, question: input.question ?? null, dry_run: input.dryRun })
    .select('id')
    .single()
  if (error) {
    console.error('[c-suite] createRun', error.message)
    return null
  }
  return data.id as string
}

export async function finishRun(
  runId: string,
  patch: { status: string; rounds?: number; board_brief?: string; note?: string },
): Promise<void> {
  await supabase.from('c_suite_runs').update({ ...patch, finished_at: new Date().toISOString() }).eq('id', runId)
}

// ── Opinions (each head's brief) ──────────────────────────────────────────────
export async function insertOpinion(runId: string | null, brief: HeadBrief): Promise<void> {
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
}

// ── Decisions (manager rulings) ───────────────────────────────────────────────
export async function insertDecision(runId: string | null, r: Ruling): Promise<void> {
  const { error } = await supabase.from('c_suite_decisions').insert({
    run_id: runId,
    title: r.title,
    decision: r.decision,
    rationale: r.rationale,
    overruled: r.overruled,
    priority: r.priority,
    confidence: Math.round(r.confidence),
  })
  if (error) console.error('[c-suite] insertDecision', error.message)
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

export async function saveHeadMemory(dept: Dept, learning: string, runId: string | null): Promise<void> {
  const trimmed = learning.trim().slice(0, 500)
  if (!trimmed) return
  await supabase.from('c_suite_head_memory').insert({ dept, learning: trimmed, run_id: runId })
}

// ── Outcomes (predicted vs actual — learns over time) ─────────────────────────
export async function recordPrediction(runId: string | null, dept: Dept, predicted: Record<string, unknown>): Promise<void> {
  await supabase.from('c_suite_outcomes').insert({ run_id: runId, dept, predicted })
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
}

export async function getRecentRuns(limit = 20): Promise<RunRow[]> {
  const { data, error } = await supabase
    .from('c_suite_runs')
    .select('id, started_at, finished_at, mode, status, question, rounds, dry_run, board_brief')
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
    supabase.from('c_suite_runs').select('id, started_at, finished_at, mode, status, question, rounds, dry_run, board_brief').eq('id', runId).maybeSingle(),
    supabase.from('c_suite_opinions').select('*').eq('run_id', runId).order('dept'),
    supabase.from('c_suite_decisions').select('*').eq('run_id', runId).order('created_at'),
  ])
  return {
    run: (run.data as RunRow) ?? null,
    opinions: opinions.data ?? [],
    decisions: decisions.data ?? [],
  }
}
