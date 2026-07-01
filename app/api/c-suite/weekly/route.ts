import { NextRequest, NextResponse } from 'next/server'
import { runBoard } from '@/lib/c-suite'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Weekly Vercel Cron → the deeper "board meeting": same board, weekly framing
// (trends, what each head learned, strategic moves). Guarded by CRON_SECRET.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  try {
    const summary = await runBoard('weekly')
    return NextResponse.json(summary)
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 })
  }
}
