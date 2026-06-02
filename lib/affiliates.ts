import { supabase } from '@/lib/supabase'

// Public CSV export of the affiliate lead sheet
export const LEAD_SHEET_CSV =
  'https://docs.google.com/spreadsheets/d/13cY7A5GA3e5X8dlZFuIySOFYX2BiBONVnGSj5J2AFz8/export?format=csv'

// ── Normalization (mirrors the validated /tmp/payout.py logic) ────────────────
export function normPhone(p: string | null | undefined): string {
  if (!p) return ''
  let d = String(p).replace(/\D/g, '')
  if (d.startsWith('60')) d = d.slice(2) // strip MY country code
  d = d.replace(/^0+/, '') // strip leading zeros
  return d
}

export function normEmail(e: string | null | undefined): string {
  return (e ?? '').trim().toLowerCase()
}

// ── Lead sheet parsing ────────────────────────────────────────────────────────
export interface Lead {
  name: string
  email: string // normalized
  phone: string // normalized
  handle: string
}

// Minimal CSV parser that handles quoted fields with commas.
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c === '\r') { /* skip */ }
    else field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows
}

export async function fetchLeads(): Promise<Lead[]> {
  const res = await fetch(LEAD_SHEET_CSV, { cache: 'no-store' })
  if (!res.ok) throw new Error(`lead sheet fetch failed: ${res.status}`)
  const rows = parseCsv(await res.text())
  if (!rows.length) return []
  const header = rows[0].map(h => h.trim().toLowerCase())
  const iName = header.findIndex(h => h === 'name')
  const iEmail = header.findIndex(h => h === 'email')
  const iPhone = header.findIndex(h => h.includes('phone'))
  const iAff = header.findIndex(h => h.includes('affiliate'))
  const leads: Lead[] = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const handle = (row[iAff] ?? '').trim()
    if (!handle) continue
    leads.push({
      name: (row[iName] ?? '').trim(),
      email: normEmail(row[iEmail]),
      phone: normPhone(row[iPhone]),
      handle,
    })
  }
  return leads
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface BuyerRow {
  attendee_id: string
  name: string
  phones: string[]   // normalized
  emails: string[]   // normalized
  total: number      // RM, summed across that buyer's paid rows
}

export interface PayoutReport {
  buyers: Array<{
    attendee_id: string
    name: string
    total: number
    affiliate_id: string | null
    affiliate_handle: string | null
    source: string | null
  }>
  affiliates: Array<{ id: string; handle: string; name: string | null; rate: number; active: boolean }>
  summary: Array<{
    affiliate_id: string
    handle: string
    buyers: number
    revenue: number
    commission: number
  }>
  totals: { attributed_revenue: number; total_commission: number; unattributed_revenue: number }
}

// ── Group paid attendees into unique buyers (dedupe by identity) ───────────────
export async function loadBuyers(eventId: string): Promise<BuyerRow[]> {
  const { data, error } = await supabase
    .from('attendees')
    .select('id, name, phone, email, payment_amount, payment_status')
    .eq('event_id', eventId)
    .eq('payment_status', 'paid')
    .order('id', { ascending: true }) // stable order → deterministic representative id
  if (error) throw new Error(error.message)
  const rows = data ?? []

  // Group by identity key = first normalized phone, else email
  const groups = new Map<string, { ids: string[]; name: string; phones: Set<string>; emails: Set<string>; total: number }>()
  for (const a of rows) {
    const ph = normPhone(a.phone as string)
    const em = normEmail(a.email as string)
    const key = ph || em || (a.id as string)
    let g = groups.get(key)
    if (!g) { g = { ids: [], name: (a.name as string).trim(), phones: new Set(), emails: new Set(), total: 0 }; groups.set(key, g) }
    g.ids.push(a.id as string)
    if (ph) g.phones.add(ph)
    if (em) g.emails.add(em)
    g.total += Number(a.payment_amount ?? 0)
  }

  // Representative attendee_id per buyer = the first id (used for attribution storage)
  return [...groups.values()].map(g => ({
    attendee_id: g.ids[0],
    name: g.name,
    phones: [...g.phones],
    emails: [...g.emails],
    total: g.total,
  }))
}

