import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { TICKET_PRICES } from '@/lib/supabase'
import type { TicketType } from '@/lib/supabase'
import { rateLimit, clientIp, tooManyResponse, tooLong } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

function isDouble(ticketType: TicketType, paymentAmount: number): boolean {
  const standard = TICKET_PRICES[ticketType] ?? 0
  if (standard <= 0) return false
  // If they paid ~1.8× or more of the standard price, it's a x2 ticket
  return paymentAmount >= standard * 1.8
}

export async function POST(req: NextRequest) {
  // Burst protection. 60/min is far above any real arrival burst (40 pax over
  // ~15 min on the venue's SHARED wifi IP) but stops bot floods cold.
  if (!(await rateLimit(`checkin:${clientIp(req)}`, 60))) return tooManyResponse()

  const body = await req.json()
  // `day` (1|2) is for multi-day events. Missing/invalid → Day 1 (back-compat).
  const { eventId, name, phone, day } = body as { eventId?: string; name?: string; phone?: string; day?: 1 | 2 }
  const checkDay: 1 | 2 = day === 2 ? 2 : 1

  if (!eventId || (!name?.trim() && !phone?.trim())) {
    return NextResponse.json({ success: false, error: 'missing_params' }, { status: 400, headers: NO_STORE_HEADERS })
  }
  if (tooLong({ name: [name, 120], phone: [phone, 40] })) {
    return NextResponse.json({ success: false, error: 'missing_params' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const nameLower = name?.trim().toLowerCase() ?? ''

  // Normalise phone: strip all non-digits, strip leading country code (60) to get local digits
  const rawPhoneDigits = (phone ?? '').replace(/\D/g, '')
  const phoneDigits = rawPhoneDigits.startsWith('60') ? rawPhoneDigits.slice(2) : rawPhoneDigits

  // Phone: at least 8 digits to avoid accidental matches
  const phoneProvided = phoneDigits.length >= 8

  const { data, error } = await supabase
    .from('attendees')
    .select('id, name, phone, ticket_type, payment_amount, attendance_confirmed, day1_attended, day2_attended, notes')
    .eq('event_id', eventId)
    .in('payment_status', ['paid', 'free'])
    .or('notes.is.null,notes.neq.upgrade_payment')

  if (error) {
    console.error('checkin select error:', error)
    return NextResponse.json({ success: false, error: 'db_error', detail: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  }

  const allAttendees = data ?? []

  // Name: fuzzy match (attendee types any variation of their name)
  const nameMatches = nameLower
    ? allAttendees.filter(a => (a.name ?? '').toLowerCase().includes(nameLower))
    : []

  // Phone: EXACT match only — normalise stored phone same way, compare last digits
  const phoneMatches = phoneProvided
    ? allAttendees.filter(a => {
        const stored = (a.phone ?? '').replace(/\D/g, '')
        const storedLocal = stored.startsWith('60') ? stored.slice(2) : stored
        // Must match exactly on the local digits (both ways, in case one is shorter)
        return storedLocal === phoneDigits || stored === rawPhoneDigits ||
          storedLocal.endsWith(phoneDigits) || phoneDigits.endsWith(storedLocal)
      })
    : []

  // Merge & deduplicate
  const seen = new Set<string>()
  let matches = [...nameMatches, ...phoneMatches].filter(a => {
    if (seen.has(a.id)) return false
    seen.add(a.id)
    return true
  })

  // If both provided and multiple matches, intersect (must match both)
  if (nameLower && phoneProvided && matches.length > 1) {
    const both = matches.filter(a =>
      (a.name ?? '').toLowerCase().includes(nameLower) &&
      phoneMatches.some(p => p.id === a.id)
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

  // Per-day fields are kept consistent by a trigger (attendance_confirmed = day1 OR day2).
  // Day 1 / Day 2 are tracked independently — checking in twice for the SAME day is
  // a duplicate; checking in for the OTHER day is allowed.
  const dayField = checkDay === 1 ? 'day1_attended' : 'day2_attended'
  if (attendee[dayField]) {
    return NextResponse.json(
      { success: false, error: 'already_checked_in', name: attendee.name, day: checkDay },
      { headers: NO_STORE_HEADERS }
    )
  }

  const { error: updateError } = await supabase
    .from('attendees')
    .update({ [dayField]: true })
    .eq('id', attendee.id)

  if (updateError) {
    return NextResponse.json({ success: false, error: 'db_error', detail: updateError.message }, { status: 500, headers: NO_STORE_HEADERS })
  }

  const double = isDouble(attendee.ticket_type as TicketType, Number(attendee.payment_amount))

  return NextResponse.json(
    { success: true, attendee: { name: attendee.name, ticket_type: attendee.ticket_type, is_double: double }, day: checkDay },
    { headers: NO_STORE_HEADERS }
  )
}
