'use client'
import { useEffect, useState } from 'react'

interface RunRow {
  id: string
  started_at: string
  finished_at: string | null
  mode: string
  status: string
  question: string | null
  rounds: number | null
  dry_run: boolean
  board_brief: string | null
  note: string | null
  source: string | null
}
interface Opinion {
  dept: string
  headline: string | null
  top_issue: string | null
  recommended_move: string | null
  confidence: number | null
  evidence: string[] | null
  data_status: string | null
  revised: boolean
}
interface Decision {
  id: string
  title: string | null
  decision: string | null
  rationale: string | null
  overruled: string[] | null
  priority: string | null
  confidence: number | null
  status: string | null
  decided_by: string | null
}
interface Detail { run: RunRow | null; opinions: Opinion[]; decisions: Decision[] }

const HEAD_LABEL: Record<string, string> = { sales: '📈 Head of Sales', ops: '⚙️ Head of Ops', finance: '💰 Head of Finance', marketing: '📣 Head of Marketing' }
const PRIORITY: Record<string, string> = { high: 'text-red-400 border-red-500/30 bg-red-500/10', medium: 'text-amber-300 border-amber-500/30 bg-amber-500/10', low: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' }
const MODE_LABEL: Record<string, string> = { nightly: 'Morning Brief', weekly: 'Board Meeting', ondemand: 'On-demand' }
const STATUS_CHIP: Record<string, string> = { done: '✅ done', dismissed: '🙅 dismissed', snoozed: '⏰ snoozed' }

export default function CSuitePage() {
  const [runs, setRuns] = useState<RunRow[]>([])
  const [detail, setDetail] = useState<Detail | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function load(runId?: string) {
    setLoading(true); setError(null)
    fetch(`/api/c-suite/latest${runId ? `?run=${runId}` : ''}`)
      .then(async r => {
        if (!r.ok) throw new Error(r.status === 403 || r.status === 401 ? 'Admin access required to view the board.' : `Couldn't load the board (${r.status}).`)
        return r.json()
      })
      .then((d: { runs: RunRow[]; detail: Detail }) => {
        setRuns(d.runs || [])
        setDetail(d.detail || null)
        setSelected(d.detail?.run?.id || d.runs?.[0]?.id || '')
      })
      .catch((e: Error) => { setError(e.message); setRuns([]); setDetail(null) })
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const [busy, setBusy] = useState<string | null>(null)
  async function decide(id: string, status: 'done' | 'dismissed' | 'snoozed') {
    setBusy(id)
    try {
      const res = await fetch('/api/c-suite/decision', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      if (res.ok) load(selected || undefined)
    } finally {
      setBusy(null)
    }
  }

  if (loading && !detail) return <div className="text-zinc-500 mt-20 text-center">Convening…</div>
  if (error && !detail) return <div className="mt-20 text-center text-sm text-red-400/80">{error}</div>

  const run = detail?.run
  const opinions = detail?.opinions ?? []
  const decisions = detail?.decisions ?? []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">🏛️ AI C-Suite</h1>
          <p className="text-sm text-zinc-400">Manager (Opus) + 4 department heads (Sonnet) · recommend-only</p>
        </div>
        {runs.length > 0 && (
          <select
            value={selected}
            onChange={e => { setSelected(e.target.value); load(e.target.value) }}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm max-w-xs">
            {runs.map(r => (
              <option key={r.id} value={r.id}>
                {MODE_LABEL[r.mode] ?? r.mode} · {new Date(r.started_at).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })}{r.dry_run ? ' (dry)' : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {!run ? (
        <div className="text-zinc-500 text-center py-20">
          No board sittings yet. The C-Suite runs nightly, or trigger one:<br />
          <code className="text-amber-400 text-xs">GET /api/c-suite/run</code> (with the CRON_SECRET bearer).
        </div>
      ) : (
        <>
          {run.question && (
            <div className="bg-[#111] border border-zinc-800 rounded-xl p-4 text-sm">
              <span className="text-zinc-500">Question: </span><span className="text-white">{run.question}</span>
            </div>
          )}

          {/* Board brief */}
          {run.board_brief && (
            <div className="bg-gradient-to-br from-amber-500/10 to-transparent border border-amber-500/20 rounded-xl p-5">
              <h2 className="font-semibold text-sm mb-2 text-amber-300">Manager&apos;s brief</h2>
              <p className="text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">{run.board_brief}</p>
              <p className="text-xs text-zinc-500 mt-3">
                {run.rounds != null && <>{run.rounds} debate round{run.rounds !== 1 ? 's' : ''} · </>}
                status {run.status}{run.source ? ` · via ${run.source}` : ''}{run.note ? ` · ${run.note}` : ''}
              </p>
              {run.note?.includes('grilling degraded') && (
                <p className="text-xs text-orange-400/90 mt-1">⚠ The challenge round failed this sitting — verdicts were unvetted.</p>
              )}
            </div>
          )}

          {/* Rulings */}
          {decisions.length > 0 && (
            <div className="space-y-3">
              <h2 className="font-semibold text-sm">Rulings</h2>
              {decisions.map((d) => (
                <div key={d.id} className={`border rounded-xl p-4 ${PRIORITY[d.priority ?? 'medium'] ?? PRIORITY.medium} ${d.status && d.status !== 'pending' ? 'opacity-60' : ''}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h3 className="font-semibold text-sm text-white">{d.title}</h3>
                    <span className="text-[11px] uppercase tracking-wide opacity-80">{d.priority} · {d.confidence ?? 0}%</span>
                  </div>
                  <p className="text-sm text-zinc-200 mt-1">{d.decision}</p>
                  {d.rationale && <p className="text-xs text-zinc-400 mt-2">{d.rationale}</p>}
                  {d.overruled && d.overruled.length > 0 && (
                    <p className="text-xs text-zinc-500 mt-2">Overruled: {d.overruled.join('; ')}</p>
                  )}
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    {d.status && d.status !== 'pending' && (
                      <span className="text-xs text-zinc-300">{STATUS_CHIP[d.status] ?? d.status}{d.decided_by ? ` · by ${d.decided_by}` : ''}</span>
                    )}
                    {/* Pending: all three actions. Snoozed: still open — offer done/dismiss. */}
                    {(!d.status || d.status === 'pending' || d.status === 'snoozed') && (
                      (d.status === 'snoozed' ? (['done', 'dismissed'] as const) : (['done', 'dismissed', 'snoozed'] as const)).map(s => (
                        <button
                          key={s}
                          onClick={() => decide(d.id, s)}
                          disabled={busy === d.id}
                          className="text-xs px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-50">
                          {STATUS_CHIP[s]}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Heads */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {opinions.map((o, i) => (
              <div key={i} className="bg-[#111] border border-zinc-800 rounded-xl p-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-sm">{HEAD_LABEL[o.dept] ?? o.dept}</h3>
                  <span className="text-xs text-zinc-500">{o.confidence ?? 0}%{o.revised ? ' · revised' : ''}</span>
                </div>
                <p className="text-sm text-zinc-200">{o.headline}</p>
                {o.top_issue && <p className="text-xs text-zinc-400 mt-2"><span className="text-zinc-500">Issue: </span>{o.top_issue}</p>}
                {o.recommended_move && <p className="text-xs text-amber-300/90 mt-1"><span className="text-zinc-500">Move: </span>{o.recommended_move}</p>}
                {o.evidence && o.evidence.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {o.evidence.map((e, j) => <li key={j} className="text-[11px] text-zinc-500">• {e}</li>)}
                  </ul>
                )}
                {o.data_status && o.data_status !== 'ok' && (
                  <p className="text-[11px] text-orange-400/70 mt-2">⚠ {o.data_status}</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
