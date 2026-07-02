import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/guard'

export const dynamic = 'force-dynamic'

// Escape user-supplied text before dropping it into the email HTML.
function esc(s: string) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: NextRequest) {
  const g = await requireUser('POST /api/invoice/email'); if (g.response) return g.response

  const body = await req.json().catch(() => ({}))
  const {
    to,
    client_name,
    filename,
    pdf_base64,
    company_name,
    company_email,
    company_phone,
  } = body as {
    to?: string
    client_name?: string
    filename?: string
    pdf_base64?: string
    company_name?: string
    company_email?: string
    company_phone?: string
  }

  if (!to || !EMAIL_RE.test(to)) {
    return NextResponse.json({ ok: false, error: 'A valid recipient email is required.' }, { status: 400 })
  }
  if (!pdf_base64) {
    return NextResponse.json({ ok: false, error: 'Missing invoice PDF.' }, { status: 400 })
  }

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    return NextResponse.json({ ok: false, reason: 'no_key' })
  }

  const companyName = (company_name || 'Oppa-Media').trim() || 'Oppa-Media'
  const clientName = (client_name || 'there').trim() || 'there'
  const file = filename || 'Invoice.pdf'
  // Sender: set INVOICE_FROM_EMAIL (e.g. "Oppa-Media <invoices@oppa-media.com>")
  // if a per-company domain gets verified in Resend. Fallback uses the verified
  // cmoaiconsulting.com finance address (deliverable everywhere) with the
  // company name as display name. (Old fallback was onboarding@resend.dev — the
  // Resend TEST sender, which only delivers to the account owner.)
  const from = process.env.INVOICE_FROM_EMAIL || `${companyName} <finance@cmoaiconsulting.com>`

  const contactLine = [company_email, company_phone]
    .filter((v): v is string => Boolean(v))
    .map(esc)
    .join(' · ')

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;color:#111">
      <div style="margin-bottom:22px">
        <span style="font-weight:900;font-size:20px;background:#ed1c24;color:#fff;padding:4px 9px">OPPA-</span><span style="font-weight:800;font-size:20px;letter-spacing:2px;color:#111;border:2px solid #111;padding:3px 9px;border-left:none">MEDIA</span>
      </div>
      <p style="font-size:15px">Hi <strong>${esc(clientName)}</strong>,</p>
      <p style="font-size:15px;line-height:1.6">Thank you! Please find your invoice attached as a PDF.</p>
      <p style="font-size:15px;line-height:1.6">If you have any questions, just reply to this email.</p>
      <p style="margin-top:26px;font-size:15px;line-height:1.6">Warm regards,<br><strong>${esc(companyName)}</strong>${contactLine ? `<br><span style="color:#555;font-size:13px">${contactLine}</span>` : ''}</p>
    </div>
  `

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from,
        to,
        subject: `Invoice from ${companyName}`,
        html,
        attachments: [{ filename: file, content: pdf_base64 }],
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return NextResponse.json({ ok: false, error: `Resend error (${res.status})`, detail }, { status: 502 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
