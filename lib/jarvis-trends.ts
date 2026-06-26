// Pure trend math for the proactive digest — no I/O, unit-testable.
// The digest cron does the SQL; these turn snapshots into the lines it speaks.

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

export interface Snapshot {
  registered: number
  paid_count: number
  free_count: number
  gross_revenue: number
  survey_count: number
  deals_new: number
  deals_contacted: number
  deals_meeting: number
  deals_won: number
}

export interface Deltas {
  paid: number
  revenue: number
  registered: number
  survey: number
  deals_meeting: number
  deals_won: number
}

// Diff today vs the previous snapshot. Returns null if there's no prior snapshot
// OR nothing moved (so the digest can skip the delta line entirely).
export function computeDeltas(today: Snapshot, prev: Snapshot | null | undefined): Deltas | null {
  if (!prev) return null
  const d: Deltas = {
    paid: today.paid_count - prev.paid_count,
    revenue: round2(today.gross_revenue - prev.gross_revenue),
    registered: today.registered - prev.registered,
    survey: today.survey_count - prev.survey_count,
    deals_meeting: today.deals_meeting - prev.deals_meeting,
    deals_won: today.deals_won - prev.deals_won,
  }
  if (!d.paid && !d.revenue && !d.registered && !d.survey && !d.deals_meeting && !d.deals_won) return null
  return d
}

export interface FillProjection {
  ratePerDay: number
  spotsLeft: number
  daysToFull: number | null // null when stalled
  stalled: boolean // rate <= 0 (no recent signups / refund)
}

// Linear fill projection from a window. Returns null when there's no usable
// signal (no prior snapshot, no capacity, too close to event). rate <= 0 →
// stalled (never a negative ETA, the refund/no-signup edge the critique flagged).
export function projectFill(
  paidNow: number,
  paidWindowAgo: number | null | undefined,
  windowDays: number,
  capacity: number,
  daysUntil: number,
): FillProjection | null {
  if (paidWindowAgo == null || capacity <= 0 || windowDays <= 0 || daysUntil < 5) return null
  const rate = round2((paidNow - paidWindowAgo) / windowDays)
  const spotsLeft = Math.max(0, capacity - paidNow)
  if (rate <= 0) return { ratePerDay: rate, spotsLeft, daysToFull: null, stalled: true }
  return { ratePerDay: rate, spotsLeft, daysToFull: Math.ceil(spotsLeft / rate), stalled: false }
}

export interface ActionCtx {
  pendingCount: number
  pendingRevenue: number // RM outstanding from pending attendees
  postEventGap: number // attended+paid but not in pipeline (T+3)
  paceBehindPct: number | null // positive = behind prior cohort
  agedLeads: number
  openClaims: number
  daysUntil: number
}

const fmtRm = (n: number) => 'RM' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

// Pick the single highest-impact action for the day. Money-in-hand (collecting
// outstanding RM) is weighted by the actual amount, so a real pending balance
// beats a pile of cold leads (the inversion the critique called out).
export function rankDigestActions(c: ActionCtx): string | null {
  const cand: Array<{ score: number; label: string }> = []
  if (c.pendingCount > 0 && c.pendingRevenue > 0)
    cand.push({ score: c.pendingRevenue, label: `Chase ${c.pendingCount} pending payment${c.pendingCount !== 1 ? 's' : ''} — ${fmtRm(c.pendingRevenue)} outstanding` })
  if (c.postEventGap > 0)
    cand.push({ score: 700 + c.postEventGap * 40, label: `Follow up ${c.postEventGap} attendee${c.postEventGap !== 1 ? 's' : ''} not yet in the pipeline — window closing` })
  if (c.paceBehindPct != null && c.paceBehindPct >= 15 && c.daysUntil >= 3)
    cand.push({ score: 500, label: `Fill pace ${c.paceBehindPct}% behind last event — push content or activate affiliates` })
  if (c.agedLeads > 0)
    cand.push({ score: 100 + c.agedLeads * 30, label: `Work ${c.agedLeads} cold deal lead${c.agedLeads !== 1 ? 's' : ''} — /pipeline` })
  if (c.openClaims > 0)
    cand.push({ score: 50 + c.openClaims * 20, label: `Clear ${c.openClaims} open expense claim${c.openClaims !== 1 ? 's' : ''}` })
  if (!cand.length) return null
  cand.sort((a, b) => b.score - a.score)
  return cand[0].label
}
