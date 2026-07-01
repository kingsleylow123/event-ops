// Shared email sender (Resend) — used by Jarvis invoice emails and attendee
// receipts. Every send BCCs the finance mailbox so the accountant's archive
// (finance@cmoaiconsulting.com, Kelvin's team) stays complete automatically.
// All functions are resilient: on any error they log and return ok:false so
// callers (Telegram handlers) keep working even if email is misconfigured.

import { Resend } from 'resend'

const FINANCE_EMAIL = process.env.FINANCE_EMAIL || 'finance@cmoaiconsulting.com'
const EMAIL_FROM = process.env.EMAIL_FROM || `CMOAI Consulting Finance <${FINANCE_EMAIL}>`

// Lazy client — constructing without a key at import time would break
// `next build` page-data collection where the env isn't set.
let _resend: Resend | null = null
function resendClient(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY)
  return _resend
}

export function emailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

export interface EmailAttachment {
  filename: string
  content: Buffer
}

export interface SendEmailInput {
  to: string
  subject: string
  html: string
  attachments?: EmailAttachment[]
  // Stable key for a logical send. Resend dedupes identical keys for 24h, so a
  // retried invoice/receipt (admin re-run, reconcile re-run, stamp-write
  // failure, overlapping confirmations) never double-delivers to the client.
  idempotencyKey?: string
}

export async function sendEmail(input: SendEmailInput): Promise<{ ok: boolean; error?: string }> {
  if (!emailEnabled()) return { ok: false, error: 'RESEND_API_KEY is not set' }
  try {
    const { error } = await resendClient().emails.send(
      {
        from: EMAIL_FROM,
        to: input.to,
        bcc: FINANCE_EMAIL,
        subject: input.subject,
        html: input.html,
        attachments: input.attachments?.map(a => ({ filename: a.filename, content: a.content })),
      },
      input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
    )
    if (error) {
      console.error('[email] send failed', error)
      return { ok: false, error: error.message }
    }
    return { ok: true }
  } catch (e) {
    console.error('[email] send threw', e)
    return { ok: false, error: e instanceof Error ? e.message : 'unknown error' }
  }
}

// ── Templates ─────────────────────────────────────────────────────────────────

const escHtml = (v: unknown) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const rm = (n: number) => 'RM ' + n.toLocaleString('en-MY', { minimumFractionDigits: 2 })

function shell(body: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f5;">
<div style="max-width:560px;margin:24px auto;background:#ffffff;border-radius:8px;overflow:hidden;font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;">
<div style="background:#1a1a1a;padding:20px 28px;">
<span style="color:#ffffff;font-size:16px;font-weight:bold;letter-spacing:0.5px;">CMOAI CONSULTING</span>
</div>
<div style="padding:28px;">${body}</div>
<div style="padding:16px 28px;border-top:1px solid #eeeeee;font-size:12px;color:#888888;">
Questions? Just reply to this email — it reaches our finance team at ${escHtml(FINANCE_EMAIL)}.
</div>
</div></body></html>`
}

export function invoiceEmailHtml(p: { clientName: string; amount: number; description: string }): string {
  return shell(
    `<p style="font-size:15px;">Hi ${escHtml(p.clientName)},</p>
<p style="font-size:15px;">Please find your invoice attached.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
<tr><td style="padding:10px 0;border-bottom:1px solid #eeeeee;">${escHtml(p.description)}</td>
<td style="padding:10px 0;border-bottom:1px solid #eeeeee;text-align:right;font-weight:bold;">${rm(p.amount)}</td></tr>
</table>
<p style="font-size:15px;">Thank you for your business.</p>`,
  )
}

export function receiptEmailHtml(p: { name: string; amount: number; eventName: string; paidAt: Date }): string {
  const date = p.paidAt.toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' })
  return shell(
    `<p style="font-size:15px;">Hi ${escHtml(p.name)},</p>
<p style="font-size:15px;">We've received your payment — you're confirmed. 🎉</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
<tr><td style="padding:8px 0;color:#888888;">Event</td><td style="padding:8px 0;text-align:right;">${escHtml(p.eventName)}</td></tr>
<tr><td style="padding:8px 0;color:#888888;">Amount received</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${rm(p.amount)}</td></tr>
<tr><td style="padding:8px 0;color:#888888;">Date</td><td style="padding:8px 0;text-align:right;">${date}</td></tr>
</table>
<p style="font-size:15px;">See you there!</p>`,
  )
}
