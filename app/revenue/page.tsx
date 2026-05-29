import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import RevenueClient from './RevenueClient'

export const dynamic = 'force-dynamic'

export default async function RevenuePage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: approval } = await supabase
    .from('user_approvals')
    .select('is_admin')
    .eq('email', (user?.email ?? '').toLowerCase())
    .maybeSingle()

  if (!approval?.is_admin) {
    redirect('/')
  }

  return <RevenueClient />
}
