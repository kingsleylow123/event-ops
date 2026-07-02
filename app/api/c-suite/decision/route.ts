import { NextRequest, NextResponse } from 'next/server'
import { transitionDecision } from '@/lib/c-suite'
import { requireAdmin } from '@/lib/auth/guard'
import type { DecisionStatus } from '@/lib/c-suite'

export const dynamic = 'force-dynamic'

const ALLOWED: DecisionStatus[] = ['done', 'dismissed', 'snoozed']

// Dashboard action: mark a ruling done / dismissed / snoozed. Admin-only (same
// gate as /api/c-suite/latest) and login-gated by middleware (NOT in PUBLIC_PATHS).
// Recommend-only stays true: this records Kingsley's call, it executes nothing.
export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin('/api/c-suite/decision')
  if (guard.response) return guard.response
  try {
    const body = await req.json().catch(() => ({}))
    const id = String(body?.id ?? '')
    const status = String(body?.status ?? '') as DecisionStatus
    if (!id || !ALLOWED.includes(status)) {
      return NextResponse.json({ ok: false, error: 'need id + status (done|dismissed|snoozed)' }, { status: 400 })
    }
    const who = guard.email ?? 'admin'
    let res = await transitionDecision(id, 'pending', status, who)
    if (res === 'conflict' && status !== 'snoozed') {
      res = await transitionDecision(id, 'snoozed', status, who)
    }
    if (res === 'error') return NextResponse.json({ ok: false, error: 'write failed — retry' }, { status: 500 })
    return NextResponse.json({ ok: res === 'moved', alreadyHandled: res === 'conflict' })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 })
  }
}