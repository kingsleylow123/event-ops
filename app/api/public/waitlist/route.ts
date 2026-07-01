import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Public "Notify me" capture for waitlist / sold-out phases (and the empty state).
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export async function POST(req: NextRequest) {
  let body: { name?: string; email?: string; phone?: string; event_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  const name = String(body.name ?? '').trim().slice(0, 120)
  const email = String(body.email ?? '').trim().slice(0, 160)
  const phone = String(body.phone ?? '').trim().slice(0, 40)
  const event_id = typeof body.event_id === 'string' && UUID.test(body.event_id) ? body.event_id : null

  if (!email && !phone) {
    return NextResponse.json({ error: 'Email or phone is required' }, { status: 422 })
  }
  if (email && !EMAIL.test(email)) {
    return NextResponse.json({ error: 'That email looks off' }, { status: 422 })
  }

  const { error } = await supabaseAdmin.from('event_waitlist').insert({
    event_id,
    name: name || null,
    email: email || null,
    phone: phone || null,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
