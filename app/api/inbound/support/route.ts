import { NextRequest, NextResponse } from 'next/server'
import PostalMime from 'postal-mime'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { normEmail } from '@/lib/format'
import { notifyAdmins, esc, b } from '@/lib/telegram'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const NO_STORE = { 'Cache-Control': 'no-store' } as const

// Inbound mirror for support@cmoaiconsulting.com. A Cloudflare Email Worker
// receives every email to support@, forwards it to claudemalaysiaofficial@gmail.com
// FIRST (Gmail delivery never depends on this endpoint), then POSTs
// { from, to, subject, raw } here. We parse the raw MIME, match the sender to a
// CRM record (attendees → cashflowos_leads; the `leads` table is phone-keyed and
// has no email column, so it can't be matched here), store the reply, and ping
// the admins on Telegram. Guarded by a shared secret header set on the Worker.
export async function POST(req: NextRequest) {
  const secret = process.env.INBOUND_EMAIL_SECRET
  if (!secret || req.headers.get('x-inbound-secret') !== secret) {
    return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE })
  }

  let body: { from?: string; to?: string; subject?: string; raw?: string }
  try { body = await req.json() } catch { return NextResponse.json({ ok: false }, { status: 400, headers: NO_STORE }) }
  if (!body.raw && !body.from) return NextResponse.json({ ok: false }, { status: 400, headers: NO_STORE })

  // Parse the raw MIME when present; fall back to the envelope fields the
  // Worker always includes. Parsing is best-effort — never lose the email.
  let fromEmail = normEmail(body.from ?? '')
  let subject = (body.subject ?? '').slice(0, 500)
  let text = ''
  if (body.raw) {
    try {
      const parsed = await PostalMime.parse(body.raw)
      fromEmail = normEmail(parsed.from?.address ?? '') || fromEmail
      subject = (parsed.subject ?? subject).slice(0, 500)
      text = (parsed.text ?? '').trim()
      // HTML-only emails: strip tags crudely rather than storing nothing.
      if (!text && parsed.html) text = parsed.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    } catch (e) {
      console.error('[inbound-support] MIME parse failed — storing envelope only', e)
    }
  }
  text = text.slice(0, 10_000)

  // Match the sender to a CRM record: paying customers first, then checkout leads.
  let matchedType: 'attendee' | 'cashflowos_lead' | null = null
  let matchedId: string | null = null
  let matchedName: string | null = null
  if (fromEmail) {
    const { data: att } = await supabaseAdmin
      .from('attendees').select('id, name').ilike('email', fromEmail)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (att) {
      matchedType = 'attendee'; matchedId = att.id as string; matchedName = (att.name as string) || null
    } else {
      const { data: lead } = await supabaseAdmin
        .from('cashflowos_leads').select('id, name').eq('email', fromEmail).maybeSingle()
      if (lead) { matchedType = 'cashflowos_lead'; matchedId = lead.id as string; matchedName = (lead.name as string) || null }
    }
  }

  const { error } = await supabaseAdmin.from('inbound_emails').insert({
    from_email: fromEmail || (body.from ?? 'unknown'),
    to_email: body.to ?? null,
    subject: subject || null,
    body_text: text || null,
    matched_type: matchedType,
    matched_id: matchedId,
  })
  if (error) console.error('[inbound-support] insert failed', error.message)

  // Telegram ping (best-effort): who replied + a snippet, so nothing sits unseen.
  try {
    const who = matchedName ? `${matchedName} (${fromEmail})` : fromEmail || 'unknown sender'
    const matchNote = matchedType ? ` · matched ${matchedType.replace('_', ' ')}` : ''
    await notifyAdmins(
      `📥 ${b('Reply to support@')} from ${esc(who)}${esc(matchNote)}\n` +
      `${b('Subject:')} ${esc(subject || '(none)')}\n` +
      (text ? `<i>${esc(text.slice(0, 200))}${text.length > 200 ? '…' : ''}</i>` : ''),
    )
  } catch { /* ping best-effort */ }

  return NextResponse.json({ ok: true, matched: matchedType }, { headers: NO_STORE })
}
