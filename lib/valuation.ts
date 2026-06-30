// Shared contract for the Valuation tab (/valuation + /api/valuation).
// Pure types + scoring/valuation helpers — safe on server and client.
//
// Acts as a "Garry Tan / YC" lens: a stage-tiered scorecard (Startup → Traction
// → IPO-readiness) plus a multi-method, assumption-driven valuation range.
// EventOps supplies the auto metrics (revenue, attendees, funnel, margin); the
// operator supplies cash/burn/ad-spend/ownership as manual assumptions.

import { r2 } from '@/lib/finance'

export type MonthPoint = { ym: string; revenue: number; paid: number }

// Auto metrics computed from EventOps data (returned by /api/valuation).
export type ValuationAuto = {
  scope: string
  scope_label: string
  totalRevenue: number
  costsTotal: number
  netProfit: number
  contributionMargin: number // 0..1
  monthly: MonthPoint[]      // by event-date month, completed months only, chronological
  paidAttendees: number
  totalAttendees: number
  eventsWithSales: number
  leads: number
  meetings: number
  arpa: number               // avg revenue per paid attendee
}

// Operator-supplied assumptions (persisted client-side in localStorage).
export type Assumptions = {
  cashBalance: number
  monthlyBurn: number
  monthlyAdSpend: number
  communitySize: number
  b2bAnnualRevenue: number
  ownershipPct: number          // 0..100
  multipleOverride: number | null // override the revenue-multiple base
}

export type Status = 'great' | 'good' | 'ok' | 'weak' | 'na'
export const STATUS_COLOR: Record<Status, string> = {
  great: '#10b981', good: '#22c55e', ok: '#f59e0b', weak: '#ef4444', na: '#71717a',
}
export const STATUS_LABEL: Record<Status, string> = {
  great: 'Great', good: 'Good', ok: 'OK', weak: 'Weak', na: '—',
}

export type MetricKind = 'money' | 'pct' | 'ratio' | 'num' | 'months' | 'text'
export type MetricRow = {
  key: string
  label: string
  raw: number | null
  display?: string  // for text kind, or a pre-formatted value
  kind: MetricKind
  benchmark: string
  status: Status
  note?: string
}

export type ValuationMethod = {
  name: string
  low: number
  base: number
  high: number
  rationale: string
}

export type Valuation = {
  methods: ValuationMethod[]
  blendedLow: number
  blendedBase: number
  blendedHigh: number
  equityValue: number // blendedBase × ownership%
  arr: number
}

export type Derived = {
  runRate: number
  arr: number
  momGrowth: number | null
  grossMargin: number
  monthlyNetProfit: number
  annualNetProfit: number
  cac: number | null
  ltv: number
  ltvCac: number | null
  ruleOf40: number
  burnMultiple: number | null
  profitable: boolean
  runwayMonths: number | null
  defaultAlive: boolean
  leadToPaid: number
  paidToMeeting: number
  newPaidPerMonth: number
}

