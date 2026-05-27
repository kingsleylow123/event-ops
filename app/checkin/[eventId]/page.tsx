'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase, TICKET_LABELS } from '@/lib/supabase'
import type { TicketType } from '@/lib/supabase'

type CheckinState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; name: string; ticket_type: TicketType }
  | { status: 'not_found' }
  | { status: 'already_checked_in'; name: string }
  | { status: 'multiple'; attendees: { id: string; name: string }[] }
  | { status: 'error'; detail?: string }

export default function CheckinPage() {
  const params = useParams()
  const eventId = params.eventId as string
  const [eventName, setEventName] = useState<string>('')
  const [query, setQuery] = useState('')
  const [state, setState] = useState<CheckinState>({ status: 'idle' })

  useEffect(() => {
    async function loadEvent() {
      const { data } = await supabase
        .from('events')
        .select('name')
        .eq('id', eventId)
        .single()
      if (data) setEventName(data.name)
    }
    loadEvent()
  }, [eventId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    setState({ status: 'loading' })
    try {
      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, query: query.trim() }),
      })
      const data = await res.json()
      if (data.success) {
        setState({ status: 'success', name: data.attendee.name, ticket_type: data.attendee.ticket_type })
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
        body: JSON.stringify({ attendeeId }),
      })
      const data = await res.json()
      if (data.success) {
        setState({ status: 'success', name: data.attendee.name, ticket_type: data.attendee.ticket_type })
      } else if (data.error === 'already_checked_in') {
        setState({ status: 'already_checked_in', name: data.name })
      } else {
        setState({ status: 'error' })
      }
    } catch {
      setState({ status: 'error' })
    }
  }

  function reset() {
    setQuery('')
    setState({ status: 'idle' })
  }

  const isTerminal =
    state.status === 'success' ||
    state.status === 'not_found' ||
    state.status === 'already_checked_in' ||
    state.status === 'error'

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-5 py-10"
      style={{ background: '#0a0a0a' }}
    >
      {/* Header */}
      <div className="w-full max-w-sm mb-8 text-center">
        <div
          className="inline-block px-3 py-1 rounded-full text-xs font-semibold mb-3 tracking-widest uppercase"
          style={{ background: '#e8563a22', color: '#e8563a' }}
        >
          Check-in
        </div>
        <h1 className="text-3xl font-bold text-white leading-tight">
          Thanks for coming!
        </h1>
        <p className="text-zinc-500 text-sm mt-2">Enter your name to check in</p>
      </div>

      {/* Card */}
      <div
        className="w-full max-w-sm rounded-2xl p-6 border"
        style={{ background: '#111', borderColor: '#222' }}
      >
        {/* IDLE / LOADING: show form */}
        {(state.status === 'idle' || state.status === 'loading') && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1.5 uppercase tracking-wider">
                Your name
              </label>
              <input
                autoFocus
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="e.g. Sarah"
                disabled={state.status === 'loading'}
                className="w-full rounded-xl px-4 py-3.5 text-white text-base outline-none focus:ring-2 disabled:opacity-50"
                style={{
                  background: '#1a1a1a',
                  border: '1px solid #333',
                  // @ts-ignore
                  '--tw-ring-color': '#e8563a',
                }}
              />
            </div>
            <button
              type="submit"
              disabled={state.status === 'loading' || !query.trim()}
              className="w-full py-3.5 rounded-xl font-bold text-base text-white disabled:opacity-50 transition-opacity"
              style={{ background: state.status === 'loading' ? '#a33c29' : '#e8563a' }}
            >
              {state.status === 'loading' ? 'Checking in...' : 'Check In'}
            </button>
          </form>
        )}

        {/* SUCCESS */}
        {state.status === 'success' && (
          <div className="text-center py-4 space-y-4">
            <div className="text-7xl mb-2">✅</div>
            <h2 className="text-2xl font-bold text-white">
              Welcome, {state.name}!
            </h2>
            <p className="text-zinc-400">You&apos;re checked in</p>
            <div
              className="inline-block px-4 py-1.5 rounded-full text-sm font-semibold"
              style={{ background: '#e8563a22', color: '#e8563a' }}
            >
              {TICKET_LABELS[state.ticket_type] ?? state.ticket_type}
            </div>
            <p className="text-zinc-500 text-sm mt-2">Enjoy the event! 🎉</p>
            <button
              onClick={reset}
              className="mt-4 w-full py-3 rounded-xl text-zinc-400 text-sm font-medium border border-zinc-800 hover:border-zinc-600 transition-colors"
            >
              Check in another person
            </button>
          </div>
        )}

        {/* NOT FOUND */}
        {state.status === 'not_found' && (
          <div className="text-center py-4 space-y-4">
            <div className="text-6xl mb-2">🔍</div>
            <h2 className="text-xl font-bold text-white">Name not found</h2>
            <p className="text-zinc-400 text-sm">
              No paid ticket found for &quot;{query}&quot;. Please check your spelling or see the registration desk.
            </p>
            <button
              onClick={reset}
              className="w-full py-3.5 rounded-xl font-bold text-white text-base"
              style={{ background: '#e8563a' }}
            >
              Try again
            </button>
          </div>
        )}

        {/* ALREADY CHECKED IN */}
        {state.status === 'already_checked_in' && (
          <div className="text-center py-4 space-y-4">
            <div className="text-6xl mb-2">👋</div>
            <h2 className="text-xl font-bold text-white">Already checked in!</h2>
            <p className="text-zinc-400 text-sm">
              {state.name}, you&apos;re already checked in. See you inside!
            </p>
            <button
              onClick={reset}
              className="w-full py-3.5 rounded-xl font-bold text-white text-base"
              style={{ background: '#e8563a' }}
            >
              Done
            </button>
          </div>
        )}

        {/* MULTIPLE MATCHES */}
        {state.status === 'multiple' && (
          <div className="space-y-4">
            <div className="text-center">
              <div className="text-4xl mb-2">👥</div>
              <h2 className="text-lg font-bold text-white">Multiple matches found</h2>
              <p className="text-zinc-400 text-sm mt-1">Tap your name to check in</p>
            </div>
            <div className="space-y-2">
              {state.attendees.map(a => (
                <button
                  key={a.id}
                  onClick={() => confirmAttendee(a.id)}
                  className="w-full py-3.5 px-4 rounded-xl text-left font-semibold text-white text-sm border hover:border-[#e8563a] transition-colors"
                  style={{ background: '#1a1a1a', borderColor: '#333' }}
                >
                  {a.name}
                </button>
              ))}
            </div>
            <button
              onClick={reset}
              className="w-full py-2 text-zinc-500 text-sm hover:text-zinc-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {/* GENERIC ERROR */}
        {state.status === 'error' && (
          <div className="text-center py-4 space-y-4">
            <div className="text-5xl mb-2">⚠️</div>
            <h2 className="text-xl font-bold text-white">Something went wrong</h2>
            <p className="text-zinc-400 text-sm">Please try again or see the registration desk.</p>
            {state.status === 'error' && state.detail && (
              <p className="text-red-400 text-xs font-mono bg-red-900/20 rounded p-2">{state.detail}</p>
            )}
            <button
              onClick={reset}
              className="w-full py-3.5 rounded-xl font-bold text-white text-base"
              style={{ background: '#e8563a' }}
            >
              Try again
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      {!isTerminal && state.status !== 'multiple' && (
        <p className="mt-6 text-zinc-700 text-xs text-center">
          Powered by EventOps
        </p>
      )}
    </div>
  )
}
