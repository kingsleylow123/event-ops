import { NextRequest, NextResponse } from 'next/server'
import { ingestResult } from '@/lib/c-suite'
import { normalizeBoardResult } from '@/lib/c-suite/ingest'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Ingest a board computed by the Claude Code harness (Kingsley's Max subscription
// on Hermes / a /csuite skill) and persist it to the same dashboard + Telegram.
// Guarded by CRON_SECRET. Body = a BoardResult (defensively normalised).
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  try {
    const body = await req.json().catch(() => null)
    const result = normalizeBoardResult(body)
    if (!result) return NextResponse.json({ ok: false, error: 'invalid board result' }, { status: 400 })
    const notify = new URL(req.url).searchParams.get('notify') !== '0'
    const summary = await ingestResult(result, { notify })
    return NextResponse.json(summary)
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 })
  }
}
