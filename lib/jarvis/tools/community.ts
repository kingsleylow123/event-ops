import type Anthropic from '@anthropic-ai/sdk'
import { fetchAllRows } from '@/lib/supabase-admin'
import { communityDb, communityEnabled } from '../community-db'
import type { ToolDef } from '../types'

type Row = Record<string, unknown>
const MAX_TEXT = 60
const CLIP = 300

// Count a scalar text field (optionally case-normalized, keeping a representative label).
function topCounts(rows: Row[], field: string, limit = 15, norm = false) {
  const m = new Map<string, { label: string; count: number }>()
  for (const r of rows) {
    const raw = String(r[field] ?? '').trim()
    if (!raw) continue
    const key = norm ? raw.toLowerCase() : raw
    const e = m.get(key)
    if (e) e.count++
    else m.set(key, { label: raw, count: 1 })
  }
  return [...m.values()].sort((a, b) => b.count - a.count).slice(0, limit).map(({ label, count }) => ({ label, count }))
}

// Count occurrences across an array (text[]) field (multi-select answers).
function topArray(rows: Row[], field: string, limit = 12) {
  const m = new Map<string, number>()
  for (const r of rows) {
    const arr = Array.isArray(r[field]) ? (r[field] as unknown[]) : []
    for (const v of arr) {
      const k = String(v ?? '').trim()
      if (k) m.set(k, (m.get(k) ?? 0) + 1)
    }
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([label, count]) => ({ label, count }))
}

const ANALYZE_COMMUNITY_SURVEY_SCHEMA: Anthropic.Tool = {
  name: 'analyze_community_survey',
  description:
    'Analyze the Claude Malaysia COMMUNITY join survey (~1000 members — SEPARATE from the per-workshop pre-event survey). Returns top industries, team sizes, AI maturity (ai_level), client type, top AI use cases, what members want from the community, event preferences, and the raw free-text pain points (theme these). Use for "community survey", "our members\' top industry / pain points", "how AI-mature are our members", "what do community members want".',
  input_schema: { type: 'object', properties: {} },
}

async function analyzeCommunitySurvey() {
  if (!communityEnabled() || !communityDb) {
    return { error: 'The community survey database is not connected yet. Set CONTENT_SUPABASE_SERVICE_ROLE_KEY in the EventOps environment to enable this.' }
  }
  const db = communityDb
  const { rows, error } = await fetchAllRows<Row>((from, to) =>
    db
      .from('community_members')
      .select('industry,team_size,ai_level,client_type,role,city,heard_from,pain_point,ai_use_cases,community_value,event_preference')
      .order('member_number', { ascending: true })
      .range(from, to),
  )
  if (error) return { error }
  const data = rows ?? []
  if (!data.length) return { total_members: 0, message: 'No community survey responses found.' }

  const painPoints: string[] = []
  for (const r of data) {
    const p = String(r.pain_point ?? '').trim()
    if (p && painPoints.length < MAX_TEXT) painPoints.push(p.slice(0, CLIP))
  }

  return {
    source: 'Claude Malaysia community join survey',
    total_members: data.length,
    top_industries: topCounts(data, 'industry', 15, true),
    team_size: topCounts(data, 'team_size', 10),
    ai_level: topCounts(data, 'ai_level', 10),
    client_type: topCounts(data, 'client_type', 10),
    role: topCounts(data, 'role', 10),
    top_ai_use_cases: topArray(data, 'ai_use_cases', 12),
    community_value_wanted: topArray(data, 'community_value', 12),
    event_preference: topArray(data, 'event_preference', 12),
    pain_points_raw: painPoints, // free-text — theme these for top pain points
    note: painPoints.length >= MAX_TEXT ? `Showing the first ${MAX_TEXT} free-text pain-point answers of ${data.length} members.` : undefined,
  }
}

export const ANALYZE_COMMUNITY_SURVEY_TOOL: ToolDef = { schema: ANALYZE_COMMUNITY_SURVEY_SCHEMA, handler: analyzeCommunitySurvey }
