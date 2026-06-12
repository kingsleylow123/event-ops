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
