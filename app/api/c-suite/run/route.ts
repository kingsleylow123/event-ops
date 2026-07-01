import { NextRequest, NextResponse } from 'next/server'
import { runBoard } from '@/lib/c-suite'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Nightly Vercel Cron → convene the AI C-Suite: heads gather → manager grills →
// ruling → Telegram brief. Guarded by CRON_SECRET (Vercel auto-sends the bearer).
// Also callable manually with the same bearer for an on-demand nightly run.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  try {
    const summary = await runBoard('nightly')
    return NextResponse.json(summary)
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 })
  }
}
