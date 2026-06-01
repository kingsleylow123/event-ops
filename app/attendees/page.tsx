'use client'
import { useEffect, useState } from 'react'
import type { Event, Attendee, TicketType, PaymentMethod, PaymentStatus } from '@/lib/supabase'
import { TICKET_LABELS, TICKET_PRICES, toWhatsApp } from '@/lib/supabase'

const STATUS_COLORS: Record<PaymentStatus, string> = {
  paid: 'bg-green-900/40 text-green-400 border border-green-800',
  pending: 'bg-yellow-900/40 text-yellow-400 border border-yellow-800',
  free: 'bg-blue-900/40 text-blue-400 border border-blue-800',
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  stripe: 'Stripe',
  bank_transfer: 'Bank Transfer',
  free: 'Free',
}

function eventLabel(ev: Event): string {
  return ev.name
}

export default function AttendeesPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [selectedEventId, setSelectedEventId] = useState<string>('')
  const [attendees, setAttendees] = useState<Attendee[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterTicket, setFilterTicket] = useState<string>('all')
  const [filterAttendance, setFilterAttendance] = useState<string>('all')
  const [showQRModal, setShowQRModal] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)

  const event = events.find(e => e.id === selectedEventId) ?? null

  const [form, setForm] = useState({
    name: '', phone: '', email: '',
    ticket_type: 'standard_general' as TicketType,
    payment_method: 'bank_transfer' as PaymentMethod,
    payment_amount: 159,
    payment_status: 'pending' as PaymentStatus,
    notes: '',
  })

  async function loadEvents() {
    try {
      const evRes = await fetch('/api/events', { cache: 'no-store' })
      if (!evRes.ok) throw new Error()
      const list: Event[] = await evRes.json()
      setEvents(list)
      if (!selectedEventId) {
        const active = list.find(e => e.is_active) ?? list[0] ?? null
        if (active) setSelectedEventId(active.id)
      }
    } catch {
      // db not configured yet
    } finally {
      setLoading(false)
    }
  }

  async function loadAttendees(eventId: string) {
    try {
      const res = await fetch(`/api/attendees?event_id=${eventId}`, { cache: 'no-store' })
      if (res.ok) setAttendees(await res.json())
    } catch {
      // ignore
    }
  }

  useEffect(() => { loadEvents() }, [])

  useEffect(() => {
    if (selectedEventId) loadAttendees(selectedEventId)
  }, [selectedEventId])

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setIsAdmin(data.is_admin) })
      .catch(() => {})
  }, [])

  async function syncStripe() {
    setSyncing(true)
    setSyncMsg('')
    const res = await fetch('/api/stripe/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const data = await res.json()
    if (data.error) {
      setSyncMsg(`Error: ${data.error}`)
    } else {
      const parts = [`${data.added} added`, `${data.skipped} skipped`]
      if (data.unmatched) parts.push(`${data.unmatched} unmatched`)
      setSyncMsg(`Synced: ${parts.join(', ')}`)
      await loadEvents()
      if (selectedEventId) await loadAttendees(selectedEventId)
    }
    setSyncing(false)
  }

  async function togglePaid(a: Attendee) {
    const newStatus: PaymentStatus = a.payment_status === 'paid' ? 'pending' : 'paid'
    await fetch('/api/attendees', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: a.id, payment_status: newStatus }),
    })
    setAttendees(prev => prev.map(x => x.id === a.id ? { ...x, payment_status: newStatus } : x))
  }

  async function toggleAttendance(a: Attendee) {
    const confirmed = !a.attendance_confirmed
    await fetch('/api/attendees', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: a.id, attendance_confirmed: confirmed }),
    })
    setAttendees(prev => prev.map(x => x.id === a.id ? { ...x, attendance_confirmed: confirmed } : x))
  }

  async function deleteAttendee(id: string) {
    if (!confirm('Delete this attendee?')) return
    await fetch(`/api/attendees?id=${id}`, { method: 'DELETE' })
    setAttendees(prev => prev.filter(a => a.id !== id))
  }

  function copySurveyLink(a: Attendee) {
    if (!event) return
    const base = typeof window !== 'undefined' ? window.location.origin : ''
    const url = `${base}/survey?event=${event.id}&a=${a.id}&name=${encodeURIComponent(a.name)}`
    navigator.clipboard.writeText(url)
  }

  async function addAttendee(e: React.FormEvent) {
    e.preventDefault()
    if (!event) return
    const isFreeTier = form.ticket_type === 'free_general' || form.ticket_type === 'free_vip'
    const payload = {
      ...form,
      event_id: event.id,
      payment_method: isFreeTier ? 'free' : form.payment_method,
      payment_status: isFreeTier ? 'free' : form.payment_status,
      payment_amount: isFreeTier ? 0 : form.payment_amount,
    }
    const res = await fetch('/api/attendees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const newAtt = await res.json()
    setAttendees(prev => [newAtt, ...prev])
    setShowModal(false)
    setForm({ name: '', phone: '', email: '', ticket_type: 'standard_general', payment_method: 'bank_transfer', payment_amount: 159, payment_status: 'pending', notes: '' })
  }

  const filtered = attendees.filter(a => {
    if (filterStatus !== 'all' && a.payment_status !== filterStatus) return false
    if (filterTicket !== 'all' && a.ticket_type !== filterTicket) return false
    if (filterAttendance === 'yes' && !a.attendance_confirmed) return false
    if (filterAttendance === 'no' && a.attendance_confirmed) return false
    return true
  })

  const totalPaid = attendees.filter(a => a.payment_status === 'paid').length
  const totalPending = attendees.filter(a => a.payment_status === 'pending').length
  const totalFree = attendees.filter(a => a.payment_status === 'free').length
  const totalRevenue = attendees.filter(a => a.payment_status === 'paid').reduce((s, a) => s + (a.payment_amount ?? 0), 0)

  if (loading) return <div className="text-zinc-500 mt-20 text-center">Loading...</div>

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Attendees</h1>
          {event && (
            <p className="text-sm text-zinc-400">{eventLabel(event)}</p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {events.length > 1 && (
            <select
              value={selectedEventId}
              onChange={e => setSelectedEventId(e.target.value)}
              className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm"
            >
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>{eventLabel(ev)}</option>
              ))}
            </select>
          )}
          {isAdmin && syncMsg && <span className="text-xs text-zinc-400 self-center">{syncMsg}</span>}
          {isAdmin && (
            <button onClick={syncStripe} disabled={syncing}
              className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg">
              {syncing ? 'Syncing...' : '⚡ Sync Stripe'}
            </button>
          )}
          {selectedEventId && (
            <button onClick={() => setShowQRModal(true)}
              className="bg-zinc-800 hover:bg-zinc-700 text-white text-sm px-4 py-2 rounded-lg flex items-center gap-1.5">
              <span>📲</span> QR Check-in
            </button>
          )}
          {isAdmin && (
            <button onClick={() => setShowModal(true)} disabled={!event}
              className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold text-sm px-4 py-2 rounded-lg">
              + Add Attendee
            </button>
          )}
        </div>
      </div>

      {/* Totals bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: 'Total Participants', value: attendees.length, color: 'text-white', border: 'border-amber-500/50', adminOnly: false },
          { label: 'Paid', value: totalPaid, color: 'text-green-400', border: 'border-zinc-800', adminOnly: false },
          { label: 'Pending', value: totalPending, color: 'text-yellow-400', border: 'border-zinc-800', adminOnly: true },
          { label: 'Free', value: totalFree, color: 'text-blue-400', border: 'border-zinc-800', adminOnly: true },
          { label: 'Revenue', value: `RM ${totalRevenue.toLocaleString()}`, color: 'text-amber-400', border: 'border-zinc-800', adminOnly: true },
        ].filter(s => !s.adminOnly || isAdmin).map(s => (
          <div key={s.label} className={`bg-[#111] border ${s.border} rounded-xl px-4 py-3`}>
            <p className="text-xs text-zinc-500 mb-0.5">{s.label}</p>
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap text-sm">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-white">
          <option value="all">All Status</option>
          <option value="paid">Paid</option>
          <option value="pending">Pending</option>
          <option value="free">Free</option>
        </select>
        <select value={filterTicket} onChange={e => setFilterTicket(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-white">
          <option value="all">All Tickets</option>
          {Object.entries(TICKET_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filterAttendance} onChange={e => setFilterAttendance(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-white">
          <option value="all">All Attendance</option>
          <option value="yes">Attended</option>
          <option value="no">Not Attended</option>
        </select>
        <span className="self-center text-zinc-500 text-xs">{filtered.length} of {attendees.length} shown</span>
      </div>

      {/* Table */}
      <div className="bg-[#111] border border-zinc-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left text-zinc-500 border-b border-zinc-800">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone</th>
              {isAdmin && <th className="px-4 py-3">Ticket</th>}
              {isAdmin && <th className="px-4 py-3 text-right">Amount</th>}
              <th className="px-4 py-3">Payment Date</th>
              {isAdmin && <th className="px-4 py-3">Method</th>}
              {isAdmin && <th className="px-4 py-3">Status</th>}
              <th className="px-4 py-3 text-center">Attended</th>
              {isAdmin && <th className="px-4 py-3"></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={isAdmin ? 9 : 4} className="text-center text-zinc-500 py-10">No attendees found</td></tr>
            )}
            {filtered.map(a => {
              const waUrl = toWhatsApp(a.phone)
              return (
                <tr key={a.id} className="border-b border-zinc-900 hover:bg-zinc-900/30">
                  <td className="px-4 py-3 font-medium">
                    {a.name}
                    {a.email && <div className="text-xs text-zinc-500">{a.email}</div>}
                  </td>
                  <td className="px-4 py-3 text-zinc-300">{a.phone ?? '—'}</td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-zinc-300">{TICKET_LABELS[a.ticket_type] ?? a.ticket_type}</td>
                  )}
                  {isAdmin && (
                    <td className="px-4 py-3 text-right font-mono">
                      {a.payment_amount > 0 ? `RM ${a.payment_amount}` : '—'}
                    </td>
                  )}
                  <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">
                    {a.paid_at || a.created_at
                      ? new Date(a.paid_at ?? a.created_at).toLocaleDateString('en-MY', { dateStyle: 'medium' })
                      : '—'}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-zinc-400">{METHOD_LABELS[a.payment_method]}</td>
                  )}
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <button
                        onClick={() => a.payment_method === 'bank_transfer' ? togglePaid(a) : undefined}
                        className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[a.payment_status]} ${a.payment_method === 'bank_transfer' ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                      >
                        {a.payment_status}
                      </button>
                    </td>
                  )}
                  <td className="px-4 py-3 text-center">
                    <input type="checkbox" checked={a.attendance_confirmed}
                      onChange={isAdmin ? () => toggleAttendance(a) : undefined}
                      readOnly={!isAdmin}
                      className={`w-4 h-4 accent-amber-500 ${isAdmin ? 'cursor-pointer' : 'cursor-default opacity-70'}`} />
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <div className="flex gap-2 items-center">
                        {waUrl && (
                          <a href={waUrl} target="_blank" rel="noopener noreferrer"
                            className="text-green-400 hover:text-green-300 text-lg" title="WhatsApp">
                            💬
                          </a>
                        )}
                        <button onClick={() => copySurveyLink(a)}
                          className="text-zinc-400 hover:text-amber-400 text-sm" title="Copy survey link">
                          📋
                        </button>
                        <button onClick={() => deleteAttendee(a.id)}
                          className="text-zinc-600 hover:text-red-400 text-xs">✕</button>
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* QR Check-in Modal */}
      {showQRModal && selectedEventId && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#111] border border-zinc-800 rounded-xl p-6 w-full max-w-sm text-center">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">QR Check-in</h2>
              <button onClick={() => setShowQRModal(false)} className="text-zinc-500 hover:text-white text-xl leading-none">✕</button>
            </div>
            {(() => {
              const url = `https://event-ops-six.vercel.app/checkin/${selectedEventId}`
              const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(url)}`
              return (
                <>
                  <div className="flex justify-center mb-4">
                    <img
                      src={qrSrc}
                      alt="Check-in QR Code"
                      width={220}
                      height={220}
                      className="rounded-xl border border-zinc-700"
                    />
                  </div>
                  <p className="text-xs text-zinc-500 mb-2">Check-in URL</p>
                  <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 mb-4">
                    <span className="text-xs text-zinc-300 truncate flex-1 text-left">{url}</span>
                    <button
                      onClick={() => navigator.clipboard.writeText(url)}
                      className="text-xs text-amber-400 hover:text-amber-300 flex-shrink-0 font-medium"
                    >
                      Copy
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        const w = window.open('', '_blank', 'width=600,height=700')
                        if (!w) return
                        w.document.write(`<!DOCTYPE html><html><head><title>Check-in QR</title><style>
                          *{margin:0;padding:0;box-sizing:border-box;}
                          body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:40px;}
                          img{width:280px;height:280px;display:block;}
                          h1{font-size:28px;font-weight:800;color:#111;margin-top:24px;text-align:center;}
                          p{font-size:15px;color:#666;margin-top:10px;text-align:center;}
                          .badge{margin-top:16px;background:#fff4e6;border:2px solid #e8563a;color:#e8563a;font-weight:700;font-size:13px;padding:6px 18px;border-radius:999px;letter-spacing:0.5px;}
                        </style></head><body>
                          <img src="${qrSrc}" />
                          <h1>📲 Please scan your attendance</h1>
                          <div class="badge">Claude Malaysia Workshop</div>
                          <script>window.onload=()=>window.print()</script>
                        </body></html>`)
                        w.document.close()
                      }}
                      className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white text-sm py-2 rounded-lg font-medium"
                    >
                      🖨 Print
                    </button>
                    <button
                      onClick={() => setShowQRModal(false)}
                      className="flex-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 text-sm py-2 rounded-lg font-medium border border-zinc-800"
                    >
                      Close
                    </button>
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      )}

      {/* Add Attendee Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#111] border border-zinc-800 rounded-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-bold mb-4">Add Attendee</h2>
            <form onSubmit={addAttendee} className="space-y-3">
              <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Full Name *" className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
              <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="Phone (e.g. 0123456789)" className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
              <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="Email" type="email" className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
              <select value={form.ticket_type}
                onChange={e => {
                  const tt = e.target.value as TicketType
                  const isF = tt === 'free_general' || tt === 'free_vip'
                  const isCustom = (tt as string) === 'custom'
                  setForm(f => ({
                    ...f, ticket_type: tt,
                    payment_amount: isCustom ? 0 : (TICKET_PRICES[tt] ?? 0),
                    payment_method: isF ? 'free' : 'bank_transfer',
                    payment_status: isF ? 'free' : 'pending',
                  }))
                }}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
                {Object.entries(TICKET_LABELS).map(([k, v]) => <option key={k} value={k}>{v} {TICKET_PRICES[k as TicketType] > 0 ? `(RM${TICKET_PRICES[k as TicketType]})` : '(Free)'}</option>)}
                <option value="custom">Custom (enter amount below)</option>
              </select>
              {form.ticket_type !== 'free_general' && form.ticket_type !== 'free_vip' && (
                <>
                  <select value={form.payment_method}
                    onChange={e => setForm(f => ({ ...f, payment_method: e.target.value as PaymentMethod }))}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="stripe">Stripe</option>
                  </select>
                  <div className="flex gap-2">
                    <input type="number" value={form.payment_amount}
                      onChange={e => setForm(f => ({ ...f, payment_amount: Number(e.target.value) }))}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" placeholder="Amount (RM)" />
                    <select value={form.payment_status}
                      onChange={e => setForm(f => ({ ...f, payment_status: e.target.value as PaymentStatus }))}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
                      <option value="pending">Pending</option>
                      <option value="paid">Paid</option>
                    </select>
                  </div>
                </>
              )}
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Notes (optional)" rows={2} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm resize-none" />
              <div className="flex gap-2 pt-2">
                <button type="submit" className="flex-1 bg-amber-500 hover:bg-amber-400 text-black font-semibold py-2 rounded-lg text-sm">Add Attendee</button>
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white py-2 rounded-lg text-sm">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
