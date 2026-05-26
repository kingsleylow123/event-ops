import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { Event, Attendee } from '@/lib/supabase'

function fmtRM(n: number): string {
  return `RM ${n.toLocaleString('en-MY', { maximumFractionDigits: 0 })}`
}

function fmtDate(date: string | null): string {
  if (!date) return ''
  return new Date(date).toLocaleDateString('en-MY', { dateStyle: 'medium' })
}

interface EventRevenue {
  event: Event
  paidCount: number
  totalPaid: number
  stripeCount: number
  stripeRevenue: number
  bankCount: number
  bankRevenue: number
  freeCount: number
  pendingCount: number
  pendingRevenue: number
}

export default async function RevenuePage() {
  const supabase = await createSupabaseServerClient()
  const { data: events } = await supabase.from('events').select('*').order('date', { ascending: false })
  const { data: attendees } = await supabase.from('attendees').select('*')

  const evList: Event[] = events ?? []
  const atts: Attendee[] = attendees ?? []

  const byEvent: EventRevenue[] = evList.map(ev => {
    const rows = atts.filter(a => a.event_id === ev.id)
    const paid = rows.filter(a => a.payment_status === 'paid')
    const stripe = paid.filter(a => a.payment_method === 'stripe')
    const bank = paid.filter(a => a.payment_method === 'bank_transfer')
    const pending = rows.filter(a => a.payment_status === 'pending')
    const free = rows.filter(a => a.payment_status === 'free')
    const sum = (arr: Attendee[]) => arr.reduce((s, a) => s + (Number(a.payment_amount) || 0), 0)
    return {
      event: ev,
      paidCount: paid.length,
      totalPaid: sum(paid),
      stripeCount: stripe.length,
      stripeRevenue: sum(stripe),
      bankCount: bank.length,
      bankRevenue: sum(bank),
      freeCount: free.length,
      pendingCount: pending.length,
      pendingRevenue: sum(pending),
    }
  })

  const grandTotal = byEvent.reduce((s, r) => s + r.totalPaid, 0)
  const grandStripe = byEvent.reduce((s, r) => s + r.stripeRevenue, 0)
  const grandBank = byEvent.reduce((s, r) => s + r.bankRevenue, 0)
  const grandPaidCount = byEvent.reduce((s, r) => s + r.paidCount, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">Revenue</h1>
        <p className="text-sm text-zinc-500">Gross paid revenue per event · before Stripe fees</p>
      </div>

      {/* Grand total card */}
      <div className="bg-[#111] border border-amber-500/40 rounded-xl p-5">
        <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Total revenue across all events</p>
        <p className="text-3xl font-bold text-amber-400">{fmtRM(grandTotal)}</p>
        <p className="text-sm text-zinc-400 mt-1">{grandPaidCount} paid attendees · Stripe {fmtRM(grandStripe)} · Bank transfer {fmtRM(grandBank)}</p>
      </div>

      {/* Per-event breakdown */}
      <div className="space-y-4">
        {byEvent.length === 0 && (
          <div className="text-center text-zinc-500 py-20">No events yet.</div>
        )}
        {byEvent.map(r => {
          const stripeShare = r.totalPaid > 0 ? Math.round((r.stripeRevenue / r.totalPaid) * 100) : 0
          const bankShare = r.totalPaid > 0 ? Math.round((r.bankRevenue / r.totalPaid) * 100) : 0
          return (
            <div key={r.event.id} className={`bg-[#111] border rounded-xl p-5 ${r.event.is_active ? 'border-amber-500/50' : 'border-zinc-800'}`}>
              <div className="flex items-baseline justify-between gap-4 flex-wrap mb-4">
                <div>
                  <h2 className="font-semibold text-lg">{r.event.name}</h2>
                  {r.event.date && (
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {fmtDate(r.event.date)}
                      {r.event.is_active && <span className="ml-2 text-amber-400">· Active</span>}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs text-zinc-500">Total paid</p>
                  <p className="text-2xl font-bold text-amber-400">{fmtRM(r.totalPaid)}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{r.paidCount} attendees</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs text-zinc-500 uppercase tracking-wider">💳 Stripe</p>
                    <span className="text-xs text-zinc-500">{stripeShare}%</span>
                  </div>
                  <p className="text-lg font-semibold text-white">{fmtRM(r.stripeRevenue)}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{r.stripeCount} payment{r.stripeCount === 1 ? '' : 's'}</p>
                </div>
                <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs text-zinc-500 uppercase tracking-wider">🏦 Bank Transfer</p>
                    <span className="text-xs text-zinc-500">{bankShare}%</span>
                  </div>
                  <p className="text-lg font-semibold text-white">{fmtRM(r.bankRevenue)}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{r.bankCount} payment{r.bankCount === 1 ? '' : 's'}</p>
                </div>
              </div>

              {(r.pendingCount > 0 || r.freeCount > 0) && (
                <div className="mt-3 pt-3 border-t border-zinc-800 flex gap-6 text-xs text-zinc-500">
                  {r.pendingCount > 0 && (
                    <span>⏳ {r.pendingCount} pending · {fmtRM(r.pendingRevenue)}</span>
                  )}
                  {r.freeCount > 0 && (
                    <span>🎟️ {r.freeCount} free</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
