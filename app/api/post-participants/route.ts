import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const


export const dynamic = 'force-dynamic'

export async function GET() {
  const { data, error } = await supabase
    .from('post_challenge_participants')
    .select('*')
    .order('created_at')
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  return NextResponse.json(data, { headers: NO_STORE_HEADERS })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { name } = body as { name?: string }
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400, headers: NO_STORE_HEADERS })
  const { data, error } = await supabase
    .from('post_challenge_participants')
    .upsert({ name }, { onConflict: 'name' })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  return NextResponse.json(data, { headers: NO_STORE_HEADERS })
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const name = searchParams.get('name')
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400, headers: NO_STORE_HEADERS })
  const { error } = await supabase.from('post_challenge_participants').delete().eq('name', name)
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS })
}
