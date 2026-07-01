import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, fetchAllRows } from '@/lib/supabase-admin'
import { notifyAdmins, b } from '@/lib/telegram'
import { salesTotalSince } from '@/lib/bukku'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// SST (service tax) registration threshold monitor — runs monthly (vercel.json).
// Malaysia: a business providing taxable services must register for SST once its
// taxable turnover exceeds RM 500,000 in a rolling 12-month period (then charge
// 8% and file bi-monthly). This pings Jarvis at 80% (early warning) and at 100%.
//
// Revenue is CROSS-CHECKED from two sources (per Kingsley's choice):
//   • Supabase — paid ticket/workshop revenue (attendees.payment_amount), the
//     figure we can compute exactly and test today.
//   • Bukku — the official books (all sales incl. manual B2B invoices), read
//     best-effort; null if the Open API list shape can't be parsed.
// The threshold test uses the HIGHER of the two; the alert shows both and flags
// any material mismatch so the books can be reconciled.
//
// Cadence is monthly, so it intentionally re-pings while over threshold (a
// reminder to act). Set SST_MONITOR_OFF once registered to silence it.
const THRESHOLD = 500_000
const WARN = 400_000 // 80%
const MISMATCH_FLAG = 5_000

const rm = (n: number) => 'RM ' + n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export async function GET(req: NextRequest) {
  // Fail CLOSED: require CRON_SECRET to be set AND match (Vercel Cron sends it).
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  if (process.env.SST_MONITOR_OFF) {
    return NextResponse.json({ ok: true, skipped: 'SST_MONITOR_OFF set' })
  }

  // Rolling 12-month window. (CMO Consulting was incorporated Jun 2026, so for
  // now this captures ~all revenue; the date filter future-proofs it.)
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)

  // ── Supabase: paid ticket/workshop revenue, company-wide ───────────────────
  const { rows: paid, error } = await fetchAllRows<{ payment_amount: number | null }>(
    (from, to) =>
      supabaseAdmin
        .from('attendees')
        .select('payment_amount')
        .eq('payment_status', 'paid')
        .order('id', { ascending: true })
        .range(from, to),
  )
  if (error) return NextResponse.json({ ok: false, error }, { status: 500 })
  const supabaseTotal = Math.round(paid.reduce((s, a) => s + Number(a.payment_amount ?? 0), 0) * 100) / 100

  // ── Bukku: official-books cross-check (best-effort; null if unreadable) ─────
  const bukkuTotal = await salesTotalSince(since)

  // Threshold test on the higher figure (Bukku is fuller when it reads).
  const official = Math.max(supabaseTotal, bukkuTotal ?? 0)
  const pct = Math.round((official / THRESHOLD) * 100)

  if (official < WARN) {
    return NextResponse.json({ ok: true, supabaseTotal, bukkuTotal, official, pct, alerted: false })
  }

  // ── Alert ──────────────────────────────────────────────────────────────────
  const over = official >= THRESHOLD
  const head = over ? `🛑 ${b('SST registration threshold reached')}` : `⚠️ ${b('Approaching SST threshold')}`
  let msg = `${head}\n\nTaxable revenue (rolling 12 mo): ${b(rm(official))} — ${pct}% of RM 500,000\n`
  msg += `\n• Supabase (tickets/workshops): ${rm(supabaseTotal)}`
  msg +=
    bukkuTotal == null
      ? `\n• Bukku (official books): could not read — verify manually`
      : `\n• Bukku (official books): ${rm(bukkuTotal)}`
  if (bukkuTotal != null && Math.abs(bukkuTotal - supabaseTotal) >= MISMATCH_FLAG) {
    msg += `\n⚠️ Sources differ by ${rm(Math.abs(bukkuTotal - supabaseTotal))} — reconcile.`
  }
  msg += over
    ? `\n\nAction: register for SST (service tax) and charge 8% on services — talk to your accountant. Set SST_MONITOR_OFF to silence this once registered.`
    : `\n\nHeads-up: at RM 500k of taxable services you must register for SST. Plan ahead.`

  await notifyAdmins(msg)
  return NextResponse.json({ ok: true, supabaseTotal, bukkuTotal, official, pct, alerted: true, over })
}
