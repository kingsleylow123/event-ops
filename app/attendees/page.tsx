'use client'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { Event, Attendee, TicketType, PaymentMethod, PaymentStatus } from '@/lib/supabase'
import { TICKET_LABELS, TICKET_PRICES, toWhatsApp } from '@/lib/supabase'
import { resolveInitialEvent, storeEventId } from '@/lib/event'
import { useCachedFetch, mutateCache, peekCache, invalidateCache } from '@/lib/useCachedFetch'
import { identityKey } from '@/lib/format'
import { useRevenueHidden } from '@/lib/useRevenueHidden'

const STATUS_COLORS: Record<PaymentStatus, string> = {
  paid: 'bg-green-900/40 text-green-400 border border-green-800',
  pending: 'bg-yellow-900/40 text-yellow-400 border border-yellow-800',
  free: 'bg-blue-900/40 text-blue-400 border border-blue-800',
  refunded: 'bg-red-900/40 text-red-400 border border-red-800',
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  stripe: 'Stripe',
  bank_transfer: 'Bank Transfer',
  free: 'Free',
}

function eventLabel(ev: Event): string {
  return ev.name
}

// Captured at module load (not during render — keeps render pure). Used only
// to decide whether an event is in the past; minutes of staleness is fine.
const PAGE_OPENED_TS = Date.now()

type FacilitatorStat = {
  name: string
  total_events: number
  current_streak: number
  longest_streak: number
  two_day_completions: number
  two_day_event_names: string[]
}
// Leaderboards exclude the user themselves (Huda) — she doesn't want to see her own name ranked.
const EXCLUDED_NAMES = new Set(['huda'])

