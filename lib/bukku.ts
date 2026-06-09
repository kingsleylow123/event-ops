// Bukku accounting API client — https://api.bukku.my  (Open API)
//
// Rewritten against the REAL Bukku schema, verified live against the `cmmy`
// production books (June 2026). The previous version used guessed field names
// (`items`, `name`, `is_supplier`, `/banking/incomes`) that the API rejects.
//
// Real shapes (the parts that bit us):
//   • Sales/purchase transactions use `form_items` (NOT `items`), and require
//     `currency_code`, `exchange_rate`, `tax_mode`, `payment_mode`, `status`.
//   • Credit transactions also require `term_items` (the payment schedule).
//   • Contacts require `legal_name`, `types: ["customer"|"supplier"]`, `entity_type`.
//   • Line items post to a leaf `account_id` from the chart of accounts (/accounts).
//
// Safe to import even when not configured — calls only happen through the
// exported functions, which throw a clear error if Bukku is disabled.

const TOKEN = process.env.BUKKU_API_TOKEN || ''
// Subdomain + base URL are NOT secrets (the subdomain is literally inside the
// token's issuer URL), so they default here. That means the ONLY thing the
// deployment environment needs is the secret BUKKU_API_TOKEN — safe for this
// public repo. Override either via env vars if you ever switch company/staging.
const SUBDOMAIN = process.env.BUKKU_SUBDOMAIN || 'cmmy'
const BASE_URL = process.env.BUKKU_BASE_URL || 'https://api.bukku.my'

export function bukkuEnabled(): boolean {
  // On as soon as the API token is present (subdomain/base have safe defaults).
  return !!TOKEN && !!SUBDOMAIN
}

export function bukkuStatus() {
  return {
    enabled: bukkuEnabled(),
    subdomain: SUBDOMAIN || null,
    base_url: BASE_URL,
    is_production: BASE_URL.includes('api.bukku.my'),
  }
}

// ── Chart of accounts ──────────────────────────────────────────────────────────
// Verified leaf-account ids in the cmmy production books. If you re-create the
// company or edit the chart of accounts, refresh these via GET /accounts.
export const ACCOUNTS = {
  revenue: 20, // 5000 Sales Income  — workshop / ticket revenue
  discount: 21, // 5001 Discount Given
  bank: 3, // 1000-01 Bank Account — where receipts land
  cashOnHand: 2, // 1000-00 Cash on Hand
  undepositedFunds: 6, // 1003 Undeposited Funds
  accountsReceivable: 4, // 1001 Accounts Receivable
  accountsPayable: 9, // 3001 Accounts Payable
  affiliateCommission: 36, // 6511 Advertising & Promotion (referral marketing)
} as const

// Our expense categories → Bukku expense account id. Used by the expenses flow.
export const EXPENSE_ACCOUNT_BY_CATEGORY: Record<string, number> = {
  Venue: 41, // 6516 Rent Expense
  'F&B': 44, // 6519 Meal & Entertainment
  'Speaker fees': 40, // 6515 Accounting & Other Professional Fees
  Marketing: 36, // 6511 Advertising & Promotion
  'Equipment / AV': 33, // 6508 General Expense
  Content: 36, // 6511 Advertising & Promotion
  Logistics: 45, // 6520 Travel Expense
  Other: 33, // 6508 General Expense
}

// Bukku validates monetary/decimal fields as STRINGS ("must be a string"),
// not numbers. Always send amounts via money().
const MYR = { currency_code: 'MYR', exchange_rate: '1' } as const
function money(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2)
}

class BukkuError extends Error {}

type Json = Record<string, unknown>

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<Json> {
  if (!bukkuEnabled()) throw new BukkuError('Bukku not configured')
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Company-Subdomain': SUBDOMAIN,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const text = await res.text()
  if (res.status < 200 || res.status >= 300) {
    throw new BukkuError(`Bukku ${method} ${path} → ${res.status}: ${text.slice(0, 800)}`)
  }
  return text ? (JSON.parse(text) as Json) : {}
}

