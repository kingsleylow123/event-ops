'use client'
import { useEffect, useState } from 'react'
import type { Event, Attendee } from '@/lib/supabase'
import { TICKET_LABELS } from '@/lib/supabase'

const DEFAULT_TEXT = `Event Payment Template

Pay in Full

VIP (name + payment method)
1. Ethan (Stripe RM2899)
2. Nick (Stripe RM2899)
3. Melanie (Bank transfer RM2899)
4.
5.

General (name + payment method)
1. Steve Wong (Stripe RM2299)
2. Melanie (Bank transfer RM2299)
3. Jeremy | Daphne (TnG RM2299)
4.
5.
6.
7.
8.
9.
10.

👉 Pay deposit (name + action item)

1. Ralph - RM500 deposit, hold for next event after September, flying Netherlands summer
2. Jeremy | Daphne (TnG RM1799)(RM2000) 1VIP, 3General
3.`

export default function PaymentTemplatePage() {
  const [events, setEvents] = useState<Event[]>([])
  const [attendees, setAttendees] = useState<Attendee[]>([])
  const [selectedEventId, setSelectedEventId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState(DEFAULT_TEXT)
  const [copied, setCopied] = useState(false)

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

  function Table({ rows, color }: { rows: Attendee[], color: string }) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className={`text-left text-xs border-b border-zinc-800 ${color}`}>
              <th className="pb-2 pr-3">#</th>
              <th className="pb-2 pr-3">Name</th>
              <th className="pb-2 pr-3">Phone</th>
              <th className="pb-2 pr-3">Ticket</th>
              <th className="pb-2 pr-3 text-right">Amount</th>
              <th className="pb-2">Method</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a, i) => (
              <tr key={a.id} className="border-b border-zinc-900 hover:bg-zinc-900/30">
                <td className="py-2.5 pr-3 text-zinc-600 text-xs">{i + 1}</td>
                <td className="py-2.5 pr-3 font-medium text-white">{a.name}</td>
                <td className="py-2.5 pr-3 text-zinc-400 text-xs">{a.phone || '—'}</td>
                <td className="py-2.5 pr-3 text-zinc-400 text-xs">{TICKET_LABELS[a.ticket_type as keyof typeof TICKET_LABELS] ?? a.ticket_type}</td>
                <td className="py-2.5 pr-3 text-right font-semibold text-amber-400">RM {Number(a.payment_amount).toLocaleString()}</td>
                <td className="py-2.5 text-zinc-400 text-xs">{methodLabel(a.payment_method)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (loading) return <div className="text-zinc-500 mt-20 text-center">Loading…</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">📋 Payment Template</h1>
        <select value={selectedEventId} onChange={e => setSelectedEventId(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
          {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
        </select>
      </div>

      {/* ── TABLE VIEW ── */}
      <div className="space-y-4">
        <div className="bg-[#111] border border-zinc-800 rounded-xl p-4 space-y-3">
          <div className="flex justify-between items-center">
            <p className="text-xs font-bold text-blue-400 uppercase tracking-wider">🔵 VIP</p>
            <p className="text-sm font-bold text-amber-400">RM {vipTotal.toLocaleString()}</p>
          </div>
          {vip.length ? <Table rows={vip} color="text-blue-400" /> : <p className="text-zinc-600 text-sm">No VIP yet.</p>}
        </div>

        <div className="bg-[#111] border border-zinc-800 rounded-xl p-4 space-y-3">
          <div className="flex justify-between items-center">
            <p className="text-xs font-bold text-green-400 uppercase tracking-wider">🟢 General</p>
            <p className="text-sm font-bold text-amber-400">RM {genTotal.toLocaleString()}</p>
          </div>
          {general.length ? <Table rows={general} color="text-green-400" /> : <p className="text-zinc-600 text-sm">No General yet.</p>}
        </div>

        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-5 py-4 flex justify-between items-center">
          <p className="font-bold text-amber-400">💰 TOTAL COLLECTED</p>
          <p className="text-2xl font-black text-amber-400">RM {(vipTotal + genTotal).toLocaleString()}</p>
        </div>
      </div>

      {/* ── TEXT TEMPLATE ── */}
      <div className="border-t border-zinc-800 pt-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">✏️ WhatsApp Template</p>
          <div className="flex gap-2">
            <button onClick={() => setText(DEFAULT_TEXT)}
              className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 rounded-lg px-3 py-1.5">Reset</button>
            <button onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
              className="bg-amber-500 hover:bg-amber-400 text-black font-bold px-4 py-1.5 rounded-lg text-xs">
              {copied ? '✅ Copied!' : '📋 Copy'}
            </button>
          </div>
        </div>
        <textarea value={text} onChange={e => setText(e.target.value)}
          className="w-full bg-transparent text-white text-sm leading-7 resize-none focus:outline-none"
          style={{ fontFamily: 'inherit', minHeight: '50vh' }}
          spellCheck={false} />
      </div>
    </div>
  )
}
