// Ads Council Agent — the executor. The ONLY module that mutates a live Meta
// entity, and only for an already-APPROVED action. Flow:
//   approved → (transition to executing) → breaker/cooldown gate → read state →
//   guardrails → snapshot prior state → ONE write → cooldown → log/predict.
// Throttle responses trip the circuit breaker. Every write is rollback-able from
// the snapshot.

import { getAdsConfig, adsCouncilEnabled, fromMinor } from './config'
import { MetaThrottleError, getEntityState, setDailyBudgetMinor, setStatus } from './meta-api'
import { runGuardrails } from './guardrails'
import {
  getAction, transitionAction, setActionResult, logEvent,
  isBreakerOpen, tripBreaker, claimCooldown, releaseCooldown, serviceRoleConfigured,
  snapshotEntity, getSnapshot, markSnapshotRestored, recordPrediction,
} from './store'
import type { ActionType, Scope } from './types'

export interface ExecOutcome {
  ok: boolean
  status: string
  message: string
  reasons?: string[]
}

// Execute one approved action. `decidedBy` is the Telegram user id/name.
export async function executeApproved(actionId: string, decidedBy: string): Promise<ExecOutcome> {
  const cfg = getAdsConfig()

  // Fail LOUD (not silently on the anon role) if the service-role key is missing.
  if (!serviceRoleConfigured()) {
    console.error('[ads-council] SUPABASE_SERVICE_ROLE_KEY missing — refusing to execute')
    return { ok: false, status: 'failed', message: 'Server misconfigured (service-role key missing).' }
  }

  // Claim the action: approved → executing (prevents double taps).
  const claimed = await transitionAction(actionId, 'approved', 'executing', {
    decided_by: decidedBy, decided_at: new Date().toISOString(),
  })
  if (!claimed) return { ok: false, status: 'noop', message: 'Action was not in approved state (already handled?).' }

  // Everything post-claim is wrapped: a throw can NEVER strand the row in
  // 'executing' — it always routes to handleMetaError → fail() (terminal).
  let cooldownHeld = false
  let target = ''
  try {
    const action = await getAction(actionId)
    if (!action) {
      await fail(actionId, 'load_failed', 'Could not load action after claim.')
      return { ok: false, status: 'failed', message: 'Could not load action.' }
    }
    if (!adsCouncilEnabled(cfg)) {
      await fail(actionId, 'disabled', 'Ads council not configured (missing Meta credentials).')
      return { ok: false, status: 'failed', message: 'Meta not configured.' }
    }

    const scope = action.scope as Scope
    target = action.target_entity_id
    const actionType = action.action_type as ActionType

    // Defense-in-depth: an automated caller may only write in risk_tiered mode.
    if (decidedBy === 'auto' && cfg.mode !== 'risk_tiered') {
      await fail(actionId, 'auto_blocked', 'Auto execution attempted in copilot mode — refused.')
      return { ok: false, status: 'failed', message: 'Auto execution is disabled in copilot mode.' }
    }

    // Health gate.
    const breaker = await isBreakerOpen(cfg.adAccountId)
    if (breaker.open) {
      await fail(actionId, 'breaker_open', `Circuit breaker open: ${breaker.reason}`)
      return { ok: false, status: 'failed', message: `Breaker open — ${breaker.reason}` }
    }

    // Atomic per-entity cooldown claim — serialises two same-entity approvals so
    // only one can snapshot + write (keeps rollback state correct).
    if (!(await claimCooldown(target, actionType, cfg.cooldownHours))) {
      await fail(actionId, 'cooldown', `Entity ${target} is in cooldown or contended.`)
      return { ok: false, status: 'failed', message: 'Entity in cooldown.' }
    }
    cooldownHeld = true

    // refresh_creative is advisory in v1 — acknowledge, no live write. Keep the
    // cooldown so the same ad is not re-flagged next run.
    if (actionType === 'refresh_creative') {
      await setActionResult(actionId, {
        status: 'executed', executed_at: new Date().toISOString(),
        execution_result: { advisory: true, note: 'Creative refresh delivered as copy + brief; generate the visual and upload as PAUSED.' },
      })
      await logEvent('commit', 'refresh_advisory', { target }, { actionId })
      return { ok: true, status: 'executed', message: 'Refresh acknowledged (advisory — build + upload the visual PAUSED).' }
    }

    const state = await getEntityState(cfg, scope, target)

    const guard = runGuardrails({ actionType, proposedSettings: action.proposed_settings, scope }, state, cfg)
    if (!guard.ok) {
      await releaseCooldown(target); cooldownHeld = false
      await fail(actionId, 'guardrail_block', `Blocked: ${guard.reasons.join('; ')}`, guard.reasons)
      return { ok: false, status: 'failed', message: 'Guardrails blocked the action.', reasons: guard.reasons }
    }

    // Snapshot BEFORE the write (rollback safety).
    const snapId = await snapshotEntity(actionId, state)

    // Dry-run: never touch Meta. Release the lock (test mode).
    if (cfg.dryRun) {
      await releaseCooldown(target); cooldownHeld = false
      await setActionResult(actionId, {
        status: 'executed', executed_at: new Date().toISOString(), snapshot_id: snapId ?? undefined,
        execution_result: { dryRun: true, would: describe(actionType, guard.clampedSettings), guardrails: guard.reasons },
      })
      await logEvent('commit', 'dry_run', { target, actionType, clamped: guard.clampedSettings }, { actionId })
      return { ok: true, status: 'executed', message: `DRY-RUN: would ${describe(actionType, guard.clampedSettings)}.` }
    }

    // ── The single live write ──────────────────────────────────────────────────
    if (actionType === 'pause') {
      await setStatus(cfg, target, 'PAUSED')
    } else if (actionType === 'scale' || actionType === 'shift_budget') {
      await setDailyBudgetMinor(cfg, target, guard.clampedSettings.newDailyBudgetMinor as number)
    } else {
      await releaseCooldown(target); cooldownHeld = false
      await fail(actionId, 'unsupported', `action_type '${actionType}' is not executable`)
      return { ok: false, status: 'failed', message: `Unsupported action ${actionType}.` }
    }

    await setActionResult(actionId, {
      status: 'executed', executed_at: new Date().toISOString(), snapshot_id: snapId ?? undefined,
      execution_result: { applied: describe(actionType, guard.clampedSettings), by: decidedBy },
    })
    await recordPrediction(actionId, scope, target, actionType, {
      cost_per_dm_before: action.supporting_data?.cost_per_dm ?? null,
    })
    await logEvent('commit', 'executed', { target, actionType, clamped: guard.clampedSettings, by: decidedBy }, { actionId })
    return { ok: true, status: 'executed', message: `Done: ${describe(actionType, guard.clampedSettings)}.` }
  } catch (err) {
    if (cooldownHeld && target) { try { await releaseCooldown(target) } catch { /* best effort */ } }
    return handleMetaError(actionId, target, cfg.adAccountId, err)
  }
}

