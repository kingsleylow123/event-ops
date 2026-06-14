// Shared contract for the Finance dashboard (/finance + /api/finance/dashboard).
// Pure types + helpers only — safe to import on both server and client.

export type Row = { category: string; amount: number }

export type AgingBuckets = {
  upcoming: number
  d1_30: number
  d31_60: number
  d61_90: number
  d91_plus: number
}

export type DailyPoint = {
  label: string // "07 Jun"
  income: number
  costs: number
  net: number // income - costs
  cumulative: number // ending cash balance that day
}

export type ForecastPoint = {
  label: string
  balance: number
  projected: boolean
}

export type SaleRow = {
  ref: string // synthesized invoice ref, e.g. "IV-00012"
  date: string // "11/06/2026"
  label: string // customer / attendee name
  amount: number
}

export type Breakdowns = {
  income: { d7: Row[]; d14: Row[]; d30: Row[] }
  expense: { d7: Row[]; d14: Row[]; d30: Row[] }
}

export type DashboardData = {
  scope: string // 'all' | event id
  scope_label: string
  kpis: {
    cash_on_hand: number
    outstanding_invoices: number
    invoices_due: number // pending, age < 30d
    invoices_overdue: number // pending, age >= 30d
    bills_due: number
    bills_overdue: number
  }
  aging: { invoices: AgingBuckets; bills: AgingBuckets }
  daily: DailyPoint[] // last 30 days, chronological
  forecast: ForecastPoint[] // next 14 days
  recent_sales: SaleRow[]
  breakdowns: Breakdowns
}

export const r2 = (n: number) => Math.round(n * 100) / 100

export function rm(n: number, hidden = false): string {
  if (hidden) return 'RM ••••••'
  return `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Sum a window of the most recent `days` daily points → {income, costs, net}.
export function windowSum(daily: DailyPoint[], days: number) {
  const slice = daily.slice(-days)
  const income = r2(slice.reduce((s, d) => s + d.income, 0))
  const costs = r2(slice.reduce((s, d) => s + d.costs, 0))
  return { income, costs, net: r2(income - costs) }
}

// Group dated, categorised rows into sorted line items.
export function groupByCategory(rows: { category?: string | null; amount?: number | null }[]): Row[] {
  const m = new Map<string, number>()
  for (const r of rows) {
    const cat = (r.category || 'Other').trim() || 'Other'
    m.set(cat, (m.get(cat) ?? 0) + Number(r.amount ?? 0))
  }
  return [...m.entries()]
    .map(([category, amount]) => ({ category, amount: r2(amount) }))
    .sort((a, b) => b.amount - a.amount)
}
