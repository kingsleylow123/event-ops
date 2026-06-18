import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import type { TicketType, Event } from '@/lib/supabase'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

export const dynamic = 'force-dynamic'

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
] as const

// Matches "5th July", "1st June", "12th July", etc. inside Stripe product names.
const ORDINAL_DATE_RE = /(\d{1,2})(?:st|nd|rd|th)\s+(january|february|march|april|may|june|july|august|september|october|november|december)/i

function dateTokenFromName(name: string | null | undefined): string | null {
  if (!name) return null
  const m = name.match(ORDINAL_DATE_RE)
  return m ? `${parseInt(m[1], 10)} ${m[2].toLowerCase()}` : null
}

function dateTokenFromEvent(ev: Event): string | null {
  if (!ev.date) return null
  const d = new Date(ev.date)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

function isVip(productName: string | null): boolean {
  return !!productName && /\bvip\b/i.test(productName)
}

// Tier name is derived from amount because Stripe doesn't carry the
// super/early/standard label. Event routing comes from the product name.
function ticketTypeFor(amountRm: number, vip: boolean): TicketType {
  if (vip) {
    if (amountRm <= 497) return 'super_early_bird_vip'
    if (amountRm <= 597) return 'early_bird_vip'
    return 'standard_vip'
  }
  if (amountRm <= 249) return 'super_early_bird_general'
  if (amountRm <= 297) return 'early_bird_general'
  return 'standard_general'
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { from_timestamp } = body as { from_timestamp?: number }

  try {
    const { data: rawEvents, error: eventsErr } = await supabase
      .from('events')
      .select('*')
    if (eventsErr) {
      return NextResponse.json({ error: eventsErr.message }, { status: 500, headers: NO_STORE_HEADERS })
    }

    const events: Event[] = (rawEvents ?? []) as Event[]
    if (events.length === 0) {
      return NextResponse.json(
        { error: 'No events found.' },
        { status: 400, headers: NO_STORE_HEADERS },
      )
    }

    const earliestEventTs = Math.min(
      ...events.filter(e => e.date).map(e => new Date(e.date as string).getTime()),
    )
    const defaultFrom = Math.floor((earliestEventTs - 60 * 24 * 60 * 60 * 1000) / 1000)
    const FROM_TIMESTAMP = from_timestamp ?? defaultFrom

    let added = 0
    let skipped = 0
    let unmatched = 0
    let cursor: string | undefined
    let pages = 0

    while (true) {
      const sessions = await stripe.checkout.sessions.list({
        limit: 100,
        status: 'complete',
        created: { gte: FROM_TIMESTAMP },
        ...(cursor ? { starting_after: cursor } : {}),
      })

      for (const session of sessions.data) {
        const full = await stripe.checkout.sessions.retrieve(session.id, {
          expand: ['line_items.data.price.product'],
        })
        const li = full.line_items?.data[0]
        const product = li?.price?.product
        const productName =
          product && typeof product === 'object' && !('deleted' in product)
            ? product.name
            : null

        const token = dateTokenFromName(productName) ?? dateTokenFromName(li?.description)
        const resolved = token
          ? events.find(e => dateTokenFromEvent(e) === token) ?? null
          : null

        if (!resolved) {
          unmatched++
          continue
        }

        const amountRm = (session.amount_total ?? 0) / 100
        const ticketType = ticketTypeFor(amountRm, isVip(productName))

        const attendee = {
          event_id: resolved.id,
          name: session.customer_details?.name ?? 'Unknown',
          email: session.customer_details?.email ?? null,
          phone: session.customer_details?.phone ?? null,
          ticket_type: ticketType,
          payment_method: 'stripe' as const,
          payment_amount: amountRm,
          payment_status: 'paid' as const,
          stripe_session_id: session.id,
          paid_at: new Date(session.created * 1000).toISOString(),
        }

        // Preserve manually-edited name/phone when Stripe has nothing better.
        const { data: existing } = await supabase
          .from('attendees')
          .select('phone, name')
          .eq('stripe_session_id', session.id)
          .maybeSingle()

        const finalAttendee = {
          ...attendee,
          phone: attendee.phone ?? existing?.phone ?? null,
          name: (attendee.name && attendee.name.trim())
            ? attendee.name
            : (existing?.name ?? 'Unknown'),
        }

        const { error } = await supabase
          .from('attendees')
          .upsert(finalAttendee, { onConflict: 'stripe_session_id' })

        if (error) {
          skipped++
        } else {
          added++
        }
      }

      pages++
      if (!sessions.has_more || pages >= 20) break
      cursor = sessions.data[sessions.data.length - 1]?.id
      if (!cursor) break
    }

    return NextResponse.json({ added, skipped, unmatched, pages }, { headers: NO_STORE_HEADERS })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Stripe error'
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE_HEADERS })
  }
}
