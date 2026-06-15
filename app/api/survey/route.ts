import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { requireUser } from '@/lib/auth/guard'
import { normPhone } from '@/lib/format'
import { rateLimit, clientIp, tooManyResponse, tooLong } from '@/lib/rate-limit'
import { resolveEventConfig } from '@/lib/event-config'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// One personalised ops recommendation (~50 words) from the person's answers.
// Best-effort: returns null on any error / missing key so the survey never breaks.
async function generateRecommendation(a: {
  name?: string; industry?: string; company_size?: string
  biggest_challenge?: string; workshop_goal?: string
}): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  if (!a.biggest_challenge && !a.workshop_goal) return null
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 130,
      system:
        'You are an AI operations advisor for Claude Malaysia, helping Malaysian business owners use Claude and AI to run leaner, faster operations. ' +
        'Voice: direct, warm, practical, specific — no hype, no fluff, no emoji. ' +
        "Given one person's survey answers, write ONE personalised recommendation. " +
        'HARD LIMIT: 50 words, two sentences maximum. Be a concrete first move with Claude/AI that tackles their biggest operations challenge and points at their goal — name a specific workflow or first step. ' +
        'Address them as "you". Output ONLY the recommendation as one tight plain-text paragraph — no preamble, heading, markdown, or lists.',
      messages: [{
        role: 'user',
        content:
          `Industry: ${a.industry || '—'}\n` +
          `Team size: ${a.company_size || '—'}\n` +
          `Biggest operations challenge: ${a.biggest_challenge || '—'}\n` +
          `Their 10/10 operations goal: ${a.workshop_goal || '—'}`,
      }],
    }, { timeout: 12000 })
    const block = msg.content.find(c => c.type === 'text')
    return block && block.type === 'text' ? block.text.trim() : null
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  // Burst protection: generous (a venue's shared wifi IP can carry a room of
  // people), but enough to stop bot floods minting member IDs.
  if (!(await rateLimit(`survey:${clientIp(req)}`, 15))) return tooManyResponse()

  const { searchParams } = new URL(req.url)

  // ?action=recommend — generate the personalised tip only (no DB write). Fired
  // by the completion screen so "You're all set!" shows instantly while this runs.
  if (searchParams.get('action') === 'recommend') {
    const a = await req.json().catch(() => ({}))
    return NextResponse.json({ recommendation: await generateRecommendation(a) })
  }

  const body = await req.json()
  const { event_id, attendee_id, name, phone, industry, company_size, biggest_challenge, workshop_goal } = body

  if (!event_id || !name) {
    return NextResponse.json({ error: 'event_id and name required' }, { status: 400 })
  }
  const oversized = tooLong({
    name: [name, 120], phone: [phone, 40], industry: [industry, 200],
    company_size: [company_size, 60], biggest_challenge: [biggest_challenge, 3000],
    workshop_goal: [workshop_goal, 3000],
  })
  if (oversized) {
    return NextResponse.json({ error: `${oversized} too long` }, { status: 400 })
  }

  const row = {
    event_id,
    attendee_id: attendee_id || null,
    name,
    phone: phone || null,
    industry: industry || null,
    company_size: company_size || null,
    biggest_challenge: biggest_challenge || null,
    workshop_goal: workshop_goal || null,
  }

  // Dedup by (event, phone): a re-submission from the same person UPDATES
  // their existing response instead of inserting a duplicate that pollutes
  // Insights counts. Phone is stored raw, so match by normalized phone in JS
  // (per-event responses are small). No phone → fall through to insert.
  const submitNorm = normPhone(phone)
  let savedId: string | null = null
  if (submitNorm) {
    const { data: existing } = await supabase
      .from('pre_event_survey_responses')
      .select('id, phone')
      .eq('event_id', event_id)
    const dup = existing?.find(r => normPhone(r.phone as string) === submitNorm)
    if (dup) {
      const { data: upd, error: updErr } = await supabase
        .from('pre_event_survey_responses')
        .update(row)
        .eq('id', dup.id)
        .select('id')
        .single()
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
      savedId = upd.id
    }
  }

  if (!savedId) {
    const { data, error } = await supabase
      .from('pre_event_survey_responses')
      .insert([row])
      .select('id')
      .single()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    savedId = data.id
  }

  // Assign (or fetch) a Claude Malaysia member number, keyed by phone. Upsert on
  // phone_norm keeps it stable — existing members keep their number, new ones get
  // the next. Best-effort: never fail the survey on a member-registry hiccup.
  let member_no: number | null = null
  const phone_norm = normPhone(phone)
  if (phone_norm) {
    try {
      const { data: m } = await supabase
        .from('members')
        .upsert({ name, phone: phone || null, phone_norm }, { onConflict: 'phone_norm' })
        .select('member_no')
        .single()
      member_no = (m?.member_no as number) ?? null
    } catch { /* registry hiccup — survey still succeeds */ }
  }

  return NextResponse.json({ success: true, id: savedId, member_no })
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const event_id = searchParams.get('event_id')

  if (!event_id) {
    return NextResponse.json({ error: 'event_id required' }, { status: 400 })
  }

  // Public mode (?name=1): return the event name + format + content config for
  // the survey form header, variant selection, and thank-you links. No PII.
  if (searchParams.get('name') === '1') {
    const { data } = await supabase.from('events').select('name, format, config').eq('id', event_id).single()
    return NextResponse.json({
      name: data?.name ?? null,
      format: data?.format ?? 'workshop',
      config: resolveEventConfig(data?.config),
    })
  }

  // Public facts (?facts=1): event name/date/venue/capacity + live fill counts.
  // No PII — for the pre-event landing page hero. Safe for unauthenticated use.
  if (searchParams.get('facts') === '1') {
    const { data: ev } = await supabase
      .from('events').select('name, date, venue, capacity, config, floor_plan').eq('id', event_id).single()
    const { count: registered } = await supabase
      .from('attendees').select('id', { count: 'exact', head: true }).eq('event_id', event_id)
    const { count: paid } = await supabase
      .from('attendees').select('id', { count: 'exact', head: true })
      .eq('event_id', event_id).eq('payment_status', 'paid')
    // Just the count, never the floor_plan contents — keeps speakers/notes private.
    const fp = ev?.floor_plan as { days?: unknown[] } | null
    const days_count = Array.isArray(fp?.days) && fp!.days!.length > 0 ? fp!.days!.length : 1
    return NextResponse.json({
      name: ev?.name ?? null,
      date: ev?.date ?? null,
      venue: ev?.venue ?? null,
      capacity: ev?.capacity ?? null,
      registered: registered ?? 0,
      paid: paid ?? 0,
      config: resolveEventConfig(ev?.config),
      days_count,
    })
  }

  // Full responses list = admin/staff only (contains PII).
  const g = await requireUser('GET /api/survey'); if (g.response) return g.response

  const { data, error } = await supabase
    .from('pre_event_survey_responses')
    .select('*')
    .eq('event_id', event_id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const g = await requireUser('PATCH /api/survey'); if (g.response) return g.response
  const { id, ...updates } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('pre_event_survey_responses')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
