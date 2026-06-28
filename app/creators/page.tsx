'use client'
import { useEffect, useState, useCallback } from 'react'
import { peekCache, mutateCache } from '@/lib/useCachedFetch'
import { useRevenueHidden } from '@/lib/useRevenueHidden'

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
  commission: number | null
  revenue_est: number | null
}
interface Report {
  rows: Row[]
  unmapped_affiliates: Array<{ id: string; handle: string; name: string | null; leads: number; commission: number }>
  affiliates: Array<{ id: string; handle: string; name: string | null; ig_handle: string | null }>
  totals: { total_posts: number; collab_posts: number; community_posts: number; reach: number; engagement: number; active_creators: number }
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

type SortKey = 'collab_posts' | 'reach' | 'engagement' | 'leads' | 'seats' | 'commission' | 'revenue_est'

export default function CreatorsPage() {
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState<keyof typeof MONTHS>('all')
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('collab_posts')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)
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

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir(d => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(-1) }
  }

  const rows = report ? [...report.rows].sort((a, b) => (((a[sortKey] ?? -1) as number) - ((b[sortKey] ?? -1) as number)) * sortDir) : []
  const unmappedAffs = report?.affiliates.filter(a => !a.ig_handle) ?? []

  const cols: Array<{ key: SortKey; label: string; money?: boolean }> = [
    { key: 'collab_posts', label: 'Collab posts' },
    { key: 'reach', label: 'Reach' },
    { key: 'engagement', label: 'Engagement' },
    { key: 'leads', label: 'Leads' },
    { key: 'seats', label: 'Seats' },
    { key: 'commission', label: 'Commission', money: true },
    { key: 'revenue_est', label: 'Revenue (est)', money: true },
  ]

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

      {msg && <div className="text-sm text-zinc-300 bg-[#111] border border-zinc-800 rounded-lg px-4 py-2">{msg}</div>}

      {report && (
        <>
          {/* Totals */}
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
                    {cols.map(c => (
                      <th key={c.key} className="px-4 py-2 text-right cursor-pointer select-none whitespace-nowrap hover:text-zinc-300"
                        onClick={() => toggleSort(c.key)}>
                        {c.label}{sortKey === c.key ? (sortDir === -1 ? ' ↓' : ' ↑') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
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
                      <td className="px-4 py-3 text-right font-semibold text-amber-400">{r.collab_posts}</td>
                      <td className="px-4 py-3 text-right text-zinc-300">{num(r.reach)}</td>
                      <td className="px-4 py-3 text-right text-zinc-300">{num(r.engagement)}</td>
                      <td className="px-4 py-3 text-right text-zinc-300">{r.leads ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-zinc-300">{r.seats ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-zinc-300">{money(r.commission)}</td>
                      <td className="px-4 py-3 text-right text-zinc-500">{money(r.revenue_est)}</td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-zinc-500">No collab posts in range. Click <span className="text-amber-400">Sync Instagram</span> to pull data.</td></tr>
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
