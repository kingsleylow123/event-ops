'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

/* ──────────────────────────────────────────────────────────────────────────
   Claude Malaysia — public events calendar (/events)
   Warm editorial aesthetic: Fraunces serif display, cream "paper" ground,
   clay-orange accent, mono micro-labels, calm staggered motion.
   Data: GET /api/public/events  ·  Waitlist: POST /api/public/waitlist
   ────────────────────────────────────────────────────────────────────────── */

const COMMUNITY_URL = 'https://claudemalaysia.com/join'
const INSTAGRAM_URL = 'https://www.instagram.com/claudemalaysiaofficial/'

type Phase = 'waitlist' | 'super_early_bird' | 'early_bird' | 'public' | 'sold_out'

interface PublicListing {
  tagline?: string
  summary?: string
  hero_image_url?: string
  location_city?: string
  starts_at?: string
  ends_at?: string
  register_url?: string
  cta_label?: string
  seats_left?: number
  price_super_early?: string
  price_early?: string
  price_public?: string
  highlights?: string[]
}

interface PublicEvent {
  id: string
  name: string
  date: string | null
  venue: string | null
  capacity: number | null
  format?: string
  current_phase?: Phase | null
  public_listing?: PublicListing | null
}

const PHASE_ORDER: Phase[] = ['waitlist', 'super_early_bird', 'early_bird', 'public', 'sold_out']

const PHASE_META: Record<Phase, { short: string; label: string; tone: string }> = {
  waitlist: { short: 'Waitlist', label: 'Waitlist open', tone: 'stone' },
  super_early_bird: { short: 'Super Early Bird', label: 'Super Early Bird', tone: 'clay' },
  early_bird: { short: 'Early Bird', label: 'Early Bird', tone: 'honey' },
  public: { short: 'Public', label: 'Public on sale', tone: 'sage' },
  sold_out: { short: 'Sold Out', label: 'Sold out', tone: 'rust' },
}

const SALE_PHASES: Phase[] = ['super_early_bird', 'early_bird', 'public']

/* ── date / data helpers ─────────────────────────────────────────────────── */
const KL = 'Asia/Kuala_Lumpur'

function eventISO(ev: PublicEvent): string | null {
  return ev.public_listing?.starts_at || ev.date || null
}

function dateParts(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const o = { timeZone: KL } as const
  return {
    day: d.toLocaleString('en-MY', { day: '2-digit', ...o }),
    mon: d.toLocaleString('en-MY', { month: 'short', ...o }).toUpperCase(),
    weekday: d.toLocaleString('en-MY', { weekday: 'short', ...o }).toUpperCase(),
    time: d.toLocaleString('en-MY', { hour: 'numeric', minute: '2-digit', hour12: true, ...o }),
    full: d.toLocaleString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', ...o }),
    year: d.toLocaleString('en-MY', { year: 'numeric', ...o }),
    ms: d.getTime(),
  }
}

// Local (Asia/Kuala_Lumpur) calendar-day key, e.g. "2026-07-19", for grouping on the month grid.
function klYMD(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: KL, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

function phasePrice(ev: PublicEvent): string | null {
  const p = ev.current_phase
  const L = ev.public_listing || {}
  if (p === 'super_early_bird') return L.price_super_early || null
  if (p === 'early_bird') return L.price_early || null
  if (p === 'public') return L.price_public || null
  return null
}

function isSale(ev: PublicEvent) {
  return !!ev.current_phase && SALE_PHASES.includes(ev.current_phase)
}

/* ── reveal-on-scroll (CSS + IntersectionObserver, reduced-motion safe) ───── */
function useReveal(dep: unknown) {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'))
    if (!els.length) return
    const revealAll = () => els.forEach(el => el.classList.add('is-in'))
    if (!('IntersectionObserver' in window)) {
      revealAll()
      return
    }
    const io = new IntersectionObserver(
      entries => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            e.target.classList.add('is-in')
            io.unobserve(e.target)
          }
        })
      },
      { threshold: 0.1, rootMargin: '0px 0px -6% 0px' },
    )
    els.forEach(el => io.observe(el))
    // Safety net: content must never stay hidden — reveal everything within 1.4s
    // even if the observer never fires (no scroll, headless capture, restored scroll).
    const t = setTimeout(revealAll, 1400)
    return () => {
      io.disconnect()
      clearTimeout(t)
    }
  }, [dep])
}

/* ── countdown to the next event ─────────────────────────────────────────── */
function Countdown({ target }: { target: number }) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (now === null) return null
  const diff = target - now
  if (diff <= 0) return <span className="cm-count-live">Happening now</span>
  const d = Math.floor(diff / 86400000)
  const h = Math.floor((diff % 86400000) / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  const cell = (v: number, l: string) => (
    <span className="cm-count-cell">
      <b>{String(v).padStart(2, '0')}</b>
      <i>{l}</i>
    </span>
  )
  return (
    <div className="cm-count" aria-label="Time until the next event">
      {cell(d, 'days')}
      {cell(h, 'hrs')}
      {cell(m, 'min')}
      {cell(s, 'sec')}
    </div>
  )
}

/* ── phase badge ─────────────────────────────────────────────────────────── */
function PhaseBadge({ phase, soft = false }: { phase?: Phase | null; soft?: boolean }) {
  if (!phase) return null
  const m = PHASE_META[phase]
  return (
    <span className={`cm-phase cm-phase--${m.tone}${soft ? ' cm-phase--soft' : ''}`}>
      <span className="cm-phase-dot" />
      {m.label}
    </span>
  )
}

/* ── phase ladder (signature element) ────────────────────────────────────── */
function PhaseLadder({ ev }: { ev: PublicEvent }) {
  const L = ev.public_listing || {}
  const priceFor: Partial<Record<Phase, string>> = {
    waitlist: 'Free',
    super_early_bird: L.price_super_early || '',
    early_bird: L.price_early || '',
    public: L.price_public || '',
    sold_out: 'Next round',
  }
  const currentIdx = ev.current_phase ? PHASE_ORDER.indexOf(ev.current_phase) : -1
  return (
    <div className="cm-ladder" role="list" aria-label="Pricing phases">
      {PHASE_ORDER.map((p, i) => {
        const m = PHASE_META[p]
        const state = i < currentIdx ? 'past' : i === currentIdx ? 'live' : 'next'
        return (
          <div key={p} className={`cm-rung cm-rung--${state} cm-rung--${m.tone}`} role="listitem">
            <span className="cm-rung-label">{m.short}</span>
            <span className="cm-rung-price">{priceFor[p] || '—'}</span>
            {state === 'live' && <span className="cm-rung-tag">You’re here</span>}
          </div>
        )
      })}
    </div>
  )
}

