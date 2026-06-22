import { NextRequest, NextResponse } from 'next/server'
import { fetchUpcomingBookings, syncBooking } from '@/lib/calcom-sync'
import { notifyAdmins, esc, b } from '@/lib/telegram'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'no-store' } as const

// Daily Vercel Cron + manual safety net: pull all upcoming Cal.com bookings and
// upsert them into the pipeline. The webhook handles real-time; this catches any
// booking missed while the app/webhook was down. Guarded by CRON_SECRET.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE })
  }
  if (!process.env.CALCOM_API_KEY) {
    return NextResponse.json({ ok: false, error: 'CALCOM_API_KEY not set' }, { status: 503, headers: NO_STORE })
  }

  const bookings = await fetchUpcomingBookings()
  const results = []
  for (const nb of bookings) results.push(await syncBooking(nb))

  const created = results.filter(r => r.action === 'created')
  if (created.length) {
    try {
      await notifyAdmins(
        `📅 ${b('Cal.com backfill')}: ${created.length} new call${created.length > 1 ? 's' : ''} added to the pipeline\n` +
        created.map(c => `• ${esc(c.name)}`).join('\n'),
      )
    } catch { /* ping best-effort */ }
  }

  return NextResponse.json(
    { ok: true, scanned: bookings.length, created: created.length, results },
    { headers: NO_STORE },
  )
}
