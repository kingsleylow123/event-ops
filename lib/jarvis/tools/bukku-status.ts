import type Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import type { ToolDef, AgentContext } from '../types'
import { resolveEventId, eventLabel } from '../util'

// Bukku tab — push-to-accounting sync state. Revenue lands on events.bukku_income_id;
// affiliate commissions + expenses each carry a bukku_bill_id once pushed.
const GET_BUKKU_STATUS_SCHEMA: Anthropic.Tool = {
  name: 'get_bukku_status',
  description: 'Get the Bukku accounting sync status for an event: whether ticket revenue, affiliate commissions, and expenses have been pushed to Bukku, and what is still unsynced. Use for "is X synced to Bukku", "what\'s left to push to the books".',
  input_schema: { type: 'object', properties: { event_id: { type: 'string', description: 'Event id. Defaults to active.' } } },
}

async function getBukkuStatus(args: Record<string, unknown>, ctx: AgentContext) {
  const eid = resolveEventId(args.event_id, ctx)
  const [evRes, expRes, payRes] = await Promise.all([
    supabase.from('events').select('bukku_income_id, bukku_contact_id').eq('id', eid).maybeSingle(),
    supabase.from('expenses').select('bukku_bill_id').eq('event_id', eid),
    supabase.from('affiliate_payouts').select('bukku_bill_id').eq('event_id', eid),
  ])
  if (evRes.error) return { error: evRes.error.message }
  const exp = expRes.data ?? []
  const pay = payRes.data ?? []
  const expSynced = exp.filter(e => e.bukku_bill_id).length
  const paySynced = pay.filter(p => p.bukku_bill_id).length
  return {
    event: eventLabel(ctx, eid),
    revenue_synced: !!evRes.data?.bukku_income_id,
    expenses: { total: exp.length, synced: expSynced, unsynced: exp.length - expSynced },
    affiliate_bills: { total: pay.length, synced: paySynced, unsynced: pay.length - paySynced },
    fully_synced: !!evRes.data?.bukku_income_id && expSynced === exp.length && paySynced === pay.length,
  }
}

export const GET_BUKKU_STATUS_TOOL: ToolDef = { schema: GET_BUKKU_STATUS_SCHEMA, handler: getBukkuStatus }
