import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { normPhone, normEmail } from '@/lib/format'

// Re-export so existing importers (cron, etc.) keep working unchanged.
export { normPhone, normEmail }

// Public CSV export of the affiliate lead sheet
export const LEAD_SHEET_CSV =
  'https://docs.google.com/spreadsheets/d/13cY7A5GA3e5X8dlZFuIySOFYX2BiBONVnGSj5J2AFz8/export?format=csv'

// ── Lead sheet parsing ────────────────────────────────────────────────────────
export interface Lead {
  name: string
  email: string // normalized
  phone: string // normalized
  handle: string
  date: string | null // ISO — when the affiliate signed this lead (sheet "Time" column)
}

// Lead sheet "Time" is day-first (Malaysian): DD/M/YYYY or DD/MM/YYYY.
function parseSheetDate(s: string | undefined): string | null {
  if (!s) return null
  const t = s.trim()
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    const dd = +m[1], mm = +m[2], yyyy = +m[3]
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return new Date(Date.UTC(yyyy, mm - 1, dd)).toISOString()
    return null
  }
  const d = new Date(t)
  return isNaN(d.getTime()) ? null : d.toISOString()
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
  const iTime = header.findIndex(h => h === 'time' || h.includes('date'))
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
      date: iTime >= 0 ? parseSheetDate(row[iTime]) : null,
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
  affiliates: Array<{
    id: string
    handle: string
    name: string | null
    rate: number
    active: boolean
    bank_name: string | null
    bank_account: string | null
    bank_holder: string | null
  }>
  summary: Array<{
    affiliate_id: string
    handle: string
    name: string | null
    buyers: number
    revenue: number
    commission: number
    bank_name: string | null
    bank_account: string | null
    bank_holder: string | null
    paid_at: string | null
    paid_amount: number | null
    buyer_list: Array<{ name: string; amount: number }>
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
  const [buyers, affRes, attrRes, paidRes] = await Promise.all([
    loadBuyers(eventId),
    supabase.from('affiliates').select('id, handle, name, commission_rate, active, bank_name, bank_account, bank_holder'),
    supabase.from('affiliate_attributions').select('id, attendee_id, affiliate_id, source').eq('event_id', eventId),
    supabase.from('affiliate_payouts').select('affiliate_id, paid_at, amount').eq('event_id', eventId),
  ])
  if (affRes.error) throw new Error(affRes.error.message)
  if (attrRes.error) throw new Error(attrRes.error.message)

  const affiliates = (affRes.data ?? []).map(a => ({
    id: a.id as string,
    handle: a.handle as string,
    name: a.name as string | null,
    rate: Number(a.commission_rate ?? 0.10),
    active: a.active as boolean,
    bank_name: (a.bank_name as string | null) ?? null,
    bank_account: (a.bank_account as string | null) ?? null,
    bank_holder: (a.bank_holder as string | null) ?? null,
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

  // Paid status per affiliate for this event
  const paidByAff = new Map<string, { paid_at: string; amount: number }>()
  for (const p of paidRes.data ?? []) {
    paidByAff.set(p.affiliate_id as string, {
      paid_at: p.paid_at as string,
      amount: Number(p.amount),
    })
  }

  // Summary per affiliate (only active affiliates earn payouts)
  const sumMap = new Map<string, { revenue: number; buyers: number; list: Array<{ name: string; amount: number }> }>()
  for (const b of buyerRows) {
    if (!b.affiliate_id) continue
    const aff = affById.get(b.affiliate_id)
    if (!aff || !aff.active) continue
    const s = sumMap.get(b.affiliate_id) ?? { revenue: 0, buyers: 0, list: [] }
    s.revenue += b.total
    s.buyers += 1
    s.list.push({ name: b.name, amount: b.total })
    sumMap.set(b.affiliate_id, s)
  }

  const summary = [...sumMap.entries()].map(([id, s]) => {
    const aff = affById.get(id)!
    const paid = paidByAff.get(id)
    return {
      affiliate_id: id,
      handle: aff.handle,
      name: aff.name,
      buyers: s.buyers,
      revenue: s.revenue,
      commission: s.revenue * aff.rate,
      bank_name: aff.bank_name,
      bank_account: aff.bank_account,
      bank_holder: aff.bank_holder,
      paid_at: paid?.paid_at ?? null,
      paid_amount: paid?.amount ?? null,
      buyer_list: s.list.sort((a, b) => b.amount - a.amount),
    }
  }).sort((a, b) => {
    // Unpaid first, then by commission desc
    if ((a.paid_at == null) !== (b.paid_at == null)) return a.paid_at == null ? -1 : 1
    return b.commission - a.commission
  })

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

// ── Cosmetic leads-tag sync ───────────────────────────────────────────────────
// Reflects the affiliate sheet into the `leads` table TAG only. Money/attributions
// are NOT touched. First-tag-wins: only flips leads currently owner='kingsley' to
// owner='affiliate'; never reassigns or demotes an existing affiliate lead, and
// never touches inactive handles (e.g. kingsley1022). Idempotent.
export async function syncLeadTags(): Promise<number> {
  const [leadsFromSheet, affRes] = await Promise.all([
    fetchLeads(),
    supabase.from('affiliates').select('id, handle, active'),
  ])
  if (affRes.error) throw new Error(affRes.error.message)
  // diagnostic: surface sheet row count so a silent empty-fetch is visible
  if (!leadsFromSheet.length) throw new Error('fetchLeads returned 0 sheet rows (CSV fetch likely blocked server-side)')

  // active handle → affiliate id (inactive like kingsley1022 excluded)
  const handleToId = new Map<string, string>()
  for (const a of affRes.data ?? []) {
    if (a.active) handleToId.set(a.handle as string, a.id as string)
  }

  // sheet phone_norm → {handle, affiliate_id}, first occurrence wins
  const phoneToAff = new Map<string, { handle: string; id: string }>()
  for (const l of leadsFromSheet) {
    if (!l.phone) continue
    const id = handleToId.get((l.handle || '').trim().replace(/^\[/, ''))
    if (!id) continue // unknown / inactive handle
    if (!phoneToAff.has(l.phone)) phoneToAff.set(l.phone, { handle: (l.handle || '').trim().replace(/^\[/, ''), id })
  }
  if (!phoneToAff.size) return 0

  // Look up only the sheet phones among kingsley-owned leads. We query BY the
  // sheet phone list (~few hundred) instead of fetching all leads, sidestepping
  // PostgREST's hard 1000-row response cap. Chunk the `in` filter to stay safe.
  const sheetPhones = [...phoneToAff.keys()]
  const updates: Array<{ id: string; handle: string; affiliate_id: string }> = []
  for (let i = 0; i < sheetPhones.length; i += 200) {
    const chunk = sheetPhones.slice(i, i + 200)
    const { data: candidates, error: cErr } = await supabase
      .from('leads')
      .select('id, phone_norm')
      .eq('owner', 'kingsley')
      .in('phone_norm', chunk)
    if (cErr) throw new Error(cErr.message)
    for (const c of candidates ?? []) {
      const match = phoneToAff.get(c.phone_norm as string)
      if (match) updates.push({ id: c.id as string, handle: match.handle, affiliate_id: match.id })
    }
  }
  if (!updates.length) return 0

  // Apply per-row (Supabase has no bulk different-value update in one call).
  let flipped = 0
  for (const u of updates) {
    const { error } = await supabase
      .from('leads')
      .update({ owner: 'affiliate', affiliate_handle: u.handle, affiliate_id: u.affiliate_id })
      .eq('id', u.id)
      .eq('owner', 'kingsley') // guard: only flip if still kingsley (race-safe)
    if (!error) flipped++
  }
  return flipped
}

// ── Import NEW leads from the WhatsApp-joined sheet ───────────────────────────
// The `leads` table was a one-time seed (all rows created on the import day) with
// NO ongoing insert path — so new joiners never landed in it. This adds them,
// deduped by phone_norm. Owner is set from the sheet's affiliate handle (active
// affiliate → owner='affiliate', else 'kingsley'). Idempotent: existing phones are
// skipped, and the insert upserts with ignoreDuplicates on phone_norm as a race
// guard. Distinct from syncLeadTags, which only RE-TAGS rows that already exist.
interface SheetRow { name: string; phoneRaw: string; phoneNorm: string; handle: string }

async function fetchSheetRows(): Promise<SheetRow[]> {
  const res = await fetch(LEAD_SHEET_CSV, { cache: 'no-store' })
  if (!res.ok) throw new Error(`lead sheet fetch failed: ${res.status}`)
  const rows = parseCsv(await res.text())
  if (!rows.length) return []
  const header = rows[0].map(h => h.trim().toLowerCase())
  const iName = header.findIndex(h => h === 'name')
  const iPhone = header.findIndex(h => h.includes('phone'))
  const iAff = header.findIndex(h => h.includes('affiliate'))
  const out: SheetRow[] = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const phoneRaw = (row[iPhone] ?? '').trim()
    const phoneNorm = normPhone(phoneRaw)
    if (!phoneNorm) continue // need a phone to dedup on
    out.push({
      name: (row[iName] ?? '').trim(),
      phoneRaw,
      phoneNorm,
      handle: (row[iAff] ?? '').trim().replace(/^\[/, ''),
    })
  }
  return out
}

export async function importNewLeads(): Promise<{ sheetRows: number; alreadyPresent: number; inserted: number }> {
  const [sheet, affRes] = await Promise.all([
    fetchSheetRows(),
    supabase.from('affiliates').select('id, handle, active'),
  ])
  if (affRes.error) throw new Error(affRes.error.message)
  if (!sheet.length) throw new Error('lead sheet returned 0 rows (CSV fetch likely blocked server-side)')

  const activeHandle = new Map<string, string>()
  for (const a of affRes.data ?? []) if (a.active) activeHandle.set(String(a.handle).toLowerCase(), a.id as string)

  // Which sheet phones already exist? Query leads BY the sheet phones (chunked
  // in() — sidesteps PostgREST's hard 1000-row response cap).
  const phones = [...new Set(sheet.map(r => r.phoneNorm))]
  const present = new Set<string>()
  for (let i = 0; i < phones.length; i += 200) {
    const chunk = phones.slice(i, i + 200)
    const { data, error } = await supabase.from('leads').select('phone_norm').in('phone_norm', chunk)
    if (error) throw new Error(error.message)
    for (const r of data ?? []) present.add(r.phone_norm as string)
  }

  // Build inserts for phones not already present (dedup within the sheet too).
  const seen = new Set<string>()
  const toInsert = sheet
    .filter(r => {
      if (present.has(r.phoneNorm) || seen.has(r.phoneNorm)) return false
      seen.add(r.phoneNorm)
      return true
    })
    .map(r => {
      const affId = r.handle ? activeHandle.get(r.handle.toLowerCase()) : undefined
      const digits = r.phoneRaw.replace(/\D/g, '')
      return {
        name: r.name || null,
        phone: r.phoneRaw || null,
        phone_norm: r.phoneNorm,
        country_code: digits.startsWith('60') ? '60' : null,
        owner: affId ? 'affiliate' : 'kingsley',
        affiliate_handle: affId ? r.handle : null,
        affiliate_id: affId ?? null,
        sources: ['whatsapp_group'],
      }
    })

  if (!toInsert.length) return { sheetRows: sheet.length, alreadyPresent: present.size, inserted: 0 }

  let inserted = 0
  for (let i = 0; i < toInsert.length; i += 500) {
    const chunk = toInsert.slice(i, i + 500)
    const { data, error } = await supabase
      .from('leads')
      .upsert(chunk, { onConflict: 'phone_norm', ignoreDuplicates: true })
      .select('id')
    if (error) throw new Error(error.message)
    inserted += (data ?? []).length
  }
  return { sheetRows: sheet.length, alreadyPresent: present.size, inserted }
}
