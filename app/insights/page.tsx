'use client'
import { useEffect, useState } from 'react'
import type { Event } from '@/lib/supabase'
import { resolveInitialEvent, storeEventId } from '@/lib/event'
import { useCachedFetch, mutateCache, peekCache } from '@/lib/useCachedFetch'
import { PREP_STEP_LABELS } from '@/lib/prep-steps'

interface SurveyResponse {
  id: string
  attendee_id: string | null
  name: string
  phone: string | null
  industry: string | null
  company_size: string | null
  biggest_challenge: string | null
  workshop_goal: string | null
  created_at: string
}

interface PrepSummary {
  started: number
  completed: number
  perStep: Record<string, number>
  perTrack?: Record<string, number>
  perTool?: Record<string, number>
  people: { name: string; completed: boolean; done: number; track?: string | null; tool?: string | null; tool_has_api?: boolean | null }[]
  total?: number
  variant?: string
  labels?: Record<string, string>
}

function count<T>(arr: T[], key: (item: T) => string | null): Record<string, number> {
  return arr.reduce((acc, item) => {
    const val = key(item) || 'Unknown'
    acc[val] = (acc[val] || 0) + 1
    return acc
  }, {} as Record<string, number>)
}

function sorted(obj: Record<string, number>): [string, number][] {
  return Object.entries(obj).sort((a, b) => b[1] - a[1])
}

