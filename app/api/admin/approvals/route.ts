import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { isAdminEmail } from '@/lib/auth/admin'

async function requireAdmin() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdminEmail(user.email)) {
    return { supabase, user: null, error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) }
  }
  return { supabase, user, error: null }
}

export async function GET() {
  const { supabase, user, error } = await requireAdmin()
  if (error) return error
  const { data, error: dbErr } = await supabase
    .from('user_approvals')
    .select('*')
    .order('requested_at', { ascending: false })
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })
  return NextResponse.json({ approvals: data, admin: user!.email })
}

export async function POST(req: NextRequest) {
  const { supabase, user, error } = await requireAdmin()
  if (error) return error

  const body = await req.json().catch(() => ({}))
  const { email, action, notes } = body as { email?: string; action?: string; notes?: string }

  if (!email || !action || !['approve', 'reject', 'reset'].includes(action)) {
    return NextResponse.json({ error: 'email and action (approve|reject|reset) required' }, { status: 400 })
  }

  const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'pending'

  const { data, error: dbErr } = await supabase
    .from('user_approvals')
    .update({
      status,
      decided_at: new Date().toISOString(),
      decided_by: user!.email,
      ...(notes !== undefined ? { notes } : {}),
    })
    .eq('email', email.toLowerCase())
    .select()
    .single()

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })
  return NextResponse.json({ approval: data })
}
