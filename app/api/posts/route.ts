import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireUser } from '@/lib/auth/guard'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const


export const dynamic = 'force-dynamic'

export async function GET() {
  const g = await requireUser('GET /api/posts'); if (g.response) return g.response
  const { data, error } = await supabaseAdmin
    .from('content_posts')
    .select('*')
    .order('post_date', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  return NextResponse.json(data, { headers: NO_STORE_HEADERS })
}

export async function POST(req: NextRequest) {
  const g = await requireUser('POST /api/posts'); if (g.response) return g.response
  const body = await req.json()
  const { person_name, post_date, notes } = body as {
    person_name?: string
    post_date?: string
    notes?: string
  }
  if (!person_name) {
    return NextResponse.json({ error: 'person_name required' }, { status: 400, headers: NO_STORE_HEADERS })
  }
  const { data, error } = await supabaseAdmin
    .from('content_posts')
    .insert({
      person_name,
      post_date: post_date || new Date().toISOString().slice(0, 10),
      notes: notes || null,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  return NextResponse.json(data, { headers: NO_STORE_HEADERS })
}

export async function DELETE(req: NextRequest) {
  const g = await requireUser('DELETE /api/posts'); if (g.response) return g.response
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400, headers: NO_STORE_HEADERS })
  const { error } = await supabaseAdmin.from('content_posts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS })
}
