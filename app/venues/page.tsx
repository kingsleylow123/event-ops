'use client'
import { useEffect, useMemo, useState } from 'react'
import type { Event } from '@/lib/supabase'
import { useCachedFetch, mutateCache } from '@/lib/useCachedFetch'
import { resolveInitialEvent, storeEventId } from '@/lib/event'
import { VENUES, venueLabel, type Venue } from '@/lib/venues'

const DISPLAY = "'Fraunces', Georgia, 'Times New Roman', serif"

// "+60 12-311 2639" → tel / wa.me digit strings
function digits(phone?: string) { return (phone || '').replace(/[^\d]/g, '') }

type SortKey = 'default' | 'priceAsc' | 'capDesc'

export default function VenuesPage() {
  const { data: eventsData } = useCachedFetch<Event[]>('events', '/api/events')
  const [events, setEvents] = useState<Event[]>([])
  const [eventId, setEventId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errId, setErrId] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>('default')
  const [showTbc, setShowTbc] = useState(true)

  useEffect(() => {
    if (!eventsData) return
    setEvents(eventsData)
    if (!eventId) setEventId(resolveInitialEvent(eventsData)?.id ?? null)
  }, [eventsData, eventId])

  const activeEvent = events.find(e => e.id === eventId) || null

  const venues = useMemo(() => {
    let list = showTbc ? VENUES : VENUES.filter(v => v.status === 'available')
    if (sort === 'priceAsc') {
      list = [...list].sort((a, b) => (a.priceRM ?? Infinity) - (b.priceRM ?? Infinity))
    } else if (sort === 'capDesc') {
      list = [...list].sort((a, b) => (b.capacity ?? -1) - (a.capacity ?? -1))
    }
    return list
  }, [sort, showTbc])

  async function selectVenue(v: Venue) {
    if (!activeEvent || v.status === 'tbc') return
    const label = venueLabel(v)
    setBusyId(v.id)
    setErrId(null)
    try {
      const res = await fetch('/api/events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeEvent.id, venue: label }),
      })
      if (!res.ok) throw new Error('patch failed')
      const updated = await res.json()
      setEvents(prev => prev.map(e => (e.id === updated.id ? updated : e)))
      mutateCache<Event[]>('events', prev => (prev ?? []).map(e => (e.id === updated.id ? updated : e)))
    } catch {
      setErrId(v.id) // surface the failure so the manager doesn't assume it saved
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Scoped display font for headings + venue names (precedence → hoisted to <head>) */}
      <link rel="stylesheet" precedence="default" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,500&display=swap" />
      <style>{`
        @keyframes venueRise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
        .venue-card { animation: venueRise .5s cubic-bezier(.22,.61,.36,1) both; }
        .venue-card:hover .venue-photo { transform: scale(1.05); }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-[#111] p-6 sm:p-8">
        <div className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-amber-500/80">
              Pre-Event · Room Rental Partners
            </p>
            <h1 className="mt-2 text-4xl sm:text-5xl text-white" style={{ fontFamily: DISPLAY, fontWeight: 600, letterSpacing: '-0.01em' }}>
              Venues
            </h1>
            <p className="mt-2 max-w-xl text-sm text-zinc-400">
              Room rental only. Compare capacity &amp; price, reach the PIC in one tap, and set the
              venue straight onto your event.
            </p>
          </div>
          {/* Which event are we setting the venue for */}
          <div className="shrink-0 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
            <p id="venue-event-label" className="mb-1 text-[11px] uppercase tracking-widest text-zinc-500">Setting venue for</p>
            {events.length ? (
              <select
                aria-labelledby="venue-event-label"
                value={eventId ?? ''}
                onChange={e => { setEventId(e.target.value); storeEventId(e.target.value) }}
                className="w-full max-w-[15rem] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white focus:border-amber-500/60 focus:outline-none"
              >
                {events.map(e => (
                  <option key={e.id} value={e.id}>{e.name}{e.is_active ? ' • active' : ''}</option>
                ))}
              </select>
            ) : (
              <span className="text-sm text-zinc-500">No events yet</span>
            )}
            {activeEvent?.venue && (
              <p className="mt-1.5 text-[11px] text-zinc-500">
                Current: <span className="text-amber-400">{activeEvent.venue}</span>
              </p>
            )}
            {activeEvent && !activeEvent.is_active && (
              <p className="mt-1.5 text-[11px] text-amber-500/80">⚠️ Not the active event</p>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="relative mt-6 flex flex-wrap items-center gap-2">
          <SortChip label="Curated" active={sort === 'default'} onClick={() => setSort('default')} />
          <SortChip label="Price ↑" active={sort === 'priceAsc'} onClick={() => setSort('priceAsc')} />
          <SortChip label="Capacity ↓" active={sort === 'capDesc'} onClick={() => setSort('capDesc')} />
          <span className="mx-1 h-4 w-px bg-zinc-800" />
          <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
            <input type="checkbox" checked={showTbc} onChange={e => setShowTbc(e.target.checked)}
              className="h-3.5 w-3.5 accent-amber-500" />
            Show coming-soon
          </label>
          <span className="ml-auto text-xs text-zinc-500">{venues.length} spaces</span>
        </div>
      </header>

      {/* No event → the Set buttons can't do anything; say so plainly (mobile-safe) */}
      {events.length === 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          Create an event first (in <span className="font-semibold">Events</span>) — then come back to set its venue.
        </div>
      )}

      {/* ── Grid ───────────────────────────────────────────────── */}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {venues.map((v, i) => (
          <VenueCard
            key={v.id}
            v={v}
            index={i}
            selected={!!activeEvent?.venue && activeEvent.venue === venueLabel(v)}
            canSelect={!!activeEvent}
            busy={busyId === v.id}
            error={errId === v.id}
            onSelect={() => selectVenue(v)}
          />
        ))}
      </div>
    </div>
  )
}

function SortChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex min-h-8 items-center rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
          : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
      }`}
    >
      {label}
    </button>
  )
}

