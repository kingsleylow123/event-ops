import { NextRequest, NextResponse } from 'next/server'
import { getRecentRuns, getRunDetail } from '@/lib/c-suite'
import { requireAdmin } from '@/lib/auth/guard'

export const dynamic = 'force-dynamic'

// Dashboard read: recent runs + the full detail of one run (latest by default).
// Admin-only — the board surfaces revenue-sensitive finance data, so gate it like
// the other money surfaces (the sidebar link is already admin-only).
export async function GET(req: NextRequest) {
  const guard = await requireAdmin('/api/c-suite/latest')
  if (guard.response) return guard.response
  try {
    const runs = await getRecentRuns(25)
    const id = new URL(req.url).searchParams.get('run') || runs[0]?.id
    const detail = id ? await getRunDetail(id) : { run: null, opinions: [], decisions: [] }
    return NextResponse.json({ runs, detail })
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message || e) }, { status: 500 })
  }
}
