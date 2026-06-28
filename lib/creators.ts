import { supabaseAdmin, fetchAllRows } from '@/lib/supabase-admin'
import { fetchLeads, buildReport } from '@/lib/affiliates'
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
}

export interface Scorecard {
  rows: ScorecardRow[]
  settings: Settings
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

// ── Build the unified Creator Scorecard for a date range ──────────────────────
export async function buildScorecard(fromISO: string = SINCE_DEFAULT, toISO?: string): Promise<Scorecard> {
  const to = toISO ?? new Date().toISOString()

  const [{ rows: igPosts }, affRes, eventsRes, settings] = await Promise.all([
    fetchAllRows<IgPostRow>((from, t) =>
      supabaseAdmin
        .from('creator_ig_posts')
        .select('ig_post_id, is_collab, collab_creators, owner_username, posted_at, likes, comments, views, synced_at')
        .gte('posted_at', fromISO)
        .lte('posted_at', to)
        .order('posted_at', { ascending: false })
        .range(from, t),
    ),
    supabaseAdmin.from('affiliates').select('id, handle, name, ig_handle, active'),
    supabaseAdmin.from('events').select('id'),
    getCreatorSettings(),
  ])

  const affs = (affRes.data ?? []) as Array<{ id: string; handle: string; name: string | null; ig_handle: string | null; active: boolean }>

  // Attributed revenue + seats per affiliate, summed across all events (reuses the
  // tested per-event buildReport so buyer de-duping matches the Payout tab exactly).
  const events = (eventsRes.data ?? []) as Array<{ id: string }>
  const reports = await Promise.all(events.map(e => buildReport(e.id).then(r => r).catch(() => null)))
  const revByAff = new Map<string, number>()
  const seatsByAff = new Map<string, number>()
  for (const r of reports) {
    if (!r) continue
    for (const s of r.summary) {
      revByAff.set(s.affiliate_id, (revByAff.get(s.affiliate_id) ?? 0) + s.revenue)
      seatsByAff.set(s.affiliate_id, (seatsByAff.get(s.affiliate_id) ?? 0) + s.buyers)
    }
  }

  const leadsByHandle = new Map<string, number>()
  try {
    const leads = await fetchLeads()
    for (const l of leads) { const h = lc(l.handle); if (h) leadsByHandle.set(h, (leadsByHandle.get(h) ?? 0) + 1) }
  } catch { /* lead sheet fetch can fail server-side; degrade to no leads */ }

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
    })
  }
  rows.sort((a, b) => b.collab_posts - a.collab_posts || b.reach - a.reach)

  const unmapped_affiliates = affs
    .filter(a => !mappedAffIds.has(a.id) && ((revByAff.get(a.id) ?? 0) > 0 || (leadsByHandle.get(lc(a.handle)) ?? 0) > 0))
    .map(a => ({ id: a.id, handle: a.handle, name: a.name, leads: leadsByHandle.get(lc(a.handle)) ?? 0, commission: Math.round((revByAff.get(a.id) ?? 0) * settings.commission_rate) }))
    .sort((x, y) => y.commission - x.commission)

  const last_synced = igPosts.reduce<string | null>((m, p) => (p.synced_at && (!m || p.synced_at > m) ? p.synced_at : m), null)

  return {
    rows,
    settings,
    unmapped_affiliates,
    affiliates: affs.map(a => ({ id: a.id, handle: a.handle, name: a.name, ig_handle: a.ig_handle })),
    totals: { total_posts: totalPosts, collab_posts: collabPosts, community_posts: communityPosts, reach: totReach, engagement: totEng, active_creators: igByCreator.size, revenue: totRevenue, commission: totCommission, override: totOverride },
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
