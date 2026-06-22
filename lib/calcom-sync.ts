// Cal.com → pipeline sync core. One normalizer + one upsert used by BOTH the
// live webhook (app/api/webhooks/calcom) and the backfill cron
// (app/api/calcom/sync). Writes a `deal_leads` row (status='meeting',
// source='calcom') keyed idempotently on the Cal.com booking uid, then mirrors
// the lead into GHL. All Cal.com free-text is UNTRUSTED data — only ever stored
// or escaped, never executed.

import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { normPhone } from '@/lib/format'
import { upsertGhlBookedCall } from '@/lib/ghl'

export const CAL_API_BASE = 'https://api.cal.com/v2'

// ── unknown-narrowing helpers (strict-mode safe) ─────────────────────────────
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function str(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

// Cal.com booking-field responses come in two shapes: flat (v2 API:
// bookingFieldsResponses) or wrapped (webhook: responses → { value }). Read both.
function respVal(responses: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    if (!(k in responses)) continue
    const raw = responses[k]
    if (raw == null) continue
    if (typeof raw === 'object' && !Array.isArray(raw)) {
      const v = (raw as Record<string, unknown>).value
      if (Array.isArray(v)) return v.map(str).filter(Boolean).join(', ')
      const s = str(v)
      if (s) return s
    } else if (Array.isArray(raw)) {
      const s = raw.map(str).filter(Boolean).join(', ')
      if (s) return s
    } else {
      const s = str(raw)
      if (s) return s
    }
  }
  return ''
}

export interface NormBooking {
  uid: string
  startISO: string | null
  name: string
  email: string
  phone: string
  meetingUrl: string
  notes: string
  facilitator: string
  company: string
  teamSize: string
  obstacle: string
  cancelled: boolean
}

// Accepts either a v2 API booking object OR a webhook payload's `payload` object.
export function normalizeBooking(raw: unknown, triggerEvent?: string): NormBooking {
  const b = asRecord(raw)
  const responses = asRecord(b.bookingFieldsResponses ?? b.responses)
  const attendee = asRecord(asArray(b.attendees)[0])

  const name = str(b.name) || str(attendee.name) || respVal(responses, 'name')
  const email = (str(attendee.email) || respVal(responses, 'email')).trim().toLowerCase()
  const phone = respVal(responses, 'phone_number', 'phone', 'attendeePhoneNumber', 'smsReminderNumber')

  const start = str(b.start) || str(b.startTime)
  const videoUrl = str(asRecord(b.videoCallData).url)
  const location = typeof b.location === 'string' ? b.location : str(asRecord(b.location).value)
  const meetingUrl = str(b.meetingUrl) || videoUrl || (location.startsWith('http') ? location : '')

  const status = str(b.status).toLowerCase()
  const cancelled = status.includes('cancel') || (triggerEvent ?? '').toUpperCase().includes('CANCELLED')

  return {
    uid: str(b.uid),
    startISO: start ? new Date(start).toISOString() : null,
    name: name.trim(),
    email,
    phone: phone.trim(),
    meetingUrl,
    notes: str(b.description) || respVal(responses, 'notes'),
    facilitator: respVal(responses, 'Which-facilitator-you-want-to-speak-to'),
    company: respVal(responses, 'Company-website---social-media-link'),
    teamSize: respVal(responses, 'No-of-Team-Members'),
    obstacle: respVal(responses, 'Whats-the-biggest-obstacle-holding-you-or-your-business-back'),
    cancelled,
  }
}

// Decide which event a booking belongs to: prefer the most recent event the
// booker actually attended (matched by normalized phone), else the newest event
// overall (override with CALCOM_DEFAULT_EVENT_ID). deal_leads.event_id is NOT
// NULL, so this must always resolve when any event exists.
async function resolveEvent(phoneNorm: string): Promise<{ eventId: string | null; attendeeId: string | null }> {
  if (phoneNorm && phoneNorm.length >= 6) {
    const tail = phoneNorm.slice(-8)
    const { data: atts } = await supabase
      .from('attendees')
      .select('id, phone, event_id')
      .ilike('phone', `%${tail}%`)
    const match = (atts ?? []).find(a => normPhone(a.phone as string) === phoneNorm)
    if (match) {
      // confirm the matched attendee's event is the most recent they attended
      const matches = (atts ?? []).filter(a => normPhone(a.phone as string) === phoneNorm)
      const eventIds = [...new Set(matches.map(m => m.event_id as string))]
      if (eventIds.length === 1) return { eventId: eventIds[0], attendeeId: match.id as string }
      const { data: evs } = await supabase.from('events').select('id, date').in('id', eventIds)
      const newest = (evs ?? []).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]
      const newestId = (newest?.id as string) ?? (match.event_id as string)
      const att = matches.find(m => m.event_id === newestId) ?? match
      return { eventId: newestId, attendeeId: att.id as string }
    }
  }
  const fallback = process.env.CALCOM_DEFAULT_EVENT_ID
  if (fallback) return { eventId: fallback, attendeeId: null }
  const { data: latest } = await supabase
    .from('events').select('id').order('date', { ascending: false }).limit(1).maybeSingle()
  return { eventId: (latest?.id as string) ?? null, attendeeId: null }
}

