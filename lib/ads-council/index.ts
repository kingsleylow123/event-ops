// Ads Council Agent — public surface. Routes and the Telegram webhook import
// from '@/lib/ads-council'.

export { runCouncil, type RunSummary } from './run'
export { executeApproved, approveAndExecute, rollbackAction, type ExecOutcome } from './executor'
export { handleAdsCallback, buildCardHtml, sendActionCard } from './telegram-cards'
export { getAdsConfig, adsCouncilEnabled, type AdsConfig } from './config'
export type { Decision, CandidateAction, FatigueAssessment } from './types'
