// POST /api/bukku/invoice — push the invoice currently on the Invoice page into
// Bukku as a real sales invoice (a receivable), then record any payments the
// user entered (e.g. a deposit) against it.
//
// You still send the client your Oppa-Media PDF; this writes the matching entry
// to the books so AR + reporting are correct. The model is always a CREDIT
// invoice with one payment term, so a fully-unpaid quick invoice shows the whole
// amount outstanding, and balance-mode deposits reduce it.

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/guard'
import { bukkuEnabled, bukkuStatus, findOrCreateContact, createSalesInvoice, recordSalesPayment, ACCOUNTS } from '@/lib/bukku'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Line = { desc: string; qty: number; unit: number }
type Payment = { label: string; amount: number }
type Body = {
  client_name?: string
  date?: string // YYYY-MM-DD
  mode?: 'quick' | 'balance'
  // quick mode
  description?: string
  amount?: number
  // balance mode
  lines?: Line[]
  payments?: Payment[]
  status?: 'ready' | 'draft'
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

export async function POST(req: Request) {
  const g = await requireAdmin('POST /api/bukku/invoice')
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

  const name = (body.client_name || '').trim()
  if (!name || name.toUpperCase() === 'CLIENT NAME') {
    return NextResponse.json({ error: 'Enter the client name before pushing to Bukku' }, { status: 422 })
  }
  const date = body.date && ISO.test(body.date) ? body.date : new Date().toISOString().slice(0, 10)

  // Build line items from whichever mode is active.
  // Both modes may send an itemised `lines` array (balance mode always does;
  // quick mode does once it has multiple tickets). Quick mode still accepts the
  // legacy single `description` + `amount` shape as a fallback.
  const lines =
    body.lines && body.lines.length
      ? body.lines
          .map(l => ({ description: (l.desc || '').trim() || 'Workshop', quantity: num(l.qty) || 1, unit_price: num(l.unit) }))
          .filter(l => l.unit_price > 0)
      : [
          {
            description: (body.description || 'Claude Workshop').trim(),
            quantity: 1,
            unit_price: num(body.amount),
          },
        ].filter(l => l.unit_price > 0)

  if (lines.length === 0) {
    return NextResponse.json({ error: 'Nothing to invoice — add a line with a non-zero amount' }, { status: 422 })
  }

  const total = round2(lines.reduce((s, l) => s + l.quantity * l.unit_price, 0))
  const payments = (body.payments ?? []).map(p => ({ label: (p.label || 'Payment').trim(), amount: num(p.amount) })).filter(p => p.amount > 0)
  const paidSoFar = round2(payments.reduce((s, p) => s + p.amount, 0))

  try {
    const contact_id = await findOrCreateContact({ name, types: ['customer'] })

    const { id, number } = await createSalesInvoice({
      contact_id,
      date,
      lines: lines.map(l => ({ ...l, account_id: ACCOUNTS.revenue })),
      status: body.status ?? 'ready',
    })

    // Record any deposits/payments against the freshly-created invoice.
    const recorded: Array<{ label: string; amount: number; payment_id: string }> = []
    for (const p of payments) {
      try {
        const payment_id = await recordSalesPayment({ contact_id, date, amount: p.amount, invoice_id: id })
        recorded.push({ ...p, payment_id })
      } catch (e) {
        // Invoice already exists; surface the payment failure but don't fail the whole push.
        return NextResponse.json(
          {
            ok: true,
            partial: true,
            warning: `Invoice ${number ?? id} created, but recording payment "${p.label}" failed`,
            bukku_invoice_id: id,
            bukku_invoice_number: number,
            contact_id,
            total,
            recorded,
            details: (e as Error).message,
          },
          { status: 207 },
        )
      }
    }

    return NextResponse.json({
      ok: true,
      bukku_invoice_id: id,
      bukku_invoice_number: number,
      contact_id,
      total,
      paid: paidSoFar,
      balance_due: round2(total - paidSoFar),
      recorded,
    })
  } catch (e) {
    return NextResponse.json({ error: 'Bukku push failed', details: (e as Error).message }, { status: 502 })
  }
}

function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = parseFloat(String(v ?? '').replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? n : 0
}
function round2(n: number): number {
  return Math.round(n * 100) / 100
}
