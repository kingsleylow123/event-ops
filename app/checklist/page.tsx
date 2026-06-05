'use client'
import { useEffect, useMemo, useState } from 'react'
import type { Event, ChecklistItem, ChecklistStatus } from '@/lib/supabase'
import { CHECKLIST_CATEGORIES, toWhatsApp } from '@/lib/supabase'
import { pickActiveEvent } from '@/lib/event'

const NEXT_STATUS: Record<ChecklistStatus, ChecklistStatus> = {
  pending: 'in_progress',
  in_progress: 'done',
  done: 'pending',
}

// Per-category accent (left rail + dot tint). Falls back to zinc.
const CAT_ACCENT: Record<string, string> = {
  'Pre-Event Comms': '#38bdf8',  // sky
  'Facilitator': '#f59e0b',      // amber
  'Media / UGC Creator': '#a855f7', // purple
  'AV/Video': '#22d3ee',         // cyan
  'Sales/Upsell': '#34d399',     // emerald
  'Venue': '#fb923c',            // orange
  'Logistics': '#94a3b8',        // slate
  'Post-Event': '#f472b6',       // pink
}
const accentOf = (cat: string) => CAT_ACCENT[cat] ?? '#71717a'

function linkify(text: string): React.ReactNode {
  const parts = text.split(/(https?:\/\/[^\s]+)/g)
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer"
        className="text-amber-400 hover:text-amber-300 underline decoration-amber-400/40 break-all">{part}</a>
    ) : <span key={i}>{part}</span>
  )
}

// Relative due label + urgency color
function dueMeta(due: string | null, done: boolean): { label: string; tone: string } | null {
  if (!due) return null
  const d = new Date(due + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const days = Math.round((d.getTime() - today.getTime()) / 86400000)
  const label = d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })
  if (done) return { label, tone: 'text-zinc-600' }
  if (days < 0) return { label: `${label} · ${-days}d late`, tone: 'text-red-400' }
  if (days === 0) return { label: 'Today', tone: 'text-amber-400' }
  if (days === 1) return { label: 'Tomorrow', tone: 'text-amber-300/80' }
  if (days <= 3) return { label, tone: 'text-amber-300/70' }
  return { label, tone: 'text-zinc-500' }
}

const EMPTY_FORM = {
  category: CHECKLIST_CATEGORIES[0] as string,
  item: '', pic_name: '', pic_phone: '', due_date: '', notes: '',
}

