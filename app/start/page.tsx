'use client'
import { useEffect, useState, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

// Phone validation (mirrors survey page)
function isValidPhone(s: string): boolean {
  const digits = s.replace(/[\s+()-]/g, '')
  return /^\d{8,15}$/.test(digits)
}

interface Facts {
  name?: string | null; date?: string | null; venue?: string | null
}

const STEP_IDS = ['1', '2', '3', '4', '5'] as const
type Steps = Record<string, boolean>
type OS = 'mac' | 'windows' | null

function StartContent() {
  const params = useSearchParams()
  const eventId = params.get('event') || ''

  const [facts, setFacts] = useState<Facts | null>(null)
  const [steps, setSteps] = useState<Steps>({ '1': false, '2': false, '3': false, '4': false, '5': false })
  const [ipadAck, setIpadAck] = useState(false)
  const [os, setOs] = useState<OS>(null)
  const [phone, setPhone] = useState('')
  const [phoneAsked, setPhoneAsked] = useState(false)
  const [phoneInput, setPhoneInput] = useState('')
  const [pendingStep, setPendingStep] = useState<string | null>(null)

  const PHONE_KEY = `prep_phone_${eventId}`
  const STEPS_KEY = `prep_steps_${eventId}`
  const MISC_KEY = `prep_misc_${eventId}`

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!eventId) return
    try {
      const p = localStorage.getItem(PHONE_KEY); if (p) setPhone(p)
      const s = localStorage.getItem(STEPS_KEY); if (s) setSteps(JSON.parse(s))
      const m = localStorage.getItem(MISC_KEY)
      if (m) { const mm = JSON.parse(m); setIpadAck(!!mm.ipadAck); if (mm.os) setOs(mm.os) }
    } catch { /* ignore */ }
    fetch(`/api/survey?event_id=${eventId}&facts=1`)
      .then(r => r.json()).then((d: Facts) => setFacts(d)).catch(() => {})
  }, [eventId]) // eslint-disable-line react-hooks/exhaustive-deps
  /* eslint-enable react-hooks/set-state-in-effect */

  const doneCount = STEP_IDS.filter(k => steps[k]).length
  const pct = Math.round((doneCount / 5) * 100)
  const allDone = doneCount === 5

  function persistSteps(next: Steps, ph: string) {
    try { localStorage.setItem(STEPS_KEY, JSON.stringify(next)); if (ph) localStorage.setItem(PHONE_KEY, ph) } catch { /* ignore */ }
    if (ph) {
      fetch('/api/prep', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId, phone: ph, steps: { ...next, ipad_ack: ipadAck } }),
      }).catch(() => {})
    }
  }
  function persistMisc(next: { ipadAck: boolean; os: OS }) {
    try { localStorage.setItem(MISC_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  function toggleStep(id: string) {
    if (!phone) { setPendingStep(id); setPhoneAsked(true); return }
    const next = { ...steps, [id]: !steps[id] }
    setSteps(next); persistSteps(next, phone)
  }
  function setAck(v: boolean) {
    setIpadAck(v); persistMisc({ ipadAck: v, os })
    if (phone) {
      fetch('/api/prep', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId, phone, steps: { ...steps, ipad_ack: v } }),
      }).catch(() => {})
    }
  }
  function chooseOs(v: OS) { setOs(v); persistMisc({ ipadAck, os: v }) }

  function submitPhone() {
    if (!isValidPhone(phoneInput)) return
    const ph = phoneInput.trim()
    setPhone(ph); setPhoneAsked(false)
    const next = pendingStep ? { ...steps, [pendingStep]: true } : steps
    setSteps(next); persistSteps(next, ph)
    setPendingStep(null); setPhoneInput('')
  }

  const eventDate = facts?.date ? new Date(facts.date) : null
  const dateStr = eventDate ? eventDate.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long' }) : null
  const surveyUrl = eventId ? `/survey?event=${eventId}` : '#'

  if (!eventId) {
    return <div className="min-h-screen flex items-center justify-center bg-black"><p className="text-zinc-500">Invalid link.</p></div>
  }

  return (
    <div className="relative min-h-screen text-white overflow-x-hidden" style={{ background: '#060606' }}>
      {/* ── Sticky countdown ── */}
      <CountdownBar target={eventDate} done={allDone} doneCount={doneCount} />

      {/* Ambient liquid background */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[680px] h-[680px] rounded-full blur-[120px] opacity-[0.22]"
          style={{ background: 'radial-gradient(circle, #D4684A 0%, transparent 65%)' }} />
        <div className="absolute top-[40%] -left-32 w-[420px] h-[420px] rounded-full blur-[120px] opacity-[0.12]"
          style={{ background: 'radial-gradient(circle, #f59e0b 0%, transparent 65%)' }} />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full blur-[120px] opacity-[0.10]"
          style={{ background: 'radial-gradient(circle, #7c3aed 0%, transparent 65%)' }} />
      </div>

      <div className="max-w-lg mx-auto px-5 pb-28">

        {/* ── Hero ── */}
        <div className="text-center pt-8 pb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/claude-my-logo.svg" alt="Claude Malaysia" width={60} height={60} className="mx-auto rounded-[18px] mb-6"
            style={{ boxShadow: '0 8px 40px -8px rgba(212,104,74,0.6)' }} />
          <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.15em] text-amber-300/90 uppercase mb-4 px-3 py-1 rounded-full"
            style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.18)' }}>
            ✨ Claude Malaysia Workshop
          </div>

          {/* Workshop topic */}
          <h1 className="text-[28px] sm:text-4xl font-extrabold leading-[1.1] tracking-tight mb-3">
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(180deg, #fff 30%, #d4a574)' }}>
              Claude Dashboard for CEOs &amp; Heads of Department
            </span>
          </h1>
          <p className="text-zinc-400 text-[15px] leading-relaxed mb-6 max-w-sm mx-auto">
            You&apos;re in 🎉 Five quick steps to be <span className="text-white font-medium">workshop-ready</span>. Your progress saves automatically.
          </p>

          {/* Date + venue pills (no seat count) */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {dateStr && <Pill icon="📅" text={dateStr} />}
            {facts?.venue && <Pill icon="📍" text={facts.venue} />}
            <Pill icon="⏰" text="9:30am start" highlight />
          </div>
        </div>

        {/* ── Warning ── */}
        <Glass className="mt-7 p-4 border-amber-500/25" style={{ background: 'rgba(245,158,11,0.05)' }}>
          <div className="flex gap-3">
            <span className="text-xl">⚡</span>
            <div>
              <div className="text-sm font-semibold text-amber-200 mb-0.5">Please finish all 5 steps before the day</div>
              <p className="text-[13px] text-zinc-400 leading-relaxed">If you show up un-installed, you&apos;ll <b className="text-zinc-200">delay the whole class</b> waiting on downloads — which means less hands-on building and sharing time for everyone.</p>
            </div>
          </div>
        </Glass>

        {/* ── Progress ── */}
        <Glass className="mt-4 p-4 flex items-center gap-4">
          <Ring pct={pct} />
          <div className="flex-1">
            <div className="text-sm font-semibold">{allDone ? "You're all set! 🚀" : `${doneCount} of 5 complete`}</div>
            <div className="text-xs text-zinc-500">{allDone ? 'See you at 9:30am sharp' : 'Tap each step as you go'}</div>
          </div>
        </Glass>

        {/* ── Steps ── */}
        <div className="mt-4 space-y-3">
          {/* Step 1 */}
          <StepCard n="1" done={steps['1']} onToggle={() => toggleStep('1')}
            title="Install Claude Code" subtitle="On your Mac or Windows laptop">
            <a href="https://claude.com/download" target="_blank" rel="noopener noreferrer" className="cta">⬇️ Download Claude Code</a>
            <button onClick={() => setAck(!ipadAck)}
              className={`mt-3 w-full flex items-center gap-3 text-left rounded-xl px-3.5 py-3 transition-all border
                ${ipadAck ? 'border-amber-500/40 bg-amber-500/[0.06]' : 'border-white/10 bg-white/[0.02]'}`}>
              <span className={`w-5 h-5 shrink-0 rounded-md border-2 flex items-center justify-center transition-all
                ${ipadAck ? 'bg-amber-500 border-amber-500 text-black' : 'border-zinc-600 text-transparent'}`}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              </span>
              <span className="text-[13px] text-zinc-300 leading-snug">I understand I will <b className="text-white">not bring an iPad or tablet</b> — Claude Code needs a real laptop.</span>
            </button>
          </StepCard>

          {/* Step 2 */}
          <StepCard n="2" done={steps['2']} onToggle={() => toggleStep('2')}
            title="Get Claude Pro" subtitle="$17 USD/month minimum">
            <p className="text-[13px] text-zinc-400 mb-3 leading-relaxed">The <b className="text-zinc-200">Free plan can&apos;t run Claude Code</b> and runs out of tokens too fast in the workshop. Pro is essential.</p>
            <a href="https://claude.com/pricing" target="_blank" rel="noopener noreferrer" className="cta">⭐ Get Claude Pro</a>
          </StepCard>

          {/* Step 3 — CRITICAL, OS-aware */}
          <StepCard n="3" done={steps['3']} onToggle={() => toggleStep('3')} critical
            title="Install your dev tools" subtitle="Homebrew (Mac) or Git (Windows)">
            <div className="rounded-xl px-3 py-2 mb-3 text-[12px] font-semibold text-red-300 inline-flex items-center gap-1.5"
              style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)' }}>
              🚨 Critical — the class can&apos;t start without this
            </div>
            <p className="text-[13px] text-zinc-400 mb-3">Which computer are you bringing?</p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <OsBtn label="🍎 Mac" active={os === 'mac'} onClick={() => chooseOs('mac')} />
              <OsBtn label="🪟 Windows" active={os === 'windows'} onClick={() => chooseOs('windows')} />
            </div>
            {os === 'mac' && <Video id="X57PTQR45Ps" label="🍎 Install Homebrew on Mac" full />}
            {os === 'windows' && <Video id="XvBxfupKpgg" label="🪟 Install Git (& Claude) on Windows" full />}
            {!os && <div className="text-[12px] text-zinc-600 text-center py-3">👆 Pick your OS to see the right guide</div>}

            {/* Prominent docs CTA */}
            <a href="https://docs.google.com/document/d/1-cKqYXB2loZFGbhEFpUDKdrMwTVt5VATFXFbFiSTqeU/edit" target="_blank" rel="noopener noreferrer"
              className="mt-3 flex items-center gap-3 rounded-2xl px-4 py-3.5 transition-all active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.18), rgba(99,102,241,0.12))', border: '1px solid rgba(99,102,241,0.35)' }}>
              <span className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center text-lg" style={{ background: 'rgba(99,102,241,0.25)' }}>📄</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-bold text-white">Step-by-Step Installation Guide</span>
                <span className="block text-[12px] text-indigo-200/80">Follow along — screenshots for every step</span>
              </span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-indigo-300"><path d="M9 18l6-6-6-6" /></svg>
            </a>
          </StepCard>

          {/* Step 4 */}
          <StepCard n="4" done={steps['4']} onToggle={() => toggleStep('4')}
            title="Fill the pre-event survey" subtitle="2 mins — so we tailor the class to you">
            <a href={surveyUrl} target="_blank" rel="noopener noreferrer" className="cta">📝 Open the survey</a>
          </StepCard>

          {/* Step 5 */}
          <StepCard n="5" done={steps['5']} onToggle={() => toggleStep('5')}
            title="Show up EARLY — 9:30am" subtitle="Watch this so you know how to find us">
            <p className="text-[13px] text-zinc-400 mb-3 leading-relaxed">Here&apos;s exactly how to get up to the venue 👇 (and a peek inside!)</p>
            <Video id="NeTd4AAxTrY" label="🎬 How to get to CO3 Puchong — Venue Guide" full />
          </StepCard>
        </div>

        {/* ── What you'll leave with ── */}
        <div className="mt-9">
          <SectionLabel>You&apos;ll walk out with</SectionLabel>

          {/* Auto-rotating dashboard showcase */}
          <div className="mt-3"><DashboardShowcase /></div>

          <div className="space-y-3 mt-3">
            <Glass className="p-4 flex items-start gap-3.5">
              <div className="w-11 h-11 shrink-0 rounded-2xl flex items-center justify-center text-xl"
                style={{ background: 'linear-gradient(135deg, rgba(212,104,74,0.25), rgba(245,158,11,0.15))', border: '1px solid rgba(245,158,11,0.2)' }}>📊</div>
              <div>
                <div className="font-bold text-[15px]">Your own personalised dashboard</div>
                <div className="text-[13px] text-zinc-400 leading-relaxed">Built live, running on your real business data — yours to keep. Marketing, Sales, Finance, HR, Inventory — whatever you run.</div>
              </div>
            </Glass>
            <Glass className="p-4 flex items-start gap-3.5 relative overflow-hidden">
              <div className="absolute top-3 right-3 text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full"
                style={{ background: 'linear-gradient(135deg, #D4684A, #f59e0b)', color: '#1a1000' }}>VIP ONLY</div>
              <div className="w-11 h-11 shrink-0 rounded-2xl flex items-center justify-center text-xl"
                style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.25), rgba(236,72,153,0.15))', border: '1px solid rgba(236,72,153,0.2)' }}>🎨</div>
              <div className="pr-12">
                <div className="font-bold text-[15px]">Viral IG Carousel skill</div>
                <div className="text-[13px] text-zinc-400 leading-relaxed">Turn any idea into scroll-stopping branded carousels. Exclusive to VIP guests.</div>
              </div>
            </Glass>
          </div>
        </div>

        {/* ── Jarvis: AI events manager ── */}
        <div className="mt-9">
          <SectionLabel>Powered by AI</SectionLabel>
          <Glass className="mt-3 p-5 text-center">
            <div className="text-3xl mb-2">🐱</div>
            <h2 className="text-xl font-bold mb-1.5">This whole event runs on <span className="text-amber-300">Jarvis Oyen</span> 🍊</h2>
            <p className="text-[13px] text-zinc-400 leading-relaxed mb-1">
              Your registration, seating, check-in, surveys, even invoices — all managed by <b className="text-amber-300">Jarvis Oyen</b>, our AI events manager. Text the cat, it answers. 🐾
            </p>
            <p className="text-[12px] text-zinc-600 leading-relaxed">
              We&apos;re <i>not</i> building Jarvis Oyen in this half-day class — that&apos;s the next level. Today plants the seed: your first dashboard. 🌱
            </p>
          </Glass>
          <div className="mt-3"><JarvisDemo /></div>
        </div>

        {/* ── Celebration ── */}
        {allDone && (
          <Glass className="mt-9 p-6 text-center" style={{ background: 'linear-gradient(135deg, rgba(212,104,74,0.16), rgba(245,158,11,0.10))', border: '1px solid rgba(245,158,11,0.3)' }}>
            <div className="text-5xl mb-3">🎉</div>
            <div className="text-xl font-bold mb-1">You&apos;re workshop-ready!</div>
            <div className="text-[13px] text-zinc-300">See you at <b className="text-amber-300">9:30am sharp</b>. Come early, come caffeinated. ☕</div>
          </Glass>
        )}
      </div>

      {/* ── Phone prompt sheet ── */}
      {phoneAsked && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={() => { setPhoneAsked(false); setPendingStep(null) }} />
          <div className="relative w-full sm:max-w-sm rounded-t-[28px] sm:rounded-[28px] p-6 animate-[slideup_0.25s_cubic-bezier(0.16,1,0.3,1)]"
            style={{ background: 'rgba(20,20,22,0.85)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="text-lg font-bold mb-1">Save your progress 💾</div>
            <p className="text-[13px] text-zinc-400 mb-4 leading-relaxed">Pop in your WhatsApp number so your prep saves (and we can send a friendly reminder if needed).</p>
            <input
              value={phoneInput}
              onChange={e => setPhoneInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submitPhone()}
              placeholder="e.g. 0123456789" type="tel" autoFocus
              className="w-full bg-black/40 border border-white/15 rounded-2xl px-4 py-3.5 text-white text-sm focus:outline-none focus:border-amber-500/60"
            />
            {phoneInput.trim().length > 0 && !isValidPhone(phoneInput) && (
              <p className="text-xs text-red-400 mt-2">Enter a valid number (with country code if outside Malaysia).</p>
            )}
            <button onClick={submitPhone} disabled={!isValidPhone(phoneInput)}
              className="w-full mt-4 disabled:opacity-40 text-black font-semibold rounded-2xl py-3.5 text-sm transition-all"
              style={{ background: 'linear-gradient(135deg, #f59e0b, #D4684A)' }}>
              Save &amp; continue →
            </button>
          </div>
        </div>
      )}

      <style>{`
        .cta { display:flex; align-items:center; justify-content:center; gap:8px; width:100%; font-weight:600; font-size:14px; padding:13px 16px; border-radius:14px; color:#1a1000; background:linear-gradient(135deg, #f59e0b, #D4684A); box-shadow:0 4px 20px -4px rgba(212,104,74,0.5); transition:transform 0.1s; }
        .cta:active { transform:scale(0.98); }
        .cta-ghost { display:flex; align-items:center; justify-content:center; gap:8px; width:100%; font-weight:600; font-size:13px; padding:11px 16px; border-radius:14px; color:#e4e4e7; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); }
        @keyframes slideup { from { transform: translateY(100%); opacity:0.5; } to { transform: translateY(0); opacity:1; } }
        @keyframes fadein { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform: translateY(0); } }
      `}</style>
    </div>
  )
}

