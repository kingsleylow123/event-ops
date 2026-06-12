'use client'
import { useEffect, useMemo, useState } from 'react'
import type { Event, FloorPlan, FloorPlanSection, FloorPlanSectionType } from '@/lib/supabase'
import { resolveInitialEvent, storeEventId } from '@/lib/event'

const SECTION_TYPE_COLORS: Record<FloorPlanSectionType, string> = {
  vip: 'bg-blue-900',
  general: 'bg-slate-500',
  creator: 'bg-orange-500',
  overflow: 'bg-amber-700',
  camera: 'bg-purple-700',
  other: 'bg-zinc-600',
}

const SECTION_TYPE_LABELS: Record<FloorPlanSectionType, string> = {
  vip: 'VIPs',
  general: 'pax',
  creator: 'creators',
  overflow: 'overflow',
  camera: 'camera',
  other: 'pax',
}

function uid(): string {
  return Math.random().toString(36).slice(2, 9)
}

function emptyFloorPlan(): FloorPlan {
  return { stage_speaker: '', speaker_needs: [], sections: [], registration: '', main_door: '', fnb: '', videographer: '' }
}

function eventLabel(ev: Event): string {
  return ev.name
}

export default function FloorPlanPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [selectedEventId, setSelectedEventId] = useState<string>('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<FloorPlan>(emptyFloorPlan())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [presentMode, setPresentMode] = useState(false)

  async function loadEvents() {
    try {
      const res = await fetch('/api/events', { cache: 'no-store' })
      if (res.ok) {
        const list: Event[] = await res.json()
        setEvents(list)
        if (!selectedEventId) {
          const active = resolveInitialEvent(list)
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
      speaker_needs: [...(currentPlan.speaker_needs ?? [])],
      sections: (currentPlan.sections ?? []).map(s => ({ ...s })),
      registration: currentPlan.registration ?? '',
      main_door: currentPlan.main_door ?? '',
      fnb: currentPlan.fnb ?? '',
      videographer: currentPlan.videographer ?? '',
    })
    setEditing(true)
  }

  function addSpeakerNeed() {
    setDraft(d => ({ ...d, speaker_needs: [...(d.speaker_needs ?? []), ''] }))
  }
  function updateSpeakerNeed(idx: number, val: string) {
    setDraft(d => ({ ...d, speaker_needs: (d.speaker_needs ?? []).map((s, i) => i === idx ? val : s) }))
  }
  function removeSpeakerNeed(idx: number) {
    setDraft(d => ({ ...d, speaker_needs: (d.speaker_needs ?? []).filter((_, i) => i !== idx) }))
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
      vip: 0, general: 0, creator: 0, overflow: 0, camera: 0, other: 0,
    }
    for (const s of data.sections ?? []) {
      result[s.type] = (result[s.type] || 0) + (Number(s.pax) || 0)
    }
    const grand = Object.values(result).reduce((a, b) => a + b, 0)
    return { byType: result, grand }
  }, [editing, draft, currentPlan])

  // ── Live arrivals (auto-refresh every 5s) — so the floor team sees
  // "VIP 8/10 arrived" at a glance during check-in without asking anyone. ──
  const [arrivals, setArrivals] = useState<{
    total: number; expected: number
    vip: { in: number; of: number }; gen: { in: number; of: number }
  } | null>(null)
  useEffect(() => {
    if (!selectedEventId) return
    let stop = false
    async function tick() {
      try {
        const res = await fetch(`/api/attendees?event_id=${selectedEventId}`, { cache: 'no-store' })
        if (!res.ok) return
        const rows: { ticket_type?: string; payment_status?: string; attendance_confirmed?: boolean }[] = await res.json()
        const eligible = rows.filter(a => a.payment_status === 'paid' || a.payment_status === 'free')
        const isVip = (t?: string) => (t ?? '').includes('vip')
        const vipAll = eligible.filter(a => isVip(a.ticket_type))
        const genAll = eligible.filter(a => !isVip(a.ticket_type))
        if (!stop) setArrivals({
          total: eligible.filter(a => a.attendance_confirmed).length,
          expected: eligible.length,
          vip: { in: vipAll.filter(a => a.attendance_confirmed).length, of: vipAll.length },
          gen: { in: genAll.filter(a => a.attendance_confirmed).length, of: genAll.length },
        })
      } catch { /* keep last good values */ }
    }
    tick()
    const t = setInterval(tick, 5000)
    return () => { stop = true; clearInterval(t) }
  }, [selectedEventId])

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
            <select value={selectedEventId} onChange={e => { setSelectedEventId(e.target.value); storeEventId(e.target.value) }}
              className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>{eventLabel(ev)}</option>
              ))}
            </select>
          )}
          {!editing ? (
            <>
              <button onClick={() => setPresentMode(true)} disabled={!selectedEvent}
                className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg">
                📺 Present
              </button>
              <button onClick={startEdit} disabled={!selectedEvent}
                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold text-sm px-4 py-2 rounded-lg">
                Edit
              </button>
            </>
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

      {/* Live arrivals — refreshes every 5s during check-in */}
      {selectedEvent && arrivals && arrivals.expected > 0 && (
        <div className="flex items-center gap-4 flex-wrap bg-[#111] border border-zinc-800 rounded-xl px-4 py-3">
          <span className="flex items-center gap-2 text-sm">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            <span className="text-zinc-400">Live arrivals</span>
          </span>
          <span className="text-sm font-bold text-white">{arrivals.total}<span className="text-zinc-500 font-normal"> / {arrivals.expected} in</span></span>
          {arrivals.vip.of > 0 && (
            <span className="text-xs px-2 py-1 rounded-full bg-amber-500/15 text-amber-300">
              👑 VIP {arrivals.vip.in}/{arrivals.vip.of}
            </span>
          )}
          {arrivals.gen.of > 0 && (
            <span className="text-xs px-2 py-1 rounded-full bg-blue-500/15 text-blue-300">
              🎟 General {arrivals.gen.in}/{arrivals.gen.of}
            </span>
          )}
          <div className="flex-1 min-w-[120px] h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all duration-700"
              style={{ width: `${Math.round((arrivals.total / Math.max(1, arrivals.expected)) * 100)}%` }} />
          </div>
        </div>
      )}

      {!selectedEvent ? (
        <div className="text-center text-zinc-500 py-20">No event selected.</div>
      ) : (
        <div className="bg-[#0d0d0d] border border-zinc-800 rounded-xl p-6 space-y-6">
          {/* Stage stays truly centered. Speaker Needs floats absolutely to the right on wider screens. */}
          <div className="relative">
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

            {(editing || (display.speaker_needs ?? []).length > 0) && (
              <div className="lg:absolute lg:top-0 lg:right-0 lg:w-64 lg:mt-0 mt-4 max-w-md mx-auto bg-blue-950/30 border border-blue-800/40 rounded-lg p-3">
                <p className="text-[10px] text-blue-300 uppercase tracking-wider font-semibold mb-1.5">🎤 Speaker needs</p>
                {editing ? (
                  <div className="space-y-1.5">
                    {(draft.speaker_needs ?? []).map((need, idx) => (
                      <div key={idx} className="flex gap-1 items-center">
                        <input value={need} onChange={e => updateSpeakerNeed(idx, e.target.value)}
                          placeholder="e.g. Lapel mic"
                          className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-white text-xs" />
                        <button type="button" onClick={() => removeSpeakerNeed(idx)}
                          className="text-zinc-500 hover:text-red-400 text-[10px] px-1.5 py-0.5 border border-zinc-700 hover:border-red-500/50 rounded">✕</button>
                      </div>
                    ))}
                    <button type="button" onClick={addSpeakerNeed}
                      className="text-[10px] text-blue-400 hover:text-blue-300 border border-blue-500/40 hover:border-blue-500/70 rounded px-2 py-1 w-full">
                      + Add item
                    </button>
                  </div>
                ) : (
                  <ul className="space-y-0.5">
                    {(display.speaker_needs ?? []).map((need, i) => need && (
                      <li key={i} className="text-xs text-zinc-300 flex items-start gap-1.5">
                        <span className="text-blue-400 flex-shrink-0">•</span>
                        <span>{need}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
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

          {/* Sections grid — responsive: 1 col mobile, 2 col tablet, 3 col desktop */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {(display.sections ?? []).map((section, idx) => (
              <div key={section.id} className="text-center">
                {editing ? (
                  <input value={section.label} onChange={e => updateSection(idx, { label: e.target.value })}
                    placeholder="Section name (e.g. Zac)"
                    className="bg-zinc-900 border border-zinc-700 hover:border-orange-500/50 focus:border-orange-400 rounded px-2 py-1.5 text-orange-400 text-xs uppercase tracking-widest font-bold text-center w-full focus:outline-none" />
                ) : (
                  <h3 className="text-orange-400 text-xs uppercase tracking-widest font-bold">{section.label}</h3>
                )}
                <div className="mt-2 flex justify-center items-center gap-2 h-44">
                  {section.orientation === 'landscape' ? (
                    <div className="flex items-center gap-3">
                      <div className={`w-16 h-10 ${SECTION_TYPE_COLORS[section.type]} rounded`} />
                      <div className={`w-16 h-10 ${SECTION_TYPE_COLORS[section.type]} rounded`} />
                    </div>
                  ) : (
                    <>
                      <div className={`w-14 h-full ${SECTION_TYPE_COLORS[section.type]} rounded`} />
                      <div className={`w-14 h-full ${SECTION_TYPE_COLORS[section.type]} rounded`} />
                    </>
                  )}
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
                        <option value="camera">📹 Camera</option>
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
                        <button type="button" onClick={() => updateSection(idx, { orientation: section.orientation === 'landscape' ? 'portrait' : 'landscape' })}
                          title={section.orientation === 'landscape' ? 'Switch to portrait' : 'Switch to landscape'}
                          className="text-xs text-zinc-500 hover:text-amber-400 px-2 py-1 border border-zinc-700 rounded">
                          {section.orientation === 'landscape' ? '⬌' : '⬍'}
                        </button>
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

          {/* Videographer strip — back of room, above main door */}
          <div className="flex justify-center">
            <div className="bg-purple-900/20 border border-purple-700/50 rounded-xl px-6 py-3 flex items-center gap-3 min-w-[280px]">
              <span className="text-purple-400 text-xl flex-shrink-0">📹</span>
              <div className="text-center flex-1">
                <p className="text-[10px] text-purple-300 uppercase tracking-widest font-semibold">Videographer</p>
                {editing ? (
                  <input value={draft.videographer ?? ''} onChange={e => setDraft(d => ({ ...d, videographer: e.target.value }))}
                    placeholder="Name (e.g. Jimmy)"
                    className="mt-1 w-full bg-zinc-900 border border-purple-700/50 rounded px-2 py-1 text-white text-sm text-center focus:outline-none focus:border-purple-400" />
                ) : (
                  <p className="text-white text-sm mt-0.5 font-semibold">{display.videographer || '—'}</p>
                )}
              </div>
            </div>
          </div>

          {/* Bottom row: Registration · Main Door · F&B */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-6 border-t border-zinc-800">
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

      {/* PRESENT MODE — full-screen portrait overlay for tablet at event entrance */}
      {presentMode && selectedEvent && (
        <div className="fixed inset-0 z-50 bg-[#0a0a0a] overflow-auto" onClick={e => e.stopPropagation()}>
          <button onClick={() => setPresentMode(false)}
            className="absolute top-4 right-4 z-10 bg-zinc-800 hover:bg-zinc-700 text-white text-sm px-3 py-2 rounded-lg">
            ✕ Exit
          </button>

          <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">
            <div className="text-center">
              <h1 className="text-2xl font-bold text-white">{eventLabel(selectedEvent)}</h1>
              {selectedEvent.date && (
                <p className="text-sm text-zinc-500 mt-1">
                  {new Date(selectedEvent.date).toLocaleDateString('en-MY', { dateStyle: 'full' })}
                </p>
              )}
            </div>

            {/* Stage truly centered; Speaker Needs floats absolutely to the right on wider screens */}
            <div className="relative">
              <div className="flex justify-center">
                <div className="bg-blue-900 border border-blue-800 rounded-xl px-10 py-6 text-center min-w-[300px]">
                  <p className="text-xs text-zinc-400 tracking-widest">★ STAGE ★</p>
                  <p className="text-white text-2xl font-bold uppercase mt-2">{currentPlan.stage_speaker || '—'}</p>
                </div>
              </div>
              {(currentPlan.speaker_needs ?? []).filter(n => n).length > 0 && (
                <div className="lg:absolute lg:top-0 lg:right-0 lg:w-56 lg:mt-0 mt-4 max-w-md mx-auto bg-blue-950/30 border border-blue-800/40 rounded-lg p-3">
                  <p className="text-[10px] text-blue-300 uppercase tracking-wider font-semibold mb-1.5">🎤 Speaker needs</p>
                  <ul className="space-y-0.5">
                    {(currentPlan.speaker_needs ?? []).map((need, i) => need && (
                      <li key={i} className="text-xs text-zinc-300 flex items-start gap-1.5">
                        <span className="text-blue-400 flex-shrink-0">•</span>
                        <span>{need}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Totals */}
            <div className="text-center">
              <div className="inline-block border border-orange-500/60 text-orange-400 text-sm uppercase tracking-wider rounded-full px-4 py-2">
                ◆ VIP {totals.byType.vip} · GENERAL {totals.byType.general}
                {totals.byType.creator > 0 && ` · CREATORS ${totals.byType.creator}`}
                {' = '} <span className="text-orange-300 font-bold">{totals.grand} PAX</span>
              </div>
            </div>

            {/* Sections — responsive grid */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {(currentPlan.sections ?? []).map(section => (
                <div key={section.id} className="text-center">
                  <h3 className="text-orange-400 text-xs uppercase tracking-widest font-bold mb-2">{section.label}</h3>
                  <div className="flex justify-center items-center gap-2 h-44">
                    {section.orientation === 'landscape' ? (
                      <div className="flex items-center gap-1">
                        <div className={`w-12 h-8 ${SECTION_TYPE_COLORS[section.type]} rounded`} />
                        <div className={`w-12 h-8 ${SECTION_TYPE_COLORS[section.type]} rounded`} />
                        <div className="w-3" />
                        <div className={`w-12 h-8 ${SECTION_TYPE_COLORS[section.type]} rounded`} />
                        <div className={`w-12 h-8 ${SECTION_TYPE_COLORS[section.type]} rounded`} />
                      </div>
                    ) : (
                      <>
                        <div className={`w-14 h-full ${SECTION_TYPE_COLORS[section.type]} rounded`} />
                        <div className={`w-14 h-full ${SECTION_TYPE_COLORS[section.type]} rounded`} />
                      </>
                    )}
                  </div>
                  <p className="text-sm mt-2 text-zinc-300">
                    <span className="text-orange-400 font-bold text-base">{section.pax}</span>{' '}
                    {section.note ? <span className="text-xs text-zinc-500">({section.note})</span> : SECTION_TYPE_LABELS[section.type]}
                  </p>
                </div>
              ))}
            </div>

            {/* Videographer strip — present mode */}
            <div className="flex justify-center">
              <div className="bg-purple-900/20 border border-purple-700/50 rounded-xl px-6 py-3 flex items-center gap-3 min-w-[280px]">
                <span className="text-purple-400 text-xl flex-shrink-0">📹</span>
                <div className="text-center flex-1">
                  <p className="text-[10px] text-purple-300 uppercase tracking-widest font-semibold">Videographer</p>
                  <p className="text-white text-sm mt-0.5 font-semibold">{currentPlan.videographer || '—'}</p>
                </div>
              </div>
            </div>

            {/* Bottom row — 3 columns matching the layout */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-6 border-t border-zinc-800">
              <div className="bg-amber-50/5 border border-amber-500/30 rounded-lg p-3 text-center">
                <p className="text-xs text-amber-400 uppercase tracking-wider">📋 Registration</p>
                <p className="text-white text-sm mt-1">{currentPlan.registration || '—'}</p>
              </div>
              <div className="bg-black border border-zinc-700 rounded-lg p-3 text-center flex flex-col justify-center">
                <p className="text-xs text-zinc-400 uppercase tracking-wider">▼ Main Door ▼</p>
                {currentPlan.main_door
                  ? <p className="text-white text-sm mt-1">{currentPlan.main_door}</p>
                  : null}
              </div>
              <div className="bg-amber-50/5 border border-amber-500/30 rounded-lg p-3 text-center">
                <p className="text-xs text-amber-400 uppercase tracking-wider">🍱 F&B Station</p>
                <p className="text-white text-sm mt-1">{currentPlan.fnb || '—'}</p>
              </div>
            </div>

            <p className="text-center text-xs text-zinc-700 mt-8">
              Find your facilitator's section above
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
