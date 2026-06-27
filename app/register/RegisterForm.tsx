'use client'
import { useState } from 'react'
import type { TierOption } from '@/lib/registration'

// Client half of /register: pick General vs VIP, then POST to the server-pinned
// checkout endpoint and bounce to Stripe. No price math here — the server decides
// what you pay from the event's live tier.
export default function RegisterForm({ eventId, options }: { eventId: string; options: TierOption[] }) {
  const [selected, setSelected] = useState<string>(options[0]?.ticket_type ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function checkout() {
    if (!selected) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId, ticket_type: selected }),
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

  return (
    <div className="space-y-3">
      {options.map(o => (
        <button
          key={o.ticket_type}
          type="button"
          onClick={() => setSelected(o.ticket_type)}
          className={`w-full flex items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
            selected === o.ticket_type ? 'border-amber-500 bg-amber-500/10' : 'border-zinc-700 bg-zinc-900 hover:border-zinc-500'
          }`}
        >
          <span>
            <span className="block font-semibold text-white">{o.variant === 'vip' ? '⭐ VIP' : 'General'}</span>
            <span className="block text-xs text-zinc-400">{o.label}</span>
          </span>
          <span className="font-bold text-amber-400 whitespace-nowrap">RM {o.price}</span>
        </button>
      ))}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        onClick={checkout}
        disabled={loading || !selected}
        className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold rounded-xl py-3 transition"
      >
        {loading ? 'Redirecting to payment…' : 'Register & Pay'}
      </button>
      <p className="text-center text-xs text-zinc-500">Secure checkout via Stripe · name, email &amp; phone collected at payment.</p>
    </div>
  )
}
