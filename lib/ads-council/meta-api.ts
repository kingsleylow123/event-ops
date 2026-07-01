// Ads Council Agent — Meta Marketing (Graph) API client.
// Server-side. Mirrors the lib/bukku.ts pattern: env at top, enabled() guard,
// custom error classes, one shared call() wrapper. Throttle/abuse responses are
// surfaced as MetaThrottleError so the orchestrator can trip the circuit breaker.

import type { AdsConfig } from './config'
import { actId, fromMinor } from './config'
import type { EntityInsights, EntityState, InsightWindow, Scope } from './types'

export class MetaError extends Error {
  code?: number
  subcode?: number
  constructor(message: string, code?: number, subcode?: number) {
    super(message)
    this.name = 'MetaError'
    this.code = code
    this.subcode = subcode
  }
}
export class MetaThrottleError extends MetaError {
  constructor(message: string, code?: number, subcode?: number) {
    super(message, code, subcode)
    this.name = 'MetaThrottleError'
  }
}

// Meta rate-limit / abuse / transient-load signals → trip the breaker.
const THROTTLE_CODES = new Set([4, 17, 32, 613])
const THROTTLE_SUBCODES = new Set([1996, 2446079])

function graphBase(cfg: AdsConfig): string {
  return `https://graph.facebook.com/${cfg.graphVersion}`
}

async function call(
  cfg: AdsConfig,
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<Record<string, unknown>> {
  const url = new URL(`${graphBase(cfg)}/${path.replace(/^\//, '')}`)
  const init: RequestInit = { method, cache: 'no-store' }

  if (method === 'GET') {
    url.searchParams.set('access_token', cfg.accessToken)
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v))
  } else {
    const form = new URLSearchParams()
    form.set('access_token', cfg.accessToken)
    for (const [k, v] of Object.entries(params)) if (v !== undefined) form.set(k, String(v))
    init.body = form
    init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
  }

  const res = await fetch(url.toString(), init)
  const text = await res.text()
  let json: Record<string, unknown> = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = {}
  }

  if (res.status < 200 || res.status >= 300) {
    const err = (json.error ?? {}) as { message?: string; code?: number; error_subcode?: number }
    const code = err.code
    const subcode = err.error_subcode
    const msg = `Meta ${method} ${path} → ${res.status}: ${err.message ?? text.slice(0, 300)}`
    if ((code && THROTTLE_CODES.has(code)) || (subcode && THROTTLE_SUBCODES.has(subcode))) {
      throw new MetaThrottleError(msg, code, subcode)
    }
    throw new MetaError(msg, code, subcode)
  }
  return json
}

// ── Insights ──────────────────────────────────────────────────────────────────

