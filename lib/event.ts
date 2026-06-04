import type { Event } from '@/lib/supabase'

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
