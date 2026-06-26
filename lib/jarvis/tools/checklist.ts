import type Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import type { ToolDef, AgentContext } from '../types'
import { resolveEventId, eventLabel } from '../util'

// Checklist tab (run-sheet / SOP) — per-event task list.
const GET_CHECKLIST_SCHEMA: Anthropic.Tool = {
  name: 'get_checklist',
  description: 'Get the run-sheet/SOP checklist for an event: progress %, overdue items (with owner/PIC), and a breakdown by category. Use for "checklist status", "what\'s overdue", "is the run sheet done", "who owns the venue tasks".',
  input_schema: { type: 'object', properties: { event_id: { type: 'string', description: 'Event id. Defaults to active.' } } },
}

async function getChecklist(args: Record<string, unknown>, ctx: AgentContext) {
  const eid = resolveEventId(args.event_id, ctx)
  const { data, error } = await supabase
    .from('checklist_items')
    .select('item, category, status, pic_name, due_date')
    .eq('event_id', eid)
    .order('category')
  if (error) return { error: error.message }
  const rows = data ?? []
  if (!rows.length) return { event: eventLabel(ctx, eid), total: 0, message: 'No checklist yet — seed it on the Checklist tab ("Load SOP").' }

  const done = rows.filter(r => r.status === 'done').length
  const overdue = rows.filter(r => r.due_date && String(r.due_date) < ctx.today && r.status !== 'done')
  const byCat: Record<string, { total: number; done: number }> = {}
  for (const r of rows) {
    const c = String(r.category ?? 'Other')
    byCat[c] ??= { total: 0, done: 0 }
    byCat[c].total++
    if (r.status === 'done') byCat[c].done++
  }
  return {
    event: eventLabel(ctx, eid),
    total: rows.length,
    done,
    pct: rows.length ? Math.round((done / rows.length) * 100) : 0,
    overdue_count: overdue.length,
    overdue: overdue.slice(0, 15).map(r => ({ item: r.item, category: r.category, pic: r.pic_name ?? null, due: r.due_date })),
    by_category: Object.entries(byCat).map(([category, v]) => ({ category, done: v.done, total: v.total })),
  }
}

export const GET_CHECKLIST_TOOL: ToolDef = { schema: GET_CHECKLIST_SCHEMA, handler: getChecklist }
