'use client'
import { useCallback, useEffect, useState } from 'react'
import type { Event } from '@/lib/supabase'
import { toWhatsApp } from '@/lib/supabase'
import { rm } from '@/lib/finance'
import { resolveInitialEvent } from '@/lib/event'
import { useCachedFetch } from '@/lib/useCachedFetch'

type Status = 'partial' | 'paid' | 'refunded'
type Deposit = {
  id: string
  event_id: string
  event_name: string
  name: string
  phone: string | null
  total_amount: number
  deposit_paid: number
  balance: number
  overdue: boolean
  due_date: string | null
  status: Status
  notes: string | null
  paid_at: string | null
  created_at: string
}

const STATUS_COLORS: Record<Status, string> = {
  partial: 'bg-yellow-900/40 text-yellow-400 border border-yellow-800',
  paid: 'bg-green-900/40 text-green-400 border border-green-800',
  refunded: 'bg-red-900/40 text-red-400 border border-red-800',
}
const STATUS_ORDER: Status[] = ['partial', 'paid', 'refunded']
const fmtDate = (ts: string | null) =>
  ts ? new Date(ts).toLocaleDateString('en-MY', { dateStyle: 'medium' }) : '—'

// Due-date display: red when overdue, a countdown while a balance is owed.
function dueInfo(d: Deposit): { text: string; cls: string } {
  if (!d.due_date) return { text: '—', cls: 'text-zinc-500' }
  const date = fmtDate(d.due_date)
  if (d.overdue) return { text: `${date} · overdue`, cls: 'text-red-400' }
  if (d.status === 'partial') {
    const days = Math.ceil((new Date(d.due_date + 'T00:00:00').getTime() - Date.now()) / 86400000)
    return { text: `${date} · ${days}d left`, cls: days <= 3 ? 'text-yellow-400' : 'text-zinc-400' }
  }
  return { text: date, cls: 'text-zinc-400' }
}

