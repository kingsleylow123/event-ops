import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { eventId, query } = body as { eventId: string; query: string }

  if (!eventId || !query) {
    return NextResponse.json({ success: false, error: 'missing_params' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const q = query.trim().toLowerCase()

  const { data, error } = await supabase
    .from('attendees')
    .select('id, name, email, ticket_type, attendance_confirmed')
    .eq('event_id', eventId)
    .eq('payment_status', 'paid')

  if (error) {
    return NextResponse.json({ success: false, error: 'db_error' }, { status: 500, headers: NO_STORE_HEADERS })
  }

  const matches = (data ?? []).filter(
    a =>
      (a.name ?? '').toLowerCase().includes(q) ||
      (a.email ?? '').toLowerCase().includes(q)
  )

  if (matches.length === 0) {
    return NextResponse.json({ success: false, error: 'not_found' }, { headers: NO_STORE_HEADERS })
  }

  if (matches.length > 1) {
    return NextResponse.json(
      {
        success: false,
        error: 'multiple',
        attendees: matches.map(a => ({ id: a.id, name: a.name })),
      },
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
    return NextResponse.json({ success: false, error: 'db_error' }, { status: 500, headers: NO_STORE_HEADERS })
  }

  return NextResponse.json(
    {
      success: true,
      attendee: { name: attendee.name, ticket_type: attendee.ticket_type },
    },
    { headers: NO_STORE_HEADERS }
  )
}
