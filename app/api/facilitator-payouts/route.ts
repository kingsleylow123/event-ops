import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/auth/guard'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

export const dynamic = 'force-dynamic'

// Owner-name suppression — Huda runs the dashboard and is never paid out as a
// facilitator. Mirrors EXCLUDED_NAMES in /api/facilitator-stats so the payout
// list stays consistent with the Facilitators view.
const EXCLUDED_NAMES = new Set(['huda'])
const norm = (s: string | null) => (s ?? '').trim().toLowerCase()

interface FacilPayoutRow {
  event_id: string
  name: string
  amount: number | null
  bank_name: string | null
  bank_account: string | null
  bank_holder: string | null
  paid_at: string | null
  updated_at: string | null
}

// GET ?event_id=  → facilitator payout report for one event.
// Names come from the event's attendees (is_facilitator = true), deduped by
// name; amount / bank / paid status come from facilitator_payouts. Bank details
// carry forward from the same person's most recent payout on any past event.
export async function GET(req: NextRequest) {
  const g = await requireAdmin('GET /api/facilitator-payouts'); if (g.response) return g.response
  const { searchParams } = new URL(req.url)
  const event_id = searchParams.get('event_id')
  if (!event_id) {
    return NextResponse.json({ error: 'event_id required' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const [facilsRes, payoutsRes] = await Promise.all([
    supabaseAdmin
      .from('attendees')
      .select('name')
      .eq('event_id', event_id)
      .eq('is_facilitator', true),
    supabaseAdmin
      .from('facilitator_payouts')
      .select('event_id, name, amount, bank_name, bank_account, bank_holder, paid_at, updated_at')
      .order('updated_at', { ascending: false }),
  ])

  if (facilsRes.error) return NextResponse.json({ error: facilsRes.error.message }, { status: 500, headers: NO_STORE_HEADERS })

  type AttRow = { name: string | null }
  const attRows = (facilsRes.data ?? []) as AttRow[]
  // Degrade gracefully if the facilitator_payouts table doesn't exist yet (the
  // migration is applied separately): still list facilitators from attendees
  // with zero amounts, rather than failing the whole section.
  if (payoutsRes.error) console.warn('[facilitator-payouts] payouts read failed:', payoutsRes.error.message)
  const payoutRows = (payoutsRes.data ?? []) as FacilPayoutRow[]

  // Dedupe facilitators by normalized name (GLCC splits crews into one row per
  // day — collapse them into a single payee).
  const byName = new Map<string, { display: string }>()
  for (const r of attRows) {
    const key = norm(r.name)
    if (!key || EXCLUDED_NAMES.has(key)) continue
    if (!byName.has(key)) byName.set(key, { display: (r.name ?? '').trim() })
  }

  // This event's payout rows, keyed by normalized name.
  const thisEvent = new Map<string, FacilPayoutRow>()
  // Most recent bank details per person across ALL events (rows are pre-sorted
  // updated_at desc, so the first one we see with bank info wins).
  const bankCarry = new Map<string, Pick<FacilPayoutRow, 'bank_name' | 'bank_account' | 'bank_holder'>>()
  for (const p of payoutRows) {
    const key = norm(p.name)
    if (p.event_id === event_id && !thisEvent.has(key)) thisEvent.set(key, p)
    if (!bankCarry.has(key) && (p.bank_name || p.bank_account || p.bank_holder)) {
      bankCarry.set(key, { bank_name: p.bank_name, bank_account: p.bank_account, bank_holder: p.bank_holder })
    }
  }

  const facilitators = Array.from(byName.entries()).map(([key, f]) => {
    const p = thisEvent.get(key)
    const hasOwnBank = !!(p && (p.bank_name || p.bank_account || p.bank_holder))
    const bank = hasOwnBank ? p! : (bankCarry.get(key) ?? { bank_name: null, bank_account: null, bank_holder: null })
    return {
      name: f.display,
      amount: p?.amount ?? 0,
      bank_name: bank.bank_name ?? null,
      bank_account: bank.bank_account ?? null,
      bank_holder: bank.bank_holder ?? null,
      paid_at: p?.paid_at ?? null,
    }
  })

  facilitators.sort((a, b) => a.name.localeCompare(b.name))
  const total_payout = facilitators.reduce((sum, f) => sum + (Number(f.amount) || 0), 0)

  return NextResponse.json({ facilitators, totals: { total_payout } }, { headers: NO_STORE_HEADERS })
}

// POST ?action=save_amount  { event_id, name, amount }            → set custom amount
// POST ?action=save_bank    { event_id, name, bank_* }            → set bank details
// POST ?action=mark_paid     { event_id, name, amount }           → mark paid (captures amount)
// POST ?action=unmark_paid   { event_id, name }                   → clear paid status
export async function POST(req: NextRequest) {
  const g = await requireAdmin('POST /api/facilitator-payouts'); if (g.response) return g.response
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')
  const body = await req.json().catch(() => ({}))

  const event_id = (body.event_id as string | undefined)?.trim()
  const name = (body.name as string | undefined)?.trim()
  if (!event_id || !name) {
    return NextResponse.json({ error: 'event_id and name required' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const upsert = (row: Record<string, unknown>) =>
    supabaseAdmin
      .from('facilitator_payouts')
      .upsert({ event_id, name, updated_at: new Date().toISOString(), ...row }, { onConflict: 'event_id,name_key' })
      .select()
      .single()

  if (action === 'save_amount') {
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ error: 'valid amount required' }, { status: 400, headers: NO_STORE_HEADERS })
    }
    const { data, error } = await upsert({ amount })
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
    return NextResponse.json(data, { headers: NO_STORE_HEADERS })
  }

  if (action === 'save_bank') {
    const { data, error } = await upsert({
      bank_name: (body.bank_name as string)?.trim() || null,
      bank_account: (body.bank_account as string)?.trim() || null,
      bank_holder: (body.bank_holder as string)?.trim() || null,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
    return NextResponse.json(data, { headers: NO_STORE_HEADERS })
  }

  if (action === 'mark_paid') {
    const amount = Number(body.amount)
    const { data, error } = await upsert({
      ...(Number.isFinite(amount) && amount >= 0 ? { amount } : {}),
      paid_at: new Date().toISOString(),
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
    return NextResponse.json(data, { headers: NO_STORE_HEADERS })
  }

  if (action === 'unmark_paid') {
    const { error } = await supabaseAdmin
      .from('facilitator_payouts')
      .update({ paid_at: null, updated_at: new Date().toISOString() })
      .eq('event_id', event_id)
      .eq('name_key', name.trim().toLowerCase())
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
    return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400, headers: NO_STORE_HEADERS })
}
