// Ads Council Agent — run orchestrator. Triggered by the cron route (or manually).
// Sequence: health-gate → sense → fatigue-score → council deliberation →
// queue + Telegram card per actionable verdict. In copilot mode (v1) NOTHING is
// executed here; in risk_tiered mode (v2) only low-risk reversible cost-DOWN
// actions auto-execute, everything else still waits for a tap.

import { getAdsConfig, adsCouncilEnabled } from './config'
import { getActiveAdInsights } from './meta-api'
import { assessFatigue } from './fatigue'
import { deliberate } from './council'
import { sendActionCard } from './telegram-cards'
import { executeApproved } from './executor'
import {
  createRun, finishRun, insertAction, logEvent, isBreakerOpen, transitionAction,
  reapStale, serviceRoleConfigured,
} from './store'
import type { CandidateAction, EntityInsights } from './types'

export interface RunSummary {
  ok: boolean
  skipped?: string
  runId?: string
  adsScanned?: number
  candidates?: number
  proposed?: number
  auto?: number
  error?: string
}

const AUTO_CONFIDENCE_FLOOR = 80 // risk_tiered mode only

async function mapPool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let idx = 0
  async function worker() {
    while (idx < items.length) {
      const i = idx++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return out
}

export async function runCouncil(): Promise<RunSummary> {
  const cfg = getAdsConfig()
  if (!adsCouncilEnabled(cfg)) return { ok: false, skipped: 'Meta credentials not configured' }
  if (!serviceRoleConfigured()) return { ok: false, skipped: 'SUPABASE_SERVICE_ROLE_KEY not set' }

  const breaker = await isBreakerOpen(cfg.adAccountId)
  if (breaker.open) {
    await logEvent('warn', 'aborted_breaker', { reason: breaker.reason })
    return { ok: false, skipped: `circuit breaker open: ${breaker.reason}` }
  }

  // Recover any rows stranded by a previously killed run before starting a new one.
  await reapStale()

  const runId = await createRun({ mode: cfg.mode, adAccountId: cfg.adAccountId, dryRun: cfg.dryRun })

  try {
  let entities: EntityInsights[]
  try {
    entities = await getActiveAdInsights(cfg)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (runId) await finishRun(runId, { status: 'error', note: msg })
    await logEvent('error', 'sense_failed', { msg }, { runId })
    return { ok: false, error: msg, runId: runId ?? undefined }
  }

  // Score fatigue; keep only entities with an actionable candidate.
  const pairs: Array<{ entity: EntityInsights; candidate: CandidateAction }> = []
  for (const e of entities) {
    const a = assessFatigue(e, cfg)
    if (a.candidate) pairs.push({ entity: e, candidate: a.candidate })
  }

  // Most spend first; cap council calls for cost control.
  pairs.sort((x, y) => y.entity.current.spend - x.entity.current.spend)
  const selected = pairs.slice(0, cfg.maxCandidatesPerRun)

  // Deliberate (bounded concurrency to avoid bursting the API).
  const decisions = await mapPool(selected, 3, async ({ entity, candidate }) => {
    try {
      return await deliberate(candidate, entity, cfg)
    } catch (err) {
      await logEvent('error', 'deliberate_failed', { entity: entity.id, msg: String(err) }, { runId })
      return null
    }
  })

  let proposed = 0
  let auto = 0
  for (const d of decisions) {
    if (!d || d.actionType === 'none') continue
    const actionId = await insertAction(runId, d)
    if (!actionId) continue
    proposed++

    // risk_tiered (v2) auto-execution of low-risk, reversible, cost-DOWN actions only.
    const isCostDown = d.actionType === 'pause' ||
      (d.actionType === 'shift_budget' && Number(d.proposedSettings.budgetChangePct) < 0)
    const autoEligible =
      cfg.mode === 'risk_tiered' &&
      d.riskTier === 'low_reversible' &&
      isCostDown &&
      d.confidence >= AUTO_CONFIDENCE_FLOOR

    if (autoEligible) {
      const moved = await transitionAction(actionId, 'pending', 'approved', { decided_by: 'auto', decided_at: new Date().toISOString() })
      if (moved) {
        await executeApproved(actionId, 'auto')
        auto++
      }
    }
    // Always post the card (auto-executed ones show as already handled on approve).
    await sendActionCard(actionId, d)
  }

  if (runId) {
    await finishRun(runId, {
      status: 'done',
      ads_scanned: entities.length,
      actions_proposed: proposed,
      actions_auto: auto,
      note: `${selected.length} candidates deliberated`,
    })
  }

  return { ok: true, runId: runId ?? undefined, adsScanned: entities.length, candidates: selected.length, proposed, auto }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (runId) await finishRun(runId, { status: 'error', note: msg })
    await logEvent('error', 'run_failed', { msg }, { runId })
    return { ok: false, error: msg, runId: runId ?? undefined }
  }
}
