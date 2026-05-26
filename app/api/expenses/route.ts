import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const event_id = searchParams.get('event_id')

  let query = supabase.from('expenses').select('*').order('created_at', { ascending: false })
  if (event_id) query = query.eq('event_id', event_id)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { event_id, description, amount, category, notes } = body as {
    event_id?: string
    description?: string
    amount?: number | string
    category?: string
    notes?: string
  }
  if (!event_id || !description || amount == null) {
    return NextResponse.json({ error: 'event_id, description and amount required' }, { status: 400 })
  }
  const amountNum = typeof amount === 'string' ? Number(amount) : amount
  if (!Number.isFinite(amountNum) || amountNum < 0) {
    return NextResponse.json({ error: 'amount must be a non-negative number' }, { status: 400 })
  }
  const { data, error } = await supabase
    .from('expenses')
    .insert({ event_id, description, amount: amountNum, category: category || 'Other', notes: notes || null })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, ...updates } = body as { id?: string; description?: string; amount?: number; category?: string; notes?: string | null }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { data, error } = await supabase
    .from('expenses')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabase.from('expenses').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
