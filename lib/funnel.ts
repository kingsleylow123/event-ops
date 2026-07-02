// Funnel Command Center — whole-business ToFu→MoFu→BoFu aggregation + the
// theory-of-constraints weakest-link finder. Server-only (supabaseAdmin).
//
// Honest modelling note: the `leads` table is the affiliate/community top of
// funnel; most paid seats are core-team/organic, NOT from those leads. So the
// Lead→seat conversion is computed as the AFFILIATE-ATTRIBUTED rate (leads that
// became buyers, matched by phone/email — same logic as the affiliate back-test),
// never total-seats/total-leads (which would wildly overstate it). Each arrow is
// labelled with exactly what it measures.

import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { fetchLeads } from '@/lib/affiliates'
import { normPhone, normEmail } from '@/lib/format'
import type { Event } from '@/lib/supabase'

const DAY_MS = 86400000

// ── Event classification ─────────────────────────────────────────────────────
export function isGlccEvent(name: string | null | undefined): boolean {
  return /glcc|go\s*live/i.test(name || '')
}
function isWebinar(e: Pick<Event, 'format'>): boolean {
  return (e.format || 'workshop') === 'webinar'
}

// ── Types ────────────────────────────────────────────────────────────────────
export type StageKey = 'leads' | 'workshop' | 'glcc' | 'deals'

export interface FunnelStage {
  key: StageKey
  label: string
  price: string            // value-ladder rung price
  count: number            // headline volume at this stage
  revenue: number          // RM realized at this stage
  /** conversion FROM the previous stage, as a % (null for the first stage) */
  convFromPct: number | null
  /** what the convFromPct arrow actually measures (honest label) */
  convNote: string | null
  sub: { label: string; value: string }[]
}

export interface WeakLink {
  fromKey: StageKey
  toKey: StageKey
  label: string            // "1-day seat → 2-day class"
  convPct: number
  benchmarkPct: number
  upsideRM: number         // RM unlocked if lifted to benchmark
  fixes: string[]
}

export interface EventReadiness {
  id: string
  name: string
  date: string | null
  type: '1-day' | '2-day' | 'webinar'
  capacity: number | null
  paid: number
  registered: number
  revenue: number
  fillPct: number | null
  daysToGo: number | null  // negative = past
  selloutInDays: number | null // projected days to sell out at current pace (null = stalled / n/a)
  health: 'green' | 'amber' | 'red' | 'past'
}

export interface FunnelReport {
  scope: { from: string; to: string; eventId: string | null; eventName: string | null }
  generatedAt: string
  stages: FunnelStage[]
  weakLink: WeakLink | null
  runnerUp: WeakLink | null
  attribution: { attributedRevenue: number; totalRevenue: number; affiliatePct: number; gapPct: number }
  totals: {
    leads: number
    leadsAffiliate: number
    leadsKingsley: number
    workshopPaid: number
    glccPaid: number
    dealsWon: number
    grossRevenue: number
  }
  events: EventReadiness[]   // for the calendar / readiness timeline
  strengths: string[]
  risks: string[]
}

// ── Benchmarks + fix playbook (the constraint engine's constants) ─────────────
const BENCHMARK: Record<string, number> = {
  'leads>workshop': 4,    // % of community leads that buy a seat (target)
  'workshop>glcc': 25,    // % of 1-day attendees who upgrade to the 2-day class
  'glcc>deals': 30,       // % of 2-day attendees who become a won B2B deal
}
const VALUE_OUT: Record<string, number> = {
  'leads>workshop': 450,  // avg blended 1-day ticket
  'workshop>glcc': 2299,  // the 2-day class
  'glcc>deals': 2299,     // conservative deal floor
}
const FIXES: Record<string, string[]> = {
  'leads>workshop': [
    'Qualify leads to ICP (RM1–5M founders), not students',
    'Sharpen the offer / add a guarantee',
    'Add a deadline + urgency to the seat',
  ],
  'workshop>glcc': [
    'Closer follow-up inside the 3–4 week upgrade window',
    'Call hand-raisers within 24h of Day 1',
    'Offer a deposit-to-hold on the RM2,299 class',
  ],
  'glcc>deals': [
    'Book the implementation call in the room',
    'Shorten the cycle; gate closer comp on speed',
    'Tighten the BoFu pipeline follow-up',
  ],
}

