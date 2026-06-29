import { supabaseAdmin, fetchAllRows } from '@/lib/supabase-admin'
import { fetchLeads, buildReport, type Lead, type PayoutReport } from '@/lib/affiliates'
import { scrapeAccountPosts, COMMUNITY_ACCOUNT } from '@/lib/instagram'

// Default backtest window: the program effectively started May 2026.
export const SINCE_DEFAULT = '2026-05-01T00:00:00Z'

export interface Settings { commission_rate: number; override_rate: number }

export interface ScorecardRow {
  ig_handle: string
  display_name: string | null
  // IG activity
  collab_posts: number
  reach: number
  engagement: number
  last_post_at: string | null
  // affiliate performance (null = not mapped to an affiliate yet)
  affiliate_id: string | null
  affiliate_handle: string | null
  leads: number | null
  seats: number | null
  revenue: number | null        // attributed buyer revenue
  commission: number | null     // = revenue × global commission_rate
  override: number | null       // = revenue × global override_rate (the team lead's cut)
  weekly_collabs: number[]      // collab posts per week, last 8 weeks (oldest→newest) — sparkline
}

// One time bucket (a week or a month) of team-wide performance, for the trend charts.
export interface TrendBucket {
  key: string                   // 'YYYY-MM-DD' (week's Monday) or 'YYYY-MM'
  label: string                 // 'D Mon' (week) or 'Mon' (month)
  posts: number
  collab_posts: number
  community_posts: number
  reach: number
  engagement: number
  active_creators: number
  leads: number
  seats: number
  revenue: number
  commission: number
}

export interface Trends {
  weekly: TrendBucket[]
  monthly: TrendBucket[]
}

// One event's ticket sales — links the dashboard to actual workshop/GLCC tickets.
export interface EventTicketRow {
  id: string
  name: string | null
  date: string | null
  capacity: number | null
  total_seats: number       // all paid tickets sold for the event
  attributed_seats: number  // tickets attributed to a creator/affiliate
  revenue: number           // total event revenue (attributed + unattributed)
}

// One auto-generated coaching insight for the creator lead.
export interface CoachInsight { icon: string; text: string; priority: number }

export interface Scorecard {
  rows: ScorecardRow[]
  settings: Settings
  trends: Trends
  events: EventTicketRow[]
  insights: CoachInsight[]
  unmapped_affiliates: Array<{ id: string; handle: string; name: string | null; leads: number; commission: number }>
  affiliates: Array<{ id: string; handle: string; name: string | null; ig_handle: string | null }>
  totals: {
    total_posts: number
    collab_posts: number
    community_posts: number
    reach: number
    engagement: number
    active_creators: number
    revenue: number
    commission: number
    override: number
    total_leads: number
  }
  range: { from: string; to: string }
  last_synced: string | null
}

interface IgPostRow {
  ig_post_id: string
  is_collab: boolean
  collab_creators: string[] | null
  owner_username: string | null
  posted_at: string | null
  likes: number
  comments: number
  views: number
  synced_at: string | null
}

const lc = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
const reachOf = (likes: number, views: number) => (views > 0 ? views : (likes > 0 ? likes * 10 : 0))

// ── Time bucketing (week = Monday-start, all UTC) ─────────────────────────────
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function mondayOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = x.getUTCDay()                 // 0=Sun..6=Sat
  x.setUTCDate(x.getUTCDate() + (day === 0 ? -6 : 1 - day))
  return x
}
function weekKey(iso: string): { key: string; label: string; sort: number } {
  const m = mondayOf(new Date(iso))
  return { key: m.toISOString().slice(0, 10), label: `${m.getUTCDate()} ${MON[m.getUTCMonth()]}`, sort: m.getTime() }
}
function monthKey(iso: string): { key: string; label: string; sort: number } {
  const d = new Date(iso)
  return { key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, label: MON[d.getUTCMonth()], sort: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) }
}
function lastNWeekKeys(n: number): string[] {
  const out: string[] = []
  const m = mondayOf(new Date())
  for (let i = 0; i < n; i++) { out.unshift(m.toISOString().slice(0, 10)); m.setUTCDate(m.getUTCDate() - 7) }
  return out
}

type EventReport = { id: string; name: string | null; date: string | null; capacity: number | null; report: PayoutReport }

