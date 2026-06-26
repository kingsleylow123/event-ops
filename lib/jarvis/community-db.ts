import { createClient } from '@supabase/supabase-js'

// Second Supabase client — the Claude Malaysia COMMUNITY database (a different
// project than EventOps), home of the community join survey (community_members).
// EventOps/Jarvis is wired to the EventOps project; this is the only path to the
// community survey. Disabled (null) until the service-role key is configured, so
// the tool fails gracefully instead of breaking the build/runtime.
const url = process.env.CONTENT_SUPABASE_URL || 'https://wdkljqckvhzovnzkmisg.supabase.co'
const key = process.env.CONTENT_SUPABASE_SERVICE_ROLE_KEY

export const communityEnabled = (): boolean => !!key

export const communityDb = key
  ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  : null
