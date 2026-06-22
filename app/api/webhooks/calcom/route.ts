import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { normalizeBooking, syncBooking } from '@/lib/calcom-sync'
import { notifyAdmins, esc, b } from '@/lib/telegram'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' } as const
const HANDLED = new Set(['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED'])

// Verify Cal.com's HMAC-SHA256 signature over the raw body (x-cal-signature-256).
function verify(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(digest)
  const bb = Buffer.from(signature)
  return a.length === bb.length && crypto.timingSafeEqual(a, bb)
}

// Cal.com webhook → upsert the booked call into the EventOps pipeline + GHL.
// Fires on every booking event. Fail-closed on a missing/invalid signature.
export async function POST(req: NextRequest) {
  const secret = process.env.CALCOM_WEBHOOK_SECRET
  if (!secret) return NextResponse.json({ ok: false, error: 'webhook not configured' }, { status: 503, headers: NO_STORE })

  const rawBody = await req.text()
  if (!verify(rawBody, req.headers.get('x-cal-signature-256'), secret)) {
    return NextResponse.json({ ok: false, error: 'bad signature' }, { status: 401, headers: NO_STORE })
  }

  let body: Record<string, unknown> = {}
  try { body = JSON.parse(rawBody) as Record<string, unknown> } catch { /* keep empty */ }

  const triggerEvent = String(body.triggerEvent ?? '')
  if (!HANDLED.has(triggerEvent)) {
    return NextResponse.json({ ok: true, ignored: triggerEvent || 'unknown' }, { headers: NO_STORE })
  }

  const payload = body.payload ?? body
  const nb = normalizeBooking(payload, triggerEvent)
  const outcome = await syncBooking(nb)

  // Telegram ping for new/rescheduled bookings (best-effort).
  if (outcome.action === 'created' || outcome.action === 'updated') {
    try {
      const when = nb.startISO
        ? new Date(nb.startISO).toLocaleString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' })
        : 'TBD'
      await notifyAdmins(
        `📅 ${b(outcome.action === 'created' ? 'New call booked' : 'Call rescheduled')} (Cal.com)\n` +
        `${b(esc(nb.name || 'Unknown'))}${nb.phone ? ` · ${esc(nb.phone)}` : ''}\n` +
        `${b('When')}: ${esc(when)}\n` +
        (nb.company ? `${b('Co')}: ${esc(nb.company)}\n` : '') +
        `<i>→ pipeline (meeting) + GHL Scheduled Call</i>`,
      )
    } catch { /* ping failure must not fail the webhook */ }
  }

  return NextResponse.json({ ok: true, ...outcome }, { headers: NO_STORE })
}
