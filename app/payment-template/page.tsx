'use client'
import { useEffect, useState } from 'react'
import type { Event, Attendee } from '@/lib/supabase'
import { TICKET_LABELS } from '@/lib/supabase'

export default function PaymentTemplatePage() {
  const [events, setEvents] = useState<Event[]>([])
  const [attendees, setAttendees] = useState<Attendee[]>([])
  const [selectedEventId, setSelectedEventId] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const evRes = await fetch('/api/events', { cache: 'no-store' })
        if (evRes.ok) {
          const list: Event[] = await evRes.json()
          setEvents(list)
          const active = list.find(e => e.is_active) ?? list[0]
          if (active) setSelectedEventId(active.id)
        }
      } finally { setLoading(false) }
    }
    load()
  }, [])

  useEffect(() => {
    if (!selectedEventId) return
    fetch(`/api/attendees?event_id=${selectedEventId}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : [])
      .then(setAttendees)
  }, [selectedEventId])

  const paid = attendees.filter(a =>
    a.payment_status === 'paid' &&
    (a.notes as string | null) !== 'upgrade_payment' &&
    a.payment_method !== 'free' &&
    Number(a.payment_amount) > 0
  )
  const vip = paid.filter(a => a.ticket_type.includes('vip'))
  const general = paid.filter(a => !a.ticket_type.includes('vip'))
  const vipTotal = vip.reduce((s, a) => s + Number(a.payment_amount), 0)
  const genTotal = general.reduce((s, a) => s + Number(a.payment_amount), 0)

  function methodLabel(m: string) {
    return m === 'stripe' ? 'Stripe' : m === 'bank_transfer' ? 'Bank Transfer' : m
  }

  function Table({ rows }: { rows: Attendee[] }) {
    return (
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-zinc-500 border-b border-zinc-800">
            <th className="pb-2 pr-4">#</th>
            <th className="pb-2 pr-4">Name</th>
            <th className="pb-2 pr-4">Phone</th>
            <th className="pb-2 pr-4">Ticket</th>
            <th className="pb-2 pr-4 text-right">Amount</th>
            <th className="pb-2">Method</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a, i) => (
            <tr key={a.id} className="border-b border-zinc-900">
              <td className="py-3 pr-4 text-zinc-600">{i + 1}</td>
              <td className="py-3 pr-4 font-medium">{a.name}</td>
              <td className="py-3 pr-4 text-zinc-400">{a.phone || '—'}</td>
              <td className="py-3 pr-4 text-zinc-400 text-xs">{TICKET_LABELS[a.ticket_type as keyof typeof TICKET_LABELS] ?? a.ticket_type}</td>
              <td className="py-3 pr-4 text-right font-semibold text-amber-400">RM {Number(a.payment_amount).toLocaleString()}</td>
              <td className="py-3 text-zinc-400">{methodLabel(a.payment_method)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  if (loading) return <div className="text-zinc-500 mt-20 text-center">Loading…</div>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">📋 Payment Template</h1>
        <select value={selectedEventId} onChange={e => setSelectedEventId(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
          {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
        </select>
      </div>

      {/* VIP */}
      <div className="bg-[#111] border border-zinc-800 rounded-xl p-5">
        <div className="flex justify-between items-center mb-4">
          <p className="text-sm font-bold text-blue-400 uppercase tracking-wider">🔵 VIP</p>
          <p className="text-sm font-bold text-amber-400">RM {vipTotal.toLocaleString()}</p>
        </div>
        {vip.length ? <Table rows={vip} /> : <p className="text-zinc-600 text-sm">No VIP paid yet.</p>}
      </div>

      {/* General */}
      <div className="bg-[#111] border border-zinc-800 rounded-xl p-5">
        <div className="flex justify-between items-center mb-4">
          <p className="text-sm font-bold text-green-400 uppercase tracking-wider">🟢 General</p>
          <p className="text-sm font-bold text-amber-400">RM {genTotal.toLocaleString()}</p>
        </div>
        {general.length ? <Table rows={general} /> : <p className="text-zinc-600 text-sm">No General paid yet.</p>}
      </div>

      {/* Total */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-5 py-4 flex justify-between items-center">
        <p className="font-bold text-amber-400">💰 TOTAL COLLECTED</p>
        <p className="text-2xl font-black text-amber-400">RM {(vipTotal + genTotal).toLocaleString()}</p>
      </div>
    </div>
  )
}
