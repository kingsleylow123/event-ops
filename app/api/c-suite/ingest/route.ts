import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { ingestResult, ingestToken } from '@/lib/c-suite'
import { normalizeBoardResult } from '@/lib/c-suite/ingest'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Ingest a board computed by the Claude Code harness (Kingsley's Max subscription
// on Hermes / a /csuite skill) and persist it to the same dashboard + Telegram.
// Auth: C_SUITE_INGEST_TOKEN (falls back to CRON_SECRET). Idempotent: the raw
// body is sha256-fingerprinted — a double-POST returns the original run instead
// of double-persisting and double-Telegramming.
export async function POST(req: NextRequest) {
  const secret = ingestToken()
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  try {
    const raw = await req.text()
    let body: unknown = null
    try { body = JSON.parse(raw) } catch { /* handled below */ }
    const result = normalizeBoardResult(body)
    if (!result) return NextResponse.json({ ok: false, error: 'invalid board result' }, { status: 400 })
    const fingerprint = createHash('sha256').update(raw).digest('hex')
    const notify = new URL(req.url).searchParams.get('notify') !== '0'
    const summary = await ingestResult(result, { notify, fingerprint })
    return NextResponse.json(summary)
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 })
  }
}