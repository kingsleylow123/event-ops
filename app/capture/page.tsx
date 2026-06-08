'use client'
import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

// Phone validation (mirrors survey / start pages).
function isValidPhone(s: string): boolean {
  const digits = s.replace(/[\s+()-]/g, '')
  return /^\d{8,15}$/.test(digits)
}

interface SessionLead { client_name: string; client_phone: string; needs: string; at: number }

function CaptureContent() {
  const params = useSearchParams()
  const eventId = params.get('event') || ''

  const [eventName, setEventName] = useState<string | null>(null)
  const [rep, setRep] = useState<{ name: string; phone: string } | null>(null)
  const [editingRep, setEditingRep] = useState(false)
  const [repName, setRepName] = useState('')
  const [repPhone, setRepPhone] = useState('')

  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [needs, setNeeds] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [session, setSession] = useState<SessionLead[]>([])

  const REP_KEY = `capture_rep_${eventId}`

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!eventId) return
    try {
      const r = localStorage.getItem(REP_KEY)
      if (r) setRep(JSON.parse(r))
      else setEditingRep(true)
    } catch { setEditingRep(true) }
    fetch(`/api/survey?event_id=${eventId}&facts=1`)
      .then(r => r.json()).then((d: { name?: string | null }) => setEventName(d?.name ?? null)).catch(() => {})
  }, [eventId]) // eslint-disable-line react-hooks/exhaustive-deps
  /* eslint-enable react-hooks/set-state-in-effect */

  function saveRep() {
    if (!repName.trim() || !isValidPhone(repPhone)) return
    const r = { name: repName.trim(), phone: repPhone.trim() }
    setRep(r); setEditingRep(false); setRepName(''); setRepPhone('')
    try { localStorage.setItem(REP_KEY, JSON.stringify(r)) } catch { /* ignore */ }
  }
  function startSwitchRep() {
    setRepName(rep?.name ?? ''); setRepPhone(rep?.phone ?? ''); setEditingRep(true)
  }

  const canSubmit = !!(rep && clientName.trim() && isValidPhone(clientPhone) && needs.trim() && !saving)

  async function submit() {
    if (!canSubmit || !rep) return
    setSaving(true)
    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId, rep_name: rep.name, rep_phone: rep.phone,
          client_name: clientName.trim(), client_phone: clientPhone.trim(), needs: needs.trim(),
        }),
      })
      if (!res.ok) throw new Error('save failed')
      setSession(s => [{ client_name: clientName.trim(), client_phone: clientPhone.trim(), needs: needs.trim(), at: Date.now() }, ...s])
      setClientName(''); setClientPhone(''); setNeeds('')
      setToast('✓ Logged — sent to Kingsley. Add another 👇')
      setTimeout(() => setToast(''), 2800)
    } catch {
      setToast('⚠️ Could not save — check signal and try again')
      setTimeout(() => setToast(''), 2800)
    } finally { setSaving(false) }
  }

  if (!eventId) {
    return <div className="min-h-screen flex items-center justify-center bg-black"><p className="text-zinc-500">Invalid link.</p></div>
  }

  return (
    <div className="relative min-h-screen text-white" style={{ background: '#060606' }}>
      {/* Ambient glow (clipped here so it can't cause horizontal scroll) */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[640px] h-[640px] rounded-full blur-[120px] opacity-[0.20]"
          style={{ background: 'radial-gradient(circle, #D4684A 0%, transparent 65%)' }} />
        <div className="absolute bottom-0 -right-24 w-[420px] h-[420px] rounded-full blur-[120px] opacity-[0.10]"
          style={{ background: 'radial-gradient(circle, #f59e0b 0%, transparent 65%)' }} />
      </div>

      <div className="max-w-lg mx-auto px-5 pb-28 pt-8">
        {/* Hero */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.15em] text-amber-300/90 uppercase mb-3 px-3 py-1 rounded-full"
            style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.18)' }}>
            🔥 Back-Table Lead Capture
          </div>
          <h1 className="text-[26px] sm:text-3xl font-extrabold leading-[1.1] tracking-tight mb-2">
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(180deg, #fff 30%, #d4a574)' }}>
              Log a hot lead
            </span>
          </h1>
          <p className="text-zinc-400 text-[14px] leading-relaxed max-w-xs mx-auto">
            Capture the prospect, hit log — it pings <span className="text-white font-medium">Kingsley instantly</span> to close.
            {eventName && <> <span className="text-zinc-500">· {eventName}</span></>}
          </p>
        </div>

        {/* Identity card */}
        {(editingRep || !rep) ? (
          <Glass className="p-5">
            <div className="text-lg font-bold mb-1">Who&apos;s logging? 👋</div>
            <p className="text-[13px] text-zinc-400 mb-4 leading-relaxed">Enter your name + WhatsApp once — so Kingsley knows who spotted the lead. Saved on this device.</p>
            <label className="block text-xs text-zinc-500 mb-1.5">Your name</label>
            <input value={repName} onChange={e => setRepName(e.target.value)} placeholder="e.g. Steven"
              className="w-full mb-3 bg-black/40 border border-white/15 rounded-2xl px-4 py-3.5 text-white text-sm focus:outline-none focus:border-amber-500/60" />
            <label className="block text-xs text-zinc-500 mb-1.5">Your WhatsApp number</label>
            <input value={repPhone} onChange={e => setRepPhone(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveRep()}
              placeholder="e.g. 0123456789" type="tel"
              className="w-full bg-black/40 border border-white/15 rounded-2xl px-4 py-3.5 text-white text-sm focus:outline-none focus:border-amber-500/60" />
            {repPhone.trim().length > 0 && !isValidPhone(repPhone) && (
              <p className="text-xs text-red-400 mt-2">Enter a valid number (with country code if outside Malaysia).</p>
            )}
            <button onClick={saveRep} disabled={!repName.trim() || !isValidPhone(repPhone)}
              className="w-full mt-4 disabled:opacity-40 text-black font-semibold rounded-2xl py-3.5 text-sm transition-all active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #f59e0b, #D4684A)' }}>
              Start logging →
            </button>
          </Glass>
        ) : (
          <>
            {/* Rep chip */}
            <div className="flex items-center justify-between mb-4 px-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-bold text-black"
                  style={{ background: 'linear-gradient(135deg, #f59e0b, #D4684A)' }}>
                  {rep.name.charAt(0).toUpperCase()}
                </span>
                <span className="text-zinc-300">Logging as <b className="text-white">{rep.name}</b></span>
              </div>
              <button onClick={startSwitchRep} className="text-xs text-zinc-500 hover:text-amber-400 underline underline-offset-2">not you?</button>
            </div>

            {/* Lead form */}
            <Glass className="p-5">
              <label className="block text-xs text-zinc-500 mb-1.5">Client / company name</label>
              <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g. Acme Sdn Bhd — Mr Tan"
                className="w-full mb-4 bg-black/40 border border-white/15 rounded-2xl px-4 py-3.5 text-white text-sm focus:outline-none focus:border-amber-500/60" />

              <label className="block text-xs text-zinc-500 mb-1.5">Client phone (WhatsApp)</label>
              <input value={clientPhone} onChange={e => setClientPhone(e.target.value)} placeholder="e.g. 0123456789" type="tel"
                className="w-full bg-black/40 border border-white/15 rounded-2xl px-4 py-3.5 text-white text-sm focus:outline-none focus:border-amber-500/60" />
              {clientPhone.trim().length > 0 && !isValidPhone(clientPhone) && (
                <p className="text-xs text-red-400 mt-2">Enter a valid number.</p>
              )}

              <label className="block text-xs text-zinc-500 mb-1.5 mt-4">What do they need? / discussion topic</label>
              <textarea value={needs} onChange={e => setNeeds(e.target.value)} rows={3}
                placeholder="e.g. Wants to automate sales reporting across 3 branches — bringing CTO"
                className="w-full bg-black/40 border border-white/15 rounded-2xl px-4 py-3.5 text-white text-sm leading-relaxed resize-none focus:outline-none focus:border-amber-500/60" />

              <button onClick={submit} disabled={!canSubmit}
                className="w-full mt-5 disabled:opacity-40 text-black font-bold rounded-2xl py-4 text-[15px] transition-all active:scale-[0.98]"
                style={{ background: 'linear-gradient(135deg, #f59e0b, #D4684A)', boxShadow: '0 8px 30px -8px rgba(212,104,74,0.6)' }}>
                {saving ? 'Logging…' : '＋ Log lead'}
              </button>
            </Glass>

            {/* Session list */}
            {session.length > 0 && (
              <div className="mt-6">
                <div className="text-xs text-zinc-500 mb-2 px-1">Your leads this session · {session.length}</div>
                <div className="space-y-2">
                  {session.map((l, i) => (
                    <div key={l.at + '-' + i} className="flex items-start gap-3 rounded-2xl px-4 py-3 border border-white/[0.07]" style={{ background: 'rgba(255,255,255,0.02)' }}>
                      <span className="text-emerald-400 mt-0.5">✓</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-white truncate">{l.client_name}</div>
                        <div className="text-[12px] text-zinc-500 truncate">{l.client_phone} · {l.needs}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl text-sm font-semibold text-white animate-[fadein_0.2s_ease]"
          style={{ background: 'rgba(20,20,22,0.92)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.12)' }}>
          {toast}
        </div>
      )}

      <style>{`
        @keyframes fadein { from { opacity:0; transform: translate(-50%, 8px); } to { opacity:1; transform: translate(-50%, 0); } }
      `}</style>
    </div>
  )
}

function Glass({ children, className = '', style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`rounded-[22px] border border-white/[0.08] ${className}`}
      style={{ background: 'rgba(255,255,255,0.03)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', ...style }}>
      {children}
    </div>
  )
}

export default function CapturePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <CaptureContent />
    </Suspense>
  )
}
