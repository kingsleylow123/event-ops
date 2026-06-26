import type Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import type { ToolDef, AgentContext } from '../types'
import { resolveEventId, eventLabel, num, round2 } from '../util'

const GET_CLAIMS_DEPOSITS_SCHEMA: Anthropic.Tool = {
  name: 'get_claims_deposits',
  description: 'Open expense claims (team reimbursements awaiting approval/payment) and deposit balances (attendees who paid a partial deposit and still owe) for an event. Use for "open claims", "who do we owe reimbursements", "outstanding deposits / balances due".',
  input_schema: {
    type: 'object',
    properties: {
      event_id: { type: 'string', description: 'Event id. Defaults to active.' },
      type: { type: 'string', enum: ['both', 'claims', 'deposits'], description: 'Default both.' },
    },
  },
}

async function getClaimsDeposits(args: Record<string, unknown>, ctx: AgentContext) {
  const eid = resolveEventId(args.event_id, ctx)
  const want = String(args.type ?? 'both')
  const today = ctx.today

  const result: Record<string, unknown> = { event: eventLabel(ctx, eid) }

  if (want === 'both' || want === 'claims') {
    const { data, error } = await supabase
      .from('claims')
      .select('claimant_name,description,category,amount,status,submitted_at')
      .eq('event_id', eid)
      .order('submitted_at', { ascending: false })
    if (error) return { error: error.message }
    const rows = data ?? []
    const open = rows.filter(r => r.status === 'pending' || r.status === 'approved')
    result.claims = {
      open_count: open.length,
      total_open_amount: round2(open.reduce((s, r) => s + num(r.amount), 0)),
      items: rows.slice(0, 25).map(r => ({ claimant: r.claimant_name, description: r.description, category: r.category, amount: num(r.amount), status: r.status, submitted_at: r.submitted_at })),
    }
  }

  if (want === 'both' || want === 'deposits') {
    const { data, error } = await supabase
      .from('deposits')
      .select('name,phone,total_amount,deposit_paid,due_date,status')
      .eq('event_id', eid)
      .order('due_date', { ascending: true })
    if (error) return { error: error.message }
    const rows = data ?? []
    const partial = rows.filter(r => r.status === 'partial')
    result.deposits = {
      partial_count: partial.length,
      total_outstanding: round2(partial.reduce((s, r) => s + (num(r.total_amount) - num(r.deposit_paid)), 0)),
      overdue_count: partial.filter(r => r.due_date && String(r.due_date) < today).length,
      items: rows.slice(0, 25).map(r => ({
        name: r.name,
        phone: r.phone ?? null,
        total_amount: num(r.total_amount),
        deposit_paid: num(r.deposit_paid),
        balance: round2(num(r.total_amount) - num(r.deposit_paid)),
        due_date: r.due_date ?? null,
        status: r.status,
        overdue: !!(r.due_date && String(r.due_date) < today && r.status === 'partial'),
      })),
    }
  }

  return result
}

export const GET_CLAIMS_DEPOSITS_TOOL: ToolDef = { schema: GET_CLAIMS_DEPOSITS_SCHEMA, handler: getClaimsDeposits }
