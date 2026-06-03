import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { isAdminEmail } from '@/lib/auth/admin'

// Phase 1 = log-but-allow. Set AUTH_ENFORCE=true (Vercel env) to flip to
// hard 401/403 once logs confirm only expected callers hit each route.
function enforcing() {
  return process.env.AUTH_ENFORCE === 'true'
}

export interface GuardResult {
  ok: boolean
  email: string | null
  isAdmin: boolean
  // When set, the caller MUST return this response (enforce mode rejection).
  response: NextResponse | null
}

async function resolveUser() {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    const email = user?.email ?? null
    let isAdmin = false
    if (email) {
      const { data } = await supabase
        .from('user_approvals')
        .select('is_admin, status')
        .eq('email', email.toLowerCase())
        .maybeSingle()
      isAdmin = !!data?.is_admin || isAdminEmail(email)
    }
    return { email, isAdmin }
  } catch {
    return { email: null, isAdmin: false }
  }
}

// Require a logged-in (approved) user. In log mode, never blocks — just records.
export async function requireUser(route: string): Promise<GuardResult> {
  const { email, isAdmin } = await resolveUser()
  if (!email) {
    console.warn(`[guard] ${route} — NO SESSION (enforce=${enforcing()})`)
    if (enforcing()) {
      return { ok: false, email, isAdmin, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
    }
  } else {
    console.log(`[guard] ${route} — user=${email} admin=${isAdmin}`)
  }
  return { ok: true, email, isAdmin, response: null }
}

// Require an admin user. In log mode, never blocks — just records.
export async function requireAdmin(route: string): Promise<GuardResult> {
  const { email, isAdmin } = await resolveUser()
  if (!isAdmin) {
    console.warn(`[guard] ${route} — NOT ADMIN (email=${email ?? 'none'}, enforce=${enforcing()})`)
    if (enforcing()) {
      const status = email ? 403 : 401
      return { ok: false, email, isAdmin, response: NextResponse.json({ error: 'Forbidden' }, { status }) }
    }
  } else {
    console.log(`[guard] ${route} — admin=${email}`)
  }
  return { ok: true, email, isAdmin, response: null }
}
