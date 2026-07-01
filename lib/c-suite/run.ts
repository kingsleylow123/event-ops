// AI C-Suite — run orchestrator. Convenes the board, persists the full audit
// trail (run + each head's opinion + the manager's rulings), writes a distilled
// learning back to each head's memory (so it gets smarter, not groundhog day),
// snapshots the board state, and posts the Telegram brief (unless dry-run).
//
// Two entry points share the same persistence:
//   runBoard()      — compute the board HERE (Vercel, API/subscription auth) + persist.
//   ingestResult()  — persist a board computed ELSEWHERE (the Claude Code harness on
//                     Kingsley's Max subscription / Hermes) via POST /api/c-suite/ingest.

import { getCSuiteConfig, cSuiteEnabled, authMode } from './config'
import { deliberate } from './board'
import {
  createRun, finishRun, insertOpinion, insertDecision, recordPrediction, saveState, serviceRoleConfigured,
} from './store'
import { rememberHeadLearning } from './memory'
import { sendBoardBrief } from './telegram-cards'
import { HEADS } from './heads'
import type { BoardMode, BoardResult } from './types'

export interface RunSummary {
  ok: boolean
  skipped?: string
  runId?: string
  mode?: BoardMode
  rulings?: number
  rounds?: number
  error?: string
  result?: BoardResult
}

// Persist a completed board result: audit trail + per-head memory write-back +
// outcome prediction + state snapshot + Telegram brief. Shared by both entry points.
async function persist(runId: string | null, result: BoardResult, notify: boolean): Promise<void> {
  const cfg = getCSuiteConfig()
  await Promise.all([
    ...result.briefs.map(bff => insertOpinion(runId, bff)),
    ...result.rulings.map(r => insertDecision(runId, r)),
  ])
  await Promise.all(result.briefs.map(async bff => {
    const ch = result.challenges.find(c => c.dept === bff.dept)
    const learning = `[${new Date().toISOString().slice(0, 10)}] ${HEADS[bff.dept].title} flagged: ${bff.topIssue} → recommended: ${bff.recommendedMove}` +
      (ch ? ` (manager: ${ch.verdict}${ch.critique ? ` — ${ch.critique}` : ''})` : '')
    await rememberHeadLearning(bff.dept, learning, runId)
    await recordPrediction(runId, bff.dept, { recommendedMove: bff.recommendedMove, confidence: bff.confidence })
  }))
  await saveState(result.mode, result)
  if (runId) await finishRun(runId, { status: 'done', rounds: result.rounds, board_brief: result.boardBrief, note: `${result.rulings.length} rulings` })
  if (!cfg.dryRun && notify) await sendBoardBrief(result)
}

export async function runBoard(mode: BoardMode, question?: string, opts: { notify?: boolean } = {}): Promise<RunSummary> {
  if (!cSuiteEnabled()) {
    return { ok: false, skipped: authMode() === 'none' ? 'no ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN' : 'SUPABASE_SERVICE_ROLE_KEY not set' }
  }
  const cfg = getCSuiteConfig()
  const runId = await createRun({ mode, question, dryRun: cfg.dryRun })
  if (!runId) return { ok: false, skipped: 'could not create run row (Supabase write failed — check SUPABASE_SERVICE_ROLE_KEY)' }
  try {
    const result = await deliberate(mode, question)
    await persist(runId, result, opts.notify ?? true)
    return { ok: true, runId: runId ?? undefined, mode, rulings: result.rulings.length, rounds: result.rounds, result }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (runId) await finishRun(runId, { status: 'error', note: msg })
    return { ok: false, error: msg, runId: runId ?? undefined }
  }
}

// Persist a board computed by the Claude Code harness (subscription runtime).
export async function ingestResult(result: BoardResult, opts: { notify?: boolean } = {}): Promise<RunSummary> {
  if (!serviceRoleConfigured()) return { ok: false, skipped: 'SUPABASE_SERVICE_ROLE_KEY not set' }
  const runId = await createRun({ mode: result.mode, question: result.question, dryRun: false })
  if (!runId) return { ok: false, skipped: 'could not create run row (Supabase write failed)' }
  try {
    await persist(runId, result, opts.notify ?? true)
    return { ok: true, runId: runId ?? undefined, mode: result.mode, rulings: result.rulings.length, rounds: result.rounds }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (runId) await finishRun(runId, { status: 'error', note: msg })
    return { ok: false, error: msg, runId: runId ?? undefined }
  }
}

// Compact text rendering of a board result for a chat reply (Jarvis on-demand).
export function formatForChat(result: BoardResult): string {
  const lines: string[] = []
  if (result.boardBrief) lines.push(result.boardBrief, '')
  for (const r of result.rulings) lines.push(`• ${r.title} (${r.priority}): ${r.decision}`)
  const rejected = result.challenges.filter(c => c.verdict === 'REJECT')
  if (rejected.length) lines.push('', `Manager pushed back on: ${rejected.map(c => HEADS[c.dept].title).join(', ')}.`)
  return lines.join('\n')
}
