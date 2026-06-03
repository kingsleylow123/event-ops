import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireUser } from '@/lib/auth/guard'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const g = await requireUser('GET /api/checklist'); if (g.response) return g.response
  const { searchParams } = new URL(req.url)
  const event_id = searchParams.get('event_id')

  let query = supabaseAdmin.from('checklist_items').select('*').order('category').order('created_at')
  if (event_id) query = query.eq('event_id', event_id)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  return NextResponse.json(data, { headers: NO_STORE_HEADERS })
}

export async function POST(req: NextRequest) {
  const g = await requireUser('POST /api/checklist'); if (g.response) return g.response
  const body = await req.json()
  const { data, error } = await supabaseAdmin.from('checklist_items').insert(body).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  return NextResponse.json(data, { headers: NO_STORE_HEADERS })
}

export async function PATCH(req: NextRequest) {
  const g = await requireUser('PATCH /api/checklist'); if (g.response) return g.response
  const body = await req.json()
  const { id, ...updates } = body
  const { data, error } = await supabaseAdmin.from('checklist_items').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  return NextResponse.json(data, { headers: NO_STORE_HEADERS })
}

export async function DELETE(req: NextRequest) {
  const g = await requireUser('DELETE /api/checklist'); if (g.response) return g.response
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const { error } = await supabaseAdmin.from('checklist_items').delete().eq('id', id!)
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS })
}
