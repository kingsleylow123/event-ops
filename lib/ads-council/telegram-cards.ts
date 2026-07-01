// Ads Council Agent — Telegram approval cards + callback handling.
// Each proposed action becomes one card with the full reasoning (fatigue WHY,
// Judge verdict, each reviewer's line, key metrics) and Approve/Reject buttons.
// Tapping routes through handleAdsCallback → executor. v1 = copilot: nothing is
// committed until a card is approved here.

import {
  esc, b, notifyAdminsWithButtons, answerCallbackQuery, editMessageText, isAllowedTelegramUser,
  type InlineButton,
} from '@/lib/telegram'
import { getAction, transitionAction } from './store'
import { executeApproved } from './executor'
import type { Decision } from './types'

const EMOJI: Record<string, string> = {
  scale: '📈', pause: '⏸️', refresh_creative: '🎨', shift_budget: '💸', escalate: '🤔', none: 'ℹ️',
}

function metricsLine(d: Decision): string {
  const s = d.supportingData
  const bits: string[] = []
  if (s.cost_per_dm != null && Number(s.cost_per_dm) >= 0) bits.push(`cost/DM RM${s.cost_per_dm}`)
  if (s.dms_7d != null) bits.push(`${s.dms_7d} DMs/7d`)
  if (s.ctr_wow != null) bits.push(`CTR ${pct(Number(s.ctr_wow))} WoW`)
  if (s.frequency != null) bits.push(`freq ${s.frequency}`)
  if (s.spend_7d != null) bits.push(`RM${s.spend_7d} spent`)
  return bits.join(' · ')
}
function pct(frac: number): string {
  const p = Math.round(frac * 100)
  return (p > 0 ? '+' : '') + p + '%'
}

// Build the card HTML for a queued action.
export function buildCardHtml(d: Decision): string {
  const emoji = EMOJI[d.actionType] ?? '•'
  const lines: string[] = []
  lines.push(`${emoji} ${b(d.actionType.replace('_', ' ').toUpperCase())} — ${b(d.targetName)}`)
  lines.push(`<i>${esc(d.scope)} ${esc(d.targetEntityId)}</i> · confidence ${esc(d.confidence)}%`)
  lines.push('')
  lines.push(`${b('Why')}: ${esc(d.why)}`)
  lines.push(`${b('Judge')}: ${esc(d.verdictReason)}`)
  const m = metricsLine(d)
  if (m) lines.push(`${b('Metrics')}: ${m}`)
  lines.push('')
  lines.push(b('Council:'))
  for (const o of d.transcript) {
    const tag = o.role.replace('_', ' ').replace(' advocate', '').replace(' critic', '')
    lines.push(`• ${esc(tag)}${o.veto ? ' 🚫' : ''}: ${esc(o.argument)}`)
  }
  return lines.join('\n')
}

export function buildButtons(actionId: string, actionType: string): InlineButton[][] {
  if (actionType === 'escalate' || actionType === 'none') {
    return [[{ text: '👍 Got it', callback_data: `ads:reject:${actionId}` }]]
  }
  return [[
    { text: '✅ Approve', callback_data: `ads:approve:${actionId}` },
    { text: '🚫 Reject', callback_data: `ads:reject:${actionId}` },
  ]]
}

// Post one action card to all admins.
export async function sendActionCard(actionId: string, d: Decision): Promise<void> {
  await notifyAdminsWithButtons(buildCardHtml(d), buildButtons(actionId, d.actionType))
}

// ── Callback handling (wired into the main Telegram webhook) ──────────────────
interface CallbackQuery {
  id: string
  from?: { id?: number; first_name?: string; username?: string }
  data?: string
  message?: { message_id?: number; chat?: { id?: number } }
}

// Returns true if it handled an ads-council callback (so the webhook can stop).
export async function handleAdsCallback(cbq: CallbackQuery): Promise<boolean> {
  const data = cbq.data ?? ''
  if (!data.startsWith('ads:')) return false

  try {
  const [, verb, actionId] = data.split(':')
  const chatId = cbq.message?.chat?.id
  const messageId = cbq.message?.message_id

  // Authorise — only allowed Telegram users can decide.
  if (!isAllowedTelegramUser(cbq.from?.id)) {
    await answerCallbackQuery(cbq.id, 'Not authorised.')
    return true
  }
  const who = cbq.from?.first_name || cbq.from?.username || String(cbq.from?.id ?? 'admin')

  if (!actionId) {
    await answerCallbackQuery(cbq.id, 'Bad action.')
    return true
  }

  if (verb === 'reject') {
    const moved = await transitionAction(actionId, 'pending', 'rejected', { decided_by: who, decided_at: new Date().toISOString() })
    await answerCallbackQuery(cbq.id, moved ? 'Dismissed.' : 'Already handled.')
    if (moved && chatId != null && messageId != null) {
      const a = await getAction(actionId)
      await editMessageText(chatId, messageId, `🚫 ${b('Rejected')} — ${esc(a?.target_name ?? actionId)}\n<i>by ${esc(who)}</i>`)
    }
    return true
  }

  if (verb === 'approve') {
    // pending → approved (guards against double-tap); executor claims approved → executing.
    const moved = await transitionAction(actionId, 'pending', 'approved', { decided_by: who, decided_at: new Date().toISOString() })
    if (!moved) {
      await answerCallbackQuery(cbq.id, 'Already handled.')
      return true
    }
    await answerCallbackQuery(cbq.id, 'Approving…')
    const outcome = await executeApproved(actionId, who)
    if (chatId != null && messageId != null) {
      const a = await getAction(actionId)
      const head = outcome.ok ? '✅ ' + b('Approved & executed') : '⚠️ ' + b('Approved — execution failed')
      await editMessageText(chatId, messageId, `${head} — ${esc(a?.target_name ?? actionId)}\n${esc(outcome.message)}\n<i>by ${esc(who)}</i>`)
    }
    return true
  }

  await answerCallbackQuery(cbq.id, 'Unknown action.')
  return true
  } catch (e) {
    console.error('[ads-council] handleAdsCallback', e)
    try { await answerCallbackQuery(cbq.id, 'Something went wrong.') } catch { /* ignore */ }
    return true
  }
}