function VenueCard({
  v, index, selected, canSelect, busy, error, onSelect,
}: {
  v: Venue; index: number; selected: boolean; canSelect: boolean; busy: boolean; error: boolean; onSelect: () => void
}) {
  const tbc = v.status === 'tbc'
  const d = digits(v.picPhone)

  return (
    <article
      aria-label={`${v.name}${v.room ? ' — ' + v.room : ''}`}
      className={`venue-card group flex flex-col overflow-hidden rounded-2xl border bg-[#111] transition-all duration-200 hover:-translate-y-0.5 ${
        selected ? 'border-amber-500/60 shadow-[0_0_0_1px_rgba(245,158,11,0.25)]' : 'border-zinc-800 hover:border-zinc-700'
      }`}
      style={{ animationDelay: `${Math.min(index, 9) * 55}ms` }}
    >
      {/* Photo / placeholder */}
      <div className="relative aspect-[16/10] overflow-hidden bg-zinc-900">
        {v.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={v.photo}
            alt={`${v.name}${v.room ? ' — ' + v.room : ''}`}
            loading="lazy"
            className="venue-photo h-full w-full object-cover transition-transform duration-500"
          />
        ) : (
          <Placeholder name={v.name} tbc={tbc} />
        )}
        {/* top badges */}
        <div className="absolute inset-x-0 top-0 flex items-start justify-between p-3">
          {v.capacity ? (
            <span className="rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
              👥 {v.capacity} pax{v.layout ? ` ${v.layout}` : ''}
            </span>
          ) : <span />}
          {selected ? (
            <span className="rounded-full bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-black">✓ Selected</span>
          ) : tbc ? (
            <span className="rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-zinc-300 backdrop-blur-sm">Coming soon</span>
          ) : null}
        </div>
        {/* price chip over gradient */}
        {(v.priceRM != null || v.priceNote) && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-8">
            <span className="text-lg font-bold text-white" style={{ fontFamily: DISPLAY }}>
              {v.priceRM != null ? `RM ${v.priceRM.toLocaleString('en-MY')}` : v.priceNote}
            </span>
            {v.priceRM != null && <span className="ml-1 text-xs text-zinc-300">/ day</span>}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg leading-tight text-white" style={{ fontFamily: DISPLAY, fontWeight: 600 }}>
            {v.name}
          </h2>
          {v.area && <span className="shrink-0 text-xs text-zinc-500">📍 {v.area}</span>}
        </div>
        {v.room && <p className="mt-0.5 text-sm text-zinc-400">{v.room}</p>}

        {v.capacity && (
          <p className="mt-1.5 inline-flex w-fit items-center gap-1.5 rounded-md bg-white/5 px-2 py-0.5 text-xs text-zinc-300">
            🪑 {v.capacity} pax · <span className="capitalize text-white">{v.layout ?? 'classroom'}</span>
          </p>
        )}

        {v.priceRM != null && v.priceNote && (
          <p className="mt-1 text-xs text-amber-400/90">{v.priceNote}</p>
        )}
        {v.notes && (
          <p className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-md bg-sky-500/10 px-2 py-1 text-[11px] text-sky-300">
            ◈ {v.notes}
          </p>
        )}

        {/* PIC + contact */}
        {v.picName ? (
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-zinc-800/80 pt-3">
            <div className="min-w-0">
              <p className="truncate text-sm text-zinc-300">{v.picName}</p>
              {v.picPhone && <p className="truncate text-xs text-zinc-500">{v.picPhone}</p>}
            </div>
            {d && (
              <div className="flex shrink-0 gap-1.5">
                <a href={`tel:+${d}`} aria-label={`Call ${v.picName}`} title={`Call ${v.picName}`}
                  className="grid h-10 w-10 place-items-center rounded-lg border border-zinc-700 text-zinc-300 transition-colors hover:border-amber-500/50 hover:text-amber-400">📞</a>
                <a href={`https://wa.me/${d}`} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${v.picName}`} title={`WhatsApp ${v.picName}`}
                  className="grid h-10 w-10 place-items-center rounded-lg border border-zinc-700 text-zinc-300 transition-colors hover:border-emerald-500/50 hover:text-emerald-400">💬</a>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-3 border-t border-zinc-800/80 pt-3 text-xs text-zinc-500">
            {tbc ? 'Coming soon — details pending' : 'No PIC on file yet'}
          </div>
        )}

        {/* Select */}
        <div className="mt-3">
          {tbc ? (
            <button disabled aria-disabled="true" title="Venue details not confirmed yet"
              className="w-full cursor-not-allowed rounded-lg border border-zinc-800 bg-zinc-900/40 py-2 text-sm text-zinc-500">
              Details TBC
            </button>
          ) : selected ? (
            <div className="w-full rounded-lg border border-amber-500/40 bg-amber-500/10 py-2 text-center text-sm font-medium text-amber-300">
              ✓ Venue for this event
            </div>
          ) : (
            <button
              onClick={onSelect}
              disabled={!canSelect || busy}
              title={canSelect ? 'Set this as the event venue' : 'Create an event first'}
              className="w-full rounded-lg bg-amber-500 py-2 text-sm font-semibold text-black transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              {busy ? 'Setting…' : 'Set as venue'}
            </button>
          )}
          {error && (
            <p className="mt-1.5 text-center text-xs text-red-400">Couldn&apos;t save — tap to retry.</p>
          )}
        </div>
      </div>
    </article>
  )
}

function Placeholder({ name, tbc }: { name: string; tbc: boolean }) {
  const initial = name.replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase() || '·'
  return (
    <div className="relative flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-900 via-[#15130e] to-[#1a140a]">
      <div
        className="absolute inset-0 opacity-[0.4]"
        style={{ backgroundImage: 'radial-gradient(circle at 30% 20%, rgba(245,158,11,0.12), transparent 55%)' }}
      />
      <span className="select-none text-6xl text-amber-500/25" style={{ fontFamily: DISPLAY, fontWeight: 600 }}>{initial}</span>
      <span className="absolute bottom-2 right-3 text-[10px] uppercase tracking-widest text-zinc-600">
        {tbc ? 'Scouting' : 'Photo soon'}
      </span>
    </div>
  )
}
