import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { supabase } from '@/lib/supabase'
import type { TicketType, Event } from '@/lib/supabase'

type PriceConfig = {
  amounts: number[]
  ticketTypeByAmount: Record<number, TicketType>
}

const EVENT_PRICE_MAP: Record<string, PriceConfig> = {
  'may-16': {
    amounts: [97, 159, 297, 397],
    ticketTypeByAmount: {
      97: 'early_bird_general',
      159: 'standard_general',
      297: 'early_bird_vip',
      397: 'standard_vip',
    },
  },
  'june-1': {
    amounts: [249, 297, 347, 497, 597, 697],
    ticketTypeByAmount: {
      249: 'super_early_bird_general',
      297: 'early_bird_general',
      347: 'standard_general',
      497: 'super_early_bird_vip',
      597: 'early_bird_vip',
      697: 'standard_vip',
    },
  },
}

function slugForEvent(event: Event): string | null {
  if (!event.date) return null
  const d = new Date(event.date)
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth()
  if (year === 2026 && month === 4) return 'may-16'
  if (year === 2026 && month === 5) return 'june-1'
  return null
}

type EventWithSlug = Event & { slug: string; priceConfig: PriceConfig }

function resolveEvent(
  amountRm: number,
  sessionCreatedSec: number,
  events: EventWithSlug[],
): EventWithSlug | null {
  const sessionDate = new Date(sessionCreatedSec * 1000)

  const matchesByPrice = events.filter(e => e.priceConfig.amounts.includes(amountRm))

  if (matchesByPrice.length === 1) return matchesByPrice[0]

  const candidates = matchesByPrice.length > 1 ? matchesByPrice : events

  let best: EventWithSlug | null = null
  let bestDelta = Infinity
  for (const ev of candidates) {
    if (!ev.date) continue
    const evDate = new Date(ev.date)
    const delta = evDate.getTime() - sessionDate.getTime()
    if (delta < 0) continue
    if (delta < bestDelta) {
      bestDelta = delta
      best = ev
    }
  }

  if (best) return best

  let fallback: EventWithSlug | null = null
  let fallbackDelta = Infinity
  for (const ev of candidates) {
    if (!ev.date) continue
    const delta = Math.abs(new Date(ev.date).getTime() - sessionDate.getTime())
    if (delta < fallbackDelta) {
      fallbackDelta = delta
      fallback = ev
    }
  }
  return fallback
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { from_timestamp } = body as { from_timestamp?: number }

  try {
    const { data: rawEvents, error: eventsErr } = await supabase
      .from('events')
      .select('*')
    if (eventsErr) {
      return NextResponse.json({ error: eventsErr.message }, { status: 500 })
    }

    const events: EventWithSlug[] = (rawEvents ?? [])
      .map((ev: Event) => {
        const slug = slugForEvent(ev)
        if (!slug) return null
        const priceConfig = EVENT_PRICE_MAP[slug]
        if (!priceConfig) return null
        return { ...ev, slug, priceConfig }
      })
      .filter((e): e is EventWithSlug => e !== null)

    if (events.length === 0) {
      return NextResponse.json(
        { error: 'No events found that match a known price config (may-16 or june-1).' },
        { status: 400 },
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
        const amountRm = (session.amount_total ?? 0) / 100
        const resolved = resolveEvent(amountRm, session.created, events)

        if (!resolved) {
          unmatched++
          continue
        }

        const ticketType =
          resolved.priceConfig.ticketTypeByAmount[amountRm] ?? 'standard_general'

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

        const { error } = await supabase
          .from('attendees')
          .upsert(attendee, { onConflict: 'stripe_session_id' })

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

    return NextResponse.json({ added, skipped, unmatched, pages })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Stripe error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
