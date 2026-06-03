'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import type { Event } from '@/lib/supabase'

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

  // Shared revenue-hide state
  const [revenueHidden, setRevenueHidden] = useState(false)
  useEffect(() => {
    const saved = localStorage.getItem('revenue_hidden')
    if (saved === '1') setRevenueHidden(true)
  }, [])
  function toggleRevenue() {
    setRevenueHidden(v => {
      const next = !v
      localStorage.setItem('revenue_hidden', next ? '1' : '0')
      return next
    })
  }
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

          {/* Affiliate payout cards */}
          {report.summary.length === 0 ? (
            <div className="text-zinc-500 text-sm bg-[#111] border border-zinc-800 rounded-xl p-5">
              No attributed affiliates yet. Go to <Link href="/affiliates" className="text-amber-400 hover:underline">Affiliates</Link> to assign buyers, or click <span className="text-amber-400">+ Add Affiliate</span> above to create new ones.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {report.summary.map(s => {
                const isPaid = !!s.paid_at
                const isOpen = expanded.has(s.affiliate_id)
                return (
                  <div
                    key={s.affiliate_id}
                    className={`bg-[#111] border rounded-xl p-4 flex flex-col gap-2 transition-all ${
                      isPaid ? 'border-emerald-600/40 opacity-70' : 'border-zinc-800'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-white flex items-center gap-2">
                          {s.handle}
                          {isPaid && (
                            <span className="text-[10px] bg-emerald-900/50 text-emerald-300 px-1.5 py-0.5 rounded">
                              ✓ PAID {fmtDateShort(s.paid_at)}
                            </span>
                          )}
                        </div>
                        {s.name && <div className="text-xs text-zinc-500">{s.name}</div>}
                        <div className="text-xs text-zinc-500">{s.buyers} buyer{s.buyers !== 1 ? 's' : ''} · {display(s.revenue)}</div>
                      </div>
                      <button
                        onClick={() => openEdit(s.affiliate_id)}
                        title="Edit bank details"
                        className="text-zinc-500 hover:text-amber-400 text-sm"
                      >
                        ✎
                      </button>
                    </div>

                    <div className="text-2xl font-bold text-amber-400">{display(s.commission)}</div>

                    {/* Buyer list (collapsible) */}
                    <button
                      onClick={() => toggleExpand(s.affiliate_id)}
                      className="text-[11px] text-zinc-500 hover:text-amber-400 text-left -mt-1"
                    >
                      {isOpen ? '▾' : '▸'} Buyers ({s.buyer_list.length})
                    </button>
                    {isOpen && (
                      <div className="bg-[#0a0a0a] border border-zinc-800 rounded-lg p-2 text-[11px] space-y-1 max-h-40 overflow-y-auto">
                        {s.buyer_list.map((b, i) => (
                          <div key={i} className="flex justify-between text-zinc-400">
                            <span>{b.name}</span>
                            <span className="font-mono">{display(b.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Bank info */}
                    <div className="text-xs leading-tight text-zinc-500 border-t border-zinc-800 pt-3 mt-1">
                      {s.bank_name || s.bank_account || s.bank_holder ? (
                        <>
                          <div className="text-zinc-300 font-medium">{s.bank_name || '—'}</div>
                          <div className="font-mono text-zinc-400">{s.bank_account || '—'}</div>
                          <div className="text-zinc-500">{s.bank_holder || '—'}</div>
                        </>
                      ) : (
                        <button onClick={() => openEdit(s.affiliate_id)} className="text-zinc-600 hover:text-amber-400">
                          + Add bank account
                        </button>
                      )}
                    </div>

                    {/* Mark paid */}
                    <button
                      onClick={() => togglePaid(s)}
                      disabled={markingPaid === s.affiliate_id}
                      className={`mt-1 text-xs font-semibold py-2 rounded-lg transition-colors ${
                        isPaid
                          ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                          : 'bg-emerald-600/80 hover:bg-emerald-500 text-white'
                      } disabled:opacity-50`}
                    >
                      {markingPaid === s.affiliate_id
                        ? 'Saving…'
                        : isPaid
                          ? '↩ Unmark as paid'
                          : '✓ Mark as paid'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </>
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
