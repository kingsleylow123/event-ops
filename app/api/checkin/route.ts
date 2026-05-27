import { NextRequest, NextResponse } from 'next/server'
import { supabase, TICKET_PRICES } from '@/lib/supabase'
import type { TicketType } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

function isDouble(ticketType: TicketType, paymentAmount: number): boolean {
  const standard = TICKET_PRICES[ticketType] ?? 0
  if (standard <= 0) return false
  // If they paid ~1.8× or more of the standard price, it's a x2 ticket
  return paymentAmount >= standard * 1.8
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { eventId, name, phone } = body as { eventId?: string; name?: string; phone?: string }

  if (!eventId || (!name?.trim() && !phone?.trim())) {
    return NextResponse.json({ success: false, error: 'missing_params' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const nameLower = name?.trim().toLowerCase() ?? ''
  const phoneDigits = (phone ?? '').replace(/\D/g, '').slice(-8) // last 8 digits for fuzzy match

  const { data, error } = await supabase
    .from('attendees')
    .select('id, name, phone, ticket_type, payment_amount, attendance_confirmed')
    .eq('event_id', eventId)
    .in('payment_status', ['paid', 'free'])

  if (error) {
    console.error('checkin select error:', error)
    return NextResponse.json({ success: false, error: 'db_error', detail: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  }

  const allAttendees = data ?? []

  // Match by name OR phone — whichever is provided
  const nameMatches = nameLower
    ? allAttendees.filter(a => (a.name ?? '').toLowerCase().includes(nameLower))
    : []
  const phoneMatches = phoneDigits.length >= 6
    ? allAttendees.filter(a => (a.phone ?? '').replace(/\D/g, '').includes(phoneDigits))
    : []

  // Merge & deduplicate
  const seen = new Set<string>()
  let matches = [...nameMatches, ...phoneMatches].filter(a => {
    if (seen.has(a.id)) return false
    seen.add(a.id)
    return true
  })

  // If both provided and multiple matches, intersect (must match both)
  if (nameLower && phoneDigits.length >= 6 && matches.length > 1) {
    const both = matches.filter(a =>
      (a.name ?? '').toLowerCase().includes(nameLower) &&
      (a.phone ?? '').replace(/\D/g, '').includes(phoneDigits)
    )
    if (both.length > 0) matches = both
  }

  if (matches.length === 0) {
    return NextResponse.json({ success: false, error: 'not_found' }, { headers: NO_STORE_HEADERS })
  }

  if (matches.length > 1) {
    return NextResponse.json(
      { success: false, error: 'multiple', attendees: matches.map(a => ({ id: a.id, name: a.name, ticket_type: a.ticket_type })) },
      { headers: NO_STORE_HEADERS }
    )
  }

  const attendee = matches[0]

  if (attendee.attendance_confirmed) {
    return NextResponse.json(
      { success: false, error: 'already_checked_in', name: attendee.name },
      { headers: NO_STORE_HEADERS }
    )
  }

  const { error: updateError } = await supabase
    .from('attendees')
    .update({ attendance_confirmed: true })
    .eq('id', attendee.id)

  if (updateError) {
    return NextResponse.json({ success: false, error: 'db_error', detail: updateError.message }, { status: 500, headers: NO_STORE_HEADERS })
  }

  const double = isDouble(attendee.ticket_type as TicketType, Number(attendee.payment_amount))

  return NextResponse.json(
    { success: true, attendee: { name: attendee.name, ticket_type: attendee.ticket_type, is_double: double } },
    { headers: NO_STORE_HEADERS }
  )
}
