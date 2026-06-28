import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/guard'
import { buildScorecard, syncInstagram, setIgHandle, setCreatorSettings, SINCE_DEFAULT } from '@/lib/creators'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

export const dynamic = 'force-dynamic'
export const maxDuration = 120 // Apify scrape can take ~30–90s

// GET ?from=&to=  → unified Creator Scorecard (IG posts/collabs + affiliate perf)
export async function GET(req: NextRequest) {
  const g = await requireAdmin('GET /api/creators'); if (g.response) return g.response
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from') || SINCE_DEFAULT
  const to = searchParams.get('to') || undefined
  try {
    const report = await buildScorecard(from, to)
    return NextResponse.json(report, { headers: NO_STORE_HEADERS })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500, headers: NO_STORE_HEADERS })
  }
}

// POST ?action=sync { since?, limit? }  → scrape IG + upsert (manual "Sync" button)
// POST ?action=map_ig { affiliate_id, ig_handle }  → link an IG handle to an affiliate
export async function POST(req: NextRequest) {
  const g = await requireAdmin('POST /api/creators'); if (g.response) return g.response
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')
  const body = await req.json().catch(() => ({}))

  if (action === 'sync') {
    const { since, limit } = body as { since?: string; limit?: number }
    try {
      const r = await syncInstagram(since || SINCE_DEFAULT, typeof limit === 'number' ? limit : 300)
      return NextResponse.json(r, { headers: NO_STORE_HEADERS })
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500, headers: NO_STORE_HEADERS })
    }
  }

  if (action === 'map_ig') {
    const { affiliate_id, ig_handle } = body as { affiliate_id?: string; ig_handle?: string | null }
    if (!affiliate_id) return NextResponse.json({ error: 'affiliate_id required' }, { status: 400, headers: NO_STORE_HEADERS })
    try {
      await setIgHandle(affiliate_id, ig_handle ?? null)
      return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS })
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500, headers: NO_STORE_HEADERS })
    }
  }

  if (action === 'set_rates') {
    const { commission_rate, override_rate } = body as { commission_rate?: number; override_rate?: number }
    if (typeof commission_rate !== 'number' && typeof override_rate !== 'number') return NextResponse.json({ error: 'commission_rate or override_rate required' }, { status: 400, headers: NO_STORE_HEADERS })
    try {
      await setCreatorSettings({ commission_rate, override_rate })
      return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS })
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500, headers: NO_STORE_HEADERS })
    }
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400, headers: NO_STORE_HEADERS })
}