export type Scorecard = {
  startup: MetricRow[]
  traction: MetricRow[]
  ipo: MetricRow[]
  derived: Derived
  valuation: Valuation
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// Higher-is-better grade (or lower-is-better when higher=false).
function grade(v: number | null, great: number, good: number, ok: number, higher = true): Status {
  if (v == null || !Number.isFinite(v)) return 'na'
  if (higher) {
    if (v >= great) return 'great'
    if (v >= good) return 'good'
    if (v >= ok) return 'ok'
    return 'weak'
  }
  if (v <= great) return 'great'
  if (v <= good) return 'good'
  if (v <= ok) return 'ok'
  return 'weak'
}

export function computeDerived(auto: ValuationAuto, a: Assumptions): Derived {
  const months = auto.monthly
  const n = months.length

  // Run-rate: average of the last up-to-3 completed months, annualised.
  const recent = months.slice(-3)
  const recentAvg = recent.length ? recent.reduce((s, m) => s + m.revenue, 0) / recent.length : 0
  const runRate = r2(recentAvg * 12)
  const arr = r2(runRate + Math.max(0, a.b2bAnnualRevenue))

  // Latest month-over-month revenue growth (needs ≥2 completed months).
  const momGrowth = n >= 2 && months[n - 2].revenue > 0
    ? r2((months[n - 1].revenue - months[n - 2].revenue) / months[n - 2].revenue)
    : null

  const grossMargin = auto.contributionMargin
  const monthlyNetProfit = r2((arr * grossMargin) / 12 - a.monthlyBurn)
  const annualNetProfit = r2(arr * grossMargin - a.monthlyBurn * 12)

  const newPaidPerMonth = recent.length ? recent.reduce((s, m) => s + m.paid, 0) / recent.length : 0
  const cac = a.monthlyAdSpend > 0 && newPaidPerMonth > 0 ? r2(a.monthlyAdSpend / newPaidPerMonth) : null
  const ltv = r2(auto.arpa * grossMargin) // single-purchase contribution per attendee
  const ltvCac = cac && cac > 0 ? r2(ltv / cac) : null

  // Rule of 40: annual growth% (capped — growth is volatile off a small base) + margin%.
  const annualGrowthPct = momGrowth != null ? clamp(momGrowth * 100, 0, 60) : 0
  const ruleOf40 = r2(annualGrowthPct + grossMargin * 100)

  const profitable = monthlyNetProfit >= 0
  const netNewMonthly = recent.length >= 2 ? (recent[recent.length - 1].revenue - recent[0].revenue) / (recent.length - 1) : 0
  const burnMultiple = !profitable && netNewMonthly > 0 ? r2(Math.abs(monthlyNetProfit) / netNewMonthly) : null
  const runwayMonths = profitable ? null : (a.monthlyBurn > 0 ? r2(a.cashBalance / a.monthlyBurn) : null)
  const defaultAlive = profitable || (runwayMonths != null && runwayMonths >= 12)

  const leadToPaid = auto.leads > 0 ? r2(auto.paidAttendees / auto.leads) : 0
  const paidToMeeting = auto.paidAttendees > 0 ? r2(auto.meetings / auto.paidAttendees) : 0

  return {
    runRate, arr, momGrowth, grossMargin, monthlyNetProfit, annualNetProfit,
    cac, ltv, ltvCac, ruleOf40, burnMultiple, profitable, runwayMonths, defaultAlive,
    leadToPaid, paidToMeeting, newPaidPerMonth,
  }
}

export function computeValuation(d: Derived, a: Assumptions): Valuation {
  const arr = d.arr
  const methods: ValuationMethod[] = []

  // 1. Revenue multiple — band scaled by efficiency; override sets the base.
  const baseMult = a.multipleOverride && a.multipleOverride > 0
    ? a.multipleOverride
    : clamp(2 + (d.ruleOf40 - 40) / 20, 1.5, 5)
  methods.push({
    name: 'Revenue multiple',
    low: r2(arr * Math.max(1, baseMult - 1.5)),
    base: r2(arr * baseMult),
    high: r2(arr * (baseMult + 1.5)),
    rationale: `ARR ${rmShort(arr)} × ~${baseMult.toFixed(1)}× (band ±1.5×), set by Rule of 40 = ${d.ruleOf40.toFixed(0)}.`,
  })

  // 2. Rule-of-40 multiple — public-market heuristic EV/Rev ≈ RoF40 ÷ 10.
  const r40Mult = clamp(d.ruleOf40 / 10, 1, 5)
  methods.push({
    name: 'Rule-of-40 multiple',
    low: r2(arr * r40Mult * 0.75),
    base: r2(arr * r40Mult),
    high: r2(arr * r40Mult * 1.25),
    rationale: `ARR × (Rule of 40 ÷ 10) = ${r40Mult.toFixed(1)}×. Rewards the ${(d.grossMargin * 100).toFixed(0)}% margin.`,
  })

  // 3. Earnings multiple — profitable business valued on owner earnings (SDE/EBITDA).
  const profit = Math.max(0, d.annualNetProfit)
  methods.push({
    name: 'Earnings multiple',
    low: r2(profit * 3),
    base: r2(profit * 4),
    high: r2(profit * 5),
    rationale: profit > 0
      ? `Annual net profit ${rmShort(profit)} × 3–5× (fits a profitable, bootstrapped business).`
      : 'Not yet profitable on current assumptions — earnings method n/a.',
  })

  const lows = methods.map(m => m.low)
  const bases = methods.map(m => m.base).sort((x, y) => x - y)
  const highs = methods.map(m => m.high)
  const median = bases.length % 2 ? bases[(bases.length - 1) / 2] : (bases[bases.length / 2 - 1] + bases[bases.length / 2]) / 2
  const blendedLow = r2(Math.min(...lows))
  const blendedHigh = r2(Math.max(...highs))
  const blendedBase = r2(median)
  const equityValue = r2(blendedBase * clamp(a.ownershipPct, 0, 100) / 100)

  return { methods, blendedLow, blendedBase, blendedHigh, equityValue, arr }
}

// Compact RM for rationale strings, e.g. "RM 414k" / "RM 1.2M".
function rmShort(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e6) return `RM ${(n / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `RM ${(n / 1e3).toFixed(0)}k`
  return `RM ${n.toFixed(0)}`
}

export function buildScorecard(auto: ValuationAuto, a: Assumptions): Scorecard {
  const d = computeDerived(auto, a)
  const valuation = computeValuation(d, a)

  const startup: MetricRow[] = [
    { key: 'mom', label: 'MoM revenue growth', raw: d.momGrowth, kind: 'pct',
      benchmark: 'great ≥ 30% · good ≥ 15%', status: grade(d.momGrowth, 0.30, 0.15, 0.05),
      note: auto.monthly.length < 3 ? 'Early — off a small base, expect volatility.' : undefined },
    { key: 'runrate', label: 'Revenue run-rate (ARR)', raw: d.arr, kind: 'money',
      benchmark: 'trailing-3-mo avg × 12', status: 'na' },
    { key: 'alive', label: 'Default alive?', raw: d.defaultAlive ? 1 : 0, kind: 'text',
      display: d.defaultAlive ? 'Yes — profitable' : 'No — burning', benchmark: "PG's test: profit or 12-mo runway",
      status: d.defaultAlive ? 'great' : 'weak' },
    { key: 'runway', label: 'Runway', raw: d.runwayMonths, kind: d.profitable ? 'text' : 'months',
      display: d.profitable ? 'Profitable' : undefined,
      benchmark: 'great ≥ 18 · good ≥ 12 mo', status: d.profitable ? 'great' : grade(d.runwayMonths, 18, 12, 6),
      note: d.profitable ? 'Cash-generative — effectively unlimited.' : undefined },
    { key: 'l2p', label: 'Lead → paid conversion', raw: d.leadToPaid, kind: 'pct',
      benchmark: 'great ≥ 10% · good ≥ 5%', status: grade(d.leadToPaid, 0.10, 0.05, 0.02) },
  ]

  const traction: MetricRow[] = [
    { key: 'margin', label: 'Contribution margin', raw: d.grossMargin, kind: 'pct',
      benchmark: 'great ≥ 70% · good ≥ 50%', status: grade(d.grossMargin, 0.70, 0.50, 0.30) },
    { key: 'cac', label: 'Blended CAC', raw: d.cac, kind: 'money',
      benchmark: 'set monthly ad spend to compute', status: 'na',
      note: d.cac == null ? 'Add monthly ad spend in assumptions.' : undefined },
    { key: 'ltvcac', label: 'LTV : CAC', raw: d.ltvCac, kind: 'ratio',
      benchmark: 'great ≥ 5× · good ≥ 3×', status: grade(d.ltvCac, 5, 3, 1),
      note: d.ltvCac == null ? 'Needs ad spend.' : 'Per-attendee contribution ÷ CAC.' },
    { key: 'rof40', label: 'Rule of 40', raw: d.ruleOf40, kind: 'num',
      benchmark: 'great ≥ 60 · good ≥ 40', status: grade(d.ruleOf40, 60, 40, 20) },
    { key: 'bofu', label: 'Paid → BoFu call', raw: d.paidToMeeting, kind: 'pct',
      benchmark: 'great ≥ 10% · good ≥ 5%', status: grade(d.paidToMeeting, 0.10, 0.05, 0.02),
      note: 'Workshop attendee → B2B implementation call.' },
    { key: 'burn', label: 'Burn multiple', raw: d.burnMultiple, kind: 'ratio',
      benchmark: 'lower better · great ≤ 1×', status: d.profitable ? 'great' : grade(d.burnMultiple, 1, 1.5, 2.5, false),
      note: d.profitable ? 'Profitable — no burn.' : undefined },
  ]

  const ipo: MetricRow[] = [
    { key: 'scale', label: 'Revenue scale', raw: d.arr, kind: 'money',
      benchmark: 'IPO rule-of-thumb ≈ $100M ARR', status: d.arr >= 100_000_000 ? 'great' : 'weak',
      note: 'Long runway — this is the destination, not today.' },
    { key: 'nrr', label: 'Net revenue retention', raw: null, kind: 'pct',
      benchmark: 'great ≥ 120% · good ≥ 100%', status: 'na',
      note: 'Track repeat purchases / B2B renewals to compute.' },
    { key: 'b2b', label: 'B2B / recurring revenue', raw: a.b2bAnnualRevenue, kind: 'money',
      benchmark: 'diversify beyond one-off tickets', status: a.b2bAnnualRevenue > 0 ? 'ok' : 'na',
      note: 'Manual until implementation revenue is tracked in EventOps.' },
    { key: 'concentration', label: 'Customer concentration', raw: null, kind: 'pct',
      benchmark: 'no single client > ~10%', status: 'na', note: 'Needs per-client revenue.' },
    { key: 'rof40b', label: 'Rule of 40 (sustained)', raw: d.ruleOf40, kind: 'num',
      benchmark: 'public markets reward ≥ 40', status: grade(d.ruleOf40, 60, 40, 20) },
  ]

  return { startup, traction, ipo, derived: d, valuation }
}

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  cashBalance: 0, monthlyBurn: 0, monthlyAdSpend: 0,
  communitySize: 1200, b2bAnnualRevenue: 0, ownershipPct: 100, multipleOverride: null,
}
