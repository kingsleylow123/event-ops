'use client'
import { useState } from 'react'

type FormState = {
  full_name: string
  phone: string
  email: string
  instagram_url: string
  github_username: string
  telegram_username: string
  telegram_id: string
  bank_account_name: string
  bank_name: string
  bank_account_number: string
  company_name: string
  portfolio_url: string
}

const EMPTY: FormState = {
  full_name: '', phone: '', email: '', instagram_url: '',
  github_username: '', telegram_username: '', telegram_id: '',
  bank_account_name: '', bank_name: '', bank_account_number: '',
  company_name: '', portfolio_url: '',
}

export default function TeamSurveyPage() {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/team-survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? 'Something went wrong. Please try again.')
        setSubmitting(false)
        return
      }
      setSubmitted(true)
      setSubmitting(false)
    } catch {
      setError('Network error. Please try again.')
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] px-4">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4">🙏</div>
          <h2 className="text-2xl font-bold text-white mb-2">Thanks — got your details</h2>
          <p className="text-zinc-400 text-sm">
            We'll be in touch on Telegram. You can close this tab now.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] py-10 px-4">
      <div className="max-w-xl mx-auto">
        <div className="mb-8 text-center">
          <p className="text-[11px] uppercase tracking-[0.2em] text-amber-400 font-semibold mb-2">
            Claude Malaysia · Team onboarding
          </p>
          <h1 className="text-3xl font-extrabold text-white">Team member details</h1>
          <p className="text-sm text-zinc-400 mt-2">
            Fill this in so we have everything we need for payroll, comms and onboarding.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 sm:p-8 space-y-5"
        >
          <Field label="Full name" required>
            <Input value={form.full_name} onChange={v => set('full_name', v)} placeholder="Your full name" required />
          </Field>

          <Row>
            <Field label="Phone" required>
              <Input type="tel" value={form.phone} onChange={v => set('phone', v)} placeholder="+60 12 345 6789" required />
            </Field>
            <Field label="Email" required>
              <Input type="email" value={form.email} onChange={v => set('email', v)} placeholder="you@example.com" required />
            </Field>
          </Row>

          <Field label="Instagram URL" required>
            <Input type="url" value={form.instagram_url} onChange={v => set('instagram_url', v)} placeholder="https://instagram.com/yourhandle" required />
          </Field>

          <Row>
            <Field label="GitHub username" required>
              <Input value={form.github_username} onChange={v => set('github_username', v)} placeholder="octocat" required />
            </Field>
            <Field label="Telegram username" required>
              <Input value={form.telegram_username} onChange={v => set('telegram_username', v)} placeholder="@yourhandle" required />
            </Field>
          </Row>

          <Field
            label="Telegram ID number"
            required
            hint={
              <>
                Open{' '}
                <a
                  href="https://t.me/userinfobot"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-400 underline"
                >
                  @userinfobot
                </a>{' '}
                in Telegram and send any message — it replies with your numeric ID.
              </>
            }
          >
            <Input value={form.telegram_id} onChange={v => set('telegram_id', v)} placeholder="123456789" required />
          </Field>

          <Section title="Bank account">
            <Field label="Account holder name" required>
              <Input value={form.bank_account_name} onChange={v => set('bank_account_name', v)} placeholder="Name as per bank record" required />
            </Field>
            <Row>
              <Field label="Bank" required>
                <Input value={form.bank_name} onChange={v => set('bank_name', v)} placeholder="Maybank, CIMB, etc." required />
              </Field>
              <Field label="Account number" required>
                <Input value={form.bank_account_number} onChange={v => set('bank_account_number', v)} placeholder="1234567890" required />
              </Field>
            </Row>
          </Section>

          <Section title="Optional">
            <Field label="Company name">
              <Input value={form.company_name} onChange={v => set('company_name', v)} placeholder="If you're invoicing as a company" />
            </Field>
            <Field label="Portfolio URL">
              <Input type="url" value={form.portfolio_url} onChange={v => set('portfolio_url', v)} placeholder="https://yourportfolio.com" />
            </Field>
          </Section>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl py-3 font-bold text-sm text-black transition disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #f59e0b, #D4684A)' }}
          >
            {submitting ? 'Submitting…' : 'Submit details'}
          </button>
        </form>
      </div>
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-zinc-800 pt-5 space-y-4">
      <p className="text-xs uppercase tracking-widest text-zinc-500 font-semibold">{title}</p>
      {children}
    </div>
  )
}

function Field({
  label, required, hint, children,
}: {
  label: string
  required?: boolean
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium text-zinc-200">
        {label}
        {required && <span className="text-amber-400"> *</span>}
      </span>
      {children}
      {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
    </label>
  )
}

function Input({
  value, onChange, placeholder, type = 'text', required,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  required?: boolean
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50"
    />
  )
}
