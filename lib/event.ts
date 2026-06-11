import type { Event } from '@/lib/supabase'

// ---------------------------------------------------------------------------
// matchEvent — deterministic free-text → Event resolver
// ---------------------------------------------------------------------------
// Priority order:
//   1) event.id substring match (case-sensitive)
//   2) event.name case-insensitive substring match
//   3) date parse — supports many natural-language formats; day+month is
//      sufficient (year assumed from the event's own date string)
//
// Tie-breaking on date matches: is_active first, then soonest event.
// Returns null when nothing confidently matches — never guesses.
//
// Usage:
//   const event = matchEvent(userText, allEvents)
//   if (!event) { /* ask user to clarify */ }
//
// Pure function: no I/O, no side-effects, no new dependencies.
export function matchEvent(text: string, events: Event[]): Event | null {
  if (!text || !events || events.length === 0) return null

  const trimmed = text.trim()

  // 1) Exact event id substring -------------------------------------------
  const byId = events.filter(e => trimmed.includes(e.id))
  if (byId.length === 1) return byId[0]
  // Multiple id hits (extremely unlikely) — fall through to avoid guessing

  // 2) Case-insensitive name substring ------------------------------------
  const lower = trimmed.toLowerCase()
  const byName = events.filter(e => e.name && lower.includes(e.name.toLowerCase()))
  if (byName.length === 1) return byName[0]
  if (byName.length > 1) {
    // Prefer is_active, then soonest
    return _preferActive(byName)
  }

  // 3) Date parse ---------------------------------------------------------
  const parsed = _parseDate(trimmed)
  if (parsed) {
    const { day, month, year } = parsed
    const byDate = events.filter(e => {
      if (!e.date) return false
      const d = new Date(e.date)
      if (isNaN(d.getTime())) return false
      // Compare on the Malaysia (UTC+8) CIVIL date, not the server's local/UTC
      // date. event.date is a UTC timestamp; an evening MYT event (e.g. 17:00+00
      // = 01:00 MYT next day) would otherwise resolve to the wrong calendar day
      // on a UTC server. Shift +8h then read UTC parts = the MYT wall date.
      const myt = new Date(d.getTime() + 8 * 3600000)
      const matchYear = year === null || myt.getUTCFullYear() === year
      return myt.getUTCMonth() + 1 === month && myt.getUTCDate() === day && matchYear
    })
    if (byDate.length === 1) return byDate[0]
    if (byDate.length > 1) return _preferActive(byDate)
  }

  return null
}

// ---------------------------------------------------------------------------
// matchEventLoose — natural-language → Event resolver for Jarvis questions
// ---------------------------------------------------------------------------
// matchEvent (above) is deliberately strict: full-name substring or explicit
// date. That's right for "/survey 7jun" but fails plain questions like
// "survey insights for claude for ops webinar" (the real name is "Claude for
// Ops — Webinar" — the em-dash breaks the substring) or "today's webinar".
// This looser resolver layers on top:
//   1) strict matchEvent
//   2) temporal words ("today's/tonight's/tomorrow's <webinar|workshop|...>")
//      resolved against the MYT civil date — the noun adjacency requirement
//      stops bare "today" in ordinary questions ("any buyers today?") from
//      hijacking the focus event
//   3) fuzzy name-token overlap, weighted by rarity across the event list so
//      distinctive words ("ops", "webinar", "glcc", "batch") match but words
//      shared by many events ("claude", "workshop", "june") can never win
//      alone. Pure numbers/ordinals are excluded (dates belong to layer 2/strict).
// Returns null when nothing confidently matches — callers fall back to the
// active event, same as before.

