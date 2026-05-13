'use client'
import { useEffect, useState } from 'react'
import type { Event } from '@/lib/supabase'

export default function EventsPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', date: '', venue: '', capacity: '' })

  async function loadEvents() {
    try {
      const res = await fetch('/api/events')
      if (res.ok) setEvents(await res.json())
    } catch {
      // db not configured yet
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadEvents() }, [])

  async function createEvent(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        date: form.date || null,
        venue: form.venue || null,
        capacity: form.capacity ? Number(form.capacity) : null,
        is_active: events.length === 0,
      }),
    })
    const newEv = await res.json()
    setEvents(prev => [newEv, ...prev])
    setForm({ name: '', date: '', venue: '', capacity: '' })
    setShowForm(false)
  }

  async function setActive(id: string) {
    await fetch('/api/events', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active: true }),
    })
    setEvents(prev => prev.map(e => ({ ...e, is_active: e.id === id })))
  }

  async function deleteEvent(id: string) {
    if (!confirm('Delete this event and all its attendees/checklist?')) return
    await fetch(`/api/events?id=${id}`, { method: 'DELETE' })
    setEvents(prev => prev.filter(e => e.id !== id))
  }

  if (loading) return <div className="text-zinc-500 mt-20 text-center">Loading...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Events</h1>
        <button onClick={() => setShowForm(s => !s)}
          className="bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm px-4 py-2 rounded-lg">
          + New Event
        </button>
      </div>

      {showForm && (
        <div className="bg-[#111] border border-zinc-800 rounded-xl p-5">
          <h2 className="font-semibold mb-3">New Event</h2>
          <form onSubmit={createEvent} className="space-y-3">
            <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Event Name *" className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
            <div className="grid grid-cols-2 gap-3">
              <input type="datetime-local" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
              <input value={form.venue} onChange={e => setForm(f => ({ ...f, venue: e.target.value }))}
                placeholder="Venue" className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
            </div>
            <input type="number" value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))}
              placeholder="Capacity (optional)" className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
            <div className="flex gap-2">
              <button type="submit" className="bg-amber-500 hover:bg-amber-400 text-black font-semibold px-4 py-2 rounded-lg text-sm">Create Event</button>
              <button type="button" onClick={() => setShowForm(false)} className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {events.length === 0 && (
          <div className="text-center text-zinc-500 py-20">No events yet. Create your first one.</div>
        )}
        {events.map(ev => (
          <div key={ev.id} className={`bg-[#111] border rounded-xl p-5 flex items-start justify-between gap-4 ${ev.is_active ? 'border-amber-500/50' : 'border-zinc-800'}`}>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="font-semibold">{ev.name}</h2>
                {ev.is_active && <span className="text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full">Active</span>}
              </div>
              <div className="flex gap-4 text-sm text-zinc-400">
                {ev.date && <span>📅 {new Date(ev.date).toLocaleDateString('en-MY', { dateStyle: 'medium' })}</span>}
                {ev.venue && <span>📍 {ev.venue}</span>}
                {ev.capacity && <span>👥 {ev.capacity} seats</span>}
              </div>
              <p className="text-xs text-zinc-600 mt-1">Created {new Date(ev.created_at).toLocaleDateString()}</p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              {!ev.is_active && (
                <button onClick={() => setActive(ev.id)}
                  className="text-xs border border-amber-500/50 text-amber-400 hover:bg-amber-500/10 px-3 py-1.5 rounded-lg">
                  Set Active
                </button>
              )}
              <button onClick={() => deleteEvent(ev.id)}
                className="text-xs border border-zinc-700 text-zinc-500 hover:border-red-500/50 hover:text-red-400 px-3 py-1.5 rounded-lg">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
