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
  '2–5 people',
  '6–10 people',
  '11–50 people',
  '51–200 people',
  '200+ people',
]

// Phone: strip +, spaces, dashes, parens → require 8–15 digits.
// Accepts MY (0123456789), SG (+6591162866), UK (+44 7868872241); rejects '123', 'abc'.
function isValidPhone(s: string): boolean {
  const digits = s.replace(/[\s+()-]/g, '')
  return /^\d{8,15}$/.test(digits)
}

// URL/domain only (not bare @handle). Accepts instagram.com/you, https://yourco.com.
function isValidUrl(s: string): boolean {
  return /^(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s.trim())
}

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
    social_link: '',
  })

  const TOTAL_STEPS = 7

  useEffect(() => {
    if (localStorage.getItem(`survey_done_${eventId}_${attendeeId}`)) {
      setSubmitted(true)
    }
    if (eventId) {
      fetch(`/api/survey?event_id=${eventId}&name=1`)
        .then(r => r.json())
        .then((d: { name?: string }) => { if (d?.name) setEventName(d.name) })
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

          <a
            href="https://chat.whatsapp.com/GSONh9iwgvPIYDV16fOALM?s=cl&p=i&ilr=1&amv=1"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-8 flex items-center justify-center gap-2 w-full px-4 py-3.5 rounded-xl font-bold text-sm text-white"
            style={{ background: '#25D366' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.945C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 018.413 3.488 11.824 11.824 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.519 5.26l-.999 3.648 3.97-1.042 .969 .335zm5.474-7.518c-.149-.248-.546-.397-1.142-.695-.595-.298-3.522-1.738-4.067-1.937-.546-.198-.943-.298-1.34.298-.396.595-1.537 1.937-1.884 2.334-.347.397-.694.446-1.29.149-.595-.298-2.512-.926-4.785-2.953-1.768-1.578-2.962-3.528-3.31-4.123-.347-.595-.037-.916.261-1.213.268-.267.595-.694.892-1.042.297-.347.396-.595.595-.992.198-.396.099-.744-.05-1.042-.149-.298-1.34-3.23-1.835-4.42-.484-1.162-.976-1.004-1.34-1.022l-1.142-.02c-.397 0-1.04.149-1.585.744-.546.595-2.083 2.034-2.083 4.966 0 2.931 2.133 5.762 2.43 6.16.297.397 4.197 6.407 10.166 8.984 1.42.612 2.527.979 3.391 1.253 1.425.452 2.722.389 3.747.236 1.143-.171 3.522-1.439 4.018-2.829.495-1.389 .495-2.579 .347-2.829z"/>
            </svg>
            Join the Claude Malaysia WhatsApp →
          </a>

          <div className="mt-4 bg-[#111] border border-zinc-800 rounded-2xl p-5">
            <p className="text-sm text-white font-medium mb-1">One more thing 👇</p>
            <p className="text-xs text-zinc-400 mb-4">Follow <span className="text-amber-400">@claudemalaysiaofficial</span> and tag us in your event photos!</p>
            <a
              href="https://www.instagram.com/claudemalaysiaofficial/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl font-semibold text-sm text-white"
              style={{ background: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
              </svg>
              Follow @claudemalaysiaofficial
            </a>
          </div>
        </div>
      </div>
    )
  }

  const progress = Math.round((step / TOTAL_STEPS) * 100)
  const canNext: Record<number, boolean> = {
    1: form.name.trim().length > 0,
    2: isValidPhone(form.phone),
    3: form.industry.length > 0,
    4: form.company_size.length > 0,
    5: form.biggest_challenge.trim().length > 0,
    6: form.workshop_goal.trim().length > 0,
    7: isValidUrl(form.social_link),
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
                placeholder="e.g. 0123456789 or +65 9116 2866"
                type="tel"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-amber-500"
                autoFocus
              />
              {form.phone.trim().length > 0 && !isValidPhone(form.phone) && (
                <p className="text-xs text-red-400 mt-2">Please enter a valid phone number (digits only, with country code if outside Malaysia).</p>
              )}
              <Nav canNext={canNext[2]} onNext={next} showBack onBack={back} />
            </Q>
          )}

          {/* Q3: Industry */}
          {step === 3 && (
            <Q title="What industry are you in?">
              <input
                type="text"
                value={form.industry}
                onChange={e => set('industry', e.target.value)}
                placeholder="e.g. Marketing, Finance, Tech..."
                autoFocus
                className="w-full px-4 py-3 rounded-xl text-sm border outline-none"
                style={{ background: '#111', color: '#fff', borderColor: form.industry ? '#f59e0b' : '#3f3f46' }}
              />
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
              <Nav canNext={canNext[6]} onNext={next} showBack onBack={back} />
            </Q>
          )}

          {/* Q7: Social / Website */}
          {step === 7 && (
            <Q title="Your social media or company website" subtitle="Share your Instagram, LinkedIn, or website link so we can stay connected.">
              <input
                type="text"
                value={form.social_link}
                onChange={e => set('social_link', e.target.value)}
                placeholder="e.g. instagram.com/yourhandle or yourcompany.com"
                autoFocus
                className="w-full px-4 py-3 rounded-xl text-sm border outline-none"
                style={{ background: '#111', color: '#fff', borderColor: form.social_link ? '#f59e0b' : '#3f3f46' }}
              />
              {form.social_link.trim().length > 0 && !isValidUrl(form.social_link) && (
                <p className="text-xs text-red-400 mt-2">Please enter a valid link (e.g. instagram.com/you or yourcompany.com).</p>
              )}
              <div className="mt-6 flex justify-between items-center">
                <button onClick={back}
                  className="text-sm px-4 py-2 rounded-lg text-zinc-400 bg-zinc-900 border border-zinc-700">
                  ← Back
                </button>
                <button
                  onClick={submit}
                  disabled={!canNext[7] || submitting}
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
