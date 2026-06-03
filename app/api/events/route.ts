import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireUser } from '@/lib/auth/guard'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

export const dynamic = 'force-dynamic'

export async function GET() {
  const g = await requireUser('GET /api/events'); if (g.response) return g.response
  const { data, error } = await supabaseAdmin.from('events').select('*').order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  return NextResponse.json(data, { headers: NO_STORE_HEADERS })
}

export async function POST(req: NextRequest) {
  const g = await requireUser('POST /api/events'); if (g.response) return g.response
  const body = await req.json()
  const { data, error } = await supabaseAdmin.from('events').insert(body).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  return NextResponse.json(data, { headers: NO_STORE_HEADERS })
}

export async function PATCH(req: NextRequest) {
  const g = await requireUser('PATCH /api/events'); if (g.response) return g.response
  const body = await req.json()
  const { id, ...updates } = body

  // If setting as active, deactivate all others first
  if (updates.is_active === true) {
    await supabaseAdmin.from('events').update({ is_active: false }).neq('id', id)
  }

  const { data, error } = await supabaseAdmin.from('events').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  return NextResponse.json(data, { headers: NO_STORE_HEADERS })
}

export async function DELETE(req: NextRequest) {
  const g = await requireUser('DELETE /api/events'); if (g.response) return g.response
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const { error } = await supabaseAdmin.from('events').delete().eq('id', id!)
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS })
}
