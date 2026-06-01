'use client'
import { useEffect, useMemo, useState } from 'react'
import type { Event, Attendee } from '@/lib/supabase'

const BLANK_TEMPLATE = `Event Payment Template

Claude Malaysia Workshop — 1st June

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
2. Jeremy | Daphne (TnG RM1799)(RM2000) 1 VIP, 3 General
3.`

export default function PaymentTemplatePage() {
  const [events, setEvents] = useState<Event[]>([])
  const [attendees, setAttendees] = useState<Attendee[]>([])
  const [selectedEventId, setSelectedEventId] = useState<string>('')
  const [text, setText] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [initialized, setInitialized] = useState<string>('')

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

  const selectedEvent = events.find(ev => ev.id === selectedEventId)

  const initialTemplate = useMemo(() => {
    if (!selectedEventId) return ''
    const paid = attendees.filter(a =>
      a.payment_status === 'paid' &&
      (a.notes as string | null) !== 'upgrade_payment' &&
      a.payment_method !== 'free' &&
      Number(a.payment_amount) > 0
    )
    const vipCount = Math.max(paid.filter(a => a.ticket_type.includes('vip')).length, 5)
    const genCount = Math.max(paid.filter(a => !a.ticket_type.includes('vip')).length, 10)
    const name = selectedEvent?.name ?? '[Event Name]'
    const lines = [
      `Event Payment Template`,
      '',
      `${name}`,
      '',
      'Pay in Full',
      '',
      'VIP (name + payment method)',
      ...Array.from({ length: vipCount }, (_, i) => `${i + 1}.`),
      '',
      'General (name + payment method)',
      ...Array.from({ length: genCount }, (_, i) => `${i + 1}.`),
      '',
      '👉 Pay deposit (name + action item)',
      '',
      '1.',
      '2.',
      '3.',
    ]
    return lines.join('\n')
  }, [selectedEventId, attendees, selectedEvent])

  // Only reset text when event changes or template first loads
  useEffect(() => {
    if (!selectedEventId) return
    if (initialized === selectedEventId) return
    const saved = localStorage.getItem(`payment_template_${selectedEventId}`)
    setText(saved && saved.trim() ? saved : BLANK_TEMPLATE)
    setInitialized(selectedEventId)
  }, [selectedEventId, initialized, BLANK_TEMPLATE])

  // Auto-save as user types
  function handleChange(val: string) {
    setText(val)
    if (selectedEventId) localStorage.setItem(`payment_template_${selectedEventId}`, val)
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleReset() {
    setText(BLANK_TEMPLATE)
    if (selectedEventId) localStorage.setItem(`payment_template_${selectedEventId}`, BLANK_TEMPLATE)
  }

  if (loading) return <div className="text-zinc-500 mt-20 text-center">Loading…</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">📋 Payment Template</h1>
        <div className="flex gap-2 flex-wrap">
          <select
            value={selectedEventId}
            onChange={e => { setSelectedEventId(e.target.value); setInitialized('') }}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm"
          >
            {events.map(ev => (
              <option key={ev.id} value={ev.id}>{ev.name}</option>
            ))}
          </select>
          <button onClick={handleReset}
            className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 rounded-lg px-3 py-2">
            Reset
          </button>
        </div>
      </div>

      {/* Plain editable text — no box styling */}
      <textarea
        value={text}
        onChange={e => handleChange(e.target.value)}
        rows={Math.max(25, text.split('\n').length + 3)}
        className="w-full bg-transparent text-white text-sm leading-7 resize-none focus:outline-none"
        style={{ fontFamily: 'inherit' }}
        spellCheck={false}
      />

      <button
        onClick={handleCopy}
        className="bg-amber-500 hover:bg-amber-400 text-black font-bold px-6 py-2.5 rounded-lg text-sm"
      >
        {copied ? '✅ Copied!' : '📋 Copy to clipboard'}
      </button>
    </div>
  )
}
