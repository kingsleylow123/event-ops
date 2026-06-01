'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Event, Attendee } from '@/lib/supabase'

export default function PaymentTemplatePage() {
  const [events, setEvents] = useState<Event[]>([])
  const [attendees, setAttendees] = useState<Attendee[]>([])
  const [selectedEventId, setSelectedEventId] = useState<string>('')
  const [depositText, setDepositText] = useState<string>('')
  const [copied, setCopied] = useState(false)
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
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  useEffect(() => {
    if (!selectedEventId) return
    fetch(`/api/attendees?event_id=${selectedEventId}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : [])
      .then(setAttendees)
  }, [selectedEventId])

  useEffect(() => {
    if (!selectedEventId) return
    const saved = localStorage.getItem(`deposit_text_${selectedEventId}`)
    setDepositText(saved ?? '')
  }, [selectedEventId])

  const handleDepositChange = useCallback((val: string) => {
    setDepositText(val)
    if (selectedEventId) localStorage.setItem(`deposit_text_${selectedEventId}`, val)
  }, [selectedEventId])

  const selectedEvent = events.find(ev => ev.id === selectedEventId)

  const { vipAttendees, generalAttendees } = useMemo(() => {
    const paid = attendees.filter(a =>
      a.payment_status === 'paid' &&
      (a.notes as string | null) !== 'upgrade_payment' &&
      a.payment_method !== 'free' &&
      Number(a.payment_amount) > 0
    )
    return {
      vipAttendees: paid.filter(a => a.ticket_type.includes('vip')),
      generalAttendees: paid.filter(a => !a.ticket_type.includes('vip')),
    }
  }, [attendees])

  function paymentLabel(a: Attendee) {
    return a.payment_method === 'stripe' ? 'Stripe' : 'Bank Transfer'
  }

  function buildText() {
    const name = selectedEvent?.name ?? '[Event Name]'
    const lines = [
      `Claude Malaysia Workshop — ${name}`,
      'Payment Status', '',
      '✅ Pay in Full', '',
      'VIP (Name + Payment Method)',
      ...(vipAttendees.length ? vipAttendees.map((a, i) => `${i + 1}. ${a.name} — ${paymentLabel(a)}`) : ['(none)']),
      '',
      'General (Name + Payment Method)',
      ...(generalAttendees.length ? generalAttendees.map((a, i) => `${i + 1}. ${a.name} — ${paymentLabel(a)}`) : ['(none)']),
      '',
      '👉 Pay Deposit (Name + Action Item)',
      ...(depositText.trim()
        ? depositText.trim().split('\n').map((l, i) => `${i + 1}. ${l}`)
        : ['(none)']),
    ]
    return lines.join('\n')
  }

  const preview = useMemo(buildText, [selectedEventId, vipAttendees, generalAttendees, depositText]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCopy() {
    await navigator.clipboard.writeText(buildText())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) return <div className="text-zinc-500 mt-20 text-center">Loading…</div>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">📋 Payment Template</h1>
        <select
          value={selectedEventId}
          onChange={e => setSelectedEventId(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm"
        >
          {events.map(ev => (
            <option key={ev.id} value={ev.id}>{ev.name}</option>
          ))}
        </select>
      </div>

      {/* Template preview */}
      <div className="bg-[#111] border border-zinc-800 rounded-xl p-5 font-mono text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">
        {preview}
      </div>

      {/* Deposit entries */}
      <div>
        <label className="text-xs text-zinc-500 uppercase tracking-wider block mb-1.5">
          👉 Deposit entries <span className="normal-case text-zinc-600">(one per line)</span>
        </label>
        <textarea
          value={depositText}
          onChange={e => handleDepositChange(e.target.value)}
          rows={5}
          placeholder={'Ralph — RM 500 deposit, flying from Netherlands\nAmy — RM 300 deposit'}
          className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm font-mono resize-y focus:outline-none focus:border-amber-500"
        />
      </div>

      <button
        onClick={handleCopy}
        className="bg-amber-500 hover:bg-amber-400 text-black font-bold px-6 py-2.5 rounded-lg text-sm"
      >
        {copied ? '✅ Copied!' : '📋 Copy to clipboard'}
      </button>
    </div>
  )
}
