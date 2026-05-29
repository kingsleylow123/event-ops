import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

async function notifyAdmin(userEmail: string) {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) return

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: 'EventOps <onboarding@resend.dev>',
        to: 'wowo.vs.wawa@gmail.com',
        subject: 'New user signup — approval needed',
        html: `
          <p>A new user has signed up and is awaiting approval.</p>
          <p><strong>Email:</strong> ${userEmail}</p>
          <p>
            <a href="https://event-ops-six.vercel.app/admin">
              Review and approve in EventOps Admin →
            </a>
          </p>
        `,
      }),
    })
  } catch {
    // Non-fatal — approval still works, admin badge still shows count
  }
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') || '/'

  if (code) {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      const userEmail = data.user?.email
      if (userEmail) {
        // Check if this user's approval row is brand-new (pending) — if so, notify admin
        const { data: approval } = await supabase
          .from('user_approvals')
          .select('status, decided_at')
          .eq('email', userEmail.toLowerCase())
          .maybeSingle()

        // Only send notification for genuinely new pending signups (no decided_at = never processed)
        if (approval?.status === 'pending' && !approval.decided_at) {
          await notifyAdmin(userEmail)
        }
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=unauthorized`)
}
