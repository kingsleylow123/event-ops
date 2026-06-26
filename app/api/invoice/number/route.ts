// /api/invoice/number — CMO invoice numbering.
//   GET  ?year=2026  → peek the NEXT number (does NOT consume it) — used for the draft.
//   POST { year, client_name, amount, date } → ISSUE: atomically consume the next
//         number, record it in the register, and return it (CMO-YYYY-NNNN).
//
// Backed by the invoice_counters / invoice_register tables + issue_invoice_number()
// function (see supabase/migrations/20260626160000_invoice_numbering.sql).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireUser } from '@/lib/auth/guard'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' } as const

function fmt(year: number, seq: number) {
  return `CMO-${year}-${String(seq).padStart(4, '0')}`
}
function yearOf(req: Request) {
  const y = Number(new URL(req.url).searchParams.get('year'))
  return Number.isFinite(y) && y > 2000 ? y : new Date(Date.now() + 8 * 3600 * 1000).getFullYear() // MYT
}

export async function GET(req: Request) {
  const g = await requireUser('GET /api/invoice/number'); if (g.response) return g.response
  const year = yearOf(req)
  const { data, error } = await supabaseAdmin
    .from('invoice_counters')
    .select('last_seq')
    .eq('year', year)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })
  const nextSeq = (data?.last_seq ?? 0) + 1
  return NextResponse.json({ next: fmt(year, nextSeq), seq: nextSeq, year }, { headers: NO_STORE })
}

export async function POST(req: Request) {
  const g = await requireUser('POST /api/invoice/number'); if (g.response) return g.response
  const body = await req.json().catch(() => ({}))
  const year =
    Number.isFinite(Number(body.year)) && Number(body.year) > 2000
      ? Number(body.year)
      : new Date(Date.now() + 8 * 3600 * 1000).getFullYear()

  const { data, error } = await supabaseAdmin.rpc('issue_invoice_number', {
    p_year: year,
    p_client: (body.client_name || '').toString().trim() || null,
    p_date: /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : null,
    p_amount: Number.isFinite(Number(body.amount)) ? Number(body.amount) : null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })
  return NextResponse.json({ invoice_no: data as string }, { headers: NO_STORE })
}
