'use client'
import { useState } from 'react'

// GLCC post-purchase batch picker. Linked from the Stripe thank-you page:
// buyer confirms name/email/WhatsApp, picks their challenge weekend, and gets
// the matching WhatsApp group invite. Admins get a Telegram ping per submission.

const BATCH_OPTIONS = [
  { value: '20-21 June', title: '20–21 June', sub: 'Batch 1 · 2 full days' },
  { value: '28-29 July', title: '28–29 July', sub: 'Batch 2 · 2 full days' },
]

function isValidPhone(s: string): boolean {
  const digits = s.replace(/[\s+()-]/g, '')
  return /^\d{8,15}$/.test(digits)
}
function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

export default function GlccBatchPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [batch, setBatch] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [waLink, setWaLink] = useState('')

  const nameOk = name.trim().length >= 2
  const emailOk = isValidEmail(email)
  const phoneOk = isValidPhone(phone)
  const canSubmit = nameOk && emailOk && phoneOk && !!batch && !submitting

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/glcc-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, batch }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Something went wrong — please try again')
        return
      }
      setWaLink(json.whatsapp)
    } catch {
      setError('Network error — please try again')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Success screen ─────────────────────────────────────────────────────────
  if (waLink) {
    return (
      <main className="min-h-screen bg-[#0a0a0a] text-zinc-100 flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-md text-center">
          <div className="text-5xl mb-5">🎉</div>
          <h1 className="text-2xl font-bold mb-2">You&apos;re locked in!</h1>
          <p className="text-zinc-400 mb-1">Go Live Claude Challenge</p>
          <p className="text-amber-400 font-semibold text-lg mb-8">{batch}</p>

          <a
            href={waLink}
            className="block w-full rounded-xl bg-[#25D366] text-black font-bold text-lg py-4 px-6 hover:opacity-90 transition-opacity"
          >
            💬 Join the {batch} WhatsApp group
          </a>

          <p className="text-zinc-500 text-sm mt-6">
            Tap the button to join your batch&apos;s group — all challenge info,
            prep steps and reminders land there. See you inside! 🚀
          </p>
        </div>
      </main>
    )
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-[#0a0a0a] text-zinc-100 flex items-center justify-center px-5 py-12">
      <div className="w-full max-w-md">
        <p className="text-amber-500 text-xs font-mono uppercase tracking-widest mb-2">
          Payment confirmed ✓
        </p>
        <h1 className="text-2xl font-bold mb-1">Pick your challenge dates</h1>
        <p className="text-zinc-400 text-sm mb-8">
          Go Live Claude Challenge — 2 full days, live. Choose the weekend that
          works for you and we&apos;ll drop you into that batch&apos;s WhatsApp group.
        </p>

        <label className="block mb-4">
          <span className="block text-sm text-zinc-300 mb-1.5">Full name</span>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Your name"
            className="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/60"
          />
        </label>

        <label className="block mb-4">
          <span className="block text-sm text-zinc-300 mb-1.5">Email <span className="text-zinc-500">(the one you paid with)</span></span>
          <input
            value={email}
            onChange={e => setEmail(e.target.value)}
            type="email"
            placeholder="you@email.com"
            className="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/60"
          />
          {email && !emailOk && <span className="block text-red-400 text-xs mt-1">That doesn&apos;t look like a valid email</span>}
        </label>

        <label className="block mb-6">
          <span className="block text-sm text-zinc-300 mb-1.5">WhatsApp number</span>
          <input
            value={phone}
            onChange={e => setPhone(e.target.value)}
            type="tel"
            placeholder="0123456789"
            className="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/60"
          />
          {phone && !phoneOk && <span className="block text-red-400 text-xs mt-1">Enter a valid number, e.g. 0123456789</span>}
        </label>

        <span className="block text-sm text-zinc-300 mb-2">Your dates</span>
        <div className="grid grid-cols-2 gap-3 mb-8">
          {BATCH_OPTIONS.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => setBatch(o.value)}
              className={`rounded-xl border px-4 py-4 text-left transition-colors ${
                batch === o.value
                  ? 'border-amber-500 bg-amber-500/10'
                  : 'border-white/10 bg-white/5 hover:border-white/25'
              }`}
            >
              <span className={`block font-bold ${batch === o.value ? 'text-amber-400' : 'text-zinc-100'}`}>{o.title}</span>
              <span className="block text-xs text-zinc-500 mt-1">{o.sub}</span>
            </button>
          ))}
        </div>

        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

        <button
          onClick={submit}
          disabled={!canSubmit}
          className="w-full rounded-xl bg-amber-500 text-black font-bold text-lg py-4 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-amber-400 transition-colors"
        >
          {submitting ? 'Saving…' : 'Get my WhatsApp group link →'}
        </button>

        <p className="text-zinc-600 text-xs mt-4 text-center">
          Picked the wrong dates? Just submit again with the same email.
        </p>
      </div>
    </main>
  )
}
