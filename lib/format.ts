// Shared formatting + normalization helpers — the single source of truth.
// (normPhone/normEmail were previously only in lib/affiliates.ts; promoted
// here so check-in, WhatsApp links, and dedupe all use identical logic.)

// Malaysian phone normalization: digits only, strip 60 country code, strip
// leading zeros. So 60169295031 = +60 169295031 = 0169295031 → "169295031".
export function normPhone(p: string | null | undefined): string {
  if (!p) return ''
  let d = String(p).replace(/\D/g, '')
  if (d.startsWith('60')) d = d.slice(2)
  d = d.replace(/^0+/, '')
  return d
}

export function normEmail(e: string | null | undefined): string {
  return (e ?? '').trim().toLowerCase()
}

// A stable identity key for an attendee/lead (phone preferred, else email).
// Used to detect duplicates and group buyers.
export function identityKey(phone: string | null | undefined, email: string | null | undefined): string {
  return normPhone(phone) || normEmail(email) || ''
}

// ── Currency (RM) ───────────────────────────────────────────────────────────────
export function rm(n: number | null | undefined): string {
  const v = Number(n ?? 0)
  return `RM ${v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Compact RM without forced decimals (for stat cards): RM 20,618
export function rmShort(n: number | null | undefined): string {
  const v = Number(n ?? 0)
  return `RM ${v.toLocaleString('en-MY')}`
}

// ── Dates (en-MY) ───────────────────────────────────────────────────────────────
export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-MY', { dateStyle: 'medium' })
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-MY', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}