function buildNeeds(nb: NormBooking): string {
  const head = [nb.company, nb.teamSize].filter(Boolean).join(' · ')
  return [head, nb.notes].filter(Boolean).join('. ').slice(0, 2000) || 'Booked a call via Cal.com.'
}
function buildFounderNotes(nb: NormBooking): string {
  const bits: string[] = []
  if (nb.facilitator) bits.push(`Requested facilitator: ${nb.facilitator}`)
  if (nb.obstacle) bits.push(`Obstacle: ${nb.obstacle}`)
  bits.push('Booked via Cal.com.')
  return bits.join(' · ')
}

export interface SyncOutcome {
  uid: string
  name: string
  action: 'created' | 'updated' | 'cancelled' | 'skipped'
  reason?: string
  ghlOpportunityId?: string | null
}

// Upsert one normalized booking into deal_leads (+ GHL mirror). Idempotent on uid.
export async function syncBooking(nb: NormBooking): Promise<SyncOutcome> {
  if (!nb.uid) return { uid: '', name: nb.name, action: 'skipped', reason: 'no uid' }

  const phoneNorm = normPhone(nb.phone)
  const { data: existing } = await supabase
    .from('deal_leads')
    .select('id, ghl_contact_id, ghl_opportunity_id, status')
    .eq('cal_booking_uid', nb.uid)
    .maybeSingle()

  // Cancellation → mark the existing lead lost (don't create one from a cancel).
  if (nb.cancelled) {
    if (!existing) return { uid: nb.uid, name: nb.name, action: 'skipped', reason: 'cancel for unknown booking' }
    await supabase.from('deal_leads')
      .update({ status: 'lost', updated_at: new Date().toISOString() })
      .eq('id', existing.id as string)
    return { uid: nb.uid, name: nb.name, action: 'cancelled' }
  }

  const { eventId, attendeeId } = await resolveEvent(phoneNorm)

  // Mirror into GHL (best-effort — never block the pipeline write on GHL).
  let ghl = { contactId: null as string | null, opportunityId: null as string | null }
  try {
    const r = await upsertGhlBookedCall({
      name: nb.name,
      email: nb.email,
      phone: nb.phone,
      opportunityName: `${nb.name || 'Lead'} — GLCC Coaching Call`,
    })
    ghl = { contactId: r.contactId, opportunityId: r.opportunityId }
  } catch { /* GHL down → keep the EventOps write */ }

  const common = {
    client_name: nb.name || 'Unknown',
    client_phone: nb.phone || '',
    client_phone_norm: phoneNorm,
    client_email: nb.email || null,
    needs: buildNeeds(nb),
    founder_notes: buildFounderNotes(nb),
    status: 'meeting',
    source: 'calcom',
    call_scheduled_at: nb.startISO,
    meeting_url: nb.meetingUrl || null,
    ghl_contact_id: ghl.contactId ?? (existing?.ghl_contact_id as string | null) ?? null,
    ghl_opportunity_id: ghl.opportunityId ?? (existing?.ghl_opportunity_id as string | null) ?? null,
    updated_at: new Date().toISOString(),
  }

  if (existing) {
    await supabase.from('deal_leads').update(common).eq('id', existing.id as string)
    return { uid: nb.uid, name: nb.name, action: 'updated', ghlOpportunityId: common.ghl_opportunity_id }
  }

  if (!eventId) return { uid: nb.uid, name: nb.name, action: 'skipped', reason: 'no event to attach to' }

  const { error } = await supabase.from('deal_leads').insert({
    event_id: eventId,
    rep_name: 'Cal.com (auto-sync)',
    attendee_id: attendeeId,
    cal_booking_uid: nb.uid,
    ...common,
  })
  if (error) {
    // partial-unique race on cal_booking_uid → another worker inserted it first
    if (String(error.message).toLowerCase().includes('duplicate')) {
      return { uid: nb.uid, name: nb.name, action: 'skipped', reason: 'race duplicate' }
    }
    return { uid: nb.uid, name: nb.name, action: 'skipped', reason: error.message }
  }
  return { uid: nb.uid, name: nb.name, action: 'created', ghlOpportunityId: common.ghl_opportunity_id }
}

// Pull upcoming bookings from the Cal.com v2 API (used by the backfill cron).
export async function fetchUpcomingBookings(): Promise<NormBooking[]> {
  const key = process.env.CALCOM_API_KEY
  if (!key) return []
  const res = await fetch(`${CAL_API_BASE}/bookings?status=upcoming&sortStart=asc`, {
    headers: { Authorization: `Bearer ${key}`, 'cal-api-version': '2024-08-13' },
    cache: 'no-store',
  })
  if (!res.ok) return []
  const data = asRecord(await res.json().catch(() => ({})))
  return asArray(data.data).map(b => normalizeBooking(b))
}