// Domain words that appear constantly in ops questions ("affiliate buyers",
// "survey results") — never let them alone select an event, even if an event
// name contains them.
const LOOSE_STOPWORDS = new Set([
  'the', 'a', 'an', 'for', 'of', 'and', 'or', 'on', 'at', 'in', 'to', 'with', 'by',
  'event', 'events', 'affiliate', 'affiliates', 'survey', 'surveys',
  // "go live" reads as ordinary English ("when do we go live?") far more often
  // than as the GLCC name — GLCC stays matchable via "glcc" / "challenge".
  'go', 'live',
])

const LOOSE_THRESHOLD = 0.9 // ≈ requires at least one near-unique name token

function _looseTokens(name: string): string[] {
  // Month names and bare numbers/ordinals are excluded from fuzzy tokens: dates
  // belong to the strict date layer. Otherwise "May" in "…workshop 16th May" is
  // unique (df=1) and the English modal verb in "who may not have paid" would
  // silently switch focus to the May event.
  return [...new Set(
    name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w =>
      w && !LOOSE_STOPWORDS.has(w) && !/^\d+(?:st|nd|rd|th)?$/.test(w) && !(w in MONTH_NAMES)
    )
  )]
}

export function matchEventLoose(text: string, events: Event[]): Event | null {
  if (!text || !events || events.length === 0) return null

  const strict = matchEvent(text, events)
  if (strict) return strict

  const lower = text.toLowerCase()

  // 2) Temporal resolution on the MYT civil calendar --------------------------
  const TEMPORAL = "(today|tonight|tonite|tomorrow|tmr|yesterday)(?:'?s)?"
  const NOUN = '(?:webinar|workshop|event|session|challenge|class|meetup|training)'
  const m =
    lower.match(new RegExp(`\\b${TEMPORAL}\\s+${NOUN}\\b`)) ||
    lower.match(new RegExp(`\\b${NOUN}\\s+${TEMPORAL}\\b`)) ||
    // The entire text being just the temporal word ("/survey today") is an
    // explicit event slot, so no noun needed there.
    lower.trim().match(new RegExp(`^${TEMPORAL}$`))
  if (m) {
    const word = m[1]
    const offsetDays = /^(tomorrow|tmr)/.test(word) ? 1 : word === 'yesterday' ? -1 : 0
    const target = new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000)
    const sameDay = events.filter(e => {
      if (!e.date) return false
      const d = new Date(e.date)
      if (isNaN(d.getTime())) return false
      const myt = new Date(d.getTime() + 8 * 3600000)
      return myt.getUTCFullYear() === target.getUTCFullYear()
        && myt.getUTCMonth() === target.getUTCMonth()
        && myt.getUTCDate() === target.getUTCDate()
    })
    if (sameDay.length === 1) return sameDay[0]
    if (sameDay.length > 1) return _preferActive(sameDay)
    // No event on that date — fall through to fuzzy
  }

  // 3) Fuzzy token overlap, rarity-weighted ------------------------------------
  const qTokens = new Set(lower.replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean))
  const perEvent = events.map(e => _looseTokens(e.name || ''))
  const df = new Map<string, number>()
  for (const tokens of perEvent) for (const t of tokens) df.set(t, (df.get(t) || 0) + 1)

  let bestScore = 0
  const scores = perEvent.map(tokens => {
    let s = 0
    for (const t of tokens) if (qTokens.has(t)) s += 1 / (df.get(t) || 1)
    if (s > bestScore) bestScore = s
    return s
  })
  if (bestScore >= LOOSE_THRESHOLD) {
    const top = events.filter((_, i) => scores[i] >= bestScore - 1e-9)
    return top.length === 1 ? top[0] : _preferActive(top)
  }

  return null
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ParsedDate { day: number; month: number; year: number | null }

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
}