// ── Build the full payout report for an event ─────────────────────────────────
export async function buildReport(eventId: string): Promise<PayoutReport> {
  const [buyers, affRes, attrRes] = await Promise.all([
    loadBuyers(eventId),
    supabase.from('affiliates').select('id, handle, name, commission_rate, active'),
    supabase.from('affiliate_attributions').select('id, attendee_id, affiliate_id, source').eq('event_id', eventId),
  ])
  if (affRes.error) throw new Error(affRes.error.message)
  if (attrRes.error) throw new Error(attrRes.error.message)

  const affiliates = (affRes.data ?? []).map(a => ({
    id: a.id as string, handle: a.handle as string, name: a.name as string | null,
    rate: Number(a.commission_rate ?? 0.10), active: a.active as boolean,
  }))
  const affById = new Map(affiliates.map(a => [a.id, a]))

  // attendee_id (representative) -> attribution
  const attrByAttendee = new Map<string, { affiliate_id: string; source: string }>()
  for (const at of attrRes.data ?? []) {
    attrByAttendee.set(at.attendee_id as string, { affiliate_id: at.affiliate_id as string, source: at.source as string })
  }

  const buyerRows = buyers.map(b => {
    const attr = attrByAttendee.get(b.attendee_id)
    const aff = attr ? affById.get(attr.affiliate_id) : null
    return {
      attendee_id: b.attendee_id,
      name: b.name,
      total: b.total,
      affiliate_id: aff?.id ?? null,
      affiliate_handle: aff?.handle ?? null,
      source: attr?.source ?? null,
    }
  }).sort((a, b) => b.total - a.total)

  // Summary per affiliate (only active affiliates earn payouts)
  const sumMap = new Map<string, { revenue: number; buyers: number }>()
  for (const b of buyerRows) {
    if (!b.affiliate_id) continue
    const aff = affById.get(b.affiliate_id)
    if (!aff || !aff.active) continue
    const s = sumMap.get(b.affiliate_id) ?? { revenue: 0, buyers: 0 }
    s.revenue += b.total; s.buyers += 1
    sumMap.set(b.affiliate_id, s)
  }

  const summary = [...sumMap.entries()].map(([id, s]) => {
    const aff = affById.get(id)!
    return { affiliate_id: id, handle: aff.handle, buyers: s.buyers, revenue: s.revenue, commission: s.revenue * aff.rate }
  }).sort((a, b) => b.commission - a.commission)

  const attributed_revenue = summary.reduce((t, s) => t + s.revenue, 0)
  const total_commission = summary.reduce((t, s) => t + s.commission, 0)
  const all_revenue = buyerRows.reduce((t, b) => t + b.total, 0)

  return {
    buyers: buyerRows,
    affiliates,
    summary,
    totals: {
      attributed_revenue,
      total_commission,
      unattributed_revenue: all_revenue - attributed_revenue,
    },
  }
}

// ── Auto-match: insert source='auto' attributions where none exist ────────────
// Never touches existing rows (manual OR auto) due to the UNIQUE(event_id, attendee_id)
// constraint + ignoreDuplicates. Returns count of new attributions inserted.
export async function autoMatch(eventId: string): Promise<number> {
  const [leads, buyers, affRes, attrRes] = await Promise.all([
    fetchLeads(),
    loadBuyers(eventId),
    supabase.from('affiliates').select('id, handle, active'),
    supabase.from('affiliate_attributions').select('attendee_id').eq('event_id', eventId),
  ])
  if (affRes.error) throw new Error(affRes.error.message)
  if (attrRes.error) throw new Error(attrRes.error.message)

  const handleToId = new Map((affRes.data ?? []).map(a => [a.handle as string, { id: a.id as string, active: a.active as boolean }]))
  const alreadyAttributed = new Set((attrRes.data ?? []).map(a => a.attendee_id as string))

  // Lead lookup maps
  const phone2handle = new Map<string, string>()
  const email2handle = new Map<string, string>()
  for (const l of leads) {
    if (l.phone && !phone2handle.has(l.phone)) phone2handle.set(l.phone, l.handle)
    if (l.email && !email2handle.has(l.email)) email2handle.set(l.email, l.handle)
  }

  const toInsert: Array<{ event_id: string; attendee_id: string; affiliate_id: string; source: string }> = []
  for (const b of buyers) {
    if (alreadyAttributed.has(b.attendee_id)) continue
    let handle: string | undefined
    for (const p of b.phones) { if (phone2handle.has(p)) { handle = phone2handle.get(p); break } }
    if (!handle) for (const e of b.emails) { if (email2handle.has(e)) { handle = email2handle.get(e); break } }
    if (!handle) continue
    const aff = handleToId.get(handle)
    if (!aff || !aff.active) continue // skip inactive (e.g. kingsley1022)
    toInsert.push({ event_id: eventId, attendee_id: b.attendee_id, affiliate_id: aff.id, source: 'auto' })
  }

  if (!toInsert.length) return 0
  const { error } = await supabase
    .from('affiliate_attributions')
    .upsert(toInsert, { onConflict: 'event_id,attendee_id', ignoreDuplicates: true })
  if (error) throw new Error(error.message)
  return toInsert.length
}
