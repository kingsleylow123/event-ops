'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Event, Attendee } from '@/lib/supabase'
import { TICKET_LABELS } from '@/lib/supabase'

export default function Dashboard() {
  const [event, setEvent] = useState<Event | null>(null)
  const [attendees, setAttendees] = useState<Attendee[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [revenueHidden, setRevenueHidden] = useState(false)

  // Persist revenue visibility across reloads
  useEffect(() => {
    const saved = localStorage.getItem('revenue_hidden')
    if (saved === '1') setRevenueHidden(true)
  }, [])
  function toggleRevenue() {
    setRevenueHidden(v => {
      const next = !v
      localStorage.setItem('revenue_hidden', next ? '1' : '0')
      return next
    })
  }

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setIsAdmin(d.is_admin) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    async function load() {
      try {
        const evRes = await fetch('/api/events', { cache: 'no-store' })
        if (!evRes.ok) throw new Error('API error')
        const events: Event[] = await evRes.json()
        const active = events.find(e => e.is_active) ?? null
        setEvent(active)
        if (active) {
          const attRes = await fetch(`/api/attendees?event_id=${active.id}`, { cache: 'no-store' })
          if (attRes.ok) setAttendees(await attRes.json())
        }
      } catch {
        // env vars not set yet or DB unreachable — show empty state
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

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
              {event.date && <span>📅 {new Date(event.date).toLocaleDateString('en-MY', { dateStyle: 'medium' })}</span>}
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
          { label: 'Revenue', value: `RM ${revenue.toLocaleString()}`, color: 'text-amber-400', adminOnly: true },
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
