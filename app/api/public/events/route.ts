import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Public, unauthenticated read for the /events calendar. Returns ONLY published
// events and ONLY the curated public columns — never attendees, config, or team.
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('events')
    .select('id,name,date,venue,capacity,format,current_phase,public_listing')
    .eq('is_published', true)
    .order('date', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })
  }
  return NextResponse.json(data ?? [], { headers: NO_STORE })
}
