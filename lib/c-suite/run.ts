// AI C-Suite — run orchestrator. Convenes the board, persists the full audit
// trail (run + each head's opinion + the manager's rulings), writes a distilled
// learning back to each head's memory (so it gets smarter, not groundhog day),
// snapshots the board state, and posts the Telegram brief (unless dry-run).
//
// Loop-closers (audit council, Jul 2026):
// - measureOutcomes(): before every sitting, grade yesterday's predictions
//   against TODAY's real numbers (deterministic arithmetic, no LLM grader) —
//   the half of the learning loop that was missing.
// - persist() counts failed inserts into the run note instead of stamping
//   "done" over a partial audit trail.
// - reapStale() recovers runs stranded by a hard process kill.
//
// Two entry points share the same persistence:
//   runBoard()      — compute the board HERE (Vercel, API/subscription auth) + persist.
//   ingestResult()  — persist a board computed ELSEWHERE (the Claude Code harness on
//                     Kingsley's Max subscription / Hermes) via POST /api/c-suite/ingest.

import { getCSuiteConfig, cSuiteEnabled, authMode } from './config'
import { deliberate } from './board'
import { readMeasureContext } from './measure'
import { getActiveEvent } from './data'
import {
  createRun, finishRun, findRunByFingerprint, reapStale,
  insertOpinion, insertDecision, recordPrediction, saveState, serviceRoleConfigured,
  getUngradedOutcomes, gradeOutcome,
} from './store'
import { rememberHeadLearning } from './memory'
import { sendBoardBrief } from './telegram-cards'
import { HEADS } from './heads'
import { gradePrediction, readMetric } from './deltas'
import type { BoardMode, BoardResult, Dept } from './types'

export interface RunSummary {
  ok: boolean
  skipped?: string
  runId?: string
  mode?: BoardMode
  rulings?: number
  rounds?: number
  graded?: number
  deduped?: boolean
  error?: string
  result?: BoardResult
}

// Grade every prediction old enough to measure against the CURRENT data.
// Deterministic: read the metric, compare to baseline/direction/target.
// Refuses to score when it can't be honest about the number:
// - dept data is partial (an errored read must never grade a head 'wrong')
// - the active event changed for event-scoped depts (metric meaning drifted;
//   sales metrics are global, so sales still grades)
export async function measureOutcomes(): Promise<number> {
  const ungraded = await getUngradedOutcomes()
  if (!ungraded.length) return 0
  const ctx = await readMeasureContext()
  let graded = 0
  for (const o of ungraded) {
    const p = o.predicted?.prediction
    if (!p || !p.metric) {
      await gradeOutcome(o.id, { note: 'no structured prediction' }, 'inconclusive')
      graded++
      continue
    }
    const dept = o.dept as Dept
    const deptData = ctx.depts[dept]
    if (!deptData || deptData.status !== 'ok') {
      await gradeOutcome(o.id, { metric: p.metric, note: `data partial at measure time: ${deptData?.status ?? 'missing'}` }, 'inconclusive')
      graded++
      continue
    }
    const predEvent = o.predicted?.event_id
    if (dept !== 'sales' && predEvent && ctx.activeEventId && predEvent !== ctx.activeEventId) {
      await gradeOutcome(o.id, { metric: p.metric, note: 'active event changed since prediction' }, 'inconclusive')
      graded++
      continue
    }
    const current = readMetric(deptData.summary, p.metric)
    const verdict = gradePrediction(p, current)
    await gradeOutcome(o.id, { metric: p.metric, value_at_measure: current ?? null }, verdict)
    graded++
  }
  return graded
}

