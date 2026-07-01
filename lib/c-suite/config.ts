// AI C-Suite — configuration. Every knob comes from env so nothing is hard-coded.
// Defaults: Opus manager (the grilling), Sonnet heads. Per-head overrides let you
// run a cheap night (Haiku heads) vs a boardroom night (Sonnet heads / Opus mgr).
//
// Auth: prefers CLAUDE_CODE_OAUTH_TOKEN (your Claude Max subscription — Opus is
// "free" within your limits) and falls back to ANTHROPIC_API_KEY. Set the OAuth
// token in env to bill against your subscription instead of the API. (Validate on
// Hermes first — headless OAuth tokens can 401 after ~15 min of continuous use.)

import type { Dept } from './types'

function str(name: string, dflt = ''): string {
  return process.env[name] ?? dflt
}
function num(name: string, dflt: number): number {
  const v = process.env[name]
  const n = v == null ? NaN : Number(v)
  return Number.isFinite(n) ? n : dflt
}
function bool(name: string): boolean {
  const v = str(name, '')
  return v === '1' || v.toLowerCase() === 'true'
}

export type AuthMode = 'oauth' | 'apikey' | 'none'

export function authMode(): AuthMode {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return 'oauth'
  if (process.env.ANTHROPIC_API_KEY) return 'apikey'
  return 'none'
}

export interface CSuiteConfig {
  managerModel: string
  headModel: string
  perHeadModel: Record<Dept, string>
  debateRounds: number          // max rebuttal rounds (1 = one challenge + one rewrite)
  maxHeadTokens: number
  maxManagerTokens: number
  dryRun: boolean               // true → never post to Telegram (still deliberates + stores)
}

export function getCSuiteConfig(): CSuiteConfig {
  const headModel = str('HEAD_MODEL', 'claude-sonnet-4-6')
  return {
    managerModel: str('MANAGER_MODEL', 'claude-opus-4-8'),
    headModel,
    perHeadModel: {
      sales: str('SALES_MODEL', headModel),
      ops: str('OPS_MODEL', headModel),
      finance: str('FINANCE_MODEL', headModel),
      marketing: str('MARKETING_MODEL', headModel),
    },
    debateRounds: Math.max(1, Math.min(3, num('C_SUITE_DEBATE_ROUNDS', 1))),
    maxHeadTokens: num('C_SUITE_MAX_HEAD_TOKENS', 700),
    maxManagerTokens: num('C_SUITE_MAX_MANAGER_TOKENS', 1500),
    dryRun: bool('C_SUITE_DRY_RUN'),
  }
}

// The feature is enabled only when we can actually reach a model + write to Supabase.
export function cSuiteEnabled(): boolean {
  return authMode() !== 'none' && !!process.env.SUPABASE_SERVICE_ROLE_KEY
}
