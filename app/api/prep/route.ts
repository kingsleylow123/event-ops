import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { requireUser } from '@/lib/auth/guard'
import { normPhone } from '@/lib/format'
import { rateLimit, clientIp, tooManyResponse } from '@/lib/rate-limit'
import { PREP_STEP_KEYS as STEP_KEYS, zeroStepCounts } from '@/lib/prep-steps'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

// POST (public): save a participant's prep progress, keyed by normalized phone.
// Matches to an attendee of the event (by phone) to fill the name for the dashboard.
export async function POST(req: NextRequest) {
  // Burst protection. Generous: each checkbox toggle saves, and a venue's
  // shared wifi IP can carry many attendees at once.
  if (!rateLimit(`prep:${clientIp(req)}`, 30)) return tooManyResponse()

  const body = await req.json().catch(() => ({}))
  const { event_id, phone, steps } = body as {
    event_id?: string; phone?: string; steps?: Record<string, boolean>
  }
  if (!event_id || !phone || phone.length > 40) {
    return NextResponse.json({ error: 'event_id and phone required' }, { status: 400, headers: NO_STORE })
  }
  const phone_norm = normPhone(phone)
  if (!phone_norm) {
    return NextResponse.json({ error: 'invalid phone' }, { status: 400, headers: NO_STORE })
  }

  // Normalize steps to a clean { '1': bool, ... } map. Also persist the iPad
  // acknowledgment ('ipad_ack') for the record — completion still = the 6 steps.
  const cleanSteps: Record<string, boolean> = {}
  for (const k of STEP_KEYS) cleanSteps[k] = !!steps?.[k]
  if (steps?.ipad_ack != null) cleanSteps.ipad_ack = !!steps.ipad_ack
  const completed = STEP_KEYS.every(k => cleanSteps[k])

  // Try to resolve a name from the event's attendees by matching normalized phone.
  let name: string | null = null
  const { data: atts } = await supabase
    .from('attendees').select('name, phone').eq('event_id', event_id)
  if (atts) {
    const match = atts.find(a => normPhone(a.phone as string) === phone_norm)
    if (match) name = (match.name as string) ?? null
  }

  const { error } = await supabase
    .from('prep_progress')
    .upsert(
      { event_id, phone, phone_norm, name, steps: cleanSteps, completed, updated_at: new Date().toISOString() },
      { onConflict: 'event_id,phone_norm' },
    )
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })
  return NextResponse.json({ ok: true, completed }, { headers: NO_STORE })
}

// GET ?event_id=&summary=1 (admin): readiness summary for Insights + Jarvis.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const event_id = searchParams.get('event_id')
  if (!event_id) return NextResponse.json({ error: 'event_id required' }, { status: 400, headers: NO_STORE })

  const g = await requireUser('GET /api/prep'); if (g.response) return g.response

  const { data, error } = await supabase
    .from('prep_progress').select('name, phone, steps, completed, updated_at')
    .eq('event_id', event_id).order('updated_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })

  const rows = data ?? []
  const started = rows.length
  const completed = rows.filter(r => r.completed).length
  const perStep: Record<string, number> = zeroStepCounts()
  for (const r of rows) {
    const s = (r.steps ?? {}) as Record<string, boolean>
    for (const k of STEP_KEYS) if (s[k]) perStep[k]++
  }
  const people = rows.map(r => ({
    name: (r.name as string) || (r.phone as string),
    completed: r.completed as boolean,
    done: STEP_KEYS.filter(k => (r.steps as Record<string, boolean>)?.[k]).length,
  }))

  return NextResponse.json({ started, completed, perStep, people }, { headers: NO_STORE })
}
