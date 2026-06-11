import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'
import { supabaseAdmin, fetchAllRows } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/auth/guard'
import { syncLeadTags } from '@/lib/affiliates'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface SeedLead {
  name: string | null
  phone: string | null
  phone_norm: string
  country_code: string | null
  owner: string
  affiliate_handle: string | null
  affiliate_id: string | null
  sources: string[]
  last_message_at: string | null
}

// GET → list with filters + summary counts
// ?owner=affiliate|kingsley  ?handle=  ?source=  ?q=  ?limit=
export async function GET(req: NextRequest) {
  const g = await requireAdmin('GET /api/leads'); if (g.response) return g.response
  const { searchParams } = new URL(req.url)
  const owner = searchParams.get('owner')
  const handle = searchParams.get('handle')
  const source = searchParams.get('source')
  const q = searchParams.get('q')
  const limit = Math.min(Number(searchParams.get('limit') ?? 2000), 5000)

  // Paged via fetchAllRows — PostgREST caps single responses at 1000 rows,
  // which silently truncated the 1,296-lead table (list AND summary counts).
  const buildQuery = () => {
    let query = supabaseAdmin.from('leads').select('*').order('name', { ascending: true })
    if (owner) query = query.eq('owner', owner)
    if (handle) query = query.eq('affiliate_handle', handle)
    if (source) query = query.contains('sources', [source])
    if (q) query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
    return query
  }
  const { rows: data, error } = await fetchAllRows<Record<string, unknown>>(
    (from, to) => buildQuery().range(from, to), limit)
  if (error) return NextResponse.json({ error }, { status: 500, headers: NO_STORE_HEADERS })

  // Summary across the WHOLE table (not just the filtered page)
  const { rows: all } = await fetchAllRows<{ owner: string; affiliate_handle: string | null }>(
    (from, to) => supabaseAdmin.from('leads').select('owner, affiliate_handle').order('id').range(from, to))
  const summary = { total: 0, affiliate: 0, kingsley: 0, byHandle: {} as Record<string, number> }
  for (const r of all) {
    summary.total++
    if (r.owner === 'affiliate') {
      summary.affiliate++
      const h = r.affiliate_handle || '?'
      summary.byHandle[h] = (summary.byHandle[h] ?? 0) + 1
    } else {
      summary.kingsley++
    }
  }

  return NextResponse.json({ leads: data, summary }, { headers: NO_STORE_HEADERS })
}

// POST ?action=import → bulk upsert from the committed seed file (idempotent)
// POST ?action=synctags → re-tag leads from the live affiliate sheet (cosmetic)
export async function POST(req: NextRequest) {
  const g = await requireAdmin('POST /api/leads'); if (g.response) return g.response
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')

  if (action === 'synctags') {
    try {
      const tagged = await syncLeadTags()
      return NextResponse.json({ tagged }, { headers: NO_STORE_HEADERS })
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500, headers: NO_STORE_HEADERS })
    }
  }

  if (action !== 'import') {
    return NextResponse.json({ error: 'unknown action' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  let seed: SeedLead[]
  try {
    seed = JSON.parse(readFileSync(join(process.cwd(), 'data/leads-seed.json'), 'utf-8'))
  } catch (e) {
    return NextResponse.json({ error: `seed read failed: ${(e as Error).message}` }, { status: 500, headers: NO_STORE_HEADERS })
  }

  const rows = seed
    .filter(s => s.phone_norm)
    .map(s => ({
      name: s.name || null,
      phone: s.phone || null,
      phone_norm: s.phone_norm,
      country_code: s.country_code || null,
      owner: s.owner === 'affiliate' ? 'affiliate' : 'kingsley',
      affiliate_handle: s.affiliate_handle || null,
      affiliate_id: s.affiliate_id || null,
      sources: s.sources || [],
      last_message_at: s.last_message_at || null,
    }))

  // Upsert in chunks of 500 (idempotent on phone_norm)
  let upserted = 0
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const { error } = await supabaseAdmin
      .from('leads')
      .upsert(chunk, { onConflict: 'phone_norm' })
    if (error) return NextResponse.json({ error: error.message, upserted }, { status: 500, headers: NO_STORE_HEADERS })
    upserted += chunk.length
  }

  return NextResponse.json({ upserted }, { headers: NO_STORE_HEADERS })
}
