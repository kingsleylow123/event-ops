// Per-event content config — links, setup-video IDs, venue copy — stored in
// events.config (jsonb). Anything unset falls back to the Claude Malaysia
// defaults below, so existing events behave exactly as before and a brand-new
// event works with zero config.

export interface EventConfig {
  whatsapp_group_url: string // community invite (survey thank-you button)
  instagram_url: string
  instagram_handle: string
  mac_video_id: string // YouTube — Homebrew install guide (Mac)
  windows_video_id: string // YouTube — Git install guide (Windows)
  docs_url: string // step-by-step installation doc
  venue_video_id: string // venue tour / how-to-find-us video
  venue_label: string // short venue name used in countdown + copy
  date_label?: string // overrides the auto-formatted date pill (e.g. "20–21 June")
  time_label?: string // overrides the default time pill (e.g. "9:30am–6pm")
  // ── GLCC (2-day) variant — all optional; unset ⇒ half-day behavior ──
  prep_variant?: 'halfday' | 'glcc' // 'glcc' switches /start to the 2-day pre-flight
  template_repo_url?: string // "Use this template" link for the org starter (→ <username>/glcc-ops)
  coach_github?: string // GitHub username participants add as a Read collaborator (coaching + backup)
  glcc_video_install?: string // YouTube — install Claude Code CLI
  glcc_video_keys?: string // YouTube — Claude Pro + Anthropic API key
  glcc_video_github?: string // YouTube — GitHub + copy the starter template
  glcc_video_supabase?: string // YouTube — create a Supabase project
  glcc_video_vercel?: string // YouTube — create a Vercel account
  glcc_video_telegram?: string // YouTube — Telegram bot + your user ID
  glcc_video_data?: string // YouTube — gh login + prepare your data
  // ONE A-Z master video pinned at the top, with per-step timestamp jumps
  // (seconds, stored as strings). Each step links to youtu.be/<id>?t=<seconds>.
  glcc_video_master?: string // YouTube ID of the single start-to-finish setup video
  glcc_ts_install?: string // seconds — jump point for the install chapter
  glcc_ts_chrome?: string // seconds — Claude for Chrome chapter
  glcc_ts_keys?: string // seconds — Claude Pro + API key chapter
  glcc_ts_github?: string // seconds — GitHub + starter-template chapter
  glcc_ts_supabase?: string // seconds — Supabase chapter
  glcc_ts_vercel?: string // seconds — Vercel chapter
  glcc_ts_telegram?: string // seconds — Telegram chapter
  glcc_ts_data?: string // seconds — bring-your-data chapter
  // Per-step Loom walkthrough videos (just the Loom embed ID). If set for a step,
  // the checklist embeds that video instead of the master-video timestamp link.
  glcc_loom_install?: string
  glcc_loom_chrome?: string
  glcc_loom_keys?: string
  glcc_loom_github?: string
  glcc_loom_supabase?: string
  glcc_loom_vercel?: string
  glcc_loom_telegram?: string
  glcc_loom_track?: string
  glcc_loom_data?: string
  glcc_loom_orgchart?: string
}

export const DEFAULT_EVENT_CONFIG: EventConfig = {
  whatsapp_group_url: 'https://chat.whatsapp.com/GSONh9iwgvPIYDV16fOALM?s=cl&p=i&ilr=1&amv=1',
  instagram_url: 'https://www.instagram.com/claudemalaysiaofficial/',
  instagram_handle: '@claudemalaysiaofficial',
  mac_video_id: 'X57PTQR45Ps',
  windows_video_id: 'XvBxfupKpgg',
  docs_url: 'https://docs.google.com/document/d/1-cKqYXB2loZFGbhEFpUDKdrMwTVt5VATFXFbFiSTqeU/edit',
  venue_video_id: 'NeTd4AAxTrY',
  venue_label: 'CO3 Puchong',
}

export function resolveEventConfig(raw?: Partial<EventConfig> | null): EventConfig {
  const clean = Object.fromEntries(
    Object.entries(raw ?? {}).filter(([, v]) => typeof v === 'string' && v.trim() !== ''),
  )
  return { ...DEFAULT_EVENT_CONFIG, ...clean }
}
