'use client'
import { useState, useMemo } from 'react'
import type { Event } from '@/lib/supabase'
import type { FunnelReport, FunnelStage } from '@/lib/funnel'
import { resolveInitialEvent, storeEventId } from '@/lib/event'
import { useCachedFetch } from '@/lib/useCachedFetch'
import { useRevenueHidden } from '@/lib/useRevenueHidden'
import { rmShort, fmtDate } from '@/lib/format'

type Report = FunnelReport & { standingInsight: string | null }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const STAGE_COLOR: Record<string, string> = { leads: '#3b82f6', workshop: '#f59e0b', glcc: '#22c55e', deals: '#a855f7' }
const HEALTH: Record<string, { dot: string; label: string }> = {
  green: { dot: 'bg-green-500', label: 'On track' },
  amber: { dot: 'bg-amber-500', label: 'Needs push' },
  red: { dot: 'bg-red-500', label: 'At risk' },
  past: { dot: 'bg-zinc-600', label: 'Done' },
}

export default function CommandCenter() {
  const [revenueHidden, toggleRevenue] = useRevenueHidden()
  const [scope, setScope] = useState<'all' | string>('all')
  const [calView, setCalView] = useState<'grid' | 'timeline'>('timeline')
  const [advice, setAdvice] = useState<string | null>(null)
  const [advising, setAdvising] = useState(false)

  const { data: me } = useCachedFetch<{ is_admin: boolean }>('me', '/api/me')
  const isAdmin = !!me?.is_admin
  const { data: events } = useCachedFetch<Event[]>('events', '/api/events')

  const scopeParam = scope === 'all' ? '' : `?event_id=${scope}`
  const { data: report, loading } = useCachedFetch<Report>(
    `funnel:${scope}`, `/api/funnel${scopeParam}`, isAdmin,
  )

  const money = (n: number) => revenueHidden ? 'RM ••••••' : rmShort(n)

  async function askAdvisor() {
    setAdvising(true); setAdvice(null)
    try {
      const res = await fetch(`/api/funnel?action=advise`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scope === 'all' ? {} : { event_id: scope }),
      })
      const d = await res.json()
      setAdvice(res.ok ? d.advice : `⚠️ ${d.error || 'Advisor unavailable'}`)
    } catch { setAdvice('⚠️ Advisor unavailable — try again.') }
    finally { setAdvising(false) }
  }

  if (!me) return <div className="theme-faint mt-20 text-center">Loading…</div>
  if (!isAdmin) return <div className="theme-faint mt-20 text-center">Admins only.</div>

  const maxCount = Math.max(1, ...(report?.stages.map(s => s.count) ?? [1]))

  return (
    <div className="space-y-6">
      {/* Header + scope filter */}
      <div className="theme-surface theme-border border rounded-xl p-4 sm:p-5 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs text-amber-500 font-semibold uppercase tracking-widest mb-1">Command Center</p>
          <h1 className="text-xl sm:text-2xl font-bold theme-text">Funnel Intelligence</h1>
          <p className="text-sm theme-muted mt-1">ToFu → MoFu → BoFu · where the money flows + the weakest link to fix</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={scope} onChange={e => { setScope(e.target.value); if (e.target.value !== 'all') storeEventId(e.target.value) }}
            className="theme-surface-2 theme-text theme-border border rounded-lg px-3 py-2 text-xs">
            <option value="all">🌐 Whole business</option>
            {(events ?? []).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <button onClick={toggleRevenue} title={revenueHidden ? 'Show revenue' : 'Hide revenue'}
            className="theme-faint hover:text-amber-500 theme-border border rounded-lg px-3 py-2 text-sm">
            {revenueHidden ? '👁' : '🙈'}
          </button>
        </div>
      </div>

      {loading && !report ? (
        <div className="theme-faint text-center py-12">Loading funnel…</div>
      ) : !report ? (
        <div className="theme-faint text-center py-12">No funnel data.</div>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
            {[
              { label: 'Leads', value: report.totals.leads, color: 'text-blue-400' },
              { label: '1-day seats', value: report.totals.workshopPaid, color: 'text-amber-500' },
              { label: '2-day class', value: report.totals.glccPaid, color: 'text-green-500' },
              { label: 'Deals won', value: report.totals.dealsWon, color: 'text-purple-400' },
              { label: 'Revenue', value: money(report.totals.grossRevenue), color: 'text-amber-500' },
              { label: 'Affiliate %', value: `${report.attribution.affiliatePct}%`, color: 'theme-text' },
            ].map(s => (
              <div key={s.label} className="theme-surface theme-border border rounded-xl p-3 sm:p-4">
                <p className="text-xs theme-faint mb-1">{s.label}</p>
                <p className={`text-lg sm:text-2xl font-bold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Funnel visual — value ladder, stacks vertically (mobile-friendly by default) */}
          <div className="theme-surface theme-border border rounded-xl p-4 sm:p-5">
            <h2 className="text-sm font-semibold theme-text mb-4">The Funnel — value ladder</h2>
            <div className="space-y-1">
              {report.stages.map((s, i) => (
                <FunnelRow key={s.key} stage={s} maxCount={maxCount} money={money} isLeak={!!report.weakLink && report.weakLink.fromKey === report.stages[i - 1]?.key && report.weakLink.toKey === s.key} />
              ))}
            </div>
          </div>

          {/* Weakest link callout */}
          {report.weakLink && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-4 sm:p-5">
              <p className="text-xs text-red-400 font-semibold uppercase tracking-widest mb-1">🔻 Weakest link — fix this first</p>
              <h3 className="text-lg sm:text-xl font-bold theme-text">{report.weakLink.label} — {report.weakLink.convPct}% <span className="theme-faint text-sm font-normal">(target {report.weakLink.benchmarkPct}%)</span></h3>
              <p className="text-amber-400 font-semibold mt-1">≈ {money(report.weakLink.upsideRM)} unlocked if you close the gap</p>
              <ul className="mt-3 space-y-1">
                {report.weakLink.fixes.map((f, i) => <li key={i} className="text-sm theme-muted flex gap-2"><span className="text-amber-500">→</span>{f}</li>)}
              </ul>
              {report.runnerUp && (
                <p className="text-xs theme-faint mt-3">Next: {report.runnerUp.label} at {report.runnerUp.convPct}% (~{money(report.runnerUp.upsideRM)})</p>
              )}
            </div>
          )}

          {/* Strengths / risks */}
          {(report.strengths.length > 0 || report.risks.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {report.strengths.map((s, i) => <span key={`s${i}`} className="text-xs rounded-full px-3 py-1 bg-green-500/10 text-green-400 border border-green-500/30">✓ {s}</span>)}
              {report.risks.map((r, i) => <span key={`r${i}`} className="text-xs rounded-full px-3 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/30">⚠ {r}</span>)}
            </div>
          )}

          {/* AI advisor */}
          <div className="theme-surface theme-border border rounded-xl p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <h2 className="text-sm font-semibold theme-text">🤖 Funnel Advisor</h2>
              <button onClick={askAdvisor} disabled={advising}
                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold px-4 py-2 rounded-lg text-sm">
                {advising ? '⏳ Thinking…' : 'Ask the Advisor'}
              </button>
            </div>
            {report.standingInsight && !advice && (
              <div className="text-sm theme-muted whitespace-pre-line rounded-lg theme-border border p-3 bg-zinc-950/30">
                <span className="text-amber-500 text-xs font-semibold">DAILY INSIGHT</span>
                <p className="mt-1">{report.standingInsight}</p>
              </div>
            )}
            {advice && (
              <div className="text-sm theme-muted whitespace-pre-line rounded-lg theme-border border p-3 bg-zinc-950/30">{advice}</div>
            )}
            {!report.standingInsight && !advice && (
              <p className="text-xs theme-faint">No daily insight yet — it writes with the morning digest. Tap “Ask the Advisor” for a live read.</p>
            )}
            <p className="text-[11px] theme-faint mt-2">Also on Telegram — ask Jarvis “where’s my funnel leaking?”</p>
          </div>

          {/* Calendar */}
          <div className="theme-surface theme-border border rounded-xl p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="text-sm font-semibold theme-text">📅 Events — planning</h2>
              <div className="flex theme-border border rounded-lg overflow-hidden text-xs">
                <button onClick={() => setCalView('timeline')} className={`px-3 py-1.5 ${calView === 'timeline' ? 'bg-amber-500 text-black font-semibold' : 'theme-muted'}`}>Timeline</button>
                <button onClick={() => setCalView('grid')} className={`px-3 py-1.5 ${calView === 'grid' ? 'bg-amber-500 text-black font-semibold' : 'theme-muted'}`}>Month</button>
              </div>
            </div>
            {calView === 'grid' ? <MonthGrid events={report.events} /> : <ReadinessTimeline events={report.events} money={money} />}
          </div>
        </>
      )}
    </div>
  )
}

// ── Funnel row: bar (width ∝ count) + conversion arrow above it ───────────────
function FunnelRow({ stage, maxCount, money, isLeak }: { stage: FunnelStage; maxCount: number; money: (n: number) => string; isLeak: boolean }) {
  const widthPct = Math.max(12, Math.round((stage.count / maxCount) * 100))
  const color = STAGE_COLOR[stage.key] || '#f59e0b'
  return (
    <div>
      {stage.convFromPct != null && (
        <div className={`flex items-center gap-2 py-1 pl-1 text-xs ${isLeak ? 'text-red-400' : 'theme-faint'}`}>
          <span className={isLeak ? 'font-bold' : ''}>↓ {stage.convFromPct}%</span>
          <span className="truncate">{stage.convNote}{isLeak ? ' · 🔻 weakest link' : ''}</span>
        </div>
      )}
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="rounded-lg px-3 py-2.5 flex items-center justify-between gap-2" style={{ width: `${widthPct}%`, minWidth: '180px', background: `${color}22`, border: `1px solid ${color}66` }}>
            <div className="min-w-0">
              <p className="text-sm font-semibold theme-text truncate">{stage.label} <span className="theme-faint font-normal text-xs">· {stage.price}</span></p>
              <p className="text-[11px] theme-faint truncate">{stage.sub.map(x => `${x.value} ${x.label.toLowerCase()}`).join(' · ')}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-lg font-bold" style={{ color }}>{stage.count}</p>
              {stage.revenue > 0 && <p className="text-[10px] theme-faint">{money(stage.revenue)}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Readiness timeline: upcoming events with funnel health ────────────────────
function ReadinessTimeline({ events, money }: { events: Report['events']; money: (n: number) => string }) {
  const upcoming = useMemo(
    () => [...events].filter(e => e.daysToGo == null || e.daysToGo >= -3).sort((a, b) => (a.daysToGo ?? 0) - (b.daysToGo ?? 0)),
    [events],
  )
  if (!upcoming.length) return <p className="text-xs theme-faint">No upcoming events.</p>
  return (
    <div className="space-y-2">
      {upcoming.map(e => {
        const h = HEALTH[e.health]
        return (
          <div key={e.id} className="theme-border border rounded-lg p-3 flex items-center gap-3 flex-wrap">
            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${h.dot}`} title={h.label} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium theme-text truncate">{e.name}</p>
              <p className="text-[11px] theme-faint">{e.date ? fmtDate(e.date) : '—'} · {e.type} {e.revenue > 0 && `· ${money(e.revenue)}`}</p>
            </div>
            <div className="text-right text-xs flex-shrink-0">
              <p className={`font-bold ${e.daysToGo != null && e.daysToGo <= 7 && e.daysToGo >= 0 ? 'text-red-400' : 'theme-text'}`}>
                {e.daysToGo == null ? '—' : e.daysToGo < 0 ? `${Math.abs(e.daysToGo)}d ago` : e.daysToGo === 0 ? 'Today' : `T-${e.daysToGo}`}
              </p>
              <p className="theme-faint">{e.fillPct != null ? `${e.fillPct}% full` : `${e.paid} paid`}</p>
            </div>
            {e.selloutInDays != null && e.daysToGo != null && e.daysToGo > 0 && (
              <p className="text-[11px] w-full sm:w-auto sm:basis-full text-amber-400">
                🔥 {e.selloutInDays <= e.daysToGo ? `Selling out in ~${e.selloutInDays}d at current pace` : `Won't sell out — needs more pace`}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Month grid (current month), events plotted ───────────────────────────────
function MonthGrid({ events }: { events: Report['events'] }) {
  const now = new Date()
  const year = now.getFullYear(), month = now.getMonth()
  const first = new Date(year, month, 1)
  const startWd = first.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const todayDate = now.getDate()
  const byDay = new Map<number, Report['events']>()
  for (const e of events) {
    if (!e.date) continue
    const d = new Date(e.date)
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate()
      byDay.set(day, [...(byDay.get(day) ?? []), e])
    }
  }
  const cells: (number | null)[] = [...Array(startWd).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  return (
    <div>
      <p className="text-xs theme-muted mb-2">{MONTHS[month]} {year}</p>
      <div className="grid grid-cols-7 gap-1 text-center">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} className="text-[10px] theme-faint py-1">{d}</div>)}
        {cells.map((day, i) => {
          const evs = day ? byDay.get(day) : null
          const isToday = day === todayDate
          return (
            <div key={i} className={`min-h-[52px] rounded-lg p-1 text-left ${day ? 'theme-border border' : ''} ${isToday ? 'ring-1 ring-amber-500' : ''}`}>
              {day && <span className={`text-[10px] ${isToday ? 'text-amber-500 font-bold' : 'theme-faint'}`}>{day}</span>}
              {evs?.map(e => (
                <div key={e.id} className="mt-0.5 text-[9px] rounded px-1 py-0.5 truncate text-black"
                  style={{ background: e.type === '2-day' ? '#22c55e' : e.type === 'webinar' ? '#3b82f6' : '#f59e0b' }}
                  title={`${e.name} · ${e.fillPct ?? '—'}% full`}>
                  {e.type === '2-day' ? 'GLCC' : e.fillPct != null ? `${e.fillPct}%` : '•'}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
