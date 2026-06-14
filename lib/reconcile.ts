// Bank-statement reconciliation — pure matching logic (no I/O).
//
// Jarvis flow: admin forwards a bank statement (PDF/CSV/screenshot) to the bot →
// Claude extracts raw transactions → THIS module deterministically matches them
// against attendees whose payment_status is still 'pending' → admin confirms with
// YES → the route marks the matched attendees paid. Matching is intentionally
// conservative: an ambiguous transaction is left unmatched for the admin rather
// than guessed (money state only ever changes behind the YES gate).

export type StatementTxn = {
  payer: string        // sender name / description line from the statement
  amount: number       // RM
  date?: string | null // as printed on the statement, free-form
}

export type PendingAttendee = {
  id: string
  name: string
  amount: number       // expected payment_amount
  event_name?: string | null
}

export type ReconcileMatch = {
  attendee_id: string
  attendee_name: string
  amount: number
  payer: string        // the statement line we matched on
  score: number
}

export type ReconcileResult = {
  matches: ReconcileMatch[]
  unmatchedTxns: StatementTxn[]
  stillPending: PendingAttendee[]
}

const NAME_STOPWORDS = new Set([
  // transfer-description noise commonly seen on MY bank statements
  'duitnow', 'transfer', 'tng', 'touch', 'ngo', 'instant', 'ibg', 'dobw',
  'payment', 'fund', 'tsfr', 'trsf', 'from', 'to', 'via', 'qr', 'pymt', 'sdn', 'bhd',
  'mr', 'mrs', 'ms', 'bin', 'binti', 'a/l', 'a/p', 'al', 'ap',
])

function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z一-鿿]+/g, ' ').split(' ')
    .filter(w => w.length >= 2 && !NAME_STOPWORDS.has(w))
}

// Score how well a statement payer line matches an attendee name.
// 0 = no overlap. Token hits weighted; full containment gets a bonus.
function nameScore(payer: string, attendeeName: string): number {
  const pt = new Set(tokens(payer))
  const at = tokens(attendeeName)
  if (!pt.size || !at.length) return 0
  let hits = 0
  for (const t of at) if (pt.has(t)) hits++
  let score = hits
  const flatPayer = payer.toLowerCase().replace(/[^a-z]/g, '')
  const flatName = attendeeName.toLowerCase().replace(/[^a-z]/g, '')
  if (flatName.length >= 6 && flatPayer.includes(flatName)) score += 2
  return score
}

// Greedy best-first assignment: each transaction and each attendee is used at
// most once. A txn only matches when the amount equals the attendee's expected
// amount (±0.01) AND at least one real name token overlaps. Same-amount ties
// with equal name scores stay unmatched (ambiguous — human decides).
export function matchTransactions(
  txns: StatementTxn[],
  pending: PendingAttendee[],
): ReconcileResult {
  type Cand = { ti: number; pi: number; score: number }
  const cands: Cand[] = []

  txns.forEach((t, ti) => {
    if (!Number.isFinite(t.amount) || t.amount <= 0) return
    pending.forEach((p, pi) => {
      if (Math.abs(t.amount - p.amount) > 0.01) return
      const s = nameScore(t.payer || '', p.name || '')
      if (s > 0) cands.push({ ti, pi, score: s })
    })
  })

  cands.sort((a, b) => b.score - a.score)

  const doneT = new Set<number>()    // txns consumed (matched OR ruled ambiguous)
  const matchedT = new Set<number>() // txns that produced an actual match
  const usedP = new Set<number>()
  const matches: ReconcileMatch[] = []

  for (const c of cands) {
    if (doneT.has(c.ti) || usedP.has(c.pi)) continue
    // Ambiguity guard: another unused attendee with the SAME score for this txn?
    const rival = cands.find(o =>
      o !== c && o.ti === c.ti && !usedP.has(o.pi) && o.pi !== c.pi && o.score === c.score)
    if (rival) { doneT.add(c.ti); continue } // leave txn unmatched, don't guess
    doneT.add(c.ti)
    matchedT.add(c.ti)
    usedP.add(c.pi)
    const t = txns[c.ti]
    const p = pending[c.pi]
    matches.push({ attendee_id: p.id, attendee_name: p.name, amount: p.amount, payer: t.payer, score: c.score })
  }

  return {
    matches,
    unmatchedTxns: txns.filter((_, i) => !matchedT.has(i)),
    stillPending: pending.filter((_, i) => !usedP.has(i)),
  }
}
