import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { notifyAdmins, esc, b } from '@/lib/telegram'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Cold-lead nudge — Mon/Wed/Fri 14:00 MYT (06:00 UTC). Surfaces the ONE coldest
// deal lead (new/contacted, no call booked, untouched >72h) so it doesn't rot.
// One lead per run, deduped per rolling week via jarvis_alerts. CRON_SECRET-guarded.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - 72 * 3600_000).toISOString()
  const { data, error } = await supabase
    .from('deal_leads')
    .select('id, client_name, client_phone, needs, rep_name, status, updated_at, event_id')
    .in('status', ['new', 'contacted'])
    .is('call_scheduled_at', null)
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(5)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  const rows = data ?? []
  if (!rows.length) return NextResponse.json({ ok: true, skipped: 'no stale leads' })

  // Rolling 7-day bucket so the same lead is nudged at most once per week.
  const weekKey = `w${Math.floor(Date.now() / (7 * 86400000))}`

  // Pick the coldest lead not already nudged this week (dedup needs event_id).
  let lead: typeof rows[number] | null = null
  for (const r of rows) {
    if (r.event_id) {
      const { data: seen } = await supabase.from('jarvis_alerts').select('id')
        .eq('event_id', r.event_id as string).eq('kind', 'pipeline_nudge').eq('ref', `${r.id}:${weekKey}`).maybeSingle()
      if (seen) continue
    }
    lead = r
    break
  }
  if (!lead) return NextResponse.json({ ok: true, skipped: 'all candidates nudged this week' })

  const staleDays = Math.floor((Date.now() - new Date(lead.updated_at as string).getTime()) / 86400000)
  const msg =
    `🔥 ${b('Cold lead')} — untouched ${staleDays}d\n` +
    `• ${b(lead.client_name)}${lead.client_phone ? ` · ${esc(lead.client_phone as string)}` : ''}\n` +
    `  ${esc((lead.needs as string) || 'no needs noted')}${lead.rep_name ? ` <i>(by ${esc(lead.rep_name as string)})</i>` : ''}\n` +
    `  Status: ${esc(lead.status as string)} → /pipeline to act`
  await notifyAdmins(msg)

  if (lead.event_id) {
    await supabase.from('jarvis_alerts').insert({
      event_id: lead.event_id as string,
      kind: 'pipeline_nudge',
      ref: `${lead.id}:${weekKey}`,
      fired_at: new Date().toISOString(),
      snooze_until: new Date(Date.now() + 7 * 86400000).toISOString(),
      severity: 'WARN',
    })
  }
  return NextResponse.json({ ok: true, nudged: lead.id, staleDays })
}
