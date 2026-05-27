'use client'
import { useEffect, useMemo, useState } from 'react'
import type { Event, FloorPlan, FloorPlanSection, FloorPlanSectionType } from '@/lib/supabase'

const SECTION_TYPE_COLORS: Record<FloorPlanSectionType, string> = {
  vip: 'bg-blue-900',
  general: 'bg-slate-500',
  creator: 'bg-orange-500',
  overflow: 'bg-amber-700',
  other: 'bg-zinc-600',
}

const SECTION_TYPE_LABELS: Record<FloorPlanSectionType, string> = {
  vip: 'VIPs',
  general: 'pax',
  creator: 'creators',
  overflow: 'overflow',
  other: 'pax',
}

function uid(): string {
  return Math.random().toString(36).slice(2, 9)
}

function emptyFloorPlan(): FloorPlan {
  return { stage_speaker: '', sections: [], registration: '', main_door: '', fnb: '' }
}

function eventLabel(ev: Event): string {
  if (!ev.date) return ev.name
  const year = new Date(ev.date).getFullYear()
  return `${ev.name} ${year}`
}

export default function FloorPlanPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [selectedEventId, setSelectedEventId] = useState<string>('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<FloorPlan>(emptyFloorPlan())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  async function loadEvents() {
    try {
      const res = await fetch('/api/events', { cache: 'no-store' })
      if (res.ok) {
        const list: Event[] = await res.json()
        setEvents(list)
        if (!selectedEventId) {
          const active = list.find(e => e.is_active) ?? list[0] ?? null
          if (active) setSelectedEventId(active.id)
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadEvents() }, [])

  const selectedEvent = events.find(e => e.id === selectedEventId) ?? null
  const currentPlan: FloorPlan = selectedEvent?.floor_plan ?? emptyFloorPlan()

  function startEdit() {
    setDraft({
      stage_speaker: currentPlan.stage_speaker ?? '',
      sections: (currentPlan.sections ?? []).map(s => ({ ...s })),
      registration: currentPlan.registration ?? '',
      main_door: currentPlan.main_door ?? '',
      fnb: currentPlan.fnb ?? '',
    })
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setDraft(emptyFloorPlan())
  }

  function addSection() {
    setDraft(d => ({
      ...d,
      sections: [...d.sections, { id: uid(), label: 'New section', type: 'general', pax: 0, note: null }],
    }))
  }

  function updateSection(index: number, patch: Partial<FloorPlanSection>) {
    setDraft(d => ({ ...d, sections: d.sections.map((s, i) => i === index ? { ...s, ...patch } : s) }))
  }

  function removeSection(index: number) {
    setDraft(d => ({ ...d, sections: d.sections.filter((_, i) => i !== index) }))
  }

  function moveSection(index: number, dir: -1 | 1) {
    setDraft(d => {
      const arr = [...d.sections]
      const j = index + dir
      if (j < 0 || j >= arr.length) return d
      ;[arr[index], arr[j]] = [arr[j], arr[index]]
      return { ...d, sections: arr }
    })
  }

  async function saveFloorPlan() {
    if (!selectedEvent) return
    setSaving(true)
    const res = await fetch('/api/events', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selectedEvent.id, floor_plan: draft }),
    })
    if (res.ok) {
      const updated: Event = await res.json()
      setEvents(prev => prev.map(e => e.id === updated.id ? updated : e))
      setEditing(false)
    }
    setSaving(false)
  }

  const totals = useMemo(() => {
    const data = editing ? draft : currentPlan
    const result: Record<FloorPlanSectionType, number> = {
      vip: 0, general: 0, creator: 0, overflow: 0, other: 0,
    }
    for (const s of data.sections ?? []) {
      result[s.type] = (result[s.type] || 0) + (Number(s.pax) || 0)
    }
    const grand = Object.values(result).reduce((a, b) => a + b, 0)
    return { byType: result, grand }
  }, [editing, draft, currentPlan])

  const display = editing ? draft : currentPlan

  if (loading) return <div className="text-zinc-500 mt-20 text-center">Loading…</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Floor Plan</h1>
          {selectedEvent && <p className="text-sm text-zinc-400 mt-0.5">{eventLabel(selectedEvent)}</p>}
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {events.length > 1 && !editing && (
            <select value={selectedEventId} onChange={e => setSelectedEventId(e.target.value)}
              className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>{eventLabel(ev)}</option>
              ))}
            </select>
          )}
          {!editing ? (
            <button onClick={startEdit} disabled={!selectedEvent}
              className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold text-sm px-4 py-2 rounded-lg">
              Edit
            </button>
          ) : (
            <>
              <button onClick={cancelEdit}
                className="bg-zinc-800 hover:bg-zinc-700 text-white text-sm px-4 py-2 rounded-lg">
                Cancel
              </button>
              <button onClick={saveFloorPlan} disabled={saving}
                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold text-sm px-4 py-2 rounded-lg">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      {!selectedEvent ? (
        <div className="text-center text-zinc-500 py-20">No event selected.</div>
      ) : (
        <div className="bg-[#0d0d0d] border border-zinc-800 rounded-xl p-6 space-y-6">
          {/* Stage */}
          <div className="flex justify-center">
            <div className="bg-blue-900 border border-blue-800 rounded-lg px-10 py-4 text-center min-w-[300px]">
              <p className="text-[10px] text-zinc-400 tracking-widest">★ STAGE ★</p>
              {editing ? (
                <input value={draft.stage_speaker ?? ''}
                  onChange={e => setDraft(d => ({ ...d, stage_speaker: e.target.value }))}
                  placeholder="Speaker name"
                  className="bg-transparent border-b border-blue-700 mt-2 text-white text-center text-lg font-bold uppercase w-full focus:outline-none focus:border-blue-400" />
              ) : (
                <p className="text-white text-lg font-bold uppercase mt-2">{display.stage_speaker || '—'}</p>
              )}
            </div>
          </div>

          {/* Totals bar */}
          <div className="flex justify-center">
            <div className="border border-orange-500/60 text-orange-400 text-xs uppercase tracking-wider rounded-full px-4 py-2">
              ◆ VIP {totals.byType.vip} · GENERAL {totals.byType.general}
              {totals.byType.creator > 0 && ` · CREATORS ${totals.byType.creator}`}
              {totals.byType.overflow > 0 && ` · OVERFLOW ${totals.byType.overflow}`}
              {' = '} <span className="text-orange-300">{totals.grand} PAX</span>
            </div>
          </div>

          {/* Sections grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {(display.sections ?? []).map((section, idx) => (
              <div key={section.id} className="text-center">
                {editing ? (
                  <input value={section.label} onChange={e => updateSection(idx, { label: e.target.value })}
                    className="bg-transparent border-b border-zinc-700 text-orange-400 text-xs uppercase tracking-widest font-bold text-center w-full focus:outline-none focus:border-orange-400" />
                ) : (
                  <h3 className="text-orange-400 text-xs uppercase tracking-widest font-bold">{section.label}</h3>
                )}
                <div className={`mt-2 grid grid-cols-2 gap-1 h-32 rounded-md overflow-hidden ${editing ? 'cursor-default' : ''}`}>
                  <div className={`${SECTION_TYPE_COLORS[section.type]} rounded`} />
                  <div className={`${SECTION_TYPE_COLORS[section.type]} rounded`} />
                </div>
                {editing ? (
                  <div className="mt-2 space-y-1">
                    <div className="grid grid-cols-2 gap-1">
                      <select value={section.type} onChange={e => updateSection(idx, { type: e.target.value as FloorPlanSectionType })}
                        className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-white text-xs">
                        <option value="vip">VIP</option>
                        <option value="general">General</option>
                        <option value="creator">Creator</option>
                        <option value="overflow">Overflow</option>
                        <option value="other">Other</option>
                      </select>
                      <input type="number" min="0" value={section.pax}
                        onChange={e => updateSection(idx, { pax: Number(e.target.value) || 0 })}
                        placeholder="Pax"
                        className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-white text-xs" />
                    </div>
                    <input value={section.note ?? ''}
                      onChange={e => updateSection(idx, { note: e.target.value || null })}
                      placeholder="Note (e.g. '4 VIPs + 1 overflow')"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-white text-xs" />
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex gap-1">
                        <button type="button" onClick={() => moveSection(idx, -1)} disabled={idx === 0}
                          className="text-xs text-zinc-500 hover:text-amber-400 disabled:opacity-30 px-2 py-1 border border-zinc-700 rounded">←</button>
                        <button type="button" onClick={() => moveSection(idx, 1)} disabled={idx === display.sections.length - 1}
                          className="text-xs text-zinc-500 hover:text-amber-400 disabled:opacity-30 px-2 py-1 border border-zinc-700 rounded">→</button>
                      </div>
                      <button type="button" onClick={() => removeSection(idx)}
                        className="text-xs text-red-400 hover:text-red-300 px-2 py-1 border border-red-500/30 hover:border-red-500/60 rounded">Remove</button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm mt-2 text-zinc-400">
                    <span className="text-orange-400 font-bold">{section.pax}</span>{' '}
                    {section.note ? <span className="text-xs text-zinc-500">({section.note})</span> : SECTION_TYPE_LABELS[section.type]}
                  </p>
                )}
              </div>
            ))}
            {editing && (
              <button type="button" onClick={addSection}
                className="border-2 border-dashed border-zinc-700 hover:border-amber-500/50 hover:text-amber-400 rounded-lg p-6 text-zinc-500 text-sm">
                + Add section
              </button>
            )}
            {!editing && (display.sections ?? []).length === 0 && (
              <div className="col-span-full text-center text-zinc-600 italic py-8">
                No sections yet — click Edit to add some.
              </div>
            )}
          </div>

          {/* Bottom row: Registration · Main Door · F&B */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-6 border-t border-zinc-800">
            <div className="bg-amber-50/5 border border-amber-500/30 rounded-lg p-3 text-center">
              <p className="text-xs text-amber-400 uppercase tracking-wider">📋 Registration</p>
              {editing ? (
                <input value={draft.registration ?? ''} onChange={e => setDraft(d => ({ ...d, registration: e.target.value }))}
                  placeholder="Who's at registration?"
                  className="mt-1 w-full bg-transparent border-b border-amber-700/50 text-white text-center text-sm focus:outline-none focus:border-amber-400" />
              ) : (
                <p className="text-white text-sm mt-1">{display.registration || '—'}</p>
              )}
            </div>
            <div className="bg-black border border-zinc-700 rounded-lg p-3 text-center">
              <p className="text-xs text-zinc-400 uppercase tracking-wider">▼ Main Door ▼</p>
              {editing ? (
                <input value={draft.main_door ?? ''} onChange={e => setDraft(d => ({ ...d, main_door: e.target.value }))}
                  placeholder="(optional notes)"
                  className="mt-1 w-full bg-transparent border-b border-zinc-700 text-white text-center text-sm focus:outline-none focus:border-zinc-400" />
              ) : (
                display.main_door ? <p className="text-white text-sm mt-1">{display.main_door}</p> : <p className="text-zinc-600 text-xs mt-1 italic">— entrance —</p>
              )}
            </div>
            <div className="bg-amber-50/5 border border-amber-500/30 rounded-lg p-3 text-center">
              <p className="text-xs text-amber-400 uppercase tracking-wider">🍱 F&B Station</p>
              {editing ? (
                <input value={draft.fnb ?? ''} onChange={e => setDraft(d => ({ ...d, fnb: e.target.value }))}
                  placeholder="Who's at F&B?"
                  className="mt-1 w-full bg-transparent border-b border-amber-700/50 text-white text-center text-sm focus:outline-none focus:border-amber-400" />
              ) : (
                <p className="text-white text-sm mt-1">{display.fnb || '—'}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
