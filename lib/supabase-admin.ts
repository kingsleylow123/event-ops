import { createClient } from '@supabase/supabase-js'

// Server-only service-role client. Bypasses RLS, so guarded API routes keep
// working after RLS is enabled on the tables. NEVER import this in client code.
// Falls back to the anon key if the service role isn't set yet (pre-rollout),
// so behavior is unchanged until SUPABASE_SERVICE_ROLE_KEY is configured.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co'
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  'placeholder-key'

export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
