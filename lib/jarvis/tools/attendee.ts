import type Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin as supabase, fetchAllRows } from '@/lib/supabase-admin'
import { normPhone, normEmail } from '@/lib/format'
import { TICKET_LABELS, type TicketType } from '@/lib/supabase'
import type { ToolDef, AgentContext } from '../types'
import { eventNameMap, eventLabel } from '../util'

// ── find_person ───────────────────────────────────────────────────────────────
// Cross-event person search — the core fix for "Agassi/Jeremy/phone not found".
// Searches ALL events by name (substring), phone (normalised), or email.
const FIND_PERSON_SCHEMA: Anthropic.Tool = {
  name: 'find_person',
  description:
    'Search attendees across ALL events (past + present) by name, phone, or email. Returns matches with their event, ticket, payment status/amount/method, and contact details. Use for any "who is / contact for / how did X pay / is X registered" question. Phone numbers are normalised automatically, so any format works.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Name fragment, phone number (any format), or email address' },
      event_id: { type: 'string', description: 'Optional: restrict to one event id. Omit to search every event.' },
    },
    required: ['query'],
  },
}

async function findPerson(args: Record<string, unknown>, ctx: AgentContext) {
  const q = String(args.query ?? '').trim()
  if (!q) return { total: 0, matches: [] }

  const eventId = args.event_id ? String(args.event_id) : null
  // Page past PostgREST's 1000-row cap so an attendee on a later event is never
  // invisibly dropped (.limit() does NOT override the cap).
  const { rows: data, error } = await fetchAllRows<Record<string, unknown>>((from, to) => {
    let qb = supabase
      .from('attendees')
      .select('id,name,phone,email,ticket_type,payment_method,payment_amount,payment_status,paid_at,attendance_confirmed,event_id')
      .order('created_at', { ascending: false })
      .range(from, to)
    if (eventId) qb = qb.eq('event_id', eventId)
    return qb
  })
  if (error) return { error }

  const names = eventNameMap(ctx)
  const ql = q.toLowerCase()
  const qPhone = normPhone(q)
  const qEmail = normEmail(q)

  const hits = (data ?? [])
    .filter(a => {
      const nameHit = String(a.name ?? '').toLowerCase().includes(ql)
      const phoneHit = qPhone.length >= 4 && normPhone(a.phone as string).includes(qPhone)
      const emailHit = qEmail.includes('@') && normEmail(a.email as string).includes(qEmail)
      return nameHit || phoneHit || emailHit
    })
    .slice(0, 15)

  return {
    total: hits.length,
    matches: hits.map(a => ({
      id: a.id,
      name: a.name,
      event: names.get(a.event_id as string) ?? a.event_id,
      phone: a.phone ?? null,
      email: a.email ?? null,
      ticket: TICKET_LABELS[a.ticket_type as TicketType] ?? a.ticket_type,
      payment_status: a.payment_status,
      payment_amount: Number(a.payment_amount ?? 0),
      payment_method: a.payment_method,
      checked_in: a.attendance_confirmed,
      paid_at: a.paid_at ?? null,
    })),
  }
}

// ── get_person_detail ─────────────────────────────────────────────────────────
const GET_PERSON_DETAIL_SCHEMA: Anthropic.Tool = {
  name: 'get_person_detail',
  description: 'Full detail for ONE attendee by id (use an id returned by find_person). Includes notes, attendance flags, and payment history.',
  input_schema: {
    type: 'object',
    properties: { attendee_id: { type: 'string', description: 'The attendee id from find_person' } },
    required: ['attendee_id'],
  },
}

async function getPersonDetail(args: Record<string, unknown>, ctx: AgentContext) {
  const id = String(args.attendee_id ?? '').trim()
  if (!id) return { error: 'attendee_id required' }
  const { data: a, error } = await supabase.from('attendees').select('*').eq('id', id).maybeSingle()
  if (error) return { error: error.message }
  if (!a) return { found: false }
  return {
    found: true,
    attendee: {
      id: a.id,
      name: a.name,
      phone: a.phone ?? null,
      email: a.email ?? null,
      event: eventLabel(ctx, a.event_id as string),
      ticket: TICKET_LABELS[a.ticket_type as TicketType] ?? a.ticket_type,
      payment_status: a.payment_status,
      payment_amount: Number(a.payment_amount ?? 0),
      payment_method: a.payment_method,
      paid_at: a.paid_at ?? null,
      checked_in: a.attendance_confirmed,
      day1_attended: a.day1_attended,
      day2_attended: a.day2_attended,
      is_facilitator: a.is_facilitator,
      notes: a.notes ?? null,
    },
  }
}

export const FIND_PERSON_TOOL: ToolDef = { schema: FIND_PERSON_SCHEMA, handler: findPerson }
export const GET_PERSON_DETAIL_TOOL: ToolDef = { schema: GET_PERSON_DETAIL_SCHEMA, handler: getPersonDetail }
