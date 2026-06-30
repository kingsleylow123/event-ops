import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { rateLimit, clientIp, tooManyResponse, tooLong } from '@/lib/rate-limit'
import { pingCheckin } from '@/lib/checkin-notify'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

// Facilitator-only check-in. Unlike /api/checkin (which matches paid/free
// participants), this endpoint restricts the lookup to attendee rows with
// is_facilitator = true. A paid participant typing their own name here will
// get 'not_found' — by design, so the Facilitators QR can only be used by
// the named staff on that event.
export async function POST(req: NextRequest) {
  if (!(await rateLimit(`checkin-faci:${clientIp(req)}`, 60))) return tooManyResponse()

  const body = await req.json()
  const { eventId, name, phone, day } = body as { eventId?: string; name?: string; phone?: string; day?: 1 | 2 }
  const checkDay: 1 | 2 = day === 2 ? 2 : 1

  if (!eventId || (!name?.trim() && !phone?.trim())) {
    return NextResponse.json({ success: false, error: 'missing_params' }, { status: 400, headers: NO_STORE_HEADERS })
  }
  if (tooLong({ name: [name, 120], phone: [phone, 40] })) {
    return NextResponse.json({ success: false, error: 'missing_params' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const nameLower = name?.trim().toLowerCase() ?? ''
  const rawPhoneDigits = (phone ?? '').replace(/\D/g, '')
  const phoneDigits = rawPhoneDigits.startsWith('60') ? rawPhoneDigits.slice(2) : rawPhoneDigits
  const phoneProvided = phoneDigits.length >= 8

  const { data, error } = await supabase
    .from('attendees')
    .select('id, name, phone, day1_attended, day2_attended')
    .eq('event_id', eventId)
    .eq('is_facilitator', true)

  if (error) {
    console.error('checkin-facilitator select error:', error)
    return NextResponse.json({ success: false, error: 'db_error', detail: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  }

  const allFacis = data ?? []

  const nameMatches = nameLower
    ? allFacis.filter(a => (a.name ?? '').toLowerCase().includes(nameLower))
    : []

  const phoneMatches = phoneProvided
    ? allFacis.filter(a => {
        const stored = (a.phone ?? '').replace(/\D/g, '')
        // A blank/too-short stored phone must never match — otherwise endsWith('')
        // is always true and a no-phone facilitator (e.g. Huda) matches everyone.
        if (stored.length < 8) return false
        const storedLocal = stored.startsWith('60') ? stored.slice(2) : stored
        return storedLocal === phoneDigits || stored === rawPhoneDigits ||
          storedLocal.endsWith(phoneDigits) || phoneDigits.endsWith(storedLocal)
      })
    : []

  const seen = new Set<string>()
  let matches = [...nameMatches, ...phoneMatches].filter(a => {
    if (seen.has(a.id)) return false
    seen.add(a.id)
    return true
  })

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
      { success: false, error: 'multiple', attendees: matches.map(a => ({ id: a.id, name: a.name })) },
      { headers: NO_STORE_HEADERS }
    )
  }

  const attendee = matches[0]
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

  void pingCheckin({ event_id: eventId, name: attendee.name as string, day: checkDay })

  return NextResponse.json(
    { success: true, attendee: { name: attendee.name }, day: checkDay },
    { headers: NO_STORE_HEADERS }
  )
}
