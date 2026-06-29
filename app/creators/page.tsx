'use client'
import { useEffect, useState, useCallback } from 'react'
import { peekCache, mutateCache } from '@/lib/useCachedFetch'
import { useRevenueHidden } from '@/lib/useRevenueHidden'
import { ComboBarLine, AreaLineChart, CashflowChart, Sparkline } from '@/components/finance/Charts'

interface Row {
  ig_handle: string
  display_name: string | null
  collab_posts: number
  reach: number
  engagement: number
  last_post_at: string | null
  affiliate_id: string | null
  affiliate_handle: string | null
  leads: number | null
  seats: number | null
  revenue: number | null
  commission: number | null
  override: number | null
  weekly_collabs: number[]
}
interface TrendBucket {
  key: string; label: string
  posts: number; collab_posts: number; community_posts: number
  reach: number; engagement: number; active_creators: number
  leads: number; seats: number; revenue: number; commission: number
}
interface Report {
  rows: Row[]
  settings: { commission_rate: number; override_rate: number }
  trends: { weekly: TrendBucket[]; monthly: TrendBucket[] }
  unmapped_affiliates: Array<{ id: string; handle: string; name: string | null; leads: number; commission: number }>
  affiliates: Array<{ id: string; handle: string; name: string | null; ig_handle: string | null }>
  totals: { total_posts: number; collab_posts: number; community_posts: number; reach: number; engagement: number; active_creators: number; revenue: number; commission: number; override: number; total_leads: number }
  range: { from: string; to: string }
  last_synced: string | null
}

