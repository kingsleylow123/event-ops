'use client'
import { useEffect, useMemo, useState } from 'react'
import type { Event } from '@/lib/supabase'
import { rm, r2 } from '@/lib/finance'
import { resolveInitialEvent, storeEventId } from '@/lib/event'
import { useCachedFetch } from '@/lib/useCachedFetch'
import { useRevenueHidden } from '@/lib/useRevenueHidden'
import {
  buildScorecard, DEFAULT_ASSUMPTIONS, STATUS_COLOR, STATUS_LABEL,
  type ValuationAuto, type Assumptions, type MetricRow,
} from '@/lib/valuation'

const HEADING = 'text-sky-400 font-semibold text-sm'
const LS_KEY = 'valuation_assumptions_v1'

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
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

function fmtMetric(row: MetricRow, hidden: boolean): string {
  const v = row.raw
  if (row.kind === 'money') return rm(v ?? 0, hidden) === 'RM ••••••' && v == null ? '—' : (v == null ? '—' : rm(v, hidden))
  if (v == null && row.kind !== 'text') return '—'
  switch (row.kind) {
    case 'pct': return `${(v! * 100).toFixed(Math.abs(v!) < 0.1 && v !== 0 ? 1 : 0)}%`
    case 'ratio': return `${v!.toFixed(1)}×`
    case 'num': return Math.round(v!).toLocaleString()
    case 'months': return `${Math.round(v!)} mo`
    case 'text': return row.display ?? '—'
    default: return String(v)
  }
}

