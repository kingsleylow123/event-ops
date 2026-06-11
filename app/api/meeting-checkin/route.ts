import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import type { MeetingAttendee } from '@/lib/supabase'
import { rateLimit, clientIp, tooManyResponse } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

// Public: fetch a meeting's title for the check-in kiosk header (no PII).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400, headers: NO_STORE_HEADERS })
  const { data } = await supabase.from('meetings').select('title').eq('id', id).single()
  return NextResponse.json({ title: data?.title ?? null }, { headers: NO_STORE_HEADERS })
}

export async function POST(req: NextRequest) {
  // Burst protection — this endpoint AUTO-CREATES attendance entries on
  // unknown names, so unthrottled bots could flood the roster.
  if (!rateLimit(`mcheckin:${clientIp(req)}`, 30)) return tooManyResponse()

  const body = await req.json()
  const { meetingId, name } = body as { meetingId?: string; name?: string }

  if (!meetingId || !name?.trim() || name.length > 120) {
    return NextResponse.json({ success: false, error: 'missing_params' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const nameLower = name.trim().toLowerCase()

  const { data: meeting, error: fetchError } = await supabase
    .from('meetings')
    .select('id, title, attendance')
    .eq('id', meetingId)
    .single()

  if (fetchError || !meeting) {
    return NextResponse.json({ success: false, error: 'not_found' }, { status: 404, headers: NO_STORE_HEADERS })
  }

  const attendance: MeetingAttendee[] = meeting.attendance ?? []

  const matches = attendance.filter(a => a.name.toLowerCase().includes(nameLower))

  if (matches.length > 1) {
    return NextResponse.json(
      { success: false, error: 'multiple', names: matches.map(a => a.name) },
      { headers: NO_STORE_HEADERS }
    )
  }

  let finalName: string
  let updatedAttendance: MeetingAttendee[]

  if (matches.length === 0) {
    // Name not found — AUTO-CREATE a new attendance entry
    const newEntry: MeetingAttendee = { name: name.trim(), attended: true, notes: null }
    updatedAttendance = [...attendance, newEntry]
    finalName = name.trim()
  } else {
    const matched = matches[0]
    if (matched.attended) {
      return NextResponse.json(
        { success: false, error: 'already_checked_in', name: matched.name },
        { headers: NO_STORE_HEADERS }
      )
    }
    updatedAttendance = attendance.map(a =>
      a.name.toLowerCase() === matched.name.toLowerCase()
        ? { ...a, attended: true }
        : a
    )
    finalName = matched.name
  }

  const { error: updateError } = await supabase
    .from('meetings')
    .update({ attendance: updatedAttendance })
    .eq('id', meetingId)

  if (updateError) {
    return NextResponse.json({ success: false, error: 'db_error', detail: updateError.message }, { status: 500, headers: NO_STORE_HEADERS })
  }

  return NextResponse.json({ success: true, name: finalName }, { headers: NO_STORE_HEADERS })
}
