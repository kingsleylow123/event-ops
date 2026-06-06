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
      const matchYear = year === null || d.getFullYear() === year
      return d.getMonth() + 1 === month && d.getDate() === day && matchYear
    })
    if (byDate.length === 1) return byDate[0]
    if (byDate.length > 1) return _preferActive(byDate)
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

// Among candidate events, prefer is_active=true, then soonest date.
function _preferActive(candidates: Event[]): Event {
  const active = candidates.find(e => e.is_active)
  if (active) return active
  return candidates.slice().sort((a, b) => {
    const ta = a.date ? new Date(a.date).getTime() : Infinity
    const tb = b.date ? new Date(b.date).getTime() : Infinity
    return ta - tb
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
