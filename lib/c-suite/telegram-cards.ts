// AI C-Suite — Telegram board brief + ruling action cards.
// The sitting posts ONE narrative brief, then one card PER RULING with
// done / dismiss / snooze buttons (the ads-council inline-keyboard pattern).
// A tap stamps c_suite_decisions.status — which is how the NEXT sitting knows
// what Kingsley acted on (standing rulings), closing the human loop.
// Recommend-only: the buttons record his call, they never execute anything.

import {
  esc, b, notifyAdmins, notifyAdminsWithButtons, answerCallbackQuery, editMessageText, isAllowedTelegramUser,
  type InlineButton,
} from '@/lib/telegram'
import { transitionDecision, getDecision } from './store'
import type { BoardResult, Ruling } from './types'
import { HEADS } from './heads'

const PRIORITY_EMOJI: Record<string, string> = { high: '🔴', medium: '🟡', low: '🟢' }

export function buildBriefHtml(result: BoardResult): string {
  const title = result.mode === 'weekly' ? '🏛️ Weekly Board Meeting'
    : result.mode === 'ondemand' ? '🏛️ Board — on demand'
    : '🏛️ AI C-Suite — Morning Brief'
  const lines: string[] = []
  lines.push(b(title))
  if (result.question) lines.push(`<i>Q: ${esc(result.question)}</i>`)
  if (result.challengeDegraded) lines.push(`⚠️ ${b('Grilling degraded')} — the challenge round failed; verdicts below are unvetted.`)
  lines.push('')
  if (result.boardBrief) { lines.push(esc(result.boardBrief)); lines.push('') }

  lines.push(b('Heads:'))
  for (const brief of result.briefs) {
    lines.push(`• ${b(HEADS[brief.dept].title)} (${brief.confidence}%): ${esc(brief.headline)}`)
  }
  const rejected = result.challenges.filter(c => c.verdict === 'REJECT')
  if (rejected.length) {
    lines.push('')
    lines.push(`<i>Manager pushed back on: ${esc(rejected.map(c => HEADS[c.dept].title).join(', '))} (${result.rounds} round${result.rounds !== 1 ? 's' : ''})</i>`)
  }
  return lines.join('\n')
}

export function buildRulingHtml(r: Ruling): string {
  const em = PRIORITY_EMOJI[r.priority] ?? '•'
  const lines = [
    `${em} ${b(r.title)} · ${esc(r.priority)} · ${esc(r.confidence)}%`,
    esc(r.decision),
  ]
  if (r.rationale) lines.push(`<i>${esc(r.rationale)}</i>`)
  if (r.overruled.length) lines.push(`<i>Overruled: ${esc(r.overruled.join('; '))}</i>`)
  return lines.join('\n')
}

export function buildRulingButtons(decisionId: string): InlineButton[][] {
  return [[
    { text: '✅ Done', callback_data: `csuite:done:${decisionId}` },
    { text: '🙅 Dismiss', callback_data: `csuite:dismiss:${decisionId}` },
    { text: '⏰ Snooze', callback_data: `csuite:snooze:${decisionId}` },
  ]]
}

// Post the brief, then one actionable card per persisted ruling.
// rulingIds aligns 1:1 with result.rulings (null = insert failed → no buttons).
export async function sendBoardBrief(result: BoardResult, rulingIds: Array<string | null> = []): Promise<void> {
  await notifyAdmins(buildBriefHtml(result))
  for (let i = 0; i < result.rulings.length; i++) {
    const r = result.rulings[i]
    const id = rulingIds[i]
    if (id) await notifyAdminsWithButtons(buildRulingHtml(r), buildRulingButtons(id))
    else await notifyAdmins(buildRulingHtml(r))
  }
}

// ── Callback handling (wired into the main Telegram webhook) ──────────────────
interface CallbackQuery {
  id: string
  from?: { id?: number; first_name?: string; username?: string }
  data?: string
  message?: { message_id?: number; chat?: { id?: number } }
}

const VERB_TO_STATUS: Record<string, 'done' | 'dismissed' | 'snoozed'> = {
  done: 'done', dismiss: 'dismissed', snooze: 'snoozed',
}
const STATUS_LABEL: Record<string, string> = {
  done: '✅ Done', dismissed: '🙅 Dismissed', snoozed: '⏰ Snoozed (will resurface as a standing ruling)',
}

// Returns true if it handled a c-suite callback (so the webhook can stop).
export async function handleCSuiteCallback(cbq: CallbackQuery): Promise<boolean> {
  const data = cbq.data ?? ''
  if (!data.startsWith('csuite:')) return false
  try {
    const [, verb, decisionId] = data.split(':')
    if (!isAllowedTelegramUser(cbq.from?.id)) {
      await answerCallbackQuery(cbq.id, 'Not authorised.')
      return true
    }
    const who = cbq.from?.first_name || cbq.from?.username || String(cbq.from?.id ?? 'admin')
    const to = VERB_TO_STATUS[verb]
    if (!to || !decisionId) {
      await answerCallbackQuery(cbq.id, 'Bad action.')
      return true
    }
    // Snoozed rulings can be re-decided; done/dismissed are final (from 'pending').
    let res = await transitionDecision(decisionId, 'pending', to, who)
    if (res === 'conflict' && to !== 'snoozed') {
      res = await transitionDecision(decisionId, 'snoozed', to, who)
    }
    // Honest answers: a Supabase error is retryable, not "already handled".
    if (res === 'error') {
      await answerCallbackQuery(cbq.id, 'Something went wrong — tap again.')
      return true
    }
    await answerCallbackQuery(cbq.id, res === 'moved' ? STATUS_LABEL[to] : 'Already handled.')
    // Edit the tapped card from the AUTHORITATIVE row — this also self-heals a
    // stale card (another admin decided first) the moment anyone touches it.
    if (cbq.message?.chat?.id != null && cbq.message?.message_id != null) {
      const d = await getDecision(decisionId)
      const finalStatus = d?.status && STATUS_LABEL[d.status] ? d.status : to
      const byLine = res === 'moved' ? `by ${esc(who)}` : `by ${esc(d?.decided_by ?? 'another admin')} earlier`
      await editMessageText(
        cbq.message.chat.id,
        cbq.message.message_id,
        `${STATUS_LABEL[finalStatus]} — ${b(d?.title ?? decisionId)}\n<i>${byLine}</i>`,
      )
    }
    return true
  } catch (e) {
    console.error('[c-suite] handleCSuiteCallback', e)
    try { await answerCallbackQuery(cbq.id, 'Something went wrong.') } catch { /* ignore */ }
    return true
  }
}