// ── Reusable liquid-glass shell ────────────────────────────────────────────────
// ── Sticky countdown to event ──────────────────────────────────────────────────
function CdUnit({ v, l }: { v: number; l: string }) {
  return (
    <span className="flex flex-col items-center">
      <span className="text-base font-bold tabular-nums leading-none" style={{ color: '#ffd9a0' }}>{String(v).padStart(2, '0')}</span>
      <span className="text-[8px] text-amber-200/50 tracking-widest uppercase mt-0.5">{l}</span>
    </span>
  )
}

function CountdownBar({ target, done, doneCount }: { target: Date | null; done: boolean; doneCount: number }) {
  // Start ticking after mount (avoids SSR hydration mismatch + sync setState).
  const [now, setNow] = useState(0)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  let body: React.ReactNode
  if (done) {
    body = <span className="text-sm font-semibold text-emerald-300">✅ You&apos;re ready — see you at the workshop!</span>
  } else if (target && now > 0) {
    const ms = target.getTime() - now
    if (ms <= 0) {
      body = <span className="text-sm font-semibold text-amber-300">🔴 It&apos;s workshop day — head to CO3 Puchong!</span>
    } else {
      const d = Math.floor(ms / 86400000)
      const h = Math.floor((ms % 86400000) / 3600000)
      const m = Math.floor((ms % 3600000) / 60000)
      const s = Math.floor((ms % 60000) / 1000)
      body = (
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] font-semibold text-amber-200/90 mr-0.5">⏳ Finish before the workshop</span>
          <CdUnit v={d} l="d" /><span className="text-amber-200/30 -mt-2">:</span>
          <CdUnit v={h} l="h" /><span className="text-amber-200/30 -mt-2">:</span>
          <CdUnit v={m} l="m" /><span className="text-amber-200/30 -mt-2">:</span>
          <CdUnit v={s} l="s" />
        </div>
      )
    }
  } else {
    body = <span className="text-sm font-semibold text-amber-200/90">⏳ Finish all 5 steps before the workshop</span>
  }

  return (
    <div className="sticky top-0 z-40 border-b border-white/[0.06]"
      style={{ background: 'rgba(20,10,6,0.72)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)' }}>
      <div className="max-w-lg mx-auto px-4 h-12 flex items-center justify-between gap-3">
        {body}
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
          style={{ background: done ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)', color: done ? '#6ee7b7' : '#fcd34d' }}>
          {doneCount}/5
        </span>
      </div>
    </div>
  )
}

