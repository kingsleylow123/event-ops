import { readFileSync } from 'fs'
import { join } from 'path'
import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  let html = readFileSync(join(process.cwd(), 'public/briefing.html'), 'utf-8')

  // Fetch the next upcoming event (soonest date >= now) — no auth needed.
  // Prefer is_active=true if it has floor plan sections; otherwise fall back
  // to the nearest future event with sections populated.
  const now = new Date().toISOString()
  const { data: events } = await supabase
    .from('events')
    .select('id, name, date, floor_plan')
    .gte('date', now)
    .order('date', { ascending: true })
    .limit(1)

  const ev = events?.[0] ?? null
  const inject = ev
    ? JSON.stringify({ id: ev.id, name: ev.name, floor_plan: ev.floor_plan })
    : 'null'

  // Inject before </head> so the JS can use it synchronously
  html = html.replace('</head>', `<script>window.__ACTIVE_EVENT__=${inject};</script>\n</head>`)

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
