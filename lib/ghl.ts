// GHL (GoHighLevel) REST helper — Private Integration Token auth.
// Used by the Cal.com auto-sync to mirror booked calls into the GHL pipeline.
// Finds-or-creates the contact, then finds-or-creates an opportunity in the
// configured pipeline/stage. Fully no-op (returns nulls) when GHL_API_TOKEN /
// GHL_LOCATION_ID aren't set, so the EventOps sync never fails on GHL being off.

const BASE = 'https://services.leadconnectorhq.com'
const VERSION = '2021-07-28'

// Appointment Funnel → "Scheduled Call" (the live IDs as of Jun 2026). Override
// via env if the pipeline is ever rebuilt — never hardcode-only.
const PIPELINE_ID = process.env.GHL_PIPELINE_ID || '8nI3pKN04AkgRFV3UXgJ'
const STAGE_ID = process.env.GHL_STAGE_ID || 'eccea63a-8dc4-443f-9da2-dd58b16cdc10'

export function ghlEnabled(): boolean {
  return Boolean(process.env.GHL_API_TOKEN && process.env.GHL_LOCATION_ID)
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Version: VERSION,
    Accept: 'application/json',
    'Content-Type': 'application/json',
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

async function findContactId(token: string, locationId: string, email: string, phone: string): Promise<string | null> {
  const query = email || phone
  if (!query) return null
  const url = `${BASE}/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(query)}&limit=10`
  const res = await fetch(url, { headers: headers(token) })
  if (!res.ok) return null
  const contacts = asArray((await safeJson(res)).contacts).map(asRecord)
  if (!contacts.length) return null
  const lc = email.toLowerCase()
  const exact = lc ? contacts.find(c => str(c.email).toLowerCase() === lc) : undefined
  return str((exact ?? contacts[0]).id) || null
}

async function createContactId(token: string, locationId: string, name: string, email: string, phone: string): Promise<string | null> {
  const res = await fetch(`${BASE}/contacts/`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      locationId,
      name: name || undefined,
      email: email || undefined,
      phone: phone || undefined,
      source: 'Cal.com',
    }),
  })
  const data = await safeJson(res)
  // On a duplicate, GHL returns 400 but echoes the existing id in meta.
  const direct = str(asRecord(data.contact).id)
  if (direct) return direct
  const metaId = str(asRecord(data.meta).contactId)
  return metaId || null
}

async function findOpportunityId(token: string, locationId: string, contactId: string): Promise<string | null> {
  const url = `${BASE}/opportunities/search?location_id=${encodeURIComponent(locationId)}&contact_id=${encodeURIComponent(contactId)}`
  const res = await fetch(url, { headers: headers(token) })
  if (!res.ok) return null
  const opps = asArray((await safeJson(res)).opportunities).map(asRecord)
  const inPipe = opps.find(o => str(o.pipelineId) === PIPELINE_ID)
  return str((inPipe ?? {}).id) || null
}

async function createOpportunityId(token: string, locationId: string, contactId: string, name: string): Promise<string | null> {
  const res = await fetch(`${BASE}/opportunities/`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      pipelineId: PIPELINE_ID,
      pipelineStageId: STAGE_ID,
      locationId,
      contactId,
      name,
      status: 'open',
    }),
  })
  if (!res.ok) return null
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
  const token = process.env.GHL_API_TOKEN
  const locationId = process.env.GHL_LOCATION_ID
  if (!token || !locationId) return { contactId: null, opportunityId: null, createdOpportunity: false }

  let contactId = await findContactId(token, locationId, input.email, input.phone)
  if (!contactId) contactId = await createContactId(token, locationId, input.name, input.email, input.phone)
  if (!contactId) return { contactId: null, opportunityId: null, createdOpportunity: false }

  let opportunityId = await findOpportunityId(token, locationId, contactId)
  let createdOpportunity = false
  if (!opportunityId) {
    opportunityId = await createOpportunityId(token, locationId, contactId, input.opportunityName)
    createdOpportunity = Boolean(opportunityId)
  }
  return { contactId, opportunityId, createdOpportunity }
}
