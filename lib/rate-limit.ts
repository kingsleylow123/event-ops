import { NextRequest, NextResponse } from 'next/server'

// Burst protection for PUBLIC endpoints, two tiers:
//
// 1. If UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set (Vercel env),
//    limits are GLOBAL across all serverless instances (fixed-window counter
//    in Redis). This is the real enforcement tier.
// 2. Otherwise falls back to per-instance memory — best-effort: blunts naive
//    bot floods on a warm instance but resets on cold starts.
//
// Limits are deliberately generous either way: at a venue, every attendee
// shares ONE public IP (wifi NAT), so per-IP limits must never block a real
// event-day burst (e.g. 40 people checking in within minutes from one IP).

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

// ── Tier 1: Upstash fixed-window counter ────────────────────────────────────
async function upstashCount(bucketKey: string, windowMs: number): Promise<number | null> {
  try {
    const res = await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      // INCR the window's counter; expire it after ~2 windows so keys clean up.
      body: JSON.stringify([['INCR', bucketKey], ['PEXPIRE', bucketKey, windowMs * 2]]),
      signal: AbortSignal.timeout(1500),
    })
    if (!res.ok) return null
    const out = (await res.json()) as { result?: number }[]
    const n = out?.[0]?.result
    return typeof n === 'number' ? n : null
  } catch {
    return null
  }
}

// ── Tier 2: per-instance memory ─────────────────────────────────────────────
const buckets = new Map<string, { count: number; resetAt: number }>()

function memoryLimit(key: string, max: number, windowMs: number): boolean {
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

// Returns true if the request is allowed. Availability over strictness: if
// Redis hiccups, we fall back to the in-memory tier rather than blocking.
export async function rateLimit(key: string, max: number, windowMs = 60_000): Promise<boolean> {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const bucketKey = `rl:${key}:${Math.floor(Date.now() / windowMs)}`
    const n = await upstashCount(bucketKey, windowMs)
    if (n !== null) return n <= max
  }
  return memoryLimit(key, max, windowMs)
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