// All events' payout reports + their meta — shared by the lifetime per-affiliate sum,
// the time-bucketed trends, AND the per-event ticket breakdown, so buildReport runs
// once per event (not three times).
async function loadEventReports(): Promise<EventReport[]> {
  const { data } = await supabaseAdmin.from('events').select('id, name, date, capacity')
  const events = (data ?? []) as Array<{ id: string; name: string | null; date: string | null; capacity: number | null }>
  const out = await Promise.all(events.map(async e => {
    const report = await buildReport(e.id).catch(() => null)
    return report ? { id: e.id, name: e.name, date: e.date, capacity: e.capacity, report } : null
  }))
  return out.filter(Boolean) as EventReport[]
}

type MutBucket = { sort: number; label: string; posts: number; collab_posts: number; community_posts: number; reach: number; engagement: number; creators: Set<string>; leads: number; seats: number; revenue: number; commission: number }

// Build week + month trend series across the FULL program window (independent of any
// table filter) so the charts can compare periods against each other.
function buildTrends(igPosts: IgPostRow[], leads: Lead[], eventReports: EventReport[], settings: Settings): Trends {
  const wk = new Map<string, MutBucket>()
  const mo = new Map<string, MutBucket>()
  const get = (map: Map<string, MutBucket>, k: { key: string; label: string; sort: number }): MutBucket => {
    let b = map.get(k.key)
    if (!b) { b = { sort: k.sort, label: k.label, posts: 0, collab_posts: 0, community_posts: 0, reach: 0, engagement: 0, creators: new Set(), leads: 0, seats: 0, revenue: 0, commission: 0 }; map.set(k.key, b) }
    return b
  }

  for (const p of igPosts) {
    if (!p.posted_at) continue
    const eng = (p.likes ?? 0) + (p.comments ?? 0)
    const reach = reachOf(p.likes ?? 0, p.views ?? 0)
    const creators = (p.collab_creators ?? []).map(lc).filter(Boolean)
    for (const [map, kf] of [[wk, weekKey], [mo, monthKey]] as const) {
      const b = get(map, kf(p.posted_at))
      b.posts++; b.reach += reach; b.engagement += eng
      if (p.is_collab && creators.length) { b.collab_posts++; for (const c of creators) b.creators.add(c) } else b.community_posts++
    }
  }
  for (const l of leads) {
    if (!l.date) continue
    for (const [map, kf] of [[wk, weekKey], [mo, monthKey]] as const) get(map, kf(l.date)).leads++
  }
  for (const { date, report } of eventReports) {
    if (!date) continue
    const seats = report.summary.reduce((a, s) => a + s.buyers, 0)
    const revenue = report.summary.reduce((a, s) => a + s.revenue, 0)
    for (const [map, kf] of [[wk, weekKey], [mo, monthKey]] as const) {
      const b = get(map, kf(date)); b.seats += seats; b.revenue += revenue; b.commission += Math.round(revenue * settings.commission_rate)
    }
  }

  const finalize = (map: Map<string, MutBucket>): TrendBucket[] =>
    [...map.entries()].sort((a, b) => a[1].sort - b[1].sort).map(([key, b]) => ({
      key, label: b.label, posts: b.posts, collab_posts: b.collab_posts, community_posts: b.community_posts,
      reach: b.reach, engagement: b.engagement, active_creators: b.creators.size,
      leads: b.leads, seats: b.seats, revenue: Math.round(b.revenue), commission: b.commission,
    }))
  return { weekly: finalize(wk), monthly: finalize(mo) }
}

// ── Global rate settings (single-row config) ──────────────────────────────────
export async function getCreatorSettings(): Promise<Settings> {
  const { data } = await supabaseAdmin.from('creator_settings').select('commission_rate, override_rate').eq('id', 1).maybeSingle()
  return { commission_rate: Number(data?.commission_rate ?? 0.10), override_rate: Number(data?.override_rate ?? 0.05) }
}

export async function setCreatorSettings(p: { commission_rate?: number; override_rate?: number }): Promise<void> {
  const clamp = (n: number) => Math.max(0, Math.min(1, Number(n) || 0))
  const patch: Record<string, number | string> = { updated_at: new Date().toISOString() }
  if (typeof p.commission_rate === 'number') patch.commission_rate = clamp(p.commission_rate)
  if (typeof p.override_rate === 'number') patch.override_rate = clamp(p.override_rate)
  const { error } = await supabaseAdmin.from('creator_settings').upsert({ id: 1, ...patch }, { onConflict: 'id' })
  if (error) throw new Error(error.message)
}

