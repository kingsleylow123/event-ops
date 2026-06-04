'use client'
import { useEffect, useState, useMemo } from 'react'
import type { Event, Attendee, Expense } from '@/lib/supabase'
import { useRevenueHidden } from '@/lib/useRevenueHidden'

const rm = (n: number) =>
  `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type PayoutRow = {
  id: string
  affiliate_id: string
  event_id: string
  amount: number
  paid_at: string
  notes: string | null
}
type AffiliateLite = { id: string; handle: string }

const CLOSE_STEPS = [
  'All sales recorded (attendees marked paid)',
  'All expenses logged for the month',
  'Affiliate commissions calculated & marked paid',
  'Outstanding receivables reviewed (pending payments chased)',
  'Bank reconciliation verified (Stripe + Bank Transfer match deposits)',
  'Accruals / deferred revenue posted (e.g. upsells for future events)',
  'P&L reviewed for accuracy',
  'Monthly report generated & shared',
]

export default function MonthEndPage() {
  // Default to current month YYYY-MM
  const [yearMonth, setYearMonth] = useState(() => {
    // Synced with system clock at first render
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [events, setEvents] = useState<Event[]>([])
  const [attendees, setAttendees] = useState<Attendee[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [payouts, setPayouts] = useState<PayoutRow[]>([])
  const [affiliates, setAffiliates] = useState<AffiliateLite[]>([])
  const [loading, setLoading] = useState(true)
  const [revenueHidden, toggleRevenue] = useRevenueHidden()
  const [steps, setSteps] = useState<boolean[]>(() => CLOSE_STEPS.map(() => false))
  const [closedMonths, setClosedMonths] = useState<Record<string, string>>({})  // ym -> ISO timestamp

  const display = (n: number) => (revenueHidden ? 'RM ••••••' : rm(n))

  // Persist step checkboxes + closed status per month
  useEffect(() => {
    const saved = localStorage.getItem(`month_end_steps_${yearMonth}`)
    setSteps(saved ? JSON.parse(saved) : CLOSE_STEPS.map(() => false))
  }, [yearMonth])
  function setStep(i: number, v: boolean) {
    setSteps(prev => {
      const next = [...prev]
      next[i] = v
      localStorage.setItem(`month_end_steps_${yearMonth}`, JSON.stringify(next))
      return next
    })
  }
  useEffect(() => {
    const saved = localStorage.getItem('month_end_closed')
    if (saved) setClosedMonths(JSON.parse(saved))
  }, [])
  function toggleClosed() {
    setClosedMonths(prev => {
      const next = { ...prev }
      if (next[yearMonth]) delete next[yearMonth]
      else next[yearMonth] = new Date().toISOString()
      localStorage.setItem('month_end_closed', JSON.stringify(next))
      return next
    })
  }
  const isClosed = !!closedMonths[yearMonth]
  const allStepsDone = steps.every(Boolean)

  // Load everything once on mount (and on yearMonth change for re-render)
  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [evRes, attRes, expRes, paidRes, affRes] = await Promise.all([
          fetch('/api/events', { cache: 'no-store' }),
          fetch('/api/attendees', { cache: 'no-store' }),
          fetch('/api/expenses', { cache: 'no-store' }),
          fetch('/api/affiliates?action=payouts_all').then(r => r.ok ? r : null).catch(() => null),
          fetch('/api/affiliates?event_id=00000000-0000-0000-0000-000000000000').then(r => r.ok ? r : null).catch(() => null),
        ])
        if (evRes.ok) setEvents(await evRes.json())
        if (attRes.ok) setAttendees(await attRes.json())
        if (expRes.ok) setExpenses(await expRes.json())
        // Payouts: this endpoint doesn't exist yet — fall back to inline fetch in summary if needed
        // We'll fetch all payouts directly through the affiliates API extended
        const allPayouts = await fetch('/api/month-end/payouts', { cache: 'no-store' })
        if (allPayouts.ok) {
          const data = await allPayouts.json()
          setPayouts(data.payouts ?? [])
          setAffiliates(data.affiliates ?? [])
        }
        // Silence unused vars from optional fetches
        void paidRes; void affRes
      } catch {
        // ignore
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // ── Month filtering (ACCRUAL basis: revenue tied to event date) ──
  function inMonth(iso: string | null | undefined): boolean {
    if (!iso) return false
    return iso.slice(0, 7) === yearMonth
  }
  // event_id -> bucketing month (accounting_month override wins, else event date)
  const eventMonth = useMemo(() => {
    const m = new Map<string, string>()
    events.forEach(ev => {
      const override = (ev as Event & { accounting_month?: string | null }).accounting_month
      if (override && /^\d{4}-\d{2}$/.test(override)) {
        m.set(ev.id, override)
      } else if (ev.date) {
        m.set(ev.id, String(ev.date).slice(0, 7))
      }
    })
    return m
  }, [events])

  const monthSummary = useMemo(() => {
    // Revenue: paid attendees whose EVENT falls in this month
    // (accrual basis — revenue is recognised when the workshop is delivered,
    // not when the money came in. Upsells move with their event too.)
    const paidInMonth = attendees.filter(a => {
      if (a.payment_status !== 'paid') return false
      const evm = a.event_id ? eventMonth.get(a.event_id as string) : null
      return evm === yearMonth
    })
    const revenue = paidInMonth.reduce((s, a) => s + Number(a.payment_amount ?? 0), 0)

    // Bank split
    const stripe = paidInMonth.filter(a => a.payment_method === 'stripe')
      .reduce((s, a) => s + Number(a.payment_amount ?? 0), 0)
    const bank = paidInMonth.filter(a => a.payment_method === 'bank_transfer')
      .reduce((s, a) => s + Number(a.payment_amount ?? 0), 0)

    // Expenses: tied to an event → bucket by event month;
    //           standalone (no event_id) → bucket by created_at month
    const expInMonth = expenses.filter(e => {
      const evm = e.event_id ? eventMonth.get(e.event_id as string) : null
      if (evm) return evm === yearMonth
      return inMonth(e.created_at as unknown as string)
    })
    const expenseTotal = expInMonth.reduce((s, e) => s + Number(e.amount), 0)
    const expByCat: Record<string, number> = {}
    expInMonth.forEach(e => {
      const c = String(e.category || 'Other')
      expByCat[c] = (expByCat[c] || 0) + Number(e.amount)
    })

    // Affiliate payouts: payout is for a specific event → bucket by event month
    const payoutsInMonth = payouts.filter(p => eventMonth.get(p.event_id) === yearMonth)
    const payoutTotal = payoutsInMonth.reduce((s, p) => s + Number(p.amount), 0)

    // Outstanding
    const outstandingReceivable = attendees
      .filter(a => a.payment_status === 'pending')
      .reduce((s, a) => s + Number(a.payment_amount ?? 0), 0)

    const net = revenue - expenseTotal - payoutTotal

    // Per-event breakdown for the month
    const perEvent = events.map(ev => {
      const att = paidInMonth.filter(a => a.event_id === ev.id)
      const rev = att.reduce((s, a) => s + Number(a.payment_amount ?? 0), 0)
      const exp = expInMonth.filter(e => e.event_id === ev.id).reduce((s, e) => s + Number(e.amount), 0)
      const pay = payoutsInMonth.filter(p => p.event_id === ev.id).reduce((s, p) => s + Number(p.amount), 0)
      return {
        event: ev,
        paidCount: att.length,
        revenue: rev,
        expenses: exp,
        payouts: pay,
        net: rev - exp - pay,
      }
    }).filter(r => r.paidCount > 0 || r.expenses > 0 || r.payouts > 0)
       .sort((a, b) => b.net - a.net)

    return {
      revenue, stripe, bank,
      expenseTotal, expByCat,
      payoutTotal, payoutCount: payoutsInMonth.length,
      outstandingReceivable,
      net,
      perEvent,
      paidCount: paidInMonth.length,
      payoutsInMonth,
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendees, expenses, payouts, events, yearMonth])

  function downloadCsv() {
    const lines: string[] = []
    lines.push(`Month-End Report,${yearMonth}`)
    lines.push('')
    lines.push('SUMMARY')
    lines.push(`Revenue (paid),${monthSummary.revenue.toFixed(2)}`)
    lines.push(`  Stripe,${monthSummary.stripe.toFixed(2)}`)
    lines.push(`  Bank Transfer,${monthSummary.bank.toFixed(2)}`)
    lines.push(`Expenses,${monthSummary.expenseTotal.toFixed(2)}`)
    lines.push(`Affiliate Payouts,${monthSummary.payoutTotal.toFixed(2)}`)
    lines.push(`NET P&L,${monthSummary.net.toFixed(2)}`)
    lines.push('')
    lines.push('OUTSTANDING')
    lines.push(`Receivables (pending payments),${monthSummary.outstandingReceivable.toFixed(2)}`)
    lines.push('')
    lines.push('PER EVENT')
    lines.push('Event,Paid,Revenue,Expenses,Payouts,Net')
    monthSummary.perEvent.forEach(r => {
      lines.push(`"${r.event.name}",${r.paidCount},${r.revenue.toFixed(2)},${r.expenses.toFixed(2)},${r.payouts.toFixed(2)},${r.net.toFixed(2)}`)
    })
    lines.push('')
    lines.push('EXPENSE CATEGORIES')
    Object.entries(monthSummary.expByCat).sort((a, b) => b[1] - a[1]).forEach(([c, v]) => {
      lines.push(`${c},${v.toFixed(2)}`)
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `month-end-${yearMonth}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-bold">📚 Month-End Close</h1>
            <p className="text-xs text-zinc-500">
              Lock the books — reconcile sales, expenses, payouts, and bank deposits.
            </p>
            <p className="text-[10px] text-zinc-600 mt-0.5">
              Basis: <span className="text-zinc-400">accrual</span> — revenue is bucketed by the event&apos;s month, not when payment hit your bank.
            </p>
          </div>
          <button
            onClick={toggleRevenue}
            title={revenueHidden ? 'Show amounts' : 'Hide amounts'}
            className="text-zinc-500 hover:text-amber-400 text-base"
          >
            {revenueHidden ? '👁' : '🙈'}
          </button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="month"
            value={yearMonth}
            onChange={e => setYearMonth(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm"
          />
          <button
            onClick={downloadCsv}
            className="bg-zinc-800 hover:bg-zinc-700 text-white text-sm px-4 py-2 rounded-lg border border-zinc-700"
          >
            📥 Download CSV
          </button>
          <button
            onClick={toggleClosed}
            disabled={!isClosed && !allStepsDone}
            className={`text-sm font-semibold px-4 py-2 rounded-lg ${
              isClosed
                ? 'bg-zinc-800 hover:bg-zinc-700 text-emerald-300 border border-emerald-700'
                : 'bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black'
            }`}
          >
            {isClosed
              ? '↩ Reopen month'
              : allStepsDone ? '🔒 Close month' : `🔒 Close month (${steps.filter(Boolean).length}/${steps.length})`}
          </button>
        </div>
      </div>

      {isClosed && (
        <div className="bg-emerald-900/30 border border-emerald-700/50 rounded-lg px-4 py-3 text-sm text-emerald-200">
          ✅ <span className="font-semibold">Closed</span> on {new Date(closedMonths[yearMonth]).toLocaleString('en-MY')}.
          Reports for {yearMonth} are locked in. To make edits, click <span className="font-semibold">Reopen month</span>.
        </div>
      )}

      {loading ? (
        <div className="text-zinc-500 text-center py-12">Loading…</div>
      ) : (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Tile label="Revenue" value={display(monthSummary.revenue)} sub={`${monthSummary.paidCount} paid attendees`} accent="amber" />
            <Tile label="Expenses" value={display(monthSummary.expenseTotal)} sub={`${Object.keys(monthSummary.expByCat).length} categories`} accent="red" />
            <Tile label="Affiliate Payouts" value={display(monthSummary.payoutTotal)} sub={`${monthSummary.payoutCount} payouts`} accent="purple" />
            <Tile label="Net P&L" value={display(monthSummary.net)} sub={monthSummary.net >= 0 ? 'Profit' : 'Loss'} accent={monthSummary.net >= 0 ? 'emerald' : 'red'} bold />
          </div>

          {/* Bank reconciliation */}
          <div className="bg-[#111] border border-zinc-800 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-300">🏦 Bank Reconciliation</h2>
              <span className="text-xs text-zinc-500">Cross-check against actual bank statements</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <Stat label="Stripe collected" value={display(monthSummary.stripe)} />
              <Stat label="Bank Transfer collected" value={display(monthSummary.bank)} />
              <Stat label="Total deposits expected" value={display(monthSummary.stripe + monthSummary.bank)} accent="amber" />
            </div>
          </div>

          {/* Per-event breakdown */}
          <div className="bg-[#111] border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-zinc-800 flex justify-between items-center">
              <h2 className="text-sm font-semibold text-zinc-300">📊 Per Event</h2>
              <span className="text-xs text-zinc-500">{monthSummary.perEvent.length} events with activity this month</span>
            </div>
            {monthSummary.perEvent.length === 0 ? (
              <div className="px-5 py-8 text-center text-zinc-500 text-sm">No event activity in {yearMonth}.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
                      <th className="px-4 py-2">Event</th>
                      <th className="px-4 py-2 text-right">Paid</th>
                      <th className="px-4 py-2 text-right">Revenue</th>
                      <th className="px-4 py-2 text-right">Expenses</th>
                      <th className="px-4 py-2 text-right">Payouts</th>
                      <th className="px-4 py-2 text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthSummary.perEvent.map(r => (
                      <tr key={r.event.id} className="border-b border-zinc-900">
                        <td className="px-4 py-3 text-white">{r.event.name}</td>
                        <td className="px-4 py-3 text-right text-zinc-300">{r.paidCount}</td>
                        <td className="px-4 py-3 text-right text-zinc-300">{display(r.revenue)}</td>
                        <td className="px-4 py-3 text-right text-red-400">{display(r.expenses)}</td>
                        <td className="px-4 py-3 text-right text-purple-400">{display(r.payouts)}</td>
                        <td className={`px-4 py-3 text-right font-semibold ${r.net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{display(r.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Outstanding */}
          <div className="bg-[#111] border border-zinc-800 rounded-xl p-5 space-y-2">
            <h2 className="text-sm font-semibold text-zinc-300">⏳ Outstanding Receivables</h2>
            <p className="text-2xl font-bold text-yellow-400">{display(monthSummary.outstandingReceivable)}</p>
            <p className="text-xs text-zinc-500">
              Total payment_amount from all attendees still marked <span className="text-yellow-400">pending</span>.
              Chase these before closing the month.
            </p>
          </div>

          {/* Expense categories */}
          {Object.keys(monthSummary.expByCat).length > 0 && (
            <div className="bg-[#111] border border-zinc-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-zinc-300 mb-3">💸 Expense Categories</h2>
              <div className="space-y-1.5">
                {Object.entries(monthSummary.expByCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => (
                  <div key={c} className="flex justify-between text-sm">
                    <span className="text-zinc-400">{c}</span>
                    <span className="text-white font-mono">{display(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Close checklist */}
          <div className="bg-[#111] border border-zinc-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-zinc-300 mb-3">✅ Close Checklist</h2>
            <p className="text-xs text-zinc-500 mb-4">Tick each step to unlock the &ldquo;Close month&rdquo; button. Progress is saved per month.</p>
            <div className="space-y-2">
              {CLOSE_STEPS.map((label, i) => (
                <label key={i} className="flex items-start gap-3 text-sm text-zinc-300 hover:text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={steps[i]}
                    onChange={e => setStep(i, e.target.checked)}
                    disabled={isClosed}
                    className="mt-0.5 w-4 h-4 accent-amber-500 cursor-pointer"
                  />
                  <span className={steps[i] ? 'line-through text-zinc-500' : ''}>{label}</span>
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Small presentation components ──────────────────────────────────────
function Tile({ label, value, sub, accent, bold }: {
  label: string; value: string; sub?: string
  accent?: 'amber' | 'red' | 'purple' | 'emerald'
  bold?: boolean
}) {
  const color =
    accent === 'amber' ? 'text-amber-400' :
    accent === 'red' ? 'text-red-400' :
    accent === 'purple' ? 'text-purple-400' :
    accent === 'emerald' ? 'text-emerald-400' : 'text-white'
  const border =
    accent === 'amber' ? 'border-amber-500/40' :
    accent === 'emerald' ? 'border-emerald-500/40' : 'border-zinc-800'
  return (
    <div className={`bg-[#111] border ${border} rounded-xl p-4`}>
      <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`${bold ? 'text-3xl font-black' : 'text-2xl font-bold'} ${color}`}>{value}</p>
      {sub && <p className="text-xs text-zinc-500 mt-1">{sub}</p>}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'amber' }) {
  return (
    <div>
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p className={`text-xl font-bold ${accent === 'amber' ? 'text-amber-400' : 'text-white'}`}>{value}</p>
    </div>
  )
}
