'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Event } from '@/lib/supabase'
import { useCachedFetch } from '@/lib/useCachedFetch'
import { resolveInitialEvent, storeEventId } from '@/lib/event'

const MYT_MS = 8 * 3600 * 1000
const todayMYT = () => new Date(Date.now() + MYT_MS).toISOString().slice(0, 10)
const firstOfMonth = (k: string) => k.slice(0, 8) + '01'

type Preset = 'event-lifetime' | 'this-month' | 'last-month' | 'this-year' | 'last-30' | 'custom'

function rangeForPreset(p: Preset): { from: string; to: string } {
  const today = todayMYT()
  const [y, m] = today.split('-').map(Number)
  if (p === 'this-month') return { from: firstOfMonth(today), to: today }
  if (p === 'last-month') {
    const prev = new Date(Date.UTC(y, m - 2, 1))
    const first = prev.toISOString().slice(0, 10)
    const last = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10)
    return { from: first, to: last }
  }
  if (p === 'this-year') return { from: `${y}-01-01`, to: today }
  if (p === 'last-30') {
    const fromMs = Date.parse(today + 'T00:00:00Z') - 29 * 86400000
    return { from: new Date(fromMs).toISOString().slice(0, 10), to: today }
  }
  if (p === 'event-lifetime') return { from: '1900-01-01', to: '2999-12-31' }
  return { from: firstOfMonth(today), to: today }
}

function prettyRange(from: string, to: string) {
  const fmt = (k: string) => `${k.slice(8, 10)}/${k.slice(5, 7)}/${k.slice(0, 4)}`
  return `${fmt(from)} - ${fmt(to)}`
}

export type ReportFilters = {
  scope: string // event id or 'all'
  from: string
  to: string
  lifetime: boolean // true → API skips date filter and returns all-time for the event
}

export default function ReportLayout({
  title,
  subtitle,
  showEventFilter = true,
  showDateFilter = true,
  initialPreset = 'this-month',
  onFilters,
  children,
}: {
  title: string
  subtitle?: string
  showEventFilter?: boolean
  showDateFilter?: boolean
  initialPreset?: Preset
  onFilters: (f: ReportFilters) => void
  children: React.ReactNode
}) {
  const { data: eventsData } = useCachedFetch<Event[]>('events', '/api/events')
  const [scope, setScope] = useState<string>('all')
  const [preset, setPreset] = useState<Preset>(initialPreset)
  const initial = rangeForPreset(initialPreset)
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)

  useEffect(() => {
    if (!eventsData) return
    setScope(prev => prev !== 'all' ? prev : (resolveInitialEvent(eventsData)?.id ?? 'all'))
  }, [eventsData])

  // If the user picks "All events" while on Event Lifetime, snap back to This Month —
  // lifetime is only meaningful when scoped to a single event.
  useEffect(() => {
    if (scope === 'all' && preset === 'event-lifetime') {
      changePreset('this-month')
    }
  }, [scope, preset])

  // Fire whenever any filter changes.
  useEffect(() => {
    onFilters({ scope, from, to, lifetime: preset === 'event-lifetime' })
  }, [scope, from, to, preset, onFilters])

  function changePreset(p: Preset) {
    setPreset(p)
    if (p !== 'custom') {
      const r = rangeForPreset(p)
      setFrom(r.from)
      setTo(r.to)
    }
  }

  function changeScope(s: string) {
    setScope(s)
    if (s !== 'all') storeEventId(s)
  }

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <Link href="/finance/reports" className="hover:text-zinc-300 inline-flex items-center gap-1">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Reports
        </Link>
        <span>/</span>
        <span className="text-zinc-200">{title}</span>
      </div>

      {/* Filter card */}
      {(showDateFilter || showEventFilter) && (
        <div className="bg-[#111] border border-zinc-800 rounded-xl p-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {showDateFilter && (
              <div>
                <label className="text-xs text-zinc-500 font-medium">Preset Period</label>
                <select
                  value={preset}
                  onChange={e => changePreset(e.target.value as Preset)}
                  className="w-full mt-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200 text-sm"
                >
                  {scope !== 'all' && <option value="event-lifetime">Event Lifetime (all-time)</option>}
                  <option value="this-month">This Month</option>
                  <option value="last-month">Last Month</option>
                  <option value="this-year">This Year (till Date)</option>
                  <option value="last-30">Last 30 Days</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
            )}
            {showDateFilter && (
              <div>
                <label className="text-xs text-zinc-500 font-medium">
                  Date Range
                  {preset === 'event-lifetime' && <span className="ml-2 text-zinc-600">(ignored)</span>}
                </label>
                <div className="flex gap-1.5 items-center mt-1">
                  <input
                    type="date"
                    value={from}
                    disabled={preset === 'event-lifetime'}
                    onChange={e => { setFrom(e.target.value); setPreset('custom') }}
                    className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-2 text-zinc-200 text-sm disabled:opacity-40"
                  />
                  <span className="text-zinc-500">→</span>
                  <input
                    type="date"
                    value={to}
                    disabled={preset === 'event-lifetime'}
                    onChange={e => { setTo(e.target.value); setPreset('custom') }}
                    className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-2 text-zinc-200 text-sm disabled:opacity-40"
                  />
                </div>
              </div>
            )}
            {showEventFilter && (
              <div>
                <label className="text-xs text-zinc-500 font-medium">Event</label>
                <select
                  value={scope}
                  onChange={e => changeScope(e.target.value)}
                  className="w-full mt-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200 text-sm"
                >
                  <option value="all">All events</option>
                  {(eventsData ?? []).map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Report body */}
      <div className="bg-[#0f0f0f] border border-zinc-900 rounded-xl p-6 sm:p-8">
        <div className="text-center mb-6">
          <h1 className="text-lg font-semibold text-zinc-100">{title}</h1>
          {subtitle && <p className="text-xs text-zinc-400 mt-0.5">{subtitle}</p>}
          {showDateFilter && (
            <p className="text-xs text-zinc-500 mt-0.5">
              {preset === 'event-lifetime' ? 'Event Lifetime (all-time)' : prettyRange(from, to)}
            </p>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}
