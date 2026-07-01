'use client'
import { useState } from 'react'

// Step 1 of the CashflowOS 2-step checkout: capture name/email/WhatsApp, then POST
// to the server-pinned checkout route and bounce to Stripe (step 2). Capturing the
// contact BEFORE payment is the whole point — it lets GHL chase anyone who bails.
export default function CashflowForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/checkout/cashflowos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone }),
      })
      const data = await res.json()
      if (!res.ok || !data.url) {
        setError(data.error || 'Could not start checkout. Try again.')
        setLoading(false)
        return
      }
      window.location.href = data.url as string
    } catch {
      setError('Network error — please try again.')
      setLoading(false)
    }
  }

  const field = 'w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-white placeholder-zinc-500 outline-none focus:border-amber-500'

  return (
    <form onSubmit={submit} className="space-y-3">
      <input className={field} placeholder="Full name" value={name} onChange={e => setName(e.target.value)} required autoComplete="name" />
      <input className={field} type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
      <input className={field} type="tel" placeholder="WhatsApp number (e.g. 0123456789)" value={phone} onChange={e => setPhone(e.target.value)} required autoComplete="tel" />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button type="submit" disabled={loading} className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold rounded-xl py-3 transition">
        {loading ? 'Starting checkout…' : 'Continue to payment →'}
      </button>
    </form>
  )
}
