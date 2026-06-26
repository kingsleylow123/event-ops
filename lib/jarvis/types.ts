import type Anthropic from '@anthropic-ai/sdk'

// Minimal event shape the agent + tools need (no per-person data).
export interface AgentEvent {
  id: string
  name: string
  date: string | null
}

// The lean context handed to every tool call. NOT the old fat snapshot — tools
// fetch their own data on demand.
export interface AgentContext {
  chatId: number
  activeEvent: AgentEvent
  allEvents: AgentEvent[]
  today: string // ISO yyyy-mm-dd
}

// A write tool NEVER mutates inline. It returns a StagedWrite, which the agent
// surfaces to the admin as a "reply YES" confirmation (same gate as invoices).
// The actual mutation runs later, in the route's YES handler.
export interface StagedWrite {
  __staged: true
  kind: 'mark_paid' | 'update_pipeline'
  preview: string // HTML shown to the admin before they confirm
  pending: Record<string, unknown> // merged into the PendingAction blob
}

export function isStagedWrite(v: unknown): v is StagedWrite {
  return !!v && typeof v === 'object' && (v as { __staged?: unknown }).__staged === true
}

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: AgentContext,
) => Promise<unknown>

export interface ToolDef {
  schema: Anthropic.Tool
  handler: ToolHandler
  write?: boolean // staged via YES-gate, never auto-executed
  audit?: boolean // log every call to jarvis_audit_log (sensitive/PII reads)
}

export interface JarvisRunResult {
  reply: string
  staged?: StagedWrite
}