const round1 = (n: number) => Math.round(n * 10) / 10

// ── Main builder ─────────────────────────────────────────────────────────────
export async function buildFunnel(opts: { from?: string; to?: string; eventId?: string } = {}): Promise<FunnelReport> {
  const now = Date.now()
  const from = opts.from || '2026-05-01'
  const to = opts.to || new Date(now + 120 * DAY_MS).toISOString().slice(0, 10)
  const eventId = opts.eventId || null

  // Events in the window (by date), plus any explicitly requested event.
  const { data: evRows } = await supabase
    .from('events')
    .select('id, name, date, capacity, format, hand_raisers')
    .order('date', { ascending: true })
  const allEvents = (evRows ?? []) as Array<Pick<Event, 'id' | 'name' | 'date' | 'capacity' | 'format'> & { hand_raisers: number | null }>
  const inWindow = allEvents.filter(e => {
    if (eventId) return e.id === eventId
    if (!e.date) return false
    const d = e.date.slice(0, 10)
    return d >= from && d <= to
  })
  const eventName = eventId ? (inWindow[0]?.name ?? null) : null
  const eventIds = inWindow.map(e => e.id)

  // Attendees for those events (single query).
  let attendees: Array<{ event_id: string; name: string | null; phone: string | null; email: string | null; payment_status: string; payment_amount: number; attendance_confirmed: boolean; is_facilitator: boolean; created_at: string }> = []
  if (eventIds.length) {
    const { data: attRows } = await supabase
      .from('attendees')
      .select('event_id, name, phone, email, payment_status, payment_amount, attendance_confirmed, is_facilitator, created_at')
      .in('event_id', eventIds)
    attendees = (attRows ?? []).filter(a => !a.is_facilitator) as typeof attendees
  }

  const workshopIds = new Set(inWindow.filter(e => !isGlccEvent(e.name) && !isWebinar(e)).map(e => e.id))
  const glccIds = new Set(inWindow.filter(e => isGlccEvent(e.name)).map(e => e.id))

  const workshopAtt = attendees.filter(a => workshopIds.has(a.event_id))
  const glccAtt = attendees.filter(a => glccIds.has(a.event_id))
  const paidOf = (rows: typeof attendees) => rows.filter(a => a.payment_status === 'paid')
  const sumRev = (rows: typeof attendees) => rows.reduce((s, a) => s + (Number(a.payment_amount) || 0), 0)

  const workshopPaid = paidOf(workshopAtt)
  const glccPaid = paidOf(glccAtt)
  // Upgrade-conversion denominator: only workshops that have already happened.
  // A buyer of a future workshop can't have upgraded to the 2-day class yet, so
  // counting them deflates the conversion and inflates the weak-link upside.
  // Display counts/revenue and the readiness calendar still include future events.
  const todayStr = new Date(now).toISOString().slice(0, 10)
  const pastWorkshopIds = new Set(
    inWindow.filter(e => workshopIds.has(e.id) && e.date && e.date.slice(0, 10) <= todayStr).map(e => e.id),
  )
  const workshopPaidPast = workshopPaid.filter(a => pastWorkshopIds.has(a.event_id))
  const workshopRevenue = sumRev(workshopPaid)
  const glccRevenue = sumRev(glccPaid)
  const grossRevenue = sumRev(paidOf(attendees))

  // ToFu — the captured lead base (leads table; no event FK → whole-business).
  let leadsTotal = 0, leadsAffiliate = 0, leadsKingsley = 0
  const leadPhones = new Set<string>()
  {
    const { data: leadRows } = await supabase.from('leads').select('owner, phone_norm')
    const rows = leadRows ?? []
    leadsTotal = rows.length
    leadsAffiliate = rows.filter(r => r.owner === 'affiliate').length
    leadsKingsley = rows.filter(r => r.owner === 'kingsley').length
    for (const r of rows) if (r.phone_norm) leadPhones.add(r.phone_norm as string)
  }

  // Dedupe paid buyers by identity (phone preferred, else email), summing spend.
  const buyerInfo = new Map<string, { ph: string; em: string; rev: number }>()
  for (const a of paidOf(attendees)) {
    const ph = normPhone(a.phone), em = normEmail(a.email)
    const key = ph || em
    if (!key) continue
    const cur = buyerInfo.get(key) || { ph, em, rev: 0 }
    cur.rev += Number(a.payment_amount) || 0
    if (ph) cur.ph = ph
    if (em) cur.em = em
    buyerInfo.set(key, cur)
  }

  // Lead→buyer conversion: paid buyers whose phone is in the lead base. Same
  // population in numerator + denominator (no sheet-vs-table mismatch).
  let convertedFromLeads = 0
  for (const b of buyerInfo.values()) if (b.ph && leadPhones.has(b.ph)) convertedFromLeads++

  // Affiliate revenue SHARE — separately match the affiliate sheet to buyers.
  let attributedRevenue = 0
  try {
    const sheet = await fetchLeads()
    const sp = new Set(sheet.map(l => l.phone).filter(Boolean))
    const se = new Set(sheet.map(l => l.email).filter(Boolean))
    for (const b of buyerInfo.values()) {
      if ((b.ph && sp.has(b.ph)) || (b.em && se.has(b.em))) attributedRevenue += b.rev
    }
  } catch { /* sheet fetch optional — degrade to 0, surfaced as the attribution gap */ }

  const dealsWon = await countDealsWon(eventIds)

  // ── Conversions (honest) ────────────────────────────────────────────────────
  const leadToSeatPct = leadsTotal > 0 ? round1((convertedFromLeads / leadsTotal) * 100) : null
  const workshopToGlccPct = workshopPaidPast.length > 0 ? round1((glccPaid.length / workshopPaidPast.length) * 100) : null
  const glccToDealPct = glccPaid.length > 0 ? round1((dealsWon / glccPaid.length) * 100) : null

  const stages: FunnelStage[] = [
    {
      key: 'leads', label: 'Community / Leads', price: 'FREE',
      count: leadsTotal, revenue: 0, convFromPct: null, convNote: null,
      sub: [
        { label: 'Affiliate-driven', value: String(leadsAffiliate) },
        { label: 'Direct (Kingsley)', value: String(leadsKingsley) },
      ],
    },
    {
      key: 'workshop', label: '1-Day Workshop', price: 'RM300 / RM550 VIP',
      count: workshopPaid.length, revenue: workshopRevenue,
      convFromPct: leadToSeatPct, convNote: 'of captured leads become paying buyers',
      sub: [
        { label: 'Registered', value: String(workshopAtt.length) },
        { label: 'Attended', value: String(workshopAtt.filter(a => a.attendance_confirmed).length) },
      ],
    },
    {
      key: 'glcc', label: '2-Day GLCC Class', price: 'RM2,299',
      count: glccPaid.length, revenue: glccRevenue,
      convFromPct: workshopToGlccPct, convNote: 'of 1-day buyers (past workshops) upgrade to the 2-day class',
      sub: [
        { label: 'Registered', value: String(glccAtt.length) },
      ],
    },
    {
      key: 'deals', label: 'B2B Implementation', price: 'High-ticket',
      count: dealsWon, revenue: 0,
      convFromPct: glccToDealPct, convNote: 'of 2-day attendees become a won deal',
      sub: [],
    },
  ]

  // ── Theory of constraints: rank transitions by RM unlocked if fixed ──────────
  const transitions: Array<{ fromKey: StageKey; toKey: StageKey; label: string; actual: number | null; volumeIn: number }> = [
    { fromKey: 'leads', toKey: 'workshop', label: 'Lead → 1-day seat', actual: leadToSeatPct, volumeIn: leadsTotal },
    { fromKey: 'workshop', toKey: 'glcc', label: '1-day seat → 2-day class', actual: workshopToGlccPct, volumeIn: workshopPaidPast.length },
    { fromKey: 'glcc', toKey: 'deals', label: '2-day → B2B deal', actual: glccToDealPct, volumeIn: glccPaid.length },
  ]
  const scored = transitions
    .filter(t => t.actual != null)
    .map(t => {
      const bkey = `${t.fromKey}>${t.toKey}`
      const benchmark = BENCHMARK[bkey]
      const gap = Math.max(0, benchmark - (t.actual as number))
      const upsideRM = Math.round((gap / 100) * t.volumeIn * (VALUE_OUT[bkey] || 0))
      return {
        fromKey: t.fromKey, toKey: t.toKey, label: t.label,
        convPct: t.actual as number, benchmarkPct: benchmark, upsideRM, fixes: FIXES[bkey] || [],
      } as WeakLink
    })
    .sort((a, b) => b.upsideRM - a.upsideRM)

  const weakLink = scored[0] ?? null
  const runnerUp = scored[1] ?? null

  // ── Strengths / risks ────────────────────────────────────────────────────────
  const affiliatePct = grossRevenue > 0 ? round1((attributedRevenue / grossRevenue) * 100) : 0
  const strengths: string[] = []
  const risks: string[] = []
  if (grossRevenue > 40000) strengths.push(`Strong run-rate: RM${Math.round(grossRevenue).toLocaleString('en-MY')} in window`)
  if (leadsTotal > 200) strengths.push(`Healthy lead engine: ${leadsTotal} leads`)
  if (glccPaid.length > 0) strengths.push(`Premium 2-day class converting (RM2,299)`)
  if (affiliatePct < 20 && grossRevenue > 0) risks.push(`Affiliates only ${affiliatePct}% of revenue — channel underused`)
  if (leadToSeatPct != null && leadToSeatPct < 4) risks.push(`Lead→seat conversion ${leadToSeatPct}% (below 4% target)`)

  // ── Per-event readiness (calendar) ───────────────────────────────────────────
  const events: EventReadiness[] = inWindow.map(e => {
    const evAtt = attendees.filter(a => a.event_id === e.id)
    const evPaid = evAtt.filter(a => a.payment_status === 'paid')
    const type: EventReadiness['type'] = isGlccEvent(e.name) ? '2-day' : isWebinar(e) ? 'webinar' : '1-day'
    const cap = e.capacity ?? null
    const fillPct = cap && cap > 0 ? round1((evPaid.length / cap) * 100) : null
    const eventTime = e.date ? new Date(e.date).getTime() : null
    const daysToGo = eventTime != null ? Math.round((eventTime - now) / DAY_MS) : null
    // Sell-out projection: pace = paid / days since earliest paid signup.
    let selloutInDays: number | null = null
    if (cap && cap > 0 && daysToGo != null && daysToGo >= 1 && evPaid.length > 0 && evPaid.length < cap) {
      const firstPaid = Math.min(...evPaid.map(a => new Date(a.created_at).getTime()))
      const daysSelling = Math.max(1, (now - firstPaid) / DAY_MS)
      const rate = evPaid.length / daysSelling
      if (rate > 0) selloutInDays = Math.ceil((cap - evPaid.length) / rate)
    }
    let health: EventReadiness['health'] = 'amber'
    if (daysToGo != null && daysToGo < 0) health = 'past'
    else if (fillPct != null && fillPct >= 80) health = 'green'
    else if (fillPct != null && fillPct < 40) health = 'red'
    return {
      id: e.id, name: e.name, date: e.date, type, capacity: cap,
      paid: evPaid.length, registered: evAtt.length, revenue: sumRev(evPaid),
      fillPct, daysToGo, selloutInDays, health,
    }
  })

  return {
    scope: { from, to, eventId, eventName },
    generatedAt: new Date(now).toISOString(),
    stages,
    weakLink,
    runnerUp,
    attribution: {
      attributedRevenue: Math.round(attributedRevenue),
      totalRevenue: Math.round(grossRevenue),
      affiliatePct,
      gapPct: round1(100 - affiliatePct),
    },
    totals: {
      leads: leadsTotal, leadsAffiliate, leadsKingsley,
      workshopPaid: workshopPaid.length, glccPaid: glccPaid.length,
      dealsWon, grossRevenue: Math.round(grossRevenue),
    },
    events,
    strengths,
    risks,
  }
}

// deal_leads won count, scoped to the window's events when known, else all.
async function countDealsWon(eventIds: string[]): Promise<number> {
  let q = supabase.from('deal_leads').select('id', { count: 'exact', head: true }).eq('status', 'won')
  if (eventIds.length) q = q.in('event_id', eventIds)
  const { count } = await q
  return count ?? 0
}

// Compact one-line summary for Telegram / the daily ping.
export function weakLinkLine(r: FunnelReport): string {
  if (!r.weakLink) return 'Funnel: not enough data yet to find the constraint.'
  const w = r.weakLink
  return `Weakest link: ${w.label} at ${w.convPct}% (target ${w.benchmarkPct}%) — ~RM${w.upsideRM.toLocaleString('en-MY')} upside if fixed.`
}
