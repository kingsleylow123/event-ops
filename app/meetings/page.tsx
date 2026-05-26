'use client'
import { useEffect, useMemo, useState } from 'react'
import type { Event, Meeting, MeetingAttendee, MeetingCategory, ContentPost } from '@/lib/supabase'

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
  meeting_category: 'facilitator' as MeetingCategory,
}

const CATEGORY_LABEL: Record<MeetingCategory, string> = {
  facilitator: 'Facilitator',
  content_creator: 'Content Creator',
  videographer: 'Videographer',
  mixed: 'Mixed (all roles)',
}

const CATEGORY_FOR_ROLE: Record<string, MeetingCategory> = {
  facilitator: 'facilitator',
  content_creator: 'content_creator',
  videographer: 'videographer',
}

// Pin specific people at the top of their role's leaderboard / consistency list.
const LEAD_BY_ROLE: Record<string, string> = {
  facilitator: 'huda',
  content_creator: 'chloe',
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
  const [posts, setPosts] = useState<ContentPost[]>([])
  const [logPostFor, setLogPostFor] = useState<string | null>(null)
  const [participants, setParticipants] = useState<{ name: string }[]>([])
  const [addingParticipant, setAddingParticipant] = useState(false)

  async function loadAll() {
    try {
      const [mRes, eRes, pRes, ppRes] = await Promise.all([
        fetch('/api/meetings'),
        fetch('/api/events'),
        fetch('/api/posts'),
        fetch('/api/post-participants'),
      ])
      if (mRes.ok) setMeetings(await mRes.json())
      if (pRes.ok) setPosts(await pRes.json())
      if (ppRes.ok) setParticipants(await ppRes.json())
      if (eRes.ok) setEvents(await eRes.json())
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [])

  const people = useMemo(() => uniquePeople(events), [events])

  // Per-name history map for showing dots + streak + last seen on each form row.
  // Note: depends on `people` so this useMemo is declared AFTER `people`.
  const historyByName = useMemo(() => {
    const meetingsAsc = [...meetings].sort((a, b) => new Date(a.meeting_date).getTime() - new Date(b.meeting_date).getTime())
    const map: Record<string, { history: { attended: boolean; date: string; title: string }[]; lastAttended: string | null; streak: number }> = {}
    // Lookup name → role from the team list for category matching
    const roleByName: Record<string, string> = {}
    for (const p of people) roleByName[p.name.toLowerCase()] = p.role

    for (const m of meetingsAsc) {
      const cat = (m.meeting_category ?? 'facilitator') as MeetingCategory
      for (const a of m.attendance ?? []) {
        const key = a.name.toLowerCase()
        const personRole = roleByName[key] ?? ''
        const personCategory = CATEGORY_FOR_ROLE[personRole]
        // Skip meetings not in this person's category (unless mixed)
        if (cat !== 'mixed' && (!personCategory || personCategory !== cat)) continue
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
      meeting_category: (m.meeting_category ?? 'facilitator') as MeetingCategory,
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
      meeting_category: form.meeting_category,
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
      const cat = (m.meeting_category ?? 'facilitator') as MeetingCategory
      for (const a of m.attendance ?? []) {
        const key = a.name.toLowerCase()
        if (!stats[key]) {
          stats[key] = { name: a.name, role: '', attended: 0, total: 0, history: [], lastAttendedDate: null, currentStreak: 0 }
        }
        // Only count this meeting for the person if (a) the meeting is for their role,
        // OR (b) the meeting is mixed. Keeps facilitator streak ≠ content creator streak.
        const personRole = stats[key].role
        const personCategory = CATEGORY_FOR_ROLE[personRole]
        const counts = cat === 'mixed' || (personCategory && personCategory === cat)
        if (!counts) continue

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
      .map(s => ({
        ...s,
        rate: s.total > 0 ? Math.round((s.attended / s.total) * 100) : 0,
      }))
      .sort((a, b) => {
        // Lead person pinned at the top within their role
        const aLead = LEAD_BY_ROLE[a.role || ''] && a.name.toLowerCase() === LEAD_BY_ROLE[a.role || '']
        const bLead = LEAD_BY_ROLE[b.role || ''] && b.name.toLowerCase() === LEAD_BY_ROLE[b.role || '']
        if (aLead && !bLead) return -1
        if (bLead && !aLead) return 1
        // People with data first, sorted best to worst. People with no data at bottom alphabetically.
        if (a.total === 0 && b.total === 0) return a.name.localeCompare(b.name)
        if (a.total === 0) return 1
        if (b.total === 0) return -1
        return b.rate - a.rate || b.attended - a.attended
      })
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

      {/* Top 5 per role — leaderboard at the top */}
      {personStats.length > 0 && (() => {
        const TOP_ROLES: { role: string; label: string; color: string; bg: string }[] = [
          { role: 'facilitator', label: 'Facilitator', color: 'text-emerald-400', bg: 'border-emerald-500/30' },
          { role: 'content_creator', label: 'Content Creator', color: 'text-pink-400', bg: 'border-pink-500/30' },
          { role: 'videographer', label: 'Videographer', color: 'text-sky-400', bg: 'border-sky-500/30' },
        ]
        return (
          <div className="flex flex-wrap justify-center items-start gap-3">
            {TOP_ROLES.map(r => {
              const inRole = personStats.filter(p => (p.role || '') === r.role)
              if (inRole.length === 0) return null  // No people in this role → hide
              const top5 = inRole.slice(0, 3)
              const hasData = top5.some(p => p.total > 0)
              return (
                <div key={r.role} className={`bg-[#111] border ${r.bg} rounded-xl p-4 flex-1 min-w-[280px] max-w-[420px]`}>
                  <p className={`text-xs uppercase tracking-wider font-semibold ${r.color} mb-3`}>
                    🏆 Top 3 {r.label}
                  </p>
                  {!hasData ? (
                    <p className="text-xs text-zinc-600 italic">No meeting data yet for this category.</p>
                  ) : (
                    <ol className="space-y-1">
                      {top5.map((p, i) => (
                        <li key={p.name} className="flex items-center justify-between gap-2 text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs text-zinc-500 w-4 flex-shrink-0">{i + 1}.</span>
                            <span className={`truncate ${p.total > 0 ? 'text-white' : 'text-zinc-600'}`}>{p.name}</span>
                          </div>
                          {p.total > 0 ? (
                            <div className="flex items-center gap-2 flex-shrink-0 text-xs">
                              <span className={`font-semibold ${p.rate >= 80 ? 'text-emerald-400' : p.rate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                                {p.rate}%
                              </span>
                              {p.currentStreak > 0 && <span className="text-amber-400">🔥{p.currentStreak}</span>}
                            </div>
                          ) : (
                            <span className="text-xs text-zinc-600">—</span>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )
            })}

            {/* 30-Day Post Challenge — always-visible roster with +1 / undo per person */}
            {(() => {
              const thirtyDaysAgo = new Date()
              thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
              const cutoff = thirtyDaysAgo.toISOString().slice(0, 10)
              const recent = posts.filter(p => p.post_date >= cutoff)
              const countByName: Record<string, number> = {}
              const latestByName: Record<string, ContentPost> = {}
              for (const p of recent) {
                const key = p.person_name.toLowerCase()
                countByName[key] = (countByName[key] || 0) + 1
                if (!latestByName[key] || p.created_at > latestByName[key].created_at) latestByName[key] = p
              }

              // The challenge roster is the post_challenge_participants table — open to any role.
              // We still display each participant's role label so the user knows where they came from.
              const participantNames = new Set(participants.map(p => p.name.toLowerCase()))
              const challengePeople = personStats.filter(p => participantNames.has(p.name.toLowerCase()))
              // Include any participants who aren't in the team (just in case) with empty role
              for (const pp of participants) {
                if (!challengePeople.find(c => c.name.toLowerCase() === pp.name.toLowerCase())) {
                  challengePeople.push({
                    name: pp.name, role: '', attended: 0, total: 0, rate: 0,
                    history: [], lastAttendedDate: null, currentStreak: 0,
                  } as typeof personStats[number])
                }
              }
              const ranked = challengePeople
                .map(p => ({
                  name: p.name,
                  role: p.role,
                  count: countByName[p.name.toLowerCase()] || 0,
                  latest: latestByName[p.name.toLowerCase()] || null,
                }))
                .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

              const eligibleToAdd = personStats.filter(p =>
                !participantNames.has(p.name.toLowerCase()) &&
                ['facilitator', 'content_creator', 'videographer', 'speaker'].includes(p.role || ''))

              async function addParticipant(name: string) {
                setParticipants(prev => [...prev, { name }])
                setAddingParticipant(false)
                await fetch('/api/post-participants', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name }),
                })
              }

              async function removeParticipant(name: string) {
                if (!confirm(`Remove ${name} from the post challenge?`)) return
                setParticipants(prev => prev.filter(p => p.name.toLowerCase() !== name.toLowerCase()))
                await fetch(`/api/post-participants?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
              }

              async function logPost(name: string) {
                // Optimistic update
                const tmpId = `tmp-${Date.now()}`
                const today = new Date().toISOString().slice(0, 10)
                setPosts(prev => [{ id: tmpId, person_name: name, post_date: today, notes: null, created_at: new Date().toISOString() } as ContentPost, ...prev])
                const res = await fetch('/api/posts', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ person_name: name }),
                })
                if (res.ok) {
                  const created: ContentPost = await res.json()
                  setPosts(prev => prev.map(p => p.id === tmpId ? created : p))
                }
              }

              async function undoLastPost(id: string) {
                setPosts(prev => prev.filter(p => p.id !== id))
                await fetch(`/api/posts?id=${id}`, { method: 'DELETE' })
              }

              return (
                <div className="bg-[#111] border border-purple-500/30 rounded-xl p-4 flex-1 min-w-[280px] max-w-[420px]">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs uppercase tracking-wider font-semibold text-purple-400">
                      🏆 Top 3 · 30-Day Post Challenge
                    </p>
                    <button type="button"
                      onClick={() => setAddingParticipant(v => !v)}
                      className="text-[10px] text-purple-400 hover:text-purple-300 border border-purple-500/40 rounded px-2 py-0.5">
                      {addingParticipant ? 'Back' : '+ Add'}
                    </button>
                  </div>

                  {addingParticipant ? (
                    // ADD mode — uses the same space as the participants list (no box growth)
                    eligibleToAdd.length === 0 ? (
                      <p className="text-xs text-zinc-600 italic">Everyone is already in the challenge.</p>
                    ) : (
                      <div className="max-h-[280px] overflow-y-auto divide-y divide-zinc-900 -mx-1"
                           style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgb(168 85 247 / 0.5) transparent' }}>
                        {eligibleToAdd.map(p => (
                          <button key={p.name} type="button" onClick={() => addParticipant(p.name)}
                            className="w-full flex items-center justify-between gap-2 px-2 py-2 text-left hover:bg-purple-500/15 transition-colors rounded">
                            <span className="text-sm text-white">{p.name}</span>
                            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{(p.role || 'other').replace('_', ' ')}</span>
                          </button>
                        ))}
                      </div>
                    )
                  ) : (
                    // PARTICIPANTS mode — current challenge members
                    ranked.length === 0 ? (
                      <p className="text-xs text-zinc-600 italic">No participants yet — click + Add.</p>
                    ) : (
                      <ul className="space-y-1">
                        {ranked.map((p, i) => {
                          const inTop3 = i < 3 && p.count > 0
                          return (
                            <li key={p.name} className={`flex items-center gap-2 py-1 px-1 rounded ${inTop3 ? 'bg-purple-500/5' : ''}`}>
                              <span className={`text-xs w-5 flex-shrink-0 text-right ${inTop3 ? 'text-purple-400 font-bold' : 'text-zinc-600'}`}>
                                {inTop3 ? `${i + 1}.` : ''}
                              </span>
                              <span className={`text-sm flex-1 min-w-0 truncate ${p.count > 0 ? 'text-white' : 'text-zinc-500'}`}>
                                {p.name}
                              </span>
                              <span className={`text-xs w-14 text-right ${p.count > 0 ? 'text-purple-400 font-semibold' : 'text-zinc-700'}`}>
                                {p.count} {p.count === 1 ? 'post' : 'posts'}
                              </span>
                              <button type="button" onClick={() => logPost(p.name)}
                                className="bg-purple-500 hover:bg-purple-400 text-white text-xs font-bold px-2 py-1 rounded flex-shrink-0"
                                aria-label={`Add a post for ${p.name} today`}>
                                +1
                              </button>
                              {p.latest && (
                                <button type="button" onClick={() => undoLastPost(p.latest!.id)}
                                  className="text-zinc-600 hover:text-red-400 text-xs px-1 flex-shrink-0"
                                  title="Undo most recent post">↺</button>
                              )}
                              <button type="button" onClick={() => removeParticipant(p.name)}
                                className="text-zinc-700 hover:text-red-400 text-xs px-1 flex-shrink-0"
                                title="Remove from challenge">✕</button>
                            </li>
                          )
                        })}
                      </ul>
                    )
                  )}
                </div>
              )
            })()}
          </div>
        )
      })()}

      {showForm && (
        <div className="bg-[#111] border border-amber-500/50 rounded-xl p-5">
          <h2 className="font-semibold mb-3">{editingId ? 'Edit Meeting' : 'New Meeting'}</h2>
          <form onSubmit={submitMeeting} className="space-y-3">
            <input required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Title (e.g. June 1 prep call) *"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input required type="datetime-local" value={form.meeting_date}
                onChange={e => setForm(f => ({ ...f, meeting_date: e.target.value }))}
                className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
              <select value={form.meeting_category}
                onChange={e => setForm(f => ({ ...f, meeting_category: e.target.value as MeetingCategory }))}
                className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
                <option value="facilitator">🟢 Facilitator meeting</option>
                <option value="content_creator">🟣 Content Creator meeting</option>
                <option value="videographer">🔵 Videographer meeting</option>
                <option value="mixed">⚪ Mixed (all roles)</option>
              </select>
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

      {/* Per-person attendance summary — split into separate sections per role */}
      {personStats.length > 0 && (() => {
        const ROLE_SECTION_ORDER: { role: string; label: string; color: string; bg: string }[] = [
          { role: 'facilitator', label: 'Facilitator', color: 'text-emerald-400', bg: 'border-emerald-500/30' },
          { role: 'content_creator', label: 'Content Creator', color: 'text-pink-400', bg: 'border-pink-500/30' },
          { role: 'videographer', label: 'Videographer', color: 'text-sky-400', bg: 'border-sky-500/30' },
          { role: 'speaker', label: 'Speaker', color: 'text-amber-400', bg: 'border-amber-500/30' },
          { role: '', label: 'Other', color: 'text-zinc-400', bg: 'border-zinc-700' },
        ]
        const sections = ROLE_SECTION_ORDER
          .map(s => ({ ...s, members: personStats.filter(p => (p.role || '') === s.role) }))
          .filter(s => s.members.length > 0)

        return (
          <div className="space-y-4">
            {sections.map(section => (
              <section key={section.label} className={`bg-[#111] border ${section.bg} rounded-xl p-5`}>
                <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-zinc-800">
                  <p className={`text-sm uppercase tracking-wider font-semibold ${section.color}`}>
                    {section.label} consistency
                  </p>
                  <p className="text-xs text-zinc-600">{section.members.length} {section.members.length === 1 ? 'person' : 'people'}</p>
                </div>
                <div className="space-y-2">
                  {section.members.map(p => {
                    const status = statusFor(p.rate, p.total)
                    const last10 = p.history.slice(-10)
                    return (
                      <div key={p.name} className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-3">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
                            <p className="text-white font-medium">{p.name}</p>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${status.color}`}>{status.label}</span>
                          </div>

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
              </section>
            ))}
            <p className="text-[10px] text-zinc-600 text-center">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 align-middle mr-1" /> attended
              <span className="mx-2">·</span>
              <span className="inline-block w-2 h-2 rounded-full bg-red-500/70 align-middle mr-1" /> missed
              <span className="mx-2">·</span>
              <span className="inline-block w-2 h-2 rounded-full bg-zinc-900 border border-zinc-800 align-middle mr-1" /> no meeting yet
              <span className="mx-2">·</span>
              <span className="text-emerald-400">Consistent</span> ≥ 80% · <span className="text-amber-400">Inconsistent</span> 50-79% · <span className="text-red-400">Disengaged</span> &lt; 50%
            </p>
          </div>
        )
      })()}

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
