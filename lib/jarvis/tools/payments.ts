import type Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { TICKET_LABELS, type TicketType } from '@/lib/supabase'
import type { ToolDef, AgentContext, StagedWrite } from '../types'
import { eventLabel, RM, num } from '../util'
import { esc } from '../html'

// ── mark_paid (write — staged via YES gate) ───────────────────────────────────
const MARK_PAID_SCHEMA: Anthropic.Tool = {
  name: 'mark_paid',
  description: 'Mark a PENDING attendee as paid. Get their id from find_person first. This STAGES the change — the admin must reply YES to confirm. Only works on attendees currently pending.',
  input_schema: {
    type: 'object',
    properties: { attendee_id: { type: 'string', description: 'The attendee id from find_person' } },
    required: ['attendee_id'],
  },
}

async function markPaid(args: Record<string, unknown>, ctx: AgentContext): Promise<unknown> {
  const id = String(args.attendee_id ?? '').trim()
  if (!id) return { ok: false, reason: 'attendee_id required' }
  const { data: a, error } = await supabase
    .from('attendees')
    .select('id,name,payment_status,payment_amount,ticket_type,event_id')
    .eq('id', id)
    .maybeSingle()
  if (error) return { ok: false, reason: error.message }
  if (!a) return { ok: false, reason: 'No attendee with that id.' }
  if (a.payment_status === 'paid') return { ok: false, reason: `${a.name} is already marked paid.` }
  if (a.payment_status !== 'pending') return { ok: false, reason: `${a.name} is "${a.payment_status}", not pending — can't mark paid.` }

  const amount = num(a.payment_amount)
  const ticket = TICKET_LABELS[a.ticket_type as TicketType] ?? a.ticket_type
  const preview =
    `💰 <b>Mark as paid</b>\n` +
    `• <b>${esc(a.name)}</b> — ${esc(eventLabel(ctx, a.event_id as string))}\n` +
    `  ${esc(ticket)} · ${esc(RM(amount))}\n\n` +
    `Reply <b>YES</b> to confirm, or "cancel". Expires in 10 min.`

  const staged: StagedWrite = {
    __staged: true,
    kind: 'mark_paid',
    preview,
    pending: { attendee_id: id, name: a.name, amount },
  }
  return staged
}

// Executed by the route's YES handler after confirmation. Idempotent: only flips
// a row that is still pending, so a double-YES can't double-process.
export async function executeMarkPaid(pending: Record<string, unknown>): Promise<string> {
  const id = String(pending.attendee_id ?? '')
  const name = String(pending.name ?? 'attendee')
  if (!id) return '⚠️ Mark-paid had no attendee id — nothing changed.'
  const { data, error } = await supabase
    .from('attendees')
    .update({ payment_status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', id)
    .eq('payment_status', 'pending')
    .select('id')
  if (error) return `🛑 Couldn't mark ${name} paid: ${error.message}`
  if (!data || !data.length) return `ℹ️ ${name} was no longer pending — nothing changed.`
  return `✅ ${name} marked as <b>paid</b>.`
}

export const MARK_PAID_TOOL: ToolDef = { schema: MARK_PAID_SCHEMA, handler: markPaid, write: true }
