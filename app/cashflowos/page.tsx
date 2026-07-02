import CashflowForm from './CashflowForm'

export const dynamic = 'force-dynamic'

// Public, 2-step abandon-cart checkout for the CashflowOS 2-Day Challenge.
// Step 1 (here) captures name/email/WhatsApp BEFORE payment so a drop-off can be
// chased; step 2 is Stripe. Deliberately minimal: title only — no date, no price
// (price reveal + urgency live on the Stripe step; it stays server-pinned there,
// the client never sets it).
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-[#111] p-6 shadow-xl">{children}</div>
    </div>
  )
}

export default function CashflowOsPage() {
  return (
    <Shell>
      <div className="mb-5 flex gap-1.5" aria-label="Step 1 of 2">
        <div className="h-1.5 flex-1 rounded-full bg-amber-500" />
        <div className="h-1.5 flex-1 rounded-full bg-zinc-800" />
      </div>
      <div className="mb-5">
        <p className="text-xs uppercase tracking-wide text-amber-400">Step 1 of 2</p>
        <h1 className="mt-1 text-2xl font-bold text-white">CashFlowOS™ 2-Day Challenge</h1>
      </div>
      <CashflowForm />
      <p className="mt-4 text-center text-xs text-zinc-500">Enter your details, then complete secure payment on the next step.</p>
    </Shell>
  )
}