function Glass({ children, className = '', style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`rounded-[22px] border border-white/[0.08] ${className}`}
      style={{ background: 'rgba(255,255,255,0.035)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', boxShadow: '0 8px 32px -12px rgba(0,0,0,0.6), inset 0 1px 0 0 rgba(255,255,255,0.06)', ...style }}>
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold tracking-[0.15em] text-zinc-500 uppercase text-center">{children}</div>
}

function Pill({ icon, text, highlight }: { icon: string; text: string; highlight?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border backdrop-blur-md
      ${highlight ? 'bg-amber-500/[0.12] border-amber-500/25 text-amber-200' : 'bg-white/[0.04] border-white/10 text-zinc-300'}`}>
      <span>{icon}</span>{text}
    </span>
  )
}

function OsBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`rounded-xl py-2.5 text-sm font-semibold transition-all border
        ${active ? 'text-black' : 'text-zinc-300 bg-white/[0.03] border-white/10 hover:bg-white/[0.06]'}`}
      style={active ? { background: 'linear-gradient(135deg, #f59e0b, #D4684A)', borderColor: 'transparent' } : undefined}>
      {label}
    </button>
  )
}

function Ring({ pct }: { pct: number }) {
  const r = 26, c = 2 * Math.PI * r, off = c - (pct / 100) * c
  return (
    <div className="relative w-16 h-16 shrink-0">
      <svg width="64" height="64" className="-rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
        <circle cx="32" cy="32" r={r} fill="none" stroke="url(#rg)" strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off} style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.16,1,0.3,1)' }} />
        <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f59e0b" /><stop offset="1" stopColor="#D4684A" /></linearGradient></defs>
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-sm font-bold">{pct}%</div>
    </div>
  )
}

function StepCard({ n, title, subtitle, done, onToggle, critical, children }: {
  n: string; title: string; subtitle: string; done: boolean; onToggle: () => void; critical?: boolean; children: React.ReactNode
}) {
  return (
    <Glass className={`p-4 transition-all ${done ? 'border-amber-500/30' : critical ? 'border-red-500/25' : ''}`}
      style={done ? { background: 'rgba(245,158,11,0.05)' } : undefined}>
      <div className="flex items-start gap-3.5">
        <button onClick={onToggle} aria-label={done ? 'Mark incomplete' : 'Mark complete'}
          className={`mt-0.5 w-8 h-8 shrink-0 rounded-xl border-2 flex items-center justify-center transition-all active:scale-90
            ${done ? 'border-transparent text-black' : 'border-zinc-600 text-transparent active:border-amber-500'}`}
          style={done ? { background: 'linear-gradient(135deg, #f59e0b, #D4684A)' } : undefined}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-[11px] font-bold ${critical ? 'text-red-400/90' : 'text-amber-400/80'}`}>STEP {n}</span>
            {done && <span className="text-[10px] text-amber-400">✓ done</span>}
          </div>
          <div className={`text-[17px] font-bold leading-tight ${done ? 'text-zinc-300' : 'text-white'}`}>{title}</div>
          <div className="text-xs text-zinc-500 mb-3">{subtitle}</div>
          {children}
        </div>
      </div>
    </Glass>
  )
}

