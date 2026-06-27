import { supabaseAdmin } from '@/lib/supabase-admin'
import { normalizeTier, tierOptions, PRICING_TIER_LABELS } from '@/lib/registration'
import RegisterForm from './RegisterForm'

export const dynamic = 'force-dynamic'

// Public, EventOps-generated registration. `?event=<id>` is the only routing
// input — the payment carries that id all the way to the webhook, so a ticket
// always lands on the EXACT event even with two dates selling at once.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-[#111] p-6 shadow-xl">{children}</div>
    </div>
  )
}

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: eventId } = await searchParams

  if (!eventId) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-white">Registration link incomplete</h1>
        <p className="mt-2 text-sm text-zinc-400">This link is missing its event. Please use the exact link you were given.</p>
      </Shell>
    )
  }

  const { data: ev } = await supabaseAdmin
    .from('events').select('id, name, date, pricing_tier').eq('id', eventId).maybeSingle()

  if (!ev) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-white">Event not found</h1>
        <p className="mt-2 text-sm text-zinc-400">This registration link is no longer valid.</p>
      </Shell>
    )
  }

  const closed = !!ev.date && new Date(ev.date as string).getTime() < Date.now() - 12 * 3600_000
  if (closed) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-white">Registration closed</h1>
        <p className="mt-2 text-sm text-zinc-400">{String(ev.name)} has already taken place. Follow @claudemalaysiaofficial for the next date.</p>
      </Shell>
    )
  }

  const tier = normalizeTier(ev.pricing_tier)
  const options = tierOptions(tier)
  const dateStr = ev.date
    ? new Date(ev.date as string).toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long' })
    : null

  return (
    <Shell>
      <div className="mb-5">
        <p className="text-xs uppercase tracking-wide text-amber-400">{PRICING_TIER_LABELS[tier]} ticket</p>
        <h1 className="mt-1 text-xl font-bold text-white">{String(ev.name)}</h1>
        {dateStr && <p className="mt-1 text-sm text-zinc-400">📅 {dateStr}</p>}
      </div>
      <RegisterForm eventId={ev.id as string} options={options} />
    </Shell>
  )
}
