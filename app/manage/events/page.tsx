'use client'
import { useEffect, useState } from 'react'
import type { Event, EventPhase } from '@/lib/supabase'
import { useCachedFetch, mutateCache } from '@/lib/useCachedFetch'

const PHASES: { value: EventPhase; label: string }[] = [
  { value: 'waitlist', label: 'Waitlist' },
  { value: 'super_early_bird', label: 'Super Early Bird' },
  { value: 'early_bird', label: 'Early Bird' },
  { value: 'public', label: 'Public' },
  { value: 'sold_out', label: 'Sold Out' },
]
const PHASE_LABEL: Record<string, string> = Object.fromEntries(PHASES.map(p => [p.value, p.label]))

const EMPTY_PUB = {
  tagline: '',
  summary: '',
  hero_image_url: '',
  location_city: '',
  starts_at: '',
  ends_at: '',
  register_url: '',
  cta_label: '',
  seats_left: '',
  price_super_early: '',
  price_early: '',
  price_public: '',
  highlights: '',
}

const EMPTY_FORM = {
  name: '',
  date: '',
  venue: '',
  capacity: '',
  format: 'workshop',
  config: {} as Record<string, string>,
  is_published: false,
  current_phase: '' as '' | EventPhase,
  pub: { ...EMPTY_PUB },
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

const PUB_FIELDS: { key: keyof typeof EMPTY_PUB; label: string; placeholder: string; full?: boolean }[] = [
  { key: 'tagline', label: 'Tagline (one line under the title)', placeholder: 'Build your first AI workflow in one afternoon', full: true },
  { key: 'summary', label: 'Summary (2–3 sentences)', placeholder: 'A hands-on half-day workshop for Malaysian founders…', full: true },
  { key: 'location_city', label: 'City', placeholder: 'Kuala Lumpur' },
  { key: 'hero_image_url', label: 'Hero image URL (optional)', placeholder: 'https://…' },
  { key: 'register_url', label: 'Register / checkout URL (Stripe link, Luma…)', placeholder: 'https://buy.stripe.com/…', full: true },
  { key: 'cta_label', label: 'Button label (optional)', placeholder: 'Reserve my seat' },
  { key: 'seats_left', label: 'Seats left (optional)', placeholder: '12' },
  { key: 'price_super_early', label: 'Super Early Bird price', placeholder: 'RM249' },
  { key: 'price_early', label: 'Early Bird price', placeholder: 'RM297' },
  { key: 'price_public', label: 'Public price', placeholder: 'RM347' },
]

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Treat a naive datetime-local value as Malaysia time (+08:00) so the public
// page renders the right hour everywhere.
function toKL(v: string): string {
  if (!v) return ''
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v}:00+08:00` : v
}

export default function ManageEventsPage() {
  const { data: eventsData, loading: fetching } = useCachedFetch<Event[]>('events', '/api/events')
  const [events, setEvents] = useState<Event[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)

  useEffect(() => { if (eventsData) setEvents(eventsData) }, [eventsData])
  const loading = fetching && !eventsData

  function syncEvents(next: Event[]) {
    setEvents(next)
    mutateCache<Event[]>('events', () => next)
  }

  function openCreate() {
    setEditingId(null)
    setForm({ ...EMPTY_FORM, pub: { ...EMPTY_PUB } })
    setShowForm(true)
  }

  function openEdit(ev: Event) {
    const L = ev.public_listing || {}
    setEditingId(ev.id)
    setForm({
      name: ev.name ?? '',
      date: toDatetimeLocalValue(ev.date),
      venue: ev.venue ?? '',
      capacity: ev.capacity != null ? String(ev.capacity) : '',
      format: ev.format ?? 'workshop',
      config: ev.config ?? {},
      is_published: !!ev.is_published,
      current_phase: (ev.current_phase ?? '') as '' | EventPhase,
      pub: {
        tagline: L.tagline ?? '',
        summary: L.summary ?? '',
        hero_image_url: L.hero_image_url ?? '',
        location_city: L.location_city ?? '',
        starts_at: toDatetimeLocalValue(L.starts_at),
        ends_at: toDatetimeLocalValue(L.ends_at),
        register_url: L.register_url ?? '',
        cta_label: L.cta_label ?? '',
        seats_left: L.seats_left != null ? String(L.seats_left) : '',
        price_super_early: L.price_super_early ?? '',
        price_early: L.price_early ?? '',
        price_public: L.price_public ?? '',
        highlights: (L.highlights ?? []).join('\n'),
      },
    })
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm({ ...EMPTY_FORM, pub: { ...EMPTY_PUB } })
  }

  function buildPublicListing() {
    const p = form.pub
    const obj: Record<string, unknown> = {}
    if (p.tagline.trim()) obj.tagline = p.tagline.trim()
    if (p.summary.trim()) obj.summary = p.summary.trim()
    if (p.hero_image_url.trim()) obj.hero_image_url = p.hero_image_url.trim()
    if (p.location_city.trim()) obj.location_city = p.location_city.trim()
    if (p.starts_at) obj.starts_at = toKL(p.starts_at)
    if (p.ends_at) obj.ends_at = toKL(p.ends_at)
    if (p.register_url.trim()) obj.register_url = p.register_url.trim()
    if (p.cta_label.trim()) obj.cta_label = p.cta_label.trim()
    if (p.seats_left.trim() && !isNaN(Number(p.seats_left))) obj.seats_left = Number(p.seats_left)
    if (p.price_super_early.trim()) obj.price_super_early = p.price_super_early.trim()
    if (p.price_early.trim()) obj.price_early = p.price_early.trim()
    if (p.price_public.trim()) obj.price_public = p.price_public.trim()
    const hl = p.highlights.split('\n').map(s => s.trim()).filter(Boolean)
    if (hl.length) obj.highlights = hl
    return Object.keys(obj).length ? obj : null
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault()
    const payload = {
      name: form.name,
      date: form.date || null,
      venue: form.venue || null,
      capacity: form.capacity ? Number(form.capacity) : null,
      format: form.format || 'workshop',
      config: Object.fromEntries(Object.entries(form.config).filter(([, v]) => v.trim() !== '')),
      is_published: form.is_published,
      current_phase: form.current_phase || null,
      public_listing: buildPublicListing(),
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

  async function togglePublished(ev: Event) {
    const next = !ev.is_published
    await fetch('/api/events', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ev.id, is_published: next }),
    })
    syncEvents(events.map(e => (e.id === ev.id ? { ...e, is_published: next } : e)))
  }

  async function deleteEvent(id: string) {
    if (!confirm('Delete this event and all its attendees/checklist?')) return
    await fetch(`/api/events?id=${id}`, { method: 'DELETE' })
    syncEvents(events.filter(e => e.id !== id))
  }

  const setPub = (key: keyof typeof EMPTY_PUB, value: string) =>
    setForm(f => ({ ...f, pub: { ...f.pub, [key]: value } }))

  if (loading) return <div className="text-zinc-500 mt-20 text-center">Loading...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Manage Events</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Ops details + the public listing shown on{' '}
            <a href="/events" target="_blank" className="text-amber-400 hover:underline">/events</a>.
          </p>
        </div>
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

            {/* Public listing — what shows on the public /events calendar */}
            <details className="rounded-lg border border-amber-500/20 bg-amber-500/[0.03]" open={form.is_published}>
              <summary className="cursor-pointer select-none px-3 py-2 text-sm text-zinc-200">
                🌐 Public listing <span className="text-zinc-500 text-xs">(shown on /events — leave blank to keep hidden)</span>
              </summary>
              <div className="p-3 pt-1 space-y-3">
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-zinc-200 cursor-pointer">
                    <input type="checkbox" checked={form.is_published}
                      onChange={e => setForm(f => ({ ...f, is_published: e.target.checked }))}
                      className="accent-amber-500 w-4 h-4" />
                    Published (visible on /events)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-zinc-400">
                    <span className="text-[11px] uppercase tracking-wide text-zinc-500">Phase</span>
                    <select value={form.current_phase}
                      onChange={e => setForm(f => ({ ...f, current_phase: e.target.value as '' | EventPhase }))}
                      className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-white text-sm">
                      <option value="">— none —</option>
                      {PHASES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="block text-[11px] text-zinc-500 mb-1">Public start (date &amp; time)</span>
                    <input type="datetime-local" value={form.pub.starts_at} onChange={e => setPub('starts_at', e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-xs" />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] text-zinc-500 mb-1">Public end (optional)</span>
                    <input type="datetime-local" value={form.pub.ends_at} onChange={e => setPub('ends_at', e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-xs" />
                  </label>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  {PUB_FIELDS.map(f => (
                    <label key={f.key} className={f.full ? 'block sm:col-span-2' : 'block'}>
                      <span className="block text-[11px] text-zinc-500 mb-1">{f.label}</span>
                      {f.key === 'summary' ? (
                        <textarea rows={2} value={form.pub[f.key]} onChange={e => setPub(f.key, e.target.value)}
                          placeholder={f.placeholder}
                          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-xs" />
                      ) : (
                        <input value={form.pub[f.key]} onChange={e => setPub(f.key, e.target.value)}
                          placeholder={f.placeholder}
                          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-xs" />
                      )}
                    </label>
                  ))}
                </div>

                <label className="block">
                  <span className="block text-[11px] text-zinc-500 mb-1">Highlights (one per line)</span>
                  <textarea rows={3} value={form.pub.highlights} onChange={e => setPub('highlights', e.target.value)}
                    placeholder={'3 hours hands-on\nBring your laptop\nLunch included'}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-xs" />
                </label>
                <p className="text-[11px] text-zinc-500">
                  Phases <span className="text-zinc-400">waitlist</span> / <span className="text-zinc-400">sold out</span> show a
                  “Notify me” form. Sale phases use the Register URL as the button.
                </p>
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
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h2 className="font-semibold">{ev.name}</h2>
                {ev.is_active && <span className="text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full">Active</span>}
                {ev.is_published && <span className="text-xs bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full">● Public</span>}
                {ev.current_phase && <span className="text-xs bg-zinc-700/40 text-zinc-300 border border-zinc-600/40 px-2 py-0.5 rounded-full">{PHASE_LABEL[ev.current_phase] ?? ev.current_phase}</span>}
              </div>
              <div className="flex gap-4 text-sm text-zinc-400 flex-wrap">
                {ev.date && <span>📅 {new Date(ev.date).toLocaleDateString('en-MY', { dateStyle: 'medium' })}</span>}
                {ev.venue && <span>📍 {ev.venue}</span>}
                {ev.capacity && <span>👥 {ev.capacity} seats</span>}
              </div>
              <p className="text-xs text-zinc-600 mt-1">Created {new Date(ev.created_at).toLocaleDateString()}</p>
            </div>
            <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
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
              <button onClick={() => togglePublished(ev)}
                className={`text-xs border px-3 py-1.5 rounded-lg whitespace-nowrap ${ev.is_published ? 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10' : 'border-zinc-700 text-zinc-400 hover:border-emerald-500/50 hover:text-emerald-400'}`}>
                {ev.is_published ? 'Unpublish' : 'Publish'}
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
