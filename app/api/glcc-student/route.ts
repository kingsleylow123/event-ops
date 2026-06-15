import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { requireUser } from '@/lib/auth/guard'
import { rateLimit, clientIp, tooManyResponse } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

// Shared per-cohort token. Each opted-in student repo sets this same value as a
// GitHub Actions secret (GLCC_TOKEN) during the Day-2 opt-in ritual; the
// phone-home workflow sends it in the X-GLCC-Token header. Fail CLOSED if unset.
function tokenOk(supplied: string | null | undefined): boolean {
  const expected = process.env.GLCC_TOKEN
  return !!expected && !!supplied && supplied === expected
}

function looksLikeRepo(url: unknown): url is string {
  return typeof url === 'string' && /^https:\/\/github\.com\/[^/]+\/[^/]+/.test(url)
}

// POST (public, token-gated): the opt-in phone-home from a student's repo.
// Stores METADATA ONLY — name, vertical, repo URL, live URL, last deploy time.
// Never business data (that stays in the student's own Supabase + gitignored .env).
export async function POST(req: NextRequest) {
  if (!(await rateLimit(`glcc-student:${clientIp(req)}`, 30))) return tooManyResponse()
  if (!tokenOk(req.headers.get('x-glcc-token'))) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: NO_STORE })
  }

  const body = await req.json().catch(() => ({}))
  const { name, vertical, repoUrl, vercelUrl, lastDeploy } = body as {
    name?: string; vertical?: string; repoUrl?: string; vercelUrl?: string; lastDeploy?: string
  }
  if (!looksLikeRepo(repoUrl)) {
    return NextResponse.json({ ok: false, error: 'valid repoUrl required' }, { status: 400, headers: NO_STORE })
  }

  const row = {
    repo_url: repoUrl.replace(/\.git$/, '').replace(/\/$/, ''),
    name: typeof name === 'string' ? name.trim().slice(0, 120) || null : null,
    vertical: typeof vertical === 'string' ? vertical.trim().slice(0, 40) || null : null,
    vercel_url: typeof vercelUrl === 'string' ? vercelUrl.trim().slice(0, 300) || null : null,
    last_deploy: typeof lastDeploy === 'string' && lastDeploy.trim() ? lastDeploy.trim() : null,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('glcc_students')
    .upsert(row, { onConflict: 'repo_url' })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: NO_STORE })
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}

// GET: the build registry. Two ways in —
//   • ?token=<GLCC_TOKEN>  → for the nightly backup script (headless, no cookie)
//   • a logged-in approved admin → for the Insights dashboard
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const viaToken = tokenOk(searchParams.get('token'))
  if (!viaToken) {
    const g = await requireUser('GET /api/glcc-student'); if (g.response) return g.response
  }

  const { data, error } = await supabase
    .from('glcc_students')
    .select('name, vertical, repo_url, vercel_url, last_deploy, updated_at')
    .order('updated_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })

  const students = (data ?? []).map(r => ({
    name: r.name, vertical: r.vertical, repoUrl: r.repo_url,
    vercelUrl: r.vercel_url, lastDeploy: r.last_deploy, updatedAt: r.updated_at,
  }))
  return NextResponse.json({ count: students.length, students }, { headers: NO_STORE })
}
