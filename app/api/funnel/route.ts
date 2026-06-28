import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/auth/guard'
import { buildFunnel } from '@/lib/funnel'
import { adviseFunnel } from '@/lib/funnel-advisor'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

// GET ?from=&to=&event_id= → the funnel report (+ the cached daily AI insight).
// Pure SQL aggregation; the expensive Anthropic call is ONLY the POST below.
export async function GET(req: NextRequest) {
  const g = await requireAdmin('GET /api/funnel'); if (g.response) return g.response
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from') || undefined
  const to = searchParams.get('to') || undefined
  const eventId = searchParams.get('event_id') || undefined
  try {
    const report = await buildFunnel({ from, to, eventId })
    // Standing insight: latest cached value written by the digest cron (cheap read).
    let standingInsight: string | null = null
    try {
      const { data } = await supabase
        .from('jarvis_daily_snapshots')
        .select('ai_insight, snapshot_date')
        .not('ai_insight', 'is', null)
        .order('snapshot_date', { ascending: false })
        .limit(1)
      standingInsight = data?.[0]?.ai_insight ?? null
    } catch { /* snapshot table optional — ignore */ }
    return NextResponse.json({ ...report, standingInsight }, { headers: NO_STORE })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500, headers: NO_STORE })
  }
}

// POST ?action=advise { from?, to?, event_id? } → live AI deep-dive (Sonnet).
// Explicit, button-triggered — never auto-run, so the page stays fast.
export async function POST(req: NextRequest) {
  const g = await requireAdmin('POST /api/funnel'); if (g.response) return g.response
  const { searchParams } = new URL(req.url)
  if (searchParams.get('action') !== 'advise') {
    return NextResponse.json({ error: 'unknown action' }, { status: 400, headers: NO_STORE })
  }
  const body = await req.json().catch(() => ({})) as { from?: string; to?: string; event_id?: string }
  try {
    const report = await buildFunnel({ from: body.from, to: body.to, eventId: body.event_id })
    const advice = await adviseFunnel(report)
    if (!advice) return NextResponse.json({ error: 'Advisor unavailable right now — try again in a moment.' }, { status: 503, headers: NO_STORE })
    return NextResponse.json({ advice }, { headers: NO_STORE })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500, headers: NO_STORE })
  }
}
