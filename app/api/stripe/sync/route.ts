import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { supabase } from '@/lib/supabase'
import type { TicketType } from '@/lib/supabase'

function guessTicketType(amountRm: number): TicketType {
  // May 16 event prices
  if (amountRm === 97) return 'early_bird_general'
  if (amountRm === 159) return 'standard_general'
  if (amountRm === 297) return 'early_bird_vip'
  if (amountRm === 397) return 'standard_vip'
  // June 1 event prices
  if (amountRm === 249) return 'early_bird_general'
  if (amountRm === 497) return 'standard_general'
  if (amountRm === 597) return 'standard_vip'
  if (amountRm === 0) return 'free_general'
  return 'standard_general'
}

export async function POST(req: NextRequest) {
  const { event_id, from_timestamp } = await req.json()
  if (!event_id) return NextResponse.json({ error: 'event_id required' }, { status: 400 })

  try {
    // Default: May 20, 2026 00:00 MYT = May 19 16:00 UTC
    const FROM_TIMESTAMP = from_timestamp ?? 1779206400

    const sessions = await stripe.checkout.sessions.list({
      limit: 100,
      status: 'complete',
      created: { gte: FROM_TIMESTAMP },
    })

    let added = 0
    let skipped = 0

    for (const session of sessions.data) {
      const amountRm = (session.amount_total ?? 0) / 100
      const ticketType = guessTicketType(amountRm)

      const attendee = {
        event_id,
        name: session.customer_details?.name ?? 'Unknown',
        email: session.customer_details?.email ?? null,
        phone: session.customer_details?.phone ?? null,
        ticket_type: ticketType,
        payment_method: 'stripe' as const,
        payment_amount: amountRm,
        payment_status: 'paid' as const,
        stripe_session_id: session.id,
      }

      const { error } = await supabase.from('attendees').upsert(attendee, {
        onConflict: 'stripe_session_id',
        ignoreDuplicates: true,
      })

      if (error) {
        skipped++
      } else {
        added++
      }
    }

    return NextResponse.json({ added, skipped, total: sessions.data.length })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Stripe error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
