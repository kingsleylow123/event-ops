// Single source of truth for the pre-workshop prep checklist.
// The /start page, prep API, Insights widget, and Jarvis /prep all read from
// here — adding, removing, or renaming a step is a one-file change.

export const PREP_STEP_KEYS = ['1', '2', '3', '4', '5', '6'] as const
export type PrepStepKey = (typeof PREP_STEP_KEYS)[number]

export const PREP_STEP_COUNT = PREP_STEP_KEYS.length

// Full labels (Insights per-step bars)
export const PREP_STEP_LABELS: Record<string, string> = {
  '1': 'Install Claude Code',
  '2': 'Get Claude Pro',
  '3': 'Install dev tools',
  '4': 'Fill survey',
  '5': 'Prepare data',
  '6': 'Show up 9:30am',
}

// Compact labels (Jarvis /prep on Telegram)
export const PREP_STEP_SHORT: Record<string, string> = {
  '1': 'Install',
  '2': 'Pro',
  '3': 'Dev tools',
  '4': 'Survey',
  '5': 'Data',
  '6': '9:30am',
}

export function emptySteps(): Record<string, boolean> {
  return Object.fromEntries(PREP_STEP_KEYS.map(k => [k, false]))
}

export function zeroStepCounts(): Record<string, number> {
  return Object.fromEntries(PREP_STEP_KEYS.map(k => [k, 0]))
}

// ── GLCC variant ────────────────────────────────────────────────────────────
// The 2-day "Go Live Claude Challenge" has a heavier pre-flight than the half-day
// class. The variant is selected per-event via events.config.prep_variant ===
// 'glcc'. Every half-day export above stays byte-for-byte unchanged, so existing
// events (insights, jarvis /prep, digest, /start) behave exactly as before.

export const PREP_VARIANTS = ['halfday', 'glcc'] as const
export type PrepVariant = (typeof PREP_VARIANTS)[number]

export const GLCC_PREP_STEP_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

// Full labels (Insights per-step bars / readiness dashboard)
export const GLCC_PREP_STEP_LABELS: Record<string, string> = {
  '1': 'Install Claude Code (CLI)',
  '2': 'Claude for Chrome',
  '3': 'Claude Pro + API key',
  '4': 'GitHub + project repo',
  '5': 'Supabase project',
  '6': 'Vercel account',
  '7': 'Telegram bot + user ID',
  '8': 'Pick your track',
  '9': 'Bring your data',
}

// Compact labels (Jarvis /prep on Telegram)
export const GLCC_PREP_STEP_SHORT: Record<string, string> = {
  '1': 'Claude Code', '2': 'Chrome', '3': 'Pro+API', '4': 'GitHub', '5': 'Supabase',
  '6': 'Vercel', '7': 'Telegram', '8': 'Track', '9': 'Data',
}

// The 5 vertical tracks — canonical keys MUST match the GLCC coaching enum
// (marketing | finance | sales | proposals | delivery).
export const PREP_TRACKS = [
  { key: 'marketing', label: 'Marketing & Content', emoji: '📣' },
  { key: 'finance', label: 'Finance & Accounting', emoji: '📊' },
  { key: 'sales', label: 'Sales / CRM', emoji: '💰' },
  { key: 'proposals', label: 'Proposals & Invoicing', emoji: '🧾' },
  { key: 'delivery', label: 'Client / Project Delivery', emoji: '📦' },
] as const
export type PrepTrackKey = (typeof PREP_TRACKS)[number]['key']

// Variant-aware accessors — pass events.config.prep_variant.
export function getPrepStepKeys(variant?: string | null): readonly string[] {
  return variant === 'glcc' ? GLCC_PREP_STEP_KEYS : PREP_STEP_KEYS
}
export function getPrepStepLabels(variant?: string | null): Record<string, string> {
  return variant === 'glcc' ? GLCC_PREP_STEP_LABELS : PREP_STEP_LABELS
}
export function emptyStepsFor(variant?: string | null): Record<string, boolean> {
  return Object.fromEntries(getPrepStepKeys(variant).map(k => [k, false]))
}
export function zeroStepCountsFor(variant?: string | null): Record<string, number> {
  return Object.fromEntries(getPrepStepKeys(variant).map(k => [k, 0]))
}

// Suggested API-ready tools per track (the "Pick your track" step shows these as
// chips so the participant prepares ONE tool that has API access).
export const PREP_TRACK_TOOLS: Record<PrepTrackKey, string[]> = {
  marketing: ['Meta Ads', 'Google Analytics', 'Mailchimp'],
  finance: ['Xero', 'QuickBooks', 'Stripe'],
  sales: ['HubSpot', 'Pipedrive', 'GoHighLevel'],
  proposals: ['Stripe', 'Xero', 'PandaDoc'],
  delivery: ['Notion', 'ClickUp', 'Asana'],
}

// The ONE Claude Code "setup co-pilot" prompt. After a participant installs Claude
// Code (step 1), they copy this and paste it into Claude Code, and it walks them
// through the rest of the signups conversationally. Safe by design: it explicitly
// tells Claude never to ask for secrets in the chat.
export const GLCC_SETUP_PROMPT = `You are my friendly setup co-pilot for the "Go Live Claude Challenge" — a 2-day Claude for Operations workshop. I'm a beginner. Walk me through getting fully set up, ONE step at a time, and wait for me to say "done" before moving to the next. Be warm, plain-English, and encouraging. IMPORTANT: never ask me to paste any password or API key into this chat — whenever I get one, remind me to save it straight into a password manager instead.

First, check my tools work: run \`claude --version\` and \`node -v\` in the terminal and tell me if both print a version. If either fails, help me fix it before we go on.

Then guide me through each of these one at a time — give me the exact link, tell me what to click, and wait for my "done":
1. Claude Pro — subscribe at claude.com/pricing (the Free plan can't run Claude Code).
2. Anthropic API key — console.anthropic.com -> Settings -> API Keys -> Create Key. Remind me to save it in my password manager, then go to Billing and load USD $5 (about RM23) of credit with a low spend cap.
3. GitHub — create a free account at github.com/signup, then open our starter at github.com/claude-malaysia-glcc/glcc-ops-starter, click "Use this template" → "Create a new repository", name it glcc-ops, and keep it Public.
4. Supabase — create a free account at supabase.com, make ONE empty project, set + SAVE the database password, and pick the Singapore region.
5. Vercel — sign up at vercel.com using "Continue with GitHub".
6. Telegram bot — message @BotFather, send /newbot, and save the token in my password manager. Then message @userinfobot, tap Start, and save the number it gives me (my Telegram user ID).

Keep a running checklist of what I've finished. When all six are done, confirm I'm "GLCC-ready" and tell me to go tick the boxes on my workshop checklist page. If I get stuck on any step, slow down and help me through it.`
