import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { normPhone, normEmail } from '@/lib/format'
import { notifyAdmins, b, esc } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }

// Batch → WhatsApp group invite. The link is only ever returned AFTER a valid
// submission is stored, so the groups aren't scrapeable from page source.
const BATCHES: Record<string, string> = {
  '20-21 June': 'https://chat.whatsapp.com/H1icVUSaGxvDZOExpS4lFX?s=cl&p=i&ilr=1&amv=1',
  '28-29 July': 'https://chat.whatsapp.com/FecPAFNueEF16YJngOMMQz?s=cl&p=i&ilr=1&amv=1',
}

// Same phone rule as the public survey: 8–15 digits after stripping separators.
function isValidPhone(s: string): boolean {
  const digits = s.replace(/[\s+()-]/g, '')
  return /^\d{8,15}$/.test(digits)
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

export async function POST(req: NextRequest) {
  let body: { name?: string; email?: string; phone?: string; batch?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const name = (body.name || '').trim()
  const email = (body.email || '').trim()
  const phone = (body.phone || '').trim()
  const batch = (body.batch || '').trim()

  if (name.length < 2) return NextResponse.json({ error: 'Please enter your name' }, { status: 422, headers: NO_STORE_HEADERS })
  if (!isValidEmail(email)) return NextResponse.json({ error: 'Please enter a valid email' }, { status: 422, headers: NO_STORE_HEADERS })
  if (!isValidPhone(phone)) return NextResponse.json({ error: 'Please enter a valid WhatsApp number' }, { status: 422, headers: NO_STORE_HEADERS })
  if (!(batch in BATCHES)) return NextResponse.json({ error: 'Please pick a date' }, { status: 422, headers: NO_STORE_HEADERS })

  const email_norm = normEmail(email)
  const phone_norm = normPhone(phone)

  // Best-effort: link the selection to a known attendee (paid Stripe buyers are
  // already synced into attendees) so the Telegram ping shows whether this is a
  // verified buyer. Never blocks the submission.
  let matched: { id: string; name: string; payment_status: string; payment_amount: number; event_id: string } | null = null
  let matchedEventName = ''
  try {
    const { data: atts } = await supabase
      .from('attendees')
      .select('id, name, phone, email, payment_status, payment_amount, event_id')
    for (const a of atts ?? []) {
      const emailHit = a.email && normEmail(a.email as string) === email_norm
      const phoneHit = a.phone && normPhone(a.phone as string) === phone_norm
      if (emailHit || phoneHit) {
        matched = {
          id: a.id as string,
          name: a.name as string,
          payment_status: a.payment_status as string,
          payment_amount: Number(a.payment_amount ?? 0),
          event_id: a.event_id as string,
        }
        // Prefer a paid match over an unpaid one if several rows hit.
        if ((a.payment_status as string) === 'paid') break
      }
    }
    if (matched) {
      const { data: evRow } = await supabase.from('events').select('name').eq('id', matched.event_id).maybeSingle()
      matchedEventName = (evRow?.name as string) || ''
    }
  } catch { /* match is optional */ }

  // One row per email — re-submitting switches their batch (latest wins).
  const { error } = await supabase
    .from('glcc_batch_selections')
    .upsert({
      name, email, email_norm, phone, phone_norm, batch,
      matched_attendee_id: matched?.id ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'email_norm' })
  if (error) {
    console.error('[glcc-batch] upsert failed', error)
    return NextResponse.json({ error: 'Could not save your selection — please try again' }, { status: 500, headers: NO_STORE_HEADERS })
  }

  // Ping the admins. Best-effort — the buyer still gets their group link even
  // if Telegram hiccups.
  try {
    const matchLine = matched
      ? `\n✅ Matched attendee: ${b(matched.name)} (${esc(matched.payment_status)}, RM ${esc(matched.payment_amount)})${matchedEventName ? ` — ${esc(matchedEventName)}` : ''}`
      : '\n⚠️ No matching attendee record found (check Stripe sync)'
    await notifyAdmins(
      `🎟 ${b('GLCC batch selected')} — ${b(batch)}\n` +
      `• ${esc(name)}\n` +
      `• ${esc(phone)}\n` +
      `• ${esc(email)}` +
      matchLine
    )
  } catch (e) {
    console.error('[glcc-batch] notifyAdmins failed', e)
  }

  return NextResponse.json({ ok: true, whatsapp: BATCHES[batch] }, { headers: NO_STORE_HEADERS })
}