/* ── waitlist / notify form ──────────────────────────────────────────────── */
function NotifyForm({
  eventId,
  context,
  compact = false,
  onDone,
}: {
  eventId?: string
  context?: string
  compact?: boolean
  onDone?: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [err, setErr] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email && !phone) {
      setErr('Pop in your email or WhatsApp number.')
      setStatus('error')
      return
    }
    setStatus('sending')
    setErr('')
    try {
      const res = await fetch('/api/public/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, event_id: eventId }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Something went wrong')
      }
      setStatus('done')
      onDone?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong')
      setStatus('error')
    }
  }

  if (status === 'done') {
    return (
      <div className="cm-notify-done" role="status">
        <span className="cm-notify-check">✦</span>
        <p className="cm-notify-done-t">You’re on the list.</p>
        <p className="cm-notify-done-s">
          We’ll message you the moment {context ? <b>{context}</b> : 'the next batch'} opens — before it
          goes public.
        </p>
      </div>
    )
  }

  return (
    <form className={`cm-notify${compact ? ' cm-notify--compact' : ''}`} onSubmit={submit} noValidate>
      <div className="cm-notify-row">
        <input
          className="cm-input"
          placeholder="Your name"
          value={name}
          onChange={e => setName(e.target.value)}
          autoComplete="name"
        />
        <input
          className="cm-input"
          placeholder="Email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete="email"
        />
      </div>
      <div className="cm-notify-row">
        <input
          className="cm-input"
          placeholder="WhatsApp number"
          inputMode="tel"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          autoComplete="tel"
        />
        <button className="cm-btn cm-btn--primary cm-notify-go" type="submit" disabled={status === 'sending'}>
          {status === 'sending' ? 'Adding…' : 'Notify me'}
        </button>
      </div>
      {status === 'error' && <p className="cm-notify-err">{err}</p>}
      {status !== 'error' && (
        <p className="cm-notify-fine">No spam. Just the next workshop, and the early-bird window.</p>
      )}
    </form>
  )
}

