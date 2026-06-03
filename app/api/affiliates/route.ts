import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { buildReport, autoMatch } from '@/lib/affiliates'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

export const dynamic = 'force-dynamic'

// GET ?event_id=  → full payout report
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const event_id = searchParams.get('event_id')
  if (!event_id) return NextResponse.json({ error: 'event_id required' }, { status: 400, headers: NO_STORE_HEADERS })
  try {
    const report = await buildReport(event_id)
    return NextResponse.json(report, { headers: NO_STORE_HEADERS })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500, headers: NO_STORE_HEADERS })
  }
}

// POST ?action=import { event_id }  → run auto-match
// POST { event_id, attendee_id, affiliate_id }  → manual assign
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')
  const body = await req.json().catch(() => ({}))

  if (action === 'import') {
    const { event_id } = body as { event_id?: string }
    if (!event_id) return NextResponse.json({ error: 'event_id required' }, { status: 400, headers: NO_STORE_HEADERS })
    try {
      const matched = await autoMatch(event_id)
      return NextResponse.json({ matched }, { headers: NO_STORE_HEADERS })
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500, headers: NO_STORE_HEADERS })
    }
  }

  const { event_id, attendee_id, affiliate_id } = body as {
    event_id?: string; attendee_id?: string; affiliate_id?: string | null
  }
  if (!event_id || !attendee_id) {
    return NextResponse.json({ error: 'event_id and attendee_id required' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  // affiliate_id null/empty → clear the attribution (set to "none")
  if (!affiliate_id) {
    const { error } = await supabase
      .from('affiliate_attributions')
      .delete()
      .eq('event_id', event_id)
      .eq('attendee_id', attendee_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
    return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS })
  }

  const { data, error } = await supabase
    .from('affiliate_attributions')
    .upsert(
      { event_id, attendee_id, affiliate_id, source: 'manual' },
      { onConflict: 'event_id,attendee_id' },
    )
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  return NextResponse.json(data, { headers: NO_STORE_HEADERS })
}

// PATCH { id, bank_name?, bank_account?, bank_holder?, name?, active? }
// → update an affiliate's profile (bank info, etc.)
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    id?: string
    bank_name?: string | null
    bank_account?: string | null
    bank_holder?: string | null
    name?: string | null
    active?: boolean
  }
  const { id, ...updates } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400, headers: NO_STORE_HEADERS })
  // Whitelist columns we allow editing through this endpoint
  const ALLOWED = ['bank_name', 'bank_account', 'bank_holder', 'name', 'active'] as const
  const patch: Record<string, unknown> = {}
  for (const k of ALLOWED) {
    if (k in updates) patch[k] = (updates as Record<string, unknown>)[k]
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400, headers: NO_STORE_HEADERS })
  }
  const { data, error } = await supabase.from('affiliates').update(patch).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  return NextResponse.json(data, { headers: NO_STORE_HEADERS })
}

// DELETE ?id=  → remove an attribution by id
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400, headers: NO_STORE_HEADERS })
  const { error } = await supabase.from('affiliate_attributions').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS })
}
