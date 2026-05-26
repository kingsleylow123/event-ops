import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase.from('weekly_activity').select('*').order('week_start', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { person_name, week_start, active } = body as {
    person_name?: string
    week_start?: string  // YYYY-MM-DD
    active?: boolean
  }
  if (!person_name || !week_start) {
    return NextResponse.json({ error: 'person_name and week_start required' }, { status: 400 })
  }

  if (active === false) {
    // Untick → delete the row rather than store active=false
    const { error } = await supabase
      .from('weekly_activity')
      .delete()
      .match({ person_name, week_start })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, removed: true })
  }

  // Tick → upsert active=true
  const { data, error } = await supabase
    .from('weekly_activity')
    .upsert({ person_name, week_start, active: true }, { onConflict: 'person_name,week_start' })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
