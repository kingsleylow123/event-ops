import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
  }

  const { data: approval } = await supabase
    .from('user_approvals')
    .select('is_admin')
    .eq('email', user.email.toLowerCase())
    .maybeSingle()

  return NextResponse.json(
    { email: user.email, is_admin: approval?.is_admin ?? false },
    { headers: NO_STORE_HEADERS },
  )
}
