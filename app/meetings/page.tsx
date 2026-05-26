'use client'
import { useEffect, useMemo, useState } from 'react'
import type { Event, Meeting, MeetingAttendee, TeamMember } from '@/lib/supabase'

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-MY', { dateStyle: 'medium' })
}

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface PersonOption {
  name: string
  role: string
  eventName: string
}

type DraftAttendee = MeetingAttendee & { role?: string }

// Order: Huda first (admin) → facilitators → content creators → videographers → speakers → other.
const ROLE_PRIORITY: Record<string, number> = {
  facilitator: 1,
  content_creator: 2,
  videographer: 3,
  speaker: 4,
}

function uniquePeople(events: Event[]): PersonOption[] {
  const seen = new Set<string>()
  const out: PersonOption[] = []
  for (const ev of events) {
    for (const m of ev.team ?? []) {
      const key = m.name.trim().toLowerCase()
      if (key && !seen.has(key)) {
        seen.add(key)
        out.push({ name: m.name, role: m.role, eventName: ev.name })
      }
    }
  }
  return out.sort((a, b) => {
    // Huda pinned first
    const aHuda = a.name.trim().toLowerCase() === 'huda'
    const bHuda = b.name.trim().toLowerCase() === 'huda'
    if (aHuda && !bHuda) return -1
    if (bHuda && !aHuda) return 1
    // Then by role priority
    const aRolePri = ROLE_PRIORITY[a.role] ?? 99
    const bRolePri = ROLE_PRIORITY[b.role] ?? 99
    if (aRolePri !== bRolePri) return aRolePri - bRolePri
    // Then alphabetical within the same role
    return a.name.localeCompare(b.name)
  })
}

