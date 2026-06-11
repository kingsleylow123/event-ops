import { NextRequest, NextResponse } from 'next/server'

// Best-effort burst protection for PUBLIC endpoints. Per-instance memory —
// serverless instances don't share state, so this blunts naive bot floods
// rather than enforcing a hard global quota (upgrade path: Vercel KV/Upstash
// if real abuse shows up in logs).
//
// Limits are deliberately generous: at a venue, every attendee shares ONE
// public IP (wifi NAT), so per-IP limits must never block a real event-day
// burst (e.g. 40 people checking in within minutes from the same IP).
const buckets = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(key: string, max: number, windowMs = 60_000): boolean {
  const now = Date.now()
  // Keep the map bounded on long-lived instances.
  if (buckets.size > 5_000) {
    for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k)
  }
  const b = buckets.get(key)
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  b.count++
  return b.count <= max
}

export function clientIp(req: NextRequest): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
}

export function tooManyResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests — please slow down.' },
    { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } },
  )
}

// Returns the name of the first field whose string value exceeds its cap,
// or null if all are within bounds. Bounds junk/bot payloads before the DB.
export function tooLong(fields: Record<string, [unknown, number]>): string | null {
  for (const [name, [value, max]] of Object.entries(fields)) {
    if (typeof value === 'string' && value.length > max) return name
  }
  return null
}
