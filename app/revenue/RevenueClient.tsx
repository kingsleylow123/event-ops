'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Event, Attendee, Expense, ExpenseCategory } from '@/lib/supabase'
import { EXPENSE_CATEGORIES } from '@/lib/supabase'

function fmtRM(n: number): string {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const hasCents = Math.round(abs * 100) % 100 !== 0
  return `${sign}RM ${abs.toLocaleString('en-MY', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}

function fmtDate(date: string | null): string {
  if (!date) return ''
  return new Date(date).toLocaleDateString('en-MY', { dateStyle: 'medium' })
}

interface EventRevenue {
  event: Event
  paidCount: number
  totalPaid: number
  stripeCount: number
  stripeRevenue: number
  bankCount: number
  bankRevenue: number
  freeCount: number
  pendingCount: number
  pendingRevenue: number
  expenses: Expense[]
  totalExpenses: number
  profit: number
}

// ─── Payment Template ────────────────────────────────────────────────────────

interface PaymentTemplateProps {
  events: Event[]
  attendees: Attendee[]
}

function PaymentTemplate({ events, attendees }: PaymentTemplateProps) {
  const [open, setOpen] = useState(false)
  const [selectedEventId, setSelectedEventId] = useState<string>('')
  const [depositText, setDepositText] = useState<string>('')
  const [copied, setCopied] = useState(false)

  // Initialise selectedEventId to the first event
  useEffect(() => {
    if (events.length > 0 && !selectedEventId) {
      setSelectedEventId(events[0].id)
    }
  }, [events, selectedEventId])

  // Load / save deposit text in localStorage keyed by event id
  useEffect(() => {
    if (!selectedEventId) return
    const saved = localStorage.getItem(`deposit_text_${selectedEventId}`)
    setDepositText(saved ?? '')
  }, [selectedEventId])

  const handleDepositChange = useCallback((val: string) => {
    setDepositText(val)
    if (selectedEventId) {
      localStorage.setItem(`deposit_text_${selectedEventId}`, val)
    }
  }, [selectedEventId])

  const selectedEvent = useMemo(
    () => events.find(ev => ev.id === selectedEventId),
    [events, selectedEventId],
  )

  const { vipAttendees, generalAttendees } = useMemo(() => {
    if (!selectedEventId) return { vipAttendees: [], generalAttendees: [] }

    const paid = attendees.filter(
      a =>
        a.event_id === selectedEventId &&
        a.payment_status === 'paid' &&
        a.notes !== 'upgrade_payment' &&
        // Exclude free tickets (payment_method === 'free' or payment_amount === 0)
        a.payment_method !== 'free' &&
        Number(a.payment_amount) > 0,
    )

    const vip = paid.filter(a => a.ticket_type.toLowerCase().includes('vip'))
    const general = paid.filter(a => !a.ticket_type.toLowerCase().includes('vip'))

    return { vipAttendees: vip, generalAttendees: general }
  }, [selectedEventId, attendees])

  function paymentMethodLabel(a: Attendee): string {
    return a.payment_method === 'stripe' ? 'Stripe' : 'Bank Transfer'
  }

  function buildTemplateText(): string {
    const eventName = selectedEvent?.name ?? '[Event Name]'
    const lines: string[] = []

    lines.push(`Claude Malaysia Workshop — ${eventName}`)
    lines.push('Payment Status')
    lines.push('')
    lines.push('✅ Pay in Full')
    lines.push('')

    lines.push('VIP (Name + Payment Method)')
    if (vipAttendees.length === 0) {
      lines.push('(none)')
    } else {
      vipAttendees.forEach((a, i) => {
        lines.push(`${i + 1}. ${a.name} — ${paymentMethodLabel(a)}`)
      })
    }

    lines.push('')
    lines.push('General (Name + Payment Method)')
    if (generalAttendees.length === 0) {
      lines.push('(none)')
    } else {
      generalAttendees.forEach((a, i) => {
        lines.push(`${i + 1}. ${a.name} — ${paymentMethodLabel(a)}`)
      })
    }

    lines.push('')
    lines.push('👉 Pay Deposit (Name + Action Item)')
    if (depositText.trim()) {
      const depositLines = depositText.trim().split('\n')
      depositLines.forEach((line, i) => {
        lines.push(`${i + 1}. ${line}`)
      })
    } else {
      lines.push('(none)')
    }

    return lines.join('\n')
  }

  async function handleCopy() {
    const text = buildTemplateText()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback: select a textarea
    }
  }

  const templatePreview = useMemo(() => buildTemplateText(), [selectedEventId, vipAttendees, generalAttendees, depositText]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="bg-[#111] border border-zinc-800 rounded-xl overflow-hidden">
      {/* Header / toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 sm:px-5 py-3 text-left hover:bg-zinc-900/50 transition-colors"
      >
        <span className="font-semibold text-sm">📋 Payment Template</span>
        <span className="text-zinc-500 text-xs">{open ? '▲ Collapse' : '▼ Expand'}</span>
      </button>

      {open && (
        <div className="px-4 sm:px-5 pb-5 pt-1 space-y-4 border-t border-zinc-800">
          {/* Event selector */}
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-xs text-zinc-500 uppercase tracking-wider flex-shrink-0">Event</label>
            <select
              value={selectedEventId}
              onChange={e => setSelectedEventId(e.target.value)}
              className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-white text-sm flex-1 sm:flex-none"
            >
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>{ev.name}</option>
              ))}
            </select>
          </div>

          {/* Template preview */}
          <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-4 font-mono text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">
            {templatePreview}
          </div>

          {/* Deposit textarea */}
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider block mb-1.5">
              👉 Deposit entries <span className="normal-case text-zinc-600">(one per line — manually entered)</span>
            </label>
            <textarea
              value={depositText}
              onChange={e => handleDepositChange(e.target.value)}
              rows={4}
              placeholder={'Ralph — RM 500 deposit, flying from Netherlands\nAmy — RM 300 deposit'}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm font-mono resize-y"
            />
          </div>

          {/* Copy button */}
          <button
            onClick={handleCopy}
            className="bg-amber-500 hover:bg-amber-400 text-black font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
          >
            {copied ? '✅ Copied!' : '📋 Copy to clipboard'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function RevenueClient() {
  const [events, setEvents] = useState<Event[]>([])
  const [attendees, setAttendees] = useState<Attendee[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [addingForEvent, setAddingForEvent] = useState<string | null>(null)
  const [form, setForm] = useState({ description: '', amount: '', category: 'Other' as string })
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [filterEventId, setFilterEventId] = useState<string>('all')

  async function loadAll() {
    try {
      const [evRes, attRes, expRes] = await Promise.all([
        fetch('/api/events', { cache: 'no-store' }),
        fetch('/api/attendees', { cache: 'no-store' }),
        fetch('/api/expenses', { cache: 'no-store' }),
      ])
      if (evRes.ok) setEvents(await evRes.json())
      if (attRes.ok) setAttendees(await attRes.json())
      if (expRes.ok) setExpenses(await expRes.json())
    } catch {
      // db not configured
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [])

  const visibleEvents = useMemo(() => {
    let list = events
    if (filterEventId !== 'all') list = list.filter(ev => ev.id === filterEventId)
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(ev => {
        const hay = [ev.name, ev.date ?? '', ev.venue ?? '', fmtDate(ev.date)].join(' ').toLowerCase()
        return hay.includes(q)
      })
    }
    return list
  }, [events, filterEventId, search])

  const byEvent: EventRevenue[] = useMemo(() => {
    return visibleEvents.map(ev => {
      const rows = attendees.filter(a => a.event_id === ev.id)
      const paid = rows.filter(a => a.payment_status === 'paid')
      const stripe = paid.filter(a => a.payment_method === 'stripe')
      const bank = paid.filter(a => a.payment_method === 'bank_transfer')
      const pending = rows.filter(a => a.payment_status === 'pending')
      const free = rows.filter(a => a.payment_status === 'free')
      const sum = (arr: Attendee[]) => arr.reduce((s, a) => s + (Number(a.payment_amount) || 0), 0)
      const evExpenses = expenses.filter(e => e.event_id === ev.id)
      const totalExpenses = evExpenses.reduce((s, e) => s + Number(e.amount), 0)
      const totalPaid = sum(paid)
      return {
        event: ev,
        paidCount: paid.length,
        totalPaid,
        stripeCount: stripe.length,
        stripeRevenue: sum(stripe),
        bankCount: bank.length,
        bankRevenue: sum(bank),
        freeCount: free.length,
        pendingCount: pending.length,
        pendingRevenue: sum(pending),
        expenses: evExpenses,
        totalExpenses,
        profit: totalPaid - totalExpenses,
      }
    })
  }, [visibleEvents, attendees, expenses])

  const grandTotal = byEvent.reduce((s, r) => s + r.totalPaid, 0)
  const grandExpenses = byEvent.reduce((s, r) => s + r.totalExpenses, 0)
  const grandProfit = grandTotal - grandExpenses
  const grandPaidCount = byEvent.reduce((s, r) => s + r.paidCount, 0)

  function openAdd(eventId: string) {
    setAddingForEvent(eventId)
    setForm({ description: '', amount: '', category: 'Other' })
  }

  function cancelAdd() {
    setAddingForEvent(null)
    setForm({ description: '', amount: '', category: 'Other' })
  }

  async function submitExpense(e: React.FormEvent) {
    e.preventDefault()
    if (!addingForEvent) return
    setSaving(true)
    const res = await fetch('/api/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: addingForEvent,
        description: form.description,
        amount: Number(form.amount),
        category: form.category,
      }),
    })
    if (res.ok) {
      const newExp: Expense = await res.json()
      setExpenses(prev => [newExp, ...prev])
      cancelAdd()
    }
    setSaving(false)
  }

  async function deleteExpense(id: string) {
    if (!confirm('Delete this expense?')) return
    const res = await fetch(`/api/expenses?id=${id}`, { method: 'DELETE' })
    if (res.ok) setExpenses(prev => prev.filter(e => e.id !== id))
  }

  if (loading) return <div className="text-zinc-500 mt-20 text-center">Loading…</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">Revenue</h1>
        <div className="flex gap-2 flex-wrap items-center w-full sm:w-auto">
          <select
            value={filterEventId}
            onChange={e => setFilterEventId(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm flex-1 sm:flex-none"
          >
            <option value="all">All events</option>
            {events.map(ev => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by date or event name..."
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm w-full sm:w-64"
          />
        </div>
      </div>

      {/* Grand total card — reflects only the events currently visible */}
      <div className="bg-[#111] border border-amber-500/40 rounded-xl p-4 sm:p-5">
        <p className="text-xs text-zinc-500 mb-3">
          {filterEventId === 'all' && !search ? 'Across all events' : `Filtered · ${byEvent.length} event${byEvent.length === 1 ? '' : 's'}`}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Total revenue</p>
            <p className="text-2xl font-bold text-amber-400">{fmtRM(grandTotal)}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{grandPaidCount} paid</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Total expenses</p>
            <p className="text-2xl font-bold text-red-400">{fmtRM(grandExpenses)}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Net profit</p>
            <p className={`text-2xl font-bold ${grandProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmtRM(grandProfit)}
            </p>
          </div>
        </div>
      </div>

      {/* Payment Template */}
      <PaymentTemplate events={events} attendees={attendees} />

      {/* Per-event breakdown */}
      <div className="space-y-4">
        {byEvent.length === 0 && (
          <div className="text-center text-zinc-500 py-20">No events yet.</div>
        )}
        {byEvent.map(r => {
          const isAdding = addingForEvent === r.event.id
          const stripeShare = r.totalPaid > 0 ? Math.round((r.stripeRevenue / r.totalPaid) * 100) : 0
          const bankShare = r.totalPaid > 0 ? Math.round((r.bankRevenue / r.totalPaid) * 100) : 0
          return (
            <div key={r.event.id} className={`bg-[#111] border rounded-xl p-4 sm:p-5 ${r.event.is_active ? 'border-amber-500/50' : 'border-zinc-800'}`}>
              <div className="flex items-baseline justify-between gap-4 flex-wrap mb-4">
                <div>
                  <h2 className="font-semibold text-lg">{r.event.name}</h2>
                  {r.event.date && (
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {fmtDate(r.event.date)}
                      {r.event.is_active && <span className="ml-2 text-amber-400">· Active</span>}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs text-zinc-500">Net profit</p>
                  <p className={`text-2xl font-bold ${r.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmtRM(r.profit)}
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">{fmtRM(r.totalPaid)} − {fmtRM(r.totalExpenses)}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-0.5">
                    <p className="text-xs text-zinc-500 uppercase tracking-wider">💳 Stripe</p>
                    <span className="text-xs text-zinc-500">{stripeShare}%</span>
                  </div>
                  <p className="text-base font-semibold text-white">{fmtRM(r.stripeRevenue)}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{r.stripeCount} payment{r.stripeCount === 1 ? '' : 's'}</p>
                </div>
                <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-0.5">
                    <p className="text-xs text-zinc-500 uppercase tracking-wider">🏦 Bank Transfer</p>
                    <span className="text-xs text-zinc-500">{bankShare}%</span>
                  </div>
                  <p className="text-base font-semibold text-white">{fmtRM(r.bankRevenue)}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{r.bankCount} payment{r.bankCount === 1 ? '' : 's'}</p>
                </div>
              </div>

              {/* Expenses section */}
              <div className="border-t border-zinc-800 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-zinc-500 uppercase tracking-wider">
                    💸 Expenses ({r.expenses.length}) — {fmtRM(r.totalExpenses)}
                  </p>
                  {!isAdding && (
                    <button onClick={() => openAdd(r.event.id)}
                      className="text-xs text-amber-400 hover:text-amber-300 border border-amber-500/30 hover:border-amber-500/50 rounded-lg px-3 py-1">
                      + Add expense
                    </button>
                  )}
                </div>

                {isAdding && (
                  <form onSubmit={submitExpense} className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-3 mb-2 space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_180px] gap-2">
                      <input required value={form.description}
                        onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                        placeholder="Description (e.g. Venue deposit)"
                        className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
                      <input required type="number" step="0.01" min="0" value={form.amount}
                        onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                        placeholder="Amount (RM)"
                        className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
                      <input
                        list="expense-categories"
                        value={form.category}
                        onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                        placeholder="Category (type or pick)"
                        className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
                      <datalist id="expense-categories">
                        {EXPENSE_CATEGORIES.map(c => <option key={c} value={c} />)}
                      </datalist>
                    </div>
                    <div className="flex gap-2">
                      <button disabled={saving} type="submit"
                        className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold px-3 py-1.5 rounded-lg text-xs">
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button type="button" onClick={cancelAdd}
                        className="bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-1.5 rounded-lg text-xs">
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                {r.expenses.length === 0 ? (
                  <p className="text-xs text-zinc-600 italic">No expenses recorded yet.</p>
                ) : (
                  <ul className="space-y-1">
                    {r.expenses.map(exp => (
                      <li key={exp.id} className="flex items-center justify-between gap-3 text-sm py-1">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-zinc-300 truncate">{exp.description}</span>
                          <span className="text-xs text-zinc-500 bg-zinc-900 border border-zinc-800 rounded-full px-2 py-0.5 flex-shrink-0">{exp.category}</span>
                        </div>
                        <span className="text-red-400 font-mono flex-shrink-0">−{fmtRM(Number(exp.amount))}</span>
                        <button onClick={() => deleteExpense(exp.id)}
                          className="text-zinc-600 hover:text-red-400 text-xs px-1">✕</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {(r.pendingCount > 0 || r.freeCount > 0) && (
                <div className="mt-3 pt-3 border-t border-zinc-800 flex gap-6 text-xs text-zinc-500">
                  {r.pendingCount > 0 && (
                    <span>⏳ {r.pendingCount} pending · {fmtRM(r.pendingRevenue)}</span>
                  )}
                  {r.freeCount > 0 && (
                    <span>🎟️ {r.freeCount} free</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
