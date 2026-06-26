import type Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin as supabase, fetchAllRows } from '@/lib/supabase-admin'
import { normPhone } from '@/lib/format'
import type { ToolDef, AgentContext } from '../types'

const SEARCH_LEADS_SCHEMA: Anthropic.Tool = {
  name: 'search_leads',
  description: 'Search the master leads CRM (all events, all time — ManyChat/WhatsApp contacts, NOT event registrants). mode "summary" = counts by owner/affiliate. mode "search" = find specific leads by name or phone. Optional handle filters by affiliate. Use for "how many leads", "leads from <handle>", "find lead <name>".',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Name or phone to find (triggers search mode).' },
      handle: { type: 'string', description: 'Filter by affiliate handle (partial match).' },
      mode: { type: 'string', enum: ['summary', 'search'], description: 'Default: search if query given, else summary.' },
    },
  },
}

async function searchLeads(args: Record<string, unknown>, _ctx: AgentContext) {
  const query = String(args.query ?? '').trim()
  const handle = String(args.handle ?? '').trim().toLowerCase()
  const mode = String(args.mode ?? (query ? 'search' : 'summary'))

  if (mode === 'search') {
    if (!query) return { matches: [], total: 0 }
    const qp = normPhone(query)
    // Strip PostgREST .or() metacharacters so a name with a comma/parens can't
    // break the filter into bogus predicates.
    const safe = query.replace(/[(),]/g, ' ').trim()
    let sb = supabase.from('leads').select('name,phone,owner,affiliate_handle,last_message_at').limit(25)
    if (qp.length >= 4) sb = sb.or(`name.ilike.%${safe}%,phone_norm.ilike.%${qp}%`)
    else sb = sb.ilike('name', `%${safe}%`)
    const { data, error } = await sb
    if (error) return { error: error.message }
    let rows = data ?? []
    if (handle) rows = rows.filter(r => String(r.affiliate_handle ?? '').toLowerCase().includes(handle))
    return {
      total: rows.length,
      matches: rows.map(r => ({ name: r.name, phone: r.phone ?? null, owner: r.owner, affiliate_handle: r.affiliate_handle ?? null, last_message_at: r.last_message_at ?? null })),
    }
  }

  // summary mode — paginate past PostgREST's 1000-row cap
  const { rows, error } = await fetchAllRows<{ owner: string; affiliate_handle: string | null }>(
    (from, to) => supabase.from('leads').select('owner, affiliate_handle').order('id').range(from, to),
  )
  if (error) return { error }
  const byHandle: Record<string, number> = {}
  let affiliate = 0
  let kingsley = 0
  for (const r of rows) {
    if (r.owner === 'affiliate') { affiliate++; const h = r.affiliate_handle || '(unknown)'; byHandle[h] = (byHandle[h] ?? 0) + 1 }
    else kingsley++
  }
  let by_affiliate = Object.entries(byHandle).map(([h, count]) => ({ handle: h, count })).sort((a, b) => b.count - a.count)
  if (handle) by_affiliate = by_affiliate.filter(x => x.handle.toLowerCase().includes(handle))
  return { total: rows.length, affiliate_leads: affiliate, kingsley_leads: kingsley, by_affiliate: by_affiliate.slice(0, 20) }
}

export const SEARCH_LEADS_TOOL: ToolDef = { schema: SEARCH_LEADS_SCHEMA, handler: searchLeads }