// Pull an id out of Bukku's various response envelopes.
function pickId(resp: Json): string {
  const r = resp as {
    id?: unknown
    data?: { id?: unknown }
    contact?: { id?: unknown }
    transaction?: { id?: unknown }
    bill?: { id?: unknown }
  }
  const id = r.id ?? r.transaction?.id ?? r.contact?.id ?? r.bill?.id ?? r.data?.id
  if (id == null) throw new BukkuError(`Bukku response had no id: ${JSON.stringify(resp).slice(0, 300)}`)
  return String(id)
}

function pickTransaction(resp: Json): { id: string; number: string | null } {
  const t = (resp.transaction ?? resp.data ?? resp) as { id?: unknown; number?: unknown }
  return { id: String(t.id ?? pickId(resp)), number: t.number != null ? String(t.number) : null }
}

// ── Accounts ────────────────────────────────────────────────────────────────────
export async function listAccounts(): Promise<Json> {
  return call('GET', '/accounts')
}

// ── Contacts ────────────────────────────────────────────────────────────────────
export type ContactType = 'customer' | 'supplier'

export async function findOrCreateContact(c: {
  name: string
  types?: ContactType[]
  email?: string
  phone?: string
  entity_type?: string
  reg_no?: string
  bank_account_no?: string
}): Promise<string> {
  const name = c.name.trim()
  const types = c.types ?? ['customer']

  // Try to reuse an existing contact by exact display/legal name.
  try {
    const found = await call('GET', `/contacts?search=${encodeURIComponent(name)}&limit=25`)
    const list = (found.contacts ?? found.data ?? []) as Array<{ id?: unknown; legal_name?: string; display_name?: string }>
    if (Array.isArray(list)) {
      const lc = name.toLowerCase()
      const match = list.find(
        x => (x.display_name ?? '').trim().toLowerCase() === lc || (x.legal_name ?? '').trim().toLowerCase() === lc,
      )
      if (match?.id != null) return String(match.id)
    }
  } catch {
    // search not critical — fall through to create
  }

  const created = await call('POST', '/contacts', {
    legal_name: name,
    types,
    entity_type: c.entity_type ?? 'GENERAL_PUBLIC',
    email: c.email || undefined,
    phone_no: c.phone || undefined,
    reg_no: c.reg_no || undefined,
    bank_account_no: c.bank_account_no || undefined,
  })
  return pickId(created)
}

// ── Sales invoice ────────────────────────────────────────────────────────────────
export type BukkuLine = { description: string; quantity: number; unit_price: number; account_id?: number }

function formItems(lines: BukkuLine[]) {
  return lines.map(l => ({
    account_id: l.account_id ?? ACCOUNTS.revenue,
    description: l.description,
    quantity: money(l.quantity),
    unit_price: money(l.unit_price),
  }))
}

function lineTotal(lines: BukkuLine[]): number {
  return Math.round(lines.reduce((s, l) => s + l.quantity * l.unit_price, 0) * 100) / 100
}

/**
 * Create a sales invoice (a receivable). Default is a CREDIT invoice with a
 * single payment term — the correct model for an invoice you send a client.
 * Pass `paid: true` for an instant cash sale (e.g. summarised ticket revenue),
 * which books straight to the bank account with no open balance.
 */
export async function createSalesInvoice(inv: {
  contact_id: string | number
  date: string // YYYY-MM-DD
  lines: BukkuLine[]
  paid?: boolean
  due_date?: string // for credit; defaults to date + 7 days
  status?: 'ready' | 'draft'
  number?: string
}): Promise<{ id: string; number: string | null }> {
  const status = inv.status ?? 'ready'
  const base = {
    contact_id: Number(inv.contact_id),
    date: inv.date,
    ...MYR,
    tax_mode: 'exclusive', // not SST-registered → lines carry no tax
    status,
    form_items: formItems(inv.lines),
    ...(inv.number ? { number: inv.number } : {}),
  }

  if (inv.paid) {
    // Cash transactions take the bank account nested in deposit_items (the same
    // shape payments use), NOT a top-level deposit_account_id.
    const resp = await call('POST', '/sales/invoices', {
      ...base,
      payment_mode: 'cash',
      deposit_items: [{ account_id: ACCOUNTS.bank, amount: money(lineTotal(inv.lines)) }],
    })
    return pickTransaction(resp)
  }

  const due = inv.due_date ?? addDays(inv.date, 7)
  const resp = await call('POST', '/sales/invoices', {
    ...base,
    payment_mode: 'credit',
    term_items: [{ date: due, payment_due: money(lineTotal(inv.lines)) }],
  })
  return pickTransaction(resp)
}