const EMPTY_FORM = {
  title: '',
  meeting_date: '',
  event_id: '',
  notes: '',
}

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [draftAttendance, setDraftAttendance] = useState<DraftAttendee[]>([])
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [expandedNoteIdx, setExpandedNoteIdx] = useState<number | null>(null)

  async function loadAll() {
    try {
      const [mRes, eRes] = await Promise.all([fetch('/api/meetings'), fetch('/api/events')])
      if (mRes.ok) setMeetings(await mRes.json())
      if (eRes.ok) setEvents(await eRes.json())
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [])

  const people = useMemo(() => uniquePeople(events), [events])

  // Per-name history map for showing dots + streak + last seen on each form row
  const historyByName = useMemo(() => {
    const meetingsAsc = [...meetings].sort((a, b) => new Date(a.meeting_date).getTime() - new Date(b.meeting_date).getTime())
    const map: Record<string, { history: { attended: boolean; date: string; title: string }[]; lastAttended: string | null; streak: number }> = {}
    for (const m of meetingsAsc) {
      for (const a of m.attendance ?? []) {
        const key = a.name.toLowerCase()
        if (!map[key]) map[key] = { history: [], lastAttended: null, streak: 0 }
        map[key].history.push({ attended: a.attended, date: m.meeting_date, title: m.title })
        if (a.attended) map[key].lastAttended = m.meeting_date
      }
    }
    for (const key of Object.keys(map)) {
      let s = 0
      const h = map[key].history
      for (let i = h.length - 1; i >= 0; i--) {
        if (h[i].attended) s++
        else break
      }
      map[key].streak = s
    }
    return map
  }, [meetings])

  function openCreate() {
    setEditingId(null)
    setForm({ ...EMPTY_FORM, meeting_date: toDatetimeLocalValue(new Date().toISOString()) })
    setDraftAttendance(people.map(p => ({ name: p.name, attended: false, notes: null, role: p.role })))
    setShowForm(true)
  }

  function openEdit(m: Meeting) {
    setEditingId(m.id)
    setForm({
      title: m.title,
      meeting_date: toDatetimeLocalValue(m.meeting_date),
      event_id: m.event_id ?? '',
      notes: m.notes ?? '',
    })
    // Seed attendance with existing + any new team members added since
    const existingByName = new Map((m.attendance ?? []).map(a => [a.name.toLowerCase(), a]))
    const merged: DraftAttendee[] = people.map(p => {
      const existing = existingByName.get(p.name.toLowerCase())
      return existing
        ? { ...existing, role: p.role }
        : { name: p.name, attended: false, notes: null, role: p.role }
    })
    // Also include people in attendance who aren't in current team
    for (const a of m.attendance ?? []) {
      if (!people.find(p => p.name.toLowerCase() === a.name.toLowerCase())) merged.push({ ...a, role: 'other' })
    }
    setDraftAttendance(merged)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    setDraftAttendance([])
  }

  function toggleAttended(index: number) {
    setDraftAttendance(d => d.map((a, i) => i === index ? { ...a, attended: !a.attended } : a))
  }

  function setPersonNotes(index: number, notes: string) {
    setDraftAttendance(d => d.map((a, i) => i === index ? { ...a, notes: notes || null } : a))
  }

  async function submitMeeting(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const payload = {
      title: form.title,
      meeting_date: new Date(form.meeting_date).toISOString(),
      event_id: form.event_id || null,
      notes: form.notes || null,
      attendance: draftAttendance,
    }
    if (editingId) {
      const res = await fetch('/api/meetings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingId, ...payload }),
      })
      if (res.ok) {
        const updated: Meeting = await res.json()
        setMeetings(prev => prev.map(m => m.id === editingId ? updated : m))
      }
    } else {
      const res = await fetch('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        const created: Meeting = await res.json()
        setMeetings(prev => [created, ...prev])
      }
    }
    closeForm()
    setSaving(false)
  }

  async function deleteMeeting(id: string) {
    if (!confirm('Delete this meeting?')) return
    const res = await fetch(`/api/meetings?id=${id}`, { method: 'DELETE' })
    if (res.ok) setMeetings(prev => prev.filter(m => m.id !== id))
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return meetings
    return meetings.filter(m => {
      const hay = [
        m.title,
        m.notes ?? '',
        fmtDateTime(m.meeting_date),
        events.find(e => e.id === m.event_id)?.name ?? '',
        (m.attendance ?? []).map(a => a.name).join(' '),
      ].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [meetings, search, events])

  // Per-person stats — chronological history + streaks
  const personStats = useMemo(() => {
    // Meetings sorted ascending in time so dot grid reads left=old → right=new
    const meetingsAsc = [...meetings].sort((a, b) => new Date(a.meeting_date).getTime() - new Date(b.meeting_date).getTime())

    const stats: Record<string, {
      name: string
      role: string
      attended: number
      total: number
      history: { attended: boolean; meetingDate: string; title: string }[]
      lastAttendedDate: string | null
      currentStreak: number
    }> = {}

    for (const p of people) {
      stats[p.name.toLowerCase()] = {
        name: p.name, role: p.role, attended: 0, total: 0,
        history: [], lastAttendedDate: null, currentStreak: 0,
      }
    }

    for (const m of meetingsAsc) {
      for (const a of m.attendance ?? []) {
        const key = a.name.toLowerCase()
        if (!stats[key]) {
          stats[key] = { name: a.name, role: '', attended: 0, total: 0, history: [], lastAttendedDate: null, currentStreak: 0 }
        }
        stats[key].total += 1
        stats[key].history.push({ attended: a.attended, meetingDate: m.meeting_date, title: m.title })
        if (a.attended) {
          stats[key].attended += 1
          stats[key].lastAttendedDate = m.meeting_date
        }
      }
    }

    // Current streak = consecutive attended from most recent backwards
    for (const key of Object.keys(stats)) {
      const hist = stats[key].history
      let streak = 0
      for (let i = hist.length - 1; i >= 0; i--) {
        if (hist[i].attended) streak++
        else break
      }
      stats[key].currentStreak = streak
    }

    return Object.values(stats)
      .filter(s => s.total > 0)
      .map(s => ({
        ...s,
        rate: s.total > 0 ? Math.round((s.attended / s.total) * 100) : 0,
      }))
      .sort((a, b) => b.rate - a.rate || b.attended - a.attended)
  }, [meetings, people])

  function statusFor(rate: number, total: number): { label: string; color: string } {
    if (total === 0) return { label: 'No data', color: 'bg-zinc-800 text-zinc-400 border border-zinc-700' }
    if (rate >= 80) return { label: 'Consistent', color: 'bg-emerald-900/40 text-emerald-400 border border-emerald-800' }
    if (rate >= 50) return { label: 'Inconsistent', color: 'bg-yellow-900/40 text-yellow-400 border border-yellow-800' }
    return { label: 'Disengaged', color: 'bg-red-900/40 text-red-400 border border-red-800' }
  }

  function daysAgo(iso: string | null): string {
    if (!iso) return 'never'
    const diff = Date.now() - new Date(iso).getTime()
    const days = Math.floor(diff / 86_400_000)
    if (days === 0) return 'today'
    if (days === 1) return 'yesterday'
    if (days < 7) return `${days}d ago`
    if (days < 30) return `${Math.floor(days / 7)}w ago`
    return `${Math.floor(days / 30)}mo ago`
  }

  if (loading) return <div className="text-zinc-500 mt-20 text-center">Loading…</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">Meetings</h1>
        <div className="flex gap-2 flex-wrap items-center">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by title, person, date..."
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm w-64"
          />
          <button onClick={openCreate}
            className="bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm px-4 py-2 rounded-lg">
            + New Meeting
          </button>
        </div>
      </div>

      {/* Per-person attendance summary — visual + scannable */}
      {personStats.length > 0 && (
        <section className="bg-[#111] border border-zinc-800 rounded-xl p-5">
          <div className="flex items-baseline justify-between mb-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">Consistency · sorted best to worst</p>
            <p className="text-xs text-zinc-600">{meetings.length} meeting{meetings.length === 1 ? '' : 's'} tracked</p>
          </div>
          <div className="space-y-2">
            {personStats.map(p => {
              const status = statusFor(p.rate, p.total)
              const last10 = p.history.slice(-10)
              return (
                <div key={p.name} className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    {/* Name + role + status */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-white font-medium">{p.name}</p>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${status.color}`}>{status.label}</span>
                        </div>
                        {p.role && <p className="text-[10px] text-zinc-500 uppercase mt-0.5">{p.role.replace('_', ' ')}</p>}
                      </div>
                    </div>

                    {/* Dot grid — last 10 meetings */}
                    <div className="flex items-center gap-1 flex-shrink-0" title="Left = older · Right = most recent">
                      {Array.from({ length: 10 - last10.length }).map((_, i) => (
                        <span key={`pad-${i}`} className="w-3 h-3 rounded-full bg-zinc-900 border border-zinc-800" />
                      ))}
                      {last10.map((h, i) => (
                        <span key={i}
                          title={`${h.title} · ${fmtDateTime(h.meetingDate)} · ${h.attended ? 'Attended' : 'Missed'}`}
                          className={`w-3 h-3 rounded-full ${h.attended ? 'bg-emerald-500' : 'bg-red-500/70'}`} />
                      ))}
                    </div>

                    {/* Numbers */}
                    <div className="flex items-center gap-4 flex-shrink-0">
                      <div className="text-right">
                        <p className={`text-lg font-bold ${p.rate >= 80 ? 'text-emerald-400' : p.rate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                          {p.rate}%
                        </p>
                        <p className="text-[10px] text-zinc-500">{p.attended}/{p.total}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-white">🔥 {p.currentStreak}</p>
                        <p className="text-[10px] text-zinc-500">streak</p>
                      </div>
                      <div className="text-right hidden sm:block">
                        <p className="text-xs text-zinc-400">{daysAgo(p.lastAttendedDate)}</p>
                        <p className="text-[10px] text-zinc-500">last seen</p>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-4 mt-3 text-[10px] text-zinc-600 flex-wrap">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> attended</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500/70" /> missed</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-zinc-900 border border-zinc-800" /> no meeting yet</span>
            <span>·</span>
            <span><span className="text-emerald-400">Consistent</span> ≥ 80% · <span className="text-amber-400">Inconsistent</span> 50-79% · <span className="text-red-400">Disengaged</span> &lt; 50%</span>
          </div>
        </section>
      )}

      {showForm && (
        <div className="bg-[#111] border border-amber-500/50 rounded-xl p-5">
          <h2 className="font-semibold mb-3">{editingId ? 'Edit Meeting' : 'New Meeting'}</h2>
          <form onSubmit={submitMeeting} className="space-y-3">
            <input required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Title (e.g. June 1 prep call) *"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input required type="datetime-local" value={form.meeting_date}
                onChange={e => setForm(f => ({ ...f, meeting_date: e.target.value }))}
                className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
              <select value={form.event_id} onChange={e => setForm(f => ({ ...f, event_id: e.target.value }))}
                className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
                <option value="">(No event tag)</option>
                {events.map(ev => (
                  <option key={ev.id} value={ev.id}>{ev.name}{ev.date ? ` — ${fmtDate(ev.date)}` : ''}</option>
                ))}
              </select>
            </div>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Agenda / notes (optional)" rows={2}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />

            <div className="pt-2 border-t border-zinc-800">
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <p className="text-xs text-zinc-500 uppercase tracking-wider">Attendance</p>
                <div className="flex gap-3">
                  <button type="button"
                    onClick={() => setDraftAttendance(d => d.map(a => ({ ...a, attended: true })))}
                    className="text-xs text-amber-400 hover:text-amber-300">✓ Mark all attended</button>
                  <button type="button"
                    onClick={() => setDraftAttendance(d => d.map(a => ({ ...a, attended: false })))}
                    className="text-xs text-zinc-500 hover:text-zinc-300">Clear all</button>
                </div>
              </div>
              {draftAttendance.length === 0 ? (
                <p className="text-xs text-zinc-600 italic">No team members yet. Add some on the Claude Intern page first.</p>
              ) : (() => {
                // Group draft attendance by role to render one box per group
                const groups: Record<string, { indices: number[] }> = {}
                draftAttendance.forEach((a, idx) => {
                  const r = a.role || 'other'
                  if (!groups[r]) groups[r] = { indices: [] }
                  groups[r].indices.push(idx)
                })
                const roleOrder = ['facilitator', 'content_creator', 'videographer', 'speaker', 'other']
                const orderedRoles = roleOrder.filter(r => groups[r])

                const ROLE_COLORS: Record<string, string> = {
                  facilitator: 'border-emerald-500/30',
                  content_creator: 'border-pink-500/30',
                  videographer: 'border-sky-500/30',
                  speaker: 'border-amber-500/30',
                  other: 'border-zinc-700',
                }
                const ROLE_LABEL_COLORS: Record<string, string> = {
                  facilitator: 'text-emerald-400',
                  content_creator: 'text-pink-400',
                  videographer: 'text-sky-400',
                  speaker: 'text-amber-400',
                  other: 'text-zinc-400',
                }

                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {orderedRoles.map(role => {
                      const indices = groups[role].indices
                      const attendedCount = indices.filter(i => draftAttendance[i].attended).length
                      return (
                        <div key={role} className={`bg-zinc-950/60 border ${ROLE_COLORS[role]} rounded-lg p-3`}>
                          <div className="flex items-center justify-between mb-2 pb-2 border-b border-zinc-800">
                            <p className={`text-xs uppercase tracking-wider font-semibold ${ROLE_LABEL_COLORS[role]}`}>
                              {role.replace('_', ' ')} ({indices.length})
                            </p>
                            <span className="text-[10px] text-zinc-500">{attendedCount}/{indices.length} ✓</span>
                          </div>
                          <div className="space-y-0.5">
                            {indices.map(idx => {
                              const a = draftAttendance[idx]
                              const hasNote = (a.notes ?? '').length > 0
                              const expanded = expandedNoteIdx === idx
                              const stats = historyByName[a.name.toLowerCase()]
                              const streak = stats?.streak ?? 0
                              const ls = stats?.lastAttended ?? null
                              const last5 = stats ? stats.history.slice(-5) : []
                              return (
                                <div key={idx}>
                                  <div className="flex items-center gap-2 py-1">
                                    <input type="checkbox" checked={a.attended} onChange={() => toggleAttended(idx)}
                                      className="w-4 h-4 accent-amber-500 flex-shrink-0" />
                                    <span className={`text-sm flex-1 min-w-0 truncate ${a.attended ? 'text-white font-medium' : 'text-zinc-400'}`}>
                                      {a.name}
                                    </span>
                                    {/* Recent dots — only shown if there's any history */}
                                    {last5.length > 0 && (
                                      <div className="flex items-center gap-0.5 flex-shrink-0" title="Last 5 meetings">
                                        {last5.map((h, i) => (
                                          <span key={i} title={`${h.title} · ${fmtDateTime(h.date)}`}
                                            className={`w-1.5 h-1.5 rounded-full ${h.attended ? 'bg-emerald-500' : 'bg-red-500/70'}`} />
                                        ))}
                                      </div>
                                    )}
                                    {streak > 0 && (
                                      <span className="text-[10px] text-amber-400 font-semibold flex-shrink-0">🔥{streak}</span>
                                    )}
                                    {ls && (
                                      <span className="text-[10px] text-zinc-500 flex-shrink-0">{daysAgo(ls)}</span>
                                    )}
                                    {hasNote && !expanded ? (
                                      <button type="button" onClick={() => setExpandedNoteIdx(idx)}
                                        className="text-[10px] text-amber-400 hover:text-amber-300 flex-shrink-0"
                                        title={a.notes ?? ''}>💬</button>
                                    ) : !expanded ? (
                                      <button type="button" onClick={() => setExpandedNoteIdx(idx)}
                                        className="text-[10px] text-zinc-600 hover:text-amber-400 flex-shrink-0">+</button>
                                    ) : null}
                                  </div>
                                  {expanded && (
                                    <div className="flex gap-1 pl-6 pb-1">
                                      <input autoFocus value={a.notes ?? ''}
                                        onChange={e => setPersonNotes(idx, e.target.value)}
                                        onBlur={() => setExpandedNoteIdx(null)}
                                        onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); setExpandedNoteIdx(null) } }}
                                        placeholder="note (e.g. delivered reel)"
                                        className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-white text-xs" />
                                      <button type="button" onClick={() => { setPersonNotes(idx, ''); setExpandedNoteIdx(null) }}
                                        className="text-xs text-zinc-500 hover:text-red-400">✕</button>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>

            <div className="flex gap-2 pt-2">
              <button disabled={saving} type="submit"
                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold px-4 py-2 rounded-lg text-sm">
                {saving ? 'Saving…' : (editingId ? 'Save Changes' : 'Create Meeting')}
              </button>
              <button type="button" onClick={closeForm}
                className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg text-sm">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {filtered.length === 0 && !showForm && (
          <div className="text-center text-zinc-500 py-20">
            {meetings.length === 0 ? 'No meetings yet. Click + New Meeting to start.' : 'No meetings match your search.'}
          </div>
        )}
        {filtered.map(m => {
          const attended = (m.attendance ?? []).filter(a => a.attended)
          const total = (m.attendance ?? []).length
          const eventName = events.find(e => e.id === m.event_id)?.name
          return (
            <div key={m.id} className="bg-[#111] border border-zinc-800 rounded-xl p-5">
              <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold">{m.title}</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {fmtDateTime(m.meeting_date)}
                    {eventName && <span className="ml-2">· {eventName}</span>}
                  </p>
                  {m.notes && <p className="text-sm text-zinc-400 mt-2 whitespace-pre-wrap">{m.notes}</p>}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    total > 0 && attended.length / total >= 0.8 ? 'bg-green-900/40 text-green-400 border border-green-800' :
                    total > 0 && attended.length / total >= 0.5 ? 'bg-yellow-900/40 text-yellow-400 border border-yellow-800' :
                    'bg-red-900/40 text-red-400 border border-red-800'
                  }`}>
                    {attended.length}/{total} attended
                  </span>
                  <button onClick={() => openEdit(m)}
                    className="text-xs border border-zinc-700 text-zinc-300 hover:border-amber-500/50 hover:text-amber-400 px-3 py-1 rounded-lg">
                    Edit
                  </button>
                  <button onClick={() => deleteMeeting(m.id)}
                    className="text-xs border border-zinc-700 text-zinc-500 hover:border-red-500/50 hover:text-red-400 px-3 py-1 rounded-lg">
                    ✕
                  </button>
                </div>
              </div>

              {attended.length > 0 && (
                <div className="border-t border-zinc-800 pt-3">
                  <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">✅ Attended ({attended.length})</p>
                  <ul className="space-y-1">
                    {attended.map((a, i) => (
                      <li key={i} className="text-sm flex items-start gap-3">
                        <span className="text-white font-medium flex-shrink-0">{a.name}</span>
                        {a.notes && <span className="text-zinc-500 text-xs">— {a.notes}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {total - attended.length > 0 && (
                <div className="border-t border-zinc-800 pt-3 mt-3">
                  <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">❌ Missed ({total - attended.length})</p>
                  <p className="text-sm text-zinc-500">
                    {(m.attendance ?? []).filter(a => !a.attended).map(a => a.name).join(', ')}
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
