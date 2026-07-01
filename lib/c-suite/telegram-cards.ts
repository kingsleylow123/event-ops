// AI C-Suite — Telegram board brief. The nightly/weekly sitting posts one card to
// admins: the manager's narrative + the top rulings. Recommend-only, so this is
// informational (no execute buttons) — the decisions live on the /c-suite dashboard.

import { esc, b, notifyAdmins } from '@/lib/telegram'
import type { BoardResult } from './types'
import { HEADS } from './heads'

const PRIORITY_EMOJI: Record<string, string> = { high: '🔴', medium: '🟡', low: '🟢' }

export function buildBriefHtml(result: BoardResult): string {
  const title = result.mode === 'weekly' ? '🏛️ Weekly Board Meeting'
    : result.mode === 'ondemand' ? '🏛️ Board — on demand'
    : '🏛️ AI C-Suite — Morning Brief'
  const lines: string[] = []
  lines.push(b(title))
  if (result.question) lines.push(`<i>Q: ${esc(result.question)}</i>`)
  lines.push('')
  if (result.boardBrief) { lines.push(esc(result.boardBrief)); lines.push('') }

  lines.push(b('Rulings:'))
  for (const r of result.rulings) {
    const em = PRIORITY_EMOJI[r.priority] ?? '•'
    lines.push(`${em} ${b(r.title)} — ${esc(r.decision)}`)
    if (r.rationale) lines.push(`   <i>${esc(r.rationale)}</i>`)
    if (r.overruled.length) lines.push(`   <i>overruled: ${esc(r.overruled.join('; '))}</i>`)
  }

  lines.push('')
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

export async function sendBoardBrief(result: BoardResult): Promise<void> {
  await notifyAdmins(buildBriefHtml(result))
}