// ── Sync: scrape @claudemalaysiacommunity → upsert creator_ig_posts ───────────
export async function syncInstagram(sinceISO: string = SINCE_DEFAULT, limit = 300): Promise<{ scraped: number; collabs: number }> {
  const posts = await scrapeAccountPosts(COMMUNITY_ACCOUNT, sinceISO, limit)
  if (!posts.length) return { scraped: 0, collabs: 0 }
  const synced_at = new Date().toISOString()
  const rows = posts.map(p => ({ ...p, synced_at }))
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin
      .from('creator_ig_posts')
      .upsert(rows.slice(i, i + 500), { onConflict: 'ig_post_id' })
    if (error) throw new Error(error.message)
  }
  return { scraped: posts.length, collabs: posts.filter(p => p.is_collab).length }
}

// ── Auto coaching insights (deterministic) — prioritised actions for the lead ──
function buildCoachInsights(
  rows: ScorecardRow[],
  trends: Trends,
  events: EventTicketRow[],
  unmapped: Scorecard['unmapped_affiliates'],
  nowMs: number,
): CoachInsight[] {
  const out: CoachInsight[] = []
  const mapped = rows.filter(r => r.leads != null)                         // linked → leads are real
  const lpp = (r: ScorecardRow) => (r.collab_posts > 0 ? (r.leads ?? 0) / r.collab_posts : 0)

  // Momentum: latest finished week vs the one before (exclude the in-progress week).
  const wk = trends.weekly
  if (wk.length >= 2) {
    const curMonday = mondayOf(new Date(nowMs)).toISOString().slice(0, 10)
    const complete = wk[wk.length - 1].key === curMonday ? wk.slice(0, -1) : wk
    const cur = complete[complete.length - 1], prv = complete[complete.length - 2]
    if (cur && prv) {
      const d = prv.collab_posts > 0 ? Math.round(((cur.collab_posts - prv.collab_posts) / prv.collab_posts) * 100) : (cur.collab_posts > 0 ? 100 : 0)
      if (cur.collab_posts < prv.collab_posts) out.push({ priority: 1, icon: '📉', text: `Team posts fell ${Math.abs(d)}% this week (${prv.collab_posts}→${cur.collab_posts}). Set a floor — 15 collab posts/creator/week — and DM anyone below it today.` })
      else if (d > 0) out.push({ priority: 4, icon: '📈', text: `Posts up ${d}% this week — momentum's real. Publicly credit the top posters so they keep the cadence.` })
    }
  }
  // Biggest leak: heavy poster converting poorly → fix their CTA.
  const heavy = mapped.filter(r => r.collab_posts >= 10).sort((a, b) => lpp(a) - lpp(b))[0]
  if (heavy && lpp(heavy) < 0.5) out.push({ priority: 2, icon: '🔧', text: `@${heavy.ig_handle} posted ${heavy.collab_posts} collabs but only ${heavy.leads} leads — the CTA isn't landing. Rewrite their hook + ManyChat link this week.` })
  // Event to fill.
  const upcoming = events.filter(e => e.date && new Date(e.date).getTime() >= nowMs)
  const target = [...upcoming].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')).find(e => { const c = e.capacity ?? 0; return c > 0 ? e.total_seats / c < 0.6 : e.total_seats < 5 })
  if (target) { const c = target.capacity ?? 0; const fill = c > 0 ? `${Math.round(target.total_seats / c * 100)}% full (${target.total_seats}/${c})` : `${target.total_seats} sold`; const dd = Math.max(0, Math.ceil((new Date(target.date!).getTime() - nowMs) / 86400000)); out.push({ priority: 3, icon: '💰', text: `${target.name?.trim()} is ${fill}, ${dd} days out. Aim every creator's next 3 posts at it to convert seats.` }) }
  // Clone the winner.
  const winner = [...mapped].sort((a, b) => (b.leads ?? 0) - (a.leads ?? 0))[0]
  if (winner && (winner.leads ?? 0) > 0) out.push({ priority: 5, icon: '🏆', text: `@${winner.ig_handle} drove ${winner.leads} leads from ${winner.collab_posts} posts (${lpp(winner).toFixed(1)}/post). Make their format the template for everyone.` })
  // Hidden gem: high conversion, low volume.
  const gem = mapped.filter(r => (r.leads ?? 0) >= 3 && r.collab_posts > 0 && r.collab_posts <= 5).sort((a, b) => lpp(b) - lpp(a))[0]
  if (gem) out.push({ priority: 6, icon: '⚡', text: `@${gem.ig_handle} converts at ${lpp(gem).toFixed(1)} leads/post but only posted ${gem.collab_posts}. Highest-ROI lever you have — get them posting 3× more.` })
  // Attribution leak.
  const ul = unmapped.reduce((a, x) => a + x.leads, 0)
  if (ul >= 10) out.push({ priority: 7, icon: '🔗', text: `${ul} leads came from affiliates with no IG creator linked — map them so the right creator gets credit + commission.` })

  return out.sort((a, b) => a.priority - b.priority)
}

