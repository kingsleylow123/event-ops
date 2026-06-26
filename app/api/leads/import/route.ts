import { NextRequest, NextResponse } from 'next/server'
import { importNewLeads } from '@/lib/affiliates'
import { notifyAdmins, esc, b } from '@/lib/telegram'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Daily Vercel Cron (05:30 MYT) — import NEW leads from the WhatsApp-joined sheet
// into the `leads` table, deduped by phone_norm. The table was a static one-time
// seed with no insert path, so the count was frozen and new joiners never landed.
// This keeps it growing. Guarded by CRON_SECRET. Also callable manually.
export async function GET(req: NextRequest) {
  // Fail CLOSED: require CRON_SECRET to be set AND match.
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  try {
    const r = await importNewLeads()
    if (r.inserted > 0) {
      await notifyAdmins(
        `📥 ${b('Leads import')} — added ${b(String(r.inserted))} new lead${r.inserted === 1 ? '' : 's'} from the WhatsApp sheet\n` +
        `<i>${esc(String(r.sheetRows))} rows in sheet · ${esc(String(r.alreadyPresent))} already in CRM</i>`,
      )
    }
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    const msg = String((e as Error).message || e)
    console.error('[leads/import] failed', e)
    try { await notifyAdmins(`⚠️ ${b('Leads import failed')} — ${esc(msg)}`) } catch { /* notify is best-effort */ }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
