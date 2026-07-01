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
import { ANALYZE_SURVEYS_TOOL } from './survey'
import { GET_MEETINGS_TOOL } from './meetings'
import { GET_PREP_STATUS_TOOL } from './prep'
import { ANALYZE_COMMUNITY_SURVEY_TOOL } from './community'
import { GET_TREND_TOOL } from './trend'
import { GET_CHECKLIST_TOOL } from './checklist'
import { GET_EVENT_TEAM_TOOL } from './event-team'
import { GET_BUKKU_STATUS_TOOL } from './bukku-status'
import { GET_FACILITATOR_STATS_TOOL } from './facilitator-stats'
import { GET_EVENT_LIFECYCLE_TOOL } from './lifecycle'
import { GET_FUNNEL_TOOL, GET_WEAK_LINK_TOOL } from './funnel'
import { CONVENE_BOARD_TOOL } from './convene-board'

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
  ANALYZE_SURVEYS_TOOL,
  GET_MEETINGS_TOOL,
  GET_PREP_STATUS_TOOL,
  ANALYZE_COMMUNITY_SURVEY_TOOL,
  GET_TREND_TOOL,
  GET_CHECKLIST_TOOL,
  GET_EVENT_TEAM_TOOL,
  GET_BUKKU_STATUS_TOOL,
  GET_FACILITATOR_STATS_TOOL,
  GET_EVENT_LIFECYCLE_TOOL,
  GET_FUNNEL_TOOL,
  GET_WEAK_LINK_TOOL,
  CONVENE_BOARD_TOOL,
  MARK_PAID_TOOL,
]

export const TOOL_REGISTRY: Map<string, ToolDef> = new Map(TOOLS.map(t => [t.schema.name, t]))
export const ALL_TOOL_SCHEMAS = TOOLS.map(t => t.schema)
