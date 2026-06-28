// Funnel Command Center — AI advisor. Two surfaces:
//   adviseFunnel(report)        → on-demand deep-dive (Sonnet), for the in-app button
//   computeStandingInsight()    → cheap daily one-liner (Haiku), written by the cron
// Both are best-effort: any error → null, so callers show a graceful fallback and
// nothing ever breaks the page or the digest.

import Anthropic from '@anthropic-ai/sdk'
import { buildFunnel, weakLinkLine, type FunnelReport } from '@/lib/funnel'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Grounding rules shared by both calls: cite only numbers from the report, never
// invent a rate/RM, gross-figures caveat, Hormozi constraint voice.
const GROUNDING =
  'You are EventOps\' Funnel Advisor for Claude Malaysia (paid AI workshops, Malaysian ringgit). ' +
  'Think like Alex Hormozi: find the ONE binding constraint, ignore vanity metrics, weigh by money. ' +
  'Cite ONLY numbers present in the data given — never invent a rate or RM figure. ' +
  'Revenue is gross (before refunds) — assume so. Be direct, specific, no hype, no markdown headings.'

function compactReport(r: FunnelReport) {
  return {
    scope: r.scope.eventName || `whole business ${r.scope.from}→${r.scope.to}`,
    stages: r.stages.map(s => ({ stage: s.label, count: s.count, revenueRM: s.revenue, convFromPrevPct: s.convFromPct, measures: s.convNote })),
    weakest_link: r.weakLink,
    runner_up: r.runnerUp,
    totals: r.totals,
    affiliate_share_pct: r.attribution.affiliatePct,
    strengths: r.strengths,
    risks: r.risks,
  }
}

// On-demand deep-dive: full report → constraint + concrete fix + RM at stake.
export async function adviseFunnel(report: FunnelReport): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      system:
        GROUNDING +
        ' Given the funnel report JSON, answer in 3 short blocks: ' +
        '(1) THE CONSTRAINT — the one stage transition leaking the most money, with its % and RM upside; ' +
        '(2) THE FIX — one concrete action to take this week (pull from the listed fixes, make it specific); ' +
        '(3) WATCH — one leading indicator to track. Keep it tight, plain text.',
      messages: [{ role: 'user', content: JSON.stringify(compactReport(report)) }],
    }, { timeout: 25000 })
    const block = msg.content.find(c => c.type === 'text')
    return block && block.type === 'text' ? block.text.trim() : null
  } catch (e) {
    console.error('[funnel-advisor] adviseFunnel error', e)
    return null
  }
}

// Cheap standing insight for the daily ping + the cached in-app card.
export async function computeStandingInsight(): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  try {
    const report = await buildFunnel({})
    if (!report.weakLink) return null
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 160,
      system: GROUNDING + ' Output exactly 2 lines: line 1 = the constraint + its number; line 2 = the single highest-RM action. No preamble.',
      messages: [{
        role: 'user',
        content:
          `${weakLinkLine(report)}\n` +
          `Fixes available: ${(report.weakLink.fixes || []).join('; ')}\n` +
          `Affiliate share of revenue: ${report.attribution.affiliatePct}%. Risks: ${report.risks.join('; ') || 'none'}.`,
      }],
    }, { timeout: 15000 })
    const block = msg.content.find(c => c.type === 'text')
    return block && block.type === 'text' ? block.text.trim() : null
  } catch (e) {
    console.error('[funnel-advisor] computeStandingInsight error', e)
    return null
  }
}
