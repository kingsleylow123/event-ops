// GHL (GoHighLevel) REST helper — Private Integration Token auth.
// Used by the Cal.com auto-sync to mirror booked calls into the GHL pipeline.
// Finds-or-creates the contact, then finds-or-creates an opportunity in the
// configured pipeline/stage. Fully no-op (returns nulls) when GHL_API_TOKEN /
// GHL_LOCATION_ID aren't set, so the EventOps sync never fails on GHL being off.
//
// RELIABILITY: GHL recommends rotating Private Integration Tokens ~every 90 days,
// with only a 7-day window where the old + new token both work — after that the
// old token 401s. Historically those failures were swallowed silently, so the
// sync would just stop for days unnoticed. Now every non-OK response is logged,
// and a 401/403 (dead/rotated token) pings the Telegram admins so the env var can
// be rotated inside the grace window. A daily healthcheck (app/api/ghl/health)
// is the backstop signal.

import { notifyAdmins, esc, b } from '@/lib/telegram'

const BASE = 'https://services.leadconnectorhq.com'
const VERSION = '2021-07-28'

// Appointment Funnel → "Scheduled Call" (the live IDs as of Jun 2026). Override
// via env if the pipeline is ever rebuilt — never hardcode-only.
const PIPELINE_ID = process.env.GHL_PIPELINE_ID || '8nI3pKN04AkgRFV3UXgJ'
const STAGE_ID = process.env.GHL_STAGE_ID || 'eccea63a-8dc4-443f-9da2-dd58b16cdc10'

export function ghlEnabled(): boolean {
  return Boolean(process.env.GHL_API_TOKEN && process.env.GHL_LOCATION_ID)
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.GHL_API_TOKEN ?? ''}`,
    Version: VERSION,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

// ── loud-failure alerting ────────────────────────────────────────────────────
// Ping admins the first time a dead/rotated token is seen, rate-limited so a
// broken token can't spam Telegram on every request. (Per-instance in-memory —
// good enough: the daily healthcheck cron runs in a fresh instance and re-alerts.)
let lastAuthAlert = 0
const AUTH_ALERT_COOLDOWN_MS = 60 * 60 * 1000 // 1h

async function alertAuthFailure(status: number, path: string) {
  const now = Date.now()
  if (now - lastAuthAlert < AUTH_ALERT_COOLDOWN_MS) return
  lastAuthAlert = now
  try {
    await notifyAdmins(
      `⚠️ ${b('GHL token rejected')} (HTTP ${status}) — the Private Integration Token looks rotated/revoked.\n` +
      `GHL sync is DOWN until it's replaced.\n` +
      `Fix: Vercel → event-ops → Settings → Environment Variables → update ${b('GHL_API_TOKEN')} → redeploy.\n` +
      `<i>path: ${esc(path)}</i>`,
    )
  } catch { /* alert best-effort — never throw from the fetch path */ }
}

