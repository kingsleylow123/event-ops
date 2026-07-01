import type { AgentContext } from './types'

export const num = (v: unknown) => Number(v ?? 0)

export const RM = (n: unknown) =>
  'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

export const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

// Mask a bank account number to the last 4 digits for display, e.g.
// "1234567890" → "••••7890". Security: full account numbers should never be
// surfaced to the Telegram chat — only the last 4 for identification.
// Returns null for null/empty so callers can keep their `?? null` shape.
export function maskAccountNo(s: unknown): string | null {
  const raw = String(s ?? '').trim()
  if (!raw) return null
  const digits = raw.replace(/\s+/g, '')
  if (digits.length <= 4) return '••••' + digits
  return '••••' + digits.slice(-4)
}

// Resolve a tool's optional event_id arg to a concrete id. Accepts an exact id,
// 'active'/'' (→ active event), or a loose name/date fragment matched against
// allEvents. Falls back to the active event so a tool never errors on a bad hint.
export function resolveEventId(arg: unknown, ctx: AgentContext): string {
  const s = String(arg ?? '').trim()
  if (!s || s.toLowerCase() === 'active') return ctx.activeEvent.id
  const byId = ctx.allEvents.find(e => e.id === s)
  if (byId) return byId.id
  const q = s.toLowerCase()
  const byName = ctx.allEvents.find(
    e => (e.name || '').toLowerCase().includes(q) || (e.date || '').includes(q),
  )
  return byName ? byName.id : ctx.activeEvent.id
}

export function eventLabel(ctx: AgentContext, id: string): string {
  const e = ctx.allEvents.find(ev => ev.id === id)
  return e ? `${e.name}${e.date ? ' · ' + e.date : ''}` : id
}

export function eventNameMap(ctx: AgentContext): Map<string, string> {
  return new Map(ctx.allEvents.map(e => [e.id, e.name]))
}
