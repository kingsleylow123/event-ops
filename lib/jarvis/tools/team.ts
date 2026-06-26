import type Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import type { ToolDef, AgentContext } from '../types'
import { resolveEventId, eventLabel, num } from '../util'
import { logSensitiveRead } from '../observability'

// ── get_team_members ──────────────────────────────────────────────────────────
// Reads team_member_profiles — the onboarding/bank-details table that was
// invisible to the old NL path. Per the admin's explicit choice, the FULL bank
// account number is returned; every read is written to jarvis_audit_log.
const GET_TEAM_MEMBERS_SCHEMA: Anthropic.Tool = {
  name: 'get_team_members',
  description: 'Get team/crew member profiles incl. bank-account submission status and full bank details. Use for "has X submitted their bank account", "what is X\'s bank", "who on the team hasn\'t submitted yet". Optional query filters by name / email / telegram username.',
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Optional: name, email, or telegram username to filter by' } },
  },
}

async function getTeamMembers(args: Record<string, unknown>, ctx: AgentContext) {
  const q = String(args.query ?? '').trim().toLowerCase()
  const { data, error } = await supabase
    .from('team_member_profiles')
    .select('full_name,phone,email,telegram_username,bank_account_name,bank_name,bank_account_number,company_name,created_at')
    .order('created_at', { ascending: false })
  if (error) return { error: error.message }

  let rows = data ?? []
  if (q) {
    rows = rows.filter(
      r =>
        String(r.full_name ?? '').toLowerCase().includes(q) ||
        String(r.email ?? '').toLowerCase().includes(q) ||
        String(r.telegram_username ?? '').toLowerCase().includes(q),
    )
  }

  await logSensitiveRead(ctx.chatId, 'bank_read:team', q || '(all)', rows.length)

  return {
    total: rows.length,
    members: rows.map(r => ({
      name: r.full_name,
      phone: r.phone ?? null,
      email: r.email ?? null,
      telegram: r.telegram_username ?? null,
      bank_submitted: !!(r.bank_account_name && r.bank_name && r.bank_account_number),
      bank_name: r.bank_name ?? null,
      bank_account_name: r.bank_account_name ?? null,
      bank_account_number: r.bank_account_number ?? null, // FULL number, per admin choice
      submitted_at: r.created_at,
    })),
  }
}

// ── get_facilitator_payouts ───────────────────────────────────────────────────
const GET_FACILITATOR_PAYOUTS_SCHEMA: Anthropic.Tool = {
  name: 'get_facilitator_payouts',
  description: 'Get facilitator payout status for an event: who is owed what, their bank details, and whether they have been paid. Use for "facilitator payouts", "who do we still owe", "has X been paid for the workshop".',
  input_schema: {
    type: 'object',
    properties: { event_id: { type: 'string', description: 'Event id. Defaults to active.' } },
  },
}

async function getFacilitatorPayouts(args: Record<string, unknown>, ctx: AgentContext) {
  const eid = resolveEventId(args.event_id, ctx)
  const { data, error } = await supabase
    .from('facilitator_payouts')
    .select('name,amount,bank_name,bank_account,bank_holder,paid_at,hidden')
    .eq('event_id', eid)
  if (error) return { error: error.message }
  const rows = (data ?? []).filter(r => !r.hidden)

  await logSensitiveRead(ctx.chatId, 'bank_read:facilitator', eventLabel(ctx, eid), rows.length)

  let totalToPay = 0
  let totalPaid = 0
  const payouts = rows.map(r => {
    const amount = num(r.amount)
    const isPaid = !!r.paid_at
    totalToPay += amount
    if (isPaid) totalPaid += amount
    return {
      name: r.name,
      amount,
      bank_name: r.bank_name ?? null,
      bank_account: r.bank_account ?? null, // FULL, per admin choice
      bank_holder: r.bank_holder ?? null,
      is_paid: isPaid,
      paid_at: r.paid_at ?? null,
      has_bank_details: !!(r.bank_name && r.bank_account),
    }
  })

  return {
    event: eventLabel(ctx, eid),
    payouts,
    total_to_pay: Math.round(totalToPay * 100) / 100,
    total_paid: Math.round(totalPaid * 100) / 100,
    pending_count: payouts.filter(p => !p.is_paid).length,
  }
}

export const GET_TEAM_MEMBERS_TOOL: ToolDef = { schema: GET_TEAM_MEMBERS_SCHEMA, handler: getTeamMembers, audit: true }
export const GET_FACILITATOR_PAYOUTS_TOOL: ToolDef = { schema: GET_FACILITATOR_PAYOUTS_SCHEMA, handler: getFacilitatorPayouts, audit: true }