const rm = (n: number) => `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
const num = (n: number) => n.toLocaleString('en-MY')
const SINCE = '2026-05-01T00:00:00Z'

const MONTHS: Record<string, { from: string; to?: string; label: string }> = {
  all: { from: SINCE, label: 'May–Now' },
  may: { from: '2026-05-01T00:00:00Z', to: '2026-06-01T00:00:00Z', label: 'May' },
  jun: { from: '2026-06-01T00:00:00Z', to: '2026-07-01T00:00:00Z', label: 'June' },
  jul: { from: '2026-07-01T00:00:00Z', to: '2026-08-01T00:00:00Z', label: 'July' },
}

type SortKey = 'collab_posts' | 'reach' | 'engagement' | 'leads' | 'seats' | 'revenue' | 'commission' | 'override'

export default function CreatorsPage() {
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState<keyof typeof MONTHS>('all')
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('collab_posts')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)
  const [gran, setGran] = useState<'week' | 'month'>('week')
  const [commPct, setCommPct] = useState(10)
  const [ovrPct, setOvrPct] = useState(5)
  const [revenueHidden] = useRevenueHidden()
  const money = (n: number | null) => n == null ? '—' : revenueHidden ? 'RM ••••' : rm(n)

  const load = useCallback(() => {
    const m = MONTHS[month]
    const url = `/api/creators?from=${encodeURIComponent(m.from)}${m.to ? `&to=${encodeURIComponent(m.to)}` : ''}`
    const cacheKey = `creators:${month}`
    const cached = peekCache<Report>(cacheKey)
    if (cached) { setReport(cached); setLoading(false) } else setLoading(true)
    fetch(url)
      .then(r => r.json())
      .then((d: Report) => { if (d?.rows) { setReport(d); mutateCache<Report>(cacheKey, () => d) } else setMsg('⚠️ ' + ((d as { error?: string })?.error || 'Load failed')) })
      .catch(() => { if (!cached) setReport(null) })
      .finally(() => setLoading(false))
  }, [month])

  useEffect(() => { load() }, [load])
  // Sync the rate inputs from saved settings when a report loads.
  useEffect(() => {
    if (report?.settings) { setCommPct(Math.round(report.settings.commission_rate * 100)); setOvrPct(Math.round(report.settings.override_rate * 100)) }
  }, [report?.settings?.commission_rate, report?.settings?.override_rate])

  async function sync() {
    setSyncing(true); setMsg('Syncing Instagram… (this can take up to ~90s)')
    try {
      const res = await fetch('/api/creators?action=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ since: SINCE }) })
      const d = await res.json()
      setMsg(res.ok ? `✅ Synced ${d.scraped} posts (${d.collabs} collabs).` : `⚠️ ${d.error || 'Sync failed'}`)
      load()
    } catch { setMsg('⚠️ Sync failed') } finally { setSyncing(false) }
  }

  async function mapIg(affiliate_id: string, ig_handle: string) {
    setMsg('')
    setReport(prev => prev && ({ ...prev, rows: prev.rows.map(r => r.ig_handle === ig_handle ? { ...r, affiliate_id } : r) }))
    await fetch('/api/creators?action=map_ig', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ affiliate_id, ig_handle }) })
    load()
  }

  // Persist the global rates (debounced via onBlur). Display recalcs live from state.
  async function saveRates() {
    await fetch('/api/creators?action=set_rates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commission_rate: commPct / 100, override_rate: ovrPct / 100 }) })
  }

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir(d => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(-1) }
  }

  // Commission/override computed LIVE from revenue × the on-screen rates.
  const commOf = (r: Row) => r.revenue == null ? null : Math.round(r.revenue * commPct / 100)
  const ovrOf = (r: Row) => r.revenue == null ? null : Math.round(r.revenue * ovrPct / 100)
  const sortVal = (r: Row, k: SortKey): number => k === 'commission' ? (commOf(r) ?? -1) : k === 'override' ? (ovrOf(r) ?? -1) : ((r[k] ?? -1) as number)
  const rows = report ? [...report.rows].sort((a, b) => (sortVal(a, sortKey) - sortVal(b, sortKey)) * sortDir) : []
  const unmappedAffs = report?.affiliates.filter(a => !a.ig_handle) ?? []

  const sumBy = (f: (r: Row) => number) => rows.reduce((t, r) => t + f(r), 0)
  const totRevenue = sumBy(r => r.revenue ?? 0)
  const totComm = Math.round(totRevenue * commPct / 100)
  const totOvr = Math.round(totRevenue * ovrPct / 100)
  const tCollab = sumBy(r => r.collab_posts), tReach = sumBy(r => r.reach), tEng = sumBy(r => r.engagement), tLeads = sumBy(r => r.leads ?? 0), tSeats = sumBy(r => r.seats ?? 0)

  // ── Momentum: week/month trend series + deltas ──
  const mondayISO = (d: Date) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = x.getUTCDay(); x.setUTCDate(x.getUTCDate() + (day === 0 ? -6 : 1 - day)); return x.toISOString().slice(0, 10) }
  const series = report ? (gran === 'week' ? report.trends.weekly : report.trends.monthly) : []
  const now = new Date()
  const curKey = gran === 'week' ? mondayISO(now) : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const livePartial = series.length > 0 && series[series.length - 1].key === curKey
  const complete = livePartial ? series.slice(0, -1) : series   // fair Δ: compare finished periods only
  const cur = complete[complete.length - 1], prv = complete[complete.length - 2]
  const pct = (a: number, b: number) => b > 0 ? Math.round(((a - b) / b) * 100) : (a > 0 ? 100 : 0)
  const kpis = cur ? [
    { l: 'Collab posts', v: cur.collab_posts, d: prv ? pct(cur.collab_posts, prv.collab_posts) : null },
    { l: 'Leads signed', v: cur.leads, d: prv ? pct(cur.leads, prv.leads) : null },
    { l: 'Reach', v: cur.reach, d: prv ? pct(cur.reach, prv.reach) : null },
    { l: 'Seats', v: cur.seats, d: prv ? pct(cur.seats, prv.seats) : null },
  ] : []
  const topMovers = report ? [...report.rows].filter(r => r.collab_posts > 0).sort((a, b) => b.collab_posts - a.collab_posts).slice(0, 3) : []

  const cols: Array<{ key: SortKey; label: string }> = [
    { key: 'collab_posts', label: 'Collab posts' },
    { key: 'reach', label: 'Reach' },
    { key: 'engagement', label: 'Engagement' },
    { key: 'leads', label: 'Leads' },
    { key: 'seats', label: 'Seats' },
    { key: 'revenue', label: 'Revenue' },
    { key: 'commission', label: 'Commission' },
    { key: 'override', label: 'Lead override' },
  ]
  const arrow = (k: SortKey) => sortKey === k ? (sortDir === -1 ? ' ↓' : ' ↑') : ''

  if (loading && !report) return <div className="text-zinc-500 mt-20 text-center">Loading…</div>

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Creators — IG & Affiliate Scorecard</h1>
          <p className="text-sm text-zinc-400">Collab posts on @claudemalaysiacommunity + leads, seats & commission per creator</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-zinc-700 overflow-hidden">
            {(Object.keys(MONTHS) as Array<keyof typeof MONTHS>).map(k => (
              <button key={k} onClick={() => setMonth(k)}
                className={`px-3 py-2 text-xs ${month === k ? 'bg-amber-500 text-black font-semibold' : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'}`}>
                {MONTHS[k].label}
              </button>
            ))}
          </div>
          <button onClick={sync} disabled={syncing}
            className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg border border-zinc-700">
            {syncing ? 'Syncing…' : '🔄 Sync Instagram'}
          </button>
        </div>
      </div>

      {/* Global rates — change once, applies to everyone */}
      <div className="bg-[#111] border border-zinc-800 rounded-xl px-5 py-4 flex flex-wrap items-end gap-6">
        <div>
          <label className="block text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Commission rate (all creators)</label>
          <div className="flex items-center gap-1">
            <input type="number" min={0} max={100} step={1} value={commPct}
              onChange={e => setCommPct(Number(e.target.value))} onBlur={saveRates}
              className="w-20 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-lg font-bold focus:border-amber-500/60 focus:outline-none" />
            <span className="text-zinc-400 text-lg font-bold">%</span>
          </div>
        </div>
        <div>
          <label className="block text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Team Lead override</label>
          <div className="flex items-center gap-1">
            <input type="number" min={0} max={100} step={1} value={ovrPct}
              onChange={e => setOvrPct(Number(e.target.value))} onBlur={saveRates}
              className="w-20 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-lg font-bold focus:border-indigo-400/60 focus:outline-none" />
            <span className="text-zinc-400 text-lg font-bold">%</span>
          </div>
        </div>
        <div className="ml-auto flex gap-6 text-right">
          <div><p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Total revenue</p><p className="text-lg font-bold">{money(totRevenue)}</p></div>
          <div><p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Total commission</p><p className="text-lg font-bold text-emerald-400">{money(totComm)}</p></div>
          <div><p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Lead override</p><p className="text-lg font-bold text-indigo-300">{money(totOvr)}</p></div>
        </div>
      </div>

      {msg && <div className="text-sm text-zinc-300 bg-[#111] border border-zinc-800 rounded-lg px-4 py-2">{msg}</div>}

      {report && (
        <>
          {/* IG totals */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { l: 'Total posts', v: num(report.totals.total_posts) },
              { l: 'Collab posts', v: num(report.totals.collab_posts), hot: true },
              { l: 'Community posts', v: num(report.totals.community_posts) },
              { l: 'Active creators', v: num(report.totals.active_creators) },
              { l: 'Reach', v: num(report.totals.reach) },
              { l: 'Engagement', v: num(report.totals.engagement) },
            ].map(s => (
              <div key={s.l} className={`bg-[#111] border rounded-xl p-4 ${s.hot ? 'border-amber-500/40' : 'border-zinc-800'}`}>
                <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">{s.l}</p>
                <p className={`text-2xl font-bold ${s.hot ? 'text-amber-400' : ''}`}>{s.v}</p>
              </div>
            ))}
          </div>

          {/* ── Momentum: week-by-week / month-by-month trends ── */}
          {series.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h2 className="text-sm font-semibold">📈 Momentum</h2>
                  <p className="text-xs text-zinc-500">{gran === 'week' ? 'Week by week' : 'Month by month'} — more posts → more reach → more leads → more seats{livePartial ? ` · latest ${gran} still in progress` : ''}</p>
                </div>
                <div className="flex rounded-lg border border-zinc-700 overflow-hidden">
                  {(['week', 'month'] as const).map(g => (
                    <button key={g} onClick={() => setGran(g)}
                      className={`px-3 py-2 text-xs ${gran === g ? 'bg-amber-500 text-black font-semibold' : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'}`}>
                      {g === 'week' ? 'Weekly' : 'Monthly'}
                    </button>
                  ))}
                </div>
              </div>

              {/* KPI cards — Δ vs previous finished period */}
              {kpis.length > 0 && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {kpis.map(k => (
                    <div key={k.l} className="bg-[#111] border border-zinc-800 rounded-xl p-4">
                      <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">{k.l}</p>
                      <div className="flex items-baseline gap-2">
                        <p className="text-2xl font-bold">{num(k.v)}</p>
                        {k.d != null && (
                          <span className={`text-xs font-semibold ${k.d > 0 ? 'text-emerald-400' : k.d < 0 ? 'text-red-400' : 'text-zinc-500'}`}>
                            {k.d > 0 ? '▲' : k.d < 0 ? '▼' : '–'} {Math.abs(k.d)}%
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-600 mt-0.5">vs prev {gran}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Trend charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="bg-[#111] border border-zinc-800 rounded-xl p-4">
                  <p className="text-sm text-zinc-300 mb-2">Collab posts <span className="text-zinc-500">+ active creators</span></p>
                  <ComboBarLine points={series.map(s => ({ label: s.label, bar: s.collab_posts, line: s.active_creators }))} barColor="#f59e0b" lineColor="#818cf8" />
                </div>
                <div className="bg-[#111] border border-zinc-800 rounded-xl p-4">
                  <p className="text-sm text-zinc-300 mb-2">Leads signed</p>
                  <AreaLineChart points={series.map(s => ({ label: s.label, value: s.leads }))} color="#38bdf8" />
                </div>
              </div>
              <div className="bg-[#111] border border-zinc-800 rounded-xl p-4">
                <p className="text-sm text-zinc-300 mb-2">Seats sold via creators{revenueHidden ? '' : ' + revenue'} <span className="text-zinc-500">· seats left axis{revenueHidden ? '' : ', RM right axis'}</span></p>
                <CashflowChart mode="history" hidden={revenueHidden} points={series.map(s => ({ label: s.label, flow: s.seats, balance: s.revenue }))} />
              </div>

              {/* Top movers podium */}
              {topMovers.length > 0 && (
                <div>
                  <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-2">Top creators ({MONTHS[month].label})</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {topMovers.map((r, i) => (
                      <div key={r.ig_handle} className={`bg-[#111] border rounded-xl p-4 flex items-center gap-3 ${i === 0 ? 'border-amber-500/50' : 'border-zinc-800'}`}>
                        <span className="text-2xl">{['🥇', '🥈', '🥉'][i]}</span>
                        <div className="min-w-0">
                          <a href={`https://instagram.com/${r.ig_handle}`} target="_blank" rel="noreferrer" className="font-semibold text-white hover:text-amber-400 truncate block">@{r.ig_handle}</a>
                          <p className="text-xs text-zinc-500">{r.collab_posts} collab posts · {num(r.reach)} reach</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Leaderboard */}
          <div className="bg-[#111] border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-zinc-800 flex justify-between items-center">
              <h2 className="font-semibold text-sm">Creator leaderboard ({rows.length})</h2>
              <span className="text-xs text-zinc-500">click a column to sort{report.last_synced ? ` · synced ${new Date(report.last_synced).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}` : ''}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 text-xs border-b border-zinc-900">
                    <th className="px-4 py-2">Creator</th>
                    <th className="px-4 py-2 text-right whitespace-nowrap">8-wk trend</th>
                    {cols.map(c => (
                      <th key={c.key} className="px-4 py-2 text-right cursor-pointer select-none whitespace-nowrap hover:text-zinc-300" onClick={() => toggleSort(c.key)}>
                        {c.label}{arrow(c.key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* TOTAL row — leads shown vs full sheet for tally check */}
                  <tr className="border-b border-zinc-800 bg-zinc-900/50 font-semibold sticky top-0">
                    <td className="px-4 py-3">TOTAL</td>
                    <td className="px-4 py-3"></td>
                    <td className="px-4 py-3 text-right text-amber-400">{tCollab}</td>
                    <td className="px-4 py-3 text-right">{num(tReach)}</td>
                    <td className="px-4 py-3 text-right">{num(tEng)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{tLeads} <span className="text-zinc-500 font-normal">/ {report.totals.total_leads} sheet</span></td>
                    <td className="px-4 py-3 text-right">{tSeats}</td>
                    <td className="px-4 py-3 text-right">{money(totRevenue)}</td>
                    <td className="px-4 py-3 text-right text-emerald-400">{money(totComm)}</td>
                    <td className="px-4 py-3 text-right text-indigo-300">{money(totOvr)}</td>
                  </tr>
                  {rows.map(r => (
                    <tr key={r.ig_handle} className="border-b border-zinc-900 hover:bg-zinc-900/30">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <a href={`https://instagram.com/${r.ig_handle}`} target="_blank" rel="noreferrer" className="font-medium text-white hover:text-amber-400">@{r.ig_handle}</a>
                        {r.display_name && <span className="ml-2 text-xs text-zinc-500">{r.display_name}</span>}
                        {!r.affiliate_id && (
                          <select defaultValue="" onChange={e => e.target.value && mapIg(e.target.value, r.ig_handle)}
                            className="ml-2 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] text-zinc-400">
                            <option value="">link affiliate…</option>
                            {unmappedAffs.map(a => <option key={a.id} value={a.id}>{a.handle}{a.name ? ` (${a.name})` : ''}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-3"><div className="flex justify-end"><Sparkline values={r.weekly_collabs ?? []} /></div></td>
                      <td className="px-4 py-3 text-right font-semibold text-amber-400">{r.collab_posts}</td>
                      <td className="px-4 py-3 text-right text-zinc-300">{num(r.reach)}</td>
                      <td className="px-4 py-3 text-right text-zinc-300">{num(r.engagement)}</td>
                      <td className="px-4 py-3 text-right text-zinc-300">{r.leads ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-zinc-300">{r.seats ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-zinc-300">{money(r.revenue)}</td>
                      <td className="px-4 py-3 text-right font-semibold">{commOf(r) == null ? <span className="text-zinc-600">—</span> : <span className="text-emerald-400">{money(commOf(r))}</span>}</td>
                      <td className="px-4 py-3 text-right">{ovrOf(r) == null ? <span className="text-zinc-600">—</span> : <span className="text-indigo-300">{money(ovrOf(r))}</span>}</td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td colSpan={10} className="px-4 py-10 text-center text-zinc-500">No collab posts in range. Click <span className="text-amber-400">Sync Instagram</span> to pull data.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Affiliates with sales but no IG link yet */}
          {report.unmapped_affiliates.length > 0 && (
            <div className="bg-[#111] border border-zinc-800 rounded-xl p-5">
              <h3 className="font-semibold text-sm mb-1">Affiliates with sales but no IG handle yet ({report.unmapped_affiliates.length})</h3>
              <p className="text-xs text-zinc-500 mb-3">These earn commission but aren&apos;t linked to an IG creator. Map them from the leaderboard&apos;s &quot;link affiliate&quot; dropdown once they appear, or they simply have no collab posts in range.</p>
              <div className="flex flex-wrap gap-2">
                {report.unmapped_affiliates.map(a => (
                  <span key={a.id} className="text-xs bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5">
                    {a.handle}{a.name ? ` · ${a.name}` : ''} <span className="text-zinc-500">— {a.leads} leads · {money(a.commission)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
