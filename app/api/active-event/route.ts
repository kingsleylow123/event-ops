import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { pickActiveEvent } from '@/lib/event'
import type { Event } from '@/lib/supabase'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

export const dynamic = 'force-dynamic'

// Public: resolves the *current* active event using the same date-driven rule as
// the dashboard (pinned is_active → soonest upcoming → most recent past). Lets the
// bare /start and /survey links (no ?event=) auto-point at the live workshop, so a
// single stable link never goes stale. Returns id/name/date only — no PII.
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('events')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) {
    return NextResponse.json({ id: null, error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  }
  const active = pickActiveEvent((data ?? []) as Event[])
  return NextResponse.json(
    { id: active?.id ?? null, name: active?.name ?? null, date: active?.date ?? null },
    { headers: NO_STORE_HEADERS },
  )
}
