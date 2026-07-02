import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { isValidPhone } from '@/lib/validate'
import { findOrCreateContact, addContactTags } from '@/lib/ghl'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://event-ops-six.vercel.app'
const CASHFLOWOS_EVENT_ID = process.env.CASHFLOWOS_EVENT_ID || '0cef06b6-26b5-42b3-a8d1-f0547e63e5be'
const CASHFLOWOS_PRICE_RM = Number(process.env.CASHFLOWOS_PRICE_RM || 2499)

// Step 2 of the CashflowOS 2-step abandon-cart checkout. Step 1 (the /cashflowos
// page) collects name/email/WhatsApp; this route (a) creates + tags the GHL contact
// 'cashflowos-started' so the GHL abandon-cart workflow can begin chasing anyone who
// bails, then (b) opens a fixed-price RM2,499 Stripe Checkout Session and returns its
// URL. Public (middleware allowlist); the price is server-pinned so a caller can
// never choose what they pay.
export async function POST(req: NextRequest) {
  let body: { name?: string; email?: string; phone?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad request' }, { status: 400 }) }

  const name = String(body.name ?? '').trim()
  const email = String(body.email ?? '').trim().toLowerCase()
  const phone = String(body.phone ?? '').trim()
  if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
  if (!isValidPhone(phone)) return NextResponse.json({ error: 'A valid WhatsApp number is required' }, { status: 400 })

  // Capture the lead in GHL FIRST (tag 'cashflowos-started') so an abandon — filled
  // this in but never paid — can be chased by the GHL recovery workflow. Best-effort:
  // a GHL hiccup must never block the customer from paying.
  let ghlContactId: string | null = null
  try {
    ghlContactId = await findOrCreateContact({ name, email, phone, source: 'CashflowOS Checkout' })
    if (ghlContactId) await addContactTags(ghlContactId, ['cashflowos-started'])
  } catch (e) {
    console.error('[cashflowos] GHL start-tag failed', e)
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'myr',
          unit_amount: Math.round(CASHFLOWOS_PRICE_RM * 100),
          product_data: { name: 'Cashflow OS — 2-Day Challenge (28–29 July)' },
        },
      }],
      // Read back by app/api/webhooks/stripe: event_id attaches the attendee to the
      // exact event; product + ghl_contact_id let the webhook tag 'cashflowos-paid'
      // so the GHL recovery workflow stops chasing.
      metadata: {
        event_id: CASHFLOWOS_EVENT_ID,
        product: 'cashflowos-challenge',
        ghl_contact_id: ghlContactId ?? '',
        buyer_email: email,
        buyer_phone: phone,
      },
      phone_number_collection: { enabled: true },
      success_url: `${BASE}/register/success?event=${CASHFLOWOS_EVENT_ID}`,
      cancel_url: `${BASE}/cashflowos?cancelled=1`,
    })

    // Record the started lead so the abandon-cart recovery cron can email anyone
    // who fills this in but never pays. Upsert by email: a re-attempt refreshes
    // the timing + session but never re-arms an already-sent recovery. paid_at is
    // stamped by the Stripe webhook. Best-effort — a DB hiccup must never block
    // the customer from paying, so this runs after the session exists.
    try {
      await supabaseAdmin
        .from('cashflowos_leads')
        .upsert({
          email,
          phone,
          name: name || null,
          ghl_contact_id: ghlContactId,
          stripe_session_id: session.id,
          started_at: new Date().toISOString(),
        }, { onConflict: 'email' })
    } catch (e) {
      console.error('[cashflowos] lead upsert failed', e)
    }

    return NextResponse.json({ url: session.url })
  } catch (e) {
    // Logged server-side only — never leak Stripe account/key details to a caller.
    console.error('[cashflowos] session create failed', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 })
  }
}
