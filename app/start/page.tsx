'use client'
import { useEffect, useState, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { isValidPhone } from '@/lib/validate'
import { PREP_STEP_KEYS, GLCC_PREP_STEP_KEYS, PREP_TRACKS, PREP_TRACK_TOOLS, emptySteps, type PrepTrackKey } from '@/lib/prep-steps'
import { GLCC_SETUP_SKILL } from '@/lib/glcc-skill'
import { resolveEventConfig, type EventConfig } from '@/lib/event-config'

// Countdown deadline = midnight (00:00) at the START of the event's calendar
// day, in Malaysia time (UTC+8). Take the event's date as seen in Asia/
// Kuala_Lumpur, then pin to 00:00 +08:00 — so the timer hits zero at 12am on
// the day of the event regardless of the viewer's own timezone.
function startOfEventDayMYT(d: Date): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d) // 'YYYY-MM-DD'
  return new Date(`${ymd}T00:00:00+08:00`)
}

interface Facts {
  name?: string | null; date?: string | null; venue?: string | null
  config?: Partial<EventConfig>
}

type Steps = Record<string, boolean>
type OS = 'mac' | 'windows' | null

function StartContent() {
  const params = useSearchParams()
  const eventId = params.get('event') || ''
  // Tester mode: ?preview=1 unlocks every step and never writes to the live dashboard.
  const previewUnlock = params.get('preview') === '1' || params.get('unlock') === '1'

  const [facts, setFacts] = useState<Facts | null>(null)
  const [steps, setSteps] = useState<Steps>(emptySteps())
  const [ipadAck, setIpadAck] = useState(false)
  const [os, setOs] = useState<OS>(null)
  const [phone, setPhone] = useState('')
  const [phoneAsked, setPhoneAsked] = useState(false)
  const [phoneInput, setPhoneInput] = useState('')
  const [pendingStep, setPendingStep] = useState<string | null>(null)
  const [track, setTrack] = useState<PrepTrackKey | null>(null)
  const [consentAck, setConsentAck] = useState(false)
  const [tool, setTool] = useState<string | null>(null)
  const [toolHasApi, setToolHasApi] = useState(false)
  const [otherActive, setOtherActive] = useState(false)
  const [verified, setVerified] = useState(false)
  const [copiedSkill, setCopiedSkill] = useState(false)
  const [factsError, setFactsError] = useState(false)

  const PHONE_KEY = `prep_phone_${eventId}`
  const STEPS_KEY = `prep_steps_${eventId}`
  const MISC_KEY = `prep_misc_${eventId}`
  const VERIFIED_KEY = `prep_verified_${eventId}`

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!eventId) return
    try {
      const p = localStorage.getItem(PHONE_KEY); if (p) setPhone(p)
      const s = localStorage.getItem(STEPS_KEY); if (s) setSteps(JSON.parse(s))
      const m = localStorage.getItem(MISC_KEY)
      if (m) { const mm = JSON.parse(m); setIpadAck(!!mm.ipadAck); setConsentAck(!!mm.consentAck); if (mm.os) setOs(mm.os); if (mm.track) setTrack(mm.track); if (mm.tool) setTool(mm.tool); setToolHasApi(!!mm.toolHasApi); setOtherActive(!!mm.otherActive) }
      const v = localStorage.getItem(VERIFIED_KEY); if (v === '1') setVerified(true)
    } catch { /* ignore */ }
    // Load the event facts (incl. config.prep_variant that decides GLCC vs half-day).
    // A transient failure on first mount (cold function / request burst) used to hit
    // the catch and leave facts = {}, which silently rendered the WRONG (half-day)
    // workshop for a GLCC attendee. So retry a few times, and on hard failure show an
    // error rather than the wrong page.
    let cancelled = false
    const loadFacts = (attempt: number) => {
      fetch(`/api/survey?event_id=${eventId}&facts=1`, { cache: 'no-store' })
        .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
        .then((d: Facts) => { if (!cancelled) { setFacts(d); setFactsError(false) } })
        .catch(() => {
          if (cancelled) return
          if (attempt < 3) setTimeout(() => loadFacts(attempt + 1), 600 * (attempt + 1))
          else setFactsError(true)
        })
    }
    loadFacts(0)
    return () => { cancelled = true }
  }, [eventId]) // eslint-disable-line react-hooks/exhaustive-deps
  /* eslint-enable react-hooks/set-state-in-effect */

  const isGlcc = resolveEventConfig(facts?.config).prep_variant === 'glcc'
  const stepKeys: readonly string[] = isGlcc ? GLCC_PREP_STEP_KEYS : PREP_STEP_KEYS
  const stepCount = stepKeys.length
  const doneCount = stepKeys.filter(k => steps[k]).length
  const pct = Math.round((doneCount / stepCount) * 100)
  const allDone = doneCount === stepCount
  // Hard-lock gating (GLCC only): only the first unfinished step is open; every
  // step after it stays locked until the step above is ticked.
  const firstOpenIdx = (() => { const i = stepKeys.findIndex(k => !steps[k]); return i === -1 ? stepKeys.length : i })()
  const isLocked = (n: string) => isGlcc && !previewUnlock && stepKeys.indexOf(n) > firstOpenIdx

  // Cloud sync with visible failure: progress always lands in localStorage,
  // but if the POST fails (flaky wifi) the attendee sees a retry toast instead
  // of silently losing their cloud copy.
  const [cloudFailed, setCloudFailed] = useState<{ steps: Steps; ack: boolean; phone: string } | null>(null)
  function syncToCloud(next: Steps, ack: boolean, ph: string, trk: PrepTrackKey | null = track, consent: boolean = consentAck, tl: string | null = tool, tlApi: boolean = toolHasApi) {
    if (previewUnlock) return // tester mode: never write to the live dashboard
    fetch('/api/prep', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: eventId, phone: ph, track: trk, tool: tl, tool_has_api: tlApi, steps: { ...next, ipad_ack: ack, consent_ack: consent } }),
    })
      .then(r => { if (!r.ok) throw new Error(); setCloudFailed(null) })
      .catch(() => setCloudFailed({ steps: next, ack, phone: ph }))
  }

  function persistSteps(next: Steps, ph: string) {
    try { localStorage.setItem(STEPS_KEY, JSON.stringify(next)); if (ph) localStorage.setItem(PHONE_KEY, ph) } catch { /* ignore */ }
    if (ph) syncToCloud(next, ipadAck, ph)
  }
  function persistMisc(patch: Partial<{ ipadAck: boolean; os: OS; consentAck: boolean; track: PrepTrackKey | null; tool: string | null; toolHasApi: boolean; otherActive: boolean }>) {
    const merged = { ipadAck, os, consentAck, track, tool, toolHasApi, otherActive, ...patch }
    try { localStorage.setItem(MISC_KEY, JSON.stringify(merged)) } catch { /* ignore */ }
  }

  function toggleStep(id: string) {
    if (!phone && !previewUnlock) { setPendingStep(id); setPhoneAsked(true); return }
    const next = { ...steps, [id]: !steps[id] }
    setSteps(next); persistSteps(next, phone)
  }
  function setAck(v: boolean) {
    setIpadAck(v); persistMisc({ ipadAck: v })
    if (phone) syncToCloud(steps, v, phone)
  }
  function chooseOs(v: OS) { setOs(v); persistMisc({ os: v }) }

  // Step 7 (GLCC) = pick a track → pick a tool → confirm it has an API.
  // The step only counts as done when all three are set.
  function commitStep7(nextTrack: PrepTrackKey | null, nextTool: string | null, nextApi: boolean) {
    const done7 = !!(nextTrack && nextTool && nextTool.trim() && nextApi)
    const next = { ...steps, '9': done7 }
    setSteps(next)
    try { localStorage.setItem(STEPS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
    if (phone) syncToCloud(next, ipadAck, phone, nextTrack, consentAck, nextTool, nextApi)
  }
  function chooseTrack(t: PrepTrackKey) {
    setTrack(t); setTool(null); setToolHasApi(false); setOtherActive(false)
    persistMisc({ track: t, tool: null, toolHasApi: false, otherActive: false })
    if (!phone && !previewUnlock) { setPhoneAsked(true); return }
    commitStep7(t, null, false)
  }
  function chooseTool(name: string, other = false) {
    setTool(name); setOtherActive(other)
    persistMisc({ tool: name, otherActive: other })
    if (!phone && !previewUnlock) { setPhoneAsked(true); return }
    commitStep7(track, name, toolHasApi)
  }
  function setToolApi(v: boolean) {
    setToolHasApi(v); persistMisc({ toolHasApi: v })
    if (!phone && !previewUnlock) { setPhoneAsked(true); return }
    commitStep7(track, tool, v)
  }
  function copySkill() {
    try { navigator.clipboard.writeText(GLCC_SETUP_SKILL); setCopiedSkill(true); setTimeout(() => setCopiedSkill(false), 2000) } catch { /* ignore */ }
  }

  function submitPhone() {
    if (!isValidPhone(phoneInput)) return
    const ph = phoneInput.trim()
    setPhone(ph); setPhoneAsked(false)
    const next = pendingStep ? { ...steps, [pendingStep]: true } : steps
    setSteps(next)
    try { localStorage.setItem(STEPS_KEY, JSON.stringify(next)); localStorage.setItem(PHONE_KEY, ph) } catch { /* ignore */ }
    syncToCloud(next, ipadAck, ph)
    setPendingStep(null); setPhoneInput('')
  }

  const cfg = resolveEventConfig(facts?.config)
  const eventDate = facts?.date ? new Date(facts.date) : null
  // Countdown ends at 12am on the day of the event (Malaysia time), not the
  // event's start time — so prep is "due" by midnight the day-of.
  const countdownTarget = eventDate ? startOfEventDayMYT(eventDate) : null
  const dateStr = eventDate ? eventDate.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long' }) : null
  const surveyUrl = eventId ? `/survey?event=${eventId}` : '#'

  // GLCC: one master video at top; each step links to its timestamp in it.
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  function jumpLink(tsStr: string | undefined, label: string) {
    if (!cfg.glcc_video_master) return null
    const sec = parseInt(tsStr || '0', 10) || 0
    const href = `https://youtu.be/${cfg.glcc_video_master}${sec ? `?t=${sec}` : ''}`
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="cta-ghost">
        ▶️ {label}{sec ? ` · ${mmss(sec)}` : ''}
      </a>
    )
  }
  // Prefer a per-step Loom walkthrough if one is set; otherwise fall back to the
  // master-video timestamp link.
  function stepVideo(loomId: string | undefined, ts: string | undefined, label: string) {
    if (loomId) return <Loom id={loomId} label={label} />
    return jumpLink(ts, label)
  }
  function typeOther(value: string) {
    setTool(value); setOtherActive(true); persistMisc({ tool: value, otherActive: true })
  }

  if (!eventId) {
    return <div className="min-h-screen flex items-center justify-center bg-black"><p className="text-zinc-500">Invalid link.</p></div>
  }

  // GLCC setup page is gated to paid attendees (preview=1 bypasses for testing).
  if (factsError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center" style={{ background: '#060606' }}>
        <p className="text-zinc-400 text-sm max-w-xs">Couldn&apos;t load your workshop details — check your connection and try again.</p>
        <button onClick={() => location.reload()} className="text-black font-semibold rounded-2xl px-6 py-3 text-sm"
          style={{ background: 'linear-gradient(135deg, #f59e0b, #D4684A)' }}>↻ Reload</button>
      </div>
    )
  }
  if (facts === null) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: '#060606' }}><p className="text-zinc-500">Loading…</p></div>
  }
  if (isGlcc && !verified && !previewUnlock) {
    return <GlccGate onVerified={() => { setVerified(true); try { localStorage.setItem(VERIFIED_KEY, '1') } catch { /* ignore */ } }} />
  }

  return (
    <div className="relative min-h-screen text-white" style={{ background: '#060606' }}>
      {/* ── Sticky countdown ── */}
      <CountdownBar target={countdownTarget} done={allDone} doneCount={doneCount} total={stepCount} venue={cfg.venue_label} />

      {/* Ambient liquid background — clipped here (not on the root) so it can't
          force horizontal scroll while leaving the root free for sticky. */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
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
          <img src="/claude-logo.jpg" alt="Claude Malaysia" width={60} height={60} className="mx-auto rounded-[18px] mb-6"
            style={{ boxShadow: '0 8px 40px -8px rgba(212,104,74,0.6)' }} />
          <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.15em] text-amber-300/90 uppercase mb-4 px-3 py-1 rounded-full"
            style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.18)' }}>
            ✨ Claude Malaysia Workshop
          </div>

          {/* Workshop topic */}
          <h1 className="text-[28px] sm:text-4xl font-extrabold leading-[1.1] tracking-tight mb-3">
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(180deg, #fff 30%, #d4a574)' }}>
              {isGlcc ? 'Go Live Claude Challenge — Get Set Up' : 'Claude Dashboard for CEOs & Heads of Department'}
            </span>
          </h1>
          <p className="text-zinc-400 text-[15px] leading-relaxed mb-6 max-w-sm mx-auto">
            You&apos;re in 🎉 {stepCount} quick steps to be <span className="text-white font-medium">{isGlcc ? 'build-ready for Day 1' : 'workshop-ready'}</span>. Your progress saves automatically.
          </p>

          {/* Date + venue pills (no seat count) */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {(cfg.date_label || dateStr) && <Pill icon="📅" text={cfg.date_label || dateStr || ''} />}
            {facts?.venue && <Pill icon="📍" text={facts.venue} />}
            <Pill icon="⏰" text={cfg.time_label || '9:30am start'} highlight />
          </div>
        </div>

        {/* ── Warning ── */}
        <Glass className="mt-7 p-4 border-amber-500/25" style={{ background: 'rgba(245,158,11,0.05)' }}>
          <div className="flex gap-3">
            <span className="text-xl">⚡</span>
            <div>
              <div className="text-sm font-semibold text-amber-200 mb-0.5">Please finish all {stepCount} steps before the day</div>
              <p className="text-[13px] text-zinc-400 leading-relaxed">If you show up un-installed, you&apos;ll <b className="text-zinc-200">delay the whole class</b> waiting on downloads — which means less hands-on building and sharing time for everyone.</p>
            </div>
          </div>
        </Glass>

        {/* ── Progress ── */}
        <Glass className="mt-4 p-4 flex items-center gap-4">
          <Ring pct={pct} />
          <div className="flex-1">
            <div className="text-sm font-semibold">{allDone ? "You're all set! 🚀" : `${doneCount} of ${stepCount} complete`}</div>
            <div className="text-xs text-zinc-500">{allDone ? 'See you at 9:30am sharp' : 'Tap each step as you go'}</div>
          </div>
        </Glass>

        {/* ── Steps (half-day) ── */}
        {!isGlcc && (
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
            {os === 'mac' && <Video id={cfg.mac_video_id} label="🍎 Install Homebrew on Mac" full />}
            {os === 'windows' && <Video id={cfg.windows_video_id} label="🪟 Install Git (& Claude) on Windows" full />}
            {!os && <div className="text-[12px] text-zinc-600 text-center py-3">👆 Pick your OS to see the right guide</div>}

            {/* Prominent docs CTA */}
            <a href={cfg.docs_url} target="_blank" rel="noopener noreferrer"
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

          {/* Step 5 — bring your data */}
          <StepCard n="5" done={steps['5']} onToggle={() => toggleStep('5')}
            title="Prepare your business data" subtitle="Excel or Google Sheets — so we can plug it in">
            <p className="text-[13px] text-zinc-400 mb-3 leading-relaxed">
              Bring real numbers from <b className="text-zinc-200">your own business</b> in an <b className="text-zinc-200">Excel or Google Sheets</b> file — sales, leads, expenses, inventory, anything. We&apos;ll plug it straight into <b className="text-amber-300">your first live dashboard</b> in class.
            </p>
            <div className="rounded-xl px-3.5 py-3 text-[12px] text-zinc-300 leading-relaxed"
              style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.22)' }}>
              💡 No data ready? A simple month-by-month sheet (e.g. revenue per month) is enough to see it come alive.
            </div>
          </StepCard>

          {/* Step 6 — show up early + venue */}
          <StepCard n="6" done={steps['6']} onToggle={() => toggleStep('6')}
            title="Show up EARLY — 9:30am" subtitle="Watch this so you know how to find us">
            <p className="text-[13px] text-zinc-400 mb-3 leading-relaxed">Here&apos;s exactly how to get up to the venue 👇 (and a peek inside!)</p>
            <Video id={cfg.venue_video_id} label={`🎬 How to get to ${cfg.venue_label} — Venue Guide`} full />
          </StepCard>
        </div>
        )}

        {/* ── Steps (GLCC 2-day) ── */}
        {isGlcc && (<>
        {/* One A-Z master video, pinned at the top */}
        {cfg.glcc_video_master && (
          <div className="mt-5">
            <SectionLabel>Watch this first — your whole setup, start to finish</SectionLabel>
            <div className="mt-3"><Video id={cfg.glcc_video_master} label="🎬 GLCC setup — everything in one video" full /></div>
            <p className="text-[12px] text-zinc-500 text-center mt-2">Follow along, then tick each step below. Each step jumps you to its part of the video.</p>
          </div>
        )}

        <div className="mt-4 space-y-3">
          {/* GLCC 1 — Install Claude Code + setup co-pilot */}
          <StepCard n="1" done={steps['1']} onToggle={() => toggleStep('1')} critical
            title="Install Claude Code (the CLI)" subtitle="Mac or Windows laptop — with a terminal">
            {stepVideo(cfg.glcc_loom_install, cfg.glcc_ts_install, '🎬 Watch: install Claude Code')}
            <p className="text-[13px] text-zinc-400 my-3 leading-relaxed">Two quick installs — <b className="text-zinc-200">no Homebrew needed</b>. First, install <b className="text-zinc-200">Node.js (LTS)</b> from nodejs.org (just click through the installer). Then open your terminal and paste the line for <b className="text-zinc-200">your</b> computer 👇</p>
            <div className="mt-3">
              <div className="text-[12px] font-semibold text-zinc-300 mb-1">🍎 On Mac — open <b className="text-white">Terminal</b> (Cmd+Space, type Terminal):</div>
              <div className="rounded-xl px-3 py-2.5 text-[12px] font-mono text-amber-200 bg-black/40 border border-white/10 overflow-x-auto">curl -fsSL https://claude.ai/install.sh | bash</div>
            </div>
            <div className="mt-3">
              <div className="text-[12px] font-semibold text-zinc-300 mb-1">🪟 On Windows — open <b className="text-white">PowerShell</b> (Start, type PowerShell — not Command Prompt):</div>
              <div className="rounded-xl px-3 py-2.5 text-[12px] font-mono text-amber-200 bg-black/40 border border-white/10 overflow-x-auto">irm https://claude.ai/install.ps1 | iex</div>
            </div>
            <p className="text-[12px] text-zinc-500 mt-2">Then type <code className="px-1 rounded bg-white/10 text-amber-200 text-[11px]">claude</code> and log in.</p>
            <div className="rounded-xl px-3.5 py-3 mt-3 text-[12px] text-zinc-300 leading-relaxed"
              style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.22)' }}>
              ✅ You&apos;ll know it worked when <code className="px-1 rounded bg-white/10 text-amber-200 text-[11px]">claude --version</code> and <code className="px-1 rounded bg-white/10 text-amber-200 text-[11px]">node -v</code> both show a version — I show you exactly how in the video.
            </div>
            {/* Setup co-pilot — gated skill (paid attendees) */}
            <div className="rounded-2xl px-4 py-3.5 mt-3"
              style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.16), rgba(99,102,241,0.10))', border: '1px solid rgba(99,102,241,0.30)' }}>
              <div className="text-sm font-bold flex items-center gap-2">🤖 Meet Kingsley AI — your setup narrator</div>
              <p className="text-[12px] text-indigo-100/80 mt-1 leading-relaxed">Don&apos;t want to do all this yourself? Copy this and paste it into <b>Claude Code</b> — <b>Kingsley AI</b> sets up every account <i>for</i> you, click-by-click in your browser. 👇</p>
              <button onClick={copySkill} className="cta mt-2.5">{copiedSkill ? '✅ Copied — paste into Claude Code' : '📋 Copy Kingsley AI'}</button>
            </div>
            <button onClick={() => setAck(!ipadAck)}
              className={`mt-3 w-full flex items-center gap-3 text-left rounded-xl px-3.5 py-3 transition-all border
                ${ipadAck ? 'border-amber-500/40 bg-amber-500/[0.06]' : 'border-white/10 bg-white/[0.02]'}`}>
              <span className={`w-5 h-5 shrink-0 rounded-md border-2 flex items-center justify-center transition-all
                ${ipadAck ? 'bg-amber-500 border-amber-500 text-black' : 'border-zinc-600 text-transparent'}`}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              </span>
              <span className="text-[13px] text-zinc-300 leading-snug">I understand I&apos;ll bring a <b className="text-white">real laptop, not an iPad</b> — Claude Code needs a terminal.</span>
            </button>
          </StepCard>

          {/* GLCC 2 — Install your dev tools (Homebrew / Git), OS-aware */}
          <StepCard n="2" done={steps['2']} onToggle={() => toggleStep('2')} critical locked={isLocked('2')}
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
            {os === 'mac' && <Video id={cfg.mac_video_id} label="🍎 Install Homebrew on Mac" full />}
            {os === 'windows' && <Video id={cfg.windows_video_id} label="🪟 Install Git (& Claude) on Windows" full />}
            {!os && <div className="text-[12px] text-zinc-600 text-center py-3">👆 Pick your OS to see the right guide</div>}
            <a href={cfg.docs_url} target="_blank" rel="noopener noreferrer"
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

          {/* GLCC 3 — Download Claude for Chrome */}
          <StepCard n="3" done={steps['3']} onToggle={() => toggleStep('3')} locked={isLocked('3')}
            title="Download Claude for Chrome" subtitle="So the AI can set things up in your browser">
            {stepVideo(cfg.glcc_loom_chrome, cfg.glcc_ts_chrome, '🎬 Watch: Claude for Chrome')}
            <p className="text-[13px] text-zinc-400 my-3 leading-relaxed">Install the <b className="text-zinc-200">Claude for Chrome</b> extension and sign in. It lets your setup co-pilot (and Claude in class) <b className="text-amber-300">click through your browser for you</b>.</p>
            <a href="https://claude.ai/chrome" target="_blank" rel="noopener noreferrer" className="cta">🧩 Get Claude for Chrome</a>
            <p className="text-[12px] text-zinc-500 mt-2">After adding it, pin it and grant it permission to control the browser when asked.</p>
          </StepCard>

          {/* GLCC 4 — Claude Pro + API key */}
          <StepCard n="4" done={steps['4']} onToggle={() => toggleStep('4')} locked={isLocked('4')}
            title="Claude Pro + an API key" subtitle="Load USD $5 (about RM23) of credit">
            {stepVideo(cfg.glcc_loom_keys, cfg.glcc_ts_keys, '🎬 Watch: Claude Pro + API key')}
            <p className="text-[13px] text-zinc-400 my-3 leading-relaxed">Get <b className="text-zinc-200">Claude Pro</b> (Free can&apos;t run Claude Code), then create an <b className="text-zinc-200">Anthropic API key</b> and load <b className="text-amber-300">USD $5 (about RM23)</b> — your Telegram bot uses it. Keep the cap low; the key is billable.</p>
            <a href="https://claude.com/pricing" target="_blank" rel="noopener noreferrer" className="cta">⭐ Get Claude Pro</a>
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="cta-ghost mt-2">🔑 Create API key + add credit</a>
          </StepCard>

          {/* GLCC 5 — GitHub account + copy the starter template into their own repo */}
          <StepCard n="5" done={steps['5']} onToggle={() => toggleStep('5')} locked={isLocked('5')}
            title="GitHub + your project repo" subtitle="Your project's home for the workshop">
            {stepVideo(cfg.glcc_loom_github, cfg.glcc_ts_github, '🎬 Watch: GitHub + your repo')}
            <p className="text-[13px] text-zinc-400 my-3 leading-relaxed">Create a free <b className="text-zinc-200">GitHub</b> account, then make your own copy of our starter — one click gives you your <b className="text-amber-300">glcc-ops</b> repo, the home for everything you build.</p>
            <a href="https://github.com/signup" target="_blank" rel="noopener noreferrer" className="cta-ghost">🐙 Create GitHub account</a>
            <a href={cfg.template_repo_url || 'https://github.com/claude-malaysia-glcc/glcc-ops-starter/generate'} target="_blank" rel="noopener noreferrer" className="cta mt-2">📦 Use this template → make my repo</a>
            <p className="text-[12px] text-zinc-500 mt-2">Name it <b className="text-zinc-300">glcc-ops</b>, keep it <b className="text-zinc-300">Public</b>, and you&apos;re done. (Coaching access is optional and set up later, on Day 2.)</p>
          </StepCard>

          {/* GLCC 6 — Supabase */}
          <StepCard n="6" done={steps['6']} onToggle={() => toggleStep('6')} locked={isLocked('6')}
            title="Create a Supabase project" subtitle="Your free cloud database — the 'second brain'">
            {stepVideo(cfg.glcc_loom_supabase, cfg.glcc_ts_supabase, '🎬 Watch: create Supabase')}
            <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer" className="cta mt-3">🗄️ Create Supabase project</a>
            <p className="text-[12px] text-zinc-500 mt-2">Free tier is plenty. Make ONE empty project, <b className="text-zinc-300">save the database password</b>, pick Singapore — we run the rest in class.</p>
          </StepCard>

          {/* GLCC 7 — Vercel */}
          <StepCard n="7" done={steps['7']} onToggle={() => toggleStep('7')} locked={isLocked('7')}
            title="Create a Vercel account" subtitle="Where your app goes live — sign in with GitHub">
            {stepVideo(cfg.glcc_loom_vercel, cfg.glcc_ts_vercel, '🎬 Watch: create Vercel')}
            <a href="https://vercel.com/signup" target="_blank" rel="noopener noreferrer" className="cta mt-3">▲ Create Vercel account</a>
            <p className="text-[12px] text-zinc-500 mt-2">Choose <b className="text-zinc-300">Continue with GitHub</b> so it links to your repo automatically. No project needed — we deploy in class.</p>
          </StepCard>

          {/* GLCC 8 — Telegram bot + user ID */}
          <StepCard n="8" done={steps['8']} onToggle={() => toggleStep('8')} critical locked={isLocked('8')}
            title="Telegram bot + your user ID" subtitle="So your Jarvis can text you">
            {stepVideo(cfg.glcc_loom_telegram, cfg.glcc_ts_telegram, '🎬 Watch: Telegram bot + user ID')}
            <p className="text-[13px] text-zinc-400 my-3 leading-relaxed">In Telegram: message <b className="text-zinc-200">@BotFather</b> → <code className="px-1 rounded bg-white/10 text-amber-200 text-[11px]">/newbot</code> → save the <b className="text-zinc-200">token</b>. Then message <b className="text-zinc-200">@userinfobot</b> → tap Start → save the <b className="text-zinc-200">number</b> (your user ID).</p>
            <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="cta-ghost">🤖 Open @BotFather</a>
            <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer" className="cta-ghost mt-2">🆔 Open @userinfobot</a>
            <div className="rounded-xl px-3.5 py-3 mt-3 text-[12px] text-zinc-300 leading-relaxed"
              style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.22)' }}>
              📝 Save BOTH: your <b className="text-amber-200">bot token</b> AND your <b className="text-amber-200">user ID</b> (e.g. 812345678) — you need both on Day 1.
            </div>
          </StepCard>

          {/* GLCC 9 — Pick your track + tool */}
          <StepCard n="9" done={steps['9']} onToggle={() => { /* completed by choosing track + tool + API below */ }} locked={isLocked('9')}
            title="Pick your track & tool" subtitle="What will YOUR system run?">
            {stepVideo(cfg.glcc_loom_track, undefined, '🎬 Watch: pick your track & tool')}
            <p className="text-[12px] text-zinc-500 mb-2">1. Choose your track:</p>
            <div className="grid grid-cols-1 gap-2">
              {PREP_TRACKS.map(t => (
                <button key={t.key} onClick={() => chooseTrack(t.key)}
                  className={`flex items-center gap-3 text-left rounded-xl px-3.5 py-3 transition-all border
                    ${track === t.key ? 'border-amber-500/50 bg-amber-500/[0.08]' : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'}`}>
                  <span className="text-xl">{t.emoji}</span>
                  <span className="text-[14px] font-medium text-zinc-100 flex-1">{t.label}</span>
                  {track === t.key && <span className="text-amber-400 text-sm font-bold">✓</span>}
                </button>
              ))}
            </div>
            {track && (
              <div className="mt-4">
                <p className="text-[12px] text-zinc-500 mb-2">2. Which ONE tool will you connect? <span className="text-zinc-600">(it must have an API)</span></p>
                <div className="flex flex-wrap gap-2">
                  {PREP_TRACK_TOOLS[track].map(name => (
                    <button key={name} onClick={() => chooseTool(name, false)}
                      className={`text-[13px] px-3 py-2 rounded-xl border transition-all
                        ${tool === name && !otherActive ? 'border-amber-500/50 bg-amber-500/[0.08] text-white' : 'border-white/10 bg-white/[0.02] text-zinc-300 hover:bg-white/[0.05]'}`}>
                      {name}
                    </button>
                  ))}
                  <button onClick={() => chooseTool('', true)}
                    className={`text-[13px] px-3 py-2 rounded-xl border transition-all
                      ${otherActive ? 'border-amber-500/50 bg-amber-500/[0.08] text-white' : 'border-white/10 bg-white/[0.02] text-zinc-300 hover:bg-white/[0.05]'}`}>
                    ✏️ Other
                  </button>
                </div>
                {otherActive && (
                  <input value={tool ?? ''} onChange={e => typeOther(e.target.value)}
                    onBlur={e => { if (phone) commitStep7(track, e.target.value, toolHasApi) }}
                    placeholder="Type your tool's name…"
                    className="w-full mt-2 bg-black/40 border border-white/15 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500/60" />
                )}
                {tool && tool.trim() && (
                  <button onClick={() => setToolApi(!toolHasApi)}
                    className={`mt-3 w-full flex items-center gap-3 text-left rounded-xl px-3.5 py-3 transition-all border
                      ${toolHasApi ? 'border-emerald-500/40 bg-emerald-500/[0.06]' : 'border-white/10 bg-white/[0.02]'}`}>
                    <span className={`w-5 h-5 shrink-0 rounded-md border-2 flex items-center justify-center transition-all
                      ${toolHasApi ? 'bg-emerald-500 border-emerald-500 text-black' : 'border-zinc-600 text-transparent'}`}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                    </span>
                    <span className="text-[13px] text-zinc-300 leading-snug">I can access <b className="text-white">{tool}</b>&apos;s API key.</span>
                  </button>
                )}
                <p className="text-[11px] text-zinc-600 mt-2">Not sure it has an API? Google &ldquo;{tool || 'your tool'} API&rdquo;, or ask Claude &ldquo;does it have an API and how do I get a key?&rdquo;</p>
              </div>
            )}
          </StepCard>

          {/* GLCC 10 — Bring your data */}
          <StepCard n="10" done={steps['10']} onToggle={() => toggleStep('10')} locked={isLocked('10')}
            title="Bring your data" subtitle="Excel or Google Sheets — we'll plug it in">
            {stepVideo(cfg.glcc_loom_data, cfg.glcc_ts_data, '🎬 Watch: bring your data')}
            <p className="text-[13px] text-zinc-400 my-3 leading-relaxed">Bring <b className="text-zinc-200">real numbers from your own business</b> (sales, leads, expenses — whatever your track needs) in an <b className="text-zinc-200">Excel or Google Sheets</b> file. We plug it straight into <b className="text-amber-300">your live system</b> on Day 2.</p>
            <div className="rounded-xl px-3.5 py-3 text-[12px] text-zinc-300 leading-relaxed"
              style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.22)' }}>
              💡 Messy real data beats perfect fake data — a simple month-by-month sheet is enough.
            </div>
          </StepCard>

          {/* GLCC 11 — Bring your org chart */}
          <StepCard n="11" done={steps['11']} onToggle={() => toggleStep('11')} locked={isLocked('11')}
            title="Bring your org chart" subtitle="Your team structure — CEO → departments → roles">
            {stepVideo(cfg.glcc_loom_orgchart, undefined, '🎬 Watch: bring your org chart')}
            <p className="text-[13px] text-zinc-400 my-3 leading-relaxed">Sketch your <b className="text-zinc-200">organisational structure</b> — 3 simple levels: <b className="text-zinc-200">you / the CEO</b> at the top, your <b className="text-zinc-200">departments</b>, then the <b className="text-amber-300">roles or jobs</b> under each. We use it on Day 2 to set up your team, contacts and AI agents.</p>
            <div className="rounded-xl px-3 py-3.5 mb-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="flex flex-col items-center gap-1.5 text-[11px]">
                <div className="px-3 py-1 rounded-md bg-white/10 text-white font-semibold">CEO / You</div>
                <div className="text-zinc-600 leading-none">│</div>
                <div className="flex gap-1.5">
                  <div className="px-2 py-1 rounded-md text-amber-200" style={{ background: 'rgba(245,158,11,0.14)' }}>Sales</div>
                  <div className="px-2 py-1 rounded-md text-amber-200" style={{ background: 'rgba(245,158,11,0.14)' }}>Ops</div>
                  <div className="px-2 py-1 rounded-md text-amber-200" style={{ background: 'rgba(245,158,11,0.14)' }}>Finance</div>
                </div>
                <div className="text-zinc-600 leading-none">│</div>
                <div className="flex gap-1.5 flex-wrap justify-center text-zinc-400">
                  <div className="px-2 py-0.5 rounded bg-white/[0.04]">role</div>
                  <div className="px-2 py-0.5 rounded bg-white/[0.04]">role</div>
                  <div className="px-2 py-0.5 rounded bg-white/[0.04]">role</div>
                  <div className="px-2 py-0.5 rounded bg-white/[0.04]">role</div>
                </div>
              </div>
            </div>
            <div className="rounded-xl px-3.5 py-3 text-[12px] text-zinc-300 leading-relaxed"
              style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.22)' }}>
              💡 A quick photo of a hand-drawn chart is perfectly fine — even just your departments and who does what.
            </div>
          </StepCard>
        </div>
        </>)}

        {/* ── What you'll leave with ── */}
        <div className="mt-9">
          <SectionLabel>You&apos;ll walk out with</SectionLabel>

          {/* Auto-rotating dashboard showcase */}
          <div className="mt-3"><DashboardShowcase /></div>

          <div className="space-y-3 mt-3">
            {isGlcc ? (
              <>
                <Glass className="p-4 flex items-start gap-3.5">
                  <div className="w-11 h-11 shrink-0 rounded-2xl flex items-center justify-center text-xl"
                    style={{ background: 'linear-gradient(135deg, rgba(212,104,74,0.25), rgba(245,158,11,0.15))', border: '1px solid rgba(245,158,11,0.2)' }}>📊</div>
                  <div>
                    <div className="font-bold text-[15px]">Your AI dashboard</div>
                    <div className="text-[13px] text-zinc-400 leading-relaxed">Live, on your real business data, built for your track — yours to keep.</div>
                  </div>
                </Glass>
                <Glass className="p-4 flex items-start gap-3.5">
                  <div className="w-11 h-11 shrink-0 rounded-2xl flex items-center justify-center text-xl"
                    style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.25), rgba(5,150,105,0.15))', border: '1px solid rgba(16,185,129,0.2)' }}>⚙️</div>
                  <div>
                    <div className="font-bold text-[15px]">An AI employee</div>
                    <div className="text-[13px] text-zinc-400 leading-relaxed">An automation that does your repetitive admin for you — 24/7, no salary.</div>
                  </div>
                </Glass>
                <Glass className="p-4 flex items-start gap-3.5">
                  <div className="w-11 h-11 shrink-0 rounded-2xl flex items-center justify-center text-xl"
                    style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.25), rgba(99,102,241,0.15))', border: '1px solid rgba(99,102,241,0.2)' }}>🌐</div>
                  <div>
                    <div className="font-bold text-[15px]">Your live AI HQ</div>
                    <div className="text-[13px] text-zinc-400 leading-relaxed">A real web app on the internet — open it on your laptop or your phone.</div>
                  </div>
                </Glass>
                <Glass className="p-4 flex items-start gap-3.5">
                  <div className="w-11 h-11 shrink-0 rounded-2xl flex items-center justify-center text-xl"
                    style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.25), rgba(212,104,74,0.15))', border: '1px solid rgba(245,158,11,0.2)' }}>🤖</div>
                  <div>
                    <div className="font-bold text-[15px]">Your own Jarvis</div>
                    <div className="text-[13px] text-zinc-400 leading-relaxed">Text your business on Telegram — &ldquo;how many leads today?&rdquo; — get an instant answer.</div>
                  </div>
                </Glass>
              </>
            ) : (
              <>
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
              </>
            )}
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
            {isGlcc ? (
              <>
                <p className="text-[12px] text-zinc-600 leading-relaxed">
                  In these 2 days, you build <i>your own</i> Jarvis Oyen — on your Telegram, running on your real data. 🌱
                </p>
                <p className="text-[12px] text-zinc-600 leading-relaxed mt-1.5">
                  By the end of Day 2, your whole business is one text away.
                </p>
              </>
            ) : (
              <>
                <p className="text-[12px] text-zinc-600 leading-relaxed">
                  We&apos;re <i>not</i> building Jarvis Oyen in this half-day class — that&apos;s the next level.
                </p>
                <p className="text-[12px] text-zinc-600 leading-relaxed mt-1.5">
                  Today&apos;s workshop marks the start: your first dashboard. 🌱 This is what it could look like once you go live with all your data!
                </p>
              </>
            )}
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

      {/* ── Cloud-save failure toast (progress is still on this device) ── */}
      {cloudFailed && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl text-[13px] text-white"
          style={{ background: 'rgba(40,16,12,0.92)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', border: '1px solid rgba(239,68,68,0.35)' }}>
          <span>⚠️ Saved on this phone, but not to the cloud</span>
          <button onClick={() => syncToCloud(cloudFailed.steps, cloudFailed.ack, cloudFailed.phone)}
            className="shrink-0 font-bold text-black text-[12px] px-3 py-1.5 rounded-xl"
            style={{ background: 'linear-gradient(135deg, #f59e0b, #D4684A)' }}>
            Retry
          </button>
        </div>
      )}

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
// Gate the GLCC setup page — paid attendees only.
function GlccGate({ onVerified }: { onVerified: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const canSubmit = name.trim().length > 1 && email.includes('@') && isValidPhone(phone)

  async function verify() {
    if (!canSubmit || loading) return
    setLoading(true); setFailed(false)
    try {
      const r = await fetch('/api/glcc-verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), phone: phone.trim() }),
      })
      const d = await r.json()
      if (d.ok) onVerified()
      else setFailed(true)
    } catch { setFailed(true) }
    setLoading(false)
  }

  const input = 'w-full mt-1 bg-black/40 border border-white/15 rounded-xl px-3.5 py-3 text-white text-sm focus:outline-none focus:border-indigo-500/60'
  return (
    <div className="relative min-h-screen text-white flex items-center" style={{ background: '#060606' }}>
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[680px] h-[680px] rounded-full blur-[120px] opacity-[0.20]"
          style={{ background: 'radial-gradient(circle, #6366f1 0%, transparent 65%)' }} />
      </div>
      <div className="max-w-md mx-auto px-5 py-10 w-full">
        <div className="text-center mb-7">
          <div className="text-4xl mb-3">🔒</div>
          <p className="text-[11px] font-semibold tracking-[0.15em] text-indigo-300/90 uppercase mb-2">Go Live Claude Challenge</p>
          <h1 className="text-2xl font-extrabold leading-tight">Confirm your seat</h1>
          <p className="text-zinc-400 text-[14px] mt-3 leading-relaxed">This setup page is for <span className="text-amber-300 font-medium">paid attendees</span>. Pop in your details to unlock it.</p>
        </div>
        <div className="rounded-[22px] border border-white/[0.08] p-5 space-y-3" style={{ background: 'rgba(255,255,255,0.035)' }}>
          <label className="block"><span className="text-[12px] text-zinc-500">Full name</span>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" className={input} /></label>
          <label className="block"><span className="text-[12px] text-zinc-500">Email</span>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" type="email" className={input} /></label>
          <label className="block"><span className="text-[12px] text-zinc-500">Phone (WhatsApp)</span>
            <input value={phone} onChange={e => setPhone(e.target.value)} onKeyDown={e => e.key === 'Enter' && verify()} placeholder="e.g. 0123456789" type="tel" className={input} /></label>
          {failed && <p className="text-[13px] text-red-300 leading-relaxed">We couldn&apos;t find a <b>paid</b> Go Live Claude Challenge seat for those details. Just paid? Give it a few minutes, or double-check the email/phone you registered with.</p>}
          <button onClick={verify} disabled={!canSubmit || loading}
            className="w-full mt-1 disabled:opacity-40 text-black font-semibold rounded-2xl py-3.5 text-sm transition-all"
            style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)' }}>
            {loading ? 'Checking…' : '🔓 Unlock my setup page'}
          </button>
          <p className="text-[11px] text-zinc-600 text-center leading-relaxed">Only used to confirm your seat. You&apos;ll never be asked for a password or API key here.</p>
        </div>
      </div>
    </div>
  )
}

