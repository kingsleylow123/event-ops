'use client'
import { useState, useMemo } from 'react'
import { useCachedFetch } from '@/lib/useCachedFetch'

interface Insight { icon: string; text: string; priority: number }
interface EventTicketRow { id: string; name: string | null; date: string | null; capacity: number | null; total_seats: number; attributed_seats: number; revenue: number }
interface Report {
  insights: Insight[]
  events: EventTicketRow[]
  totals: { collab_posts: number; reach: number; active_creators: number; total_leads: number }
}

const SINCE = '2026-05-01T00:00:00Z'
const WINDOWS: Record<string, { label: string }> = {
  '7d': { label: '7d' }, '30d': { label: '30d' }, may: { label: 'May' }, jun: { label: 'June' }, jul: { label: 'July' }, all: { label: 'May–Now' },
}
const FIXED: Record<string, { from: string; to?: string }> = {
  all: { from: SINCE },
  may: { from: '2026-05-01T00:00:00Z', to: '2026-06-01T00:00:00Z' },
  jun: { from: '2026-06-01T00:00:00Z', to: '2026-07-01T00:00:00Z' },
  jul: { from: '2026-07-01T00:00:00Z', to: '2026-08-01T00:00:00Z' },
}
function rangeFor(k: string): { from: string; to?: string } {
  if (k === '7d') return { from: new Date(Date.now() - 7 * 86400000).toISOString() }
  if (k === '30d') return { from: new Date(Date.now() - 30 * 86400000).toISOString() }
  return FIXED[k] ?? { from: SINCE }
}

export default function CreatorInsightsPage() {
  const [win, setWin] = useState('30d')
  const [copied, setCopied] = useState(false)
  // Memoise so the rolling 7d/30d `from` (Date.now()) is computed once per window —
  // otherwise the url changes every render and useCachedFetch refetches in a loop.
  const url = useMemo(() => {
    const r = rangeFor(win)
    return `/api/creators?from=${encodeURIComponent(r.from)}${r.to ? `&to=${encodeURIComponent(r.to)}` : ''}`
  }, [win])
  const { data: report, loading } = useCachedFetch<Report>(`creators:v2:${win}`, url)

  const insights = report?.insights ?? []
  const now = Date.now()
  const evShort = (d: string | null) => d ? new Date(d).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—'
  const upcoming = (report?.events ?? []).filter(e => e.date && new Date(e.date).getTime() >= now)
  const daysTo = (d: string) => Math.max(0, Math.ceil((new Date(d).getTime() - now) / 86400000))

  const copy = async () => {
    const text = `Creator coaching — ${WINDOWS[win].label}\n\n${insights.map((it, i) => `${i + 1}. ${it.text}`).join('\n\n')}`
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ }
  }

  if (loading && !report) return <div className="text-zinc-500 mt-20 text-center">Loading…</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">🧠 Creator Insights</h1>
          <p className="text-sm text-zinc-400">Auto-analysis to coach your creator lead — drive more posts, leads &amp; seats</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-zinc-700 overflow-hidden">
            {Object.keys(WINDOWS).map(k => (
              <button key={k} onClick={() => setWin(k)}
                className={`px-3 py-2 text-xs ${win === k ? 'bg-amber-500 text-black font-semibold' : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'}`}>{WINDOWS[k].label}</button>
            ))}
          </div>
          <a href="/creators" className="bg-zinc-800 hover:bg-zinc-700 text-white text-sm px-4 py-2 rounded-lg border border-zinc-700">← Scorecard</a>
        </div>
      </div>

      {report && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { l: 'Collab posts', v: report.totals.collab_posts },
            { l: 'Leads', v: report.totals.total_leads },
            { l: 'Active creators', v: report.totals.active_creators },
            { l: 'Reach', v: report.totals.reach },
          ].map(s => (
            <div key={s.l} className="bg-[#111] border border-zinc-800 rounded-xl p-4">
              <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">{s.l}</p>
              <p className="text-2xl font-bold">{s.v.toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-gradient-to-br from-amber-500/10 to-[#111] border border-amber-500/30 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h2 className="font-semibold text-sm flex items-center gap-2">Coach&apos;s playbook <span className="text-[10px] text-zinc-500 font-normal">— what to tell your lead ({WINDOWS[win].label})</span></h2>
          {insights.length > 0 && (
            <button onClick={copy} className="text-xs bg-amber-500 text-black font-semibold px-3 py-1.5 rounded-lg hover:bg-amber-400">{copied ? '✓ Copied' : '📋 Copy for WhatsApp'}</button>
          )}
        </div>
        {insights.length === 0 ? (
          <p className="text-sm text-zinc-500">No insights for this window yet — sync Instagram on the Scorecard and check the lead sheet.</p>
        ) : (
          <ol className="space-y-3">
            {insights.map((it, i) => (
              <li key={i} className="flex gap-3 bg-zinc-900/40 border border-zinc-800 rounded-lg p-3">
                <span className="text-xl leading-none">{it.icon}</span>
                <span className="text-sm text-zinc-100">{it.text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {upcoming.length > 0 && (
        <div>
          <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-2">🔥 Events to fill — point posts here</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {upcoming.map(e => {
              const cap = e.capacity ?? 0
              const pctFill = cap > 0 ? Math.min(100, Math.round(e.total_seats / cap * 100)) : null
              const dd = e.date ? daysTo(e.date) : 0
              return (
                <div key={e.id} className="bg-[#111] border border-zinc-800 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-sm leading-tight">{e.name ?? 'Event'}</p>
                    <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full ${dd <= 7 ? 'bg-red-500/20 text-red-300' : 'bg-zinc-800 text-zinc-400'}`}>{dd}d</span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5">{evShort(e.date)}</p>
                  <div className="mt-2 flex items-baseline gap-1"><span className="text-2xl font-bold">{e.total_seats}</span><span className="text-zinc-500 text-sm">{cap > 0 ? `/ ${cap}` : 'sold'}</span></div>
                  {pctFill != null && <div className="mt-2 h-2 rounded-full bg-zinc-800 overflow-hidden"><div className={`h-full ${pctFill >= 80 ? 'bg-emerald-500' : pctFill >= 40 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${pctFill}%` }} /></div>}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
