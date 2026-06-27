import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { TICKET_LABELS } from '@/lib/supabase'
import { normalizeTier, validatePurchase } from '@/lib/registration'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://event-ops-six.vercel.app'

// EventOps-generated Stripe Checkout. The session stamps event_id + ticket_type
// into metadata so the webhook attaches the payment to the EXACT event — the cure
// for the "soonest upcoming" guess that mis-routes when two dates sell at once.
// Public (in middleware PUBLIC_PATHS); price is server-pinned, so an anonymous
// caller can never choose what they pay.
export async function POST(req: NextRequest) {
  let body: { event_id?: string; ticket_type?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad request' }, { status: 400 }) }

  const eventId = String(body.event_id ?? '')
  if (!eventId) return NextResponse.json({ error: 'event_id required' }, { status: 400 })

  const { data: ev, error } = await supabase
    .from('events').select('id, name, date, pricing_tier').eq('id', eventId).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!ev) return NextResponse.json({ error: 'event not found' }, { status: 404 })

  // Closed once the event day has passed (12h grace for day-of sales).
  if (ev.date && new Date(ev.date as string).getTime() < Date.now() - 12 * 3600_000) {
    return NextResponse.json({ error: 'registration closed' }, { status: 409 })
  }

  // Server-authoritative: only a variant of the event's LIVE tier, priced from our
  // own table — never the amount the client sent.
  const tier = normalizeTier(ev.pricing_tier)
  const purchase = validatePurchase(body.ticket_type, tier)
  if (!purchase) return NextResponse.json({ error: 'invalid ticket for this event' }, { status: 400 })

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'myr',
          unit_amount: Math.round(purchase.price * 100),
          product_data: { name: `${ev.name} — ${TICKET_LABELS[purchase.ticket_type]}` },
        },
      }],
      // Read back by app/api/webhooks/stripe → deterministic event + tier. Kept
      // on the SESSION only (the webhook reads session.metadata), so the API key
      // needs just "Checkout Sessions: write", not PaymentIntents.
      metadata: { event_id: ev.id as string, ticket_type: purchase.ticket_type },
      // Name comes with the billing address; phone + email collected too — the
      // webhook reads all three from customer_details.
      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      success_url: `${BASE}/register/success?event=${ev.id}`,
      cancel_url: `${BASE}/register/cancel?event=${ev.id}`,
    })
    return NextResponse.json({ url: session.url })
  } catch (e) {
    // Logged server-side only — never leak Stripe account/key details to a public caller.
    console.error('[stripe-checkout] session create failed', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'could not start checkout' }, { status: 502 })
  }
}
