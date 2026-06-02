import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autoMatch } from '@/lib/affiliates'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Daily Vercel Cron → auto-match every upcoming event.
// Guarded by CRON_SECRET (Vercel sends it as `Authorization: Bearer <secret>`).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  // Process recent (last 30 days) + all upcoming events — a just-finished event
  // still accrues affiliate sales that need matching, so "future only" misses them.
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString()
  const { data: events, error } = await supabase
    .from('events')
    .select('id, name')
    .gte('date', cutoff)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  const results: Array<{ event: string; matched: number }> = []
  for (const ev of events ?? []) {
    try {
      const matched = await autoMatch(ev.id as string)
      results.push({ event: ev.name as string, matched })
    } catch (e) {
      results.push({ event: ev.name as string, matched: -1 })
      console.error(`[affiliates/cron] ${ev.name} failed`, e)
    }
  }

  return NextResponse.json({ ok: true, results })
}
