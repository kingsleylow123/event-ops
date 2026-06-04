import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { autoMatch, loadBuyers, syncLeadTags } from '@/lib/affiliates'
import { notifyAdmins, esc, b } from '@/lib/telegram'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Daily Vercel Cron (06:00 MYT) → (1) auto-match affiliates, then (2) ping admins
// about any NEW affiliate-attributed buyers. Guarded by CRON_SECRET.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  // Recent (last 30 days) + all upcoming events — a just-finished event still
  // accrues affiliate sales that need matching/notifying.
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString()
  const { data: events, error } = await supabase
    .from('events')
    .select('id, name')
    .gte('date', cutoff)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  // ── Cosmetic: sync leads-table tags from the affiliate sheet (no money) ─────
  let leadsTagged = 0
  try {
    leadsTagged = await syncLeadTags()
  } catch (e) {
    console.error('[affiliates/cron] syncLeadTags failed', e)
  }

  // ── Lead lookup maps (owner='affiliate' only) ──────────────────────────────
  const { data: affLeads } = await supabase
    .from('leads')
    .select('phone_norm, affiliate_handle')
    .eq('owner', 'affiliate')
  const leadPhoneToHandle = new Map<string, string>()
  for (const l of affLeads ?? []) {
    if (l.phone_norm) leadPhoneToHandle.set(l.phone_norm as string, (l.affiliate_handle as string) || '')
  }
  // emails aren't stored on leads, so phone is the lead match key; emails are
  // covered by the sheet-attribution path below.

  const matchResults: Array<{ event: string; matched: number }> = []
  const newBuyers: Array<{ event: string; name: string; amount: number; handle: string }> = []

  for (const ev of events ?? []) {
    const eventId = ev.id as string
    const eventName = ev.name as string

    // (1) sheet auto-match first
    try {
      const matched = await autoMatch(eventId)
      matchResults.push({ event: eventName, matched })
    } catch (e) {
      matchResults.push({ event: eventName, matched: -1 })
      console.error(`[affiliates/cron] autoMatch ${eventName} failed`, e)
    }

    // (2) detect affiliate buyers for this event
    let buyers
    try {
      buyers = await loadBuyers(eventId)
    } catch (e) {
      console.error(`[affiliates/cron] loadBuyers ${eventName} failed`, e)
      continue
    }
    if (!buyers.length) continue

    // existing sheet attributions for this event: attendee_id → handle
    const { data: attrs } = await supabase
      .from('affiliate_attributions')
      .select('attendee_id, affiliate_id')
      .eq('event_id', eventId)
    const { data: affRows } = await supabase.from('affiliates').select('id, handle')
    const affIdToHandle = new Map((affRows ?? []).map(a => [a.id as string, a.handle as string]))
    const attendeeToHandle = new Map<string, string>()
    for (const at of attrs ?? []) {
      attendeeToHandle.set(at.attendee_id as string, affIdToHandle.get(at.affiliate_id as string) || '')
    }

    // already-notified attendee_ids for this event
    const { data: notified } = await supabase
      .from('affiliate_purchase_notifications')
      .select('attendee_id')
      .eq('event_id', eventId)
    const alreadyNotified = new Set((notified ?? []).map(n => n.attendee_id as string))

    for (const buyer of buyers) {
      if (alreadyNotified.has(buyer.attendee_id)) continue

      // union match: sheet attribution OR affiliate lead by phone
      let handle = attendeeToHandle.get(buyer.attendee_id) || ''
      if (!handle) {
        for (const p of buyer.phones) {
          const h = leadPhoneToHandle.get(p)
          if (h !== undefined) { handle = h || 'affiliate'; break }
        }
      }
      if (!handle) continue // Kingsley's own / unmatched → no ping

      // record + queue
      const { error: insErr } = await supabase
        .from('affiliate_purchase_notifications')
        .insert({ event_id: eventId, attendee_id: buyer.attendee_id, affiliate_handle: handle, amount: buyer.total })
      if (insErr) {
        // unique violation = race/double-run; skip silently
        if (!String(insErr.message).includes('duplicate')) console.error('[affiliates/cron] insert notif', insErr)
        continue
      }
      newBuyers.push({ event: eventName, name: buyer.name, amount: buyer.total, handle })
    }
  }

  // ── Send one consolidated ping if there are new affiliate buyers ───────────
  if (newBuyers.length) {
    const rm = (n: number) => 'RM ' + n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    let msg = `🎉 ${b('New affiliate sale' + (newBuyers.length > 1 ? 's' : ''))} (${newBuyers.length})\n`
    for (const nb of newBuyers) {
      msg += `\n• ${b(nb.name)} — ${rm(nb.amount)}\n  via ${esc(nb.handle)} · <i>${esc(nb.event)}</i>`
    }
    await notifyAdmins(msg)
  }

  return NextResponse.json({ ok: true, matched: matchResults, newAffiliateBuyers: newBuyers.length, leadsTagged })
}
