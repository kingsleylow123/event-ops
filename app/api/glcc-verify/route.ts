import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { normPhone } from '@/lib/format'
import { rateLimit, clientIp, tooManyResponse } from '@/lib/rate-limit'
import { GLCC_SETUP_SKILL } from '@/lib/glcc-skill'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

// POST (public): verify someone is a PAID Go Live Claude Challenge attendee by
// matching their email or phone against paid attendees of any GLCC-variant event.
// On success returns their personal checklist URL + the gated setup-copilot skill.
// Used by both the gated /glcc-skill page and the skill's own self-verify step.
export async function POST(req: NextRequest) {
  if (!(await rateLimit(`glcc-verify:${clientIp(req)}`, 20))) return tooManyResponse()

  const body = await req.json().catch(() => ({}))
  const { name, email, phone } = body as { name?: string; email?: string; phone?: string }

  const emailNorm = typeof email === 'string' ? email.trim().toLowerCase() : ''
  const phoneNorm = typeof phone === 'string' ? normPhone(phone) : ''
  if (!emailNorm && !phoneNorm) {
    return NextResponse.json({ ok: false, error: 'email or phone required' }, { status: 400, headers: NO_STORE })
  }

  // Which events are GLCC (2-day) events.
  const { data: events } = await supabase.from('events').select('id, config')
  const glccEventIds = (events ?? [])
    .filter(e => (e.config as Record<string, unknown> | null)?.prep_variant === 'glcc')
    .map(e => e.id as string)
  if (glccEventIds.length === 0) {
    return NextResponse.json({ ok: false }, { headers: NO_STORE })
  }

  // Paid attendees of those events.
  const { data: atts } = await supabase
    .from('attendees')
    .select('name, email, phone, event_id, payment_status')
    .in('event_id', glccEventIds)
    .eq('payment_status', 'paid')

  const match = (atts ?? []).find(a => {
    const aEmail = typeof a.email === 'string' ? a.email.trim().toLowerCase() : ''
    const aPhone = typeof a.phone === 'string' ? normPhone(a.phone) : ''
    return (!!emailNorm && aEmail === emailNorm) || (!!phoneNorm && aPhone === phoneNorm)
  })

  if (!match) {
    return NextResponse.json({ ok: false }, { headers: NO_STORE })
  }

  const origin = new URL(req.url).origin
  const startUrl = `${origin}/start?event=${match.event_id}`
  const displayName = (match.name as string) || (typeof name === 'string' ? name.trim() : '') || 'there'

  return NextResponse.json(
    { ok: true, name: displayName, startUrl, skill: GLCC_SETUP_SKILL },
    { headers: NO_STORE },
  )
}
