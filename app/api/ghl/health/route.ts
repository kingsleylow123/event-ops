import { NextRequest, NextResponse } from 'next/server'
import { ghlHealthcheck } from '@/lib/ghl'
import { notifyAdmins, b } from '@/lib/telegram'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const NO_STORE = { 'Cache-Control': 'no-store' } as const

// Daily Vercel Cron backstop: proves the GHL Private Integration Token still
// works. GHL rotates PITs ~every 90 days (7-day grace), so this catches a
// rotated/revoked token even on days with no Cal.com bookings to exercise the
// live path. On failure, ping admins so the env var gets rotated in time.
// Guarded by CRON_SECRET. (lib/ghl also alerts on any live 401/403.)
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE })
  }

  const result = await ghlHealthcheck()

  if (!result.enabled) {
    return NextResponse.json({ ok: false, reason: 'GHL not configured' }, { headers: NO_STORE })
  }

  if (!result.ok) {
    try {
      await notifyAdmins(
        `🔴 ${b('GHL healthcheck failed')} (HTTP ${result.status}) — the Private Integration Token is likely rotated/revoked.\n` +
        `Update ${b('GHL_API_TOKEN')} in Vercel (event-ops → Settings → Environment Variables) + redeploy.`,
      )
    } catch { /* ping best-effort */ }
  }

  return NextResponse.json(result, { headers: NO_STORE })
}
