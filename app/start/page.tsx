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
  capacity?: number | null; registered?: number; paid?: number
}

const STEP_IDS = ['1', '2', '3', '4', '5'] as const
type Steps = Record<string, boolean>

function StartContent() {
  const params = useSearchParams()
  const eventId = params.get('event') || ''

  const [facts, setFacts] = useState<Facts | null>(null)
  const [steps, setSteps] = useState<Steps>({ '1': false, '2': false, '3': false, '4': false, '5': false })
  const [phone, setPhone] = useState('')
  const [phoneAsked, setPhoneAsked] = useState(false)   // modal open
  const [phoneInput, setPhoneInput] = useState('')
  const [pendingStep, setPendingStep] = useState<string | null>(null)

  const PHONE_KEY = `prep_phone_${eventId}`
  const STEPS_KEY = `prep_steps_${eventId}`

  // Load saved state (localStorage) + live facts on mount.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!eventId) return
    try {
      const p = localStorage.getItem(PHONE_KEY); if (p) setPhone(p)
      const s = localStorage.getItem(STEPS_KEY); if (s) setSteps(JSON.parse(s))
    } catch { /* ignore */ }
    fetch(`/api/survey?event_id=${eventId}&facts=1`)
      .then(r => r.json()).then((d: Facts) => setFacts(d)).catch(() => {})
  }, [eventId]) // eslint-disable-line react-hooks/exhaustive-deps
  /* eslint-enable react-hooks/set-state-in-effect */

  const doneCount = STEP_IDS.filter(k => steps[k]).length
  const pct = Math.round((doneCount / 5) * 100)
  const allDone = doneCount === 5

  function persist(next: Steps, ph: string) {
    try {
      localStorage.setItem(STEPS_KEY, JSON.stringify(next))
      if (ph) localStorage.setItem(PHONE_KEY, ph)
    } catch { /* ignore */ }
    if (ph) {
      fetch('/api/prep', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId, phone: ph, steps: next }),
      }).catch(() => {})
    }
  }

  function toggleStep(id: string) {
    // First interaction without a phone → ask once
    if (!phone) { setPendingStep(id); setPhoneAsked(true); return }
    const next = { ...steps, [id]: !steps[id] }
    setSteps(next); persist(next, phone)
  }

  function submitPhone() {
    if (!isValidPhone(phoneInput)) return
    const ph = phoneInput.trim()
    setPhone(ph); setPhoneAsked(false)
    const next = pendingStep ? { ...steps, [pendingStep]: true } : steps
    setSteps(next); persist(next, ph)
    setPendingStep(null); setPhoneInput('')
  }

  const eventDate = facts?.date ? new Date(facts.date) : null
  const dateStr = eventDate ? eventDate.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long' }) : null
  const surveyUrl = eventId ? `/survey?event=${eventId}` : '#'

  if (!eventId) {
    return <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]"><p className="text-zinc-500">Invalid link.</p></div>
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white pb-24">
      {/* ── Hero ── */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 opacity-50"
          style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(212,104,74,0.35), transparent 70%)' }} />
        <div className="relative max-w-lg mx-auto px-5 pt-12 pb-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/claude-my-logo.svg" alt="Claude Malaysia" width={56} height={56} className="mx-auto rounded-2xl mb-5" />
          <div className="inline-block text-[11px] font-semibold tracking-widest text-amber-400/90 uppercase mb-3">Claude Malaysia Workshop</div>
          <h1 className="text-3xl sm:text-4xl font-extrabold leading-tight mb-3">You&apos;re in 🎉<br />Let&apos;s get you <span className="text-amber-400">workshop-ready</span></h1>
          <p className="text-zinc-400 text-sm mb-6">5 quick steps before the big day. Tick them off — your progress saves automatically.</p>

          {/* Live facts pills */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {dateStr && <Pill icon="📅" text={dateStr} />}
            {facts?.venue && <Pill icon="📍" text={facts.venue} />}
            {facts?.capacity != null && facts?.registered != null && (
              <Pill icon="🎟" text={`${facts.registered}/${facts.capacity} seats`} highlight />
            )}
          </div>
        </div>
      </div>

      {/* ── Progress ring ── */}
      <div className="max-w-lg mx-auto px-5">
        <div className="flex items-center gap-4 bg-[#111] border border-white/[0.06] rounded-2xl p-4">
          <Ring pct={pct} />
          <div className="flex-1">
            <div className="text-sm font-semibold text-white">{allDone ? "You're all set! 🚀" : `${doneCount} of 5 done`}</div>
            <div className="text-xs text-zinc-500">{allDone ? 'See you at 9:30am sharp' : 'Keep going — you got this'}</div>
          </div>
        </div>
      </div>

      {/* ── Steps ── */}
      <div className="max-w-lg mx-auto px-5 mt-5 space-y-3">
        <StepCard n="1" done={steps['1']} onToggle={() => toggleStep('1')}
          title="Install Claude Code" subtitle="On your Mac or Windows laptop">
          <p className="text-sm text-zinc-400 mb-3">⚠️ <b className="text-zinc-200">Do NOT bring an iPad or tablet</b> — Claude Code needs a real computer.</p>
          <a href="https://claude.com/download" target="_blank" rel="noopener noreferrer" className="cta">⬇️ Download Claude Code</a>
        </StepCard>

        <StepCard n="2" done={steps['2']} onToggle={() => toggleStep('2')}
          title="Get Claude Pro" subtitle="$17 USD/month minimum">
          <p className="text-sm text-zinc-400 mb-3">The <b className="text-zinc-200">Free plan can&apos;t run Claude Code</b> and runs out of tokens too fast in the workshop. Pro is essential.</p>
          <a href="https://claude.com/pricing" target="_blank" rel="noopener noreferrer" className="cta">⭐ Get Claude Pro</a>
        </StepCard>

        <StepCard n="3" done={steps['3']} onToggle={() => toggleStep('3')}
          title="Watch the setup videos" subtitle="Follow along on your machine">
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Video id="X57PTQR45Ps" label="🍎 Mac: Install Homebrew" />
            <Video id="XvBxfupKpgg" label="🪟 Windows: Claude & Git" />
          </div>
          <a href="https://docs.google.com/document/d/1-cKqYXB2loZFGbhEFpUDKdrMwTVt5VATFXFbFiSTqeU/edit" target="_blank" rel="noopener noreferrer" className="cta-secondary mt-2">📄 Full Installation Guideline</a>
        </StepCard>

        <StepCard n="4" done={steps['4']} onToggle={() => toggleStep('4')}
          title="Fill the pre-event survey" subtitle="2 mins — helps us tailor the class to you">
          <a href={surveyUrl} target="_blank" rel="noopener noreferrer" className="cta">📝 Open the survey</a>
        </StepCard>

        <StepCard n="5" done={steps['5']} onToggle={() => toggleStep('5')}
          title="Show up EARLY — 9:30am" subtitle="Doors + setup help start at 9:30">
          <p className="text-sm text-zinc-400 mb-3">Get a sneak peek of where the magic happens 👇</p>
          <Video id="NeTd4AAxTrY" label="🎬 Inside CO3 Puchong — Our Venue" full />
        </StepCard>
      </div>

      {/* ── Warning ── */}
      <div className="max-w-lg mx-auto px-5 mt-5">
        <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-4">
          <div className="text-sm font-semibold text-red-300 mb-2">😬 What if you don&apos;t install before class?</div>
          <ul className="text-sm text-zinc-400 space-y-1">
            <li>• Delays class time — downloads eat into everyone&apos;s learning</li>
            <li>• Less hands-on building + sharing time for you</li>
          </ul>
        </div>
      </div>

      {/* ── Jarvis demo ── */}
      <div className="max-w-lg mx-auto px-5 mt-8">
        <div className="text-center mb-4">
          <div className="text-[11px] font-semibold tracking-widest text-amber-400/90 uppercase mb-1">A peek at what you&apos;ll build</div>
          <h2 className="text-xl font-bold">Meet Jarvis 🤖</h2>
          <p className="text-sm text-zinc-500 mt-1">An AI ops assistant you text on Telegram. This is the kind of thing you&apos;ll create.</p>
        </div>
        <JarvisDemo />
      </div>

      {/* ── Class facts ── */}
      <div className="max-w-lg mx-auto px-5 mt-8">
        <div className="grid grid-cols-2 gap-3">
          <Fact icon="🗓" big="Full day" small="9:30am – late afternoon" />
          <Fact icon="💻" big="Hands-on" small="Build live, not just watch" />
          <Fact icon="📊" big="A live dashboard" small="Running on your own data" />
          <Fact icon="🤖" big="Your own AI bot" small="Text it on Telegram, anytime" />
        </div>
      </div>

      {/* ── Celebration ── */}
      {allDone && (
        <div className="max-w-lg mx-auto px-5 mt-8">
          <div className="rounded-2xl p-6 text-center relative overflow-hidden"
            style={{ background: 'linear-gradient(135deg, rgba(212,104,74,0.18), rgba(245,158,11,0.12))', border: '1px solid rgba(245,158,11,0.3)' }}>
            <div className="text-5xl mb-3">🎉</div>
            <div className="text-xl font-bold mb-1">You&apos;re workshop-ready!</div>
            <div className="text-sm text-zinc-300">See you at <b className="text-amber-400">9:30am</b>. Come early, come caffeinated. ☕</div>
          </div>
        </div>
      )}

      {/* ── Phone prompt sheet ── */}
      {phoneAsked && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setPhoneAsked(false); setPendingStep(null) }} />
          <div className="relative w-full sm:max-w-sm bg-[#141414] border border-white/[0.08] rounded-t-3xl sm:rounded-3xl p-6 animate-[slideup_0.2s_ease]">
            <div className="text-lg font-bold mb-1">Save your progress 💾</div>
            <p className="text-sm text-zinc-400 mb-4">Pop in your WhatsApp number so we can save your prep (and send you a reminder if needed).</p>
            <input
              value={phoneInput}
              onChange={e => setPhoneInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submitPhone()}
              placeholder="e.g. 0123456789"
              type="tel" autoFocus
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-amber-500"
            />
            {phoneInput.trim().length > 0 && !isValidPhone(phoneInput) && (
              <p className="text-xs text-red-400 mt-2">Enter a valid number (with country code if outside Malaysia).</p>
            )}
            <button onClick={submitPhone} disabled={!isValidPhone(phoneInput)}
              className="w-full mt-4 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-semibold rounded-xl py-3 text-sm">
              Save &amp; continue →
            </button>
          </div>
        </div>
      )}

      <style>{`
        .cta { display:flex; align-items:center; justify-content:center; gap:8px; width:100%; background:#f59e0b; color:#000; font-weight:600; font-size:14px; padding:12px 16px; border-radius:12px; }
        .cta:active { background:#d97706; }
        .cta-secondary { display:flex; align-items:center; justify-content:center; gap:8px; width:100%; background:rgba(255,255,255,0.05); color:#e4e4e7; border:1px solid rgba(255,255,255,0.1); font-weight:600; font-size:14px; padding:12px 16px; border-radius:12px; }
        @keyframes slideup { from { transform: translateY(100%); } to { transform: translateY(0); } }
      `}</style>
    </div>
  )
}