/* ── modal ───────────────────────────────────────────────────────────────── */
function WaitlistModal({ ev, onClose }: { ev: PublicEvent | 'general'; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const isEvent = ev !== 'general'
  const title = isEvent ? ev.name : 'Be first in line'
  const sub = isEvent
    ? ev.current_phase === 'sold_out'
      ? 'This one’s full — join the waitlist and you’ll get first dibs on the next round.'
      : 'Tickets aren’t open yet. Join the waitlist and we’ll give you the first window.'
    : 'Drop your details and we’ll ping you the moment the next workshop opens.'

  return (
    <div className="cm-modal-scrim" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="cm-modal" onClick={e => e.stopPropagation()}>
        <button className="cm-modal-x" onClick={onClose} aria-label="Close">
          ×
        </button>
        <p className="cm-eyebrow">Waitlist</p>
        <h3 className="cm-modal-t">{title}</h3>
        <p className="cm-modal-s">{sub}</p>
        <NotifyForm
          eventId={isEvent ? ev.id : undefined}
          context={isEvent ? ev.name : undefined}
          onDone={() => {}}
        />
      </div>
    </div>
  )
}

/* ── event card (grid) ───────────────────────────────────────────────────── */
function EventCard({ ev, onWaitlist }: { ev: PublicEvent; onWaitlist: (ev: PublicEvent) => void }) {
  const dp = dateParts(eventISO(ev))
  const L = ev.public_listing || {}
  const price = phasePrice(ev)
  const sale = isSale(ev)
  return (
    <article className="cm-card" data-reveal>
      <div className="cm-card-top">
        <div className="cm-datechip">
          <b>{dp?.day || '—'}</b>
          <i>{dp?.mon || ''}</i>
        </div>
        <PhaseBadge phase={ev.current_phase} soft />
      </div>
      <h3 className="cm-card-title">{ev.name}</h3>
      <p className="cm-card-meta">
        {dp ? <span>{dp.weekday}, {dp.time}</span> : <span>Date TBA</span>}
        {(L.location_city || ev.venue) && <span className="cm-dot" />}
        {(L.location_city || ev.venue) && <span>{L.location_city || ev.venue}</span>}
      </p>
      {L.summary && <p className="cm-card-sum">{L.summary}</p>}
      <div className="cm-card-foot">
        <div className="cm-priceblock">
          {price ? (
            <>
              <span className="cm-price">{price}</span>
              {typeof L.seats_left === 'number' && ev.current_phase !== 'sold_out' && (
                <span className="cm-seats">{L.seats_left} seats left</span>
              )}
            </>
          ) : (
            <span className="cm-price cm-price--soft">
              {ev.current_phase === 'sold_out' ? 'Sold out' : 'Opens soon'}
            </span>
          )}
        </div>
        {sale && L.register_url ? (
          <a className="cm-btn cm-btn--primary cm-btn--sm" href={L.register_url} target="_blank" rel="noopener noreferrer">
            {L.cta_label || 'Reserve seat'}
          </a>
        ) : (
          <button className="cm-btn cm-btn--ghost cm-btn--sm" onClick={() => onWaitlist(ev)}>
            {ev.current_phase === 'sold_out' ? 'Waitlist' : 'Notify me'}
          </button>
        )}
      </div>
    </article>
  )
}

/* ── featured spotlight ──────────────────────────────────────────────────── */
function Spotlight({ ev, onWaitlist }: { ev: PublicEvent; onWaitlist: (ev: PublicEvent) => void }) {
  const dp = dateParts(eventISO(ev))
  const L = ev.public_listing || {}
  const price = phasePrice(ev)
  const sale = isSale(ev)
  return (
    <div className="cm-spot" data-reveal>
      <div className="cm-spot-glow" aria-hidden />
      <div className="cm-spot-body">
        <div className="cm-spot-head">
          <p className="cm-eyebrow">Next up</p>
          <PhaseBadge phase={ev.current_phase} />
        </div>

        <div className="cm-spot-grid">
          <div className="cm-spot-main">
            <h2 className="cm-spot-title">{ev.name}</h2>
            {L.tagline && <p className="cm-spot-tag">{L.tagline}</p>}

            <ul className="cm-spot-facts">
              <li>
                <span className="cm-fact-k">When</span>
                <span className="cm-fact-v">{dp ? `${dp.full} · ${dp.time}` : 'To be announced'}</span>
              </li>
              <li>
                <span className="cm-fact-k">Where</span>
                <span className="cm-fact-v">
                  {L.location_city || ev.venue || 'Venue announced soon'}
                  {L.location_city && ev.venue ? ` · ${ev.venue}` : ''}
                </span>
              </li>
              {ev.format && (
                <li>
                  <span className="cm-fact-k">Format</span>
                  <span className="cm-fact-v cm-cap">{ev.format}</span>
                </li>
              )}
            </ul>

            {L.summary && <p className="cm-spot-sum">{L.summary}</p>}

            {!!L.highlights?.length && (
              <ul className="cm-hl">
                {L.highlights!.map((h, i) => (
                  <li key={i}>
                    <span className="cm-hl-tick">→</span>
                    {h}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <aside className="cm-spot-side">
            {dp && dp.ms > Date.now() && <Countdown target={dp.ms} />}
            <div className="cm-spot-pricecard">
              <span className="cm-spot-pricek">{sale ? 'Current price' : 'Status'}</span>
              <span className="cm-spot-price">
                {price || (ev.current_phase === 'sold_out' ? 'Sold out' : 'Opens soon')}
              </span>
              {typeof L.seats_left === 'number' && ev.current_phase !== 'sold_out' && (
                <span className="cm-spot-seats">
                  <span className="cm-pulse" /> {L.seats_left} seats left
                </span>
              )}
              {sale && L.register_url ? (
                <a className="cm-btn cm-btn--primary cm-btn--block" href={L.register_url} target="_blank" rel="noopener noreferrer">
                  {L.cta_label || 'Reserve my seat'}
                </a>
              ) : (
                <button className="cm-btn cm-btn--primary cm-btn--block" onClick={() => onWaitlist(ev)}>
                  {ev.current_phase === 'sold_out' ? 'Join the waitlist' : 'Notify me when it opens'}
                </button>
              )}
              <p className="cm-spot-fineprice">
                {sale ? 'Price rises as seats fill. Lock yours now.' : 'We’ll give the list first access.'}
              </p>
            </div>
          </aside>
        </div>

        <div className="cm-spot-ladder">
          <p className="cm-ladder-cap">How seats are priced — earlier is cheaper</p>
          <PhaseLadder ev={ev} />
        </div>
      </div>
    </div>
  )
}

/* ── page ────────────────────────────────────────────────────────────────── */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/* ── month calendar (Google-Calendar-style, Claude-themed) ───────────────── */
function MonthCalendar({ events, onWaitlist }: { events: PublicEvent[]; onWaitlist: (ev: PublicEvent) => void }) {
  const byDay = useMemo(() => {
    const m: Record<string, PublicEvent[]> = {}
    for (const ev of events) {
      const k = klYMD(eventISO(ev))
      if (k) (m[k] ||= []).push(ev)
    }
    return m
  }, [events])

  const todayKey = useMemo(() => klYMD(new Date().toISOString()) || '', [])

  // Open on the month of the soonest upcoming event (else the earliest, else today).
  const initial = useMemo(() => {
    const keys = Object.keys(byDay).sort()
    const base = keys.find(k => k >= todayKey) || keys[0] || todayKey
    return { y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) - 1 }
  }, [byDay, todayKey])

  const [cur, setCur] = useState(initial)

  const move = (delta: number) =>
    setCur(c => {
      const d = new Date(Date.UTC(c.y, c.m + delta, 1))
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() }
    })

  const pad2 = (n: number) => String(n).padStart(2, '0')
  const daysInMonth = new Date(Date.UTC(cur.y, cur.m + 1, 0)).getUTCDate()
  const firstDow = new Date(Date.UTC(cur.y, cur.m, 1)).getUTCDay()

  const cells: ({ day: number; key: string } | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, key: `${cur.y}-${pad2(cur.m + 1)}-${pad2(d)}` })
  while (cells.length % 7 !== 0) cells.push(null)

  const clickEv = (ev: PublicEvent) => {
    const url = ev.public_listing?.register_url
    if (isSale(ev) && url) window.open(url, '_blank', 'noopener')
    else onWaitlist(ev)
  }

  return (
    <div className="cm-cal">
      <div className="cm-cal-head">
        <button className="cm-cal-nav" onClick={() => move(-1)} aria-label="Previous month">‹</button>
        <div className="cm-cal-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
          {MONTHS[cur.m]} <span>{cur.y}</span>
        </div>
        <button className="cm-cal-nav" onClick={() => move(1)} aria-label="Next month">›</button>
      </div>
      <div className="cm-cal-grid cm-cal-dow">
        {WEEKDAYS.map(w => (
          <div key={w} className="cm-cal-dowcell"><span>{w[0]}</span><em>{w}</em></div>
        ))}
      </div>
      <div className="cm-cal-grid">
        {cells.map((c, i) => {
          if (!c) return <div key={i} className="cm-cal-cell cm-cal-cell--pad" />
          const evs = byDay[c.key] || []
          const past = c.key < todayKey
          const isToday = c.key === todayKey
          return (
            <div key={i} className={`cm-cal-cell${past ? ' cm-cal-cell--past' : ''}${evs.length ? ' cm-cal-cell--has' : ''}`}>
              <span className={`cm-cal-daynum${isToday ? ' cm-cal-daynum--today' : ''}`}>{c.day}</span>
              <div className="cm-cal-chips">
                {evs.map(ev => {
                  const tone = ev.current_phase ? PHASE_META[ev.current_phase].tone : 'clay'
                  return (
                    <button key={ev.id} className="cm-cal-chip" onClick={() => clickEv(ev)} title={ev.name}>
                      <span className={`cm-cal-cdot cm-tone--${tone}`} />
                      <span className="cm-cal-chip-t">{ev.name}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <div className="cm-cal-legend">
        <span>Tap an event to reserve your seat or join the waitlist.</span>
        <button className="cm-cal-today" onClick={() => setCur(initial)}>Jump to next event ↺</button>
      </div>
    </div>
  )
}

export default function EventsPage() {
  const [events, setEvents] = useState<PublicEvent[] | null>(null)
  const [error, setError] = useState(false)
  const [modal, setModal] = useState<PublicEvent | 'general' | null>(null)
  const [view, setView] = useState<'calendar' | 'list'>('calendar')
  const nextRef = useRef<HTMLElement>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/public/events')
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: PublicEvent[]) => {
        if (alive) setEvents(Array.isArray(d) ? d : [])
      })
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
  }, [])

  // Sort published events by date ascending (nulls last). Soonest = featured.
  const sorted = useMemo(() => {
    const list = events || []
    return [...list].sort((a, b) => {
      const am = dateParts(eventISO(a))?.ms ?? Infinity
      const bm = dateParts(eventISO(b))?.ms ?? Infinity
      return am - bm
    })
  }, [events])

  const featured = sorted[0]
  const hasEvents = sorted.length > 0

  useReveal(events === null ? 'loading' : `${view}:${sorted.length}`)

  const scrollNext = () =>
    nextRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="cm">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="cm-grain" aria-hidden />

      {/* header */}
      <header className="cm-header">
        <a className="cm-brand" href="/events">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/claude-logo.jpg" alt="" width={30} height={30} className="cm-brand-logo" />
          <span className="cm-brand-name">
            Claude Malaysia
            <i>Events</i>
          </span>
        </a>
        <nav className="cm-nav">
          <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer">Instagram</a>
          <a className="cm-nav-cta" href={COMMUNITY_URL} target="_blank" rel="noopener noreferrer">
            Join the community
          </a>
        </nav>
      </header>

      {/* hero */}
      <section className="cm-hero">
        <div className="cm-hero-glow" aria-hidden />
        <div className="cm-hero-inner">
          <p className="cm-eyebrow cm-fade" style={{ animationDelay: '.05s' }}>
            Claude Malaysia · Live events
          </p>
          <h1 className="cm-h1 cm-fade" style={{ animationDelay: '.12s' }}>
            Learn to build with AI —{' '}
            <em>in one room, in one afternoon.</em>
          </h1>
          <p className="cm-lead cm-fade" style={{ animationDelay: '.2s' }}>
            Hands-on Claude workshops and community nights across Malaysia. Find the next session, see
            what you’ll build, and claim your seat before the early-bird window closes.
          </p>
          <div className="cm-hero-cta cm-fade" style={{ animationDelay: '.28s' }}>
            <button className="cm-btn cm-btn--primary cm-btn--lg" onClick={scrollNext}>
              {hasEvents ? 'See the next workshop' : 'Get on the list'}
            </button>
            <a className="cm-btn cm-btn--ghost cm-btn--lg" href={COMMUNITY_URL} target="_blank" rel="noopener noreferrer">
              Join the community
            </a>
          </div>
          <div className="cm-stats cm-fade" style={{ animationDelay: '.36s' }}>
            <span><b>1,200+</b> members</span>
            <span className="cm-dot" />
            <span><b>Batch 4</b> &amp; beyond</span>
            <span className="cm-dot" />
            <span><b>Kuala Lumpur</b> &amp; nationwide</span>
          </div>
        </div>
      </section>

      {/* next + grid */}
      <main className="cm-main" ref={nextRef}>
        {error && (
          <p className="cm-state">Couldn’t load events right now. Please refresh in a moment.</p>
        )}

        {!error && events === null && (
          <div className="cm-spot cm-spot--skeleton" aria-hidden>
            <div className="cm-skel-line" style={{ width: '40%' }} />
            <div className="cm-skel-line" style={{ width: '70%', height: 34 }} />
            <div className="cm-skel-line" style={{ width: '55%' }} />
            <div className="cm-skel-grid">
              <div className="cm-skel-block" />
              <div className="cm-skel-block" />
            </div>
          </div>
        )}

        {!error && events !== null && (
          <>
            {hasEvents ? (
              <>
                <p className="cm-section-eyebrow" data-reveal>The next room</p>
                <Spotlight ev={featured} onWaitlist={ev => setModal(ev)} />

                <section className="cm-browse">
                  <div className="cm-browse-head" data-reveal>
                    <div>
                      <h2 className="cm-h2">All upcoming workshops</h2>
                      <p className="cm-h2-sub">Browse by date, or lock in early-bird before each climbs to public price.</p>
                    </div>
                    <div className="cm-viewtoggle" role="tablist" aria-label="Choose view">
                      <button className={view === 'calendar' ? 'is-on' : ''} aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
                        Calendar
                      </button>
                      <button className={view === 'list' ? 'is-on' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
                        List
                      </button>
                    </div>
                  </div>
                  {view === 'calendar' ? (
                    <MonthCalendar events={sorted} onWaitlist={e => setModal(e)} />
                  ) : (
                    <div className="cm-grid">
                      {sorted.map(ev => (
                        <EventCard key={ev.id} ev={ev} onWaitlist={e => setModal(e)} />
                      ))}
                    </div>
                  )}
                </section>
              </>
            ) : (
              <EmptyState onWaitlist={() => setModal('general')} />
            )}
          </>
        )}

        {/* what happens in the room */}
        <section className="cm-room">
          <p className="cm-section-eyebrow" data-reveal>What happens in the room</p>
          <div className="cm-room-grid">
            {[
              { k: '01', t: 'Build something real', s: 'You leave with a working AI workflow — not a notebook full of theory.' },
              { k: '02', t: 'Hands-on, not a lecture', s: 'Three hours, your laptop, real problems pulled straight from your business.' },
              { k: '03', t: 'Find your people', s: 'A room of Malaysian founders figuring out AI together — and staying in touch after.' },
            ].map((c, i) => (
              <div className="cm-room-card" data-reveal key={c.k} style={{ transitionDelay: `${i * 70}ms` }}>
                <span className="cm-room-k">{c.k}</span>
                <h3 className="cm-room-t">{c.t}</h3>
                <p className="cm-room-s">{c.s}</p>
              </div>
            ))}
          </div>
        </section>

        {/* community / waitlist */}
        <section className="cm-cta" data-reveal>
          <div className="cm-cta-inner">
            <div className="cm-cta-copy">
              <p className="cm-eyebrow">Can’t make the next one?</p>
              <h2 className="cm-cta-title">Get first access to the next batch.</h2>
              <p className="cm-cta-sub">
                Drop your details — we’ll message you the moment the next workshop opens, before seats go
                public. Or jump straight into the community of 1,200+ builders.
              </p>
              <a className="cm-btn cm-btn--ghost cm-cta-wa" href={COMMUNITY_URL} target="_blank" rel="noopener noreferrer">
                <span className="cm-wa-dot" /> Join the WhatsApp community
              </a>
            </div>
            <div className="cm-cta-form">
              <NotifyForm />
            </div>
          </div>
        </section>
      </main>

      {/* footer */}
      <footer className="cm-footer">
        <div className="cm-footer-inner">
          <div className="cm-footer-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/claude-logo.jpg" alt="" width={28} height={28} className="cm-brand-logo" />
            <div>
              <div className="cm-footer-name">Claude Malaysia</div>
              <div className="cm-footer-tag">Helping 10,000 Malaysians make more money with AI.</div>
            </div>
          </div>
          <nav className="cm-footer-nav">
            <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer">Instagram</a>
            <a href={COMMUNITY_URL} target="_blank" rel="noopener noreferrer">Community</a>
            <a href="/events">Events</a>
          </nav>
        </div>
        <p className="cm-footer-fine">An independent community · Built with Claude</p>
      </footer>

      {modal && <WaitlistModal ev={modal} onClose={() => setModal(null)} />}
    </div>
  )
}

/* ── empty state ─────────────────────────────────────────────────────────── */
function EmptyState({ onWaitlist }: { onWaitlist: () => void }) {
  return (
    <div className="cm-empty" data-reveal>
      <div className="cm-spot-glow" aria-hidden />
      <p className="cm-eyebrow">Between batches</p>
      <h2 className="cm-empty-title">No public workshops on sale right now.</h2>
      <p className="cm-empty-sub">
        We run them in batches and they fill fast. Get on the list and you’ll be first to know when the
        next one opens — with the lowest early-bird price.
      </p>
      <div className="cm-empty-form">
        <NotifyForm />
      </div>
      <div className="cm-empty-or">
        <span /> or <span />
      </div>
      <a className="cm-btn cm-btn--ghost cm-btn--lg" href={COMMUNITY_URL} target="_blank" rel="noopener noreferrer">
        Join the community of 1,200+ builders
      </a>
    </div>
  )
}

/* ── styles ──────────────────────────────────────────────────────────────── */
const CSS = `
.cm{
  --paper:#FAF7F2; --paper-2:#F2EBDF; --card:#FFFDF9; --ink:#211C16; --ink-soft:#5F564B; --ink-faint:#978C7B;
  --clay:#D97757; --clay-deep:#BE5C3B; --clay-tint:rgba(217,119,87,.12); --clay-tint-2:rgba(217,119,87,.20);
  --line:rgba(33,28,22,.10); --line-2:rgba(33,28,22,.18);
  --honey:#B6802A; --sage:#4B7A5A; --rust:#A9533F; --stone:#6E6657;
  --sans:var(--font-hanken),ui-sans-serif,system-ui,-apple-system,sans-serif;
  --serif:var(--font-fraunces),Georgia,'Times New Roman',serif;
  --mono:var(--font-mono),ui-monospace,SFMono-Regular,monospace;
  background:var(--paper); color:var(--ink); font-family:var(--sans);
  min-height:100vh; width:100%; position:relative; overflow-x:hidden;
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
}
.cm *{box-sizing:border-box}
.cm a{color:inherit;text-decoration:none}
.cm ::selection{background:var(--clay-tint-2)}

/* paper grain */
.cm-grain{position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.5;mix-blend-mode:multiply;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E");}
.cm>*:not(.cm-grain){position:relative;z-index:1}

/* shared bits */
.cm-eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--clay-deep);font-weight:500;margin:0}
.cm-dot{display:inline-block;width:4px;height:4px;border-radius:50%;background:currentColor;opacity:.35;flex:0 0 auto}
.cm-cap{text-transform:capitalize}

.cm-btn{display:inline-flex;align-items:center;justify-content:center;gap:.5em;font-family:var(--sans);
  font-weight:600;font-size:15px;line-height:1;border:1px solid transparent;border-radius:999px;
  padding:13px 22px;cursor:pointer;transition:transform .18s ease,background .2s ease,box-shadow .2s ease,border-color .2s ease;white-space:nowrap}
.cm-btn:active{transform:translateY(1px)}
.cm-btn--primary{background:var(--clay);color:#fff;box-shadow:0 1px 0 rgba(255,255,255,.4) inset,0 8px 20px -10px rgba(190,92,59,.7)}
.cm-btn--primary:hover{background:var(--clay-deep);box-shadow:0 10px 26px -10px rgba(190,92,59,.8);transform:translateY(-1px)}
.cm-btn--ghost{background:transparent;color:var(--ink);border-color:var(--line-2)}
.cm-btn--ghost:hover{border-color:var(--ink);background:rgba(33,28,22,.03)}
.cm-btn--lg{font-size:16px;padding:16px 28px}
.cm-btn--sm{font-size:13.5px;padding:10px 16px}
.cm-btn--block{width:100%}

/* header */
.cm-header{position:sticky;top:0;z-index:40;display:flex;align-items:center;justify-content:space-between;
  padding:16px clamp(18px,5vw,56px);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  background:rgba(250,247,242,.7);border-bottom:1px solid var(--line)}
.cm-brand{display:flex;align-items:center;gap:11px}
.cm-brand-logo{border-radius:8px;display:block}
.cm-brand-name{display:flex;flex-direction:column;line-height:1.05;font-weight:700;font-size:15px;letter-spacing:-.01em}
.cm-brand-name i{font-style:normal;font-family:var(--mono);font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--clay-deep);font-weight:500;margin-top:2px}
.cm-nav{display:flex;align-items:center;gap:8px}
.cm-nav>a:not(.cm-nav-cta){padding:9px 12px;font-size:14px;font-weight:500;color:var(--ink-soft);border-radius:999px}
.cm-nav>a:not(.cm-nav-cta):hover{color:var(--ink)}
.cm-nav-cta{padding:10px 18px;font-size:14px;font-weight:600;border:1px solid var(--line-2);border-radius:999px}
.cm-nav-cta:hover{border-color:var(--ink);background:rgba(33,28,22,.03)}

/* hero */
.cm-hero{position:relative;padding:clamp(64px,12vw,140px) clamp(18px,5vw,56px) clamp(40px,7vw,80px);overflow:hidden}
.cm-hero-glow{position:absolute;top:-30%;left:50%;transform:translateX(-50%);width:min(1100px,120vw);height:760px;
  background:radial-gradient(closest-side,rgba(217,119,87,.30),rgba(217,119,87,.10) 45%,transparent 72%);
  filter:blur(20px);pointer-events:none}
.cm-hero-inner{max-width:920px;margin:0 auto;text-align:center;position:relative}
.cm-h1{font-family:var(--serif);font-weight:600;letter-spacing:-.02em;line-height:1.03;
  font-size:clamp(40px,7.2vw,82px);margin:18px 0 0;color:var(--ink)}
.cm-h1 em{font-style:italic;color:var(--clay-deep);font-weight:500}
.cm-lead{max-width:660px;margin:22px auto 0;font-size:clamp(16px,2.1vw,20px);line-height:1.55;color:var(--ink-soft)}
.cm-hero-cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:34px}
.cm-stats{display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap;margin-top:30px;
  font-size:14px;color:var(--ink-soft)}
.cm-stats b{color:var(--ink);font-weight:700}

/* main */
.cm-main{max-width:1080px;margin:0 auto;padding:clamp(20px,4vw,40px) clamp(18px,5vw,56px) 40px}
.cm-section-eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.22em;text-transform:uppercase;
  color:var(--ink-faint);font-weight:500;margin:0 0 16px;display:flex;align-items:center;gap:12px}
.cm-section-eyebrow::after{content:"";height:1px;flex:1;background:var(--line)}
.cm-state{text-align:center;color:var(--ink-soft);padding:60px 0;font-size:16px}

/* spotlight */
.cm-spot{position:relative;border:1px solid var(--line-2);border-radius:28px;background:
  linear-gradient(180deg,var(--card),#FFFCF6);overflow:hidden;
  box-shadow:0 1px 0 rgba(255,255,255,.7) inset,0 30px 60px -40px rgba(33,28,22,.35)}
.cm-spot-glow{position:absolute;top:-40%;right:-10%;width:520px;height:520px;
  background:radial-gradient(closest-side,rgba(217,119,87,.18),transparent 70%);pointer-events:none}
.cm-spot-body{position:relative;padding:clamp(22px,3.5vw,40px)}
.cm-spot-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}
.cm-spot-grid{display:grid;grid-template-columns:1.55fr .95fr;gap:clamp(20px,3vw,40px);align-items:start}
.cm-spot-title{font-family:var(--serif);font-weight:600;letter-spacing:-.02em;line-height:1.05;
  font-size:clamp(28px,4.4vw,46px);margin:0;color:var(--ink)}
.cm-spot-tag{font-size:clamp(16px,1.8vw,19px);color:var(--ink-soft);margin:12px 0 0;line-height:1.5}
.cm-spot-facts{list-style:none;padding:0;margin:24px 0 0;display:flex;flex-direction:column;gap:12px}
.cm-spot-facts li{display:flex;gap:16px;align-items:baseline;padding-bottom:12px;border-bottom:1px solid var(--line)}
.cm-spot-facts li:last-child{border-bottom:0;padding-bottom:0}
.cm-fact-k{font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;
  color:var(--ink-faint);width:62px;flex:0 0 auto}
.cm-fact-v{font-size:15.5px;color:var(--ink);font-weight:500}
.cm-spot-sum{margin:22px 0 0;font-size:15.5px;line-height:1.62;color:var(--ink-soft)}
.cm-hl{list-style:none;padding:0;margin:20px 0 0;display:flex;flex-direction:column;gap:9px}
.cm-hl li{display:flex;gap:11px;align-items:flex-start;font-size:15px;color:var(--ink);line-height:1.45}
.cm-hl-tick{color:var(--clay);font-weight:700;flex:0 0 auto}

/* spotlight side / price card */
.cm-spot-side{display:flex;flex-direction:column;gap:16px}
.cm-spot-pricecard{border:1px solid var(--line-2);border-radius:20px;background:var(--paper);
  padding:22px;display:flex;flex-direction:column;gap:10px}
.cm-spot-pricek{font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-faint)}
.cm-spot-price{font-family:var(--serif);font-weight:600;font-size:clamp(30px,5vw,42px);line-height:1;color:var(--ink);letter-spacing:-.01em}
.cm-spot-seats{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--clay-deep)}
.cm-spot-fineprice{font-size:12.5px;color:var(--ink-faint);margin:2px 0 0;line-height:1.4}
.cm-spot-pricecard .cm-btn{margin-top:4px}
.cm-pulse{width:8px;height:8px;border-radius:50%;background:var(--clay);box-shadow:0 0 0 0 rgba(217,119,87,.5);animation:cmpulse 1.8s infinite}
@keyframes cmpulse{0%{box-shadow:0 0 0 0 rgba(217,119,87,.5)}70%{box-shadow:0 0 0 9px rgba(217,119,87,0)}100%{box-shadow:0 0 0 0 rgba(217,119,87,0)}}

/* countdown */
.cm-count{display:flex;gap:8px}
.cm-count-cell{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:11px 6px;
  border:1px solid var(--line);border-radius:13px;background:var(--card)}
.cm-count-cell b{font-family:var(--serif);font-weight:600;font-size:24px;line-height:1;color:var(--ink);font-variant-numeric:tabular-nums}
.cm-count-cell i{font-style:normal;font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-faint)}
.cm-count-live{font-weight:600;color:var(--clay-deep)}

/* phase ladder */
.cm-spot-ladder{margin-top:28px;padding-top:22px;border-top:1px solid var(--line)}
.cm-ladder-cap{font-family:var(--mono);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-faint);margin:0 0 12px}
.cm-ladder{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
.cm-rung{position:relative;display:flex;flex-direction:column;gap:5px;padding:13px 12px;border-radius:14px;
  border:1px solid var(--line);background:var(--paper);min-width:0}
.cm-rung-label{font-size:12px;font-weight:600;color:var(--ink-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cm-rung-price{font-family:var(--serif);font-weight:600;font-size:18px;color:var(--ink);line-height:1}
.cm-rung--past{opacity:.5}
.cm-rung--past .cm-rung-price{text-decoration:line-through;text-decoration-color:var(--ink-faint)}
.cm-rung--live{border-color:var(--clay);background:linear-gradient(180deg,#fff,var(--clay-tint));
  box-shadow:0 10px 24px -16px rgba(190,92,59,.8)}
.cm-rung--live .cm-rung-label{color:var(--clay-deep)}
.cm-rung-tag{font-family:var(--mono);font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#fff;
  background:var(--clay);padding:2px 6px;border-radius:6px;align-self:flex-start;margin-top:1px}

/* upcoming grid */
.cm-upcoming{margin-top:clamp(40px,6vw,72px)}
.cm-up-head{margin-bottom:22px}
.cm-h2{font-family:var(--serif);font-weight:600;letter-spacing:-.02em;font-size:clamp(24px,3.4vw,34px);margin:0;color:var(--ink)}
.cm-h2-sub{margin:6px 0 0;color:var(--ink-soft);font-size:15.5px}
.cm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:18px}

/* view toggle */
.cm-browse{margin-top:clamp(40px,6vw,72px)}
.cm-browse-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:22px}
.cm-viewtoggle{display:inline-flex;background:var(--paper-2);border:1px solid var(--line);border-radius:999px;padding:4px;flex:0 0 auto}
.cm-viewtoggle button{display:inline-flex;align-items:center;gap:7px;font-family:var(--sans);font-size:13.5px;font-weight:600;
  color:var(--ink-soft);background:transparent;border:0;border-radius:999px;padding:8px 16px;cursor:pointer;transition:color .18s ease,background .18s ease,box-shadow .18s ease}
.cm-viewtoggle button svg{width:15px;height:15px}
.cm-viewtoggle button.is-on{background:var(--card);color:var(--ink);box-shadow:0 1px 3px rgba(33,28,22,.14)}

/* month calendar */
.cm-cal{border:1px solid var(--line-2);border-radius:22px;background:var(--card);overflow:hidden;
  box-shadow:0 24px 50px -42px rgba(33,28,22,.4)}
.cm-cal-head{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--line)}
.cm-cal-title{display:flex;align-items:center;gap:10px;font-family:var(--serif);font-weight:600;font-size:23px;color:var(--ink);letter-spacing:-.01em}
.cm-cal-title svg{width:19px;height:19px;color:var(--clay)}
.cm-cal-title span{color:var(--clay-deep)}
.cm-cal-nav{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:50%;
  border:1px solid var(--line-2);background:var(--paper);font-size:20px;line-height:1;color:var(--ink);cursor:pointer;transition:all .15s ease}
.cm-cal-nav:hover{border-color:var(--clay);color:var(--clay-deep);background:var(--clay-tint)}
.cm-cal-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}
.cm-cal-dow{border-bottom:1px solid var(--line);background:var(--paper)}
.cm-cal-dowcell{padding:9px 6px;text-align:center;font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint)}
.cm-cal-dowcell span{display:none}
.cm-cal-cell{position:relative;min-height:112px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);padding:8px;display:flex;flex-direction:column;gap:5px}
.cm-cal-cell:nth-child(7n){border-right:0}
.cm-cal-cell--pad{background:repeating-linear-gradient(-45deg,transparent,transparent 7px,rgba(33,28,22,.022) 7px,rgba(33,28,22,.022) 14px)}
.cm-cal-cell--past{opacity:.5}
.cm-cal-cell--has{background:var(--clay-tint)}
.cm-cal-daynum{font-size:13px;font-weight:600;color:var(--ink-soft);width:25px;height:25px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}
.cm-cal-daynum--today{background:var(--clay);color:#fff;border-radius:50%}
.cm-cal-chips{display:flex;flex-direction:column;gap:4px;min-width:0}
.cm-cal-chip{display:flex;align-items:center;gap:6px;width:100%;text-align:left;background:var(--card);border:1px solid var(--line);
  border-radius:8px;padding:4px 7px;cursor:pointer;transition:transform .15s ease,box-shadow .15s ease,border-color .15s ease;min-width:0}
.cm-cal-chip:hover{border-color:var(--clay);box-shadow:0 5px 14px -8px rgba(190,92,59,.6);transform:translateY(-1px)}
.cm-cal-cdot{width:7px;height:7px;border-radius:50%;flex:0 0 auto}
.cm-cal-chip-t{font-size:11.5px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cm-cal-legend{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:14px 22px;border-top:1px solid var(--line);font-size:12.5px;color:var(--ink-faint)}
.cm-cal-today{font-family:var(--sans);font-size:12.5px;font-weight:600;color:var(--clay-deep);background:transparent;border:0;cursor:pointer;padding:0}
.cm-cal-today:hover{text-decoration:underline}
.cm-tone--clay{background:var(--clay)}
.cm-tone--honey{background:var(--honey)}
.cm-tone--sage{background:var(--sage)}
.cm-tone--rust{background:var(--rust)}
.cm-tone--stone{background:var(--stone)}

/* card */
.cm-card{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:20px;background:var(--card);
  padding:20px;transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}
.cm-card:hover{transform:translateY(-3px);border-color:var(--line-2);box-shadow:0 24px 44px -30px rgba(33,28,22,.45)}
.cm-card-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}
.cm-datechip{display:flex;flex-direction:column;align-items:center;justify-content:center;width:50px;height:54px;
  border-radius:13px;background:var(--paper-2);border:1px solid var(--line)}
.cm-datechip b{font-family:var(--serif);font-weight:600;font-size:22px;line-height:1;color:var(--ink)}
.cm-datechip i{font-style:normal;font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;color:var(--clay-deep);margin-top:2px}
.cm-card-title{font-family:var(--serif);font-weight:600;font-size:20px;line-height:1.2;margin:0;color:var(--ink);letter-spacing:-.01em}
.cm-card-meta{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:9px 0 0;font-size:13px;color:var(--ink-soft)}
.cm-card-sum{margin:12px 0 0;font-size:14px;line-height:1.5;color:var(--ink-soft);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cm-card-foot{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-top:auto;padding-top:18px}
.cm-priceblock{display:flex;flex-direction:column;gap:3px;min-width:0}
.cm-price{font-family:var(--serif);font-weight:600;font-size:22px;line-height:1;color:var(--ink)}
.cm-price--soft{font-size:16px;color:var(--ink-soft)}
.cm-seats{font-size:11.5px;font-weight:600;color:var(--clay-deep)}

/* what happens */
.cm-room{margin-top:clamp(56px,9vw,100px)}
.cm-room-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}
.cm-room-card{border:1px solid var(--line);border-radius:20px;background:var(--card);padding:26px 24px}
.cm-room-k{font-family:var(--mono);font-size:12px;letter-spacing:.1em;color:var(--clay-deep);font-weight:600}
.cm-room-t{font-family:var(--serif);font-weight:600;font-size:21px;margin:12px 0 0;color:var(--ink);letter-spacing:-.01em}
.cm-room-s{margin:9px 0 0;font-size:15px;line-height:1.55;color:var(--ink-soft)}

/* cta band */
.cm-cta{margin-top:clamp(56px,9vw,100px);border-radius:28px;overflow:hidden;border:1px solid var(--line-2);
  background:linear-gradient(135deg,#2A211B,#3A2A20);color:#F6EFE6;position:relative}
.cm-cta-inner{display:grid;grid-template-columns:1.05fr .95fr;gap:clamp(24px,4vw,48px);padding:clamp(28px,4.5vw,52px)}
.cm-cta .cm-eyebrow{color:#E9A788}
.cm-cta-title{font-family:var(--serif);font-weight:600;letter-spacing:-.02em;line-height:1.06;
  font-size:clamp(26px,3.6vw,40px);margin:14px 0 0;color:#FCF7F0}
.cm-cta-sub{margin:14px 0 0;font-size:16px;line-height:1.55;color:#D8C9BA;max-width:440px}
.cm-cta-wa{margin-top:24px;color:#FCF7F0;border-color:rgba(255,255,255,.24)}
.cm-cta-wa:hover{border-color:#fff;background:rgba(255,255,255,.06)}
.cm-wa-dot{width:8px;height:8px;border-radius:50%;background:#5AD07A;box-shadow:0 0 0 3px rgba(90,208,122,.2)}
.cm-cta-form{background:var(--card);border-radius:20px;padding:22px;color:var(--ink);align-self:center}

/* notify form */
.cm-notify{display:flex;flex-direction:column;gap:10px}
.cm-notify-row{display:flex;gap:10px}
.cm-input{flex:1;min-width:0;font-family:var(--sans);font-size:15px;color:var(--ink);background:var(--paper);
  border:1px solid var(--line-2);border-radius:12px;padding:13px 14px;transition:border-color .15s ease,box-shadow .15s ease}
.cm-input::placeholder{color:var(--ink-faint)}
.cm-input:focus{outline:none;border-color:var(--clay);box-shadow:0 0 0 3px var(--clay-tint)}
.cm-notify-go{flex:0 0 auto}
.cm-notify-fine{font-size:12px;color:var(--ink-faint);margin:2px 0 0}
.cm-notify-err{font-size:13px;color:var(--rust);font-weight:500;margin:2px 0 0}
.cm-notify-done{text-align:center;padding:14px 8px}
.cm-notify-check{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;
  background:var(--clay-tint);color:var(--clay-deep);font-size:20px;margin-bottom:10px}
.cm-notify-done-t{font-family:var(--serif);font-weight:600;font-size:20px;margin:0;color:var(--ink)}
.cm-notify-done-s{margin:6px 0 0;font-size:14.5px;line-height:1.5;color:var(--ink-soft)}

/* empty state */
.cm-empty{position:relative;text-align:center;border:1px solid var(--line-2);border-radius:28px;overflow:hidden;
  background:linear-gradient(180deg,var(--card),#FFFCF6);padding:clamp(34px,6vw,64px) clamp(22px,5vw,56px);
  box-shadow:0 30px 60px -44px rgba(33,28,22,.4)}
.cm-empty-title{font-family:var(--serif);font-weight:600;letter-spacing:-.02em;line-height:1.08;
  font-size:clamp(26px,4vw,40px);margin:14px auto 0;max-width:620px;color:var(--ink)}
.cm-empty-sub{max-width:520px;margin:14px auto 0;font-size:16px;line-height:1.55;color:var(--ink-soft)}
.cm-empty-form{max-width:460px;margin:26px auto 0;text-align:left}
.cm-empty-or{display:flex;align-items:center;justify-content:center;gap:14px;margin:24px auto 18px;max-width:300px;
  font-family:var(--mono);font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:var(--ink-faint)}
.cm-empty-or span{height:1px;flex:1;background:var(--line)}

/* phase badges */
.cm-phase{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;
  padding:6px 12px;border-radius:999px;border:1px solid transparent;white-space:nowrap}
.cm-phase-dot{width:7px;height:7px;border-radius:50%;background:currentColor}
.cm-phase--soft{font-size:11.5px;padding:4px 10px}
.cm-phase--clay{color:var(--clay-deep);background:var(--clay-tint);border-color:rgba(217,119,87,.28)}
.cm-phase--honey{color:var(--honey);background:rgba(182,128,42,.14);border-color:rgba(182,128,42,.28)}
.cm-phase--sage{color:var(--sage);background:rgba(75,122,90,.14);border-color:rgba(75,122,90,.28)}
.cm-phase--rust{color:var(--rust);background:rgba(169,83,63,.13);border-color:rgba(169,83,63,.28)}
.cm-phase--stone{color:var(--stone);background:rgba(110,102,87,.12);border-color:rgba(110,102,87,.26)}

/* modal */
.cm-modal-scrim{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:20px;
  background:rgba(33,28,22,.5);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:cmfade .2s ease}
.cm-modal{position:relative;width:100%;max-width:460px;background:var(--card);border:1px solid var(--line-2);
  border-radius:24px;padding:30px;box-shadow:0 40px 80px -30px rgba(33,28,22,.6);animation:cmpop .26s cubic-bezier(.2,.8,.2,1)}
.cm-modal-x{position:absolute;top:16px;right:18px;width:32px;height:32px;border:0;background:transparent;
  font-size:24px;line-height:1;color:var(--ink-faint);cursor:pointer;border-radius:8px}
.cm-modal-x:hover{color:var(--ink);background:rgba(33,28,22,.05)}
.cm-modal-t{font-family:var(--serif);font-weight:600;font-size:25px;line-height:1.15;margin:10px 0 0;color:var(--ink);letter-spacing:-.01em}
.cm-modal-s{margin:8px 0 18px;font-size:15px;line-height:1.5;color:var(--ink-soft)}

/* skeleton */
.cm-spot--skeleton{padding:clamp(22px,3.5vw,40px)}
.cm-skel-line{height:16px;border-radius:8px;background:linear-gradient(90deg,var(--paper-2),#fff,var(--paper-2));
  background-size:200% 100%;animation:cmshimmer 1.4s infinite;margin-bottom:14px}
.cm-skel-grid{display:grid;grid-template-columns:1.5fr 1fr;gap:24px;margin-top:24px}
.cm-skel-block{height:180px;border-radius:18px;background:linear-gradient(90deg,var(--paper-2),#fff,var(--paper-2));
  background-size:200% 100%;animation:cmshimmer 1.4s infinite}
@keyframes cmshimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}

/* footer */
.cm-footer{border-top:1px solid var(--line);margin-top:clamp(56px,9vw,100px);padding:40px clamp(18px,5vw,56px) 48px}
.cm-footer-inner{max-width:1080px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap}
.cm-footer-brand{display:flex;align-items:center;gap:12px}
.cm-footer-name{font-weight:700;font-size:15px}
.cm-footer-tag{font-size:13px;color:var(--ink-soft);margin-top:2px}
.cm-footer-nav{display:flex;gap:20px;font-size:14px;font-weight:500;color:var(--ink-soft)}
.cm-footer-nav a:hover{color:var(--clay-deep)}
.cm-footer-fine{max-width:1080px;margin:22px auto 0;font-family:var(--mono);font-size:11px;letter-spacing:.12em;
  text-transform:uppercase;color:var(--ink-faint)}

/* motion */
.cm-fade{opacity:0;animation:cmrise .7s cubic-bezier(.2,.7,.2,1) forwards}
@keyframes cmrise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
@keyframes cmfade{from{opacity:0}to{opacity:1}}
@keyframes cmpop{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}
[data-reveal]{opacity:0;transform:translateY(20px);transition:opacity .7s cubic-bezier(.2,.7,.2,1),transform .7s cubic-bezier(.2,.7,.2,1)}
[data-reveal].is-in{opacity:1;transform:none}

/* responsive */
@media(max-width:860px){
  .cm-spot-grid{grid-template-columns:1fr}
  .cm-spot-side{flex-direction:column}
  .cm-cta-inner{grid-template-columns:1fr}
  .cm-ladder{grid-template-columns:repeat(5,minmax(74px,1fr));overflow-x:auto;scrollbar-width:none}
  .cm-ladder::-webkit-scrollbar{display:none}
  .cm-cal-cell{min-height:92px;padding:6px}
}
@media(max-width:560px){
  .cm-brand-name{font-size:14px}
  .cm-nav>a:not(.cm-nav-cta){display:none}
  .cm-hero-cta{flex-direction:column}
  .cm-hero-cta .cm-btn{width:100%}
  .cm-notify-row{flex-direction:column}
  .cm-notify-go{width:100%}
  .cm-footer-inner{flex-direction:column;align-items:flex-start}
  .cm-card-foot{flex-direction:column;align-items:stretch}
  .cm-card-foot .cm-btn{width:100%}
  .cm-browse-head{flex-direction:column;align-items:flex-start}
  .cm-cal-dowcell em{display:none}
  .cm-cal-dowcell span{display:inline}
  .cm-cal-cell{min-height:70px;padding:4px 3px;gap:3px}
  .cm-cal-daynum{width:20px;height:20px;font-size:11px}
  .cm-cal-chip{padding:3px 4px;gap:4px;border-radius:6px}
  .cm-cal-chip-t{font-size:9px}
  .cm-cal-title{font-size:18px}
  .cm-cal-head{padding:14px}
  .cm-cal-legend{padding:12px 14px;font-size:11.5px}
}
@media(prefers-reduced-motion:reduce){
  .cm-fade,[data-reveal]{opacity:1!important;transform:none!important;animation:none!important;transition:none!important}
  .cm-pulse{animation:none}
}
`
