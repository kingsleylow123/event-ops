'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'

type CheckinState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; name: string }
  | { status: 'not_found' }
  | { status: 'already_checked_in'; name: string }
  | { status: 'multiple'; attendees: { id: string; name: string }[] }
  | { status: 'error'; detail?: string }

export default function FacilitatorCheckinPage() {
  const params = useParams()
  const eventId = params.eventId as string
  const searchParams = useSearchParams()
  const dayParam = searchParams.get('day')
  const initialDay: 1 | 2 = dayParam === '2' ? 2 : 1

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [state, setState] = useState<CheckinState>({ status: 'idle' })
  const [isMultiDay, setIsMultiDay] = useState(false)
  const [day, setDay] = useState<1 | 2>(initialDay)

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
      const res = await fetch('/api/checkin-facilitator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, name: name.trim(), phone: phone.trim(), day }),
      })
      const data = await res.json()
      if (data.success) {
        setState({ status: 'success', name: data.attendee.name })
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
      const res = await fetch('/api/checkin-facilitator/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendeeId, eventId, day }),
      })
      const data = await res.json()
      if (data.success) {
        setState({ status: 'success', name: data.attendee.name })
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
    <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: '#000' }}>
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest"
            style={{ background: '#e8563a22', color: '#e8563a' }}>
            Facilitator Check-in
          </div>
          <h1 className="text-3xl font-extrabold text-white">Welcome, team!</h1>
          <p className="text-zinc-400 text-sm">
            Enter your <span className="text-[#e8563a] font-semibold">phone number</span> or name to check in
          </p>
        </div>

        {isMultiDay && (
          <div className="flex gap-2 p-1 rounded-xl" style={{ background: '#1a1a1a', border: '1px solid #333' }}>
            <button onClick={() => setDay(1)}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold ${day === 1 ? 'text-white' : 'text-zinc-500'}`}
              style={day === 1 ? { background: '#e8563a' } : {}}>Day 1</button>
            <button onClick={() => setDay(2)}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold ${day === 2 ? 'text-white' : 'text-zinc-500'}`}
              style={day === 2 ? { background: '#e8563a' } : {}}>Day 2</button>
          </div>
        )}

        {(state.status === 'idle' || state.status === 'loading') && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1.5 uppercase tracking-wider">Phone Number</label>
              <input
                type="tel"
                inputMode="numeric"
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
                placeholder="e.g. Noona"
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

        {state.status === 'success' && (
          <div className="text-center py-2 space-y-4">
            <div className="text-6xl">✅</div>
            <div>
              <h2 className="text-2xl font-bold text-white">Welcome, {state.name}!</h2>
              <p className="text-zinc-400 text-sm mt-1">You&apos;re checked in</p>
            </div>
            <button onClick={reset}
              className="w-full py-3 rounded-xl text-zinc-400 text-sm font-medium border border-zinc-800">
              Check in another facilitator
            </button>
          </div>
        )}

        {state.status === 'not_found' && (
          <div className="text-center py-4 space-y-4">
            <div className="text-5xl">🔍</div>
            <h2 className="text-xl font-bold text-white">Name not found</h2>
            <p className="text-zinc-400 text-sm">This name or phone isn&apos;t on the facilitator list for this event. Please check with the organiser.</p>
            <button onClick={reset} className="w-full py-3.5 rounded-xl font-bold text-white text-base" style={{ background: '#e8563a' }}>
              Try again
            </button>
          </div>
        )}

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

        {state.status === 'multiple' && (
          <div className="space-y-4">
            <div className="text-center">
              <div className="text-4xl mb-2">👥</div>
              <h2 className="text-lg font-bold text-white">Multiple matches</h2>
              <p className="text-zinc-400 text-sm mt-1">Tap your name to check in</p>
            </div>
            <div className="space-y-2">
              {state.attendees.map(a => (
                <button key={a.id} onClick={() => confirmAttendee(a.id)}
                  className="w-full py-3.5 px-4 rounded-xl text-left font-semibold text-white text-sm border hover:border-[#e8563a] transition-colors"
                  style={{ background: '#1a1a1a', borderColor: '#333' }}>
                  {a.name}
                </button>
              ))}
            </div>
            <button onClick={reset} className="w-full py-2 text-zinc-500 text-sm hover:text-zinc-300">Cancel</button>
          </div>
        )}

        {state.status === 'error' && (
          <div className="text-center py-4 space-y-4">
            <div className="text-5xl">⚠️</div>
            <h2 className="text-xl font-bold text-white">Something went wrong</h2>
            <p className="text-zinc-400 text-sm">Please try again or see the organiser.</p>
            {state.detail && <p className="text-zinc-600 text-xs">{state.detail}</p>}
            <button onClick={reset} className="w-full py-3.5 rounded-xl font-bold text-white text-base" style={{ background: '#e8563a' }}>
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