function dateStr(daysAgo: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

interface RawInsight {
  ad_id?: string
  adset_id?: string
  campaign_id?: string
  impressions?: string
  spend?: string
  cpm?: string
  ctr?: string
  frequency?: string
  actions?: Array<{ action_type: string; value: string }>
}

function countResults(row: RawInsight, resultActionType: string): number {
  if (!Array.isArray(row.actions)) return 0
  let total = 0
  for (const a of row.actions) {
    if (a.action_type && a.action_type.includes(resultActionType)) total += Number(a.value) || 0
  }
  return total
}

function toWindow(row: RawInsight | undefined, resultActionType: string): InsightWindow {
  const r = row ?? {}
  const spend = Number(r.spend) || 0
  const results = countResults(r, resultActionType)
  return {
    impressions: Number(r.impressions) || 0,
    spend,
    ctr: Number(r.ctr) || 0,
    cpm: Number(r.cpm) || 0,
    frequency: Number(r.frequency) || 0,
    results,
    costPerResult: results > 0 ? spend / results : Infinity,
  }
}

async function fetchAdInsights(
  cfg: AdsConfig,
  since: string,
  until: string,
): Promise<Map<string, RawInsight>> {
  const map = new Map<string, RawInsight>()
  let after: string | undefined
  // Paginate (accounts rarely exceed a page or two of active ads).
  for (let page = 0; page < 10; page++) {
    const resp = await call(cfg, 'GET', `${actId(cfg)}/insights`, {
      level: 'ad',
      fields: 'ad_id,adset_id,campaign_id,impressions,spend,cpm,ctr,frequency,actions',
      time_range: JSON.stringify({ since, until }),
      limit: 200,
      after,
    })
    for (const row of (resp.data as RawInsight[]) ?? []) {
      if (row.ad_id) map.set(row.ad_id, row)
    }
    const paging = resp.paging as { cursors?: { after?: string }; next?: string } | undefined
    if (paging?.next && paging.cursors?.after) after = paging.cursors.after
    else break
  }
  return map
}

// Lists active ads and joins current (last 7d) + prior (the 7d before) insights.
export async function getActiveAdInsights(cfg: AdsConfig): Promise<EntityInsights[]> {
  // 1) active ads with their hierarchy + status
  const adsResp = await call(cfg, 'GET', `${actId(cfg)}/ads`, {
    fields: 'id,name,status,effective_status,adset_id,campaign_id',
    effective_status: JSON.stringify(['ACTIVE']),
    limit: 500,
  })
  const ads = (adsResp.data as Array<{
    id: string
    name: string
    status: string
    effective_status: string
    adset_id: string
    campaign_id: string
  }>) ?? []
  if (!ads.length) return []

  // 2) insight windows
  const curr = await fetchAdInsights(cfg, dateStr(7), dateStr(1))
  const prior = await fetchAdInsights(cfg, dateStr(14), dateStr(8))

  return ads.map(ad => ({
    scope: 'ad' as Scope,
    id: ad.id,
    name: ad.name,
    adsetId: ad.adset_id,
    campaignId: ad.campaign_id,
    status: ad.status,
    effectiveStatus: ad.effective_status,
    current: toWindow(curr.get(ad.id), cfg.resultActionType),
    prior: toWindow(prior.get(ad.id), cfg.resultActionType),
  }))
}

// ── Entity state (for snapshot/clamp/rollback) ────────────────────────────────
export async function getEntityState(cfg: AdsConfig, scope: Scope, id: string): Promise<EntityState> {
  // Budget fields exist ONLY on campaign/adset nodes. Requesting daily_budget on
  // an Ad node returns a hard 400 (#100 nonexisting field), so keep it status-only.
  const fields = scope === 'ad' ? 'status' : 'status,daily_budget,lifetime_budget'
  const resp = await call(cfg, 'GET', id, { fields })
  const daily = resp.daily_budget != null ? Number(resp.daily_budget) : null
  const life = resp.lifetime_budget != null ? Number(resp.lifetime_budget) : null
  return {
    scope,
    id,
    status: String(resp.status ?? ''),
    dailyBudgetMinor: Number.isFinite(daily as number) && (daily as number) > 0 ? (daily as number) : null,
    lifetimeBudgetMinor: Number.isFinite(life as number) && (life as number) > 0 ? (life as number) : null,
  }
}

// ── Writes (the ONLY mutating calls; each commits exactly one change) ──────────
export async function setStatus(cfg: AdsConfig, id: string, status: 'PAUSED' | 'ACTIVE'): Promise<void> {
  await call(cfg, 'POST', id, { status })
}

export async function setDailyBudgetMinor(cfg: AdsConfig, id: string, dailyBudgetMinor: number): Promise<void> {
  await call(cfg, 'POST', id, { daily_budget: Math.round(dailyBudgetMinor) })
}

// ── Creative refresh helpers (used by the refresh path) ───────────────────────
// Upload an image already hosted at a URL, returning its image hash.
export async function uploadImageFromUrl(cfg: AdsConfig, url: string): Promise<string> {
  const resp = await call(cfg, 'POST', `${actId(cfg)}/adimages`, { url })
  const images = (resp.images ?? {}) as Record<string, { hash?: string }>
  const first = Object.values(images)[0]
  if (!first?.hash) throw new MetaError('uploadImageFromUrl: no hash returned')
  return first.hash
}

// Create a link-to-Messenger/DM creative from an image hash + copy.
export async function createCreative(
  cfg: AdsConfig,
  input: { name: string; message: string; imageHash: string; link: string; cta?: string },
): Promise<string> {
  const objectStorySpec = {
    page_id: cfg.pageId,
    ...(cfg.igUserId ? { instagram_user_id: cfg.igUserId } : {}),
    link_data: {
      message: input.message,
      link: input.link,
      image_hash: input.imageHash,
      call_to_action: { type: input.cta ?? 'SEND_MESSAGE' },
    },
  }
  const resp = await call(cfg, 'POST', `${actId(cfg)}/adcreatives`, {
    name: input.name,
    object_story_spec: JSON.stringify(objectStorySpec),
  })
  if (!resp.id) throw new MetaError('createCreative: no id returned')
  return String(resp.id)
}

// Create a PAUSED ad (always paused — activation is a separate, gated step).
export async function createPausedAd(
  cfg: AdsConfig,
  input: { name: string; adsetId: string; creativeId: string },
): Promise<string> {
  const resp = await call(cfg, 'POST', `${actId(cfg)}/ads`, {
    name: input.name,
    adset_id: input.adsetId,
    creative: JSON.stringify({ creative_id: input.creativeId }),
    status: 'PAUSED',
  })
  if (!resp.id) throw new MetaError('createPausedAd: no id returned')
  return String(resp.id)
}

// Convenience: current daily budget in RM for display.
export function dailyBudgetRm(state: EntityState): number | null {
  return state.dailyBudgetMinor != null ? fromMinor(state.dailyBudgetMinor) : null
}
