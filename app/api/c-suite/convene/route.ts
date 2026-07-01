import { NextRequest, NextResponse } from 'next/server'
import { runBoard } from '@/lib/c-suite'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// On-demand board sitting on a specific strategic question. Guarded by CRON_SECRET.
//   GET  /api/c-suite/convene?q=...
//   POST /api/c-suite/convene   { "question": "..." }
async function convene(question: string | null) {
  const summary = await runBoard('ondemand', question?.trim() || undefined)
  return NextResponse.json(summary)
}

function authed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    return await convene(new URL(req.url).searchParams.get('q'))
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    const body = await req.json().catch(() => ({}))
    return await convene(typeof body?.question === 'string' ? body.question : null)
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 })
  }
}
