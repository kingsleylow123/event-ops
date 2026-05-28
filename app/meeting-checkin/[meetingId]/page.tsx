'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type CheckinState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; name: string }
  | { status: 'not_found' }
  | { status: 'already_checked_in'; name: string }
  | { status: 'multiple'; names: string[] }
  | { status: 'error'; detail?: string }

export default function MeetingCheckinPage() {
  const params = useParams()
  const meetingId = params.meetingId as string

  const [meetingTitle, setMeetingTitle] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [state, setState] = useState<CheckinState>({ status: 'idle' })

  useEffect(() => {
    if (!meetingId) return
    supabase
      .from('meetings')
      .select('title')
      .eq('id', meetingId)
      .single()
      .then(({ data }) => {
        if (data) setMeetingTitle(data.title)
      })
  }, [meetingId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setState({ status: 'loading' })
    try {
      const res = await fetch('/api/meeting-checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId, name: name.trim() }),
      })
      const data = await res.json()
      if (data.success) {
        setState({ status: 'success', name: data.name })
      } else if (data.error === 'not_found') {
        setState({ status: 'not_found' })
      } else if (data.error === 'already_checked_in') {
        setState({ status: 'already_checked_in', name: data.name })
      } else if (data.error === 'multiple') {
        setState({ status: 'multiple', names: data.names })
      } else {
        setState({ status: 'error', detail: data.detail ?? data.error })
      }
    } catch (err) {
      setState({ status: 'error', detail: String(err) })
    }
  }

  async function confirmName(exactName: string) {
    setState({ status: 'loading' })
    try {
      const res = await fetch('/api/meeting-checkin/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId, name: exactName }),
      })
      const data = await res.json()
      if (data.success) {
        setState({ status: 'success', name: data.name })
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
    setState({ status: 'idle' })
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-5 py-10" style={{ background: '#0a0a0a' }}>

      {/* Header */}
      <div className="w-full max-w-sm mb-8 text-center">
        <div className="inline-block px-3 py-1 rounded-full text-xs font-semibold mb-3 tracking-widest uppercase"
          style={{ background: '#e8563a22', color: '#e8563a' }}>
          CHECK-IN
        </div>
        <h1 className="text-3xl font-bold text-white leading-tight">Activity Session</h1>
        {meetingTitle && (
          <p className="text-zinc-400 text-sm mt-2">{meetingTitle}</p>
        )}
      </div>

      {/* Card */}
      <div className="w-full max-w-sm rounded-2xl p-6 border" style={{ background: '#111', borderColor: '#222' }}>

        {/* FORM */}
        {(state.status === 'idle' || state.status === 'loading') && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1.5 uppercase tracking-wider">Your Name</label>
              <input
                autoFocus
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
              disabled={state.status === 'loading' || !name.trim()}
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
              <p className="text-zinc-400 text-sm mt-1">Attendance marked.</p>
            </div>
            <button onClick={reset}
              className="w-full py-3 rounded-xl text-zinc-400 text-sm font-medium border border-zinc-800">
              Check in another person
            </button>
          </div>
        )}

        {/* NOT FOUND */}
        {state.status === 'not_found' && (
          <div className="text-center py-4 space-y-4">
            <div className="text-5xl">🔍</div>
            <h2 className="text-xl font-bold text-white">Name not found</h2>
            <p className="text-zinc-400 text-sm">
              &quot;{name}&quot; is not on the attendance list. Please check your spelling or see the organiser.
            </p>
            <button onClick={reset} className="w-full py-3.5 rounded-xl font-bold text-white text-base" style={{ background: '#e8563a' }}>
              Try again
            </button>
          </div>
        )}

        {/* ALREADY CHECKED IN */}
        {state.status === 'already_checked_in' && (
          <div className="text-center py-4 space-y-4">
            <div className="text-5xl">👋</div>
            <h2 className="text-xl font-bold text-white">Already marked present!</h2>
            <p className="text-zinc-400 text-sm">{state.name}, you&apos;re already marked present for this session.</p>
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
              <p className="text-zinc-400 text-sm mt-1">Tap your name to check in</p>
            </div>
            <div className="space-y-2">
              {state.names.map(n => (
                <button key={n} onClick={() => confirmName(n)}
                  className="w-full py-3.5 px-4 rounded-xl text-left font-semibold text-white text-sm border hover:border-[#e8563a] transition-colors"
                  style={{ background: '#1a1a1a', borderColor: '#333' }}>
                  {n}
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
            <p className="text-zinc-400 text-sm">Please try again or see the organiser.</p>
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
