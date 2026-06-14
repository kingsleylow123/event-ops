'use client'
import { useEffect, useState } from 'react'
import type { Event } from '@/lib/supabase'
import type { DashboardData, Row } from '@/lib/finance'
import { rm, windowSum, r2 } from '@/lib/finance'
import { resolveInitialEvent, storeEventId } from '@/lib/event'
import { useCachedFetch } from '@/lib/useCachedFetch'
import { useRevenueHidden } from '@/lib/useRevenueHidden'
import {
  AreaLineChart,
  ComboBarLine,
  CashflowChart,
  AgingBar,
  BreakdownPie,
  INCOME_PIE,
  EXPENSE_PIE,
} from '@/components/finance/Charts'

// Bukku-style sky-blue section heading used across every card.
const HEADING = 'text-sky-400 font-semibold text-sm'

type Period = 7 | 14 | 30

// Aging legend — colors must match AGING_ORDER inside Charts.tsx.
const AGING_LEGEND: { label: string; color: string }[] = [
  { label: 'Upcoming', color: '#93c5fd' },
  { label: '1-30 Days', color: '#3b82f6' },
  { label: '31-60 Days', color: '#1d4ed8' },
  { label: '61-90 Days', color: '#1e3a8a' },
  { label: '91+ Days', color: '#0f172a' },
]

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

function PeriodSelect({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(Number(e.target.value) as Period)}
      className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-zinc-300 text-xs"
    >
      <option value={7}>7-Day</option>
      <option value={14}>14-Day</option>
      <option value={30}>30-Day</option>
    </select>
  )
}

function AgingLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
      {AGING_LEGEND.map(item => (
        <div key={item.label} className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: item.color }} />
          <span className="text-xs text-zinc-400">{item.label}</span>
        </div>
      ))}
    </div>
  )
}

const periodKey = (p: Period): 'd7' | 'd14' | 'd30' => (p === 7 ? 'd7' : p === 14 ? 'd14' : 'd30')
const sumRows = (rows: Row[]) => r2(rows.reduce((s, r) => s + r.amount, 0))

