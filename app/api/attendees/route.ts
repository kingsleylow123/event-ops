import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireUser } from '@/lib/auth/guard'
import { pingCheckin, pingRegistration } from '@/lib/checkin-notify'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const g = await requireUser('GET /api/attendees'); if (g.response) return g.response
  const { searchParams } = new URL(req.url)
  const event_id = searchParams.get('event_id')

  let query = supabaseAdmin.from('attendees').select('*').order('created_at', { ascending: false })
  if (event_id) query = query.eq('event_id', event_id)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  return NextResponse.json(data, { headers: NO_STORE_HEADERS })
}

export async function POST(req: NextRequest) {
  const g = await requireUser('POST /api/attendees'); if (g.response) return g.response
  const body = await req.json()
  const { data, error } = await supabaseAdmin.from('attendees').insert(body).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })

  // Fire-and-forget Telegram ping with the running registration count.
  if (data?.event_id && data?.name) {
    void pingRegistration({
      event_id: data.event_id as string,
      name: data.name as string,
      payment_status: data.payment_status as string | null,
      payment_amount: data.payment_amount as number | string | null,
    })
  }
  return NextResponse.json(data, { headers: NO_STORE_HEADERS })
}

export async function PATCH(req: NextRequest) {
  const g = await requireUser('PATCH /api/attendees'); if (g.response) return g.response
  const body = await req.json()
  const { id, ...updates } = body
  // Detect whether this PATCH is checking someone in for a day (toggling from
  // false → true). If so, we'll ping Jarvis after the update.
  const checkingInDay: 1 | 2 | null =
    updates.day1_attended === true ? 1 : updates.day2_attended === true ? 2 : null

  const { data, error } = await supabaseAdmin.from('attendees').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })

  if (checkingInDay && data?.event_id && data?.name) {
    void pingCheckin({ event_id: data.event_id as string, name: data.name as string, day: checkingInDay })
  }
  return NextResponse.json(data, { headers: NO_STORE_HEADERS })
}

export async function DELETE(req: NextRequest) {
  const g = await requireUser('DELETE /api/attendees'); if (g.response) return g.response
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const { error } = await supabaseAdmin.from('attendees').delete().eq('id', id!)
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS })
}
