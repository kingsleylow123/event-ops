import type Anthropic from '@anthropic-ai/sdk'
import type { ToolDef, AgentContext } from '../types'
import { runBoard, formatForChat } from '@/lib/c-suite'

// Jarvis on-demand: convene the AI C-Suite on a strategic question. The 4 heads
// gather, the manager grills them, and one ruling comes back. notify:false so the
// board doesn't ALSO post a card — Jarvis returns the brief as its reply.
const CONVENE_BOARD_SCHEMA: Anthropic.Tool = {
  name: 'convene_board',
  description:
    'Convene the AI C-Suite (Head of Sales/Ops/Finance/Marketing + a manager who grills them) on a strategic question and return their synthesised ruling. Use for cross-functional judgement calls — e.g. "should we scale ad spend?", "why is our slowest workshop not filling?", "what is the #1 move this week?". Slow (multiple model calls) — use only for real strategic questions, not simple lookups.',
  input_schema: {
    type: 'object',
    properties: { question: { type: 'string', description: 'The strategic question to put to the board.' } },
    required: ['question'],
  },
}

async function conveneBoard(args: Record<string, unknown>, _ctx: AgentContext) {
  const question = String(args.question ?? '').trim()
  if (!question) return { error: 'Provide a question for the board.' }
  const summary = await runBoard('ondemand', question, { notify: false })
  if (!summary.ok || !summary.result) return { error: summary.skipped || summary.error || 'Board could not convene.' }
  return {
    question,
    board: formatForChat(summary.result),
    rulings: summary.result.rulings.map(r => ({ title: r.title, decision: r.decision, priority: r.priority, confidence: r.confidence })),
    rounds: summary.result.rounds,
  }
}

export const CONVENE_BOARD_TOOL: ToolDef = { schema: CONVENE_BOARD_SCHEMA, handler: conveneBoard }
