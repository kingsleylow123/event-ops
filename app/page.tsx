'use client'
import Link from 'next/link'
import type { Event, Attendee } from '@/lib/supabase'
import { TICKET_LABELS } from '@/lib/supabase'
import { pickActiveEvent } from '@/lib/event'
import { rmShort, fmtDate } from '@/lib/format'
import { useRevenueHidden } from '@/lib/useRevenueHidden'
import { useCachedFetch } from '@/lib/useCachedFetch'

export default function Dashboard() {
  const [revenueHidden, toggleRevenue] = useRevenueHidden()

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

  if (loading) return <div className="text-zinc-500 mt-20 text-center">Loading...</div>

  return (
    <div className="space-y-6">
      {event ? (
        <div className="bg-[#111] border border-zinc-800 rounded-xl p-4 sm:p-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-amber-400 font-semibold uppercase tracking-widest mb-1">Active Event</p>
            <h1 className="text-xl sm:text-2xl font-bold">{event.name}</h1>
            <div className="flex flex-wrap gap-2 sm:gap-4 mt-2 text-sm text-zinc-400">
              {event.date && <span>📅 {fmtDate(event.date)}</span>}
              {event.venue && <span>📍 {event.venue}</span>}
              {event.capacity && <span>👥 Capacity: {event.capacity}</span>}
            </div>
          </div>
          <Link href="/events" className="text-xs text-zinc-500 hover:text-white border border-zinc-700 rounded px-3 py-1.5 flex-shrink-0">Manage Events</Link>
        </div>
      ) : (
        <div className="bg-[#111] border border-zinc-800 rounded-xl p-5 text-center">
          <p className="text-zinc-400 mb-3">No active event. Create one to get started.</p>
          <Link href="/events" className="bg-amber-500 hover:bg-amber-400 text-black font-semibold px-4 py-2 rounded-lg text-sm">Create Event</Link>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        {[
          { label: 'Total', value: attendees.length, color: 'text-white', adminOnly: false },
          { label: 'Paid', value: paid.length, color: 'text-green-400', adminOnly: false },
          { label: 'Pending', value: pending.length, color: 'text-yellow-400', adminOnly: true },
          { label: 'Free', value: free.length, color: 'text-blue-400', adminOnly: true },
          { label: 'Attended', value: attended.length, color: 'text-purple-400', adminOnly: false },
          { label: 'Revenue', value: rmShort(revenue), color: 'text-amber-400', adminOnly: true },
        ].filter(s => !s.adminOnly || isAdmin).map(s => {
          const isRevenue = s.label === 'Revenue'
          const displayValue = isRevenue && revenueHidden ? 'RM ••••••' : s.value
          return (
            <div key={s.label} className="bg-[#111] border border-zinc-800 rounded-xl p-3 sm:p-4 relative">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-zinc-500">{s.label}</p>
                {isRevenue && (
                  <button
                    onClick={toggleRevenue}
                    title={revenueHidden ? 'Show revenue' : 'Hide revenue'}
                    className="text-zinc-600 hover:text-amber-400 text-sm leading-none"
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
        <div className="bg-[#111] border border-zinc-800 rounded-xl p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-zinc-400 mb-4">Ticket Breakdown</h2>
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[280px]">
            <thead>
              <tr className="text-left text-zinc-500 border-b border-zinc-800">
                <th className="pb-2">Ticket Type</th>
                <th className="pb-2 text-right">Count</th>
                <th className="pb-2 text-right">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {byTicket.map(([type, count]) => (
                <tr key={type} className="border-b border-zinc-900">
                  <td className="py-2">{TICKET_LABELS[type as keyof typeof TICKET_LABELS] ?? type}</td>
                  <td className="py-2 text-right font-mono">{count}</td>
                  <td className="py-2 text-right text-zinc-400">{Math.round((count / attendees.length) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <div className="flex gap-3 flex-wrap">
        <Link href="/attendees" className="bg-amber-500 hover:bg-amber-400 text-black font-semibold px-4 py-2 rounded-lg text-sm">View Attendees</Link>
        <Link href="/checklist" className="bg-zinc-800 hover:bg-zinc-700 text-white font-semibold px-4 py-2 rounded-lg text-sm">View Checklist</Link>
      </div>
    </div>
  )
}
