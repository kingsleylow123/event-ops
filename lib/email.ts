// Shared email sender (Resend). Two sender identities on the verified
// cmoaiconsulting.com domain:
//   • SUPPORT_FROM — "Kingsley @ Claude Malaysia Community" <support@…> — the
//     DEFAULT for all client-facing comms (receipts, recovery nudges, community).
//     Replies route via Cloudflare Email Routing → claudemalaysiaofficial@gmail.com
//     + an Email Worker mirrors them into EventOps (/api/inbound/support).
//   • FINANCE_FROM — CMOAI Consulting Finance <finance@…> — finance docs only
//     (invoices). Financial sends BCC finance@ so the accountant's archive
//     (Kelvin's team) stays complete — callers pass that BCC explicitly.
// All functions are resilient: on any error they log and return ok:false so
// callers (Telegram handlers) keep working even if email is misconfigured.

import { Resend } from 'resend'

export const FINANCE_EMAIL = process.env.FINANCE_EMAIL || 'finance@cmoaiconsulting.com'
export const FINANCE_FROM = process.env.EMAIL_FROM || `CMOAI Consulting Finance <${FINANCE_EMAIL}>`
export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@cmoaiconsulting.com'
// Display name contains "@" → must be quoted per RFC 5322.
export const SUPPORT_FROM = process.env.EMAIL_FROM_SUPPORT || `"Kingsley @ Claude Malaysia Community" <${SUPPORT_EMAIL}>`

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
  // Override the sender display/address (must be on a Resend-verified domain).
  // Defaults to SUPPORT_FROM (client-facing); pass FINANCE_FROM for finance docs.
  from?: string
  // BCC is opt-in: financial docs (invoices, receipts) pass FINANCE_EMAIL so the
  // accountant's archive stays complete; marketing/community sends omit it.
  bcc?: string | null
}

export async function sendEmail(input: SendEmailInput): Promise<{ ok: boolean; error?: string }> {
  if (!emailEnabled()) return { ok: false, error: 'RESEND_API_KEY is not set' }
  try {
    const { error } = await resendClient().emails.send(
      {
        from: input.from || SUPPORT_FROM,
        to: input.to,
        bcc: input.bcc ?? undefined,
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

// Shared shell. Defaults to the client-facing Claude Malaysia identity (matches
// SUPPORT_FROM); finance docs (invoices) pass the CMOAI/finance framing.
function shell(body: string, opts?: { brand?: string; footer?: string }): string {
  const brand = opts?.brand ?? 'CLAUDE MALAYSIA'
  const footer = opts?.footer ?? 'Questions? Just reply to this email — it reaches us directly.'
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f5;">
<div style="max-width:560px;margin:24px auto;background:#ffffff;border-radius:8px;overflow:hidden;font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;">
<div style="background:#1a1a1a;padding:20px 28px;">
<span style="color:#ffffff;font-size:16px;font-weight:bold;letter-spacing:0.5px;">${escHtml(brand)}</span>
</div>
<div style="padding:28px;">${body}</div>
<div style="padding:16px 28px;border-top:1px solid #eeeeee;font-size:12px;color:#888888;">
${footer}
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
    {
      brand: 'CMOAI CONSULTING',
      footer: `Questions? Just reply to this email — it reaches our finance team at ${escHtml(FINANCE_EMAIL)}.`,
    },
  )
}

// CashflowOS abandon-cart recovery. Deliberately NOT wrapped in the CMOAI
// finance shell — it's a warm, single-CTA nudge from Kingsley, not a receipt.
export function cashflowosRecoveryEmailHtml(p: { name?: string; checkoutUrl: string }): string {
  const first = escHtml((p.name ?? '').trim().split(/\s+/)[0] || 'there')
  const url = escHtml(p.checkoutUrl)
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f5;">
<div style="max-width:520px;margin:24px auto;background:#ffffff;border-radius:10px;overflow:hidden;font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;">
<div style="padding:32px 28px;">
<p style="font-size:16px;margin:0 0 16px;">Hey ${first},</p>
<p style="font-size:15px;line-height:1.6;margin:0 0 16px;">You started registering for the <b>Cashflow OS 2-Day Challenge</b> (28&ndash;29 July) &mdash; but didn't finish checkout.</p>
<p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Good news: your spot's still open. I'm holding it for you right now.</p>
<p style="font-size:15px;line-height:1.6;margin:0 0 24px;">Come spend 2 days building your cashflow system live, with me walking you through it step by step.</p>
<a href="${url}" style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:15px;font-weight:bold;">Finish my registration &rarr;</a>
<p style="font-size:14px;line-height:1.6;margin:28px 0 0;color:#555555;">See you inside,<br>Kingsley</p>
</div>
<div style="padding:14px 28px;border-top:1px solid #eeeeee;font-size:12px;color:#999999;">
You got this because you started signing up for the Cashflow OS 2-Day Challenge. If that wasn't you, just ignore it.
</div>
</div></body></html>`
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