// ── Build the unified Creator Scorecard for a date range ──────────────────────
export async function buildScorecard(fromISO: string = SINCE_DEFAULT, toISO?: string): Promise<Scorecard> {
  const fullTo = new Date().toISOString()
  const to = toISO ?? fullTo

  // Fetch the FULL program window once; the trends use all of it, the table filters in-memory.
  const [{ rows: igPostsFull }, affRes, eventReports, settings, leads] = await Promise.all([
    fetchAllRows<IgPostRow>((from, t) =>
      supabaseAdmin
        .from('creator_ig_posts')
        .select('ig_post_id, is_collab, collab_creators, owner_username, posted_at, likes, comments, views, synced_at')
        .gte('posted_at', SINCE_DEFAULT)
        .lte('posted_at', fullTo)
        .order('posted_at', { ascending: false })
        .range(from, t),
    ),
    supabaseAdmin.from('affiliates').select('id, handle, name, ig_handle, active'),
    loadEventReports(),
    getCreatorSettings(),
    fetchLeads().catch(() => [] as Lead[]),  // lead sheet fetch can fail server-side; degrade to no leads
  ])

  const affs = (affRes.data ?? []) as Array<{ id: string; handle: string; name: string | null; ig_handle: string | null; active: boolean }>

  // A "bounded" window (7d / 30d / a specific month) scopes leads + seats + revenue
  // by date too, not just posts — so the leaderboard is internally consistent.
  // The default "All" view (from = SINCE_DEFAULT, no `to`) stays lifetime.
  const fromMs = new Date(fromISO).getTime(), toMs = new Date(to).getTime()
  const bounded = !!toISO || fromISO !== SINCE_DEFAULT
  const inWindow = (iso: string | null) => { if (!iso) return false; const ms = new Date(iso).getTime(); return ms >= fromMs && ms <= toMs }

  const igPosts = igPostsFull.filter(p => inWindow(p.posted_at))

  // Attributed revenue + seats per affiliate (reuses the tested per-event buildReport
  // so buyer de-duping matches the Payout tab); in a bounded window only count events
  // whose date falls inside it.
  const revByAff = new Map<string, number>()
  const seatsByAff = new Map<string, number>()
  for (const { date, report } of eventReports) {
    if (bounded && !inWindow(date)) continue
    for (const s of report.summary) {
      revByAff.set(s.affiliate_id, (revByAff.get(s.affiliate_id) ?? 0) + s.revenue)
      seatsByAff.set(s.affiliate_id, (seatsByAff.get(s.affiliate_id) ?? 0) + s.buyers)
    }
  }

  const leadsByHandle = new Map<string, number>()
  for (const l of leads) {
    const h = lc(l.handle); if (!h) continue
    if (bounded && !inWindow(l.date)) continue
    leadsByHandle.set(h, (leadsByHandle.get(h) ?? 0) + 1)
  }

  // IG-side aggregates: explode collab_creators so each co-author gets credit
  type Agg = { collab_posts: number; reach: number; engagement: number; last: string | null }
  const igByCreator = new Map<string, Agg>()
  let totalPosts = 0, collabPosts = 0, communityPosts = 0, totReach = 0, totEng = 0
  for (const p of igPosts) {
    totalPosts++
    const eng = (p.likes ?? 0) + (p.comments ?? 0)
    const reach = reachOf(p.likes ?? 0, p.views ?? 0)
    totEng += eng; totReach += reach
    const creators = (p.collab_creators ?? []).map(lc).filter(Boolean)
    if (p.is_collab && creators.length) {
      collabPosts++
      for (const c of creators) {
        const a = igByCreator.get(c) ?? { collab_posts: 0, reach: 0, engagement: 0, last: null }
        a.collab_posts++; a.reach += reach; a.engagement += eng
        if (p.posted_at && (!a.last || p.posted_at > a.last)) a.last = p.posted_at
        igByCreator.set(c, a)
      }
    } else {
      communityPosts++
    }
  }

  // Per-creator collab-posts-per-week (last 8 weeks, full range) → sparkline.
  const weekKeys8 = lastNWeekKeys(8)
  const sparkByCreator = new Map<string, Map<string, number>>()
  for (const p of igPostsFull) {
    if (!p.is_collab || !p.posted_at) continue
    const wk = weekKey(p.posted_at).key
    for (const c of (p.collab_creators ?? []).map(lc).filter(Boolean)) {
      let m = sparkByCreator.get(c); if (!m) { m = new Map(); sparkByCreator.set(c, m) }
      m.set(wk, (m.get(wk) ?? 0) + 1)
    }
  }

  const affByIg = new Map<string, typeof affs[number]>()
  for (const a of affs) if (a.ig_handle) affByIg.set(lc(a.ig_handle), a)

  const rows: ScorecardRow[] = []
  const mappedAffIds = new Set<string>()
  let totRevenue = 0, totCommission = 0, totOverride = 0
  for (const [ig, agg] of igByCreator) {
    const aff = affByIg.get(ig) ?? null
    if (aff) mappedAffIds.add(aff.id)
    const revenue = aff ? Math.round(revByAff.get(aff.id) ?? 0) : null
    const commission = revenue != null ? Math.round(revenue * settings.commission_rate) : null
    const override = revenue != null ? Math.round(revenue * settings.override_rate) : null
    if (revenue != null) { totRevenue += revenue; totCommission += commission ?? 0; totOverride += override ?? 0 }
    rows.push({
      ig_handle: ig,
      display_name: aff?.name ?? null,
      collab_posts: agg.collab_posts,
      reach: agg.reach,
      engagement: agg.engagement,
      last_post_at: agg.last,
      affiliate_id: aff?.id ?? null,
      affiliate_handle: aff?.handle ?? null,
      leads: aff ? (leadsByHandle.get(lc(aff.handle)) ?? 0) : null,
      seats: aff ? (seatsByAff.get(aff.id) ?? 0) : null,
      revenue,
      commission,
      override,
      weekly_collabs: weekKeys8.map(k => sparkByCreator.get(ig)?.get(k) ?? 0),
    })
  }
  rows.sort((a, b) => b.collab_posts - a.collab_posts || b.reach - a.reach)

  const unmapped_affiliates = affs
    .filter(a => !mappedAffIds.has(a.id) && ((revByAff.get(a.id) ?? 0) > 0 || (leadsByHandle.get(lc(a.handle)) ?? 0) > 0))
    .map(a => ({ id: a.id, handle: a.handle, name: a.name, leads: leadsByHandle.get(lc(a.handle)) ?? 0, commission: Math.round((revByAff.get(a.id) ?? 0) * settings.commission_rate) }))
    .sort((x, y) => y.commission - x.commission)

  const last_synced = igPostsFull.reduce<string | null>((m, p) => (p.synced_at && (!m || p.synced_at > m) ? p.synced_at : m), null)

  // Per-event ticket sales (chronological) — the bridge to "tickets we're selling".
  const events: EventTicketRow[] = eventReports
    .map(({ id, name, date, capacity, report }) => ({
      id, name, date, capacity,
      total_seats: report.buyers.length,
      attributed_seats: report.summary.reduce((a, s) => a + s.buyers, 0),
      revenue: Math.round((report.totals?.attributed_revenue ?? 0) + (report.totals?.unattributed_revenue ?? 0)),
    }))
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))

  const trends = buildTrends(igPostsFull, leads, eventReports, settings)

  return {
    rows,
    settings,
    trends,
    events,
    insights: buildCoachInsights(rows, trends, events, unmapped_affiliates, Date.now()),
    unmapped_affiliates,
    affiliates: affs.map(a => ({ id: a.id, handle: a.handle, name: a.name, ig_handle: a.ig_handle })),
    totals: { total_posts: totalPosts, collab_posts: collabPosts, community_posts: communityPosts, reach: totReach, engagement: totEng, active_creators: igByCreator.size, revenue: totRevenue, commission: totCommission, override: totOverride, total_leads: [...leadsByHandle.values()].reduce((a, b) => a + b, 0) },
    range: { from: fromISO, to },
    last_synced,
  }
}

// ── Map an IG handle to an affiliate (the bridge for the unified view) ─────────
export async function setIgHandle(affiliateId: string, igHandle: string | null): Promise<void> {
  const { error } = await supabaseAdmin
    .from('affiliates')
    .update({ ig_handle: igHandle ? lc(igHandle).replace(/^@/, '') : null })
    .eq('id', affiliateId)
  if (error) throw new Error(error.message)
}