// Status tap-circle: empty → half → filled
function StatusCircle({ status, accent }: { status: ChecklistStatus; accent: string }) {
  if (status === 'done') {
    return (
      <span className="grid place-items-center w-[18px] h-[18px] rounded-full" style={{ background: accent }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      </span>
    )
  }
  if (status === 'in_progress') {
    return (
      <span className="relative grid place-items-center w-[18px] h-[18px] rounded-full border-2" style={{ borderColor: accent }}>
        <span className="w-[8px] h-[8px] rounded-full" style={{ background: accent }} />
      </span>
    )
  }
  return <span className="w-[18px] h-[18px] rounded-full border-2 border-zinc-600 group-hover/row:border-zinc-400 transition-colors" />
}

export default function ChecklistPage() {
  const [event, setEvent] = useState<Event | null>(null)
  const [allEvents, setAllEvents] = useState<Event[]>([])
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [seeding, setSeeding] = useState(false)
  const [sopMsg, setSopMsg] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const teamContacts = useMemo(() => {
    const map: Record<string, string> = {}
    const seen = new Set<string>()
    const list: { name: string; phone: string | null; role: string }[] = []
    for (const ev of allEvents) {
      for (const m of ev.team ?? []) {
        const key = m.name.trim().toLowerCase()
        if (!key) continue
        if (m.phone) map[key] = m.phone
        if (!seen.has(key)) { seen.add(key); list.push({ name: m.name, phone: m.phone, role: m.role }) }
      }
    }
    return { lookup: map, list }
  }, [allEvents])

  async function loadData() {
    try {
      const evRes = await fetch('/api/events', { cache: 'no-store' })
      if (!evRes.ok) throw new Error()
      const events: Event[] = await evRes.json()
      setAllEvents(events)
      const active = pickActiveEvent(events)
      setEvent(active)
      if (active) {
        const res = await fetch(`/api/checklist?event_id=${active.id}`, { cache: 'no-store' })
        if (res.ok) setItems(await res.json())
      }
    } catch {
      // db not configured yet
    } finally {
      setLoading(false)
    }
  }

  function onPicNameChange(name: string) {
    const key = name.trim().toLowerCase()
    const auto = teamContacts.lookup[key]
    setForm(f => ({
      ...f,
      pic_name: name,
      pic_phone: auto && (!f.pic_phone || f.pic_phone === teamContacts.lookup[f.pic_name.trim().toLowerCase()]) ? auto : f.pic_phone,
    }))
  }

  useEffect(() => { loadData() }, [])

  async function cycleStatus(it: ChecklistItem) {
    const next = NEXT_STATUS[it.status]
    setItems(prev => prev.map(x => x.id === it.id ? { ...x, status: next } : x)) // optimistic
    await fetch('/api/checklist', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: it.id, status: next }),
    })
  }

  async function deleteItem(id: string) {
    if (!confirm('Delete this item?')) return
    await fetch(`/api/checklist?id=${id}`, { method: 'DELETE' })
    setItems(prev => prev.filter(x => x.id !== id))
  }

  async function loadSop() {
    if (!event) return
    setSeeding(true); setSopMsg('')
    try {
      const res = await fetch('/api/checklist?action=seed-sop', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: event.id }),
      })
      const d = await res.json()
      if (res.ok) {
        setSopMsg(`Added ${d.added} SOP item${d.added !== 1 ? 's' : ''}${d.skipped ? ` · ${d.skipped} already present` : ''}`)
        const reload = await fetch(`/api/checklist?event_id=${event.id}`, { cache: 'no-store' })
        if (reload.ok) setItems(await reload.json())
      } else setSopMsg(`⚠️ ${d.error || 'Failed to load SOP template'}`)
    } catch {
      setSopMsg('⚠️ Failed to load SOP template')
    } finally {
      setSeeding(false)
    }
  }

  function openCreate() { setEditingId(null); setForm(EMPTY_FORM); setShowForm(true) }
  function openEdit(it: ChecklistItem) {
    setEditingId(it.id)
    setForm({
      category: it.category, item: it.item,
      pic_name: it.pic_name ?? '', pic_phone: it.pic_phone ?? '',
      due_date: it.due_date ? it.due_date.slice(0, 10) : '', notes: it.notes ?? '',
    })
    setShowForm(true)
  }
  function closeForm() { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM) }

  async function submitItem(e: React.FormEvent) {
    e.preventDefault()
    if (!event) return
    const payload = {
      category: form.category, item: form.item,
      pic_name: form.pic_name || null, pic_phone: form.pic_phone || null,
      due_date: form.due_date || null, notes: form.notes || null,
    }
    if (editingId) {
      const res = await fetch('/api/checklist', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingId, ...payload }),
      })
      const updated = await res.json()
      setItems(prev => prev.map(x => x.id === editingId ? updated : x))
    } else {
      const res = await fetch('/api/checklist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, event_id: event.id, status: 'pending' as ChecklistStatus }),
      })
      const newItem = await res.json()
      setItems(prev => [...prev, newItem])
    }
    closeForm()
  }

  // ── Grouping + stats ──────────────────────────────────────────────────────
  const grouped = CHECKLIST_CATEGORIES.reduce<Record<string, ChecklistItem[]>>((acc, cat) => {
    acc[cat] = items.filter(i => i.category === cat); return acc
  }, {})
  const extraCats = [...new Set(items.map(i => i.category))].filter(c => !CHECKLIST_CATEGORIES.includes(c))
  extraCats.forEach(cat => { grouped[cat] = items.filter(i => i.category === cat) })
  const allCategories = [...CHECKLIST_CATEGORIES, ...extraCats].filter(c => (grouped[c] ?? []).length > 0)

  const total = items.length
  const doneCount = items.filter(i => i.status === 'done').length
  const inProg = items.filter(i => i.status === 'in_progress').length
  const pct = total ? Math.round((doneCount / total) * 100) : 0
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const overdue = items.filter(i => i.status !== 'done' && i.due_date && new Date(i.due_date + 'T00:00:00') < today)

  if (loading) return <div className="text-zinc-500 mt-20 text-center">Loading…</div>

  return (
    <div className="space-y-5 pb-10">
      {/* ── Header ── */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-amber-500/80 uppercase mb-1">Run Sheet</p>
          <h1 className="text-2xl font-bold tracking-tight">Event Checklist</h1>
          {event && <p className="text-sm text-zinc-500 mt-0.5">{event.name}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadSop} disabled={!event || seeding}
            className="bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-40 text-zinc-200 text-sm px-3.5 py-2 rounded-lg border border-white/10 transition-colors">
            {seeding ? 'Loading…' : 'Load SOP'}
          </button>
          <button onClick={openCreate} disabled={!event}
            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-semibold text-sm px-4 py-2 rounded-lg transition-colors">
            + Add
          </button>
        </div>
      </div>

      {/* ── Readiness hero ── */}
      {event && total > 0 && (
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-transparent p-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-bold tabular-nums tracking-tight">{pct}<span className="text-2xl text-zinc-500">%</span></span>
              <div className="text-sm leading-tight">
                <div className="text-zinc-300 font-medium">{doneCount} of {total} done</div>
                <div className="text-zinc-500 text-xs">{inProg} in progress · {total - doneCount - inProg} to start</div>
              </div>
            </div>
            {overdue.length > 0 && (
              <div className="flex items-center gap-2 text-sm bg-red-500/10 border border-red-500/25 text-red-300 rounded-lg px-3 py-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                {overdue.length} overdue
              </div>
            )}
          </div>
          {/* Segmented progress bar */}
          <div className="mt-4 h-2 rounded-full bg-white/[0.06] overflow-hidden flex">
            <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${(doneCount / total) * 100}%` }} />
            <div className="h-full bg-amber-500/70 transition-all duration-500" style={{ width: `${(inProg / total) * 100}%` }} />
          </div>
        </div>
      )}

      {sopMsg && <div className="text-sm text-zinc-300 bg-white/[0.04] border border-white/10 rounded-lg px-4 py-2">{sopMsg}</div>}

      {/* ── Add/Edit form ── */}
      {showForm && (
        <div className="rounded-2xl border border-amber-500/40 bg-[#111] p-5">
          <h2 className="font-semibold mb-3">{editingId ? 'Edit Item' : 'New Item'}</h2>
          <form onSubmit={submitItem} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
                {[...CHECKLIST_CATEGORIES, ...extraCats].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input required value={form.item} onChange={e => setForm(f => ({ ...f, item: e.target.value }))}
                placeholder="Task *" className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input list="pic-name-suggestions" value={form.pic_name} onChange={e => onPicNameChange(e.target.value)}
                placeholder="PIC Name" className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
              <datalist id="pic-name-suggestions">
                {teamContacts.list.map(c => <option key={c.name} value={c.name}>{c.phone ?? ''}</option>)}
              </datalist>
              <input value={form.pic_phone} onChange={e => setForm(f => ({ ...f, pic_phone: e.target.value }))}
                placeholder="PIC Phone" className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
              <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Notes (links auto-clickable)" className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="bg-amber-500 hover:bg-amber-400 text-black font-semibold px-4 py-2 rounded-lg text-sm">
                {editingId ? 'Save Changes' : 'Add Item'}
              </button>
              <button type="button" onClick={closeForm} className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Categories (dense list) ── */}
      <div className="space-y-3">
        {allCategories.map(cat => {
          const catItems = grouped[cat] ?? []
          const done = catItems.filter(i => i.status === 'done').length
          const accent = accentOf(cat)
          const isCollapsed = collapsed[cat]
          const allDone = done === catItems.length
          return (
            <div key={cat} className="rounded-2xl border border-white/10 bg-[#0e0e0e] overflow-hidden">
              {/* Category header */}
              <button
                onClick={() => setCollapsed(c => ({ ...c, [cat]: !c[cat] }))}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: accent }} />
                <h2 className="font-semibold text-sm text-zinc-100">{cat}</h2>
                <span className={`text-[11px] font-medium tabular-nums px-1.5 py-0.5 rounded ${allDone ? 'text-emerald-400 bg-emerald-500/10' : 'text-zinc-500 bg-white/[0.04]'}`}>
                  {done}/{catItems.length}
                </span>
                <div className="flex-1 h-1 rounded-full bg-white/[0.06] overflow-hidden max-w-[120px]">
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${catItems.length ? (done / catItems.length) * 100 : 0}%`, background: allDone ? '#34d399' : accent }} />
                </div>
                <svg className={`ml-auto w-4 h-4 text-zinc-600 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
              </button>

              {/* Rows */}
              {!isCollapsed && (
                <div>
                  {catItems.map(it => {
                    const waUrl = toWhatsApp(it.pic_phone)
                    const due = dueMeta(it.due_date, it.status === 'done')
                    const isDone = it.status === 'done'
                    return (
                      <div key={it.id}
                        className="group/row flex items-start gap-3 px-4 py-2.5 border-t border-white/[0.05] hover:bg-white/[0.025] transition-colors">
                        {/* Tap circle */}
                        <button onClick={() => cycleStatus(it)} title={it.status.replace('_', ' ')}
                          className="mt-0.5 shrink-0 cursor-pointer active:scale-90 transition-transform">
                          <StatusCircle status={it.status} accent={accent} />
                        </button>

                        {/* Body */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className={`text-sm leading-snug ${isDone ? 'line-through text-zinc-600' : 'text-zinc-100'}`}>{it.item}</span>
                            {it.status === 'in_progress' && (
                              <span className="text-[10px] font-medium text-amber-400/90 bg-amber-500/10 px-1.5 rounded-full">in progress</span>
                            )}
                          </div>
                          {it.notes && <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{linkify(it.notes)}</p>}
                          {/* meta */}
                          <div className="flex items-center gap-3 mt-1 text-[11px]">
                            {it.pic_name && (
                              <span className="flex items-center gap-1 text-zinc-500">
                                <span className="grid place-items-center w-4 h-4 rounded-full bg-white/[0.06] text-[9px] font-bold text-zinc-300">
                                  {it.pic_name.charAt(0).toUpperCase()}
                                </span>
                                {it.pic_name}
                                {waUrl && <a href={waUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300">💬</a>}
                              </span>
                            )}
                            {due && <span className={`tabular-nums ${due.tone}`}>{due.label}</span>}
                          </div>
                        </div>

                        {/* Hover actions */}
                        <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0">
                          <button onClick={() => openEdit(it)} title="Edit"
                            className="grid place-items-center w-7 h-7 rounded-md text-zinc-500 hover:text-amber-400 hover:bg-white/[0.06]">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                          </button>
                          <button onClick={() => deleteItem(it.id)} title="Delete"
                            className="grid place-items-center w-7 h-7 rounded-md text-zinc-600 hover:text-red-400 hover:bg-white/[0.06]">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {event && total === 0 && (
        <div className="text-center text-zinc-500 py-16 rounded-2xl border border-dashed border-white/10">
          <p className="mb-3">No checklist items yet.</p>
          <button onClick={loadSop} disabled={seeding}
            className="bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm px-4 py-2 rounded-lg">
            {seeding ? 'Loading…' : '📋 Load SOP template'}
          </button>
        </div>
      )}

      {!event && <div className="text-center text-zinc-500 py-20">No active event. Create one first.</div>}
    </div>
  )
}