function Video({ id, label, full }: { id: string; label: string; full?: boolean }) {
  return (
    <div className={full ? 'w-full' : 'w-[260px] shrink-0'}>
      <div className="relative w-full rounded-2xl overflow-hidden border border-white/10" style={{ aspectRatio: '16/9' }}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}`}
          title={label} loading="lazy" allowFullScreen
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          className="absolute inset-0 w-full h-full" />
      </div>
      <div className="text-xs text-zinc-400 mt-2 font-medium">{label}</div>
    </div>
  )
}

// ── Jarvis demo — cycles real capabilities (floor plan, insights, affiliate, invoice, VIP) ──
const DEMOS: { q: string; a: string }[] = [
  { q: '/floorplan', a: '🗺 <b>Seating — Claude Workshop</b>\n★ Stage: Kingsley\n\n🔵 VIP front (12) · ⚪ General (28)\n📋 Registration: Huda\n🍱 F&B: Guan · 📹 AV: Jimmy' },
  { q: 'which industries are coming?', a: '📊 <b>Audience mix</b>\n• Marketing & Sales — 11\n• Finance — 7\n• F&B — 5\n• Tech — 4\n• Retail — 3\n\nMostly founders & HODs. 🎯' },
  { q: 'how are affiliate payouts?', a: '🤝 <b>Affiliate Payout (10%)</b>\n\nqueenie7946 — RM 647\n  3 buyers · RM 6,470\nalaric7136 — RM 297\n\n<b>Total payout:</b> RM 944' },
  { q: 'invoice Daphne RM497 deposit', a: '🧾 Generating invoice for <b>Daphne</b>…\n✅ INV-0142 · RM497 deposit\n📎 Branded PDF sent to this chat.' },
  { q: '/vip', a: '👑 <b>VIPs (8)</b>\n✅ Dato Wong 🏃\n✅ Rohini Menon\n⏳ David Chen\n\n<i>General: 32 · VIP: 8 · 40 total</i>' },
  { q: 'how full are we?', a: '📊 <b>40 registered</b>\n✅ Paid: 36   ⏳ Pending: 4\n🏃 Confirmed: 31\n\nLooking strong — nearly full. 🔥' },
]

function JarvisDemo() {
  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState<'typing-q' | 'thinking' | 'answer'>('typing-q')
  const [typed, setTyped] = useState('')
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    timers.current.forEach(clearTimeout); timers.current = []
    const demo = DEMOS[idx]
    setPhase('typing-q'); setTyped('')
    let i = 0
    const typeNext = () => {
      i++; setTyped(demo.q.slice(0, i))
      if (i < demo.q.length) timers.current.push(setTimeout(typeNext, 45))
      else {
        timers.current.push(setTimeout(() => setPhase('thinking'), 400))
        timers.current.push(setTimeout(() => setPhase('answer'), 1500))
        timers.current.push(setTimeout(() => setIdx(v => (v + 1) % DEMOS.length), 5400))
      }
    }
    timers.current.push(setTimeout(typeNext, 500))
    return () => timers.current.forEach(clearTimeout)
  }, [idx])
  /* eslint-enable react-hooks/set-state-in-effect */

  const demo = DEMOS[idx]
  return (
    <div className="rounded-[28px] overflow-hidden border border-white/[0.08]"
      style={{ background: 'rgba(13,13,15,0.7)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', boxShadow: '0 24px 70px -24px rgba(212,104,74,0.4)' }}>
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/[0.06]" style={{ background: 'rgba(255,255,255,0.02)' }}>
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-base" style={{ background: 'linear-gradient(135deg, #f59e0b, #D4684A)' }}>🐱</div>
        <div>
          <div className="text-sm font-semibold leading-none">Jarvis Oyen 🍊</div>
          <div className="text-[10px] text-emerald-400 mt-1">● AI events manager · online</div>
        </div>
      </div>
      <div className="p-4 space-y-3 min-h-[235px]">
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl rounded-br-md px-3.5 py-2 text-sm font-medium text-black" style={{ background: 'linear-gradient(135deg, #f59e0b, #D4684A)' }}>
            {typed}{phase === 'typing-q' && <span className="inline-block w-1.5 h-4 bg-black/50 ml-0.5 align-middle animate-pulse" />}
          </div>
        </div>
        {phase !== 'typing-q' && (
          <div className="flex justify-start">
            <div className="max-w-[90%] bg-white/[0.05] border border-white/[0.06] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm text-zinc-200 whitespace-pre-line leading-relaxed">
              {phase === 'thinking'
                ? <span className="flex gap-1 py-1"><Dot /><Dot d={0.15} /><Dot d={0.3} /></span>
                : <span dangerouslySetInnerHTML={{ __html: demo.a }} />}
            </div>
          </div>
        )}
      </div>
      <div className="flex justify-center gap-1.5 pb-3.5">
        {DEMOS.map((_, i) => (
          <span key={i} className="h-1.5 rounded-full transition-all" style={{ width: i === idx ? 20 : 6, background: i === idx ? 'linear-gradient(90deg,#f59e0b,#D4684A)' : '#3f3f46' }} />
        ))}
      </div>
    </div>
  )
}

function Dot({ d = 0 }: { d?: number }) {
  return <span className="w-2 h-2 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: `${d}s` }} />
}

// ── Auto-rotating mock dashboard showcase ──────────────────────────────────────
interface Dash {
  key: string; title: string; emoji: string; accent: string; accent2: string
  kpis: { label: string; value: string; delta: string; up: boolean }[]
  area: number[]; areaLabel: string; areaTotal: string
  donut: { label: string; pct: number }[]; donutCenter: string; donutCaption: string
  rows: { label: string; value: string; pct: number }[]; rowsLabel: string
}
const DASHBOARDS: Dash[] = [
  {
    key: 'marketing', title: 'Marketing', emoji: '📣', accent: '#ec4899', accent2: '#f472b6',
    kpis: [
      { label: 'Reach', value: '128K', delta: '+24%', up: true },
      { label: 'Leads', value: '342', delta: '+12%', up: true },
      { label: 'Conv. rate', value: '4.8%', delta: '+0.7', up: true },
      { label: 'CPL', value: 'RM 8.40', delta: '-9%', up: true },
    ],
    area: [40, 55, 48, 70, 62, 85, 78, 96], areaLabel: 'Leads / week', areaTotal: '342 leads',
    donut: [{ label: 'Instagram', pct: 46 }, { label: 'TikTok', pct: 31 }, { label: 'Google', pct: 23 }],
    donutCenter: '46%', donutCaption: 'Top channel: IG',
    rows: [{ label: 'IG Reels', value: '184', pct: 100 }, { label: 'Stories', value: '92', pct: 50 }, { label: 'Ads', value: '66', pct: 36 }],
    rowsLabel: 'Leads by source',
  },
  {
    key: 'sales', title: 'Sales', emoji: '💰', accent: '#f59e0b', accent2: '#fbbf24',
    kpis: [
      { label: 'Revenue', value: 'RM 284K', delta: '+18%', up: true },
      { label: 'Deals won', value: '47', delta: '+6', up: true },
      { label: 'Win rate', value: '32%', delta: '+4%', up: true },
      { label: 'Avg deal', value: 'RM 6.0K', delta: '+11%', up: true },
    ],
    area: [50, 62, 58, 75, 80, 72, 92, 100], areaLabel: 'Revenue / month', areaTotal: 'RM 284K',
    donut: [{ label: 'Closed', pct: 58 }, { label: 'Negotiation', pct: 27 }, { label: 'New', pct: 15 }],
    donutCenter: '58%', donutCaption: 'Pipeline closed',
    rows: [{ label: 'Aiman', value: 'RM 92K', pct: 100 }, { label: 'Sarah', value: 'RM 71K', pct: 77 }, { label: 'Wei', value: 'RM 54K', pct: 59 }],
    rowsLabel: 'Top reps',
  },
  {
    key: 'finance', title: 'Finance', emoji: '📊', accent: '#22c55e', accent2: '#4ade80',
    kpis: [
      { label: 'Cash', value: 'RM 1.2M', delta: '+8%', up: true },
      { label: 'MRR', value: 'RM 88K', delta: '+14%', up: true },
      { label: 'Burn', value: 'RM 96K', delta: '-5%', up: true },
      { label: 'Runway', value: '13 mo', delta: '+2', up: true },
    ],
    area: [70, 66, 72, 68, 74, 80, 86, 94], areaLabel: 'Net cash flow', areaTotal: '+RM 188K',
    donut: [{ label: 'Payroll', pct: 52 }, { label: 'Ops', pct: 30 }, { label: 'Marketing', pct: 18 }],
    donutCenter: '52%', donutCaption: 'Largest cost',
    rows: [{ label: 'Gross margin', value: '68%', pct: 68 }, { label: 'Net margin', value: '24%', pct: 24 }, { label: 'AR overdue', value: '6%', pct: 6 }],
    rowsLabel: 'Health ratios',
  },
  {
    key: 'hr', title: 'HR / People', emoji: '👥', accent: '#3b82f6', accent2: '#60a5fa',
    kpis: [
      { label: 'Headcount', value: '64', delta: '+5', up: true },
      { label: 'Attrition', value: '4.2%', delta: '-1.1%', up: true },
      { label: 'eNPS', value: '+48', delta: '+7', up: true },
      { label: 'Time-to-hire', value: '18d', delta: '-4', up: true },
    ],
    area: [42, 48, 45, 52, 58, 55, 64, 68], areaLabel: 'Team growth', areaTotal: '64 people',
    donut: [{ label: 'Engineering', pct: 44 }, { label: 'GTM', pct: 34 }, { label: 'Ops', pct: 22 }],
    donutCenter: '44%', donutCaption: 'Biggest team',
    rows: [{ label: 'Engaged', value: '82%', pct: 82 }, { label: 'At risk', value: '11%', pct: 11 }, { label: 'New (90d)', value: '14', pct: 22 }],
    rowsLabel: 'Engagement',
  },
  {
    key: 'inventory', title: 'Inventory', emoji: '📦', accent: '#a855f7', accent2: '#c084fc',
    kpis: [
      { label: 'SKUs', value: '1,284', delta: '+32', up: true },
      { label: 'In stock', value: '96%', delta: '+3%', up: true },
      { label: 'Stockouts', value: '7', delta: '-12', up: true },
      { label: 'Turnover', value: '6.4×', delta: '+0.8', up: true },
    ],
    area: [60, 52, 68, 64, 72, 70, 78, 88], areaLabel: 'Units moved', areaTotal: '24.6K units',
    donut: [{ label: 'Healthy', pct: 78 }, { label: 'Low', pct: 16 }, { label: 'Out', pct: 6 }],
    donutCenter: '78%', donutCaption: 'Stock healthy',
    rows: [{ label: 'Best seller A', value: '4.2K', pct: 100 }, { label: 'Product B', value: '2.8K', pct: 67 }, { label: 'Product C', value: '1.9K', pct: 45 }],
    rowsLabel: 'Top movers',
  },
]

// SVG smooth-area path from a 0..100 series
function areaPath(vals: number[], w: number, h: number): { line: string; fill: string } {
  const n = vals.length
  const max = Math.max(...vals), min = Math.min(...vals)
  const span = max - min || 1
  const pts = vals.map((v, i) => [(i / (n - 1)) * w, h - ((v - min) / span) * (h - 6) - 3] as const)
  let line = `M ${pts[0][0]},${pts[0][1]}`
  for (let i = 1; i < n; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]
    const cx = (x0 + x1) / 2
    line += ` C ${cx},${y0} ${cx},${y1} ${x1},${y1}`
  }
  const fill = `${line} L ${w},${h} L 0,${h} Z`
  return { line, fill }
}

function Donut({ segs, accent, accent2, center, caption }: { segs: { label: string; pct: number }[]; accent: string; accent2: string; center: string; caption: string }) {
  const r = 26, c = 2 * Math.PI * r
  const cols = [accent, accent2, '#52525b']
  // Pre-compute cumulative offsets (no mutation during render).
  const offsets = segs.reduce<number[]>((acc, s, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + (segs[i - 1].pct / 100) * c)
    return acc
  }, [])
  return (
    <div className="flex items-center gap-3">
      <div className="relative w-[68px] h-[68px] shrink-0">
        <svg width="68" height="68" className="-rotate-90">
          {segs.map((s, i) => {
            const len = (s.pct / 100) * c
            return (
              <circle key={i} cx="34" cy="34" r={r} fill="none" stroke={cols[i % 3]} strokeWidth="8"
                strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offsets[i]} />
            )
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[13px] font-bold leading-none">{center}</span>
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-zinc-500 mb-1">{caption}</div>
        {segs.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[10px] text-zinc-400 leading-tight">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cols[i % 3] }} />
            <span className="truncate flex-1">{s.label}</span>
            <span className="text-zinc-500">{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DashboardShowcase() {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setIdx(v => (v + 1) % DASHBOARDS.length), 4000)
    return () => clearInterval(t)
  }, [])
  const d = DASHBOARDS[idx]
  const { line, fill } = areaPath(d.area, 260, 56)

  return (
    <div className="rounded-[26px] overflow-hidden border border-white/[0.08] relative"
      style={{ background: 'rgba(13,13,15,0.72)', backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)', boxShadow: '0 28px 80px -30px rgba(0,0,0,0.85)' }}>
      {/* accent glow */}
      <div className="absolute -top-20 right-0 w-56 h-56 rounded-full blur-[80px] opacity-[0.28] transition-all duration-700"
        style={{ background: d.accent }} />

      {/* window chrome */}
      <div className="relative flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
        <span className="w-2.5 h-2.5 rounded-full bg-red-400/70" />
        <span className="w-2.5 h-2.5 rounded-full bg-amber-400/70" />
        <span className="w-2.5 h-2.5 rounded-full bg-green-400/70" />
        <div key={d.key} className="ml-2 flex items-center gap-1.5 text-sm font-semibold animate-[fadein_0.5s_ease]">
          <span>{d.emoji}</span><span>{d.title} Dashboard</span>
        </div>
        <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Live
        </span>
      </div>

      {/* body — re-keyed to retrigger fade */}
      <div key={d.key} className="relative p-3.5 animate-[fadein_0.5s_ease] space-y-3">
        {/* 4 KPI cards */}
        <div className="grid grid-cols-2 gap-2">
          {d.kpis.map(k => (
            <div key={k.label} className="rounded-xl p-2.5 bg-white/[0.03] border border-white/[0.06] flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-[10px] text-zinc-500 truncate">{k.label}</div>
                <div className="text-[15px] font-bold leading-tight mt-0.5">{k.value}</div>
              </div>
              <div className="text-[10px] font-semibold shrink-0 pl-1" style={{ color: d.accent2 }}>▲{k.delta}</div>
            </div>
          ))}
        </div>

        {/* Area trend */}
        <div className="rounded-xl p-3 bg-white/[0.02] border border-white/[0.05]">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-zinc-500">{d.areaLabel}</span>
            <span className="text-[11px] font-semibold" style={{ color: d.accent2 }}>{d.areaTotal}</span>
          </div>
          <svg viewBox="0 0 260 56" className="w-full h-14" preserveAspectRatio="none">
            <defs>
              <linearGradient id={`ag-${d.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={d.accent} stopOpacity="0.35" />
                <stop offset="1" stopColor={d.accent} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={fill} fill={`url(#ag-${d.key})`} />
            <path d={line} fill="none" stroke={d.accent} strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>

        {/* Donut + breakdown rows */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl p-3 bg-white/[0.02] border border-white/[0.05]">
            <Donut segs={d.donut} accent={d.accent} accent2={d.accent2} center={d.donutCenter} caption={d.donutCaption} />
          </div>
          <div className="rounded-xl p-3 bg-white/[0.02] border border-white/[0.05]">
            <div className="text-[10px] text-zinc-500 mb-2">{d.rowsLabel}</div>
            <div className="space-y-2">
              {d.rows.map(r => (
                <div key={r.label}>
                  <div className="flex justify-between text-[10px] mb-0.5">
                    <span className="text-zinc-400 truncate">{r.label}</span>
                    <span className="text-zinc-300 font-semibold">{r.value}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${r.pct}%`, background: `linear-gradient(to right, ${d.accent}, ${d.accent2})` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* dots */}
      <div className="flex justify-center gap-1.5 pb-3.5">
        {DASHBOARDS.map((dd, i) => (
          <button key={dd.key} onClick={() => setIdx(i)} aria-label={dd.title}
            className="h-1.5 rounded-full transition-all"
            style={{ width: i === idx ? 18 : 6, background: i === idx ? d.accent : '#3f3f46' }} />
        ))}
      </div>
    </div>
  )
}

export default function StartPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-black"><div className="text-zinc-500">Loading…</div></div>}>
      <StartContent />
    </Suspense>
  )
}
