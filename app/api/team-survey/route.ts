import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/auth/guard'
import { rateLimit, clientIp, tooManyResponse, tooLong } from '@/lib/rate-limit'

function badRequest(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

function isNonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

export async function POST(req: NextRequest) {
  if (!(await rateLimit(`team-survey:${clientIp(req)}`, 10))) return tooManyResponse()

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return badRequest('Invalid JSON')

  const overflow = tooLong({
    full_name: [body.full_name, 120],
    phone: [body.phone, 40],
    email: [body.email, 200],
    instagram_url: [body.instagram_url, 300],
    github_username: [body.github_username, 80],
    telegram_username: [body.telegram_username, 80],
    telegram_id: [body.telegram_id, 40],
    bank_account_name: [body.bank_account_name, 200],
    bank_name: [body.bank_name, 120],
    bank_account_number: [body.bank_account_number, 80],
    company_name: [body.company_name, 200],
    portfolio_url: [body.portfolio_url, 300],
  })
  if (overflow) return badRequest(`${overflow} too long`)

  const required = [
    'full_name', 'phone', 'email', 'instagram_url', 'github_username',
    'telegram_username', 'telegram_id', 'bank_account_name', 'bank_name', 'bank_account_number',
  ] as const
  for (const k of required) {
    if (!isNonEmpty(body[k])) return badRequest(`${k} is required`)
  }

  const payload = {
    full_name: String(body.full_name).trim(),
    phone: String(body.phone).trim(),
    email: String(body.email).trim().toLowerCase(),
    instagram_url: String(body.instagram_url).trim(),
    github_username: String(body.github_username).trim().replace(/^@/, ''),
    telegram_username: String(body.telegram_username).trim(),
    telegram_id: String(body.telegram_id).trim(),
    bank_account_name: String(body.bank_account_name).trim(),
    bank_name: String(body.bank_name).trim(),
    bank_account_number: String(body.bank_account_number).trim(),
    company_name: isNonEmpty(body.company_name) ? String(body.company_name).trim() : null,
    portfolio_url: isNonEmpty(body.portfolio_url) ? String(body.portfolio_url).trim() : null,
  }

  const { error } = await supabaseAdmin.from('team_member_profiles').insert(payload)
  if (error) {
    console.error('[team-survey] insert failed', error)
    return NextResponse.json({ error: 'Could not save your submission. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function GET() {
  const guard = await requireAdmin('GET /api/team-survey')
  if (!guard.ok && guard.response) return guard.response

  const { data, error } = await supabaseAdmin
    .from('team_member_profiles')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ profiles: data ?? [] })
}
