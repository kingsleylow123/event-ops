import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { pingCheckin } from '@/lib/checkin-notify'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

// Facilitator-only confirm step (multi-match path). Refuses anything that
// isn't a facilitator row tied to the eventId the caller is on — prevents
// reusing a known attendeeId from event A to flip attendance on event B.
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { attendeeId, eventId, day } = body as { attendeeId: string; eventId?: string; day?: 1 | 2 }
  const checkDay: 1 | 2 = day === 2 ? 2 : 1

  if (!attendeeId || !eventId) {
    return NextResponse.json({ success: false, error: 'missing_params' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const { data: attendee, error: fetchError } = await supabase
    .from('attendees')
    .select('id, name, event_id, is_facilitator, day1_attended, day2_attended')
    .eq('id', attendeeId)
    .single()

  if (fetchError || !attendee || attendee.is_facilitator !== true || attendee.event_id !== eventId) {
    return NextResponse.json({ success: false, error: 'not_found' }, { status: 404, headers: NO_STORE_HEADERS })
  }

  const dayField = checkDay === 1 ? 'day1_attended' : 'day2_attended'
  if (attendee[dayField]) {
    return NextResponse.json(
      { success: false, error: 'already_checked_in', name: attendee.name, day: checkDay },
      { headers: NO_STORE_HEADERS }
    )
  }

  const { error: updateError } = await supabase
    .from('attendees')
    // Mirror the dashboard invariant (attendance_confirmed = day1 || day2) so the
    // single-day "Attended" column reflects QR check-ins, not just dashboard toggles.
    .update({ [dayField]: true, attendance_confirmed: true })
    .eq('id', attendeeId)

  if (updateError) {
    return NextResponse.json({ success: false, error: 'db_error' }, { status: 500, headers: NO_STORE_HEADERS })
  }

  void pingCheckin({ event_id: attendee.event_id as string, name: attendee.name as string, day: checkDay })

  return NextResponse.json(
    { success: true, attendee: { name: attendee.name }, day: checkDay },
    { headers: NO_STORE_HEADERS }
  )
}
