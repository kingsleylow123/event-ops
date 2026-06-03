'use client'
import { useEffect, useState, useCallback } from 'react'
import type { Event } from '@/lib/supabase'

interface Affiliate {
  id: string; handle: string; name: string | null; rate: number; active: boolean
  bank_name: string | null; bank_account: string | null; bank_holder: string | null
}
interface BuyerRow {
  attendee_id: string; name: string; total: number
  affiliate_id: string | null; affiliate_handle: string | null; source: string | null
}
interface SummaryRow {
  affiliate_id: string; handle: string; buyers: number; revenue: number; commission: number
  bank_name: string | null; bank_account: string | null; bank_holder: string | null
}
interface Report {
  buyers: BuyerRow[]
  affiliates: Affiliate[]
  summary: SummaryRow[]
  totals: { attributed_revenue: number; total_commission: number; unattributed_revenue: number }
}

const rm = (n: number) => `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function AffiliatesPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [eventId, setEventId] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingReport, setLoadingReport] = useState(false)
  const [importing, setImporting] = useState(false)
  const [msg, setMsg] = useState('')
  const [revenueHidden, setRevenueHidden] = useState(false)

  // Shared 'revenue_hidden' key with Dashboard / Attendees / Revenue pages
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

  // ── Affiliate bank-details edit modal ─────────────────────────────────
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
        // default to soonest upcoming event, else active, else first
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
      .catch(() => setReport(null))
      .finally(() => setLoadingReport(false))
  }, [eventId])

  useEffect(() => { loadReport() }, [loadReport])

  async function autoMatch() {
    if (!eventId) return
    setImporting(true); setMsg('')
    try {
      const res = await fetch('/api/affiliates?action=import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId }),
      })
      const d = await res.json()
      setMsg(res.ok ? `✅ Auto-matched ${d.matched} new buyer(s) from the sheet.` : `⚠️ ${d.error || 'Import failed'}`)
      loadReport()
    } catch {
      setMsg('⚠️ Import failed')
    } finally {
      setImporting(false)
    }
  }

  async function assign(attendee_id: string, affiliate_id: string) {
    // optimistic
    setReport(prev => prev && ({
      ...prev,
      buyers: prev.buyers.map(b => b.attendee_id === attendee_id
        ? { ...b, affiliate_id: affiliate_id || null, source: affiliate_id ? 'manual' : null,
            affiliate_handle: prev.affiliates.find(a => a.id === affiliate_id)?.handle ?? null }
        : b),
    }))
    await fetch('/api/affiliates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: eventId, attendee_id, affiliate_id: affiliate_id || null }),
    })
    loadReport() // resync summary
  }

  function copyCsv() {
    if (!report) return
    const lines = [['Buyer', 'Affiliate', 'Revenue (RM)', 'Commission (RM)'].join(',')]
    for (const b of report.buyers) {
      const aff = report.affiliates.find(a => a.id === b.affiliate_id)
      const comm = aff && aff.active ? b.total * aff.rate : 0
      lines.push([`"${b.name}"`, b.affiliate_handle || '', b.total.toFixed(2), comm.toFixed(2)].join(','))
    }
    navigator.clipboard.writeText(lines.join('\n'))
    setMsg('📋 Payout CSV copied to clipboard.')
  }

  if (loading) return <div className="text-zinc-500 mt-20 text-center">Loading...</div>

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Affiliate Commissions</h1>
          <p className="text-sm text-zinc-400">10% of attributed buyer revenue</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={eventId} onChange={e => setEventId(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
            {events.map(e => (
              <option key={e.id} value={e.id}>{e.name}{e.is_active ? ' (Active)' : ''}</option>
            ))}
          </select>
          <button onClick={autoMatch} disabled={importing}
            className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg border border-zinc-700">
            {importing ? 'Matching…' : '🔄 Auto-match from sheet'}
          </button>
          <button onClick={copyCsv}
            className="bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm px-4 py-2 rounded-lg">
            📋 Copy CSV
          </button>
        </div>
      </div>

      {msg && <div className="text-sm text-zinc-300 bg-[#111] border border-zinc-800 rounded-lg px-4 py-2">{msg}</div>}

      {loadingReport || !report ? (
        <div className="text-zinc-500 text-center py-12">Loading payout…</div>
      ) : (
        <>
        <div className="flex gap-4 flex-col lg:flex-row items-stretch">
          {/* Summary cards (left, flex-grow) */}
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-3 self-start">
            {report.summary.length === 0 && (
              <div className="col-span-full text-zinc-500 text-sm bg-[#111] border border-zinc-800 rounded-xl p-5">
                No attributions yet. Click <span className="text-amber-400">Auto-match from sheet</span> or assign affiliates below.
              </div>
            )}
            {report.summary.map(s => (
              <div key={s.affiliate_id} className="bg-[#111] border border-zinc-800 rounded-xl p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold text-white">{s.handle}</div>
                  <button
                    onClick={() => openEdit(s.affiliate_id)}
                    title="Edit bank details"
                    className="text-zinc-500 hover:text-amber-400 text-xs"
                  >
                    ✎
                  </button>
                </div>
                <div className="text-xs text-zinc-500">{s.buyers} buyer{s.buyers !== 1 ? 's' : ''} · {display(s.revenue)}</div>
                <div className="text-lg font-bold text-amber-400">{display(s.commission)}</div>
                <div className="text-[11px] leading-tight text-zinc-500 border-t border-zinc-800 pt-2 mt-1">
                  {s.bank_name || s.bank_account || s.bank_holder ? (
                    <>
                      <div className="text-zinc-300">{s.bank_name || '—'}</div>
                      <div className="font-mono">{s.bank_account || '—'}</div>
                      <div>{s.bank_holder || '—'}</div>
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

          {/* Totals — right sidebar panel */}
          <div className="bg-[#111] border border-zinc-800 rounded-xl p-4 lg:w-80 flex-shrink-0 space-y-3 self-start">
            <div className="flex items-center justify-between">
              <p className="text-xs text-zinc-500 uppercase tracking-wider">Payout Summary</p>
              <button
                onClick={toggleRevenue}
                title={revenueHidden ? 'Show amounts' : 'Hide amounts'}
                className="text-zinc-500 hover:text-amber-400 text-sm"
              >
                {revenueHidden ? '👁' : '🙈'}
              </button>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Attributed revenue</span>
              <span className="font-semibold">{display(report.totals.attributed_revenue)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Total payout (10%)</span>
              <span className="font-bold text-amber-400">{display(report.totals.total_commission)}</span>
            </div>
            <div className="flex justify-between text-sm pt-2 border-t border-zinc-800">
              <span className="text-zinc-500">Unattributed</span>
              <span className="text-zinc-400">{display(report.totals.unattributed_revenue)}</span>
            </div>
          </div>
        </div>

          {/* Buyers table */}
          <div className="bg-[#111] border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-zinc-800 flex justify-between items-center">
              <h2 className="font-semibold text-sm">Paid Buyers ({report.buyers.length})</h2>
              <span className="text-xs text-zinc-500">assign an affiliate to attribute commission</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 text-xs border-b border-zinc-900">
                    <th className="px-4 py-2">Buyer</th>
                    <th className="px-4 py-2">Paid</th>
                    <th className="px-4 py-2">Affiliate</th>
                    <th className="px-4 py-2">Commission</th>
                  </tr>
                </thead>
                <tbody>
                  {report.buyers.map(b => {
                    const aff = report.affiliates.find(a => a.id === b.affiliate_id)
                    const comm = aff && aff.active ? b.total * aff.rate : 0
                    return (
                      <tr key={b.attendee_id} className="border-b border-zinc-900 hover:bg-zinc-900/30">
                        <td className="px-4 py-3 font-medium text-white whitespace-nowrap">
                          {b.name}
                          {b.source === 'auto' && <span className="ml-2 text-[10px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded">auto</span>}
                        </td>
                        <td className="px-4 py-3 text-zinc-300 whitespace-nowrap">{display(b.total)}</td>
                        <td className="px-4 py-3">
                          <select
                            value={b.affiliate_id || ''}
                            onChange={e => assign(b.attendee_id, e.target.value)}
                            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white">
                            <option value="">— none —</option>
                            {report.affiliates.filter(a => a.active).map(a => (
                              <option key={a.id} value={a.id}>{a.handle}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3 font-semibold whitespace-nowrap">
                          {comm > 0 ? <span className="text-amber-400">{display(comm)}</span> : <span className="text-zinc-600">—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
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