// Central GHL fetch: injects auth headers, logs real failures (401/403/429/5xx),
// and alerts on auth failures. 400/404 are left quiet — callers treat those as
// "duplicate" / "not found" (e.g. GHL returns 400 on a duplicate contact but
// echoes the existing id in meta). Returns null only on a network throw.
async function ghlFetch(path: string, init?: RequestInit): Promise<Response | null> {
  const method = init?.method ?? 'GET'
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...headers(), ...(init?.headers as Record<string, string> | undefined) },
    })
    if (!res.ok && (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500)) {
      const body = await res.clone().text().catch(() => '')
      console.error(`[ghl] ${method} ${path} → ${res.status} ${body.slice(0, 500)}`)
      if (res.status === 401 || res.status === 403) await alertAuthFailure(res.status, path)
    }
    return res
  } catch (e) {
    console.error(`[ghl] ${method} ${path} threw`, e)
    return null
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

async function safeJson(res: Response): Promise<Record<string, unknown>> {
  return asRecord(await res.json().catch(() => ({})))
}

async function findContactId(locationId: string, email: string, phone: string): Promise<string | null> {
  const query = email || phone
  if (!query) return null
  const url = `/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(query)}&limit=10`
  const res = await ghlFetch(url)
  if (!res || !res.ok) return null
  const contacts = asArray((await safeJson(res)).contacts).map(asRecord)
  if (!contacts.length) return null
  const lc = email.toLowerCase()
  const exact = lc ? contacts.find(c => str(c.email).toLowerCase() === lc) : undefined
  return str((exact ?? contacts[0]).id) || null
}

async function createContactId(locationId: string, name: string, email: string, phone: string): Promise<string | null> {
  const res = await ghlFetch('/contacts/', {
    method: 'POST',
    body: JSON.stringify({
      locationId,
      name: name || undefined,
      email: email || undefined,
      phone: phone || undefined,
      source: 'Cal.com',
    }),
  })
  if (!res) return null
  const data = await safeJson(res)
  // On a duplicate, GHL returns 400 but echoes the existing id in meta.
  const direct = str(asRecord(data.contact).id)
  if (direct) return direct
  const metaId = str(asRecord(data.meta).contactId)
  return metaId || null
}

async function findOpportunityId(locationId: string, contactId: string): Promise<string | null> {
  const url = `/opportunities/search?location_id=${encodeURIComponent(locationId)}&contact_id=${encodeURIComponent(contactId)}`
  const res = await ghlFetch(url)
  if (!res || !res.ok) return null
  const opps = asArray((await safeJson(res)).opportunities).map(asRecord)
  const inPipe = opps.find(o => str(o.pipelineId) === PIPELINE_ID)
  return str((inPipe ?? {}).id) || null
}

async function createOpportunityId(locationId: string, contactId: string, name: string): Promise<string | null> {
  const res = await ghlFetch('/opportunities/', {
    method: 'POST',
    body: JSON.stringify({
      pipelineId: PIPELINE_ID,
      pipelineStageId: STAGE_ID,
      locationId,
      contactId,
      name,
      status: 'open',
    }),
  })
  if (!res || !res.ok) return null
  const data = await safeJson(res)
  return str(asRecord(data.opportunity).id) || str(data.id) || null
}

export interface GhlUpsertResult {
  contactId: string | null
  opportunityId: string | null
  createdOpportunity: boolean
}

// Find-or-create the contact + an opportunity in the booked-call pipeline.
// Idempotent: re-running for the same person reuses the existing opportunity.
export async function upsertGhlBookedCall(input: {
  name: string
  email: string
  phone: string
  opportunityName: string
}): Promise<GhlUpsertResult> {
  const locationId = process.env.GHL_LOCATION_ID
  if (!ghlEnabled() || !locationId) return { contactId: null, opportunityId: null, createdOpportunity: false }

  let contactId = await findContactId(locationId, input.email, input.phone)
  if (!contactId) contactId = await createContactId(locationId, input.name, input.email, input.phone)
  if (!contactId) return { contactId: null, opportunityId: null, createdOpportunity: false }

  let opportunityId = await findOpportunityId(locationId, contactId)
  let createdOpportunity = false
  if (!opportunityId) {
    opportunityId = await createOpportunityId(locationId, contactId, input.opportunityName)
    createdOpportunity = Boolean(opportunityId)
  }
  return { contactId, opportunityId, createdOpportunity }
}

// Lightweight authed call used by the daily healthcheck cron. A dead/rotated
// token surfaces here as ok:false (and ghlFetch has already pinged admins).
export async function ghlHealthcheck(): Promise<{ ok: boolean; status: number; enabled: boolean }> {
  const locationId = process.env.GHL_LOCATION_ID
  if (!ghlEnabled() || !locationId) return { ok: false, status: 0, enabled: false }
  const res = await ghlFetch(`/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`)
  return { ok: Boolean(res?.ok), status: res?.status ?? 0, enabled: true }
}
