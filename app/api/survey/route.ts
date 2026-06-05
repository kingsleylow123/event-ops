import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { requireUser } from '@/lib/auth/guard'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { event_id, attendee_id, name, phone, industry, company_size, biggest_challenge, workshop_goal } = body

  if (!event_id || !name) {
    return NextResponse.json({ error: 'event_id and name required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('pre_event_survey_responses')
    .insert([{
      event_id,
      attendee_id: attendee_id || null,
      name,
      phone: phone || null,
      industry: industry || null,
      company_size: company_size || null,
      biggest_challenge: biggest_challenge || null,
      workshop_goal: workshop_goal || null,
    }])
    .select('id')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, id: data.id })
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const event_id = searchParams.get('event_id')

  if (!event_id) {
    return NextResponse.json({ error: 'event_id required' }, { status: 400 })
  }

  // Public mode (?name=1): return ONLY the event name for the survey form header.
  // No PII — safe for the unauthenticated public survey page.
  if (searchParams.get('name') === '1') {
    const { data } = await supabase.from('events').select('name').eq('id', event_id).single()
    return NextResponse.json({ name: data?.name ?? null })
  }

  // Public facts (?facts=1): event name/date/venue/capacity + live fill counts.
  // No PII — for the pre-event landing page hero. Safe for unauthenticated use.
  if (searchParams.get('facts') === '1') {
    const { data: ev } = await supabase
      .from('events').select('name, date, venue, capacity').eq('id', event_id).single()
    const { count: registered } = await supabase
      .from('attendees').select('id', { count: 'exact', head: true }).eq('event_id', event_id)
    const { count: paid } = await supabase
      .from('attendees').select('id', { count: 'exact', head: true })
      .eq('event_id', event_id).eq('payment_status', 'paid')
    return NextResponse.json({
      name: ev?.name ?? null,
      date: ev?.date ?? null,
      venue: ev?.venue ?? null,
      capacity: ev?.capacity ?? null,
      registered: registered ?? 0,
      paid: paid ?? 0,
    })
  }

  // Full responses list = admin/staff only (contains PII).
  const g = await requireUser('GET /api/survey'); if (g.response) return g.response

  const { data, error } = await supabase
    .from('pre_event_survey_responses')
    .select('*')
    .eq('event_id', event_id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const g = await requireUser('PATCH /api/survey'); if (g.response) return g.response
  const { id, ...updates } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('pre_event_survey_responses')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
