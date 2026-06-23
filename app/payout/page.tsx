'use client'
import { Fragment, useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import type { Event } from '@/lib/supabase'
import { useRevenueHidden } from '@/lib/useRevenueHidden'

interface Affiliate {
  id: string; handle: string; name: string | null; rate: number; active: boolean
  bank_name: string | null; bank_account: string | null; bank_holder: string | null
}
interface SummaryRow {
  affiliate_id: string; handle: string; name: string | null
  buyers: number; revenue: number; commission: number
  bank_name: string | null; bank_account: string | null; bank_holder: string | null
  paid_at: string | null; paid_amount: number | null
  buyer_list: Array<{ name: string; amount: number }>
}
interface Report {
  affiliates: Affiliate[]
  summary: SummaryRow[]
  totals: { attributed_revenue: number; total_commission: number; unattributed_revenue: number }
}
interface FacilRow {
  name: string
  amount: number
  bank_name: string | null; bank_account: string | null; bank_holder: string | null
  paid_at: string | null
}
interface FacilReport {
  facilitators: FacilRow[]
  removed: { name: string }[]
  totals: { total_payout: number }
}

const rm = (n: number) => `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
function fmtDateShort(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })
}

export default function PayoutPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [eventId, setEventId] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingReport, setLoadingReport] = useState(false)
  const [msg, setMsg] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Shared global revenue-hide state
  const [revenueHidden, toggleRevenue] = useRevenueHidden()
  const display = (n: number) => revenueHidden ? 'RM ••••••' : rm(n)

  // Bank-edit modal
  const [editing, setEditing] = useState<Affiliate | null>(null)
  const [savingBank, setSavingBank] = useState(false)
  const [bankForm, setBankForm] = useState({ bank_name: '', bank_account: '', bank_holder: '' })
  function openEdit(affiliateId: string) {
    const a = report?.affiliates.find(x => x.id === affiliateId)
    if (!a) return
    setEditing(a)
    setBankForm({
      bank_name: a.bank_name ?? '',
      bank_account: a.bank_account ?? '',
      bank_holder: a.bank_holder ?? '',
    })
  }
  async function saveBank() {
    if (!editing) return
    setSavingBank(true)
    try {
      const res = await fetch('/api/affiliates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editing.id,
          bank_name: bankForm.bank_name || null,
          bank_account: bankForm.bank_account || null,
          bank_holder: bankForm.bank_holder || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setMsg(`⚠️ Failed to save bank: ${j.error || res.status}`)
        return
      }
      setEditing(null)
      loadReport()
    } finally {
      setSavingBank(false)
    }
  }

  // Add-affiliate modal
  const [adding, setAdding] = useState(false)
  const [savingNew, setSavingNew] = useState(false)
  const [newForm, setNewForm] = useState({
    handle: '', name: '', commission_rate: '10',
    bank_name: '', bank_account: '', bank_holder: '',
  })
  function openAdd() {
    setNewForm({ handle: '', name: '', commission_rate: '10', bank_name: '', bank_account: '', bank_holder: '' })
    setAdding(true)
  }
  async function createAffiliate() {
    if (!newForm.handle.trim()) { setMsg('⚠️ Handle is required'); return }
    setSavingNew(true)
    try {
      const res = await fetch('/api/affiliates?action=create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: newForm.handle.trim(),
          name: newForm.name.trim() || null,
          commission_rate: (Number(newForm.commission_rate) || 10) / 100,
          bank_name: newForm.bank_name.trim() || null,
          bank_account: newForm.bank_account.trim() || null,
          bank_holder: newForm.bank_holder.trim() || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setMsg(`⚠️ Failed to add: ${j.error || res.status}`)
        return
      }
      setAdding(false)
      setMsg(`✅ Added @${newForm.handle.trim()}`)
      loadReport()
    } finally {
      setSavingNew(false)
    }
  }

  // Mark paid / unpaid
  const [markingPaid, setMarkingPaid] = useState<string | null>(null)
  async function togglePaid(s: SummaryRow) {
    setMarkingPaid(s.affiliate_id)
    try {
      const action = s.paid_at ? 'unmark_paid' : 'mark_paid'
      const res = await fetch(`/api/affiliates?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId,
          affiliate_id: s.affiliate_id,
          amount: s.commission,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setMsg(`⚠️ ${j.error || res.status}`)
        return
      }
      loadReport()
    } finally {
      setMarkingPaid(null)
    }
  }

  useEffect(() => {
    fetch('/api/events')
      .then(r => r.json())
      .then((data: Event[]) => {
        setEvents(data)
        const upcoming = [...data]
          .filter(e => e.date && new Date(e.date).getTime() >= Date.now())
          .sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime())
        const pick = upcoming[0] || data.find(e => e.is_active) || data[0]
        if (pick) setEventId(pick.id)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const loadReport = useCallback(() => {
    if (!eventId) return
    setLoadingReport(true)
    fetch(`/api/affiliates?event_id=${eventId}`)
      .then(r => r.json())
      .then((d: Report) => setReport(d))
      .catch(() => setMsg('⚠️ Failed to load payout'))
      .finally(() => setLoadingReport(false))
  }, [eventId])
  useEffect(() => { loadReport() }, [loadReport])

  // ── Facilitator payout ──────────────────────────────────────────────
  const [facil, setFacil] = useState<FacilReport | null>(null)
  const [loadingFacil, setLoadingFacil] = useState(false)
  const [amounts, setAmounts] = useState<Record<string, string>>({})   // name → editable amount string
  const [markingFacil, setMarkingFacil] = useState<string | null>(null)

  const loadFacil = useCallback(() => {
    if (!eventId) return
    setLoadingFacil(true)
    fetch(`/api/facilitator-payouts?event_id=${eventId}`)
      .then(r => r.json())
      .then((d: FacilReport) => {
        setFacil(d)
        const next: Record<string, string> = {}
        for (const f of d.facilitators ?? []) next[f.name] = f.amount ? String(f.amount) : ''
        setAmounts(next)
      })
      .catch(() => {
        setMsg('⚠️ Failed to load facilitator payout')
        setFacil({ facilitators: [], removed: [], totals: { total_payout: 0 } })
      })
      .finally(() => setLoadingFacil(false))
  }, [eventId])
  useEffect(() => { loadFacil() }, [loadFacil])

  async function saveFacilAmount(f: FacilRow) {
    const raw = amounts[f.name] ?? ''
    const amount = Number(raw || 0)
    if (!Number.isFinite(amount) || amount < 0) { setMsg('⚠️ Enter a valid amount'); return }
    if (amount === f.amount) return   // unchanged — skip
    const res = await fetch('/api/facilitator-payouts?action=save_amount', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: eventId, name: f.name, amount }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setMsg(`⚠️ ${j.error || res.status}`)
      return
    }
    loadFacil()
  }

  async function togglePaidFacil(f: FacilRow) {
    setMarkingFacil(f.name)
    try {
      const isPaid = !!f.paid_at
      const action = isPaid ? 'unmark_paid' : 'mark_paid'
      const res = await fetch(`/api/facilitator-payouts?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId, name: f.name, amount: Number(amounts[f.name] || f.amount || 0) }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setMsg(`⚠️ ${j.error || res.status}`)
        return
      }
      loadFacil()
    } finally {
      setMarkingFacil(null)
    }
  }

  // Facilitator bank-edit modal
  const [editingFacil, setEditingFacil] = useState<FacilRow | null>(null)
  const [savingFacilBank, setSavingFacilBank] = useState(false)
  const [facilBankForm, setFacilBankForm] = useState({ bank_name: '', bank_account: '', bank_holder: '' })
  function openFacilEdit(f: FacilRow) {
    setEditingFacil(f)
    setFacilBankForm({
      bank_name: f.bank_name ?? '',
      bank_account: f.bank_account ?? '',
      bank_holder: f.bank_holder ?? '',
    })
  }
  async function saveFacilBank() {
    if (!editingFacil) return
    setSavingFacilBank(true)
    try {
      const res = await fetch('/api/facilitator-payouts?action=save_bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId,
          name: editingFacil.name,
          bank_name: facilBankForm.bank_name || null,
          bank_account: facilBankForm.bank_account || null,
          bank_holder: facilBankForm.bank_holder || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setMsg(`⚠️ Failed to save bank: ${j.error || res.status}`)
        return
      }
      setEditingFacil(null)
      loadFacil()
    } finally {
      setSavingFacilBank(false)
    }
  }

  // Remove from / restore to the payout list
  const [showRemoved, setShowRemoved] = useState(false)
  async function hideFacil(f: FacilRow) {
    if (f.paid_at && !confirm(`${f.name} is marked paid. Remove from the payout list anyway? Their tracked cost will be removed.`)) return
    setMarkingFacil(f.name)
    try {
      const res = await fetch('/api/facilitator-payouts?action=hide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId, name: f.name }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setMsg(`⚠️ ${j.error || res.status}`)
        return
      }
      loadFacil()
    } finally {
      setMarkingFacil(null)
    }
  }
  async function restoreFacil(name: string) {
    const res = await fetch('/api/facilitator-payouts?action=restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: eventId, name }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setMsg(`⚠️ ${j.error || res.status}`)
      return
    }
    loadFacil()
  }

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  if (loading) return <div className="text-zinc-500 text-center py-12">Loading events…</div>

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-bold">💸 Affiliate Payout</h1>
            <p className="text-xs text-zinc-500">Who to pay, how much, and which bank account</p>
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
          <select value={eventId} onChange={e => setEventId(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
            {events.map(e => (
              <option key={e.id} value={e.id}>{e.name}{e.is_active ? ' (Active)' : ''}</option>
            ))}
          </select>
          <button onClick={openAdd}
            className="bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm px-4 py-2 rounded-lg">
            + Add Affiliate
          </button>
          <Link href="/affiliates" className="text-xs text-zinc-500 hover:text-amber-400 border border-zinc-700 rounded-lg px-3 py-2">
            ← Attribution
          </Link>
        </div>
      </div>

      {msg && <div className="text-sm text-zinc-300 bg-[#111] border border-zinc-800 rounded-lg px-4 py-2">{msg}</div>}

      {loadingReport || !report ? (
        <div className="text-zinc-500 text-center py-12">Loading payout…</div>
      ) : (
        <>
          {/* Totals strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-[#111] border border-zinc-800 rounded-xl p-4">
              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Attributed revenue</p>
              <p className="text-2xl font-bold">{display(report.totals.attributed_revenue)}</p>
            </div>
            <div className="bg-[#111] border border-amber-500/40 rounded-xl p-4">
              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Total payout (10%)</p>
              <p className="text-2xl font-bold text-amber-400">{display(report.totals.total_commission)}</p>
            </div>
            <div className="bg-[#111] border border-zinc-800 rounded-xl p-4">
              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Unattributed</p>
              <p className="text-2xl font-bold text-zinc-400">{display(report.totals.unattributed_revenue)}</p>
            </div>
          </div>

          {/* Affiliate payout table */}
          {report.summary.length === 0 ? (
            <div className="text-zinc-500 text-sm bg-[#111] border border-zinc-800 rounded-xl p-5">
              No attributed affiliates yet. Go to <Link href="/affiliates" className="text-amber-400 hover:underline">Affiliates</Link> to assign buyers, or click <span className="text-amber-400">+ Add Affiliate</span> above to create new ones.
            </div>
          ) : (
            <div className="bg-[#111] border border-zinc-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
                      <th className="px-4 py-3 w-6"></th>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Buyers / Revenue</th>
                      <th className="px-4 py-3 text-right">Commission (10%)</th>
                      <th className="px-4 py-3">Bank Details</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.summary.map(s => {
                      const isPaid = !!s.paid_at
                      const isOpen = expanded.has(s.affiliate_id)
                      return (
                        <Fragment key={s.affiliate_id}>
                          <tr
                            className={`border-b border-zinc-900 hover:bg-zinc-900/40 ${isPaid ? 'opacity-60' : ''}`}
                          >
                            <td className="px-4 py-3 align-top">
                              <button
                                onClick={() => toggleExpand(s.affiliate_id)}
                                title={isOpen ? 'Hide buyers' : 'Show buyers'}
                                className="text-zinc-500 hover:text-amber-400 text-sm"
                              >
                                {isOpen ? '▾' : '▸'}
                              </button>
                            </td>
                            <td className="px-4 py-3 align-top">
                              <div className="font-semibold text-white flex items-center gap-2 flex-wrap">
                                {s.handle}
                                {isPaid && (
                                  <span className="text-[10px] bg-emerald-900/50 text-emerald-300 px-1.5 py-0.5 rounded">
                                    ✓ PAID {fmtDateShort(s.paid_at)}
                                  </span>
                                )}
                              </div>
                              {s.name && <div className="text-xs text-zinc-500">{s.name}</div>}
                            </td>
                            <td className="px-4 py-3 align-top">
                              <div className="text-zinc-300">{s.buyers} buyer{s.buyers !== 1 ? 's' : ''}</div>
                              <div className="text-xs text-zinc-500">{display(s.revenue)}</div>
                            </td>
                            <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                              <div className="font-bold text-amber-400 text-lg">{display(s.commission)}</div>
                            </td>
                            <td className="px-4 py-3 align-top text-xs">
                              {s.bank_name || s.bank_account || s.bank_holder ? (
                                <div className="leading-tight">
                                  <div className="text-zinc-300 font-medium">{s.bank_name || '—'}</div>
                                  <div className="font-mono text-zinc-400">{s.bank_account || '—'}</div>
                                  <div className="text-zinc-500">{s.bank_holder || '—'}</div>
                                </div>
                              ) : (
                                <button onClick={() => openEdit(s.affiliate_id)} className="text-zinc-600 hover:text-amber-400">
                                  + Add bank account
                                </button>
                              )}
                            </td>
                            <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                              <div className="flex flex-col gap-1 items-end">
                                <button
                                  onClick={() => togglePaid(s)}
                                  disabled={markingPaid === s.affiliate_id}
                                  className={`text-xs font-semibold px-3 py-1.5 rounded transition-colors ${
                                    isPaid
                                      ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                                      : 'bg-emerald-600/80 hover:bg-emerald-500 text-white'
                                  } disabled:opacity-50`}
                                >
                                  {markingPaid === s.affiliate_id
                                    ? 'Saving…'
                                    : isPaid
                                      ? '↩ Unmark'
                                      : '✓ Mark paid'}
                                </button>
                                <button
                                  onClick={() => openEdit(s.affiliate_id)}
                                  title="Edit bank details"
                                  className="text-[10px] text-zinc-500 hover:text-amber-400"
                                >
                                  ✎ edit bank
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="bg-[#0a0a0a] border-b border-zinc-900">
                              <td className="px-4 py-3"></td>
                              <td colSpan={5} className="px-4 py-3 text-xs">
                                <div className="text-zinc-500 uppercase tracking-wider text-[10px] mb-1">Buyers attributed</div>
                                <div className="space-y-0.5">
                                  {s.buyer_list.map((b, i) => (
                                    <div key={i} className="flex justify-between max-w-md text-zinc-400">
                                      <span>{i + 1}. {b.name}</span>
                                      <span className="font-mono">{display(b.amount)}</span>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Facilitator payout ────────────────────────────────────── */}
      <div className="pt-2">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-lg font-bold">🧑‍🏫 Facilitator Payout</h2>
        </div>
        <p className="text-xs text-zinc-500 mb-4">Type what to pay each facilitator for this event, then mark paid</p>

        {loadingFacil || !facil ? (
          <div className="text-zinc-500 text-center py-8">Loading facilitators…</div>
        ) : facil.facilitators.length === 0 ? (
          <div className="text-zinc-500 text-sm bg-[#111] border border-zinc-800 rounded-xl p-5">
            No facilitators recorded for this event yet. Facilitators are pulled from the event&apos;s attendee list.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <div className="bg-[#111] border border-amber-500/40 rounded-xl p-4">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Total facilitator payout</p>
                <p className="text-2xl font-bold text-amber-400">{display(facil.totals.total_payout)}</p>
              </div>
            </div>

            <div className="bg-[#111] border border-zinc-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3">Bank Details</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {facil.facilitators.map(f => {
                      const isPaid = !!f.paid_at
                      return (
                        <tr key={f.name} className={`border-b border-zinc-900 hover:bg-zinc-900/40 ${isPaid ? 'opacity-60' : ''}`}>
                          <td className="px-4 py-3 align-top">
                            <div className="font-semibold text-white flex items-center gap-2 flex-wrap">
                              {f.name}
                              {isPaid && (
                                <span className="text-[10px] bg-emerald-900/50 text-emerald-300 px-1.5 py-0.5 rounded">
                                  ✓ PAID {fmtDateShort(f.paid_at)}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                            {isPaid ? (
                              <div className="font-bold text-amber-400 text-lg">{display(f.amount)}</div>
                            ) : (
                              <div className="flex items-center justify-end gap-1">
                                <span className="text-zinc-500 text-xs">RM</span>
                                <input
                                  type="number" min={0} step="0.01" inputMode="decimal"
                                  value={amounts[f.name] ?? ''}
                                  placeholder="0.00"
                                  onChange={e => setAmounts(prev => ({ ...prev, [f.name]: e.target.value }))}
                                  onBlur={() => saveFacilAmount(f)}
                                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                                  className="w-24 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-amber-400 font-semibold text-right text-sm font-mono focus:border-amber-500 outline-none"
                                />
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 align-top text-xs">
                            {f.bank_name || f.bank_account || f.bank_holder ? (
                              <div className="leading-tight">
                                <div className="text-zinc-300 font-medium">{f.bank_name || '—'}</div>
                                <div className="font-mono text-zinc-400">{f.bank_account || '—'}</div>
                                <div className="text-zinc-500">{f.bank_holder || '—'}</div>
                              </div>
                            ) : (
                              <button onClick={() => openFacilEdit(f)} className="text-zinc-600 hover:text-amber-400">
                                + Add bank account
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                            <div className="flex flex-col gap-1 items-end">
                              <button
                                onClick={() => togglePaidFacil(f)}
                                disabled={markingFacil === f.name}
                                className={`text-xs font-semibold px-3 py-1.5 rounded transition-colors ${
                                  isPaid
                                    ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                                    : 'bg-emerald-600/80 hover:bg-emerald-500 text-white'
                                } disabled:opacity-50`}
                              >
                                {markingFacil === f.name ? 'Saving…' : isPaid ? '↩ Unmark' : '✓ Mark paid'}
                              </button>
              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => openFacilEdit(f)}
                                  title="Edit bank details"
                                  className="text-[10px] text-zinc-500 hover:text-amber-400"
                                >
                                  ✎ edit bank
                                </button>
                                <button
                                  onClick={() => hideFacil(f)}
                                  disabled={markingFacil === f.name}
                                  title="Remove from payout list"
                                  className="text-[10px] text-zinc-600 hover:text-red-400 disabled:opacity-50"
                                >
                                  ✕ remove
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Removed-from-payout list (reversible) */}
            {facil.removed.length > 0 && (
              <div className="mt-3 text-xs">
                <button
                  onClick={() => setShowRemoved(v => !v)}
                  className="text-zinc-500 hover:text-amber-400"
                >
                  {showRemoved ? '▾' : '▸'} Removed from payout ({facil.removed.length})
                </button>
                {showRemoved && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {facil.removed.map(r => (
                      <span key={r.name} className="inline-flex items-center gap-1.5 bg-[#111] border border-zinc-800 rounded-lg px-2.5 py-1 text-zinc-400">
                        {r.name}
                        <button onClick={() => restoreFacil(r.name)} title="Add back to payout list" className="text-zinc-600 hover:text-emerald-400">↩ restore</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Facilitator bank-details edit modal ───────────────────── */}
      {editingFacil && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4" onClick={() => setEditingFacil(null)}>
          <div className="bg-[#111] border border-zinc-800 rounded-xl w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white">
                Bank details · <span className="text-amber-400">{editingFacil.name}</span>
              </h3>
              <button onClick={() => setEditingFacil(null)} className="text-zinc-500 hover:text-white text-lg">×</button>
            </div>
            <div className="space-y-3">
              <Field label="Bank name" value={facilBankForm.bank_name} onChange={v => setFacilBankForm({ ...facilBankForm, bank_name: v })} placeholder="Maybank, CIMB, Public Bank…" />
              <Field label="Bank account" value={facilBankForm.bank_account} onChange={v => setFacilBankForm({ ...facilBankForm, bank_account: v })} placeholder="1234 5678 9012" mono />
              <Field label="Account holder" value={facilBankForm.bank_holder} onChange={v => setFacilBankForm({ ...facilBankForm, bank_holder: v })} placeholder="Full name as registered with bank" />
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setEditingFacil(null)} className="text-sm text-zinc-400 hover:text-white px-4 py-2 rounded-lg border border-zinc-700">Cancel</button>
              <button onClick={saveFacilBank} disabled={savingFacilBank} className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-sm font-semibold px-4 py-2 rounded-lg">
                {savingFacilBank ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bank-details edit modal ───────────────────────────────── */}
      {editing && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4" onClick={() => setEditing(null)}>
          <div className="bg-[#111] border border-zinc-800 rounded-xl w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white">
                Bank details · <span className="text-amber-400">{editing.handle}</span>
              </h3>
              <button onClick={() => setEditing(null)} className="text-zinc-500 hover:text-white text-lg">×</button>
            </div>
            <div className="space-y-3">
              <Field label="Bank name" value={bankForm.bank_name} onChange={v => setBankForm({ ...bankForm, bank_name: v })} placeholder="Maybank, CIMB, Public Bank…" />
              <Field label="Bank account" value={bankForm.bank_account} onChange={v => setBankForm({ ...bankForm, bank_account: v })} placeholder="1234 5678 9012" mono />
              <Field label="Account holder" value={bankForm.bank_holder} onChange={v => setBankForm({ ...bankForm, bank_holder: v })} placeholder="Full name as registered with bank" />
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setEditing(null)} className="text-sm text-zinc-400 hover:text-white px-4 py-2 rounded-lg border border-zinc-700">Cancel</button>
              <button onClick={saveBank} disabled={savingBank} className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-sm font-semibold px-4 py-2 rounded-lg">
                {savingBank ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add affiliate modal ──────────────────────────────────── */}
      {adding && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4" onClick={() => setAdding(false)}>
          <div className="bg-[#111] border border-zinc-800 rounded-xl w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white">+ New affiliate</h3>
              <button onClick={() => setAdding(false)} className="text-zinc-500 hover:text-white text-lg">×</button>
            </div>
            <div className="space-y-3">
              <Field label="Handle / IG name *" value={newForm.handle} onChange={v => setNewForm({ ...newForm, handle: v })} placeholder="e.g. queenie7946" required />
              <Field label="Real name" value={newForm.name} onChange={v => setNewForm({ ...newForm, name: v })} placeholder="Wong Qiao Ying" />
              <div>
                <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Commission rate (%)</label>
                <input type="number" min={0} max={100} step={0.1}
                  value={newForm.commission_rate}
                  onChange={e => setNewForm({ ...newForm, commission_rate: e.target.value })}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm"
                />
              </div>
              <div className="pt-2 border-t border-zinc-800">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Bank (optional, can fill later)</p>
                <div className="space-y-3">
                  <Field label="Bank name" value={newForm.bank_name} onChange={v => setNewForm({ ...newForm, bank_name: v })} placeholder="Maybank, CIMB…" />
                  <Field label="Bank account" value={newForm.bank_account} onChange={v => setNewForm({ ...newForm, bank_account: v })} placeholder="1234 5678 9012" mono />
                  <Field label="Account holder" value={newForm.bank_holder} onChange={v => setNewForm({ ...newForm, bank_holder: v })} placeholder="Full name" />
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setAdding(false)} className="text-sm text-zinc-400 hover:text-white px-4 py-2 rounded-lg border border-zinc-700">Cancel</button>
              <button onClick={createAffiliate} disabled={savingNew || !newForm.handle.trim()} className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-sm font-semibold px-4 py-2 rounded-lg">
                {savingNew ? 'Creating…' : 'Create affiliate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Reusable input field ──────────────────────────────────────────────
function Field({ label, value, onChange, placeholder, mono, required }: {
  label: string; value: string; onChange: (v: string) => void
  placeholder?: string; mono?: boolean; required?: boolean
}) {
  return (
    <div>
      <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className={`w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm ${mono ? 'font-mono' : ''}`}
      />
    </div>
  )
}