function MetricList({ rows, hidden }: { rows: MetricRow[]; hidden: boolean }) {
  return (
    <div className="flex flex-col">
      {rows.map(r => (
        <div key={r.key} className="flex items-start justify-between gap-3 py-2 border-b border-zinc-900 last:border-0">
          <div className="min-w-0">
            <div className="text-sm text-zinc-200">{r.label}</div>
            <div className="text-[11px] text-zinc-500">{r.benchmark}{r.note ? ` · ${r.note}` : ''}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono text-sm text-zinc-100 tabular-nums">{fmtMetric(r, hidden)}</span>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
              style={{ color: STATUS_COLOR[r.status], background: `${STATUS_COLOR[r.status]}1f` }}>
              {STATUS_LABEL[r.status]}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

function NumberField({ label, value, onChange, prefix, suffix, placeholder }: {
  label: string; value: number | null; onChange: (v: number | null) => void
  prefix?: string; suffix?: string; placeholder?: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-zinc-400">{label}</span>
      <div className="flex items-center bg-zinc-900 border border-zinc-700 rounded-lg px-2 focus-within:border-amber-500/50">
        {prefix && <span className="text-zinc-500 text-xs">{prefix}</span>}
        <input
          type="number"
          value={value ?? ''}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
          className="w-full bg-transparent py-1.5 px-1 text-sm text-white outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        {suffix && <span className="text-zinc-500 text-xs">{suffix}</span>}
      </div>
    </label>
  )
}

export default function ValuationPage() {
  const { data: eventsData } = useCachedFetch<Event[]>('events', '/api/events')
  const [events, setEvents] = useState<Event[]>([])
  const [scope, setScope] = useState<string>('all')
  const [auto, setAuto] = useState<ValuationAuto | null>(null)
  const [loading, setLoading] = useState(true)
  const [hidden, toggleHidden] = useRevenueHidden()
  const [assumptions, setAssumptions] = useState<Assumptions | null>(null)

  useEffect(() => { if (eventsData) setEvents(eventsData) }, [eventsData])
  useEffect(() => {
    if (!eventsData) return
    setScope(prev => (prev && prev !== 'all') ? prev : (resolveInitialEvent(eventsData)?.id ? 'all' : 'all'))
  }, [eventsData])

  // Load saved assumptions once (client only).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) setAssumptions({ ...DEFAULT_ASSUMPTIONS, ...JSON.parse(raw) })
    } catch { /* ignore */ }
  }, [])

  // Fetch auto metrics on scope change.
  useEffect(() => {
    const ctrl = new AbortController()
    let ignore = false
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/valuation?event_id=${scope}`, { cache: 'no-store', signal: ctrl.signal })
        if (!ignore && res.ok) setAuto(await res.json())
      } catch { /* keep last good */ }
      finally { if (!ignore) setLoading(false) }
    })()
    return () => { ignore = true; ctrl.abort() }
  }, [scope])

  // Seed assumptions from data the first time, if nothing saved yet.
  useEffect(() => {
    if (!auto || assumptions) return
    const months = Math.max(1, auto.monthly.length)
    setAssumptions({
      ...DEFAULT_ASSUMPTIONS,
      cashBalance: Math.max(0, auto.netProfit),
      monthlyBurn: r2(auto.costsTotal / months),
    })
  }, [auto, assumptions])

  function update(key: keyof Assumptions, v: number | null) {
    setAssumptions(prev => {
      const next = { ...(prev ?? DEFAULT_ASSUMPTIONS), [key]: key === 'multipleOverride' ? v : (v ?? 0) }
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  const a = assumptions ?? DEFAULT_ASSUMPTIONS
  const card = useMemo(() => (auto ? buildScorecard(auto, a) : null), [auto, a])

  function changeScope(s: string) { setScope(s); if (s !== 'all') storeEventId(s) }

  if (loading && !auto) return <div className="text-zinc-500 mt-20 text-center">Loading…</div>
  if (!auto || !card) return <div className="text-zinc-500 mt-20 text-center">No data.</div>

  const v = card.valuation
  const range = (lo: number, hi: number) => `${rm(lo, hidden)} – ${rm(hi, hidden)}`

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Valuation & Traction</h1>
          <p className="text-sm text-zinc-400">YC-lens scorecard · {auto.scope_label}</p>
        </div>
        <div className="flex gap-2 items-center">
          <button onClick={toggleHidden} title={hidden ? 'Show figures' : 'Hide figures'}
            className="text-zinc-500 hover:text-amber-400 text-base leading-none px-1">{hidden ? '👁' : '🙈'}</button>
          <select value={scope} onChange={e => changeScope(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
            <option value="all">All events</option>
            {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
        </div>
      </div>

      {/* Valuation headline */}
      <div className="rounded-xl p-5 text-white bg-gradient-to-br from-indigo-600 to-violet-700">
        <p className="text-[11px] uppercase tracking-wide font-medium text-indigo-100">Estimated valuation (directional)</p>
        <p className="text-3xl font-bold mt-1">{range(v.blendedLow, v.blendedHigh)}</p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-sm text-indigo-100">
          <span>Midpoint <span className="font-semibold text-white">{rm(v.blendedBase, hidden)}</span></span>
          <span>Your stake ({a.ownershipPct}%) <span className="font-semibold text-white">{rm(v.equityValue, hidden)}</span></span>
          <span>ARR basis <span className="font-semibold text-white">{rm(v.arr, hidden)}</span></span>
        </div>
      </div>

      {/* Method cards */}
      <div className="grid md:grid-cols-3 gap-3">
        {v.methods.map(m => (
          <div key={m.name} className="bg-[#111] border border-zinc-800 rounded-xl p-4">
            <p className="text-sky-400 font-semibold text-sm">{m.name}</p>
            <p className="text-xl font-bold mt-1">{rm(m.base, hidden)}</p>
            <p className="text-xs text-zinc-400 mt-0.5">{range(m.low, m.high)}</p>
            <p className="text-[11px] text-zinc-500 mt-2 leading-snug">{hidden ? 'Unhide revenue to see the basis.' : m.rationale}</p>
          </div>
        ))}
      </div>

      {/* Snapshot */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total revenue', value: rm(auto.totalRevenue, hidden) },
          { label: 'Net profit', value: rm(auto.netProfit, hidden) },
          { label: 'Paid attendees', value: auto.paidAttendees.toLocaleString() },
          { label: 'Community size', value: a.communitySize.toLocaleString() },
        ].map(k => (
          <div key={k.label} className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
            <p className="text-[11px] text-zinc-500">{k.label}</p>
            <p className="text-lg font-bold mt-0.5 tabular-nums">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Assumptions */}
      <Card title="Assumptions" right={<span className="text-[11px] text-zinc-500">saved in your browser</span>}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <NumberField label="Cash balance" prefix="RM" value={a.cashBalance} onChange={x => update('cashBalance', x)} />
          <NumberField label="Monthly burn" prefix="RM" value={a.monthlyBurn} onChange={x => update('monthlyBurn', x)} />
          <NumberField label="Monthly ad spend" prefix="RM" value={a.monthlyAdSpend} onChange={x => update('monthlyAdSpend', x)} />
          <NumberField label="Community size" value={a.communitySize} onChange={x => update('communitySize', x)} />
          <NumberField label="B2B annual revenue" prefix="RM" value={a.b2bAnnualRevenue} onChange={x => update('b2bAnnualRevenue', x)} />
          <NumberField label="Your ownership" suffix="%" value={a.ownershipPct} onChange={x => update('ownershipPct', x)} />
          <NumberField label="Revenue multiple" suffix="×" placeholder="auto" value={a.multipleOverride} onChange={x => update('multipleOverride', x)} />
        </div>
      </Card>

      {/* Stage tiers */}
      <div className="grid lg:grid-cols-3 gap-3">
        <Card title="🟢 Startup — default-alive & growing">
          <MetricList rows={card.startup} hidden={hidden} />
        </Card>
        <Card title="🟡 Traction — efficient & durable">
          <MetricList rows={card.traction} hidden={hidden} />
        </Card>
        <Card title="🔵 IPO-readiness — big & predictable">
          <MetricList rows={card.ipo} hidden={hidden} />
        </Card>
      </div>

      <p className="text-[11px] text-zinc-600 leading-relaxed">
        Directional estimate only — assumption-driven, not a formal valuation or financial advice.
        Auto metrics come from live EventOps data; cash, burn, ad spend, B2B revenue and ownership are your manual inputs above.
      </p>
    </div>
  )
}
