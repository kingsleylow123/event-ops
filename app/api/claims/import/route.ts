// POST /api/claims/import  { event_id?: 'all' | <id> }
// Syncs reimbursement claims from the event's expenses (the source of truth):
//   • each expense          → one claim (linked via expense_id)
//   • new expenses          → inserted as pending claims
//   • existing claims        → amount / description / category refreshed from
//     the expense; the "paid by" name, status and reimbursed date are preserved
// Manual claims (no expense_id) are left untouched. Idempotent.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/auth/guard'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' } as const
const r2 = (n: number) => Math.round(n * 100) / 100

export async function POST(req: Request) {
  const g = await requireAdmin('POST /api/claims/import')
  if (g.response) return g.response

  const body = await req.json().catch(() => ({}))
  const event_id = (body as { event_id?: string }).event_id || 'all'

  let expQ = supabaseAdmin.from('expenses').select('id, event_id, description, amount, category, created_at')
  let claimQ = supabaseAdmin.from('claims').select('id, expense_id, amount, description, category')
  if (event_id !== 'all') {
    expQ = expQ.eq('event_id', event_id)
    claimQ = claimQ.eq('event_id', event_id)
  }
  const [{ data: expenses, error: expErr }, { data: claims, error: clErr }] = await Promise.all([expQ, claimQ])
  if (expErr || clErr) {
    return NextResponse.json({ error: (expErr ?? clErr)!.message }, { status: 500, headers: NO_STORE })
  }

  const claimByExpense = new Map<string, { id: string; amount: number | null; description: string | null; category: string | null }>()
  for (const c of claims ?? []) {
    if (c.expense_id) claimByExpense.set(c.expense_id as string, c as { id: string; amount: number | null; description: string | null; category: string | null })
  }

  const rows: Record<string, unknown>[] = []
  const updates: PromiseLike<unknown>[] = []
  for (const e of expenses ?? []) {
    const amount = r2(Number(e.amount ?? 0))
    const description = (e.description as string | null) ?? ''
    const category = (e.category as string | null) || 'Other'
    const existing = claimByExpense.get(e.id as string)
    if (!existing) {
      rows.push({
        event_id: e.event_id,
        expense_id: e.id,
        claimant_name: '', // "paid by" — fill in on the claim
        description,
        category,
        amount,
        status: 'pending',
        submitted_at: e.created_at,
      })
    } else if (r2(Number(existing.amount ?? 0)) !== amount || existing.description !== description || existing.category !== category) {
      updates.push(
        supabaseAdmin.from('claims').update({ amount, description, category }).eq('id', existing.id)
      )
    }
  }

  const updated = updates.length
  if (updates.length) await Promise.all(updates)

  let imported = 0
  if (rows.length) {
    const { error: insErr } = await supabaseAdmin.from('claims').insert(rows)
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500, headers: NO_STORE })
    imported = rows.length
  }

  return NextResponse.json({ ok: true, imported, updated }, { headers: NO_STORE })
}
