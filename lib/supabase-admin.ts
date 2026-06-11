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

// PostgREST caps EVERY response at 1000 rows — .limit(2000) still returns
// 1000, silently. For any table that can exceed 1000 rows (leads, members),
// page through with .range(). `page` must build a FRESH query each call and
// include a stable .order() so pages don't shuffle.
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  max = 20000,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = []
  const SIZE = 1000
  for (let from = 0; from < max; from += SIZE) {
    const to = Math.min(from + SIZE, max) - 1
    const { data, error } = await page(from, to)
    if (error) return { rows, error: error.message }
    rows.push(...(data ?? []))
    if (!data || data.length < to - from + 1) break // exhausted
  }
  return { rows, error: null }
}