function Pill({ icon, text, highlight }: { icon: string; text: string; highlight?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border
      ${highlight ? 'bg-amber-500/15 border-amber-500/30 text-amber-300' : 'bg-white/[0.04] border-white/10 text-zinc-300'}`}>
      <span>{icon}</span>{text}
    </span>
  )
}

function Ring({ pct }: { pct: number }) {
  const r = 26, c = 2 * Math.PI * r, off = c - (pct / 100) * c
  return (
    <div className="relative w-16 h-16 shrink-0">
      <svg width="64" height="64" className="-rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
        <circle cx="32" cy="32" r={r} fill="none" stroke="#f59e0b" strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off} style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-sm font-bold">{pct}%</div>
    </div>
  )
}

function StepCard({ n, title, subtitle, done, onToggle, children }: {
  n: string; title: string; subtitle: string; done: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div className={`rounded-2xl border p-4 transition-all ${done ? 'border-amber-500/30 bg-amber-500/[0.04]' : 'border-white/[0.06] bg-[#111]'}`}>
      <div className="flex items-start gap-3">
        <button onClick={onToggle} aria-label={done ? 'Mark incomplete' : 'Mark complete'}
          className={`mt-0.5 w-7 h-7 shrink-0 rounded-lg border-2 flex items-center justify-center transition-all
            ${done ? 'bg-amber-500 border-amber-500 text-black' : 'border-zinc-600 text-transparent active:border-amber-500'}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] font-bold text-amber-400/80">STEP {n}</span>
            {done && <span className="text-[10px] text-amber-400">✓ done</span>}
          </div>
          <div className={`text-base font-bold ${done ? 'text-zinc-300' : 'text-white'}`}>{title}</div>
          <div className="text-xs text-zinc-500 mb-3">{subtitle}</div>
          {children}
        </div>
      </div>
    </div>
  )
}

