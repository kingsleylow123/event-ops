import { NextRequest, NextResponse } from 'next/server'
import { runBoard } from '@/lib/c-suite'
import { notifyAdmins, b, esc } from '@/lib/telegram'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Nightly Vercel Cron → convene the AI C-Suite: heads gather → manager grills →
// ruling → Telegram brief. Guarded by CRON_SECRET (Vercel auto-sends the bearer).
// Also callable manually with the same bearer for an on-demand nightly run.
// A silent board is worse than no board — every failure pings Telegram loudly.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  try {
    const summary = await runBoard('nightly')
    // Alert on real failures only — while the feature is intentionally inert
    // (no model/service keys configured), a nightly ping would just be noise.
    const configSkip = !!summary.skipped && /ANTHROPIC|OAUTH|SERVICE_ROLE/i.test(summary.skipped)
    if (!summary.ok && !configSkip) {
      await notifyAdmins(`⚠️ ${b('C-Suite nightly did not run')}\n${esc(summary.skipped ?? summary.error ?? 'unknown reason')}`).catch(() => {})
    }
    return NextResponse.json(summary)
  } catch (e) {
    const msg = String((e as Error)?.message || e)
    await notifyAdmins(`🚨 ${b('C-Suite nightly crashed')}\n${esc(msg)}`).catch(() => {})
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}