// Restore an entity to its pre-action state from the snapshot.
export async function rollbackAction(actionId: string): Promise<ExecOutcome> {
  const cfg = getAdsConfig()
  const action = await getAction(actionId)
  if (!action?.snapshot_id) return { ok: false, status: 'noop', message: 'No snapshot to roll back to.' }
  const snap = await getSnapshot(action.snapshot_id)
  if (!snap) return { ok: false, status: 'noop', message: 'Snapshot missing.' }
  const prior = snap.prior_state

  if (cfg.dryRun) {
    await logEvent('rollback', 'dry_run', { target: prior.id }, { actionId })
    return { ok: true, status: 'rolled_back', message: 'DRY-RUN: would restore prior state.' }
  }
  try {
    if (prior.status === 'ACTIVE' || prior.status === 'PAUSED') {
      await setStatus(cfg, prior.id, prior.status as 'ACTIVE' | 'PAUSED')
    }
    if (prior.dailyBudgetMinor != null) {
      await setDailyBudgetMinor(cfg, prior.id, prior.dailyBudgetMinor)
    }
  } catch (err) {
    return handleMetaError(actionId, prior.id, cfg.adAccountId, err)
  }
  await markSnapshotRestored(action.snapshot_id)
  await setActionResult(actionId, { status: 'executed', execution_result: { rolledBack: true } })
  await logEvent('rollback', 'restored', { target: prior.id, to: prior }, { actionId })
  return { ok: true, status: 'rolled_back', message: `Restored ${prior.id} to prior state.` }
}

// Manual path (execute route / skill): approve a pending action then execute it.
export async function approveAndExecute(actionId: string, who: string): Promise<ExecOutcome> {
  const moved = await transitionAction(actionId, 'pending', 'approved', {
    decided_by: who, decided_at: new Date().toISOString(),
  })
  if (!moved) return { ok: false, status: 'noop', message: 'Action is not pending (already handled?).' }
  return executeApproved(actionId, who)
}

async function handleMetaError(actionId: string, target: string, account: string, err: unknown): Promise<ExecOutcome> {
  if (err instanceof MetaThrottleError) {
    await tripBreaker(account, 60, `throttle on ${target}: ${err.message}`)
    await fail(actionId, 'throttled', `Meta throttled — breaker tripped 60m. ${err.message}`)
    return { ok: false, status: 'failed', message: 'Meta throttled — breaker tripped.' }
  }
  const msg = err instanceof Error ? err.message : String(err)
  await fail(actionId, 'meta_error', msg)
  return { ok: false, status: 'failed', message: `Meta error: ${msg}` }
}

async function fail(actionId: string, code: string, message: string, reasons?: string[]): Promise<void> {
  await setActionResult(actionId, { status: 'failed', execution_result: { code, message, reasons } })
  await logEvent('error', code, { message, reasons }, { actionId })
}

function describe(actionType: ActionType, clamped: Record<string, unknown>): string {
  if (actionType === 'pause') return 'pause entity'
  if (actionType === 'scale' || actionType === 'shift_budget') {
    const minor = clamped.newDailyBudgetMinor as number | undefined
    return `set daily budget to RM${minor != null ? fromMinor(minor).toFixed(2) : '?'} (${clamped.appliedPct}% )`
  }
  return actionType
}