// Persist a completed board result: audit trail + per-head memory write-back +
// outcome prediction + state snapshot + Telegram brief. Shared by both entry
// points. Returns the number of failed inserts so the run note stays honest.
async function persist(runId: string, result: BoardResult, notify: boolean, source: 'app' | 'ingest'): Promise<number> {
  const cfg = getCSuiteConfig()
  let failures = 0

  const opinionOks = await Promise.all(result.briefs.map(b =>
    insertOpinion(runId, b, result.challenges.find(c => c.dept === b.dept))))
  failures += opinionOks.filter(ok => !ok).length

  const rulingIds = await Promise.all(result.rulings.map(r => insertDecision(runId, r)))
  failures += rulingIds.filter(id => !id).length

  // Stamp predictions with the event they were made against, so grading can
  // refuse to score an event-scoped metric after the active event flips.
  const activeEventId = await getActiveEvent().then(ev => ev?.id ?? null).catch(() => null)

  await Promise.all(result.briefs.map(async b => {
    const ch = result.challenges.find(c => c.dept === b.dept)
    const learning = `[${new Date().toISOString().slice(0, 10)}] ${HEADS[b.dept].title} flagged: ${b.topIssue} → recommended: ${b.recommendedMove}` +
      (ch ? ` (manager: ${ch.verdict}${ch.critique ? ` — ${ch.critique}` : ''})` : '')
    await rememberHeadLearning(b.dept, learning, runId, source)
    await recordPrediction(runId, b.dept, {
      recommendedMove: b.recommendedMove,
      confidence: b.confidence,
      ...(activeEventId ? { event_id: activeEventId } : {}),
      ...(b.prediction ? { prediction: b.prediction } : {}),
    })
  }))

  await saveState(result.mode, result)
  await finishRun(runId, {
    status: 'done',
    rounds: result.rounds,
    board_brief: result.boardBrief,
    note: `${result.rulings.length} rulings` +
      (failures ? ` · ${failures} insert(s) FAILED` : '') +
      (result.challengeDegraded ? ' · grilling degraded' : ''),
  })

  if (!cfg.dryRun && notify) await sendBoardBrief(result, rulingIds)
  return failures
}

export async function runBoard(mode: BoardMode, question?: string, opts: { notify?: boolean } = {}): Promise<RunSummary> {
  if (!cSuiteEnabled()) {
    return { ok: false, skipped: authMode() === 'none' ? 'no ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN' : 'SUPABASE_SERVICE_ROLE_KEY not set' }
  }
  const cfg = getCSuiteConfig()
  await reapStale()
  const graded = await measureOutcomes().catch(e => {
    console.error('[c-suite] measureOutcomes', e)
    return 0
  })
  const runId = await createRun({ mode, question, dryRun: cfg.dryRun, source: 'app' })
  if (!runId) return { ok: false, skipped: 'could not create run row (Supabase write failed — check SUPABASE_SERVICE_ROLE_KEY)' }
  try {
    const result = await deliberate(mode, question)
    await persist(runId, result, opts.notify ?? true, 'app')
    return { ok: true, runId, mode, rulings: result.rulings.length, rounds: result.rounds, graded, result }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await finishRun(runId, { status: 'error', note: msg })
    return { ok: false, error: msg, runId }
  }
}

// Persist a board computed by the Claude Code harness (subscription runtime).
// fingerprint = sha256 of the raw body → a double-POST returns the original run
// instead of double-persisting + double-Telegramming.
export async function ingestResult(
  result: BoardResult,
  opts: { notify?: boolean; fingerprint?: string } = {},
): Promise<RunSummary> {
  if (!serviceRoleConfigured()) return { ok: false, skipped: 'SUPABASE_SERVICE_ROLE_KEY not set' }
  await reapStale()
  if (opts.fingerprint) {
    const existing = await findRunByFingerprint(opts.fingerprint)
    if (existing) return { ok: true, runId: existing, mode: result.mode, deduped: true }
  }
  const graded = await measureOutcomes().catch(e => {
    console.error('[c-suite] measureOutcomes', e)
    return 0
  })
  const runId = await createRun({
    mode: result.mode, question: result.question, dryRun: false,
    source: 'ingest', fingerprint: opts.fingerprint,
  })
  if (!runId) return { ok: false, skipped: 'could not create run row (Supabase write failed)' }
  try {
    await persist(runId, result, opts.notify ?? true, 'ingest')
    return { ok: true, runId, mode: result.mode, rulings: result.rulings.length, rounds: result.rounds, graded }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Clear the fingerprint: a failed persist must NOT satisfy the idempotency
    // check, or the harness's honest retry gets swallowed as "deduped".
    await finishRun(runId, { status: 'error', note: msg, fingerprint: null })
    return { ok: false, error: msg, runId }
  }
}

// Compact text rendering of a board result for a chat reply (Jarvis on-demand).
export function formatForChat(result: BoardResult): string {
  const lines: string[] = []
  if (result.challengeDegraded) lines.push('⚠ Grilling degraded this sitting — verdicts unvetted.', '')
  if (result.boardBrief) lines.push(result.boardBrief, '')
  for (const r of result.rulings) lines.push(`• ${r.title} (${r.priority}): ${r.decision}`)
  const rejected = result.challenges.filter(c => c.verdict === 'REJECT')
  if (rejected.length) lines.push('', `Manager pushed back on: ${rejected.map(c => HEADS[c.dept].title).join(', ')}.`)
  return lines.join('\n')
}