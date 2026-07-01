// Ads Council Agent — Supabase data access. Thin wrappers around the
// service-role client; all ads_council_* tables are server-only (RLS on, no
// policies). Keep raw table knowledge in this file only.

import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import type { Decision, EntityState } from './types'

const BREAKER_PREFIX = 'meta:'

// ── Runs ────────────────────────────────────────────────────────────────────
export async function createRun(input: {
  mode: string
  adAccountId: string
  dryRun: boolean
}): Promise<string | null> {
  const { data, error } = await supabase
    .from('ads_council_runs')
    .insert({ mode: input.mode, ad_account_id: input.adAccountId, dry_run: input.dryRun })
    .select('id')
    .single()
  if (error) {
    console.error('[ads-council] createRun', error.message)
    return null
  }
  return data.id as string
}

export async function finishRun(
  runId: string,
  patch: { status: string; ads_scanned?: number; actions_proposed?: number; actions_auto?: number; note?: string },
): Promise<void> {
  await supabase
    .from('ads_council_runs')
    .update({ ...patch, finished_at: new Date().toISOString() })
    .eq('id', runId)
}

// ── Actions (the approval queue) ──────────────────────────────────────────────
export async function insertAction(runId: string | null, d: Decision): Promise<string | null> {
  const { data, error } = await supabase
    .from('ads_council_actions')
    .insert({
      run_id: runId,
      scope: d.scope,
      target_entity_id: d.targetEntityId,
      target_name: d.targetName,
      action_type: d.actionType,
      proposed_settings: d.proposedSettings,
      why: d.why,
      supporting_data: d.supportingData,
      confidence: Math.round(d.confidence),
      risk_tier: d.riskTier,
      verdict_reason: d.verdictReason,
      transcript: d.transcript,
      status: 'pending',
    })
    .select('id')
    .single()
  if (error) {
    console.error('[ads-council] insertAction', error.message)
    return null
  }
  return data.id as string
}

export interface ActionRow {
  id: string
  run_id: string | null
  scope: string
  target_entity_id: string
  target_name: string | null
  action_type: string
  proposed_settings: Record<string, unknown>
  supporting_data: Record<string, unknown>
  confidence: number | null
  risk_tier: string | null
  verdict_reason: string | null
  why: string | null
  status: string
  snapshot_id: string | null
}

export async function getAction(id: string): Promise<ActionRow | null> {
  const { data, error } = await supabase.from('ads_council_actions').select('*').eq('id', id).maybeSingle()
  if (error) {
    console.error('[ads-council] getAction', error.message)
    return null
  }
  return (data as ActionRow) ?? null
}

// Status transition guarded by the expected current status, so two taps on the
// same Telegram button can't both execute (optimistic concurrency).
export async function transitionAction(
  id: string,
  from: string,
  to: string,
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  const { data, error } = await supabase
    .from('ads_council_actions')
    .update({ status: to, ...extra })
    .eq('id', id)
    .eq('status', from)
    .select('id')
  if (error) {
    console.error('[ads-council] transitionAction', error.message)
    return false
  }
  return !!data && data.length > 0
}

export async function setActionResult(
  id: string,
  patch: { status: string; execution_result?: unknown; executed_at?: string; snapshot_id?: string },
): Promise<void> {
  await supabase.from('ads_council_actions').update(patch).eq('id', id)
}

// ── Log ───────────────────────────────────────────────────────────────────────
export async function logEvent(
  level: string,
  event: string,
  detail: Record<string, unknown> = {},
  ids: { runId?: string | null; actionId?: string | null } = {},
): Promise<void> {
  await supabase.from('ads_council_log').insert({
    level,
    event,
    detail,
    run_id: ids.runId ?? null,
    action_id: ids.actionId ?? null,
  })
}

// ── Circuit breaker (throttle safety) ─────────────────────────────────────────
export interface BreakerState {
  open_until: string | null
  reason: string | null
  throttle_count: number
  window_started_at: string | null
}

export async function getBreaker(adAccountId: string): Promise<BreakerState | null> {
  const { data } = await supabase
    .from('ads_breaker_state')
    .select('open_until, reason, throttle_count, window_started_at')
    .eq('id', BREAKER_PREFIX + adAccountId)
    .maybeSingle()
  return (data as BreakerState) ?? null
}

export async function isBreakerOpen(adAccountId: string): Promise<{ open: boolean; reason?: string }> {
  const b = await getBreaker(adAccountId)
  if (b?.open_until && new Date(b.open_until).getTime() > Date.now()) {
    return { open: true, reason: b.reason ?? 'breaker open' }
  }
  return { open: false }
}

