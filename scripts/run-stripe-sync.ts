/**
 * One-shot Stripe sync. Mirrors app/api/stripe/sync/route.ts but runs as
 * a Node script so we don't need an auth cookie.
 *
 *   cd event-ops
 *   set -a && source .env.local && set +a
 *   npx tsx scripts/run-stripe-sync.ts
 */
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
] as const

const ORDINAL_DATE_RE = /(\d{1,2})(?:st|nd|rd|th)\s+(january|february|march|april|may|june|july|august|september|october|november|december)/i

function dateTokenFromName(name: string | null | undefined): string | null {
  if (!name) return null
  const m = name.match(ORDINAL_DATE_RE)
  return m ? `${parseInt(m[1], 10)} ${m[2].toLowerCase()}` : null
}

type Ev = { id: string; date: string | null; name: string }
function dateTokenFromEvent(ev: Ev): string | null {
  if (!ev.date) return null
  const d = new Date(ev.date)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

function isVip(name: string | null): boolean {
  return !!name && /\bvip\b/i.test(name)
}

type Tier =
  | 'super_early_bird_general' | 'super_early_bird_vip'
  | 'early_bird_general' | 'early_bird_vip'
  | 'standard_general' | 'standard_vip'

// See route.ts: prices rose for the 5th-July-onwards era, so the same amount
// maps to a different tier per era. Branch on event date; past events keep
// their original tiers. Mirror of app/api/stripe/sync/route.ts.
const NEW_PRICING_FROM = Date.UTC(2026, 5, 5) // 2026-06-05
function ticketTypeFor(amountRm: number, vip: boolean, eventDate: string | null): Tier {
  const newEra = !!eventDate && new Date(eventDate).getTime() >= NEW_PRICING_FROM
  if (vip) {
    if (amountRm <= (newEra ? 547 : 497)) return 'super_early_bird_vip'
    if (amountRm <= 597) return 'early_bird_vip'
    return 'standard_vip'
  }
  if (amountRm <= (newEra ? 297 : 249)) return 'super_early_bird_general'
  if (amountRm <= (newEra ? 347 : 297)) return 'early_bird_general'
  return 'standard_general'
}

async function main() {
  const { data: events, error: evErr } = await supabase
    .from('events')
    .select('id,date,name')
  if (evErr) throw evErr
  if (!events?.length) throw new Error('no events')

  const earliest = Math.min(
    ...events.filter(e => e.date).map(e => new Date(e.date!).getTime()),
  )
  const FROM = Math.floor((earliest - 60 * 24 * 60 * 60 * 1000) / 1000)

  let added = 0, skipped = 0, unmatched = 0, moved = 0
  const movements: { name: string; from: string; to: string; sid: string }[] = []
  let cursor: string | undefined
  let pages = 0

  while (true) {
    const list = await stripe.checkout.sessions.list({
      limit: 100,
      status: 'complete',
      created: { gte: FROM },
      ...(cursor ? { starting_after: cursor } : {}),
    })

    for (const session of list.data) {
      const full = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ['line_items.data.price.product'],
      })
      const li = full.line_items?.data[0]
      const product = li?.price?.product
      const productName =
        product && typeof product === 'object' && !('deleted' in product)
          ? product.name
          : null

      const token = dateTokenFromName(productName) ?? dateTokenFromName(li?.description)
      const resolved = token ? events.find(e => dateTokenFromEvent(e) === token) ?? null : null

      if (!resolved) {
        unmatched++
        console.log(`UNMATCHED: ${session.id} amount=${(session.amount_total ?? 0) / 100} product="${productName ?? '(none)'}"`)
        continue
      }

      const amountRm = (session.amount_total ?? 0) / 100
      const tier = ticketTypeFor(amountRm, isVip(productName), resolved.date)

      const { data: existing } = await supabase
        .from('attendees')
        .select('id, phone, name, event_id')
        .eq('stripe_session_id', session.id)
        .maybeSingle()

      const attendee = {
        event_id: resolved.id,
        name: session.customer_details?.name ?? existing?.name ?? 'Unknown',
        email: session.customer_details?.email ?? null,
        phone: session.customer_details?.phone ?? existing?.phone ?? null,
        ticket_type: tier,
        payment_method: 'stripe' as const,
        payment_amount: amountRm,
        payment_status: 'paid' as const,
        stripe_session_id: session.id,
        paid_at: new Date(session.created * 1000).toISOString(),
      }

      if (existing && existing.event_id !== resolved.id) {
        const from = events.find(e => e.id === existing.event_id)?.name ?? '?'
        movements.push({ name: attendee.name, from, to: resolved.name, sid: session.id })
        moved++
      }

      const { error } = await supabase
        .from('attendees')
        .upsert(attendee, { onConflict: 'stripe_session_id' })

      if (error) {
        console.error(`SKIP ${session.id}: ${error.message}`)
        skipped++
      } else {
        added++
      }
    }

    pages++
    if (!list.has_more || pages >= 20) break
    cursor = list.data[list.data.length - 1]?.id
    if (!cursor) break
  }

  console.log('---')
  console.log(`pages=${pages} added/upserted=${added} skipped=${skipped} unmatched=${unmatched} moved=${moved}`)
  if (movements.length) {
    console.log('MOVED:')
    for (const m of movements) console.log(`  ${m.name}: ${m.from}  →  ${m.to}`)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