function CdUnit({ v, l }: { v: number; l: string }) {
  return (
    <span className="flex flex-col items-center">
      <span className="text-base font-bold tabular-nums leading-none" style={{ color: '#ffd9a0' }}>{String(v).padStart(2, '0')}</span>
      <span className="text-[8px] text-amber-200/50 tracking-widest uppercase mt-0.5">{l}</span>
    </span>
  )
}

function CountdownBar({ target, done, doneCount, total, venue }: { target: Date | null; done: boolean; doneCount: number; total: number; venue: string }) {
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
      body = <span className="text-sm font-semibold text-amber-300">🔴 It&apos;s workshop day — head to {venue}!</span>
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
    body = <span className="text-sm font-semibold text-amber-200/90">⏳ Finish all {total} steps before the workshop</span>
  }

  return (
    <div className="sticky top-0 z-40 border-b border-white/[0.06]"
      style={{ background: 'rgba(20,10,6,0.72)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)' }}>
      <div className="max-w-lg mx-auto px-4 h-12 flex items-center justify-between gap-3">
        {body}
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
          style={{ background: done ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)', color: done ? '#6ee7b7' : '#fcd34d' }}>
          {doneCount}/{total}
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

function StepCard({ n, title, subtitle, done, onToggle, critical, locked, children }: {
  n: string; title: string; subtitle: string; done: boolean; onToggle: () => void; critical?: boolean; locked?: boolean; children: React.ReactNode
}) {
  return (
    <Glass className={`p-4 transition-all ${locked ? 'opacity-50' : ''} ${done && !locked ? 'border-amber-500/30' : critical && !locked ? 'border-red-500/25' : ''}`}
      style={done && !locked ? { background: 'rgba(245,158,11,0.05)' } : undefined}>
      <div className="flex items-start gap-3.5">
        <button onClick={locked ? undefined : onToggle} disabled={locked} aria-label={locked ? 'Locked' : done ? 'Mark incomplete' : 'Mark complete'}
          className={`mt-0.5 w-8 h-8 shrink-0 rounded-xl border-2 flex items-center justify-center transition-all
            ${locked ? 'border-zinc-700 text-zinc-600 cursor-not-allowed' : done ? 'border-transparent text-black active:scale-90' : 'border-zinc-600 text-transparent active:border-amber-500 active:scale-90'}`}
          style={done && !locked ? { background: 'linear-gradient(135deg, #f59e0b, #D4684A)' } : undefined}>
          {locked
            ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
            : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-[11px] font-bold ${locked ? 'text-zinc-500' : critical ? 'text-red-400/90' : 'text-amber-400/80'}`}>STEP {n}</span>
            {done && !locked && <span className="text-[10px] text-amber-400">✓ done</span>}
            {locked && <span className="text-[10px] text-zinc-500">🔒 locked</span>}
          </div>
          <div className={`text-[17px] font-bold leading-tight ${done && !locked ? 'text-zinc-300' : 'text-white'}`}>{title}</div>
          <div className="text-xs text-zinc-500 mb-3">{subtitle}</div>
          {locked
            ? <div className="text-[12px] text-zinc-600">Finish the step above to unlock this one.</div>
            : children}
        </div>
      </div>
    </Glass>
  )
}

function Loom({ id, label }: { id: string; label: string }) {
  return (
    <div className="w-full mb-3">
      <div className="relative w-full rounded-2xl overflow-hidden border border-white/10" style={{ paddingBottom: '64.98%' }}>
        <iframe
          src={`https://www.loom.com/embed/${id}`}
          title={label} loading="lazy" allowFullScreen
          className="absolute inset-0 w-full h-full" />
      </div>
      <div className="text-xs text-zinc-400 mt-2 font-medium">{label}</div>
    </div>
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
