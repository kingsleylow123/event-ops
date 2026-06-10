'use client'
import { useState } from 'react'
import Link from 'next/link'
import type { Event, Attendee } from '@/lib/supabase'
import { TICKET_LABELS } from '@/lib/supabase'
import { pickActiveEvent } from '@/lib/event'
import { rmShort, fmtDate } from '@/lib/format'
import { useRevenueHidden } from '@/lib/useRevenueHidden'
import { useCachedFetch } from '@/lib/useCachedFetch'

export default function Dashboard() {
  const [revenueHidden, toggleRevenue] = useRevenueHidden()
  const [bukkuBusy, setBukkuBusy] = useState(false)
  const [bukkuMsg, setBukkuMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const { data: me } = useCachedFetch<{ is_admin: boolean }>('me', '/api/me')
  const isAdmin = !!me?.is_admin

  const { data: events, loading: loadingEvents } = useCachedFetch<Event[]>('events', '/api/events')
  const event = events ? pickActiveEvent(events) : null

  const { data: attData } = useCachedFetch<Attendee[]>(
    event ? `attendees:${event.id}` : null,
    event ? `/api/attendees?event_id=${event.id}` : null,
    !!event,
  )
  const attendees = attData ?? []
  // Spinner only when we have NO cached events yet (first ever load)
  const loading = loadingEvents && !events

  const paid = attendees.filter(a => a.payment_status === 'paid')
  const pending = attendees.filter(a => a.payment_status === 'pending')
  const free = attendees.filter(a => a.payment_status === 'free')
  const revenue = paid.reduce((sum, a) => sum + (a.payment_amount ?? 0), 0)
  const attended = attendees.filter(a => a.attendance_confirmed)

  const byTicket = Object.entries(
    attendees.reduce<Record<string, number>>((acc, a) => {
      acc[a.ticket_type] = (acc[a.ticket_type] ?? 0) + 1
      return acc
    }, {})
  )

  async function syncCustomersToBukku() {
    if (!event) return
    const named = attendees.filter(a => a.name && a.name.trim())
    if (named.length === 0) { setBukkuMsg({ ok: false, text: 'No customers to add for this event.' }); return }
    if (!window.confirm(
      `Add ${named.length} customer${named.length === 1 ? '' : 's'} to your Bukku Contacts.\n\n` +
      `This writes to your REAL Bukku books. Continue?`
    )) return
    setBukkuBusy(true)
    setBukkuMsg(null)
    try {
      const res = await fetch('/api/bukku/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: event.id }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setBukkuMsg({ ok: false, text: data.error ? `${data.error}${data.details ? ' — ' + data.details : ''}` : `Failed (${res.status})` })
      } else {
        const parts = [`${data.created} added`, `${data.reused} already there`]
        if (data.failed_count) parts.push(`${data.failed_count} failed`)
        setBukkuMsg({ ok: true, text: `✅ ${parts.join(', ')}` })
      }
    } catch (e) {
      setBukkuMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBukkuBusy(false)
    }
  }

  if (loading) return <div className="text-zinc-500 mt-20 text-center">Loading...</div>

  return (
    <div className="space-y-6">
      {event ? (
        <div className="theme-surface theme-border border rounded-xl p-4 sm:p-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-amber-500 font-semibold uppercase tracking-widest mb-1">Active Event</p>
            <h1 className="text-xl sm:text-2xl font-bold theme-text">{event.name}</h1>
            <div className="flex flex-wrap gap-2 sm:gap-4 mt-2 text-sm theme-muted">
              {event.date && <span>📅 {fmtDate(event.date)}</span>}
              {event.venue && <span>📍 {event.venue}</span>}
              {event.capacity && <span>👥 Capacity: {event.capacity}</span>}
            </div>
          </div>
          <Link href="/events" className="theme-faint theme-border text-xs hover:text-amber-500 border rounded px-3 py-1.5 flex-shrink-0">Manage Events</Link>
        </div>
      ) : (
        <div className="theme-surface theme-border border rounded-xl p-5 text-center">
          <p className="theme-muted mb-3">No active event. Create one to get started.</p>
          <Link href="/events" className="bg-amber-500 hover:bg-amber-400 text-black font-semibold px-4 py-2 rounded-lg text-sm">Create Event</Link>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        {[
          { label: 'Total', value: attendees.length, color: 'theme-text', adminOnly: false },
          { label: 'Paid', value: paid.length, color: 'text-green-500', adminOnly: false },
          { label: 'Pending', value: pending.length, color: 'text-yellow-500', adminOnly: true },
          { label: 'Free', value: free.length, color: 'text-blue-500', adminOnly: true },
          { label: 'Attended', value: attended.length, color: 'text-purple-500', adminOnly: false },
          { label: 'Revenue', value: rmShort(revenue), color: 'text-amber-500', adminOnly: true },
        ].filter(s => !s.adminOnly || isAdmin).map(s => {
          const isRevenue = s.label === 'Revenue'
          const displayValue = isRevenue && revenueHidden ? 'RM ••••••' : s.value
          return (
            <div key={s.label} className="theme-surface theme-border border rounded-xl p-3 sm:p-4 relative">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs theme-faint">{s.label}</p>
                {isRevenue && (
                  <button
                    onClick={toggleRevenue}
                    title={revenueHidden ? 'Show revenue' : 'Hide revenue'}
                    className="theme-faint hover:text-amber-500 text-sm leading-none"
                  >
                    {revenueHidden ? '👁' : '🙈'}
                  </button>
                )}
              </div>
              <p className={`text-xl sm:text-2xl font-bold ${s.color}`}>{displayValue}</p>
            </div>
          )
        })}
      </div>

      {isAdmin && byTicket.length > 0 && (
        <div className="theme-surface theme-border border rounded-xl p-4 sm:p-5">
          <h2 className="text-sm font-semibold theme-muted mb-4">Ticket Breakdown</h2>
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[280px]">
            <thead>
              <tr className="theme-faint theme-border text-left border-b">
                <th className="pb-2">Ticket Type</th>
                <th className="pb-2 text-right">Count</th>
                <th className="pb-2 text-right">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {byTicket.map(([type, count]) => (
                <tr key={type} className="theme-border border-b">
                  <td className="py-2 theme-text">{TICKET_LABELS[type as keyof typeof TICKET_LABELS] ?? type}</td>
                  <td className="py-2 text-right font-mono theme-text">{count}</td>
                  <td className="py-2 text-right theme-muted">{Math.round((count / attendees.length) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {isAdmin && event && (
        <div className="theme-surface theme-border border rounded-xl p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-semibold theme-text">Customers → Bukku</h2>
              <p className="text-xs theme-faint mt-0.5">Add these {attendees.length} attendees to your Bukku Contacts as customers (name · phone · email).</p>
            </div>
            <button onClick={syncCustomersToBukku} disabled={bukkuBusy || attendees.length === 0}
              className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold px-4 py-2 rounded-lg text-sm whitespace-nowrap">
              {bukkuBusy ? '⏳ Syncing…' : '📇 Add customers to Bukku'}
            </button>
          </div>
          {bukkuMsg && (
            <div className={`mt-3 text-sm font-medium rounded-lg px-3 py-2 border ${bukkuMsg.ok ? 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10' : 'text-red-500 border-red-500/30 bg-red-500/10'}`}>
              {bukkuMsg.text}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3 flex-wrap">
        <Link href="/attendees" className="bg-amber-500 hover:bg-amber-400 text-black font-semibold px-4 py-2 rounded-lg text-sm">View Attendees</Link>
        <Link href="/checklist" className="theme-surface-2 theme-text theme-border border hover:border-amber-500/50 font-semibold px-4 py-2 rounded-lg text-sm">View Checklist</Link>
      </div>
    </div>
  )
}
