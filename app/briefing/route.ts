import { readFileSync } from 'fs'
import { join } from 'path'
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  let html = readFileSync(join(process.cwd(), 'public/briefing.html'), 'utf-8')

  // Fetch active event's floor plan server-side — no auth needed
  const { data: events } = await supabase
    .from('events')
    .select('id, name, date, floor_plan')
    .eq('is_active', true)
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
