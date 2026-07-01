// Ads Council Agent — configuration. All knobs come from env so nothing is
// hard-coded and the feature stays OFF until Meta credentials are present.
//
// Required to enable:   META_ACCESS_TOKEN, META_AD_ACCOUNT_ID
// Everything else has a safe default. v1 ships AUTONOMY_MODE=copilot, which means
// the executor NEVER fires without an explicit Telegram approval.

import type { AutonomyMode } from './types'

function num(name: string, dflt: number): number {
  const v = process.env[name]
  const n = v == null ? NaN : Number(v)
  return Number.isFinite(n) ? n : dflt
}

function str(name: string, dflt = ''): string {
  return process.env[name] ?? dflt
}

export interface AdsConfig {
  // --- Meta ---
  accessToken: string
  adAccountId: string          // with or without 'act_' prefix; normalised below
  graphVersion: string
  pageId: string
  igUserId: string
  currency: string             // account currency, e.g. 'MYR'

  // --- Autonomy & safety ---
  mode: AutonomyMode           // copilot (v1) | risk_tiered (v2)
  dryRun: boolean              // true → never write to Meta (still deliberates)
  maxBudgetChangePct: number   // hard clamp per run, e.g. 20
  cooldownHours: number        // per-entity cooldown before re-firing
  budgetGovernorDaily: number  // RM ceiling per account (0 = no ceiling)

  // --- Min-sample floor (significance veto) ---
  minImpressions: number
  minResults: number           // min messaging conversations before a KILL is allowed
  minSpend: number             // RM

  // --- Targets / scoring ---
  targetCostPerDm: number      // RM; 0 = learn baseline from data
  maxCandidatesPerRun: number  // cap council calls per run (cost control)
  resultActionType: string     // Meta action_type substring counted as a "result" (DM)

  // --- Models ---
  debaterModel: string
  judgeModel: string
}

export function getAdsConfig(): AdsConfig {
  return {
    accessToken: str('META_ACCESS_TOKEN'),
    adAccountId: str('META_AD_ACCOUNT_ID'),
    graphVersion: str('META_GRAPH_VERSION', 'v23.0'),
    pageId: str('META_PAGE_ID'),
    igUserId: str('META_IG_USER_ID'),
    currency: str('ADS_CURRENCY', 'MYR'),

    mode: (str('ADS_AUTONOMY_MODE', 'copilot') === 'risk_tiered' ? 'risk_tiered' : 'copilot'),
    dryRun: str('ADS_DRY_RUN', '') === '1' || str('ADS_DRY_RUN', '').toLowerCase() === 'true',
    maxBudgetChangePct: num('ADS_MAX_BUDGET_CHANGE_PCT', 20),
    cooldownHours: num('ADS_COOLDOWN_HOURS', 24),
    budgetGovernorDaily: num('ADS_BUDGET_GOVERNOR_DAILY', 0),

    minImpressions: num('ADS_MIN_IMPRESSIONS', 1000),
    minResults: num('ADS_MIN_RESULTS', 5),
    minSpend: num('ADS_MIN_SPEND', 50),

    targetCostPerDm: num('ADS_TARGET_COST_PER_DM', 0),
    maxCandidatesPerRun: num('ADS_MAX_CANDIDATES_PER_RUN', 12),
    resultActionType: str('ADS_RESULT_ACTION_TYPE', 'messaging_conversation_started'),

    debaterModel: str('ADS_DEBATER_MODEL', 'claude-haiku-4-5'),
    judgeModel: str('ADS_JUDGE_MODEL', 'claude-sonnet-4-6'),
  }
}

// Normalised 'act_<id>' form for Graph API paths.
export function actId(cfg: AdsConfig): string {
  const id = cfg.adAccountId.trim()
  return id.startsWith('act_') ? id : `act_${id}`
}

// The feature is enabled only when we can actually reach Meta.
export function adsCouncilEnabled(cfg = getAdsConfig()): boolean {
  return !!cfg.accessToken && !!cfg.adAccountId
}

// Convert RM to Meta minor units (sen). Meta budgets are integers in the
// account's minor currency unit.
export function toMinor(amountRm: number): number {
  return Math.round(amountRm * 100)
}
export function fromMinor(minor: number): number {
  return minor / 100
}