export default function InsightsPage() {
  const { data: eventsData, loading: fetchingEvents } = useCachedFetch<Event[]>('events', '/api/events')
  const [events, setEvents] = useState<Event[]>([])
  const [selectedEventId, setSelectedEventId] = useState<string>('')
  const [responses, setResponses] = useState<SurveyResponse[]>([])
  const [loadingResponses, setLoadingResponses] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<SurveyResponse>>({})
  const [surveyLink, setSurveyLink] = useState('')

  const loading = fetchingEvents && !eventsData

  useEffect(() => {
    if (!eventsData) return
    setEvents(eventsData)
    if (!selectedEventId) {
      const active = resolveInitialEvent(eventsData)
      if (active) setSelectedEventId(active.id)
    }
  }, [eventsData, selectedEventId])

  // Survey responses: cached per event (instant), refreshed in background.
  useEffect(() => {
    if (!selectedEventId) return
    const cacheKey = `survey:${selectedEventId}`
    const cached = peekCache<SurveyResponse[]>(cacheKey)
    if (cached) setResponses(cached)
    else setLoadingResponses(true)
    fetch(`/api/survey?event_id=${selectedEventId}`)
      .then(r => r.json())
      .then((data: SurveyResponse[]) => { setResponses(data); mutateCache<SurveyResponse[]>(cacheKey, () => data) })
      .catch(() => { if (!cached) setResponses([]) })
      .finally(() => setLoadingResponses(false))

    const base = typeof window !== 'undefined' ? window.location.origin : ''
    setSurveyLink(`${base}/survey?event=${selectedEventId}`)
  }, [selectedEventId])

  // Pre-workshop prep readiness
  const [prep, setPrep] = useState<PrepSummary | null>(null)
  const [startLink, setStartLink] = useState('')
  useEffect(() => {
    if (!selectedEventId) return
    fetch(`/api/prep?event_id=${selectedEventId}&summary=1`)
      .then(r => r.ok ? r.json() : null)
      .then((d: PrepSummary | null) => setPrep(d))
      .catch(() => setPrep(null))
    const base = typeof window !== 'undefined' ? window.location.origin : ''
    setStartLink(`${base}/start?event=${selectedEventId}`)
  }, [selectedEventId])

  function copyLink() {
    navigator.clipboard.writeText(surveyLink)
  }

  async function saveEdit(id: string) {
    const res = await fetch('/api/survey', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...editForm }),
    })
    if (res.ok) {
      const updated = await res.json()
      setResponses(prev => prev.map(r => r.id === id ? updated : r))
      setEditingId(null)
    }
  }

  const industryCounts = sorted(count(responses, r => r.industry))
  const sizeCounts = sorted(count(responses, r => r.company_size))

  if (loading) return <div className="text-zinc-500 mt-20 text-center">Loading...</div>

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Pre-Event Survey Insights</h1>
          <p className="text-sm text-zinc-400">{responses.length} response{responses.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectedEventId}
            onChange={e => { setSelectedEventId(e.target.value); storeEventId(e.target.value) }}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
            {events.map(e => (
              <option key={e.id} value={e.id}>{e.name}{e.is_active ? ' (Active)' : ''}</option>
            ))}
          </select>
          <button onClick={copyLink}
            className="bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm px-4 py-2 rounded-lg">
            📋 Copy Survey Link
          </button>
        </div>
      </div>

      {/* Survey link + QR */}
      <div className="bg-[#111] border border-zinc-800 rounded-xl p-4 flex flex-col sm:flex-row gap-4 items-center sm:items-start">
        {/* QR Code */}
        {surveyLink && (
          <div className="flex-shrink-0 flex flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(surveyLink)}`}
              alt="Survey QR Code"
              width={140}
              height={140}
              style={{ background: '#fff', padding: 6, borderRadius: 8 }}
            />
            <button
              onClick={() => {
                const w = window.open('', '_blank', 'width=500,height=600')
                if (!w) return
                w.document.write(`<!DOCTYPE html><html><head><title>Survey QR</title><style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:-apple-system,sans-serif;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:40px;}img{width:280px;height:280px;}h1{font-size:22px;font-weight:800;color:#111;margin-top:20px;text-align:center;}p{font-size:13px;color:#666;margin-top:8px;text-align:center;}.badge{margin-top:14px;background:#fff4e6;border:2px solid #e8563a;color:#e8563a;font-weight:700;font-size:12px;padding:5px 16px;border-radius:999px;}</style></head><body><img src="https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(surveyLink)}" /><h1>📋 Pre-Event Survey</h1><p>Please scan and fill in before the session</p><div class="badge">Claude Malaysia Workshop</div><script>window.onload=()=>window.print()</script></body></html>`)
                w.document.close()
              }}
              className="text-xs text-zinc-400 hover:text-white border border-zinc-700 rounded-lg px-3 py-1.5"
            >🖨 Print</button>
          </div>
        )}
        {/* URL */}
        <div className="flex-1 flex flex-col gap-2 justify-center">
          <span className="text-xs text-zinc-500">Survey URL:</span>
          <span className="text-xs text-amber-400 break-all">{surveyLink}</span>
          <button onClick={copyLink} className="text-xs text-zinc-400 hover:text-white border border-zinc-700 rounded-lg px-3 py-1.5 w-fit">📋 Copy Link</button>
        </div>
      </div>

      {/* Pre-Workshop Prep readiness */}
      {prep && prep.started > 0 && (
        <div className="bg-[#111] border border-zinc-800 rounded-xl p-5">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
            <h2 className="font-semibold text-sm">🎓 Pre-Workshop Prep</h2>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-zinc-400"><b className="text-white">{prep.started}</b> started</span>
              <span className="text-amber-400"><b>{prep.completed}</b> fully ready</span>
              {startLink && (
                <button onClick={() => navigator.clipboard.writeText(startLink)}
                  className="text-zinc-400 hover:text-white border border-zinc-700 rounded-lg px-2.5 py-1">📋 Copy Start Link</button>
              )}
            </div>
          </div>
          {(() => {
            const labels = prep.labels ?? PREP_STEP_LABELS
            const total = prep.total ?? Object.keys(labels).length
            return (
              <>
                {/* per-step bars */}
                <div className="space-y-2 mb-4">
                  {Object.keys(labels).map(k => {
                    const n = prep.perStep[k] ?? 0
                    const pctv = prep.started ? (n / prep.started) * 100 : 0
                    return (
                      <div key={k} className="flex items-center gap-3">
                        <span className="text-xs text-zinc-400 w-36 shrink-0">{labels[k]}</span>
                        <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                          <div className="h-full bg-amber-500 rounded-full" style={{ width: `${pctv}%` }} />
                        </div>
                        <span className="text-xs text-zinc-400 w-8 text-right shrink-0">{n}</span>
                      </div>
                    )
                  })}
                </div>
                {/* track distribution (GLCC) */}
                {prep.perTrack && Object.keys(prep.perTrack).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {Object.entries(prep.perTrack).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
                      <span key={t} className="text-[11px] px-2 py-0.5 rounded-full border bg-white/[0.03] border-white/10 text-zinc-300">
                        {t}: <b className="text-amber-300">{n}</b>
                      </span>
                    ))}
                  </div>
                )}
                {/* tool distribution (GLCC) */}
                {prep.perTool && Object.keys(prep.perTool).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {Object.entries(prep.perTool).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
                      <span key={t} className="text-[11px] px-2 py-0.5 rounded-full border bg-emerald-500/[0.06] border-emerald-500/20 text-emerald-200/90">
                        🔌 {t}: <b className="text-emerald-300">{n}</b>
                      </span>
                    ))}
                  </div>
                )}
                {/* who */}
                <div className="flex flex-wrap gap-1.5">
                  {prep.people.map((p, i) => (
                    <span key={i} className={`text-[11px] px-2 py-0.5 rounded-full border ${p.completed ? 'bg-amber-500/15 border-amber-500/30 text-amber-300' : 'bg-white/[0.03] border-white/10 text-zinc-400'}`}>
                      {p.completed ? '✓ ' : `${p.done}/${total} `}{p.name}{p.track ? ` · ${p.track}` : ''}{p.tool ? ` · 🔌${p.tool}${p.tool_has_api ? '✓' : '?'}` : ''}
                    </span>
                  ))}
                </div>
              </>
            )
          })()}
        </div>
      )}

      {loadingResponses ? (
        <div className="text-zinc-500 text-center py-12">Loading responses...</div>
      ) : responses.length === 0 ? (
        <div className="text-zinc-500 text-center py-20">
          No responses yet. Share the survey link with attendees.
        </div>
      ) : (
        <>
          {/* Summary charts */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Industry breakdown */}
            <div className="bg-[#111] border border-zinc-800 rounded-xl p-5">
              <h2 className="font-semibold text-sm mb-4">Industry Breakdown</h2>
              <div className="space-y-2">
                {industryCounts.map(([ind, n]) => (
                  <div key={ind} className="flex items-center gap-3">
                    <span className="text-xs text-zinc-400 w-40 truncate shrink-0">{ind}</span>
                    <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-500 rounded-full"
                        style={{ width: `${(n / responses.length) * 100}%` }} />
                    </div>
                    <span className="text-xs text-zinc-400 w-4 text-right shrink-0">{n}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Company size breakdown */}
            <div className="bg-[#111] border border-zinc-800 rounded-xl p-5">
              <h2 className="font-semibold text-sm mb-4">Company Size</h2>
              <div className="space-y-2">
                {sizeCounts.map(([size, n]) => (
                  <div key={size} className="flex items-center gap-3">
                    <span className="text-xs text-zinc-400 w-32 truncate shrink-0">{size}</span>
                    <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full"
                        style={{ width: `${(n / responses.length) * 100}%` }} />
                    </div>
                    <span className="text-xs text-zinc-400 w-4 text-right shrink-0">{n}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* All responses table */}
          <div className="bg-[#111] border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-zinc-800">
              <h2 className="font-semibold text-sm">All Responses</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 text-xs border-b border-zinc-900">
                    <th className="px-4 py-2">Name</th>
                    <th className="px-4 py-2">Phone</th>
                    <th className="px-4 py-2">Industry</th>
                    <th className="px-4 py-2">Size</th>
                    <th className="px-4 py-2">Biggest Challenge</th>
                    <th className="px-4 py-2">10/10 Goal</th>
                    <th className="px-4 py-2">Submitted</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {responses.map(r => (
                    <tr key={r.id} className="border-b border-zinc-900 hover:bg-zinc-900/30 align-top">
                      {editingId === r.id ? (
                        <>
                          <td className="px-4 py-2">
                            <input value={editForm.name ?? r.name}
                              onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                              className="bg-zinc-800 rounded px-2 py-1 text-xs w-28" />
                          </td>
                          <td className="px-4 py-2">
                            <input value={editForm.phone ?? r.phone ?? ''}
                              onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                              className="bg-zinc-800 rounded px-2 py-1 text-xs w-28" />
                          </td>
                          <td className="px-4 py-2">
                            <input value={editForm.industry ?? r.industry ?? ''}
                              onChange={e => setEditForm(f => ({ ...f, industry: e.target.value }))}
                              className="bg-zinc-800 rounded px-2 py-1 text-xs w-28" />
                          </td>
                          <td className="px-4 py-2">
                            <input value={editForm.company_size ?? r.company_size ?? ''}
                              onChange={e => setEditForm(f => ({ ...f, company_size: e.target.value }))}
                              className="bg-zinc-800 rounded px-2 py-1 text-xs w-24" />
                          </td>
                          <td className="px-4 py-2">
                            <textarea value={editForm.biggest_challenge ?? r.biggest_challenge ?? ''}
                              onChange={e => setEditForm(f => ({ ...f, biggest_challenge: e.target.value }))}
                              rows={3}
                              className="bg-zinc-800 rounded px-2 py-1 text-xs w-48 resize-none" />
                          </td>
                          <td className="px-4 py-2">
                            <textarea value={editForm.workshop_goal ?? r.workshop_goal ?? ''}
                              onChange={e => setEditForm(f => ({ ...f, workshop_goal: e.target.value }))}
                              rows={3}
                              className="bg-zinc-800 rounded px-2 py-1 text-xs w-48 resize-none" />
                          </td>
                          <td className="px-4 py-2 text-zinc-500 text-xs whitespace-nowrap">
                            {new Date(r.created_at).toLocaleDateString('en-MY')}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex gap-1">
                              <button onClick={() => saveEdit(r.id)}
                                className="text-xs bg-amber-500 text-black px-2 py-1 rounded">Save</button>
                              <button onClick={() => setEditingId(null)}
                                className="text-xs text-zinc-500 hover:text-white px-2 py-1">✕</button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-3 font-medium text-white whitespace-nowrap">{r.name}</td>
                          <td className="px-4 py-3 text-zinc-400 text-xs whitespace-nowrap">{r.phone || '—'}</td>
                          <td className="px-4 py-3 text-zinc-400 text-xs">{r.industry || '—'}</td>
                          <td className="px-4 py-3 text-zinc-400 text-xs whitespace-nowrap">{r.company_size || '—'}</td>
                          <td className="px-4 py-3 text-zinc-300 text-xs max-w-xs">
                            <p className="line-clamp-3">{r.biggest_challenge || '—'}</p>
                          </td>
                          <td className="px-4 py-3 text-zinc-300 text-xs max-w-xs">
                            <p className="line-clamp-3">{r.workshop_goal || '—'}</p>
                          </td>
                          <td className="px-4 py-3 text-zinc-500 text-xs whitespace-nowrap">
                            {new Date(r.created_at).toLocaleDateString('en-MY')}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => { setEditingId(r.id); setEditForm({}) }}
                              className="text-zinc-500 hover:text-amber-400 text-xs">Edit</button>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
