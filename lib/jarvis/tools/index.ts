import type { ToolDef } from '../types'
import { FIND_PERSON_TOOL, GET_PERSON_DETAIL_TOOL } from './attendee'
import { ANALYZE_PRICING_TOOL } from './pricing'
import { GET_FINANCE_SUMMARY_TOOL } from './finance'
import { GET_PIPELINE_TOOL, UPDATE_PIPELINE_TOOL, executeUpdatePipeline } from './pipeline'
import { GET_TEAM_MEMBERS_TOOL, GET_FACILITATOR_PAYOUTS_TOOL } from './team'
import { GET_AFFILIATE_REPORT_TOOL } from './affiliate'
import { SEARCH_LEADS_TOOL } from './leads'
import { GET_CLAIMS_DEPOSITS_TOOL } from './claims'
import { LIST_EVENTS_TOOL, COMPARE_EVENTS_TOOL } from './events'
import { MARK_PAID_TOOL, executeMarkPaid } from './payments'

// Write-tool executors run from the route's YES handler (after confirmation).
export { executeMarkPaid, executeUpdatePipeline }

const TOOLS: ToolDef[] = [
  FIND_PERSON_TOOL,
  GET_PERSON_DETAIL_TOOL,
  ANALYZE_PRICING_TOOL,
  GET_FINANCE_SUMMARY_TOOL,
  GET_PIPELINE_TOOL,
  UPDATE_PIPELINE_TOOL,
  GET_TEAM_MEMBERS_TOOL,
  GET_FACILITATOR_PAYOUTS_TOOL,
  GET_AFFILIATE_REPORT_TOOL,
  SEARCH_LEADS_TOOL,
  GET_CLAIMS_DEPOSITS_TOOL,
  LIST_EVENTS_TOOL,
  COMPARE_EVENTS_TOOL,
  MARK_PAID_TOOL,
]

export const TOOL_REGISTRY: Map<string, ToolDef> = new Map(TOOLS.map(t => [t.schema.name, t]))
export const ALL_TOOL_SCHEMAS = TOOLS.map(t => t.schema)
