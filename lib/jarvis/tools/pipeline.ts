import type Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import type { ToolDef, AgentContext, StagedWrite } from '../types'
import { resolveEventId, eventLabel } from '../util'
import { esc } from '../html'

const VALID_STATUSES = ['new', 'contacted', 'meeting', 'won', 'lost']

// ── get_pipeline (read) ───────────────────────────────────────────────────────
const GET_PIPELINE_SCHEMA: Anthropic.Tool = {
  name: 'get_pipeline',
  description: 'Get the sales pipeline (deal_leads) for an event: status breakdown, hot leads (new/contacted) with client + rep + needs, and per-rep counts. Use for "pipeline", "hot leads", "deal status", "who is closing".',
  input_schema: {
    type: 'object',
    properties: {
      event_id: { type: 'string', description: 'Event id. Defaults to active.' },
      status: { type: 'string', enum: ['all', 'hot', 'new', 'contacted', 'meeting', 'won', 'lost'], description: 'Filter. "hot" = new+contacted. Default all.' },
    },
  },
}

async function getPipeline(args: Record<string, unknown>, ctx: AgentContext) {
  const eid = resolveEventId(args.event_id, ctx)
  const { data, error } = await supabase
    .from('deal_leads')
    .select('id,client_name,client_phone,client_email,needs,rep_name,status,source,call_scheduled_at,created_at')
    .eq('event_id', eid)
    .order('created_at', { ascending: false })
  if (error) return { error: error.message }
  const rows = data ?? []

  const byStatus: Record<string, number> = { new: 0, contacted: 0, meeting: 0, won: 0, lost: 0 }
  for (const r of rows) byStatus[String(r.status)] = (byStatus[String(r.status)] ?? 0) + 1

  const filter = String(args.status ?? 'all')
  let shown = rows
  if (filter === 'hot') shown = rows.filter(r => r.status === 'new' || r.status === 'contacted')
  else if (VALID_STATUSES.includes(filter)) shown = rows.filter(r => r.status === filter)

  return {
    event: eventLabel(ctx, eid),
    total: rows.length,
    by_status: byStatus,
    leads: shown.slice(0, 25).map(r => ({
      id: r.id,
      client_name: r.client_name,
      client_phone: r.client_phone ?? null,
      needs: r.needs ?? null,
      rep_name: r.rep_name ?? null,
      status: r.status,
      source: r.source ?? null,
      call_scheduled_at: r.call_scheduled_at ?? null,
    })),
  }
}

// ── update_pipeline_status (write — staged via YES gate) ──────────────────────
const UPDATE_PIPELINE_SCHEMA: Anthropic.Tool = {
  name: 'update_pipeline_status',
  description: 'Move a deal lead to a new pipeline stage (new/contacted/meeting/won/lost). Get the deal id from get_pipeline first. This STAGES the change — the admin must reply YES to confirm.',
  input_schema: {
    type: 'object',
    properties: {
      deal_lead_id: { type: 'string', description: 'The deal lead id from get_pipeline' },
      status: { type: 'string', enum: VALID_STATUSES, description: 'New pipeline stage' },
    },
    required: ['deal_lead_id', 'status'],
  },
}

async function updatePipelineStatus(args: Record<string, unknown>, ctx: AgentContext): Promise<unknown> {
  const id = String(args.deal_lead_id ?? '').trim()
  const status = String(args.status ?? '').trim().toLowerCase()
  if (!id) return { ok: false, reason: 'deal_lead_id required' }
  if (!VALID_STATUSES.includes(status)) return { ok: false, reason: `status must be one of ${VALID_STATUSES.join(', ')}` }

  const { data: lead, error } = await supabase
    .from('deal_leads')
    .select('id,client_name,status,event_id')
    .eq('id', id)
    .maybeSingle()
  if (error) return { ok: false, reason: error.message }
  if (!lead) return { ok: false, reason: 'No deal lead with that id.' }
  if (lead.status === status) return { ok: false, reason: `${lead.client_name} is already at "${status}".` }

  const preview =
    `🔁 <b>Update pipeline</b>\n` +
    `• <b>${esc(lead.client_name)}</b> — ${esc(eventLabel(ctx, lead.event_id as string))}\n` +
    `  ${esc(lead.status)} → <b>${esc(status)}</b>\n\n` +
    `Reply <b>YES</b> to confirm, or "cancel". Expires in 10 min.`

  const staged: StagedWrite = {
    __staged: true,
    kind: 'update_pipeline',
    preview,
    pending: { deal_lead_id: id, status, client_name: lead.client_name, from_status: lead.status },
  }
  return staged
}

// Executed by the route's YES handler after the admin confirms.
export async function executeUpdatePipeline(pending: Record<string, unknown>): Promise<string> {
  const id = String(pending.deal_lead_id ?? '')
  const status = String(pending.status ?? '')
  const fromStatus = String(pending.from_status ?? '')
  const name = String(pending.client_name ?? 'lead')
  if (!id || !VALID_STATUSES.includes(status)) return '⚠️ Pipeline update had invalid data — nothing changed.'
  // Guard on the stage we staged FROM: if someone moved the lead in the dashboard
  // during the 10-min confirm window, don't silently clobber their change.
  let q = supabase
    .from('deal_leads')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (fromStatus) q = q.eq('status', fromStatus)
  const { data, error } = await q.select('id')
  if (error) return `🛑 Couldn't update ${name}: ${error.message}`
  if (!data || !data.length) return `ℹ️ ${name} was already moved (no longer "${fromStatus}") — nothing changed.`
  return `✅ ${name} moved to <b>${status}</b>.`
}

export const GET_PIPELINE_TOOL: ToolDef = { schema: GET_PIPELINE_SCHEMA, handler: getPipeline }
export const UPDATE_PIPELINE_TOOL: ToolDef = { schema: UPDATE_PIPELINE_SCHEMA, handler: updatePipelineStatus, write: true }
