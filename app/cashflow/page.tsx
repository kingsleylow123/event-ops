'use client'
import { useEffect, useState } from 'react'
import type { Event } from '@/lib/supabase'
import type { CashflowData, CashflowPeriod } from '@/lib/cashflow'
import { rm } from '@/lib/finance'
import { resolveInitialEvent, storeEventId } from '@/lib/event'
import { useCachedFetch } from '@/lib/useCachedFetch'
import { useRevenueHidden } from '@/lib/useRevenueHidden'
import { SankeyChart } from '@/components/finance/SankeyChart'

const HEADING = 'text-sky-400 font-semibold text-sm'

const PERIOD_LABELS: Record<CashflowPeriod, string> = {
  all: 'All-time',
  month: 'This month',
  '30': 'Last 30 days',
  '90': 'Last 90 days',
}

function Card({ title, right, children }: {
  title: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="bg-[#111] border border-zinc-800 rounded-xl p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className={HEADING}>{title}</h2>
        {right}
      </div>
      {children}
    </div>
  )
}

function PeriodSelect({ value, onChange }: { value: CashflowPeriod; onChange: (p: CashflowPeriod) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as CashflowPeriod)}
      className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-zinc-300 text-xs"
    >
      <option value="all">All-time</option>
      <option value="month">This month</option>
      <option value="30">Last 30 days</option>
      <option value="90">Last 90 days</option>
    </select>
  )
}

export default function CashflowPage() {
  const { data: eventsData } = useCachedFetch<Event[]>('events', '/api/events')
  const [events, setEvents] = useState<Event[]>([])
  const [scope, setScope] = useState<string>('')
  const [period, setPeriod] = useState<CashflowPeriod>('all')
  const [data, setData] = useState<CashflowData | null>(null)
  const [loading, setLoading] = useState(true)
  const [hidden, toggleHidden] = useRevenueHidden()

  useEffect(() => { if (eventsData) setEvents(eventsData) }, [eventsData])

  // Pick the initial scope once events arrive (functional updater keeps `scope`
  // out of the deps, so this only re-runs when the events list itself changes).
  useEffect(() => {
    if (!eventsData) return
    setScope(prev => prev || (resolveInitialEvent(eventsData)?.id ?? 'all'))
  }, [eventsData])

  // Fetch on scope/period change. `ignore` + AbortController discard superseded
  // responses so a slower older request can never overwrite current data.
  useEffect(() => {
    if (!scope) return
    const ctrl = new AbortController()
    let ignore = false
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/cashflow?event_id=${scope}&period=${period}`, {
          cache: 'no-store',
          signal: ctrl.signal,
        })
        if (!ignore && res.ok) setData(await res.json())
      } catch {
        // keep last good data; ignore AbortError
      } finally {
        if (!ignore) setLoading(false)
      }
    })()
    return () => { ignore = true; ctrl.abort() }
  }, [scope, period])

  function changeScope(s: string) {
    setScope(s)
    if (s !== 'all') storeEventId(s)
  }

  if (loading && !data) {
    return <div className="text-zinc-500 mt-20 text-center">Loading…</div>
  }

  const scopeLabel = data?.scope_label
    ?? (scope === 'all' ? 'All events' : (events.find(e => e.id === scope)?.name ?? ''))
  const totals = data?.totals ?? { in: 0, out: 0, net: 0 }
  const net = totals.net

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Cashflow</h1>
          <p className="text-sm text-zinc-400">Money in → money out · {scopeLabel} · {PERIOD_LABELS[period]}</p>
        </div>
        <div className="flex gap-2 items-center">
          <button
            onClick={toggleHidden}
            title={hidden ? 'Show figures' : 'Hide figures'}
            className="text-zinc-500 hover:text-amber-400 text-base leading-none px-1"
          >
            {hidden ? '👁' : '🙈'}
          </button>
          <PeriodSelect value={period} onChange={setPeriod} />
          <select
            value={scope}
            onChange={e => changeScope(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm"
          >
            <option value="all">All events</option>
            {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gradient-to-br from-green-600 to-green-700 text-white rounded-xl p-4">
          <p className="text-[11px] uppercase tracking-wide font-medium text-green-100">Total In</p>
          <p className="text-xl font-bold mt-0.5">{rm(totals.in, hidden)}</p>
        </div>
        <div className="bg-gradient-to-br from-red-600 to-red-700 text-white rounded-xl p-4">
          <p className="text-[11px] uppercase tracking-wide font-medium text-red-100">Total Out</p>
          <p className="text-xl font-bold mt-0.5">{rm(totals.out, hidden)}</p>
        </div>
        <div className={`rounded-xl p-4 text-white bg-gradient-to-br ${net >= 0 ? 'from-sky-600 to-sky-700' : 'from-amber-600 to-amber-700'}`}>
          <p className="text-[11px] uppercase tracking-wide font-medium text-white/80">{net >= 0 ? 'Net Profit' : 'Net Loss'}</p>
          <p className="text-xl font-bold mt-0.5">{rm(net, hidden)}</p>
        </div>
      </div>

      {/* Sankey */}
      <Card
        title="Cash Flow"
        right={<span className="text-xs text-zinc-400 bg-zinc-900 border border-zinc-700 rounded-full px-2.5 py-1">{PERIOD_LABELS[period]}</span>}
      >
        {data
          ? <SankeyChart data={data} hidden={hidden} />
          : <p className="text-sm text-zinc-500 py-10 text-center">Loading…</p>}
      </Card>
    </div>
  )
}
