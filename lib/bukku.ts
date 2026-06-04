// Bukku accounting API client (https://developers.bukku.my)
// Thin fetch wrapper. Safe to import even when not configured — calls only
// happen through the exported functions, which throw a clear error if disabled.

const TOKEN = process.env.BUKKU_API_TOKEN || ''
const SUBDOMAIN = process.env.BUKKU_SUBDOMAIN || ''
// Default to STAGING so we never accidentally hit production books before ready.
const BASE_URL = process.env.BUKKU_BASE_URL || 'https://api.bukku.fyi'

export function bukkuEnabled(): boolean {
  return process.env.BUKKU_ENABLED === 'true' && !!TOKEN && !!SUBDOMAIN
}

export function bukkuStatus() {
  return {
    enabled: bukkuEnabled(),
    subdomain: SUBDOMAIN || null,
    base_url: BASE_URL,
    is_production: BASE_URL.includes('api.bukku.my'),
  }
}

class BukkuError extends Error {}

async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Record<string, unknown>> {
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
    throw new BukkuError(`Bukku ${method} ${path} → ${res.status}: ${text.slice(0, 500)}`)
  }
  return text ? JSON.parse(text) : {}
}

// Pull an id out of common Bukku response shapes.
function extractId(resp: Record<string, unknown>): string {
  const r = resp as { id?: unknown; data?: { id?: unknown }; contact?: { id?: unknown }; bill?: { id?: unknown } }
  const id = r.id ?? r.data?.id ?? r.contact?.id ?? r.bill?.id
  return id != null ? String(id) : ''
}

// ── Contacts ───────────────────────────────────────────────────────────────────
export async function upsertContact(c: { name: string; phone?: string; email?: string; bank_account?: string }): Promise<string> {
  // Try to find an existing contact by name first (Bukku supports ?search=)
  try {
    const found = await call('GET', `/contacts?search=${encodeURIComponent(c.name)}`)
    const list = (found.data ?? found.contacts ?? found) as Array<{ id?: unknown; name?: string }>
    if (Array.isArray(list)) {
      const match = list.find(x => (x.name ?? '').trim().toLowerCase() === c.name.trim().toLowerCase())
      if (match?.id != null) return String(match.id)
    }
  } catch {
    // search not critical — fall through to create
  }
  const created = await call('POST', '/contacts', {
    name: c.name,
    is_supplier: true,
    phone: c.phone || undefined,
    email: c.email || undefined,
    // bank info surfaced when present; non-blocking
    bank_account_no: c.bank_account || undefined,
  })
  return extractId(created)
}

// ── Purchases: Bill (affiliate payout payable) ──────────────────────────────────
export async function createBill(b: {
  contact_id: string; date: string; number: string; description: string; amount: number; account_code?: string
}): Promise<string> {
  const resp = await call('POST', '/purchases/bills', {
    contact_id: b.contact_id,
    number: b.number,
    date: b.date,
    items: [
      {
        description: b.description,
        quantity: 1,
        unit_price: b.amount,
        account_code: b.account_code || undefined,
      },
    ],
  })
  return extractId(resp)
}

// ── Banking: Income (ticket revenue) ────────────────────────────────────────────
export async function createIncome(i: {
  date: string; description: string; amount: number; account_code?: string
}): Promise<string> {
  const resp = await call('POST', '/banking/incomes', {
    date: i.date,
    items: [
      { description: i.description, amount: i.amount, account_code: i.account_code || undefined },
    ],
  })
  return extractId(resp)
}

// ── Banking: Expense (event cost) ───────────────────────────────────────────────
export async function createExpense(e: {
  date: string; description: string; amount: number; category?: string; account_code?: string
}): Promise<string> {
  const resp = await call('POST', '/banking/expenses', {
    date: e.date,
    items: [
      { description: e.description, amount: e.amount, account_code: e.account_code || undefined },
    ],
  })
  return extractId(resp)
}
