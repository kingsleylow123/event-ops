'use client'
import { useEffect, useState } from 'react'
import type { Event } from '@/lib/supabase'
import { useCachedFetch, mutateCache } from '@/lib/useCachedFetch'
import { PRICING_TIERS, PRICING_TIER_LABELS } from '@/lib/registration'

const EMPTY_FORM = {
  name: '',
  date: '',
  venue: '',
  capacity: '',
  format: 'workshop',
  pricing_tier: 'standard',
  config: {} as Record<string, string>,
}

// Per-event content config fields (lib/event-config.ts holds the defaults —
// leave a field blank to inherit the Claude Malaysia default).
const CONFIG_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'venue_label', label: 'Venue short name', placeholder: 'CO3 Puchong' },
  { key: 'whatsapp_group_url', label: 'WhatsApp group invite link', placeholder: 'https://chat.whatsapp.com/…' },
  { key: 'instagram_handle', label: 'Instagram handle', placeholder: '@claudemalaysiaofficial' },
  { key: 'instagram_url', label: 'Instagram URL', placeholder: 'https://instagram.com/…' },
  { key: 'mac_video_id', label: 'Mac setup video (YouTube ID)', placeholder: 'X57PTQR45Ps' },
  { key: 'windows_video_id', label: 'Windows setup video (YouTube ID)', placeholder: 'XvBxfupKpgg' },
  { key: 'docs_url', label: 'Installation guide doc URL', placeholder: 'https://docs.google.com/…' },
  { key: 'venue_video_id', label: 'Venue tour video (YouTube ID)', placeholder: 'NeTd4AAxTrY' },
]

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function EventsPage() {
  const { data: eventsData, loading: fetching } = useCachedFetch<Event[]>('events', '/api/events')
  const [events, setEvents] = useState<Event[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copiedRegId, setCopiedRegId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)

  // Mirror cached/fetched data into local state for optimistic edits.
  useEffect(() => { if (eventsData) setEvents(eventsData) }, [eventsData])
  const loading = fetching && !eventsData

  // After any local mutation, keep the shared 'events' cache in sync.
  function syncEvents(next: Event[]) {
    setEvents(next)
    mutateCache<Event[]>('events', () => next)
  }

  function openCreate() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  function openEdit(ev: Event) {
    setEditingId(ev.id)
    setForm({
      name: ev.name ?? '',
      date: toDatetimeLocalValue(ev.date),
      venue: ev.venue ?? '',
      capacity: ev.capacity != null ? String(ev.capacity) : '',
      format: ev.format ?? 'workshop',
      pricing_tier: ev.pricing_tier ?? 'standard',
      config: ev.config ?? {},
    })
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault()
    const payload = {
      name: form.name,
      date: form.date || null,
      venue: form.venue || null,
      capacity: form.capacity ? Number(form.capacity) : null,
      format: form.format || 'workshop',
      pricing_tier: form.pricing_tier || 'standard',
      // Drop blank values so they inherit defaults instead of overriding with ''.
      config: Object.fromEntries(Object.entries(form.config).filter(([, v]) => v.trim() !== '')),
    }

    if (editingId) {
      const res = await fetch('/api/events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingId, ...payload }),
      })
      const updated = await res.json()
      syncEvents(events.map(e => (e.id === editingId ? updated : e)))
    } else {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, is_active: events.length === 0 }),
      })
      const newEv = await res.json()
      syncEvents([newEv, ...events])
    }
    closeForm()
  }

  async function setActive(id: string) {
    await fetch('/api/events', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active: true }),
    })
    syncEvents(events.map(e => ({ ...e, is_active: e.id === id })))
  }

  async function deleteEvent(id: string) {
    if (!confirm('Delete this event and all its attendees/checklist?')) return
    await fetch(`/api/events?id=${id}`, { method: 'DELETE' })
    syncEvents(events.filter(e => e.id !== id))
  }

  if (loading) return <div className="text-zinc-500 mt-20 text-center">Loading...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Events</h1>
        <button onClick={openCreate}
          className="bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm px-4 py-2 rounded-lg">
          + New Event
        </button>
      </div>

      {showForm && (
        <div className="bg-[#111] border border-zinc-800 rounded-xl p-5">
          <h2 className="font-semibold mb-3">{editingId ? 'Edit Event' : 'New Event'}</h2>
          <form onSubmit={submitForm} className="space-y-3">
            <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Event Name *" className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
            <div className="grid grid-cols-2 gap-3">
              <input type="datetime-local" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
              <input value={form.venue} onChange={e => setForm(f => ({ ...f, venue: e.target.value }))}
                placeholder="Venue" className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input type="number" value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))}
                placeholder="Capacity (optional)" className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
              <select value={form.format} onChange={e => setForm(f => ({ ...f, format: e.target.value }))}
                className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
                <option value="workshop">Workshop (in-person survey)</option>
                <option value="webinar">Webinar (ops survey)</option>
              </select>
            </div>
            <p className="text-xs text-zinc-500">Format sets which pre-event survey questions show. Manage Host / Facilitator / Content Creator from the <span className="text-amber-400">Team</span> tab.</p>

            <div>
              <label className="block text-[11px] text-zinc-500 mb-1">Live ticket tier (what the Register link sells)</label>
              <select value={form.pricing_tier} onChange={e => setForm(f => ({ ...f, pricing_tier: e.target.value }))}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
                {PRICING_TIERS.map(t => <option key={t} value={t}>{PRICING_TIER_LABELS[t]}</option>)}
              </select>
              <p className="mt-1 text-xs text-zinc-500">Flip this as sales progress — <span className="text-amber-400">🎟 Register Link</span> charges General/VIP at this tier.</p>
            </div>

            {/* Per-event links & content (blank = inherit Claude Malaysia defaults) */}
            <details className="rounded-lg border border-zinc-800 bg-zinc-900/40">
              <summary className="cursor-pointer select-none px-3 py-2 text-sm text-zinc-300">
                🔗 Links &amp; content <span className="text-zinc-500 text-xs">(survey + /start page — blank inherits defaults)</span>
              </summary>
              <div className="grid sm:grid-cols-2 gap-3 p-3 pt-1">
                {CONFIG_FIELDS.map(f => (
                  <label key={f.key} className="block">
                    <span className="block text-[11px] text-zinc-500 mb-1">{f.label}</span>
                    <input
                      value={form.config[f.key] ?? ''}
                      onChange={e => setForm(prev => ({ ...prev, config: { ...prev.config, [f.key]: e.target.value } }))}
                      placeholder={f.placeholder}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-xs"
                    />
                  </label>
                ))}
              </div>
            </details>
            <div className="flex gap-2">
              <button type="submit" className="bg-amber-500 hover:bg-amber-400 text-black font-semibold px-4 py-2 rounded-lg text-sm">
                {editingId ? 'Save Changes' : 'Create Event'}
              </button>
              <button type="button" onClick={closeForm} className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg text-sm">Cancel</button>
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
              <div className="flex gap-4 text-sm text-zinc-400 flex-wrap">
                {ev.date && <span>📅 {new Date(ev.date).toLocaleDateString('en-MY', { dateStyle: 'medium' })}</span>}
                {ev.venue && <span>📍 {ev.venue}</span>}
                {ev.capacity && <span>👥 {ev.capacity} seats</span>}
              </div>
              <p className="text-xs text-zinc-600 mt-1">Created {new Date(ev.created_at).toLocaleDateString()}</p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => {
                  const base = typeof window !== 'undefined' ? window.location.origin : ''
                  navigator.clipboard.writeText(`${base}/start?event=${ev.id}`)
                  setCopiedId(ev.id)
                  setTimeout(() => setCopiedId(null), 1500)
                }}
                className="text-xs border border-zinc-700 text-zinc-300 hover:border-amber-500/50 hover:text-amber-400 px-3 py-1.5 rounded-lg whitespace-nowrap">
                {copiedId === ev.id ? '✓ Copied' : '🔗 Start Link'}
              </button>
              <button
                onClick={() => {
                  const base = typeof window !== 'undefined' ? window.location.origin : ''
                  navigator.clipboard.writeText(`${base}/register?event=${ev.id}`)
                  setCopiedRegId(ev.id)
                  setTimeout(() => setCopiedRegId(null), 1500)
                }}
                className="text-xs border border-zinc-700 text-zinc-300 hover:border-amber-500/50 hover:text-amber-400 px-3 py-1.5 rounded-lg whitespace-nowrap">
                {copiedRegId === ev.id ? '✓ Copied' : '🎟 Register Link'}
              </button>
              <button onClick={() => openEdit(ev)}
                className="text-xs border border-zinc-700 text-zinc-300 hover:border-amber-500/50 hover:text-amber-400 px-3 py-1.5 rounded-lg">
                Edit
              </button>
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
