import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail, cashflowosRecoveryEmailHtml, cashflowosRecoveryEmail2Html, emailEnabled, SUPPORT_FROM } from '@/lib/email'
import { addContactTags } from '@/lib/ghl'
import { normPhone, normEmail } from '@/lib/format'
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
// Second touch ("doors close soon") this many hours after checkout started.
const EMAIL2_AFTER_HOURS = Number(process.env.CASHFLOWOS_EMAIL2_AFTER_HOURS || 18)
// Safety cap per run (cron is frequent, so this is just a runaway guard).
const MAX_PER_RUN = 100
// The event abandons attach to on the closer pipeline (/pipeline board).
const CASHFLOWOS_EVENT_ID = process.env.CASHFLOWOS_EVENT_ID || '0cef06b6-26b5-42b3-a8d1-f0547e63e5be'

interface Lead {
  id: string
  email: string
  name: string | null
  phone: string | null
  ghl_contact_id: string | null
  deal_lead_id: string | null
}

// ── stop-on-move (Journey rule) ──────────────────────────────────────────────
// The chase is active ONLY while the lead's pipeline card sits in the Abandon
// Cart stage (deal_leads status new/contacted). Moving to Scheduled Call
// (meeting), Purchased (won) or Nurture (lost) — by a closer, the Cal.com sync,
// or the Stripe webhook — stops every further touch. A Cal.com booking creates
// its OWN deal_leads row (no cross-source dedupe), so we also match by email.
async function stoppedLeadIds(leads: Lead[]): Promise<Set<string>> {
  const stopped = new Set<string>()
  if (!leads.length) return stopped
  const ids = leads.map(l => l.deal_lead_id).filter((v): v is string => Boolean(v))
  const emails = [...new Set(leads.map(l => l.email))]

  const statusById = new Map<string, string>()
  if (ids.length) {
    const { data } = await supabaseAdmin.from('deal_leads').select('id, status').in('id', ids)
    for (const r of data ?? []) statusById.set(r.id as string, r.status as string)
  }
  const movedEmails = new Set<string>()
  if (emails.length) {
    const { data } = await supabaseAdmin
      .from('deal_leads').select('client_email, status')
      .in('client_email', emails).in('status', ['meeting', 'won', 'lost'])
    for (const r of data ?? []) {
      const e = normEmail(r.client_email as string)
      if (e) movedEmails.add(e)
    }
  }
  for (const l of leads) {
    const cardStatus = l.deal_lead_id ? statusById.get(l.deal_lead_id) : undefined
    if (cardStatus && cardStatus !== 'new' && cardStatus !== 'contacted') stopped.add(l.id)
    else if (movedEmails.has(normEmail(l.email))) stopped.add(l.id)
  }
  return stopped
}

// Permanently retire a lead from the sequence (stage moved on): stamp both
// touch columns so it never re-enters either pass, and tag GHL so the WhatsApp
// workflow's NOT-cashflowos-stop condition also halts.
async function retireLead(lead: Lead) {
  const now = new Date().toISOString()
  await supabaseAdmin.from('cashflowos_leads')
    .update({ recovery_email_sent_at: now, recovery_email2_sent_at: now })
    .eq('id', lead.id)
    .is('recovery_email_sent_at', null)
  await supabaseAdmin.from('cashflowos_leads')
    .update({ recovery_email2_sent_at: now })
    .eq('id', lead.id)
    .is('recovery_email2_sent_at', null)
  if (lead.ghl_contact_id) {
    try { await addContactTags(lead.ghl_contact_id, ['cashflowos-stop']) } catch { /* best-effort */ }
  }
}

// ── closer pipeline card (deal_leads, /pipeline board) ───────────────────────
// One card per abandoned lead, created alongside the first recovery email so
// closers can chase by WhatsApp/call from the New column. Payment auto-flips it
// to won (Stripe webhook); closers move it manually otherwise.
async function createDealCard(lead: Lead, attendees: { id: string; phone: string | null; email: string | null }[]): Promise<string | null> {
  try {
    const phoneNorm = normPhone(lead.phone ?? '')
    const eNorm = normEmail(lead.email)
    const attendee = attendees.find(a =>
      (phoneNorm && normPhone(a.phone ?? '') === phoneNorm) ||
      (eNorm && normEmail(a.email ?? '') === eNorm),
    )
    const myt = new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' })
    const { data, error } = await supabaseAdmin.from('deal_leads').insert({
      event_id: CASHFLOWOS_EVENT_ID,
      client_name: (lead.name ?? '').trim() || lead.email,
      client_phone: lead.phone ?? '',
      client_phone_norm: phoneNorm,
      client_email: lead.email,
      needs: '🛒 Abandoned CashflowOS checkout (RM2,499) — chase to finish payment',
      rep_name: 'CashflowOS Recovery (auto)',
      status: 'new',
      source: 'abandoned_checkout',
      ghl_contact_id: lead.ghl_contact_id,
      attendee_id: attendee?.id ?? null,
      founder_notes: `Recovery email sent ${myt} (MYT). Checkout: ${CHECKOUT_URL}`,
    }).select('id').single()
    if (error || !data) {
      console.error('[cashflowos-recovery] card insert failed', error?.message)
      return null
    }
    await supabaseAdmin.from('cashflowos_leads')
      .update({ deal_lead_id: data.id as string }).eq('id', lead.id)
    return data.id as string
  } catch (e) {
    console.error('[cashflowos-recovery] card create threw', e)
    return null
  }
}

