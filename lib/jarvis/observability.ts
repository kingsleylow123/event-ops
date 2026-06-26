import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

// Fire-and-forget logger for every agent tool call. Never throws, never blocks
// the reply — observability must not be able to break the bot.
export async function logToolCall(entry: {
  run_id: string
  chat_id: number
  tool_name: string
  args: Record<string, unknown>
  result_summary: string
  latency_ms: number
  error: string | null
  model: string
  iteration: number
}): Promise<void> {
  try {
    await supabase.from('jarvis_tool_calls').insert({
      run_id: entry.run_id,
      chat_id: entry.chat_id,
      tool_name: entry.tool_name,
      args: entry.args,
      result_summary: entry.result_summary.slice(0, 500),
      latency_ms: entry.latency_ms,
      error: entry.error,
      model: entry.model,
      iteration: entry.iteration,
    })
  } catch (e) {
    console.error('[jarvis-observability] logToolCall failed', e)
  }
}

// Forensic log of sensitive reads (team-member bank numbers are returned in
// full to Telegram per the admin's explicit choice — this is the audit trail).
export async function logSensitiveRead(
  chatId: number,
  action: string,
  query: string,
  resultCount: number,
): Promise<void> {
  try {
    await supabase.from('jarvis_audit_log').insert({
      chat_id: chatId,
      action,
      query: query.slice(0, 200),
      result_count: resultCount,
    })
  } catch (e) {
    console.error('[jarvis-observability] logSensitiveRead failed', e)
  }
}

// Telegram update dedup. The bot acks fast and processes in the background, so a
// Telegram retry (sent when it doesn't get a quick 200) must not double-run.
// Returns true if this update_id was already seen. FAILS OPEN: any infra error
// (e.g. table missing pre-migration) returns false so a real message is never
// dropped — at worst a genuine duplicate slips through, which the YES-gate and
// idempotent writes already guard against.
export async function isDuplicateUpdate(
  updateId: number,
  chatId: number | null,
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('telegram_updates')
      .insert({ update_id: updateId, chat_id: chatId })
    if (!error) return false
    if (error.code === '23505') return true // unique violation = already processed
    console.error('[jarvis-observability] dedup insert error', error)
    return false // fail open
  } catch (e) {
    console.error('[jarvis-observability] dedup threw', e)
    return false // fail open
  }
}
