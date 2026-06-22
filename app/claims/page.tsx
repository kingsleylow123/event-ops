'use client'
import { useCallback, useEffect, useState } from 'react'
import type { Event } from '@/lib/supabase'
import { rm } from '@/lib/finance'
import { resolveInitialEvent } from '@/lib/event'
import { useCachedFetch } from '@/lib/useCachedFetch'

type Status = 'pending' | 'approved' | 'paid' | 'rejected'
type Claim = {
  id: string
  event_id: string
  event_name: string
  claimant_name: string
  claimant_phone: string | null
  description: string
  category: string
  amount: number
  status: Status
  expense_id: string | null
  submitted_at: string
  paid_at: string | null
  notes: string | null
  receipt_url: string | null
}

const STATUS_COLORS: Record<Status, string> = {
  pending: 'bg-yellow-900/40 text-yellow-400 border border-yellow-800',
  approved: 'bg-blue-900/40 text-blue-400 border border-blue-800',
  paid: 'bg-green-900/40 text-green-400 border border-green-800',
  rejected: 'bg-zinc-800 text-zinc-400 border border-zinc-700',
}
const STATUS_ORDER: Status[] = ['pending', 'approved', 'paid', 'rejected']
const fmtDate = (ts: string | null) =>
  ts ? new Date(ts).toLocaleDateString('en-MY', { dateStyle: 'medium' }) : '—'