export default function AttendeesPage() {
  const searchParams = useSearchParams()
  const facilitatorMode = searchParams.get('type') === 'facilitator'
  const { data: eventsData } = useCachedFetch<Event[]>('events', '/api/events')
  const { data: facilStatsData, refetch: refetchFacilStats } = useCachedFetch<FacilitatorStat[]>(
    facilitatorMode ? 'facilitator-stats' : null,
    facilitatorMode ? '/api/facilitator-stats' : null,
    facilitatorMode,
  )
  const facilStats = new Map<string, FacilitatorStat>(
    (facilStatsData ?? []).map(s => [s.name.trim().toLowerCase(), s])
  )
  const { data: meData } = useCachedFetch<{ is_admin: boolean }>('me', '/api/me')
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
  const [revenueHidden, toggleRevenue] = useRevenueHidden()

  const event = events.find(e => e.id === selectedEventId) ?? null
  // Multi-day events show per-day attendance checkboxes instead of one "Attended" box.
  const isMultiDay = (event?.floor_plan?.days?.length ?? 0) >= 2

  const [form, setForm] = useState({
    name: '', phone: '', email: '',
    ticket_type: 'standard_general' as TicketType,
    payment_method: 'bank_transfer' as PaymentMethod,
    payment_amount: 159,
    payment_status: 'pending' as PaymentStatus,
    notes: '',
  })

  // Attendees: serve from cache instantly, refresh in background. Mutations
  // re-call loadAttendees() to stay authoritative.
  async function loadAttendees(eventId: string) {
    try {
      const res = await fetch(`/api/attendees?event_id=${eventId}`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setAttendees(data)
        mutateCache<Attendee[]>(`attendees:${eventId}`, () => data)
      }
    } catch {
      // ignore
    }
  }

  // Events come from the shared cache; pick the active/stored event once.
  useEffect(() => {
    if (!eventsData) return
    setEvents(eventsData)
    if (!selectedEventId) {
      const active = resolveInitialEvent(eventsData)
      if (active) setSelectedEventId(active.id)
    }
    setLoading(false)
  }, [eventsData, selectedEventId])

  useEffect(() => { if (meData) setIsAdmin(!!meData.is_admin) }, [meData])

  // Keep the attendees cache in sync after any local mutation so a returning
  // tab shows the latest (paid toggles, deletes, adds) instantly.
  useEffect(() => {
    if (selectedEventId && attendees.length >= 0) {
      mutateCache<Attendee[]>(`attendees:${selectedEventId}`, () => attendees)
    }
  }, [attendees, selectedEventId])

  // On event change: show cached attendees instantly, then refresh.
  useEffect(() => {
    if (!selectedEventId) return
    const cached = peekCache<Attendee[]>(`attendees:${selectedEventId}`)
    if (cached) setAttendees(cached)
    loadAttendees(selectedEventId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEventId])

  // Live auto-refresh: while the page is open, poll the roster and the facilitator
  // leaderboard so QR check-ins (made from someone else's phone) show up by
  // themselves — Attended ticks and the 🔥 count update without a manual reload.
  // Skips polling while the tab is hidden to avoid needless requests.
  useEffect(() => {
    if (!selectedEventId) return
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      loadAttendees(selectedEventId)
      refetchFacilStats()
    }
    const id = setInterval(tick, 10_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEventId])

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
      invalidateCache('events')
      if (selectedEventId) await loadAttendees(selectedEventId)
    }
    setSyncing(false)
  }

  async function togglePaid(a: Attendee) {
    // Refunded attendees are managed via the Deposits page — clicking the badge
    // here must not flip them back to paid/pending and silently inflate revenue.
    if (a.payment_status === 'refunded') return
    const newStatus: PaymentStatus = a.payment_status === 'paid' ? 'pending' : 'paid'
    await fetch('/api/attendees', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: a.id, payment_status: newStatus }),
    })
    setAttendees(prev => prev.map(x => x.id === a.id ? { ...x, payment_status: newStatus } : x))
  }

  // View / edit / add an attendee note inline.
  async function editNote(a: Attendee) {
    const next = window.prompt(`Note for ${a.name}:`, a.notes ?? '')
    if (next === null) return // cancelled
    const notes = next.trim() || null
    await fetch('/api/attendees', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: a.id, notes }),
    })
    setAttendees(prev => prev.map(x => x.id === a.id ? { ...x, notes } : x))
  }

  // Per-day toggle for multi-day events. attendance_confirmed is auto-synced
  // by the DB trigger to (day1 OR day2), so the UI just flips the relevant day.
  async function toggleDay(a: Attendee, day: 1 | 2) {
    const field = day === 1 ? 'day1_attended' : 'day2_attended'
    const next = !(a as Attendee)[field]
    await fetch('/api/attendees', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: a.id, [field]: next }),
    })
    setAttendees(prev => prev.map(x => {
      if (x.id !== a.id) return x
      const updated: Attendee = { ...x, [field]: next }
      updated.attendance_confirmed = updated.day1_attended || updated.day2_attended
      return updated
    }))
    // Attendance changed → the 🔥 facilitator leaderboard may have moved; refresh it.
    refetchFacilStats()
  }

  // Single-day "Attended" toggle. day1_attended is the source of truth for a one-day
  // event; the DB trigger derives attendance_confirmed = day1 || day2. We drive
  // day1_attended (not attendance_confirmed directly) so a tick/untick here is
  // reflected in the 🔥 leaderboard, which counts events actually attended.
  async function toggleAttendance(a: Attendee) {
    const confirmed = !a.attendance_confirmed
    await fetch('/api/attendees', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: a.id, day1_attended: confirmed }),
    })
    setAttendees(prev => prev.map(x => x.id === a.id ? { ...x, day1_attended: confirmed, attendance_confirmed: confirmed } : x))
    refetchFacilStats()
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
    if (!event) { alert('No event selected — please pick one from the dropdown first.'); return }
    if (!form.name.trim()) { alert('Please enter a name.'); return }
    const isFreeTier = form.ticket_type === 'free_general' || form.ticket_type === 'free_vip'
    const payload = facilitatorMode
      ? {
          event_id: event.id,
          name: form.name,
          phone: form.phone,
          notes: form.notes,
          ticket_type: null,
          payment_method: null,
          payment_amount: null,
          payment_status: null,
          attendance_confirmed: true,
          is_facilitator: true,
        }
      : {
          ...form,
          event_id: event.id,
          payment_method: isFreeTier ? 'free' : form.payment_method,
          payment_status: isFreeTier ? 'free' : form.payment_status,
          payment_amount: isFreeTier ? 0 : form.payment_amount,
          is_facilitator: false,
        }
    try {
      const res = await fetch('/api/attendees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const newAtt = await res.json()
      if (!res.ok || newAtt.error) {
        alert(`Failed to add attendee: ${newAtt.error || res.status}`)
        return
      }
      // Reload the full list to guarantee what we show matches the DB
      setAttendees(prev => [newAtt, ...prev])
      await loadAttendees(event.id)
      setShowModal(false)
      setForm({ name: '', phone: '', email: '', ticket_type: 'standard_general', payment_method: 'bank_transfer', payment_amount: 159, payment_status: 'pending', notes: '' })
    } catch (err) {
      alert(`Network/JS error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Facilitators are flagged via the is_facilitator column — a row can be a paying
  // attendee and a facilitator at the same time (e.g. Steven at GLCC). Default
  // Attendees view shows everyone with a ticket; Facilitators view shows crew
  // except Huda (the dashboard owner — she doesn't want her own name in this list).
  const roster = attendees.filter(a => {
    if (facilitatorMode) {
      if (!a.is_facilitator) return false
      if (EXCLUDED_NAMES.has((a.name ?? '').trim().toLowerCase())) return false
      return true
    }
    return !a.is_facilitator
  })

  const filtered = roster.filter(a => {
    if (!facilitatorMode && filterStatus !== 'all' && a.payment_status !== filterStatus) return false
    if (!facilitatorMode && filterTicket !== 'all' && a.ticket_type !== filterTicket) return false
    if (filterAttendance === 'yes' && !a.attendance_confirmed) return false
    if (filterAttendance === 'no' && a.attendance_confirmed) return false
    return true
  })

  const totalPaid = roster.filter(a => a.payment_status === 'paid').length
  const totalPending = roster.filter(a => a.payment_status === 'pending').length
  const totalFree = roster.filter(a => a.payment_status === 'free').length
  const totalRevenue = roster.filter(a => a.payment_status === 'paid').reduce((s, a) => s + (a.payment_amount ?? 0), 0)

  // Duplicate detection: count attendees sharing a normalized phone/email identity.
  const dupCounts = roster.reduce<Record<string, number>>((acc, a) => {
    const key = identityKey(a.phone, a.email)
    if (key) acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})

  if (loading) return <div className="text-zinc-500 mt-20 text-center">Loading...</div>

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{facilitatorMode ? 'Facilitators' : 'Attendees'}</h1>
          {event && (
            <p className="text-sm text-zinc-400">{eventLabel(event)}</p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {events.length > 1 && (
            <select
              value={selectedEventId}
              onChange={e => { setSelectedEventId(e.target.value); storeEventId(e.target.value) }}
              className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm"
            >
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>{eventLabel(ev)}</option>
              ))}
            </select>
          )}
          {isAdmin && !facilitatorMode && syncMsg && <span className="text-xs text-zinc-400 self-center">{syncMsg}</span>}
          {isAdmin && !facilitatorMode && (
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
              {facilitatorMode ? '+ Add Facilitator' : '+ Add Attendee'}
            </button>
          )}
        </div>
      </div>

      {/* Facilitator leaderboards — only in facilitator mode. Left: top 3 by longest streak. Right: 2-day completers. Huda excluded. */}
      {facilitatorMode && (() => {
        const eligible = (facilStatsData ?? []).filter(s => !EXCLUDED_NAMES.has(s.name.trim().toLowerCase()))
        // "Streak" counts total events facilitated (not consecutive) — so
        // removing someone from one event doesn't punish them for the others.
        const top = [...eligible]
          .filter(s => s.total_events >= 2)
          .sort((a, b) => b.total_events - a.total_events || b.longest_streak - a.longest_streak)
        const completers = [...eligible]
          .filter(s => s.two_day_completions >= 1)
          .sort((a, b) => b.two_day_completions - a.two_day_completions || a.name.localeCompare(b.name))
        if (top.length === 0 && completers.length === 0) return null
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {top.length > 0 && (
              <div className="bg-[#111] border border-emerald-500/30 rounded-xl p-5">
                <h3 className="text-emerald-400 font-bold mb-4 flex items-center gap-2 text-sm tracking-wide">
                  <span>🏆</span> TOP FACILITATORS
                </h3>
                <div className="space-y-3 h-28 overflow-y-scroll pr-2 [scrollbar-width:thin] [scrollbar-color:rgb(52_211_153)_rgba(63,63,70,0.4)] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-zinc-800/40 [&::-webkit-scrollbar-track]:rounded [&::-webkit-scrollbar-thumb]:bg-emerald-500/70 [&::-webkit-scrollbar-thumb]:rounded">
                  {top.map((s, i) => (
                    <div key={s.name} className="flex items-center justify-between text-base">
                      <span className="text-white">
                        <span className="text-zinc-500 mr-3">{i + 1}.</span>
                        {s.name}
                      </span>
                      <span className="text-orange-400 font-semibold">🔥 {s.total_events}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {isMultiDay && completers.length > 0 && (
              <div className="bg-[#111] border border-sky-500/30 rounded-xl p-5">
                <h3 className="text-sky-400 font-bold mb-4 flex items-center gap-2 text-sm tracking-wide">
                  <span>✅</span> COMPLETED 2-DAY WORKSHOP
                </h3>
                <div className="space-y-3 h-28 overflow-y-scroll pr-2 [scrollbar-width:thin] [scrollbar-color:rgb(56_189_248)_rgba(63,63,70,0.4)] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-zinc-800/40 [&::-webkit-scrollbar-track]:rounded [&::-webkit-scrollbar-thumb]:bg-sky-500/70 [&::-webkit-scrollbar-thumb]:rounded">
                  {completers.map((s, i) => (
                    <div key={s.name} className="flex items-center justify-between text-base">
                      <span className="text-white">
                        <span className="text-zinc-500 mr-3">{i + 1}.</span>
                        {s.name}
                      </span>
                      <span className="text-sky-300 font-semibold">
                        {s.two_day_completions > 1 ? `×${s.two_day_completions}` : '✓'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* Totals bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: facilitatorMode ? 'Total Facilitators' : 'Total Participants', value: roster.length, color: 'text-white', border: 'border-amber-500/50', adminOnly: false, hideForFacilitators: false },
          { label: 'Paid', value: totalPaid, color: 'text-green-400', border: 'border-zinc-800', adminOnly: false, hideForFacilitators: true },
          { label: 'Pending', value: totalPending, color: 'text-yellow-400', border: 'border-zinc-800', adminOnly: true, hideForFacilitators: true },
          { label: 'Free', value: totalFree, color: 'text-blue-400', border: 'border-zinc-800', adminOnly: true, hideForFacilitators: true },
          { label: 'Revenue', value: `RM ${totalRevenue.toLocaleString()}`, color: 'text-amber-400', border: 'border-zinc-800', adminOnly: true, hideForFacilitators: true },
        ].filter(s => (!s.adminOnly || isAdmin) && !(facilitatorMode && s.hideForFacilitators)).map(s => {
          const isRevenue = s.label === 'Revenue'
          const displayValue = isRevenue && revenueHidden ? 'RM ••••••' : s.value
          return (
            <div key={s.label} className={`bg-[#111] border ${s.border} rounded-xl px-4 py-3`}>
              <div className="flex items-center justify-between mb-0.5">
                <p className="text-xs text-zinc-500">{s.label}</p>
                {isRevenue && (
                  <button
                    onClick={toggleRevenue}
                    title={revenueHidden ? 'Show revenue' : 'Hide revenue'}
                    className="text-zinc-600 hover:text-amber-400 text-sm leading-none"
                  >
                    {revenueHidden ? '👁' : '🙈'}
                  </button>
                )}
              </div>
              <p className={`text-xl font-bold ${s.color}`}>{displayValue}</p>
            </div>
          )
        })}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap text-sm">
        {!facilitatorMode && (
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-white">
            <option value="all">All Status</option>
            <option value="paid">Paid</option>
            <option value="pending">Pending</option>
            <option value="free">Free</option>
          </select>
        )}
        {!facilitatorMode && (
          <select value={filterTicket} onChange={e => setFilterTicket(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-white">
            <option value="all">All Tickets</option>
            {Object.entries(TICKET_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        )}
        <select value={filterAttendance} onChange={e => setFilterAttendance(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-white">
          <option value="all">All Attendance</option>
          <option value="yes">Attended</option>
          <option value="no">Not Attended</option>
        </select>
        {(() => {
          // No-shows: paid but never checked in, once the event is in the past.
          const ev = events.find(e => e.id === selectedEventId)
          const eventPast = ev?.date ? new Date(ev.date).getTime() < PAGE_OPENED_TS : false
          const noShows = roster.filter(a => a.payment_status === 'paid' && !a.attendance_confirmed).length
          const active = filterStatus === 'paid' && filterAttendance === 'no'
          if (!eventPast || noShows === 0) return null
          return (
            <button
              onClick={() => {
                if (active) { setFilterStatus('all'); setFilterAttendance('all') }
                else { setFilterStatus('paid'); setFilterAttendance('no'); setFilterTicket('all') }
              }}
              className={`px-3 py-1.5 rounded-lg border text-sm ${active ? 'bg-amber-500 text-black border-amber-500 font-semibold' : 'bg-zinc-900 text-zinc-300 border-zinc-700 hover:border-amber-500/50'}`}>
              👻 No-shows ({noShows})
            </button>
          )
        })()}
        <span className="self-center text-zinc-500 text-xs">{filtered.length} of {roster.length} shown</span>
      </div>

      {/* Table */}
      <div className="bg-[#111] border border-zinc-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left text-zinc-500 border-b border-zinc-800">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone</th>
              {isAdmin && !facilitatorMode && <th className="px-4 py-3">Ticket</th>}
              {isAdmin && !facilitatorMode && <th className="px-4 py-3 text-right">Amount</th>}
              {!facilitatorMode && <th className="px-4 py-3">Payment Date</th>}
              {isAdmin && !facilitatorMode && <th className="px-4 py-3">Method</th>}
              {isAdmin && !facilitatorMode && <th className="px-4 py-3">Status</th>}
              {isMultiDay ? (
                <>
                  <th className="px-4 py-3 text-center">Day 1</th>
                  <th className="px-4 py-3 text-center">Day 2</th>
                </>
              ) : (
                <th className="px-4 py-3 text-center">Attended</th>
              )}
              {isAdmin && <th className="px-4 py-3"></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={(facilitatorMode ? (isAdmin ? 4 : 3) : (isAdmin ? 9 : 4)) + (isMultiDay ? 1 : 0)} className="text-center text-zinc-500 py-10">{facilitatorMode ? 'No facilitators found' : 'No attendees found'}</td></tr>
            )}
            {filtered.map(a => {
              const waUrl = toWhatsApp(a.phone)
              return (
                <tr key={a.id} className="border-b border-zinc-900 hover:bg-zinc-900/30">
                  <td className="px-4 py-3 font-medium">
                    {a.name}
                    {!facilitatorMode && (() => {
                      const k = identityKey(a.phone, a.email)
                      const n = k ? dupCounts[k] : 0
                      return n > 1 ? (
                        <span title="Possible duplicate — same phone/email as another attendee"
                          className="ml-2 text-[10px] bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded">⚠️ dup ×{n}</span>
                      ) : null
                    })()}
                    {a.email && <div className="text-xs text-zinc-500">{a.email}</div>}
                  </td>
                  <td className="px-4 py-3 text-zinc-300">{a.phone ?? '—'}</td>
                  {isAdmin && !facilitatorMode && (
                    <td className="px-4 py-3 text-zinc-300">{TICKET_LABELS[a.ticket_type] ?? a.ticket_type}</td>
                  )}
                  {isAdmin && !facilitatorMode && (
                    <td className="px-4 py-3 text-right font-mono">
                      {a.payment_amount > 0 ? `RM ${a.payment_amount}` : '—'}
                    </td>
                  )}
                  {!facilitatorMode && (
                    <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">
                      {a.paid_at || a.created_at
                        ? new Date(a.paid_at ?? a.created_at).toLocaleDateString('en-MY', { dateStyle: 'medium' })
                        : '—'}
                    </td>
                  )}
                  {isAdmin && !facilitatorMode && (
                    <td className="px-4 py-3 text-zinc-400">{METHOD_LABELS[a.payment_method]}</td>
                  )}
                  {isAdmin && !facilitatorMode && (
                    <td className="px-4 py-3">
                      <button
                        onClick={() => a.payment_method === 'bank_transfer' ? togglePaid(a) : undefined}
                        className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[a.payment_status]} ${a.payment_method === 'bank_transfer' ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                      >
                        {a.payment_status}
                      </button>
                    </td>
                  )}
                  {isMultiDay ? (
                    <>
                      <td className="px-4 py-3 text-center">
                        <input type="checkbox" checked={a.day1_attended}
                          onChange={isAdmin ? () => toggleDay(a, 1) : undefined}
                          readOnly={!isAdmin}
                          className={`w-4 h-4 accent-amber-500 ${isAdmin ? 'cursor-pointer' : 'cursor-default opacity-70'}`} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input type="checkbox" checked={a.day2_attended}
                          onChange={isAdmin ? () => toggleDay(a, 2) : undefined}
                          readOnly={!isAdmin}
                          className={`w-4 h-4 accent-amber-500 ${isAdmin ? 'cursor-pointer' : 'cursor-default opacity-70'}`} />
                      </td>
                    </>
                  ) : (
                    <td className="px-4 py-3 text-center">
                      <input type="checkbox" checked={a.attendance_confirmed}
                        onChange={isAdmin ? () => toggleAttendance(a) : undefined}
                        readOnly={!isAdmin}
                        className={`w-4 h-4 accent-amber-500 ${isAdmin ? 'cursor-pointer' : 'cursor-default opacity-70'}`} />
                    </td>
                  )}
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
                        <button
                          onClick={() => editNote(a)}
                          title={a.notes ? `${a.notes} — click to edit` : 'Add note'}
                          className={`text-sm ${a.notes ? 'text-amber-400 hover:text-amber-300' : 'text-zinc-600 hover:text-amber-400'}`}>
                          📝
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
              <h2 className="text-lg font-bold">{facilitatorMode ? 'Facilitator QR Check-in' : 'QR Check-in'}</h2>
              <button onClick={() => setShowQRModal(false)} className="text-zinc-500 hover:text-white text-xl leading-none">✕</button>
            </div>
            {(() => {
              const path = facilitatorMode ? `checkin-facilitator/${selectedEventId}` : `checkin/${selectedEventId}`
              const url = `https://event-ops-six.vercel.app/${path}`
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
            <h2 className="text-lg font-bold mb-4">{facilitatorMode ? 'Add Facilitator' : 'Add Attendee'}</h2>
            <form onSubmit={addAttendee} className="space-y-3">
              <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Full Name *" className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
              <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="Phone (e.g. 0123456789)" className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
              {!facilitatorMode && (
                <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="Email" type="email" className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
              )}
              {!facilitatorMode && (
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
              )}
              {!facilitatorMode && form.ticket_type !== 'free_general' && form.ticket_type !== 'free_vip' && (
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
                <button type="submit" className="flex-1 bg-amber-500 hover:bg-amber-400 text-black font-semibold py-2 rounded-lg text-sm">{facilitatorMode ? 'Add Facilitator' : 'Add Attendee'}</button>
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white py-2 rounded-lg text-sm">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
