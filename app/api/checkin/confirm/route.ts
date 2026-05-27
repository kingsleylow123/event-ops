import { NextRequest, NextResponse } from 'next/server'
import { supabase, TICKET_PRICES } from '@/lib/supabase'
import type { TicketType } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { attendeeId } = body as { attendeeId: string }

  if (!attendeeId) {
    return NextResponse.json({ success: false, error: 'missing_params' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const { data: attendee, error: fetchError } = await supabase
    .from('attendees')
    .select('id, name, ticket_type, payment_amount, attendance_confirmed')
    .eq('id', attendeeId)
    .single()

  if (fetchError || !attendee) {
    return NextResponse.json({ success: false, error: 'not_found' }, { status: 404, headers: NO_STORE_HEADERS })
  }

  if (attendee.attendance_confirmed) {
    return NextResponse.json(
      { success: false, error: 'already_checked_in', name: attendee.name },
      { headers: NO_STORE_HEADERS }
    )
  }

  const { error: updateError } = await supabase
    .from('attendees')
    .update({ attendance_confirmed: true })
    .eq('id', attendeeId)

  if (updateError) {
    return NextResponse.json({ success: false, error: 'db_error' }, { status: 500, headers: NO_STORE_HEADERS })
  }

  const standard = TICKET_PRICES[attendee.ticket_type as TicketType] ?? 0
  const is_double = standard > 0 && Number(attendee.payment_amount) >= standard * 1.8

  return NextResponse.json(
    { success: true, attendee: { name: attendee.name, ticket_type: attendee.ticket_type, is_double } },
    { headers: NO_STORE_HEADERS }
  )
}
