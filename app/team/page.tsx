'use client'
import { useEffect, useMemo, useState } from 'react'
import type { Event, TeamMember, TeamRole } from '@/lib/supabase'
import { toWhatsApp, TEAM_ROLE_LABELS, TEAM_ROLE_ICONS } from '@/lib/supabase'

const ROLE_ORDER: TeamRole[] = ['founder', 'speaker', 'facilitator', 'content_creator', 'videographer']

function eventLabel(ev: Event): string {
  if (!ev.date) return ev.name
  const year = new Date(ev.date).getFullYear()
  return `${ev.name} ${year}`
}

function formatEventDate(date: string | null): string {
  if (!date) return ''
  return new Date(date).toLocaleDateString('en-MY', { dateStyle: 'medium' })
}

function membersFor(team: TeamMember[] | null | undefined, role: TeamRole): TeamMember[] {
  return (team ?? []).filter(m => m && m.role === role)
}

type EditingKey = { eventId: string; role: TeamRole } | null

export default function TeamPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<EditingKey>(null)
  const [draft, setDraft] = useState<TeamMember[]>([])
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  async function loadEvents() {
    try {
      const res = await fetch('/api/events')
      if (res.ok) setEvents(await res.json())
    } catch {
      // db not configured yet
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadEvents() }, [])

  function openEdit(ev: Event, role: TeamRole) {
    setEditing({ eventId: ev.id, role })
    setDraft(membersFor(ev.team, role).map(m => ({ ...m })))
  }

  function cancelEdit() {
    setEditing(null)
    setDraft([])
  }

  function addMember(role: TeamRole) {
    setDraft(d => [...d, { role, name: '', phone: '' }])
  }

  function updateMember(index: number, patch: Partial<TeamMember>) {
    setDraft(d => d.map((m, i) => (i === index ? { ...m, ...patch } : m)))
  }

  function removeMember(index: number) {
    setDraft(d => d.filter((_, i) => i !== index))
  }

  async function saveRole(e: React.FormEvent) {
    e.preventDefault()
    if (!editing) return
    setSaving(true)
    const target = events.find(ev => ev.id === editing.eventId)
    if (!target) { setSaving(false); return }
    const otherRoles = (target.team ?? []).filter(m => m.role !== editing.role)
    const cleanedRole = draft
      .map(m => ({ role: editing.role, name: m.name.trim(), phone: m.phone?.trim() || null }))
      .filter(m => m.name.length > 0)
    const newTeam: TeamMember[] = [...otherRoles, ...cleanedRole]
    const res = await fetch('/api/events', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editing.eventId, team: newTeam }),
    })
    const updated = await res.json()
    setEvents(prev => prev.map(ev => (ev.id === editing.eventId ? updated : ev)))
    setEditing(null)
    setDraft([])
    setSaving(false)
  }

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return events
    return events.filter(ev => {
      const hay = [
        ev.name,
        formatEventDate(ev.date),
        ev.date ?? '',
        ev.venue ?? '',
      ].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [events, search])

  if (loading) return <div className="text-zinc-500 mt-20 text-center">Loading...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">Claude Intern</h1>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by date or event name..."
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm w-64"
        />
      </div>

      <div className="space-y-6">
        {filteredEvents.length === 0 && (
          <div className="text-center text-zinc-500 py-20">
            {events.length === 0 ? 'No events yet. Create one from the Events tab first.' : 'No events match your search.'}
          </div>
        )}

        {filteredEvents.map(ev => (
          <div key={ev.id} className="border-b border-zinc-800 pb-6 last:border-b-0">
            <div className="mb-3">
              <h2 className="font-semibold text-lg">{eventLabel(ev)}</h2>
              {ev.date && (
                <p className="text-xs text-zinc-500 mt-0.5">
                  {formatEventDate(ev.date)}
                  {ev.venue && ` · ${ev.venue}`}
                  {ev.is_active && <span className="ml-2 text-amber-400">· Active</span>}
                </p>
              )}
            </div>

            <div className="space-y-4">
              {ROLE_ORDER.map(role => {
                const members = membersFor(ev.team, role)
                const isEditingThis = editing && editing.eventId === ev.id && editing.role === role

                return (
                  <div key={role}>
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <p className="text-xs text-zinc-500 uppercase tracking-wider">
                        {TEAM_ROLE_ICONS[role]} {TEAM_ROLE_LABELS[role]}
                      </p>
                      {!isEditingThis && (
                        <button onClick={() => openEdit(ev, role)}
                          className="text-xs text-zinc-500 hover:text-amber-400 px-2 py-0.5">
                          Edit
                        </button>
                      )}
                    </div>

                    {isEditingThis ? (
                      <form onSubmit={saveRole} className="pl-6 space-y-2">
                        {draft.length === 0 && (
                          <p className="text-xs text-zinc-600 italic">None yet — click + Add below</p>
                        )}
                        {draft.map((m, idx) => (
                          <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                            <input value={m.name} onChange={e => updateMember(idx, { name: e.target.value })}
                              placeholder="Name" className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
                            <input value={m.phone ?? ''} onChange={e => updateMember(idx, { phone: e.target.value })}
                              placeholder="Phone (e.g. 0123456789)" className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
                            <button type="button" onClick={() => removeMember(idx)}
                              className="text-zinc-500 hover:text-red-400 text-xs px-2 py-1 border border-zinc-700 hover:border-red-500/50 rounded-lg">
                              Remove
                            </button>
                          </div>
                        ))}
                        <button type="button" onClick={() => addMember(role)}
                          className="text-xs text-amber-400 hover:text-amber-300 border border-amber-500/30 hover:border-amber-500/50 rounded-lg px-3 py-1.5">
                          + Add {TEAM_ROLE_LABELS[role]}
                        </button>
                        <div className="flex gap-2 pt-2">
                          <button type="submit" disabled={saving}
                            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold px-3 py-1.5 rounded-lg text-xs">
                            {saving ? 'Saving...' : 'Save'}
                          </button>
                          <button type="button" onClick={cancelEdit}
                            className="bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-1.5 rounded-lg text-xs">
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : members.length === 0 ? (
                      <p className="text-sm text-zinc-600 italic pl-6">—</p>
                    ) : (
                      <ul className="pl-6 space-y-1">
                        {members.map((m, i) => {
                          const wa = toWhatsApp(m.phone)
                          return (
                            <li key={i} className="text-sm flex items-center gap-3 flex-wrap">
                              <span className="text-white font-medium">{m.name}</span>
                              {m.phone && (
                                <a href={`tel:${m.phone}`} className="text-zinc-400 hover:text-amber-400 text-xs">{m.phone}</a>
                              )}
                              {wa && (
                                <a href={wa} target="_blank" rel="noopener noreferrer" title="WhatsApp"
                                  className="text-green-400 hover:text-green-300">💬</a>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