export default function ClaimsPage() {
  const { data: eventsData } = useCachedFetch<Event[]>('events', '/api/events')
  const [events, setEvents] = useState<Event[]>([])
  const [claims, setClaims] = useState<Claim[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<'open' | 'paid' | 'rejected'>('open')

  const [form, setForm] = useState({ event_id: '', amount: '' })
  const [uploadingId, setUploadingId] = useState<string | null>(null)

  const load = useCallback(async (): Promise<Claim[]> => {
    try {
      const res = await fetch('/api/claims?event_id=all', { cache: 'no-store' })
      if (res.ok) {
        const data: Claim[] = await res.json()
        setClaims(data)
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

  // Default the picker to a pending-payment event when one exists, else fall
  // back to the resolved active event. Never overrides a manual selection.
  useEffect(() => {
    setForm(f => {
      if (f.event_id && events.some(e => e.id === f.event_id)) return f
      const openIds = new Set(
        claims.filter(c => c.status === 'pending' || c.status === 'approved').map(c => c.event_id)
      )
      const resolved = resolveInitialEvent(events)
      const pendingPick = resolved && openIds.has(resolved.id)
        ? resolved
        : events.find(e => openIds.has(e.id))
      const pick = pendingPick ?? resolved ?? events[0]
      return { ...f, event_id: pick?.id ?? '' }
    })
  }, [events, claims])

  // Amount tracks the picked event's open-claim total. Editable after.
  useEffect(() => {
    if (!form.event_id) return
    const total = claims
      .filter(c => c.event_id === form.event_id && (c.status === 'pending' || c.status === 'approved'))
      .reduce((s, c) => s + c.amount, 0)
    setForm(f => ({ ...f, amount: total > 0 ? total.toFixed(2) : '' }))
  }, [form.event_id, claims])

  // On every load: show what's tracked, then sync claims from event expenses
  // (de-duped — only adds expenses not already claimed, preserves your edits).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await load()
      if (cancelled) return
      try {
        const res = await fetch('/api/claims/import', {
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

  async function addClaim(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (!form.event_id) { setErr('Pick an event.'); return }
    const amt = Number(form.amount)
    if (!Number.isFinite(amt) || amt <= 0) { setErr('Enter a valid amount.'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: form.event_id,
          description: 'Manual claim',
          amount: amt,
        }),
      })
      const j = await res.json()
      if (!res.ok) { setErr(j.error || 'Failed to add claim.'); return }
      setForm(f => ({ ...f, amount: '' }))
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function setStatus(c: Claim, status: Status) {
    setClaims(prev => prev.map(x => (x.id === c.id ? { ...x, status } : x)))
    await fetch('/api/claims', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: c.id, status }),
    })
    await load()
  }

  async function uploadReceipt(c: Claim, file: File) {
    setUploadingId(c.id)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/claims/${c.id}/receipt`, { method: 'POST', body: fd })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        window.alert(j.error || 'Failed to upload receipt.')
        return
      }
      await load()
    } finally {
      setUploadingId(null)
    }
  }

  async function removeReceipt(c: Claim) {
    if (!window.confirm('Remove this receipt?')) return
    setUploadingId(c.id)
    try {
      await fetch(`/api/claims/${c.id}/receipt`, { method: 'DELETE' })
      await load()
    } finally {
      setUploadingId(null)
    }
  }

  async function deleteClaim(id: string) {
    if (!window.confirm('Remove this claim? (Your expense record is not affected.)')) return
    await fetch(`/api/claims?id=${id}`, { method: 'DELETE' })
    await load()
  }

  const openAll = claims.filter(c => c.status === 'pending' || c.status === 'approved')
  const pendingPaymentEventIds = new Set(openAll.map(c => c.event_id))
  const pendingEvents = events.filter(e => pendingPaymentEventIds.has(e.id))
  const scoped = form.event_id ? claims.filter(c => c.event_id === form.event_id) : claims
  const open = scoped.filter(c => c.status === 'pending' || c.status === 'approved')
  const paidClaims = scoped.filter(c => c.status === 'paid')
  const rejectedClaims = scoped.filter(c => c.status === 'rejected')
  const toReimburse = open.reduce((s, c) => s + c.amount, 0)
  const reimbursed = paidClaims.reduce((s, c) => s + c.amount, 0)
  const shown = tab === 'open' ? open : tab === 'paid' ? paidClaims : rejectedClaims
  const selectedEventName = events.find(e => e.id === form.event_id)?.name

  if (loading && !claims.length) {
    return <div className="text-zinc-500 mt-20 text-center">Loading…</div>
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold">Claims</h1>
        <p className="text-sm text-zinc-400">Event spending to reimburse · {selectedEventName ?? 'all events'}</p>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[#111] border border-amber-500/50 rounded-xl px-4 py-3">
          <p className="text-xs text-zinc-500 mb-0.5">To reimburse</p>
          <p className="text-xl font-bold text-amber-400">{rm(toReimburse)}</p>
        </div>
        <div className="bg-[#111] border border-zinc-800 rounded-xl px-4 py-3">
          <p className="text-xs text-zinc-500 mb-0.5">Open</p>
          <p className="text-xl font-bold text-white">{open.length}</p>
        </div>
        <div className="bg-[#111] border border-zinc-800 rounded-xl px-4 py-3">
          <p className="text-xs text-zinc-500 mb-0.5">Reimbursed</p>
          <p className="text-xl font-bold text-green-400">{rm(reimbursed)}</p>
        </div>
      </div>

      {/* Add manual claim */}
      <form onSubmit={addClaim} className="bg-[#111] border border-zinc-800 rounded-xl p-4 flex flex-wrap gap-2 items-start">
        <select value={form.event_id} onChange={e => setForm(f => ({ ...f, event_id: e.target.value }))}
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm flex-1 min-w-[200px] cursor-pointer focus:border-amber-500 focus:outline-none">
          {pendingEvents.length === 0
            ? <option value="" disabled>No pending-payment events</option>
            : pendingEvents.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
        </select>
        <input value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
          placeholder="Amount (RM)" inputMode="decimal"
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm w-32" />
        <button type="submit" disabled={saving}
          className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold text-sm px-4 py-2 rounded-lg">
          {saving ? 'Adding…' : '+ Add Claim'}
        </button>
        {err
          ? <p className="w-full text-xs text-red-400">{err}</p>
          : <p className="w-full text-xs text-zinc-600">Event expenses are pulled in automatically.</p>}
      </form>

      {/* Tabs — paid claims move into Reimbursed */}
      <div className="flex gap-1">
        {([['open', 'Open', open.length], ['paid', 'Reimbursed', paidClaims.length], ['rejected', 'Rejected', rejectedClaims.length]] as const).map(([key, label, count]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${tab === key ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>
            {label}<span className="ml-1.5 text-xs text-zinc-500">{count}</span>
          </button>
        ))}
      </div>

      {/* List */}
      <div className="bg-[#111] border border-zinc-800 rounded-xl overflow-x-auto">
        {shown.length === 0 ? (
          <p className="text-zinc-600 text-sm p-6 text-center">No {tab === 'open' ? 'open' : tab === 'paid' ? 'reimbursed' : 'rejected'} claims.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500 border-b border-zinc-800">
                <th className="px-4 py-3">For</th>
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Receipt</th>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(c => (
                <tr key={c.id} className="border-b border-zinc-900 hover:bg-zinc-900/30">
                  <td className="px-4 py-3 font-medium">{c.description}</td>
                  <td className="px-4 py-3 text-zinc-500">{c.event_name}</td>
                  <td className="px-4 py-3 text-right font-mono">{rm(c.amount)}</td>
                  <td className="px-4 py-3">
                    {c.receipt_url ? (
                      <div className="flex items-center gap-2">
                        <a href={c.receipt_url} target="_blank" rel="noopener noreferrer"
                          className="block w-10 h-10 rounded overflow-hidden bg-zinc-900 border border-zinc-700 hover:border-amber-500">
                          {/\.pdf$/i.test(c.receipt_url)
                            ? <span className="flex items-center justify-center w-full h-full text-[10px] text-zinc-400">PDF</span>
                            : <img src={c.receipt_url} alt="receipt" className="w-full h-full object-cover" />}
                        </a>
                        <button onClick={() => removeReceipt(c)} disabled={uploadingId === c.id}
                          className="text-zinc-600 hover:text-red-400 text-xs disabled:opacity-50" title="Remove receipt">✕</button>
                      </div>
                    ) : (
                      <label className={`text-xs cursor-pointer ${uploadingId === c.id ? 'text-zinc-500' : 'text-zinc-600 hover:text-amber-400'}`}>
                        {uploadingId === c.id ? 'Uploading…' : '+ add'}
                        <input type="file" accept="image/*,application/pdf" className="hidden"
                          disabled={uploadingId === c.id}
                          onChange={e => { const f = e.target.files?.[0]; if (f) uploadReceipt(c, f); e.target.value = '' }} />
                      </label>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">{fmtDate(c.submitted_at)}</td>
                  <td className="px-4 py-3">
                    <select value={c.status} onChange={e => setStatus(c, e.target.value as Status)}
                      className={`text-xs px-2 py-1 rounded-full font-medium cursor-pointer ${STATUS_COLORS[c.status]}`}>
                      {STATUS_ORDER.map(s => <option key={s} value={s} className="bg-zinc-900 text-white">{s}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => deleteClaim(c.id)} className="text-zinc-600 hover:text-red-400 text-xs">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-zinc-600">
        Claims are pulled automatically from your event expenses. Set <span className="text-zinc-400">Paid by</span> to record who to
        reimburse, and mark <span className="text-green-400">paid</span> once they&apos;re reimbursed.
      </p>
    </div>
  )
}
