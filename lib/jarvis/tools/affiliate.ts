import type Anthropic from '@anthropic-ai/sdk'
import { buildReport } from '@/lib/affiliates'
import type { ToolDef, AgentContext } from '../types'
import { resolveEventId, eventLabel, round2, maskAccountNo } from '../util'
import { logSensitiveRead } from '../observability'

const GET_AFFILIATE_REPORT_SCHEMA: Anthropic.Tool = {
  name: 'get_affiliate_report',
  description: 'Affiliate (Creator Circle) payout report for an event: each affiliate\'s paid buyers, revenue brought, 10% commission owed, bank details, and paid/unpaid status. Optional handle filters to one affiliate (loose match). Use for "affiliate payouts", "what does <handle> get", "who did <handle> bring".',
  input_schema: {
    type: 'object',
    properties: {
      event_id: { type: 'string', description: 'Event id. Defaults to active.' },
      handle: { type: 'string', description: 'Optional: one affiliate handle (partial match ok).' },
    },
  },
}

async function getAffiliateReport(args: Record<string, unknown>, ctx: AgentContext) {
  const eid = resolveEventId(args.event_id, ctx)
  let rep
  try {
    rep = await buildReport(eid)
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }

  let summary = rep.summary
  const handle = String(args.handle ?? '').trim().toLowerCase()
  if (handle) {
    summary = summary.filter(s => s.handle.toLowerCase().includes(handle))
    if (!summary.length) return { event: eventLabel(ctx, eid), found: false, message: `No affiliate matching "${handle}" with buyers on this event.` }
  }

  // Affiliate rows carry full bank details — audit the read like team/facilitator.
  await logSensitiveRead(ctx.chatId, 'bank_read:affiliate', handle || '(all)', summary.length)

  return {
    event: eventLabel(ctx, eid),
    affiliates: summary.map(s => ({
      handle: s.handle,
      name: s.name,
      buyers: s.buyers,
      revenue: round2(s.revenue),
      commission: round2(s.commission),
      paid: !!s.paid_at,
      paid_at: s.paid_at,
      bank_name: s.bank_name,
      bank_account: maskAccountNo(s.bank_account), // masked: last 4 only (security)
      bank_holder: s.bank_holder,
      buyer_list: s.buyer_list.map(x => ({ name: x.name, amount: round2(x.amount) })),
    })),
    total_commission: round2(rep.totals.total_commission),
    unattributed_revenue: round2(rep.totals.unattributed_revenue),
  }
}

export const GET_AFFILIATE_REPORT_TOOL: ToolDef = { schema: GET_AFFILIATE_REPORT_SCHEMA, handler: getAffiliateReport }
