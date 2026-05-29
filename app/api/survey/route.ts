import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

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
