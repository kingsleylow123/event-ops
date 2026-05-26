'use client'
import { useEffect, useMemo, useState } from 'react'
import type { Event, Attendee, Expense, ExpenseCategory } from '@/lib/supabase'
import { EXPENSE_CATEGORIES } from '@/lib/supabase'

function fmtRM(n: number): string {
  const sign = n < 0 ? '-' : ''
  return `${sign}RM ${Math.abs(n).toLocaleString('en-MY', { maximumFractionDigits: 0 })}`
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

export default function RevenuePage() {
  const [events, setEvents] = useState<Event[]>([])
  const [attendees, setAttendees] = useState<Attendee[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [addingForEvent, setAddingForEvent] = useState<string | null>(null)
  const [form, setForm] = useState({ description: '', amount: '', category: 'Other' as string })
  const [saving, setSaving] = useState(false)

  async function loadAll() {
    try {
      const [evRes, attRes, expRes] = await Promise.all([
        fetch('/api/events'),
        fetch('/api/attendees'),
        fetch('/api/expenses'),
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

  const byEvent: EventRevenue[] = useMemo(() => {
    return events.map(ev => {
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
  }, [events, attendees, expenses])

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
        <p className="text-sm text-zinc-500">Gross revenue · expenses · profit per event</p>
      </div>

      {/* Grand total card */}
      <div className="bg-[#111] border border-amber-500/40 rounded-xl p-5">
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
            <div key={r.event.id} className={`bg-[#111] border rounded-xl p-5 ${r.event.is_active ? 'border-amber-500/50' : 'border-zinc-800'}`}>
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
                      <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                        className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
                        {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
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
