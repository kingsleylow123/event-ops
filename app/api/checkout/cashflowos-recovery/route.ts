import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail, cashflowosRecoveryEmailHtml, emailEnabled, SUPPORT_FROM } from '@/lib/email'
import { addContactTags } from '@/lib/ghl'
import { notifyAdmins, b, esc } from '@/lib/telegram'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'no-store' } as const

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://event-ops-six.vercel.app'
const CHECKOUT_URL = `${BASE}/cashflowos`
// Client-facing sender: the Claude Malaysia support identity (replies route to
// claudemalaysiaofficial@gmail.com + mirror into EventOps). Env-overridable.
const RECOVERY_FROM = process.env.EMAIL_FROM_RECOVERY || SUPPORT_FROM
// Wait this long after a lead starts before nudging — gives genuine finishers
// time to pay so we don't email someone mid-checkout.
const DELAY_MIN = Number(process.env.CASHFLOWOS_RECOVERY_DELAY_MIN || 45)
// Safety cap per run (cron is frequent, so this is just a runaway guard).
const MAX_PER_RUN = 100

interface Lead { id: string; email: string; name: string | null; ghl_contact_id: string | null }

// CashflowOS abandon-cart EMAIL recovery (GHL's workflow builder wouldn't let us
// wire this reliably, so it lives in code we control). Cron finds contacts who
// started /cashflowos checkout but never paid and haven't been chased, then emails
// each exactly once. Paid contacts carry paid_at (Stripe webhook) and are excluded;
// recovery_email_sent_at guarantees one-and-done. Guarded by CRON_SECRET.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE })
  }

  if (!emailEnabled()) {
    return NextResponse.json({ ok: false, reason: 'RESEND_API_KEY not set' }, { headers: NO_STORE })
  }

  const cutoff = new Date(Date.now() - DELAY_MIN * 60_000).toISOString()
  const { data, error } = await supabaseAdmin
    .from('cashflowos_leads')
    .select('id, email, name, ghl_contact_id')
    .is('paid_at', null)
    .is('recovery_email_sent_at', null)
    .lt('started_at', cutoff)
    .order('started_at', { ascending: true })
    .limit(MAX_PER_RUN)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: NO_STORE })
  }

  const leads = (data ?? []) as Lead[]
  let sent = 0
  let failed = 0

  for (const lead of leads) {
    const first = (lead.name ?? '').trim().split(/\s+/)[0]
    const subject = first
      ? `${first}, your Cashflow OS seat is still open`
      : 'Your Cashflow OS seat is still open'
    const res = await sendEmail({
      to: lead.email,
      from: RECOVERY_FROM,
      // no bcc — marketing nudge, not a finance doc
      subject,
      html: cashflowosRecoveryEmailHtml({ name: lead.name ?? undefined, checkoutUrl: CHECKOUT_URL }),
      idempotencyKey: `cashflowos-recovery-${lead.id}`,
    })

    if (res.ok) {
      // Mark chased FIRST so a mid-loop crash can't re-email on the next run.
      await supabaseAdmin
        .from('cashflowos_leads')
        .update({ recovery_email_sent_at: new Date().toISOString() })
        .eq('id', lead.id)
      // GHL visibility (best-effort): let Kingsley see who's been chased.
      if (lead.ghl_contact_id) {
        try { await addContactTags(lead.ghl_contact_id, ['cashflowos-chased']) } catch { /* best-effort */ }
      }
      sent++
    } else {
      failed++
      console.error('[cashflowos-recovery] send failed', lead.email, res.error)
    }
  }

  if (sent > 0) {
    try {
      await notifyAdmins(
        `📧 ${b('CashflowOS recovery')} — nudged ${b(String(sent))} abandoned checkout${sent === 1 ? '' : 's'} by email` +
        (failed ? ` <i>(${esc(String(failed))} failed)</i>` : ''),
      )
    } catch { /* ping best-effort */ }
  }

  return NextResponse.json({ ok: true, candidates: leads.length, sent, failed }, { headers: NO_STORE })
}