function Video({ id, label, full }: { id: string; label: string; full?: boolean }) {
  return (
    <div className={full ? 'w-full' : 'w-[260px] shrink-0'}>
      <div className="relative w-full rounded-xl overflow-hidden border border-white/10" style={{ aspectRatio: '16/9' }}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}`}
          title={label} loading="lazy" allowFullScreen
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          className="absolute inset-0 w-full h-full" />
      </div>
      <div className="text-xs text-zinc-400 mt-1.5 font-medium">{label}</div>
    </div>
  )
}

function Fact({ icon, big, small }: { icon: string; big: string; small: string }) {
  return (
    <div className="bg-[#111] border border-white/[0.06] rounded-2xl p-4">
      <div className="text-2xl mb-2">{icon}</div>
      <div className="text-sm font-bold text-white">{big}</div>
      <div className="text-xs text-zinc-500">{small}</div>
    </div>
  )
}

// ── Jarvis auto-playing chat demo ──────────────────────────────────────────────
const DEMOS: { q: string; a: string }[] = [
  { q: 'how full are we vs capacity?', a: '📊 <b>48 / 60 registered</b> (80%)\n✅ Paid: 42   ⏳ Pending: 4   🎟 Free: 2\nYou\'re nearly full — 12 seats left.' },
  { q: '/money', a: '💰 <b>Money</b>\n\nRevenue: <b>RM 20,816</b>\n  • Stripe: RM 17,300\n  • Bank: RM 3,516\n\n📈 Net profit: <b>RM 17,600</b>' },
  { q: 'who hasn\'t paid yet?', a: '⏳ <b>4 pending:</b>\n• Daphne T — RM597 (early bird vip)\n• Marcus L — RM347 (standard)\n• Priya N — RM297 (early bird)\n• Wei Jie — RM347 (standard)' },
  { q: '/prep', a: '🎓 <b>Prep: 38 / 48 workshop-ready</b>\n10 still pending\n• Step 1 (install): 44 ✓\n• Step 2 (Pro): 40 ✓\n• Survey: 41 ✓' },
]

function JarvisDemo() {
  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState<'typing-q' | 'thinking' | 'answer'>('typing-q')
  const [typed, setTyped] = useState('')
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  // Animation loop genuinely drives state from timers — setState in effect is intended here.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    timers.current.forEach(clearTimeout); timers.current = []
    const demo = DEMOS[idx]
    setPhase('typing-q'); setTyped('')

    // type the question char by char
    let i = 0
    const typeNext = () => {
      i++; setTyped(demo.q.slice(0, i))
      if (i < demo.q.length) timers.current.push(setTimeout(typeNext, 45))
      else {
        timers.current.push(setTimeout(() => setPhase('thinking'), 400))
        timers.current.push(setTimeout(() => setPhase('answer'), 1500))
        timers.current.push(setTimeout(() => setIdx(v => (v + 1) % DEMOS.length), 5200))
      }
    }
    timers.current.push(setTimeout(typeNext, 500))
    return () => timers.current.forEach(clearTimeout)
  }, [idx])
  /* eslint-enable react-hooks/set-state-in-effect */

  const demo = DEMOS[idx]
  return (
    <div className="rounded-3xl border border-white/[0.08] overflow-hidden bg-[#0d0d0d]"
      style={{ boxShadow: '0 20px 60px -20px rgba(212,104,74,0.3)' }}>
      {/* phone top bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06] bg-[#141414]">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center text-sm">🤖</div>
        <div>
          <div className="text-sm font-semibold text-white leading-none">Jarvis</div>
          <div className="text-[10px] text-emerald-400 mt-0.5">● online</div>
        </div>
      </div>
      {/* chat */}
      <div className="p-4 space-y-3 min-h-[230px]">
        {/* user question */}
        <div className="flex justify-end">
          <div className="max-w-[80%] bg-amber-500 text-black rounded-2xl rounded-br-md px-3.5 py-2 text-sm font-medium">
            {typed}{phase === 'typing-q' && <span className="inline-block w-1.5 h-4 bg-black/60 ml-0.5 align-middle animate-pulse" />}
          </div>
        </div>
        {/* jarvis reply */}
        {phase !== 'typing-q' && (
          <div className="flex justify-start">
            <div className="max-w-[88%] bg-[#1c1c1c] border border-white/[0.06] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm text-zinc-200 whitespace-pre-line leading-relaxed">
              {phase === 'thinking'
                ? <span className="flex gap-1 py-1"><Dot /><Dot d={0.15} /><Dot d={0.3} /></span>
                : <span dangerouslySetInnerHTML={{ __html: demo.a }} />}
            </div>
          </div>
        )}
      </div>
      {/* dots indicator */}
      <div className="flex justify-center gap-1.5 pb-3">
        {DEMOS.map((_, i) => (
          <span key={i} className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-5 bg-amber-500' : 'w-1.5 bg-zinc-700'}`} />
        ))}
      </div>
    </div>
  )
}

function Dot({ d = 0 }: { d?: number }) {
  return <span className="w-2 h-2 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: `${d}s` }} />
}

export default function StartPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]"><div className="text-zinc-500">Loading…</div></div>}>
      <StartContent />
    </Suspense>
  )
}
