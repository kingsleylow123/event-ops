export const dynamic = 'force-dynamic'

// Stripe redirects here after a paid checkout. The attendee record + WhatsApp
// prep nudge are created by the webhook (checkout.session.completed), so this
// page is purely a friendly confirmation.
export default function RegisterSuccess() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-[#111] p-6 text-center shadow-xl">
        <div className="text-4xl">🎉</div>
        <h1 className="mt-3 text-xl font-bold text-white">You&apos;re in!</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Payment received. We&apos;ll send your prep steps on WhatsApp shortly — do them early so the class doesn&apos;t wait on downloads. See you there! ☕
        </p>
      </div>
    </div>
  )
}
