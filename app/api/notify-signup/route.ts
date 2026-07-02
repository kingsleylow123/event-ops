import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { email } = body as { email?: string }

  if (!email) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    return NextResponse.json({ ok: false, reason: 'no_key' })
  }

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        // Verified-domain sender (onboarding@resend.dev only delivers to the
        // Resend account owner, so these were unreliable before).
        from: 'EventOps <support@cmoaiconsulting.com>',
        to: 'wowo.vs.wawa@gmail.com',
        subject: `New user request — ${email}`,
        html: `
          <div style="font-family:sans-serif;max-width:480px">
            <h2 style="color:#f59e0b">EventOps — New User Request</h2>
            <p><strong>${email}</strong> has created an account and is waiting for your approval.</p>
            <a href="https://event-ops-six.vercel.app/admin"
              style="display:inline-block;margin-top:16px;padding:10px 20px;background:#f59e0b;color:#000;font-weight:bold;border-radius:8px;text-decoration:none">
              Review &amp; Approve →
            </a>
          </div>
        `,
      }),
    })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false })
  }
}
