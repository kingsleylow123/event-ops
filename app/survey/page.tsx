'use client'
import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

const INDUSTRIES = [
  'Sales & Business Development',
  'Marketing & Advertising',
  'Finance & Accounting',
  'Operations & Logistics',
  'Human Resources',
  'Technology & IT',
  'Education & Training',
  'Healthcare & Medical',
  'Legal & Compliance',
  'Real Estate & Property',
  'Retail & E-commerce',
  'F&B & Hospitality',
  'Construction & Engineering',
  'Manufacturing',
  'Consulting & Professional Services',
  'Media & Content Creation',
  'Insurance',
  'Other',
]

const COMPANY_SIZES = [
  'Solo / Freelance',
  '2–10 people',
  '11–50 people',
  '51–200 people',
  '200+ people',
]

function SurveyForm() {
  const searchParams = useSearchParams()
  const eventId = searchParams.get('event') || ''
  const attendeeId = searchParams.get('a') || ''
  const prefillName = searchParams.get('name') || ''

  const [step, setStep] = useState(1)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [eventName, setEventName] = useState('')
  const [form, setForm] = useState({
    name: prefillName,
    phone: '',
    industry: '',
    company_size: '',
    biggest_challenge: '',
    workshop_goal: '',
  })

  const TOTAL_STEPS = 6

  useEffect(() => {
    if (localStorage.getItem(`survey_done_${eventId}_${attendeeId}`)) {
      setSubmitted(true)
    }
    if (eventId) {
      fetch(`/api/events`)
        .then(r => r.json())
        .then((events: { id: string; name: string }[]) => {
          const ev = events.find(e => e.id === eventId)
          if (ev) setEventName(ev.name)
        })
        .catch(() => {})
    }
  }, [eventId, attendeeId])

  function set(key: keyof typeof form, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function next() { setStep(s => s + 1); window.scrollTo(0, 0) }
  function back() { setStep(s => Math.max(1, s - 1)); window.scrollTo(0, 0) }

  async function submit() {
    setSubmitting(true)
    const res = await fetch('/api/survey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, event_id: eventId, attendee_id: attendeeId || null }),
    })
    if (res.ok) {
      localStorage.setItem(`survey_done_${eventId}_${attendeeId}`, '1')
      setSubmitted(true)
    } else {
      alert('Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  if (!eventId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
        <p className="text-zinc-500">Invalid survey link.</p>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] px-4">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4">🎉</div>
          <h2 className="text-2xl font-bold text-white mb-2">You're all set!</h2>
          <p className="text-zinc-400 text-sm">Thanks for filling this in. We'll tailor the workshop based on your answers. See you there!</p>
        </div>
      </div>
    )
  }

  const progress = Math.round((step / TOTAL_STEPS) * 100)
  const canNext: Record<number, boolean> = {
    1: form.name.trim().length > 0,
    2: form.phone.trim().length > 0,
    3: form.industry.length > 0,
    4: form.company_size.length > 0,
    5: form.biggest_challenge.trim().length > 0,
    6: form.workshop_goal.trim().length > 0,
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0a] text-white">
      {/* Header */}
      <div className="border-b border-zinc-800 bg-[#111] px-4 py-3 sticky top-0 z-10">
        <div className="max-w-lg mx-auto">
          <p className="text-xs text-zinc-500 mb-1">{eventName || 'Pre-Event Survey'}</p>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-amber-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-xs text-zinc-500 shrink-0">{step}/{TOTAL_STEPS}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg">

          {/* Q1: Name */}
          {step === 1 && (
            <Q title="What's your name?">
              <input
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="Full name"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-amber-500"
                autoFocus
              />
              <Nav canNext={canNext[1]} onNext={next} showBack={false} onBack={back} />
            </Q>
          )}

          {/* Q2: Phone */}
          {step === 2 && (
            <Q title="Your WhatsApp number?" subtitle="We'll send event details and updates here.">
              <input
                value={form.phone}
                onChange={e => set('phone', e.target.value)}
                placeholder="e.g. 0123456789"
                type="tel"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-amber-500"
                autoFocus
              />
              <Nav canNext={canNext[2]} onNext={next} showBack onBack={back} />
            </Q>
          )}

          {/* Q3: Industry */}
          {step === 3 && (
            <Q title="What industry are you in?">
              <div className="grid grid-cols-1 gap-2 max-h-96 overflow-y-auto pr-1">
                {INDUSTRIES.map(ind => (
                  <button key={ind} onClick={() => set('industry', ind)}
                    className="w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-all border"
                    style={{
                      background: form.industry === ind ? '#f59e0b' : '#111',
                      color: form.industry === ind ? '#000' : '#fff',
                      borderColor: form.industry === ind ? '#f59e0b' : '#3f3f46',
                    }}>
                    {ind}
                  </button>
                ))}
              </div>
              <Nav canNext={canNext[3]} onNext={next} showBack onBack={back} />
            </Q>
          )}

          {/* Q4: Company size */}
          {step === 4 && (
            <Q title="How big is your team?">
              <div className="flex flex-col gap-2">
                {COMPANY_SIZES.map(size => (
                  <button key={size} onClick={() => set('company_size', size)}
                    className="w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-all border"
                    style={{
                      background: form.company_size === size ? '#f59e0b' : '#111',
                      color: form.company_size === size ? '#000' : '#fff',
                      borderColor: form.company_size === size ? '#f59e0b' : '#3f3f46',
                    }}>
                    {size}
                  </button>
                ))}
              </div>
              <Nav canNext={canNext[4]} onNext={next} showBack onBack={back} />
            </Q>
          )}

          {/* Q5: Biggest challenge */}
          {step === 5 && (
            <Q title="What's your biggest challenge right now?" subtitle="Be specific — this helps us make the workshop relevant to you.">
              <textarea
                value={form.biggest_challenge}
                onChange={e => set('biggest_challenge', e.target.value)}
                placeholder="e.g. I spend 3 hours a day on manual reports and can't keep up with follow-ups..."
                rows={5}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-amber-500 resize-none"
                autoFocus
              />
              <Nav canNext={canNext[5]} onNext={next} showBack onBack={back} />
            </Q>
          )}

          {/* Q6: Workshop goal */}
          {step === 6 && (
            <Q title="What would make this workshop a 10/10 for you?" subtitle="Tell us what outcome would make it worth your time.">
              <textarea
                value={form.workshop_goal}
                onChange={e => set('workshop_goal', e.target.value)}
                placeholder="e.g. Walk away with one AI workflow I can use in my business this week..."
                rows={5}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-amber-500 resize-none"
                autoFocus
              />
              <div className="mt-6 flex justify-between items-center">
                <button onClick={back}
                  className="text-sm px-4 py-2 rounded-lg text-zinc-400 bg-zinc-900 border border-zinc-700">
                  ← Back
                </button>
                <button
                  onClick={submit}
                  disabled={!canNext[6] || submitting}
                  className="px-8 py-3 rounded-xl font-semibold text-sm transition-all bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-black">
                  {submitting ? 'Submitting...' : 'Submit →'}
                </button>
              </div>
            </Q>
          )}

        </div>
      </div>
    </div>
  )
}

function Q({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2 leading-snug">{title}</h1>
      {subtitle && <p className="text-sm text-zinc-400 mb-6">{subtitle}</p>}
      {!subtitle && <div className="mb-6" />}
      {children}
    </div>
  )
}

function Nav({ canNext, onNext, showBack, onBack }: { canNext: boolean; onNext: () => void; showBack: boolean; onBack: () => void }) {
  return (
    <div className={`mt-8 flex ${showBack ? 'justify-between' : 'justify-end'} items-center`}>
      {showBack && (
        <button onClick={onBack} className="text-sm px-4 py-2 rounded-lg text-zinc-400 bg-zinc-900 border border-zinc-700">
          ← Back
        </button>
      )}
      <button onClick={onNext} disabled={!canNext}
        className="px-8 py-3 rounded-xl font-semibold text-sm bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-black">
        Next →
      </button>
    </div>
  )
}

export default function SurveyPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
        <div className="text-zinc-500">Loading...</div>
      </div>
    }>
      <SurveyForm />
    </Suspense>
  )
}