export default function FinanceDashboardPage() {
  const { data: eventsData } = useCachedFetch<Event[]>('events', '/api/events')
  const [events, setEvents] = useState<Event[]>([])
  const [scope, setScope] = useState<string>('')
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [hidden, toggleHidden] = useRevenueHidden()

  // Per-card period state.
  const [incomePeriod, setIncomePeriod] = useState<Period>(7)
  const [plPeriod, setPlPeriod] = useState<Period>(7)
  const [incBreakPeriod, setIncBreakPeriod] = useState<Period>(14)
  const [expBreakPeriod, setExpBreakPeriod] = useState<Period>(14)

  // Mirror events into local state once they arrive.
  useEffect(() => {
    if (eventsData) setEvents(eventsData)
  }, [eventsData])

  // Pick the initial scope once events arrive (functional updater keeps `scope`
  // out of the deps, so this only runs when the events list itself changes).
  useEffect(() => {
    if (!eventsData) return
    setScope(prev => prev || (resolveInitialEvent(eventsData)?.id ?? 'all'))
  }, [eventsData])

  // Fetch the dashboard for the current scope. An `ignore` flag + AbortController
  // discard superseded/in-flight responses so a slower older request can never
  // overwrite the current scope's data, and we never set state after unmount.
  useEffect(() => {
    if (!scope) return
    const ctrl = new AbortController()
    let ignore = false
    ;(async () => {
      try {
        const res = await fetch(`/api/finance/dashboard?event_id=${scope}`, {
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
    return () => {
      ignore = true
      ctrl.abort()
    }
  }, [scope])

  function changeScope(s: string) {
    setScope(s)
    if (s !== 'all') storeEventId(s)
  }

  if (loading && !data) {
    return <div className="text-zinc-500 mt-20 text-center">Loading…</div>
  }

  // Guarded views of the payload — every field may be missing on first paint.
  const scopeLabel = data?.scope_label
    ?? (scope === 'all' ? 'All events' : (events.find(e => e.id === scope)?.name ?? ''))
  const kpis = data?.kpis
  const aging = data?.aging
  const daily = data?.daily ?? []
  const forecast = data?.forecast ?? []
  const recentSales = data?.recent_sales ?? []
  const breakdowns = data?.breakdowns

  const incomeRows = breakdowns?.income?.[periodKey(incBreakPeriod)] ?? []
  const expenseRows = breakdowns?.expense?.[periodKey(expBreakPeriod)] ?? []

  const cashOnHand = kpis?.cash_on_hand ?? 0
  const plNet = windowSum(daily, plPeriod).net
  const incomeWindow = windowSum(daily, incomePeriod).income

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* A. Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Finance</h1>
          <p className="text-sm text-zinc-400">Accounting dashboard · {scopeLabel}</p>
        </div>
        <div className="flex gap-2 items-center">
          <button
            onClick={toggleHidden}
            title={hidden ? 'Show figures' : 'Hide figures'}
            className="text-zinc-500 hover:text-amber-400 text-base leading-none px-1"
          >
            {hidden ? '👁' : '🙈'}
          </button>
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

      {/* B. KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Invoices', value: kpis?.invoices_due ?? 0, caption: 'Coming Due' },
          { label: 'Invoices', value: kpis?.invoices_overdue ?? 0, caption: 'Overdue' },
          { label: 'Bills', value: kpis?.bills_due ?? 0, caption: 'Coming Due' },
          { label: 'Bills', value: kpis?.bills_overdue ?? 0, caption: 'Overdue' },
        ].map((k) => (
          <div
            key={`${k.label}-${k.caption}`}
            className="bg-gradient-to-br from-sky-600 to-sky-700 text-white rounded-xl p-4"
          >
            <p className="text-[11px] uppercase tracking-wide font-medium text-sky-100">{k.label}</p>
            <p className="text-xl font-bold mt-0.5">{rm(k.value, hidden)}</p>
            <p className="text-[11px] text-sky-200 mt-0.5">{k.caption}</p>
          </div>
        ))}
      </div>

      {/* C. Aging */}
      <div className="grid md:grid-cols-2 gap-3">
        <Card title="Outstanding Invoices">
          <AgingBar buckets={aging?.invoices ?? { upcoming: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91_plus: 0 }} />
          <AgingLegend />
        </Card>
        <Card title="Outstanding Bills">
          <AgingBar buckets={aging?.bills ?? { upcoming: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91_plus: 0 }} />
          <AgingLegend />
        </Card>
      </div>

      {/* D. Income + P&L */}
      <div className="grid md:grid-cols-2 gap-3">
        <Card title="Income" right={<PeriodSelect value={incomePeriod} onChange={setIncomePeriod} />}>
          <p className="text-sm text-zinc-400 mb-2">
            INCOME <span className="text-green-400 font-semibold">{rm(incomeWindow, hidden)}</span>{' '}
            <span className="text-zinc-500">{incomePeriod}-DAY</span>
          </p>
          <AreaLineChart
            points={daily.slice(-incomePeriod).map(d => ({ label: d.label, value: d.income }))}
            color="#22c55e"
          />
        </Card>

        <Card title="Profit & Loss" right={<PeriodSelect value={plPeriod} onChange={setPlPeriod} />}>
          <p className="text-sm text-zinc-400 mb-2">
            NET <span className={`font-semibold ${plNet >= 0 ? 'text-green-400' : 'text-red-400'}`}>{rm(plNet, hidden)}</span>
          </p>
          <ComboBarLine
            points={daily.slice(-plPeriod).map(d => ({ label: d.label, bar: d.income, line: d.net }))}
          />
        </Card>
      </div>

      {/* E. Cashflow */}
      <div className="grid md:grid-cols-2 gap-3">
        <Card
          title="Cashflow Trend"
          right={<span className="text-xs text-zinc-400 bg-zinc-900 border border-zinc-700 rounded-full px-2.5 py-1">14-Day</span>}
        >
          <CashflowChart
            mode="history"
            hidden={hidden}
            points={daily.slice(-14).map(d => ({ label: d.label, flow: d.net, balance: d.cumulative }))}
          />
        </Card>

        <Card
          title="Cashflow Forecast"
          right={<span className="text-xs text-zinc-400 bg-zinc-900 border border-zinc-700 rounded-full px-2.5 py-1">14-Day</span>}
        >
          <CashflowChart
            mode="forecast"
            hidden={hidden}
            points={forecast.map(f => ({ label: f.label, flow: 0, balance: f.balance }))}
          />
        </Card>
      </div>

      {/* F. Bank Accounts + Recent Sales */}
      <div className="grid md:grid-cols-2 gap-3">
        <Card title="Bank Accounts">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-300">Cash on Hand</span>
            <span className={`font-mono ${cashOnHand < 0 ? 'text-red-400' : 'text-zinc-200'}`}>
              {rm(cashOnHand, hidden)}
            </span>
          </div>
        </Card>

        <Card title="Recent Sales">
          {recentSales.length === 0 ? (
            <p className="text-zinc-600 text-sm">No recent sales.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {recentSales.map((s, i) => (
                    <tr key={`${s.ref}-${i}`} className="border-b border-zinc-900 last:border-0">
                      <td className="py-1.5 pr-3 text-zinc-400 whitespace-nowrap">{s.date}</td>
                      <td className="py-1.5 pr-3 text-sky-400 whitespace-nowrap">{s.ref}</td>
                      <td className="py-1.5 pr-3 text-zinc-300 truncate max-w-[160px]">{s.label}</td>
                      <td className="py-1.5 text-right font-mono text-zinc-200 whitespace-nowrap">{rm(s.amount, hidden)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* G. Breakdowns */}
      <div className="grid md:grid-cols-2 gap-3">
        <Card title="Income Breakdown" right={<PeriodSelect value={incBreakPeriod} onChange={setIncBreakPeriod} />}>
          <p className="text-sm text-zinc-400 mb-3">
            TOTAL <span className="text-green-400 font-semibold">{rm(sumRows(incomeRows), hidden)}</span>
          </p>
          <BreakdownPie rows={incomeRows} hidden={hidden} palette={INCOME_PIE} />
        </Card>

        <Card title="Expense Breakdown" right={<PeriodSelect value={expBreakPeriod} onChange={setExpBreakPeriod} />}>
          <p className="text-sm text-zinc-400 mb-3">
            TOTAL <span className="text-red-400 font-semibold">{rm(sumRows(expenseRows), hidden)}</span>
          </p>
          <BreakdownPie rows={expenseRows} hidden={hidden} palette={EXPENSE_PIE} />
        </Card>
      </div>
    </div>
  )
}
