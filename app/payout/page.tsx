'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import type { Event } from '@/lib/supabase'

interface Affiliate {
  id: string; handle: string; name: string | null; rate: number; active: boolean
  bank_name: string | null; bank_account: string | null; bank_holder: string | null
}
interface SummaryRow {
  affiliate_id: string; handle: string; buyers: number; revenue: number; commission: number
  bank_name: string | null; bank_account: string | null; bank_holder: string | null
}
interface Report {
  affiliates: Affiliate[]
  summary: SummaryRow[]
  totals: { attributed_revenue: number; total_commission: number; unattributed_revenue: number }
}

const rm = (n: number) => `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function PayoutPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [eventId, setEventId] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingReport, setLoadingReport] = useState(false)
  const [msg, setMsg] = useState('')

  // Shared 'revenue_hidden' key with Dashboard / Attendees / Revenue / Affiliates
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

  // ── Bank-edit modal
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
              No attributed affiliates yet. Go to <Link href="/affiliates" className="text-amber-400 hover:underline">Affiliates</Link> to assign.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {report.summary.map(s => (
                <div key={s.affiliate_id} className="bg-[#111] border border-zinc-800 rounded-xl p-4 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-white">{s.handle}</div>
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
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Bank-details edit modal ───────────────────────────────── */}
      {editing && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4"
          onClick={() => setEditing(null)}
        >
          <div
            className="bg-[#111] border border-zinc-800 rounded-xl w-full max-w-md p-5 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white">
                Bank details · <span className="text-amber-400">{editing.handle}</span>
              </h3>
              <button onClick={() => setEditing(null)} className="text-zinc-500 hover:text-white text-lg">×</button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Bank name</label>
                <input
                  value={bankForm.bank_name}
                  onChange={e => setBankForm({ ...bankForm, bank_name: e.target.value })}
                  placeholder="Maybank, CIMB, Public Bank…"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Bank account</label>
                <input
                  value={bankForm.bank_account}
                  onChange={e => setBankForm({ ...bankForm, bank_account: e.target.value })}
                  placeholder="1234 5678 9012"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Account holder</label>
                <input
                  value={bankForm.bank_holder}
                  onChange={e => setBankForm({ ...bankForm, bank_holder: e.target.value })}
                  placeholder="Full name as registered with bank"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm"
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setEditing(null)}
                className="text-sm text-zinc-400 hover:text-white px-4 py-2 rounded-lg border border-zinc-700"
              >
                Cancel
              </button>
              <button
                onClick={saveBank}
                disabled={savingBank}
                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-sm font-semibold px-4 py-2 rounded-lg"
              >
                {savingBank ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
