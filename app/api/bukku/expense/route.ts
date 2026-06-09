// POST /api/bukku/expense — push an event expense into Bukku as a purchase bill,
// posting to the expense account mapped from its category (Venue → Rent, F&B →
// Meal & Entertainment, …). Idempotent on expenses.bukku_bill_id.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/auth/guard'
import { bukkuEnabled, bukkuStatus, findOrCreateContact, createBill, EXPENSE_ACCOUNT_BY_CATEGORY } from '@/lib/bukku'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Body = { expense_id?: string }

export async function POST(req: Request) {
  const g = await requireAdmin('POST /api/bukku/expense')
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
  if (!body.expense_id) {
    return NextResponse.json({ error: 'expense_id is required' }, { status: 400 })
  }

  const { data: exp, error } = await supabaseAdmin
    .from('expenses')
    .select('id, event_id, description, amount, category, created_at, bukku_bill_id')
    .eq('id', body.expense_id)
    .single()
  if (error || !exp) {
    return NextResponse.json({ error: 'Expense not found', details: error?.message }, { status: 404 })
  }
  if (exp.bukku_bill_id) {
    return NextResponse.json({ ok: true, idempotent: true, bukku_bill_id: exp.bukku_bill_id })
  }

  const amount = Math.round(Number(exp.amount ?? 0) * 100) / 100
  if (amount <= 0) {
    return NextResponse.json({ error: 'Expense amount must be greater than zero' }, { status: 422 })
  }

  const category = (exp.category as string) || 'Other'
  const account_id = EXPENSE_ACCOUNT_BY_CATEGORY[category] ?? 33 // 6508 General Expense fallback
  // Group all uncategorised vendors under one tidy supplier per category.
  const supplierName = `Event Costs — ${category}`

  try {
    const contact_id = await findOrCreateContact({ name: supplierName, types: ['supplier'] })
    const { id, number } = await createBill({
      contact_id,
      date: String(exp.created_at ?? new Date().toISOString()).slice(0, 10),
      description: `[${category}] ${exp.description}`,
      amount,
      account_id,
    })

    const { error: upErr } = await supabaseAdmin.from('expenses').update({ bukku_bill_id: id }).eq('id', exp.id)
    if (upErr) {
      return NextResponse.json({
        ok: true, partial: true,
        warning: 'Bill created in Bukku but failed to persist the ID',
        bukku_bill_id: id, bukku_bill_number: number, details: upErr.message,
      }, { status: 207 })
    }
    return NextResponse.json({ ok: true, bukku_bill_id: id, bukku_bill_number: number, amount, account_id, category })
  } catch (e) {
    return NextResponse.json({ error: 'Bukku createBill failed', details: (e as Error).message }, { status: 502 })
  }
}
