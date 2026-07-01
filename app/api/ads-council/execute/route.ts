import { NextRequest, NextResponse } from 'next/server'
import { approveAndExecute, rollbackAction } from '@/lib/ads-council'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Manual executor — approve+execute or rollback a specific queued action by id.
// Bearer-guarded (CRON_SECRET); used by the /run-ads skill and for testing. The
// normal path is tapping Approve in Telegram, which does NOT come through here.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  const body = (await req.json().catch(() => ({}))) as { action_id?: string; op?: string; who?: string }
  if (!body.action_id) return NextResponse.json({ ok: false, error: 'action_id required' }, { status: 400 })

  const who = body.who || 'manual'
  const outcome = body.op === 'rollback'
    ? await rollbackAction(body.action_id)
    : await approveAndExecute(body.action_id, who)

  return NextResponse.json(outcome)
}