// CashflowOS abandon-cart recovery (email lives in code we control; WhatsApp
// runs in the GHL workflow gated on the same tags). Two passes per run:
//   1. First touch — leads unpaid + unchased past DELAY_MIN: email #1, tag
//      cashflowos-chased, create the closer pipeline card.
//   2. Second touch — leads unpaid + chased + started > EMAIL2_AFTER_HOURS ago:
//      "doors close soon" email #2, once.
// Both passes honor stop-on-move: a card out of new/contacted retires the lead.
// Idempotent + overlap-safe (DB stamps first + Resend idempotency keys), so the
// 30-min GitHub Actions schedule and the daily Vercel backstop can coexist.
// Guarded by CRON_SECRET.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE })
  }

  if (!emailEnabled()) {
    return NextResponse.json({ ok: false, reason: 'RESEND_API_KEY not set' }, { headers: NO_STORE })
  }

  const LEAD_COLS = 'id, email, name, phone, ghl_contact_id, deal_lead_id'

  // Attendee roster for card auto-linking (one fetch per run, best-effort).
  let attendees: { id: string; phone: string | null; email: string | null }[] = []
  try {
    const { data } = await supabaseAdmin
      .from('attendees').select('id, phone, email').eq('event_id', CASHFLOWOS_EVENT_ID)
    attendees = (data ?? []) as typeof attendees
  } catch { /* linking is optional */ }

  // ── Pass 1: first touch ────────────────────────────────────────────────────
  const cutoff1 = new Date(Date.now() - DELAY_MIN * 60_000).toISOString()
  const { data: d1, error: e1 } = await supabaseAdmin
    .from('cashflowos_leads')
    .select(LEAD_COLS)
    .is('paid_at', null)
    .is('recovery_email_sent_at', null)
    .lt('started_at', cutoff1)
    .order('started_at', { ascending: true })
    .limit(MAX_PER_RUN)
  if (e1) {
    return NextResponse.json({ ok: false, error: e1.message }, { status: 500, headers: NO_STORE })
  }
  const pass1 = (d1 ?? []) as Lead[]
  const stopped1 = await stoppedLeadIds(pass1)

  let sent = 0, failed = 0, retired = 0, cards = 0

  for (const lead of pass1) {
    if (stopped1.has(lead.id)) { await retireLead(lead); retired++; continue }
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
      // Closer pipeline card (best-effort; only once per lead).
      if (!lead.deal_lead_id) {
        const cardId = await createDealCard(lead, attendees)
        if (cardId) cards++
      }
      sent++
    } else {
      failed++
      console.error('[cashflowos-recovery] send failed', lead.email, res.error)
    }
  }

  // ── Pass 2: second touch ("doors close soon") ─────────────────────────────
  const cutoff2 = new Date(Date.now() - EMAIL2_AFTER_HOURS * 3_600_000).toISOString()
  const { data: d2 } = await supabaseAdmin
    .from('cashflowos_leads')
    .select(LEAD_COLS)
    .is('paid_at', null)
    .not('recovery_email_sent_at', 'is', null)
    .is('recovery_email2_sent_at', null)
    .lt('started_at', cutoff2)
    .order('started_at', { ascending: true })
    .limit(MAX_PER_RUN)
  const pass2 = (d2 ?? []) as Lead[]
  const stopped2 = await stoppedLeadIds(pass2)

  let sent2 = 0
  for (const lead of pass2) {
    if (stopped2.has(lead.id)) { await retireLead(lead); retired++; continue }
    const first = (lead.name ?? '').trim().split(/\s+/)[0]
    const res = await sendEmail({
      to: lead.email,
      from: RECOVERY_FROM,
      subject: first ? `${first}, closing your Cashflow OS seat soon` : 'Closing your Cashflow OS seat soon',
      html: cashflowosRecoveryEmail2Html({ name: lead.name ?? undefined, checkoutUrl: CHECKOUT_URL }),
      idempotencyKey: `cashflowos-recovery2-${lead.id}`,
    })
    if (res.ok) {
      await supabaseAdmin
        .from('cashflowos_leads')
        .update({ recovery_email2_sent_at: new Date().toISOString() })
        .eq('id', lead.id)
      sent2++
    } else {
      failed++
      console.error('[cashflowos-recovery] email2 send failed', lead.email, res.error)
    }
  }

  if (sent + sent2 > 0) {
    try {
      await notifyAdmins(
        `📧 ${b('CashflowOS recovery')} — ` +
        [
          sent ? `nudged ${b(String(sent))} (email #1${cards ? ` + ${cards} pipeline card${cards === 1 ? '' : 's'}` : ''})` : '',
          sent2 ? `urgency-nudged ${b(String(sent2))} (email #2)` : '',
          retired ? `${retired} stopped (moved stage)` : '',
          failed ? `<i>${esc(String(failed))} failed</i>` : '',
        ].filter(Boolean).join(' · '),
      )
    } catch { /* ping best-effort */ }
  }

  return NextResponse.json(
    { ok: true, candidates: pass1.length, sent, cards, candidates2: pass2.length, sent2, retired, failed },
    { headers: NO_STORE },
  )
}
