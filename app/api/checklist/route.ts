import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireUser } from '@/lib/auth/guard'
import { SOP_TEMPLATE } from '@/lib/sop-template'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

export const dynamic = 'force-dynamic'

// Build a team name → phone lookup for the seeded SOP PICs.
function teamPhoneLookup(team: unknown): Record<string, string> {
  const map: Record<string, string> = {}
  if (Array.isArray(team)) {
    for (const m of team as Array<{ name?: string; phone?: string }>) {
      if (m?.name && m?.phone) map[m.name.trim().toLowerCase()] = m.phone
    }
  }
  return map
}

export async function GET(req: NextRequest) {
  const g = await requireUser('GET /api/checklist'); if (g.response) return g.response
  const { searchParams } = new URL(req.url)
  const event_id = searchParams.get('event_id')

  let query = supabaseAdmin.from('checklist_items').select('*').order('category').order('created_at')
  if (event_id) query = query.eq('event_id', event_id)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  return NextResponse.json(data, { headers: NO_STORE_HEADERS })
}

export async function POST(req: NextRequest) {
  const g = await requireUser('POST /api/checklist'); if (g.response) return g.response
  const { searchParams } = new URL(req.url)

  // ?action=seed-sop {event_id} → bulk-add the standard SOP template, computing
  // due dates from the event date. Idempotent: skips items already present
  // (same category + item text) so re-running never duplicates.
  if (searchParams.get('action') === 'seed-sop') {
    const { event_id } = await req.json().catch(() => ({})) as { event_id?: string }
    if (!event_id) return NextResponse.json({ error: 'event_id required' }, { status: 400, headers: NO_STORE_HEADERS })

    const { data: ev } = await supabaseAdmin.from('events').select('date, team').eq('id', event_id).single()
    const eventDate = ev?.date ? new Date(ev.date as string) : null
    const phones = teamPhoneLookup(ev?.team)

    const { data: existing } = await supabaseAdmin
      .from('checklist_items').select('category, item').eq('event_id', event_id)
    const have = new Set((existing ?? []).map(e => `${e.category}|||${e.item}`))

    const toInsert = SOP_TEMPLATE
      .filter(s => !have.has(`${s.category}|||${s.item}`))
      .map(s => {
        let due: string | null = null
        if (eventDate && s.dueOffsetDays != null) {
          const d = new Date(eventDate)
          d.setDate(d.getDate() + s.dueOffsetDays)
          due = d.toISOString().slice(0, 10)
        }
        return {
          event_id,
          category: s.category,
          item: s.item,
          pic_name: s.pic,
          pic_phone: s.pic ? (phones[s.pic.trim().toLowerCase()] ?? null) : null,
          status: 'pending',
          due_date: due,
          notes: s.notes,
        }
      })

    if (!toInsert.length) return NextResponse.json({ added: 0, skipped: SOP_TEMPLATE.length }, { headers: NO_STORE_HEADERS })
    const { error } = await supabaseAdmin.from('checklist_items').insert(toInsert)
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
    return NextResponse.json({ added: toInsert.length, skipped: SOP_TEMPLATE.length - toInsert.length }, { headers: NO_STORE_HEADERS })
  }

  const body = await req.json()
  const { data, error } = await supabaseAdmin.from('checklist_items').insert(body).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  return NextResponse.json(data, { headers: NO_STORE_HEADERS })
}

export async function PATCH(req: NextRequest) {
  const g = await requireUser('PATCH /api/checklist'); if (g.response) return g.response
  const body = await req.json()
  const { id, ...updates } = body
  const { data, error } = await supabaseAdmin.from('checklist_items').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  return NextResponse.json(data, { headers: NO_STORE_HEADERS })
}

export async function DELETE(req: NextRequest) {
  const g = await requireUser('DELETE /api/checklist'); if (g.response) return g.response
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const { error } = await supabaseAdmin.from('checklist_items').delete().eq('id', id!)
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS })
}
