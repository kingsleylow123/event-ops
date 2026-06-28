import Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'node:crypto'
import type { AgentContext, JarvisRunResult, StagedWrite } from './types'
import { isStagedWrite } from './types'
import { TOOL_REGISTRY, ALL_TOOL_SCHEMAS } from './tools'
import { buildSystemPrompt } from './prompt'
import { recentTurnsForPrompt } from '@/lib/jarvis-memory'
import { logToolCall } from './observability'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const HAIKU = 'claude-haiku-4-5'
const SONNET = 'claude-sonnet-4-6'
const MAX_ITERATIONS = 8

// Escalate to Sonnet for analytical, money, or person-lookup questions — the
// multi-hop / disambiguation cases where Haiku is least reliable. Trivial counts
// and status checks stay on cheaper Haiku.
const SONNET_RE =
  /\b(compare|comparison|vs|trend|across|each event|all events|breakdown|why|most|least|average|top|conversion|which|better|worse|price|pricing|stripe|revenue|profit|net|margin|contact|phone|email|whatsapp|number|find|who|bank|account|submitted|paid|pay|owe|payout|reconcile|analy|survey|industr|pain|insight|theme|summar|communit|member|trend|pace|accelerat|momentum|project|lifecycle|readiness|facilitator|checklist|bukku|crew|tab|flow|stage|ratio|historical|vip|funnel|bottleneck|leak|constraint|weak)\b/i

function pickModel(question: string): { model: string; maxTokens: number } {
  return SONNET_RE.test(question)
    ? { model: SONNET, maxTokens: 2048 }
    : { model: HAIKU, maxTokens: 1024 }
}

function newRunId(): string {
  return randomUUID()
}

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map(c => c.text)
    .join('')
    .trim()
}

// The tool-using agent loop. Returns either a text reply or a StagedWrite
// (a YES-gated action the route will confirm before executing).
export async function runAgent(question: string, ctx: AgentContext): Promise<JarvisRunResult> {
  const recent = await recentTurnsForPrompt(ctx.chatId)
  const system = buildSystemPrompt(ctx, recent)
  const { model, maxTokens } = pickModel(question)
  const runId = newRunId()

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question }]

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    let resp: Anthropic.Message
    try {
      resp = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        tools: ALL_TOOL_SCHEMAS,
        // One tool per turn: stops the model batching a read + a staged write in
        // one response (which the staged-write short-circuit would drop) and keeps
        // the loop's tool_result accounting exact.
        tool_choice: { type: 'auto', disable_parallel_tool_use: true },
        messages,
      })
    } catch (e) {
      console.error('[jarvis-agent] anthropic error', e)
      return { reply: '⚠️ I hit an error reaching the model. Try again in a moment.' }
    }

    const toolUses = resp.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use')

    // No tool calls → final answer.
    if (resp.stop_reason !== 'tool_use' || !toolUses.length) {
      return { reply: textOf(resp.content) || 'Sorry, I could not generate a reply.' }
    }

    // Assistant turn (incl. tool_use blocks) must precede the tool results.
    messages.push({ role: 'assistant', content: resp.content })

    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const tu of toolUses) {
      const def = TOOL_REGISTRY.get(tu.name)
      const t0 = Date.now()
      let result: unknown
      let errMsg: string | null = null
      if (!def) {
        result = { error: `unknown tool ${tu.name}` }
        errMsg = 'unknown tool'
      } else {
        try {
          result = await def.handler(tu.input as Record<string, unknown>, ctx)
        } catch (e) {
          result = { error: e instanceof Error ? e.message : String(e) }
          errMsg = String(e)
        }
      }

      // A write tool returns a StagedWrite → never mutate inline; hand it back to
      // the route to confirm via the YES gate.
      if (isStagedWrite(result)) {
        void logToolCall({ run_id: runId, chat_id: ctx.chatId, tool_name: tu.name, args: tu.input as Record<string, unknown>, result_summary: 'staged', latency_ms: Date.now() - t0, error: null, model, iteration })
        return { reply: '', staged: result as StagedWrite }
      }

      void logToolCall({ run_id: runId, chat_id: ctx.chatId, tool_name: tu.name, args: tu.input as Record<string, unknown>, result_summary: JSON.stringify(result), latency_ms: Date.now() - t0, error: errMsg, model, iteration })
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) })
    }

    messages.push({ role: 'user', content: toolResults })
  }

  // Iteration cap reached — force a final answer. `tools` must stay present
  // (the messages contain tool_result blocks, which the API requires tools for);
  // tool_choice 'none' forbids any further tool call so the model answers in text.
  // The conversation already ends on a tool_result (user) turn — no extra message.
  try {
    const final = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      tools: ALL_TOOL_SCHEMAS,
      tool_choice: { type: 'none' },
      messages,
    })
    return { reply: textOf(final.content) || 'I gathered some data but ran out of steps — try a more specific question.' }
  } catch {
    return { reply: 'I ran out of steps on that one — try narrowing the question.' }
  }
}
