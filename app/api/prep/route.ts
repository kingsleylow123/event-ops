import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { requireUser } from '@/lib/auth/guard'
import { normPhone } from '@/lib/format'
import { rateLimit, clientIp, tooManyResponse } from '@/lib/rate-limit'
import { getPrepStepKeys, getPrepStepLabels, zeroStepCountsFor } from '@/lib/prep-steps'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

// Which pre-flight a given event uses: 'glcc' (2-day) or 'halfday' (default).
// Driven by events.config.prep_variant so adding a GLCC event is config-only.
async function eventVariant(event_id: string): Promise<string> {
  const { data } = await supabase.from('events').select('config').eq('id', event_id).maybeSingle()
  const cfg = (data?.config ?? {}) as Record<string, unknown>
  return cfg.prep_variant === 'glcc' ? 'glcc' : 'halfday'
}

// POST (public): save a participant's prep progress, keyed by normalized phone.
// Matches to an attendee of the event (by phone) to fill the name for the dashboard.
export async function POST(req: NextRequest) {
  // Burst protection. Generous: each checkbox toggle saves, and a venue's
  // shared wifi IP can carry many attendees at once.
  if (!(await rateLimit(`prep:${clientIp(req)}`, 30))) return tooManyResponse()

  const body = await req.json().catch(() => ({}))
  const { event_id, phone, steps, track, tool, tool_has_api } = body as {
    event_id?: string; phone?: string; steps?: Record<string, boolean>
    track?: string; tool?: string; tool_has_api?: boolean
  }
  if (!event_id || !phone || phone.length > 40) {
    return NextResponse.json({ error: 'event_id and phone required' }, { status: 400, headers: NO_STORE })
  }
  const phone_norm = normPhone(phone)
  if (!phone_norm) {
    return NextResponse.json({ error: 'invalid phone' }, { status: 400, headers: NO_STORE })
  }

  // Count completion against the event's own step set (half-day = 6, GLCC = 8).
  const STEP_KEYS = getPrepStepKeys(await eventVariant(event_id))
  const cleanSteps: Record<string, boolean> = {}
  for (const k of STEP_KEYS) cleanSteps[k] = !!steps?.[k]
  // Persist the acknowledgments for the record — completion still = the steps.
  if (steps?.ipad_ack != null) cleanSteps.ipad_ack = !!steps.ipad_ack
  if (steps?.consent_ack != null) cleanSteps.consent_ack = !!steps.consent_ack
  const completed = STEP_KEYS.every(k => cleanSteps[k])
  const cleanTrack = typeof track === 'string' && track.trim() ? track.trim().slice(0, 40) : null
  const cleanTool = typeof tool === 'string' && tool.trim() ? tool.trim().slice(0, 60) : null

  // Try to resolve a name from the event's attendees by matching normalized phone.
  let name: string | null = null
  const { data: atts } = await supabase
    .from('attendees').select('name, phone').eq('event_id', event_id)
  if (atts) {
    const match = atts.find(a => normPhone(a.phone as string) === phone_norm)
    if (match) name = (match.name as string) ?? null
  }

  // Only write track/tool when the client sent them, so a later step-toggle sync
  // (which may not carry them) never blanks a previously-saved choice.
  const row: Record<string, unknown> = {
    event_id, phone, phone_norm, name, steps: cleanSteps, completed,
    updated_at: new Date().toISOString(),
  }
  if (cleanTrack) row.track = cleanTrack
  if (cleanTool) row.tool = cleanTool
  if (tool_has_api != null) row.tool_has_api = !!tool_has_api

  const { error } = await supabase
    .from('prep_progress')
    .upsert(row, { onConflict: 'event_id,phone_norm' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })
  return NextResponse.json({ ok: true, completed }, { headers: NO_STORE })
}

// GET ?event_id=&summary=1 (admin): readiness summary for Insights + Jarvis.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const event_id = searchParams.get('event_id')
  if (!event_id) return NextResponse.json({ error: 'event_id required' }, { status: 400, headers: NO_STORE })

  const g = await requireUser('GET /api/prep'); if (g.response) return g.response

  const variant = await eventVariant(event_id)
  const STEP_KEYS = getPrepStepKeys(variant)

  const { data, error } = await supabase
    .from('prep_progress').select('name, phone, steps, completed, track, tool, tool_has_api, updated_at')
    .eq('event_id', event_id).order('updated_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })

  const rows = data ?? []
  const started = rows.length
  const completed = rows.filter(r => r.completed).length
  const perStep: Record<string, number> = zeroStepCountsFor(variant)
  const perTrack: Record<string, number> = {}
  const perTool: Record<string, number> = {}
  for (const r of rows) {
    const s = (r.steps ?? {}) as Record<string, boolean>
    for (const k of STEP_KEYS) if (s[k]) perStep[k]++
    const t = (r.track as string | null) || null
    if (t) perTrack[t] = (perTrack[t] ?? 0) + 1
    const tl = (r.tool as string | null) || null
    if (tl) perTool[tl] = (perTool[tl] ?? 0) + 1
  }
  const people = rows.map(r => ({
    name: (r.name as string) || (r.phone as string),
    completed: r.completed as boolean,
    done: STEP_KEYS.filter(k => (r.steps as Record<string, boolean>)?.[k]).length,
    track: (r.track as string | null) || null,
    tool: (r.tool as string | null) || null,
    tool_has_api: (r.tool_has_api as boolean | null) ?? null,
  }))

  return NextResponse.json(
    { started, completed, perStep, perTrack, perTool, people, total: STEP_KEYS.length, variant, labels: getPrepStepLabels(variant) },
    { headers: NO_STORE },
  )
}