function _parseDate(text: string): ParsedDate | null {
  const t = text.trim()

  // ISO: 2026-06-07
  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (iso) {
    const year = parseInt(iso[1], 10)
    const month = parseInt(iso[2], 10)
    const day = parseInt(iso[3], 10)
    if (_validMD(month, day)) return { day, month, year }
  }

  // DD/MM/YYYY or DD/MM (slash or dash separator, DD first)
  const slashDMY = t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?\b/)
  if (slashDMY) {
    const day = parseInt(slashDMY[1], 10)
    const month = parseInt(slashDMY[2], 10)
    const year = slashDMY[3] ? parseInt(slashDMY[3], 10) : null
    if (_validMD(month, day)) return { day, month, year }
  }

  // "7th June", "7 june", "7 jun 2026"  (day-first with ordinal suffix)
  const dayFirst = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:\s+(\d{4}))?\b/i)
  if (dayFirst) {
    const day = parseInt(dayFirst[1], 10)
    const monthKey = dayFirst[2].toLowerCase()
    const year = dayFirst[3] ? parseInt(dayFirst[3], 10) : null
    const month = MONTH_NAMES[monthKey]
    if (month && _validMD(month, day)) return { day, month, year }
  }

  // "june 7", "june 7th", "june 7 2026"  (month-name first)
  const monthFirst = t.match(/\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?\b/i)
  if (monthFirst) {
    const monthKey = monthFirst[1].toLowerCase()
    const month = MONTH_NAMES[monthKey]
    const day = parseInt(monthFirst[2], 10)
    const year = monthFirst[3] ? parseInt(monthFirst[3], 10) : null
    if (month && _validMD(month, day)) return { day, month, year }
  }

  return null
}

function _validMD(month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31
}

// Among candidate events, prefer is_active=true, then the event NEAREST to today.
// Nearest-to-now (not earliest) matters for year-omitted dates like "7 june":
// with recurring same-day-of-month workshops it resolves to the relevant year
// instead of silently picking some old event.
function _preferActive(candidates: Event[]): Event {
  const active = candidates.find(e => e.is_active)
  if (active) return active
  const now = Date.now()
  return candidates.slice().sort((a, b) => {
    const da = a.date ? Math.abs(new Date(a.date).getTime() - now) : Infinity
    const db = b.date ? Math.abs(new Date(b.date).getTime() - now) : Infinity
    return da - db
  })[0]
}

// ---------------------------------------------------------------------------
// Single source of truth for "which event is current".
// Rule: explicit is_active wins → else soonest UPCOMING by date → else most
// recent past event → else null. This unifies the 6 inconsistent call sites
// (some defaulted to null, some to list[0], affiliates used date logic) so
// every page agrees on the same event.
export function pickActiveEvent(events: Event[]): Event | null {
  if (!events || events.length === 0) return null

  const flagged = events.find(e => e.is_active)
  if (flagged) return flagged

  const now = Date.now()
  const dated = events.filter(e => e.date)

  // soonest upcoming
  const upcoming = dated
    .filter(e => new Date(e.date as string).getTime() >= now)
    .sort((a, b) => new Date(a.date as string).getTime() - new Date(b.date as string).getTime())
  if (upcoming.length) return upcoming[0]

  // else most recent past
  const past = dated
    .filter(e => new Date(e.date as string).getTime() < now)
    .sort((a, b) => new Date(b.date as string).getTime() - new Date(a.date as string).getTime())
  if (past.length) return past[0]

  return events[0]
}

const LS_KEY = 'eventops_selected_event'

// Read the user's persisted event choice (client-only).
export function getStoredEventId(): string | null {
  if (typeof window === 'undefined') return null
  try { return localStorage.getItem(LS_KEY) } catch { return null }
}

export function storeEventId(id: string): void {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(LS_KEY, id) } catch { /* ignore */ }
}

// Resolve the initial event to show: a valid stored choice wins, else the
// computed active event. Keeps multi-event days unambiguous across pages.
export function resolveInitialEvent(events: Event[]): Event | null {
  const storedId = getStoredEventId()
  if (storedId) {
    const stored = events.find(e => e.id === storedId)
    if (stored) return stored
  }
  return pickActiveEvent(events)
}
