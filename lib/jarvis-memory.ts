// Jarvis conversation memory — persists recent turns and a pending action
// (e.g. an invoice awaiting "YES" confirmation) per Telegram chat_id.
// All functions are resilient: on any DB error they log and return a safe
// default so the bot keeps working even if the table is temporarily missing.

import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Turn {
  role: 'user' | 'assistant'
  text: string
}

/** Small JSON blob describing an action that needs user confirmation. */
export interface PendingAction {
  kind: 'invoice' | 'payout' | 'confirm'
  attendee_name?: string
  amount?: number
  mode?: string // e.g. 'cash' | 'transfer'
  created_at: string // ISO timestamp — so stale confirms can be expired
  [key: string]: unknown // allow extra fields per action kind
}

interface Row {
  turns: Turn[]
  pending: PendingAction | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MAX_TURNS = 8   // total turns stored (each turn = 1 user + 1 assistant msg)
const PROMPT_TURNS = 6 // turns surfaced in the system-prompt snippet

async function fetchRow(chatId: number): Promise<Row> {
  const { data, error } = await supabase
    .from('jarvis_conversations')
    .select('turns, pending')
    .eq('chat_id', chatId)
    .maybeSingle()

  if (error) {
    console.error('[jarvis-memory] fetchRow error', error)
    return { turns: [], pending: null }
  }
  return {
    turns:   Array.isArray(data?.turns) ? (data!.turns as Turn[]) : [],
    pending: (data?.pending as PendingAction | null) ?? null,
  }
}

async function upsert(chatId: number, patch: Partial<Row>): Promise<void> {
  const { error } = await supabase
    .from('jarvis_conversations')
    .upsert(
      { chat_id: chatId, updated_at: new Date().toISOString(), ...patch },
      { onConflict: 'chat_id' },
    )

  if (error) console.error('[jarvis-memory] upsert error', error)
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Load the full memory row for a chat. Returns empty defaults on failure.
 * Call this at the START of every Jarvis message handler.
 */
export async function loadMemory(
  chatId: number,
): Promise<{ turns: Turn[]; pending: PendingAction | null }> {
  try {
    return await fetchRow(chatId)
  } catch (e) {
    console.error('[jarvis-memory] loadMemory threw', e)
    return { turns: [], pending: null }
  }
}

/**
 * Append a user+assistant exchange and trim to the last MAX_TURNS turns.
 * Call this AFTER askClaude returns so the assistant reply is captured.
 */
export async function appendTurn(
  chatId: number,
  userText: string,
  assistantText: string,
): Promise<void> {
  try {
    const { turns } = await fetchRow(chatId)
    const updated: Turn[] = [
      ...turns,
      { role: 'user' as const,      text: userText      },
      { role: 'assistant' as const, text: assistantText  },
    ].slice(-MAX_TURNS)
    await upsert(chatId, { turns: updated })
  } catch (e) {
    console.error('[jarvis-memory] appendTurn threw', e)
  }
}

/**
 * Store a pending action (e.g. an invoice waiting for "YES").
 * Call this when Jarvis generates a confirmation prompt.
 */
export async function setPending(
  chatId: number,
  pending: PendingAction | null,
): Promise<void> {
  try {
    await upsert(chatId, { pending: pending ?? null })
  } catch (e) {
    console.error('[jarvis-memory] setPending threw', e)
  }
}

/**
 * Clear the pending action once it is resolved (confirmed OR cancelled).
 * Convenience wrapper around setPending(chatId, null).
 */
export async function clearPending(chatId: number): Promise<void> {
  return setPending(chatId, null)
}

/**
 * Return a short formatted transcript of the last PROMPT_TURNS turns,
 * ready to be injected into the askClaude system prompt.
 * Returns '' if there are no prior turns.
 */
export async function recentTurnsForPrompt(chatId: number): Promise<string> {
  try {
    const { turns } = await fetchRow(chatId)
    if (!turns.length) return ''
    const slice = turns.slice(-PROMPT_TURNS)
    return slice
      .map(t => `${t.role === 'user' ? 'User' : 'Jarvis'}: ${t.text}`)
      .join('\n')
  } catch (e) {
    console.error('[jarvis-memory] recentTurnsForPrompt threw', e)
    return ''
  }
}
