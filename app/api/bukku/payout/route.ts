// POST /api/bukku/payout — push a marked-paid affiliate payout into Bukku as a
// purchase bill (a payable to that affiliate as a supplier). The commission
// amount is taken from the authoritative payout report, not the client.
// Idempotent on affiliate_payouts.bukku_bill_id.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/auth/guard'
import { bukkuEnabled, bukkuStatus, findOrCreateContact, createBill, ACCOUNTS } from '@/lib/bukku'
import { buildReport } from '@/lib/affiliates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Body = { event_id?: string; affiliate_id?: string }

export async function POST(req: Request) {
  const g = await requireAdmin('POST /api/bukku/payout')
  if (g.response) return g.response

  if (!bukkuEnabled()) {
    return NextResponse.json({ error: 'Bukku not configured', status: bukkuStatus() }, { status: 503 })
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.event_id || !body.affiliate_id) {
    return NextResponse.json({ error: 'event_id and affiliate_id are required' }, { status: 400 })
  }

  // Must be marked paid first — that's the row we stamp the bill id onto.
  const { data: payout, error: pErr } = await supabaseAdmin
    .from('affiliate_payouts')
    .select('id, amount, paid_at, bukku_bill_id')
    .eq('event_id', body.event_id)
    .eq('affiliate_id', body.affiliate_id)
    .maybeSingle()
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })
  if (!payout) {
    return NextResponse.json({ error: 'Mark this affiliate as paid before pushing to Bukku' }, { status: 422 })
  }
  if (payout.bukku_bill_id) {
    return NextResponse.json({ ok: true, idempotent: true, bukku_bill_id: payout.bukku_bill_id })
  }

  // Authoritative commission + the affiliate's profile/bank from the report.
  let report
  try {
    report = await buildReport(body.event_id)
  } catch (e) {
    return NextResponse.json({ error: 'Failed to build payout report', details: (e as Error).message }, { status: 500 })
  }
  const row = report.summary.find(s => s.affiliate_id === body.affiliate_id)
  const amount = Math.round((row?.commission ?? Number(payout.amount ?? 0)) * 100) / 100
  if (amount <= 0) {
    return NextResponse.json({ error: 'Affiliate has zero commission — nothing to bill' }, { status: 422 })
  }
  const handle = row?.handle ?? body.affiliate_id
  const supplierName = row?.name ? `${row.name} (@${handle})` : `@${handle}`

  try {
    const contact_id = await findOrCreateContact({
      name: supplierName,
      types: ['supplier'],
      bank_account_no: row?.bank_account ?? undefined,
    })
    const { id, number } = await createBill({
      contact_id,
      date: String(payout.paid_at ?? new Date().toISOString()).slice(0, 10),
      description: `Affiliate commission — @${handle} (${row?.buyers ?? 0} buyer${(row?.buyers ?? 0) === 1 ? '' : 's'})`,
      amount,
      account_id: ACCOUNTS.affiliateCommission,
    })

    const { error: upErr } = await supabaseAdmin
      .from('affiliate_payouts')
      .update({ bukku_bill_id: id })
      .eq('id', payout.id)
    if (upErr) {
      return NextResponse.json({
        ok: true, partial: true,
        warning: 'Bill created in Bukku but failed to persist the ID',
        bukku_bill_id: id, bukku_bill_number: number, details: upErr.message,
      }, { status: 207 })
    }
    return NextResponse.json({ ok: true, bukku_bill_id: id, bukku_bill_number: number, amount, contact_id })
  } catch (e) {
    return NextResponse.json({ error: 'Bukku createBill failed', details: (e as Error).message }, { status: 502 })
  }
}
