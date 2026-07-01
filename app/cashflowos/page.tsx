import { supabaseAdmin } from '@/lib/supabase-admin'
import CashflowForm from './CashflowForm'

export const dynamic = 'force-dynamic'

const EVENT_ID = process.env.CASHFLOWOS_EVENT_ID || '0cef06b6-26b5-42b3-a8d1-f0547e63e5be'
const PRICE_RM = Number(process.env.CASHFLOWOS_PRICE_RM || 2499)

// Public, 2-step abandon-cart checkout for the Cashflow OS 2-Day Challenge.
// Step 1 (here) captures name/email/WhatsApp BEFORE payment so a drop-off can be
// chased; step 2 is Stripe. Priced server-side (RM2,499) — the client never sets it.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-[#111] p-6 shadow-xl">{children}</div>
    </div>
  )
}

export default async function CashflowOsPage() {
  const { data: ev } = await supabaseAdmin
    .from('events').select('id, name, date').eq('id', EVENT_ID).maybeSingle()

  const name = (ev?.name as string) || 'Cashflow OS — 2-Day Challenge'
  const dateStr = ev?.date
    ? new Date(ev.date as string).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' })
    : '28–29 July'

  return (
    <Shell>
      <div className="mb-5 flex gap-1.5" aria-label="Step 1 of 2">
        <div className="h-1.5 flex-1 rounded-full bg-amber-500" />
        <div className="h-1.5 flex-1 rounded-full bg-zinc-800" />
      </div>
      <div className="mb-5">
        <p className="text-xs uppercase tracking-wide text-amber-400">2-Day Challenge · Step 1 of 2</p>
        <h1 className="mt-1 text-xl font-bold text-white">{name}</h1>
        <p className="mt-1 text-sm text-zinc-400">📅 {dateStr}</p>
        <p className="mt-3 flex items-baseline gap-2">
          <span className="text-3xl font-extrabold text-white">RM {PRICE_RM.toLocaleString('en-MY')}</span>
          <span className="text-xs text-zinc-500">one-time · secure Stripe checkout</span>
        </p>
      </div>
      <CashflowForm />
      <p className="mt-4 text-center text-xs text-zinc-500">Enter your details, then complete secure payment on the next step.</p>
    </Shell>
  )
}
