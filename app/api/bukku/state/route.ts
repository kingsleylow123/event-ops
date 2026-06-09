// GET /api/bukku/state?event_id= — everything the /bukku page needs to render
// sync status for one event: ticket revenue, affiliate payouts, and expenses,
// each with whether it's already been pushed to Bukku.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/auth/guard'
import { bukkuStatus } from '@/lib/bukku'
import { buildReport } from '@/lib/affiliates'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' } as const

export async function GET(req: Request) {
  const g = await requireAdmin('GET /api/bukku/state')
  if (g.response) return g.response

  const event_id = new URL(req.url).searchParams.get('event_id')
  if (!event_id) {
    return NextResponse.json({ error: 'event_id required', connection: bukkuStatus() }, { status: 400, headers: NO_STORE })
  }

  const [{ data: event }, { data: attendees }, { data: payouts }, { data: expenses }] = await Promise.all([
    supabaseAdmin.from('events').select('id, name, date, bukku_income_id').eq('id', event_id).single(),
    supabaseAdmin.from('attendees').select('payment_amount').eq('event_id', event_id).eq('payment_status', 'paid'),
    supabaseAdmin.from('affiliate_payouts').select('affiliate_id, amount, paid_at, bukku_bill_id').eq('event_id', event_id),
    supabaseAdmin.from('expenses').select('id, description, amount, category, bukku_bill_id').eq('event_id', event_id).order('created_at', { ascending: false }),
  ])

  const ticketTotal = Math.round((attendees ?? []).reduce((s, a) => s + Number(a.payment_amount ?? 0), 0) * 100) / 100
  const paidById = new Map((payouts ?? []).map(p => [p.affiliate_id as string, p]))

  // Affiliate commissions owed for this event (from the authoritative report),
  // merged with their paid/synced state.
  let affiliates: Array<Record<string, unknown>> = []
  try {
    const report = await buildReport(event_id)
    affiliates = report.summary
      .filter(s => s.commission > 0)
      .map(s => {
        const p = paidById.get(s.affiliate_id)
        return {
          affiliate_id: s.affiliate_id,
          handle: s.handle,
          name: s.name,
          commission: Math.round(s.commission * 100) / 100,
          buyers: s.buyers,
          paid: !!p?.paid_at,
          bukku_bill_id: (p?.bukku_bill_id as string | null) ?? null,
        }
      })
  } catch {
    affiliates = []
  }

  return NextResponse.json({
    connection: bukkuStatus(),
    event: event
      ? { id: event.id, name: event.name, date: event.date, bukku_income_id: event.bukku_income_id ?? null,
          paid_count: (attendees ?? []).length, ticket_total: ticketTotal }
      : null,
    affiliates,
    expenses: (expenses ?? []).map(e => ({
      id: e.id, description: e.description, category: e.category,
      amount: Math.round(Number(e.amount ?? 0) * 100) / 100,
      bukku_bill_id: (e.bukku_bill_id as string | null) ?? null,
    })),
  }, { headers: NO_STORE })
}