/** Record a customer payment (e.g. a deposit) against an existing invoice. */
export async function recordSalesPayment(p: {
  contact_id: string | number
  date: string
  amount: number
  invoice_id: string | number
  status?: 'ready' | 'draft'
}): Promise<string> {
  const amt = money(p.amount)
  const resp = await call('POST', '/sales/payments', {
    contact_id: Number(p.contact_id),
    date: p.date,
    ...MYR,
    amount: amt,
    status: p.status ?? 'ready',
    // Money received into the bank/cash account…
    deposit_items: [{ account_id: ACCOUNTS.bank, amount: amt }],
    // …applied against the outstanding invoice.
    link_items: [{ target_transaction_id: Number(p.invoice_id), apply_amount: amt }],
  })
  return pickId(resp)
}

// ── Purchases: Bill (affiliate payout / event expense payable) ────────────────────
export async function createBill(b: {
  contact_id: string | number
  date: string
  description: string
  amount: number
  account_id?: number
  due_date?: string
  number?: string
}): Promise<{ id: string; number: string | null }> {
  const resp = await call('POST', '/purchases/bills', {
    contact_id: Number(b.contact_id),
    date: b.date,
    ...MYR,
    tax_mode: 'exclusive',
    payment_mode: 'credit',
    status: 'ready',
    term_items: [{ date: b.due_date ?? addDays(b.date, 7), payment_due: money(b.amount) }],
    form_items: [
      { account_id: b.account_id ?? ACCOUNTS.affiliateCommission, description: b.description, quantity: '1', unit_price: money(b.amount) },
    ],
    ...(b.number ? { number: b.number } : {}),
  })
  return pickTransaction(resp)
}

// ── Reports ──────────────────────────────────────────────────────────────────────
// NOTE (flow #5, not wired yet): the Bukku Open API does NOT expose report
// endpoints — every /reports/* path tested returns 404. Pulling P&L back into the
// dashboard will instead mean aggregating from the transaction lists
// (/sales/invoices, /purchases/bills, /sales/payments) by date, or computing
// per-account movement. Left here as a clearly-flagged stub so callers don't
// assume a working report route exists.
export async function getProfitLoss(_date_from: string, _date_to: string): Promise<Json> {
  throw new BukkuError('Bukku Open API exposes no /reports endpoint — compute P&L from transaction lists instead (flow #5, TODO).')
}

// ── Compatibility shims (used by app/api/bukku/sync — ticket-revenue flow) ─────────
// Kept so existing callers compile; both now hit the real API.
export async function upsertContact(c: { name: string; phone?: string; email?: string; bank_account?: string }): Promise<string> {
  return findOrCreateContact({ name: c.name, types: ['customer'], phone: c.phone, email: c.email, bank_account_no: c.bank_account })
}

/** Book already-received revenue to the "Cash Sales" customer: a sales invoice
 * settled in full by an immediate payment. Uses only verified call paths
 * (createSalesInvoice + recordSalesPayment), so it can't hit the cash-deposit
 * edge case. Result in Bukku: a "Ticket sales — …" invoice showing PAID. */
export async function createIncome(i: { date: string; description: string; amount: number; account_id?: number }): Promise<string> {
  const cashSalesContactId = 1 // Bukku seeds a "Cash Sales" contact at id 1
  const { id } = await createSalesInvoice({
    contact_id: cashSalesContactId,
    date: i.date,
    lines: [{ description: i.description, quantity: 1, unit_price: i.amount, account_id: i.account_id ?? ACCOUNTS.revenue }],
  })
  await recordSalesPayment({ contact_id: cashSalesContactId, date: i.date, amount: i.amount, invoice_id: id })
  return id
}

// ── helpers ──────────────────────────────────────────────────────────────────────
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}
