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
  manager_verdict: string | null
  manager_critique: string | null
  cross_flags: string[] | null
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
interface Outcome {
  dept: string
  predicted: { prediction?: { metric: string; direction: string; baseline: number; target?: number } } | null
  verdict: string | null
}
interface Detail { run: RunRow | null; opinions: Opinion[]; decisions: Decision[]; outcomes: Outcome[] }

const DEPT_ORDER = ['sales', 'ops', 'finance', 'marketing']
const HEAD_META: Record<string, { label: string; emoji: string }> = {
  sales: { label: 'Head of Sales', emoji: '📈' },
  ops: { label: 'Head of Ops', emoji: '⚙️' },
  finance: { label: 'Head of Finance', emoji: '💰' },
  marketing: { label: 'Head of Marketing', emoji: '📣' },
}
const PRIORITY: Record<string, string> = { high: 'text-red-400 border-red-500/30 bg-red-500/10', medium: 'text-amber-300 border-amber-500/30 bg-amber-500/10', low: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' }
const MODE_LABEL: Record<string, string> = { nightly: 'Morning Brief', weekly: 'Board Meeting', ondemand: 'On-demand' }
const STATUS_CHIP: Record<string, string> = { done: '✅ done', dismissed: '🙅 dismissed', snoozed: '⏰ snoozed' }

// Verdict → stamp + beam styling. revised=true means the manager rejected round 1
// and the head came back — the story worth showing.
function verdictKind(o: Opinion): 'grilled' | 'approved' | 'rejected' | 'reported' {
  if (o.revised) return 'grilled'
  if (o.manager_verdict === 'REJECT') return 'rejected'
  if (o.manager_verdict === 'APPROVE') return 'approved'
  return 'reported'
}
const STAMP: Record<string, { text: string; cls: string }> = {
  approved: { text: '✓ approved', cls: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' },
  grilled: { text: '⚔ grilled → revised', cls: 'text-amber-300 border-amber-500/50 bg-amber-500/10' },
  rejected: { text: '✕ rejected', cls: 'text-red-400 border-red-500/40 bg-red-500/10' },
  reported: { text: 'reported', cls: 'text-zinc-400 border-zinc-700 bg-zinc-800/40' },
}
const BEAM: Record<string, string> = {
  approved: '#10b981', grilled: '#f59e0b', rejected: '#ef4444', reported: '#52525b',
}
const OUTCOME_GRADE: Record<string, string> = { held: '✓ held', wrong: '✗ wrong', inconclusive: '— inconclusive' }

// Stage geometry (viewBox 1000×500): CEO at (500,118), heads across the bottom.
const HEAD_X = [125, 375, 625, 875]

function firstSentence(text: string | null, max = 190): string {
  if (!text) return ''
  const s = text.split(/(?<=[.!?])\s/)[0] ?? text
  return s.length > max ? s.slice(0, max) + '…' : s
}

// Confidence ring that fills on mount (re-fills on replay via parent key).
function ConfidenceRing({ pct, delay, color }: { pct: number; delay: number; color: string }) {
  const r = 26
  const c = 2 * Math.PI * r
  const [off, setOff] = useState(c)
  useEffect(() => {
    const t = setTimeout(() => setOff(c - (c * Math.min(100, Math.max(0, pct))) / 100), delay)
    return () => clearTimeout(t)
  }, [c, pct, delay])
  return (
    <svg width="60" height="60" viewBox="0 0 60 60" className="-rotate-90">
      <circle cx="30" cy="30" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
      <circle cx="30" cy="30" r={r} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off} style={{ transition: 'stroke-dashoffset 1.1s cubic-bezier(.22,1,.36,1)' }} />
    </svg>
  )
}

export default function CSuitePage() {
  const [runs, setRuns] = useState<RunRow[]>([])
  const [detail, setDetail] = useState<Detail | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'boardroom' | 'details'>('boardroom')
  const [take, setTake] = useState(1)          // bump to replay the choreography
  const [focusDept, setFocusDept] = useState<string | null>(null)

  function load(runId?: string) {
    setLoading(true); setError(null); setFocusDept(null)
    fetch(`/api/c-suite/latest${runId ? `?run=${runId}` : ''}`)
      .then(async r => {
        if (!r.ok) throw new Error(r.status === 403 || r.status === 401 ? 'Admin access required to view the board.' : `Couldn't load the board (${r.status}).`)
        return r.json()
      })
      .then((d: { runs: RunRow[]; detail: Detail }) => {
        setRuns(d.runs || [])
        setDetail(d.detail || null)
        setSelected(d.detail?.run?.id || d.runs?.[0]?.id || '')
        setTake(t => t + 1)
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

  if (loading && !detail) return <div className="text-zinc-500 mt-20 text-center">Convening the board…</div>
  if (error && !detail) return <div className="mt-20 text-center text-sm text-red-400/80">{error}</div>

  const run = detail?.run
  const byDept = new Map((detail?.opinions ?? []).map(o => [o.dept, o]))
  const heads = DEPT_ORDER.filter(d => byDept.has(d)).map(d => byDept.get(d)!)
  const outcomes = new Map((detail?.outcomes ?? []).map(o => [o.dept, o]))
  const decisions = detail?.decisions ?? []
  const rejectedCount = heads.filter(h => verdictKind(h) === 'grilled' || verdictKind(h) === 'rejected').length
  const focus = focusDept ? byDept.get(focusDept) : null

  return (
    <div className="space-y-6">
      {/* keyframes for the sitting choreography */}
      <style>{`
        @keyframes brPop { 0% { opacity:0; transform:scale(.6) } 70% { transform:scale(1.06) } 100% { opacity:1; transform:scale(1) } }
        @keyframes brRise { 0% { opacity:0; transform:translateY(14px) } 100% { opacity:1; transform:translateY(0) } }
        @keyframes brDraw { 0% { stroke-dashoffset:1 } 100% { stroke-dashoffset:0 } }
        @keyframes brFlow { 0% { stroke-dashoffset:0 } 100% { stroke-dashoffset:-0.6 } }
        @keyframes brStamp { 0% { opacity:0; transform:scale(1.9) rotate(-7deg) } 60% { opacity:1; transform:scale(.94) rotate(1deg) } 100% { opacity:1; transform:scale(1) rotate(0) } }
        @keyframes brPulse { 0%,100% { box-shadow:0 0 0 0 rgba(245,158,11,.28) } 50% { box-shadow:0 0 0 14px rgba(245,158,11,0) } }
        .br-pop { opacity:0; animation: brPop .55s cubic-bezier(.22,1,.36,1) forwards }
        .br-rise { opacity:0; animation: brRise .6s ease-out forwards }
        .br-stamp { opacity:0; animation: brStamp .45s cubic-bezier(.22,1,.36,1) forwards }
      `}</style>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">🏛️ AI C-Suite</h1>
          <p className="text-sm text-zinc-400">One manager. Four executives. Every ruling argued before it reaches you.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-zinc-700 overflow-hidden text-xs">
            {(['boardroom', 'details'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-2 capitalize ${view === v ? 'bg-amber-500 text-black font-semibold' : 'text-zinc-400 hover:text-white'}`}>
                {v}
              </button>
            ))}
          </div>
          {view === 'boardroom' && (
            <button onClick={() => setTake(t => t + 1)}
              className="text-xs px-3 py-2 rounded-lg border border-amber-500/40 text-amber-300 hover:bg-amber-500/10">
              ▶ Replay sitting
            </button>
          )}
          {runs.length > 0 && (
            <select
              value={selected}
              onChange={e => { setSelected(e.target.value); load(e.target.value) }}
              className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm max-w-[240px]">
              {runs.map(r => (
                <option key={r.id} value={r.id}>
                  {MODE_LABEL[r.mode] ?? r.mode} · {new Date(r.started_at).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })}{r.dry_run ? ' (dry)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {!run ? (
        <div className="text-zinc-500 text-center py-20">
          No board sittings yet. The C-Suite convenes nightly — or ask Jarvis to convene the board.
        </div>
      ) : view === 'boardroom' ? (
        <>
          {run.question && (
            <div className="bg-[#111] border border-zinc-800 rounded-xl p-4 text-sm">
              <span className="text-zinc-500">Question put to the board: </span><span className="text-white">{run.question}</span>
            </div>
          )}

          {/* ── THE BOARDROOM STAGE ─────────────────────────────────────────── */}
          <div key={take} className="relative rounded-2xl border border-zinc-800 overflow-hidden"
            style={{ background: 'radial-gradient(ellipse 60% 45% at 50% 12%, rgba(245,158,11,0.09), transparent 70%), linear-gradient(#0b0b0d, #101012)' }}>

            {/* Desktop stage */}
            <div className="hidden md:block relative" style={{ height: 500 }}>
              {/* beams */}
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1000 500" preserveAspectRatio="none" aria-hidden="true">
                {heads.map((h, i) => {
                  const kind = verdictKind(h)
                  const x = HEAD_X[i]
                  const d = `M 500 128 C 500 250, ${x} 210, ${x} 322`
                  return (
                    <g key={h.dept}>
                      <path d={d} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2" />
                      <path d={d} pathLength={1} fill="none" stroke={BEAM[kind]} strokeWidth="2" strokeLinecap="round"
                        strokeDasharray="1" strokeDashoffset="1" opacity="0.85"
                        style={{ animation: `brDraw .9s ease-out ${0.8 + i * 0.18}s forwards` }} />
                      <path d={d} pathLength={1} fill="none" stroke={BEAM[kind]} strokeWidth="3.5" strokeLinecap="round"
                        strokeDasharray="0.03 0.12" opacity="0"
                        style={{ animation: `brFlow 2.6s linear ${1.9 + i * 0.18}s infinite`, opacity: 0.9 }} />
                    </g>
                  )
                })}
              </svg>

              {/* CEO node */}
              <div className="absolute left-1/2 -translate-x-1/2 top-6 w-[420px] max-w-[46%] text-center br-pop" style={{ animationDelay: '0.05s' }}>
                <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center text-2xl shadow-lg"
                  style={{ animation: 'brPulse 2.8s ease-in-out 1.5s infinite' }}>🏛️</div>
                <div className="mt-2 text-sm font-semibold text-white">The Manager <span className="text-zinc-500 font-normal">· Opus</span></div>
                <div className="text-[10px] uppercase tracking-widest text-amber-400/90">chairs the board · grills every head</div>
                {run.board_brief && (
                  <div className="mt-2 text-xs text-zinc-300 bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2 leading-relaxed br-rise" style={{ animationDelay: '0.45s' }}>
                    “{firstSentence(run.board_brief)}”
                  </div>
                )}
              </div>

              {/* verdict stamps on the beams */}
              {heads.map((h, i) => {
                const k = verdictKind(h)
                return (
                  <div key={h.dept} className="absolute -translate-x-1/2 br-stamp"
                    style={{ left: `${HEAD_X[i] / 10}%`, top: '51%', animationDelay: `${2.1 + i * 0.22}s` }}>
                    <span className={`text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full border backdrop-blur ${STAMP[k].cls}`}>
                      {STAMP[k].text}
                    </span>
                  </div>
                )
              })}

              {/* head nodes */}
              {heads.map((h, i) => {
                const k = verdictKind(h)
                const oc = outcomes.get(h.dept)
                const p = oc?.predicted?.prediction
                return (
                  <button key={h.dept} onClick={() => setFocusDept(focusDept === h.dept ? null : h.dept)}
                    className={`absolute -translate-x-1/2 bottom-5 w-[220px] max-w-[23%] text-left rounded-xl border p-3 transition-colors br-pop
                      ${focusDept === h.dept ? 'border-amber-500/60 bg-amber-500/[0.07]' : 'border-zinc-800 bg-white/[0.03] hover:border-zinc-600'}`}
                    style={{ left: `${HEAD_X[i] / 10}%`, animationDelay: `${1.3 + i * 0.15}s` }}>
                    <div className="flex items-center gap-2.5">
                      <div className="relative w-[60px] h-[60px] shrink-0">
                        <ConfidenceRing pct={h.confidence ?? 0} delay={1600 + i * 150} color={BEAM[k]} />
                        <span className="absolute inset-0 flex items-center justify-center text-xl">{HEAD_META[h.dept]?.emoji}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-white truncate">{HEAD_META[h.dept]?.label ?? h.dept}</div>
                        <div className="text-[11px] text-zinc-500">{h.confidence ?? 0}% confident{h.revised ? ' · revised' : ''}</div>
                      </div>
                    </div>
                    <p className="mt-2 text-[11px] text-zinc-300 leading-snug line-clamp-2">{h.headline}</p>
                    {p && (
                      <p className="mt-1.5 text-[10px] text-amber-300/90 truncate">
                        📌 {p.metric} {p.baseline}→{p.target ?? (p.direction === 'up' ? '↑' : '↓')}
                        {oc?.verdict ? <span className="text-zinc-400"> · {OUTCOME_GRADE[oc.verdict] ?? oc.verdict}</span> : ''}
                      </p>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Mobile stage: stacked */}
            <div className="md:hidden p-4 space-y-3">
              <div className="text-center br-pop">
                <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center text-xl">🏛️</div>
                <div className="mt-1.5 text-sm font-semibold">The Manager <span className="text-zinc-500 font-normal">· Opus</span></div>
                {run.board_brief && <p className="mt-2 text-xs text-zinc-300 bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2 text-left">“{firstSentence(run.board_brief)}”</p>}
              </div>
              {heads.map((h, i) => {
                const k = verdictKind(h)
                return (
                  <button key={h.dept} onClick={() => setFocusDept(focusDept === h.dept ? null : h.dept)}
                    className="w-full text-left rounded-xl border border-zinc-800 bg-white/[0.03] p-3 br-rise" style={{ animationDelay: `${0.3 + i * 0.12}s` }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm">{HEAD_META[h.dept]?.emoji} <b className="text-xs">{HEAD_META[h.dept]?.label}</b> <span className="text-[11px] text-zinc-500">{h.confidence}%</span></span>
                      <span className={`text-[9px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full border ${STAMP[k].cls}`}>{STAMP[k].text}</span>
                    </div>
                    <p className="mt-1.5 text-[11px] text-zinc-300">{h.headline}</p>
                  </button>
                )
              })}
            </div>

            {/* stage footer */}
            <div className="border-t border-white/5 px-4 py-2.5 flex items-center justify-between flex-wrap gap-2 text-[11px] text-zinc-500">
              <span>{run.rounds ?? 1} debate round{(run.rounds ?? 1) !== 1 ? 's' : ''} · {rejectedCount ? `${rejectedCount} head${rejectedCount > 1 ? 's' : ''} pushed back on` : 'all heads approved'} · {heads.length} briefs</span>
              <span className="text-zinc-600">tap a head to read the exchange</span>
            </div>
          </div>

          {/* THE EXCHANGE — manager ↔ head transcript */}
          {focus && (
            <div className="rounded-2xl border border-zinc-800 bg-[#111] p-4 space-y-3 br-rise">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">{HEAD_META[focus.dept]?.emoji} The exchange — {HEAD_META[focus.dept]?.label}</h2>
                <button onClick={() => setFocusDept(null)} className="text-zinc-500 hover:text-white text-xs">✕ close</button>
              </div>
              <div className="flex gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-white/[0.05] border border-zinc-800 flex items-center justify-center text-sm shrink-0">{HEAD_META[focus.dept]?.emoji}</div>
                <div className="rounded-xl rounded-tl-sm bg-white/[0.04] border border-zinc-800 px-3 py-2 text-xs text-zinc-200 leading-relaxed">
                  <p className="text-zinc-400 mb-1 text-[10px] uppercase tracking-widest">reports</p>
                  <p>{focus.top_issue}</p>
                  <p className="mt-1.5 text-amber-300/90"><b>Move:</b> {focus.recommended_move}</p>
                  {focus.evidence && focus.evidence.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 text-[11px] text-zinc-500">
                      {focus.evidence.slice(0, 4).map((e, j) => <li key={j}>· {e}</li>)}
                    </ul>
                  )}
                </div>
              </div>
              {focus.manager_critique && (
                <div className="flex gap-2.5 flex-row-reverse">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center text-sm shrink-0">🏛️</div>
                  <div className="rounded-xl rounded-tr-sm bg-amber-500/[0.08] border border-amber-500/25 px-3 py-2 text-xs text-zinc-200 leading-relaxed">
                    <p className="text-amber-400/80 mb-1 text-[10px] uppercase tracking-widest">the manager {focus.revised ? 'grills' : 'rules'}</p>
                    <p>{focus.manager_critique}</p>
                    {focus.cross_flags && focus.cross_flags.length > 0 && (
                      <p className="mt-1.5 text-[11px] text-orange-300/80">⚔ conflict: {focus.cross_flags.join(' · ')}</p>
                    )}
                  </div>
                </div>
              )}
              {focus.revised && (
                <p className="text-center text-[11px] text-amber-300/80">↻ {HEAD_META[focus.dept]?.label} revised its position — approved on round 2</p>
              )}
            </div>
          )}

          {/* Rulings */}
          {decisions.length > 0 && (
            <div className="space-y-3 br-rise" style={{ animationDelay: '0.2s' }}>
              <div className="flex items-baseline justify-between">
                <h2 className="font-semibold text-sm">The board's rulings</h2>
                <span className="text-[11px] text-zinc-500">recommend-only — you approve</span>
              </div>
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
                    {(!d.status || d.status === 'pending' || d.status === 'snoozed') && (
                      (d.status === 'snoozed' ? (['done', 'dismissed'] as const) : (['done', 'dismissed', 'snoozed'] as const)).map(s => (
                        <button key={s} onClick={() => decide(d.id, s)} disabled={busy === d.id}
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
        </>
      ) : (
        <>
          {/* ── DETAILS VIEW (the original report) ──────────────────────────── */}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {heads.map((o) => (
              <div key={o.dept} className="bg-[#111] border border-zinc-800 rounded-xl p-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-sm">{HEAD_META[o.dept]?.emoji} {HEAD_META[o.dept]?.label ?? o.dept}</h3>
                  <span className="text-xs text-zinc-500">{o.confidence ?? 0}%{o.revised ? ' · revised' : ''}</span>
                </div>
                <p className="text-sm text-zinc-200">{o.headline}</p>
                {o.top_issue && <p className="text-xs text-zinc-400 mt-2"><span className="text-zinc-500">Issue: </span>{o.top_issue}</p>}
                {o.recommended_move && <p className="text-xs text-amber-300/90 mt-1"><span className="text-zinc-500">Move: </span>{o.recommended_move}</p>}
                {o.manager_critique && <p className="text-xs text-zinc-400 mt-2"><span className="text-zinc-500">Manager: </span>{o.manager_critique}</p>}
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
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    {d.status && d.status !== 'pending' && (
                      <span className="text-xs text-zinc-300">{STATUS_CHIP[d.status] ?? d.status}{d.decided_by ? ` · by ${d.decided_by}` : ''}</span>
                    )}
                    {(!d.status || d.status === 'pending' || d.status === 'snoozed') && (
                      (d.status === 'snoozed' ? (['done', 'dismissed'] as const) : (['done', 'dismissed', 'snoozed'] as const)).map(s => (
                        <button key={s} onClick={() => decide(d.id, s)} disabled={busy === d.id}
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
        </>
      )}
    </div>
  )
}
