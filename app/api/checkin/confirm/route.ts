import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { TICKET_PRICES } from '@/lib/supabase'
import type { TicketType } from '@/lib/supabase'

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
    .select('id, name, ticket_type, payment_amount, payment_status, attendance_confirmed, day1_attended, day2_attended')
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

  const standard = TICKET_PRICES[attendee.ticket_type as TicketType] ?? 0
  const is_double = standard > 0 && Number(attendee.payment_amount) >= standard * 1.8

  return NextResponse.json(
    { success: true, attendee: { name: attendee.name, ticket_type: attendee.ticket_type, is_double }, day: checkDay },
    { headers: NO_STORE_HEADERS }
  )
}
