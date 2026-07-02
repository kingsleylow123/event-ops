'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'

// CashflowOS 2-step checkout, GHL/ClickFunnels style — both steps on OUR page.
// Step 1 captures name/email/WhatsApp (the abandon machine's fuel: every
// drop-off is a followable lead). Step 2 mounts Stripe EMBEDDED checkout under
// a real, ticking 10-minute seat-hold countdown. The countdown is honest: at
// 0:00 the payment element unmounts (the hold genuinely ends) and the buyer
// must tap through to mint a fresh session — urgency without ever hard-blocking
// a willing buyer. Falls back to the classic hosted redirect when the
// publishable key isn't configured.
const PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ''
const stripePromise = PK ? loadStripe(PK) : null

const HOLD_MINUTES = 10
const HOLD_KEY = 'cashflowos-hold-deadline'

function fmt(msLeft: number): string {
  const s = Math.max(0, Math.floor(msLeft / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function CashflowForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<1 | 2>(1)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [msLeft, setMsLeft] = useState(HOLD_MINUTES * 60_000)
  const [expired, setExpired] = useState(false)

  const mountRef = useRef<HTMLDivElement>(null)
  // Stripe's embedded checkout instance — destroyed on expiry/unmount.
  const checkoutRef = useRef<{ destroy: () => void } | null>(null)

  const destroyCheckout = useCallback(() => {
    try { checkoutRef.current?.destroy() } catch { /* already gone */ }
    checkoutRef.current = null
  }, [])

  // Mount the payment element only AFTER React has rendered the step-2 target
  // div (mounting inside the fetch handler would race the re-render).
  useEffect(() => {
    if (step !== 2 || expired || !clientSecret || !stripePromise) return
    let cancelled = false
    ;(async () => {
      try {
        const stripe = await stripePromise
        if (!stripe || cancelled) return
        destroyCheckout()
        const checkout = await stripe.createEmbeddedCheckoutPage({ clientSecret })
        if (cancelled || !mountRef.current) { try { checkout.destroy() } catch { /* noop */ } return }
        checkoutRef.current = checkout
        checkout.mount(mountRef.current)
      } catch {
        if (!cancelled) setError('Payment could not load. Please refresh and try again.')
      }
    })()
    return () => { cancelled = true }
  }, [step, expired, clientSecret, destroyCheckout])

  const startCheckout = useCallback(async (payload: { name: string; email: string; phone: string }) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/checkout/cashflowos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not start checkout. Try again.')
        setLoading(false)
        return
      }
      // Hosted fallback (publishable key not configured): classic redirect.
      if (data.url) {
        window.location.href = data.url as string
        return
      }
      if (!data.clientSecret || !stripePromise) {
        setError('Could not start checkout. Try again.')
        setLoading(false)
        return
      }
      // The hold is per-visitor, not per-session: a refresh resumes the SAME
      // deadline (sessionStorage), so the timer can't be reset by reloading.
      let deadline = Number(sessionStorage.getItem(HOLD_KEY) || 0)
      if (!deadline || deadline <= Date.now()) {
        deadline = Date.now() + HOLD_MINUTES * 60_000
        sessionStorage.setItem(HOLD_KEY, String(deadline))
      }
      setMsLeft(deadline - Date.now())
      setExpired(false)
      setClientSecret(data.clientSecret as string)
      setStep(2)
      setLoading(false)
    } catch {
      setError('Network error — please try again.')
      setLoading(false)
    }
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    // Fresh submit = fresh hold window.
    sessionStorage.removeItem(HOLD_KEY)
    await startCheckout({ name, email, phone })
  }

  // Countdown: ticks while step 2 is live; at 0:00 the hold genuinely ends —
  // payment element unmounts and the buyer must restart (new session).
  useEffect(() => {
    if (step !== 2 || expired) return
    const t = setInterval(() => {
      const deadline = Number(sessionStorage.getItem(HOLD_KEY) || 0)
      const left = deadline - Date.now()
      setMsLeft(left)
      if (left <= 0) {
        setExpired(true)
        destroyCheckout()
      }
    }, 250)
    return () => clearInterval(t)
  }, [step, expired, destroyCheckout])

  useEffect(() => () => destroyCheckout(), [destroyCheckout])

  async function restart() {
    sessionStorage.removeItem(HOLD_KEY)
    setExpired(false)
    await startCheckout({ name, email, phone })
  }

  const field = 'w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-white placeholder-zinc-500 outline-none focus:border-amber-500'
  const urgent = msLeft <= 2 * 60_000

  if (step === 2) {
    return (
      <div>
        {/* Sticky, honest seat-hold countdown */}
        <div className={`sticky top-0 z-10 -mx-6 mb-4 px-6 py-3 text-center ${expired ? 'bg-red-950/95' : urgent ? 'bg-red-900/95' : 'bg-amber-500/95'}`}>
          {expired ? (
            <p className="text-sm font-semibold text-red-100">Your seat hold has ended.</p>
          ) : (
            <p className={`text-sm font-semibold ${urgent ? 'text-red-100' : 'text-black'}`}>
              ⏳ Seat reserved for <span className="tabular-nums text-base font-extrabold">{fmt(msLeft)}</span> — released to the waitlist at 0:00
            </p>
          )}
        </div>

        {/* Offer restated at the money moment */}
        <div className="mb-4 flex items-baseline justify-between">
          <p className="font-semibold text-white">CashFlowOS™ 2-Day Challenge</p>
          <p className="text-lg font-extrabold text-white">RM 2,499</p>
        </div>

        {expired ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center">
            <p className="mb-4 text-sm text-zinc-300">Your reserved seat was released back to the waitlist — but if you're quick, you may still catch one.</p>
            <button onClick={restart} disabled={loading} className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold rounded-xl py-3 transition">
              {loading ? 'Checking…' : 'Check seat availability →'}
            </button>
          </div>
        ) : (
          // Stripe renders its own light-themed panel; the white wrap keeps the
          // seam clean inside the dark shell.
          <div className="overflow-hidden rounded-xl bg-white">
            <div ref={mountRef} />
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        <p className="mt-4 text-center text-xs text-zinc-500">🔒 Payment secured by Stripe · Visa / Mastercard / Apple Pay / Google Pay</p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input className={field} placeholder="Full name" value={name} onChange={e => setName(e.target.value)} required autoComplete="name" />
      <input className={field} type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
      <input className={field} type="tel" placeholder="WhatsApp number (e.g. 0123456789)" value={phone} onChange={e => setPhone(e.target.value)} required autoComplete="tel" />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button type="submit" disabled={loading} className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold rounded-xl py-3 transition">
        {loading ? 'Reserving your seat…' : 'Continue to payment →'}
      </button>
    </form>
  )
}
