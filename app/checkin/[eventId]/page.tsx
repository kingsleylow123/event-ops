'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { TICKET_LABELS } from '@/lib/supabase'
import type { TicketType } from '@/lib/supabase'

type CheckinState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; name: string; ticket_type: TicketType; is_double: boolean; plus_one_done: boolean }
  | { status: 'not_found' }
  | { status: 'already_checked_in'; name: string }
  | { status: 'multiple'; attendees: { id: string; name: string; ticket_type: string }[] }
  | { status: 'error'; detail?: string }

export default function CheckinPage() {
  const params = useParams()
  const eventId = params.eventId as string

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [state, setState] = useState<CheckinState>({ status: 'idle' })
  // Multi-day events show a Day 1 / Day 2 toggle above the form.
  const [isMultiDay, setIsMultiDay] = useState(false)
  const [day, setDay] = useState<1 | 2>(1)

  // Detect multi-day via the public facts endpoint (no admin auth needed,
  // same one /start uses). Returns days_count derived from floor_plan.days.
  useEffect(() => {
    if (!eventId) return
    fetch(`/api/survey?event_id=${eventId}&facts=1`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { days_count?: number } | null) => {
        if ((d?.days_count ?? 1) >= 2) setIsMultiDay(true)
      })
      .catch(() => { /* not critical — single-day flow still works */ })
  }, [eventId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!phone.trim() && !name.trim()) return
    setState({ status: 'loading' })
    try {
      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, name: name.trim(), phone: phone.trim(), day }),
      })
      const data = await res.json()
      if (data.success) {
        setState({
          status: 'success',
          name: data.attendee.name,
          ticket_type: data.attendee.ticket_type,
          is_double: data.attendee.is_double,
          plus_one_done: false,
        })
      } else if (data.error === 'not_found') {
        setState({ status: 'not_found' })
      } else if (data.error === 'already_checked_in') {
        setState({ status: 'already_checked_in', name: data.name })
      } else if (data.error === 'multiple') {
        setState({ status: 'multiple', attendees: data.attendees })
      } else {
        setState({ status: 'error', detail: data.detail ?? data.error })
      }
    } catch (err) {
      setState({ status: 'error', detail: String(err) })
    }
  }

  async function confirmAttendee(attendeeId: string) {
    setState({ status: 'loading' })
    try {
      const res = await fetch('/api/checkin/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendeeId, day }),
      })
      const data = await res.json()
      if (data.success) {
        setState({
          status: 'success',
          name: data.attendee.name,
          ticket_type: data.attendee.ticket_type,
          is_double: data.attendee.is_double ?? false,
          plus_one_done: false,
        })
      } else if (data.error === 'already_checked_in') {
        setState({ status: 'already_checked_in', name: data.name })
      } else {
        setState({ status: 'error', detail: data.detail ?? data.error })
      }
    } catch (err) {
      setState({ status: 'error', detail: String(err) })
    }
  }

  function reset() {
    setName('')
    setPhone('')
    setState({ status: 'idle' })
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-5 py-10" style={{ background: '#0a0a0a' }}>

      {/* Header */}
      <div className="w-full max-w-sm mb-8 text-center">
        <div className="inline-block px-3 py-1 rounded-full text-xs font-semibold mb-3 tracking-widest uppercase"
          style={{ background: '#e8563a22', color: '#e8563a' }}>
          Check-in
        </div>
        <h1 className="text-3xl font-bold text-white leading-tight">Thanks for coming!</h1>
        <p className="text-zinc-500 text-sm mt-2">Enter your <span style={{color:'#e8563a'}}>phone number</span> or name to check in</p>
      </div>

      {/* Day selector — only shown for multi-day events. Big tap targets for
          tablet/phone check-in at the door. */}
      {isMultiDay && (state.status === 'idle' || state.status === 'loading') && (
        <div className="w-full max-w-sm mb-4">
          <p className="text-xs text-zinc-500 mb-2 uppercase tracking-wider text-center">Checking in for</p>
          <div className="grid grid-cols-2 gap-2">
            {([1, 2] as const).map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setDay(n)}
                className={`py-3 rounded-xl text-base font-semibold transition-colors ${
                  day === n ? 'bg-amber-500 text-black' : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                }`}
              >
                Day {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Card */}
      <div className="w-full max-w-sm rounded-2xl p-6 border" style={{ background: '#111', borderColor: '#222' }}>

        {/* FORM */}
        {(state.status === 'idle' || state.status === 'loading') && (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1.5 uppercase tracking-wider">Phone Number</label>
              <input
                autoFocus
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="e.g. 0123456789"
                disabled={state.status === 'loading'}
                className="w-full rounded-xl px-4 py-3.5 text-white text-base outline-none disabled:opacity-50"
                style={{ background: '#1a1a1a', border: '1px solid #333' }}
              />
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px" style={{ background: '#2a2a2a' }} />
              <span className="text-zinc-600 text-xs uppercase tracking-widest">or</span>
              <div className="flex-1 h-px" style={{ background: '#2a2a2a' }} />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1.5 uppercase tracking-wider">Your Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Sarah"
                disabled={state.status === 'loading'}
                className="w-full rounded-xl px-4 py-3.5 text-white text-base outline-none disabled:opacity-50"
                style={{ background: '#1a1a1a', border: '1px solid #333' }}
              />
            </div>
            <button
              type="submit"
              disabled={state.status === 'loading' || (!phone.trim() && !name.trim())}
              className="w-full py-3.5 rounded-xl font-bold text-base text-white disabled:opacity-50 transition-opacity"
              style={{ background: state.status === 'loading' ? '#a33c29' : '#e8563a' }}
            >
              {state.status === 'loading' ? 'Checking in...' : 'Check In →'}
            </button>
          </form>
        )}

        {/* SUCCESS */}
        {state.status === 'success' && (
          <div className="text-center py-2 space-y-4">
            <div className="text-6xl">✅</div>
            <div>
              <h2 className="text-2xl font-bold text-white">Welcome, {state.name}!</h2>
              <p className="text-zinc-400 text-sm mt-1">You&apos;re checked in</p>
            </div>
            <div className="inline-block px-4 py-1.5 rounded-full text-sm font-semibold"
              style={{ background: '#e8563a22', color: '#e8563a' }}>
              {TICKET_LABELS[state.ticket_type] ?? state.ticket_type}
            </div>

            {/* x2 ticket section */}
            {state.is_double && !state.plus_one_done && (
              <div className="mt-2 rounded-xl p-4 border" style={{ background: '#1a1a1a', borderColor: '#333' }}>
                <p className="text-white font-semibold text-sm mb-1">🎟️ You have 2 tickets!</p>
                <p className="text-zinc-400 text-xs mb-3">Is your +1 guest also here?</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setState(s => s.status === 'success' ? { ...s, plus_one_done: true } : s)}
                    className="flex-1 py-2.5 rounded-xl font-bold text-white text-sm"
                    style={{ background: '#e8563a' }}
                  >
                    ✅ Yes, check in +1
                  </button>
                  <button
                    onClick={reset}
                    className="flex-1 py-2.5 rounded-xl text-zinc-400 text-sm border border-zinc-700"
                  >
                    No
                  </button>
                </div>
              </div>
            )}

            {state.is_double && state.plus_one_done && (
              <div className="rounded-xl p-3 border" style={{ background: '#0d2b12', borderColor: '#1a5c28' }}>
                <p className="text-green-400 font-semibold text-sm">✅ +1 Guest also checked in!</p>
                <p className="text-green-600 text-xs mt-0.5">Both tickets confirmed 🎉</p>
              </div>
            )}

            {(!state.is_double || state.plus_one_done) && (
              <button onClick={reset}
                className="w-full py-3 rounded-xl text-zinc-400 text-sm font-medium border border-zinc-800">
                Check in another person
              </button>
            )}
          </div>
        )}

        {/* NOT FOUND */}
        {state.status === 'not_found' && (
          <div className="text-center py-4 space-y-4">
            <div className="text-5xl">🔍</div>
            <h2 className="text-xl font-bold text-white">Name not found</h2>
            <p className="text-zinc-400 text-sm">No paid ticket found for this phone number. Please see the registration desk.</p>
            <button onClick={reset} className="w-full py-3.5 rounded-xl font-bold text-white text-base" style={{ background: '#e8563a' }}>
              Try again
            </button>
          </div>
        )}

        {/* ALREADY CHECKED IN */}
        {state.status === 'already_checked_in' && (
          <div className="text-center py-4 space-y-4">
            <div className="text-5xl">👋</div>
            <h2 className="text-xl font-bold text-white">Already checked in!</h2>
            <p className="text-zinc-400 text-sm">{state.name}, you&apos;re already checked in. See you inside!</p>
            <button onClick={reset} className="w-full py-3.5 rounded-xl font-bold text-white text-base" style={{ background: '#e8563a' }}>
              Done
            </button>
          </div>
        )}

        {/* MULTIPLE MATCHES */}
        {state.status === 'multiple' && (
          <div className="space-y-4">
            <div className="text-center">
              <div className="text-4xl mb-2">👥</div>
              <h2 className="text-lg font-bold text-white">Multiple matches</h2>
              <p className="text-zinc-400 text-sm mt-1">Tap your ticket to check in</p>
            </div>
            <div className="space-y-2">
              {state.attendees.map(a => (
                <button key={a.id} onClick={() => confirmAttendee(a.id)}
                  className="w-full py-3.5 px-4 rounded-xl text-left font-semibold text-white text-sm border hover:border-[#e8563a] transition-colors"
                  style={{ background: '#1a1a1a', borderColor: '#333' }}>
                  {a.name}
                  <span className="text-zinc-500 font-normal text-xs ml-2">
                    {TICKET_LABELS[a.ticket_type as TicketType] ?? a.ticket_type}
                  </span>
                </button>
              ))}
            </div>
            <button onClick={reset} className="w-full py-2 text-zinc-500 text-sm hover:text-zinc-300">Cancel</button>
          </div>
        )}

        {/* ERROR */}
        {state.status === 'error' && (
          <div className="text-center py-4 space-y-4">
            <div className="text-5xl">⚠️</div>
            <h2 className="text-xl font-bold text-white">Something went wrong</h2>
            <p className="text-zinc-400 text-sm">Please try again or see the registration desk.</p>
            {state.detail && (
              <p className="text-red-400 text-xs font-mono bg-red-900/20 rounded p-2">{state.detail}</p>
            )}
            <button onClick={reset} className="w-full py-3.5 rounded-xl font-bold text-white text-base" style={{ background: '#e8563a' }}>
              Try again
            </button>
          </div>
        )}
      </div>

      <p className="mt-6 text-zinc-700 text-xs text-center">Powered by EventOps</p>
    </div>
  )
}
