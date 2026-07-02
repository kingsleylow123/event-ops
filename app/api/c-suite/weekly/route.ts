import { NextRequest, NextResponse } from 'next/server'
import { runBoard } from '@/lib/c-suite'
import { notifyAdmins, b, esc } from '@/lib/telegram'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Weekly Vercel Cron → the deeper "board meeting": same board, weekly framing
// (trends, what each head learned, strategic moves). Guarded by CRON_SECRET.
// Failures ping Telegram loudly — a silent board is worse than no board.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  try {
    const summary = await runBoard('weekly')
    // Alert on real failures only — config-skips while the feature is inert are noise.
    const configSkip = !!summary.skipped && /ANTHROPIC|OAUTH|SERVICE_ROLE/i.test(summary.skipped)
    if (!summary.ok && !configSkip) {
      await notifyAdmins(`⚠️ ${b('C-Suite weekly did not run')}\n${esc(summary.skipped ?? summary.error ?? 'unknown reason')}`).catch(() => {})
    }
    return NextResponse.json(summary)
  } catch (e) {
    const msg = String((e as Error)?.message || e)
    await notifyAdmins(`🚨 ${b('C-Suite weekly crashed')}\n${esc(msg)}`).catch(() => {})
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}