export async function tripBreaker(adAccountId: string, minutes: number, reason: string): Promise<void> {
  const openUntil = new Date(Date.now() + minutes * 60_000).toISOString()
  await supabase.from('ads_breaker_state').upsert({
    id: BREAKER_PREFIX + adAccountId,
    open_until: openUntil,
    reason,
    updated_at: new Date().toISOString(),
  })
}

// ── Cooldowns ─────────────────────────────────────────────────────────────────
export async function inCooldown(entityId: string): Promise<boolean> {
  const { data } = await supabase
    .from('ads_cooldowns')
    .select('cooldown_until')
    .eq('entity_id', entityId)
    .maybeSingle()
  const until = (data as { cooldown_until?: string } | null)?.cooldown_until
  return !!until && new Date(until).getTime() > Date.now()
}

export async function setCooldown(entityId: string, actionType: string, hours: number): Promise<void> {
  const now = new Date()
  await supabase.from('ads_cooldowns').upsert({
    entity_id: entityId,
    last_action_type: actionType,
    last_action_at: now.toISOString(),
    cooldown_until: new Date(now.getTime() + hours * 3600_000).toISOString(),
  })
}

// Atomic claim (via the ads_claim_cooldown RPC): returns true iff THIS caller
// took the per-entity lock. Serialises two distinct approved actions on the same
// entity so only one can write. Fails closed (false) on any error.
export async function claimCooldown(entityId: string, actionType: string, hours: number): Promise<boolean> {
  const { data, error } = await supabase.rpc('ads_claim_cooldown', {
    p_entity_id: entityId, p_hours: Math.round(hours), p_action: actionType,
  })
  if (error) {
    console.error('[ads-council] claimCooldown', error.message)
    return false
  }
  return data === true
}

export async function releaseCooldown(entityId: string): Promise<void> {
  await supabase.from('ads_cooldowns').delete().eq('entity_id', entityId)
}

// ── Service-role guard ────────────────────────────────────────────────────────
// ads_council_* are RLS-on with NO policies, so the anon-key fallback in the
// shared admin client would silently no-op. Use this to fail LOUD instead.
export function serviceRoleConfigured(): boolean {
  return !!process.env.SUPABASE_SERVICE_ROLE_KEY
}

// ── Reaper ────────────────────────────────────────────────────────────────────
// Recover rows stranded by a hard process kill (Vercel maxDuration / cold start),
// which a try/catch in-process cannot catch.
export async function reapStale(maxMinutes = 15): Promise<void> {
  const cutoff = new Date(Date.now() - maxMinutes * 60_000).toISOString()
  await supabase.from('ads_council_actions')
    .update({ status: 'failed', execution_result: { reaped: true, note: 'stranded in executing' } })
    .eq('status', 'executing').lt('decided_at', cutoff)
  await supabase.from('ads_council_runs')
    .update({ status: 'error', note: 'reaped: stranded running', finished_at: new Date().toISOString() })
    .eq('status', 'running').lt('started_at', cutoff)
}

// ── Snapshots (rollback) ──────────────────────────────────────────────────────
export async function snapshotEntity(actionId: string, prior: EntityState): Promise<string | null> {
  const { data, error } = await supabase
    .from('ads_entity_snapshots')
    .insert({
      action_id: actionId,
      scope: prior.scope,
      entity_id: prior.id,
      prior_state: prior,
    })
    .select('id')
    .single()
  if (error) {
    console.error('[ads-council] snapshotEntity', error.message)
    return null
  }
  return data.id as string
}

export async function getSnapshot(id: string): Promise<{ prior_state: EntityState } | null> {
  const { data } = await supabase.from('ads_entity_snapshots').select('prior_state').eq('id', id).maybeSingle()
  return (data as { prior_state: EntityState }) ?? null
}

export async function markSnapshotRestored(id: string): Promise<void> {
  await supabase.from('ads_entity_snapshots').update({ restored: true, restored_at: new Date().toISOString() }).eq('id', id)
}

// ── Policy memory (predicted vs actual) ───────────────────────────────────────
export async function recordPrediction(
  actionId: string,
  scope: string,
  entityId: string,
  actionType: string,
  predicted: Record<string, unknown>,
): Promise<void> {
  await supabase.from('ads_policy_memory').insert({
    action_id: actionId,
    scope,
    entity_id: entityId,
    action_type: actionType,
    predicted,
  })
}