export default function DepositsPage() {
  const { data: eventsData } = useCachedFetch<Event[]>('events', '/api/events')
  const [events, setEvents] = useState<Event[]>([])
  const [deposits, setDeposits] = useState<Deposit[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const [form, setForm] = useState({ event_id: '', name: '', total_amount: '', deposit_paid: '', due_date: '' })
  const [tab, setTab] = useState<'partial' | 'paid' | 'refunded'>('partial')

  // Always all events — no scope filter.
  const load = useCallback(async (): Promise<Deposit[]> => {
    try {
      const res = await fetch('/api/deposits?event_id=all', { cache: 'no-store' })
      if (res.ok) {
        const data: Deposit[] = await res.json()
        setDeposits(data)
        return data
      }
    } catch {
      // keep last good data
    } finally {
      setLoading(false)
    }
    return []
  }, [])

  useEffect(() => {
    if (eventsData) setEvents(eventsData)
  }, [eventsData])

  // Manual deposits attach to the active event (no picker).
  useEffect(() => {
    setForm(f => (f.event_id && events.some(e => e.id === f.event_id))
      ? f
      : { ...f, event_id: resolveInitialEvent(events)?.id ?? events[0]?.id ?? '' })
  }, [events])

  // On every load: show what's tracked, then pull in any new pending attendees
  // (import is de-duped — only adds people not already tracked, never edits
  // existing rows), and reload if anything new came in.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await load()
      if (cancelled) return
      try {
        const res = await fetch('/api/deposits/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event_id: 'all' }),
        })
        if (res.ok && !cancelled) {
          const j = await res.json()
          if (j.imported || j.updated) await load()
        }
      } catch {
        // ignore — manual add still works
      }
    })()
    return () => { cancelled = true }
  }, [load])

  async function addDeposit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (!form.event_id) { setErr('Pick an event.'); return }
    if (!form.name.trim()) { setErr('Enter a name.'); return }
    const total = Number(form.total_amount)
    if (!Number.isFinite(total) || total <= 0) { setErr('Enter a valid total amount.'); return }
    const paid = form.deposit_paid === '' ? 0 : Number(form.deposit_paid)
    if (!Number.isFinite(paid) || paid < 0) { setErr('Deposit must be 0 or more.'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/deposits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: form.event_id,
          name: form.name.trim(),
          total_amount: total,
          deposit_paid: paid,
          due_date: form.due_date || null,
        }),
      })
      const j = await res.json()
      if (!res.ok) { setErr(j.error || 'Failed to add deposit.'); return }
      setForm(f => ({ ...f, name: '', total_amount: '', deposit_paid: '', due_date: '' }))
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function recordPayment(d: Deposit) {
    const raw = window.prompt(`Add a payment for ${d.name} (RM). Balance: ${rm(d.balance)}`)
    if (raw === null) return
    const amt = Number(raw)
    if (!Number.isFinite(amt) || amt <= 0) return
    await fetch('/api/deposits', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: d.id, deposit_paid: Math.round((d.deposit_paid + amt) * 100) / 100 }),
    })
    await load()
  }

  async function setStatus(d: Deposit, status: Status) {
    if (status === d.status) return
    // Refund / un-refund are big money moves — confirm before changing either way
    // so a stray tap on the status dropdown can't silently flip someone's deposit.
    if (status === 'refunded' || d.status === 'refunded') {
      const verb = status === 'refunded' ? 'mark as refunded' : `change from refunded to "${status}"`
      if (!window.confirm(`${verb} for ${d.name} (RM ${d.deposit_paid})?`)) return
    }
    setDeposits(prev => prev.map(x => (x.id === d.id ? { ...x, status } : x)))
    await fetch('/api/deposits', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: d.id, status }),
    })
    await load()
  }

  async function deleteDeposit(id: string) {
    if (!window.confirm('Delete this deposit record?')) return
    await fetch(`/api/deposits?id=${id}`, { method: 'DELETE' })
    await load()
  }

  const open = deposits.filter(d => d.status === 'partial')
  const paidList = deposits.filter(d => d.status === 'paid')
  const refundedList = deposits.filter(d => d.status === 'refunded')
  const outstanding = open.reduce((s, d) => s + d.balance, 0)
  const overdueCount = open.filter(d => d.overdue).length
  const shown = tab === 'partial' ? open : tab === 'paid' ? paidList : refundedList

  if (loading && !deposits.length) {
    return <div className="text-zinc-500 mt-20 text-center">Loading…</div>
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold">Deposits</h1>
        <p className="text-sm text-zinc-400">Outstanding balances · all events</p>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[#111] border border-amber-500/50 rounded-xl px-4 py-3">
          <p className="text-xs text-zinc-500 mb-0.5">Outstanding balance</p>
          <p className="text-xl font-bold text-amber-400">{rm(outstanding)}</p>
        </div>
        <div className="bg-[#111] border border-zinc-800 rounded-xl px-4 py-3">
          <p className="text-xs text-zinc-500 mb-0.5">Open</p>
          <p className="text-xl font-bold text-white">{open.length}</p>
        </div>
        <div className="bg-[#111] border border-zinc-800 rounded-xl px-4 py-3">
          <p className="text-xs text-zinc-500 mb-0.5">Overdue</p>
          <p className={`text-xl font-bold ${overdueCount ? 'text-red-400' : 'text-zinc-300'}`}>{overdueCount}</p>
        </div>
      </div>

      {/* Add deposit */}
      <form onSubmit={addDeposit} className="bg-[#111] border border-zinc-800 rounded-xl p-4 flex flex-wrap gap-2 items-start">
        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="Name" className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm w-40" />
        <input value={form.total_amount} onChange={e => setForm(f => ({ ...f, total_amount: e.target.value }))}
          placeholder="Total (RM)" inputMode="decimal"
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm w-28" />
        <input value={form.deposit_paid} onChange={e => setForm(f => ({ ...f, deposit_paid: e.target.value }))}
          placeholder="Deposit (RM)" inputMode="decimal"
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm w-28" />
        <label className="flex items-center gap-1.5 text-xs text-zinc-500">
          Pay by
          <input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
        </label>
        <button type="submit" disabled={saving}
          className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold text-sm px-4 py-2 rounded-lg">
          {saving ? 'Adding…' : '+ Add Deposit'}
        </button>
        {err
          ? <p className="w-full text-xs text-red-400">{err}</p>
          : <p className="w-full text-xs text-zinc-600">Attaches to <span className="text-zinc-400">{events.find(e => e.id === form.event_id)?.name ?? '—'}</span></p>}
      </form>

      {/* Tabs — refunded deposits move into Refunded */}
      <div className="flex gap-1">
        {([['partial', 'Open', open.length], ['paid', 'Paid', paidList.length], ['refunded', 'Refunded', refundedList.length]] as const).map(([key, label, count]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${tab === key ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>
            {label}<span className="ml-1.5 text-xs text-zinc-500">{count}</span>
          </button>
        ))}
      </div>

      {/* List */}
      <div className="bg-[#111] border border-zinc-800 rounded-xl overflow-x-auto">
        {shown.length === 0 ? (
          <p className="text-zinc-600 text-sm p-6 text-center">No deposits here.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500 border-b border-zinc-800">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Deposit</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3">Pay by</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(d => {
                const due = dueInfo(d)
                const wa = toWhatsApp(d.phone)
                return (
                  <tr key={d.id} className="border-b border-zinc-900 hover:bg-zinc-900/30">
                    <td className="px-4 py-3 font-medium">{d.name}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {d.phone
                        ? (wa
                            ? <a href={wa} target="_blank" rel="noopener noreferrer" className="text-green-400 hover:text-green-300">{d.phone}</a>
                            : <span className="text-zinc-400">{d.phone}</span>)
                        : <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{d.event_name}</td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-300">{rm(d.total_amount)}</td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-400">{rm(d.deposit_paid)}</td>
                    <td className={`px-4 py-3 text-right font-mono ${d.balance > 0 ? 'text-amber-400' : 'text-green-400'}`}>{rm(d.balance)}</td>
                    <td className={`px-4 py-3 whitespace-nowrap ${due.cls}`}>{due.text}</td>
                    <td className="px-4 py-3">
                      <select value={d.status} onChange={e => setStatus(d, e.target.value as Status)}
                        className={`text-xs px-2 py-1 rounded-full font-medium cursor-pointer ${STATUS_COLORS[d.status]}`}>
                        {STATUS_ORDER.map(s => <option key={s} value={s} className="bg-zinc-900 text-white">{s}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {d.status === 'partial' && (
                        <button onClick={() => recordPayment(d)} title="Record a payment"
                          className="text-amber-400 hover:text-amber-300 text-xs mr-3">＋ pay</button>
                      )}
                      <button onClick={() => deleteDeposit(d.id)} className="text-zinc-600 hover:text-red-400 text-xs">✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-zinc-600">
        Deposit-holders are pulled in automatically from pending attendees across every event.
        Record part-payments with <span className="text-amber-400">＋ pay</span>; a deposit auto-settles to
        {' '}<span className="text-green-400">paid</span> once the balance reaches zero.
      </p>
    </div>
  )
}
