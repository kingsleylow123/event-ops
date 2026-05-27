import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'


export const dynamic = 'force-dynamic'

export async function GET() {
  const { data, error } = await supabase.from('events').select('*').order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { data, error } = await supabase.from('events').insert(body).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, ...updates } = body

  // If setting as active, deactivate all others first
  if (updates.is_active === true) {
    await supabase.from('events').update({ is_active: false }).neq('id', id)
  }

  const { data, error } = await supabase.from('events').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const { error } = await supabase.from('events').delete().eq('id', id!)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
