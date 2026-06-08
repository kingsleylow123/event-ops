import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// Returns every affiliate payout (across all events) + the affiliate list
// so the Month-End page can aggregate cash outflows by month.
export async function GET() {
  const [payoutsRes, affRes] = await Promise.all([
    supabase.from('affiliate_payouts').select('id, affiliate_id, event_id, amount, paid_at, notes'),
    supabase.from('affiliates').select('id, handle'),
  ])
  if (payoutsRes.error) {
    return NextResponse.json({ error: payoutsRes.error.message }, { status: 500 })
  }
  if (affRes.error) {
    return NextResponse.json({ error: affRes.error.message }, { status: 500 })
  }
  return NextResponse.json({
    payouts: payoutsRes.data ?? [],
    affiliates: affRes.data ?? [],
  })
}
