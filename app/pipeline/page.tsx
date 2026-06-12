'use client'
import { useEffect, useMemo, useState } from 'react'
import type { Event } from '@/lib/supabase'
import { toWhatsApp } from '@/lib/supabase'
import { resolveInitialEvent, storeEventId } from '@/lib/event'
import { useCachedFetch, mutateCache, peekCache } from '@/lib/useCachedFetch'
import { fmtDateTime } from '@/lib/format'

interface DealLead {
  id: string
  client_name: string
  client_phone: string | null
  client_phone_norm: string | null
  needs: string
  rep_name: string
  status: string
  founder_notes: string | null
  attendee_id: string | null
  created_at: string
}
interface PipelineData {
  leads: DealLead[]
  summary: { total: number; byStatus: Record<string, number> }
}

const STATUSES = ['new', 'contacted', 'meeting', 'won', 'lost'] as const
const STATUS_LABEL: Record<string, string> = { new: 'New', contacted: 'Contacted', meeting: 'Meeting', won: 'Won', lost: 'Lost' }
// [text, ring/border] tints
const STATUS_TINT: Record<string, { text: string; bg: string; border: string }> = {
  new:       { text: 'text-amber-300',   bg: 'bg-amber-500/15',   border: 'border-amber-500/40' },
  contacted: { text: 'text-blue-300',    bg: 'bg-blue-500/15',    border: 'border-blue-500/40' },
  meeting:   { text: 'text-violet-300',  bg: 'bg-violet-500/15',  border: 'border-violet-500/40' },
  won:       { text: 'text-emerald-300', bg: 'bg-emerald-500/15', border: 'border-emerald-500/40' },
  lost:      { text: 'text-zinc-400',    bg: 'bg-zinc-500/15',    border: 'border-zinc-600/50' },
}

