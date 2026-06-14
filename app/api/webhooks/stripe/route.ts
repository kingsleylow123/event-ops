import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { notifyAdmins, esc, b } from '@/lib/telegram'
import { normPhone, normEmail } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Stripe → EventOps: the moment someone pays, create their attendee record and
// ping the admins with a ready-to-forward WhatsApp welcome (incl. /start link).
// Kills the "Kingsley manually sends the prep link" bottleneck.
//
// Setup (one-time, Stripe dashboard): Developers → Webhooks → Add endpoint
//   https://event-ops-six.vercel.app/api/webhooks/stripe
//   Event: checkout.session.completed
// then paste the signing secret into Vercel env as STRIPE_WEBHOOK_SECRET.
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    // Fail closed but loud: webhook configured in Stripe before the env var
    // landed. 503 makes Stripe retry until the secret is set.
    return NextResponse.json({ error: 'STRIPE_WEBHOOK_SECRET not configured' }, { status: 503 })
  }

  // Signature verification needs the RAW body.
  const payload = await req.text()
  const sig = req.headers.get('stripe-signature') ?? ''
  let event
  try {
    event = await stripe.webhooks.constructEventAsync(payload, sig, secret)
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 })
  }

  if (event.type !== 'checkout.session.completed') {
    return NextResponse.json({ ok: true, ignored: event.type })
  }

  const session = event.data.object
  if (session.payment_status !== 'paid') {
    return NextResponse.json({ ok: true, ignored: 'not paid yet' })
  }

  // Idempotency: Stripe retries webhooks — never double-create.
  const { data: already } = await supabase
    .from('attendees').select('id').eq('stripe_session_id', session.id).maybeSingle()
  if (already) return NextResponse.json({ ok: true, skipped: 'already processed' })

  const name = session.customer_details?.name?.trim() || 'Unknown'
  const email = session.customer_details?.email ?? null
  const phone = session.customer_details?.phone ?? null
  const amountRm = (session.amount_total ?? 0) / 100

  // Assign to the soonest upcoming event (12h grace for day-of purchases).
  // The Telegram ping always names the event, so a wrong guess is caught fast.
  const graceCutoff = new Date(Date.now() - 12 * 3600_000).toISOString()
  const { data: upcoming } = await supabase
    .from('events')
    .select('id, name, date')
    .gte('date', graceCutoff)
    .order('date', { ascending: true })

  const target = upcoming?.[0] ?? null
  if (!target) {
    await notifyAdmins(
      `💳 ${b('Stripe payment received')} — ${esc(name)} · RM ${esc(amountRm.toLocaleString('en-MY'))}\n` +
      `⚠️ No upcoming event to attach it to — create the event, then run Stripe sync.`,
    )
    return NextResponse.json({ ok: true, unassigned: true })
  }

  // Dedupe within the event by phone/email (e.g. manually pre-registered, or
  // paid a second time): update the existing record instead of duplicating.
  const { data: eventAttendees } = await supabase
    .from('attendees').select('id, phone, email').eq('event_id', target.id)
  const pNorm = normPhone(phone)
  const eNorm = normEmail(email)
  const existing = (eventAttendees ?? []).find(a =>
    (pNorm && normPhone(a.phone as string) === pNorm) ||
    (eNorm && normEmail(a.email as string) === eNorm),
  )

  const record = {
    event_id: target.id,
    name,
    email,
    phone,
    ticket_type: 'standard_general' as const,
    payment_method: 'stripe' as const,
    payment_amount: amountRm,
    payment_status: 'paid' as const,
    stripe_session_id: session.id,
    paid_at: new Date((session.created ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
  }

  let dbError: string | null = null
  if (existing) {
    const { error } = await supabase
      .from('attendees')
      .update({ payment_method: record.payment_method, payment_amount: record.payment_amount, payment_status: record.payment_status, stripe_session_id: record.stripe_session_id, paid_at: record.paid_at })
      .eq('id', existing.id)
    dbError = error?.message ?? null
  } else {
    const { error } = await supabase.from('attendees').insert(record)
    dbError = error?.message ?? null
  }

  // Ping admins: the alert + a forwardable welcome with the /start link.
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://event-ops-six.vercel.app'
  const startLink = `${base}/start?event=${target.id}`
  const multiNote = (upcoming?.length ?? 0) > 1
    ? `\n<i>⚠️ ${upcoming!.length} upcoming events — assigned to the soonest. Move in Attendees if wrong.</i>` : ''
  try {
    await notifyAdmins(
      `💳 ${b('New payment')} — ${esc(name)} · ${b('RM ' + amountRm.toLocaleString('en-MY'))}\n` +
      `🎟 ${esc(target.name)}${existing ? ' <i>(updated existing attendee)</i>' : ' <i>(new attendee created)</i>'}\n` +
      `${phone ? `📱 ${esc(phone)}\n` : ''}${email ? `✉️ ${esc(email)}\n` : ''}` +
      (dbError ? `\n🛑 DB error: ${esc(dbError)} — run Stripe sync.` : '') + multiNote,
    )
    // Second message: clean copy-forward for WhatsApp.
    await notifyAdmins(
      `📲 ${b('Forward this to ' + (name === 'Unknown' ? 'them' : esc(name)))}:\n\n` +
      esc(`You're in! 🎉 Welcome to the Claude Malaysia workshop.\n\nBefore the big day, complete your 6 quick prep steps here (15 mins):\n${startLink}\n\nDo it early — it saves the whole class waiting on downloads. See you at 9:30am! ☕`),
    )
  } catch { /* ping failure must not 500 the webhook (Stripe would retry forever) */ }

  return NextResponse.json({ ok: true, attendee: existing ? 'updated' : 'created', event: target.name })
}
