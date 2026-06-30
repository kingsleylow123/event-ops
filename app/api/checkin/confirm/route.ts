import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { pingCheckin } from '@/lib/checkin-notify'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

export async function POST(req: NextRequest) {
  const body = await req.json()
  // `day` is optional: 1 or 2 for multi-day events. Omitted / invalid → Day 1
  // (back-compat with the existing single-day check-in flow).
  const { attendeeId, day } = body as { attendeeId: string; day?: 1 | 2 }
  const checkDay: 1 | 2 = day === 2 ? 2 : 1

  if (!attendeeId) {
    return NextResponse.json({ success: false, error: 'missing_params' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const { data: attendee, error: fetchError } = await supabase
    .from('attendees')
    .select('id, name, phone, event_id, ticket_type, payment_amount, payment_status, attendance_confirmed, day1_attended, day2_attended, is_facilitator')
    .eq('id', attendeeId)
    .single()

  if (fetchError || !attendee) {
    return NextResponse.json({ success: false, error: 'not_found' }, { status: 404, headers: NO_STORE_HEADERS })
  }

  // Already-checked-in is per-day, so checking in for Day 2 doesn't trip
  // because Day 1 was already done.
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
    .eq('id', attendeeId)

  if (updateError) {
    return NextResponse.json({ success: false, error: 'db_error' }, { status: 500, headers: NO_STORE_HEADERS })
  }

  // "+1 guest" detection: 2+ attendee records in this event share the same
  // name OR phone (e.g. couple registered as 'Sarah' + 'Sarah +1'). Replaces
  // the old payment-amount heuristic that triggered on custom-priced events.
  const { data: siblings } = await supabase
    .from('attendees').select('name, phone')
    .eq('event_id', attendee.event_id as string)
    .in('payment_status', ['paid', 'free'])
  const phoneDigits = (s: string | null | undefined) => {
    const d = (s ?? '').replace(/\D/g, '')
    return d.startsWith('60') ? d.slice(2) : d
  }
  const nameKey = (attendee.name as string ?? '').trim().toLowerCase()
  const matchedPhone = phoneDigits(attendee.phone as string | null)
  let matchCount = 0
  for (const a of siblings ?? []) {
    const sameName = nameKey && (a.name as string ?? '').trim().toLowerCase() === nameKey
    const samePhone = matchedPhone && phoneDigits(a.phone as string | null).length >= 8 && phoneDigits(a.phone as string | null) === matchedPhone
    if (sameName || samePhone) matchCount++
  }
  const isFacilitator = attendee.is_facilitator === true
  const is_double = isFacilitator ? false : matchCount >= 2

  // Fire-and-forget Telegram ping with the running per-day count.
  void pingCheckin({ event_id: attendee.event_id as string, name: attendee.name as string, day: checkDay })

  return NextResponse.json(
    { success: true, attendee: { name: attendee.name, ticket_type: attendee.ticket_type, is_double, is_facilitator: isFacilitator }, day: checkDay },
    { headers: NO_STORE_HEADERS }
  )
}