export default function PipelinePage() {
  const { data: eventsData } = useCachedFetch<Event[]>('events', '/api/events')
  const [events, setEvents] = useState<Event[]>([])
  const [selectedEventId, setSelectedEventId] = useState('')
  const [leads, setLeads] = useState<DealLead[]>([])
  const [summary, setSummary] = useState<PipelineData['summary'] | null>(null)
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [copied, setCopied] = useState(false)
  const [editingNotes, setEditingNotes] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!eventsData) return
    setEvents(eventsData)
    if (!selectedEventId) {
      const active = resolveInitialEvent(eventsData)
      if (active) setSelectedEventId(active.id)
    }
  }, [eventsData, selectedEventId])

  // Pipeline leads: cached per event (instant), refreshed in background.
  useEffect(() => {
    if (!selectedEventId) return
    const cacheKey = `pipeline:${selectedEventId}`
    const cached = peekCache<PipelineData>(cacheKey)
    if (cached) { setLeads(cached.leads || []); setSummary(cached.summary || null) }
    else setLoading(true)
    fetch(`/api/pipeline?event_id=${selectedEventId}`)
      .then(r => r.json())
      .then((d: PipelineData) => {
        setLeads(d.leads || []); setSummary(d.summary || null)
        mutateCache<PipelineData>(cacheKey, () => d)
      })
      .catch(() => { if (!cached) { setLeads([]); setSummary(null) } })
      .finally(() => setLoading(false))
  }, [selectedEventId])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Duplicate detection: same client phone logged more than once for this event.
  const dupNorms = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const l of leads) if (l.client_phone_norm) counts[l.client_phone_norm] = (counts[l.client_phone_norm] || 0) + 1
    return new Set(Object.entries(counts).filter(([, n]) => n > 1).map(([k]) => k))
  }, [leads])

  const shown = statusFilter ? leads.filter(l => l.status === statusFilter) : leads

  const [patchFailed, setPatchFailed] = useState(false)
  function reloadFromServer() {
    fetch(`/api/pipeline?event_id=${selectedEventId}`)
      .then(r => r.json())
      .then((d: PipelineData) => {
        setLeads(d.leads || []); setSummary(d.summary || null)
        mutateCache<PipelineData>(`pipeline:${selectedEventId}`, () => d)
      })
      .catch(() => {})
  }

  function patchLead(id: string, patch: { status?: string; founder_notes?: string }) {
    // Optimistic update + cache sync (compute next outside setState — no nesting).
    const next = leads.map(l => (l.id === id ? { ...l, ...patch } : l))
    const byStatus: Record<string, number> = { new: 0, contacted: 0, meeting: 0, won: 0, lost: 0 }
    next.forEach(l => { if (l.status in byStatus) byStatus[l.status]++ })
    const data: PipelineData = { leads: next, summary: { total: next.length, byStatus } }
    setLeads(next)
    setSummary(data.summary)
    mutateCache<PipelineData>(`pipeline:${selectedEventId}`, () => data)
    fetch('/api/pipeline', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    })
      .then(r => { if (!r.ok) throw new Error() })
      .catch(() => {
        // Surface the failure and restore server truth (undo the optimism).
        setPatchFailed(true)
        reloadFromServer()
      })
  }

  function copyCaptureLink() {
    const base = typeof window !== 'undefined' ? window.location.origin : ''
    navigator.clipboard.writeText(`${base}/capture?event=${selectedEventId}`)
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Sales Pipeline</h1>
          <p className="text-sm text-zinc-400">Hot leads captured by the team — follow up to close bigger deals</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={selectedEventId} onChange={e => { setSelectedEventId(e.target.value); storeEventId(e.target.value); setStatusFilter('') }}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
            {events.map(e => (
              <option key={e.id} value={e.id}>{e.name}{e.is_active ? ' (Active)' : ''}</option>
            ))}
          </select>
          <button onClick={copyCaptureLink}
            className="bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm px-4 py-2 rounded-lg whitespace-nowrap">
            {copied ? '✓ Copied' : '🔗 Copy capture link'}
          </button>
        </div>
      </div>

      {patchFailed && (
        <div className="flex items-center justify-between gap-3 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2.5">
          <span>⚠️ That change didn&apos;t save — the list has been restored from the server. Try again.</span>
          <button onClick={() => setPatchFailed(false)} className="text-red-200/70 hover:text-white">✕</button>
        </div>
      )}

      {/* Summary cards (status filters) */}
      {summary && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          <button onClick={() => setStatusFilter('')}
            className={`bg-[#111] border rounded-xl p-4 text-left ${!statusFilter ? 'border-amber-500' : 'border-zinc-800'}`}>
            <div className="text-xs text-zinc-500">Total</div>
            <div className="text-2xl font-bold">{summary.total}</div>
          </button>
          {STATUSES.map(s => (
            <button key={s} onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
              className={`bg-[#111] border rounded-xl p-4 text-left ${statusFilter === s ? 'border-amber-500' : 'border-zinc-800'}`}>
              <div className="text-xs text-zinc-500">{STATUS_LABEL[s]}</div>
              <div className={`text-2xl font-bold ${STATUS_TINT[s].text}`}>{summary.byStatus?.[s] ?? 0}</div>
            </button>
          ))}
        </div>
      )}

      {/* Leads */}
      {loading && !leads.length ? (
        <div className="text-center text-zinc-500 py-20">Loading…</div>
      ) : shown.length === 0 ? (
        <div className="text-center text-zinc-500 py-16 bg-[#111] border border-zinc-800 rounded-xl">
          {leads.length === 0
            ? <>No leads captured yet. Blast the <button onClick={copyCaptureLink} className="text-amber-400 underline underline-offset-2">capture link</button> to your closing team.</>
            : 'No leads in this status.'}
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map(l => {
            const wa = toWhatsApp(l.client_phone)
            const isDup = l.client_phone_norm ? dupNorms.has(l.client_phone_norm) : false
            const tint = STATUS_TINT[l.status] ?? STATUS_TINT.new
            return (
              <div key={l.id} className="bg-[#111] border border-zinc-800 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-white">{l.client_name}</h3>
                      {l.attendee_id && <span className="text-[10px] bg-emerald-500/15 text-emerald-300 px-1.5 py-0.5 rounded">attendee</span>}
                      {isDup && <span className="text-[10px] bg-red-500/15 text-red-300 px-1.5 py-0.5 rounded" title="Same client phone logged more than once">⚠️ dup</span>}
                    </div>
                    {l.client_phone && (
                      wa
                        ? <a href={wa} target="_blank" rel="noopener noreferrer" className="text-[13px] text-amber-400 hover:underline">{l.client_phone} ↗</a>
                        : <span className="text-[13px] text-zinc-400">{l.client_phone}</span>
                    )}
                  </div>
                  <select value={l.status} onChange={e => patchLead(l.id, { status: e.target.value })}
                    className={`shrink-0 text-xs font-semibold rounded-lg px-2.5 py-1.5 border ${tint.bg} ${tint.text} ${tint.border} focus:outline-none`}>
                    {STATUSES.map(s => <option key={s} value={s} className="bg-zinc-900 text-white">{STATUS_LABEL[s]}</option>)}
                  </select>
                </div>

                <p className="text-[13px] text-zinc-300 mt-2 leading-relaxed">{l.needs}</p>

                <div className="flex items-center justify-between gap-3 mt-3 text-[11px] text-zinc-500">
                  <span>👤 {l.rep_name}</span>
                  <span>{fmtDateTime(l.created_at)}</span>
                </div>

                {/* Founder notes */}
                {editingNotes === l.id ? (
                  <div className="mt-3">
                    <textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)} rows={2} autoFocus
                      placeholder="Private follow-up notes…"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm resize-none focus:outline-none focus:border-amber-500/60" />
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => { patchLead(l.id, { founder_notes: noteDraft }); setEditingNotes(null) }}
                        className="bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs px-3 py-1.5 rounded-lg">Save note</button>
                      <button onClick={() => setEditingNotes(null)}
                        className="bg-zinc-800 hover:bg-zinc-700 text-white text-xs px-3 py-1.5 rounded-lg">Cancel</button>
                    </div>
                  </div>
                ) : l.founder_notes ? (
                  <button onClick={() => { setEditingNotes(l.id); setNoteDraft(l.founder_notes || '') }}
                    className="mt-3 w-full text-left rounded-lg px-3 py-2 text-[13px] text-zinc-300 border border-zinc-800 hover:border-zinc-600"
                    style={{ background: 'rgba(245,158,11,0.05)' }}>
                    📝 {l.founder_notes}
                  </button>
                ) : (
                  <button onClick={() => { setEditingNotes(l.id); setNoteDraft('') }}
                    className="mt-3 text-xs text-zinc-500 hover:text-amber-400">＋ Add follow-up note</button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
