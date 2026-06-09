'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { Event } from '@/lib/supabase'
import { useCachedFetch } from '@/lib/useCachedFetch'
import { resolveInitialEvent, getStoredEventId } from '@/lib/event'

type Affiliate = { affiliate_id: string; handle: string; name: string | null; commission: number; buyers: number; paid: boolean; bukku_bill_id: string | null }
type Expense = { id: string; description: string; category: string; amount: number; bukku_bill_id: string | null }
type State = {
  connection: { enabled: boolean; subdomain: string | null; base_url: string; is_production: boolean }
  event: { id: string; name: string; date: string | null; bukku_income_id: string | null; paid_count: number; ticket_total: number } | null
  affiliates: Affiliate[]
  expenses: Expense[]
}

const rm = (n: number) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function BukkuPage() {
  const { data: eventsData } = useCachedFetch<Event[]>('events', '/api/events')
  const events = useMemo(() => eventsData ?? [], [eventsData])
  const [eventId, setEventId] = useState('')
  useEffect(() => {
    if (!events.length || eventId) return
    const stored = getStoredEventId()
    const pick = (stored && events.find(e => e.id === stored)) || resolveInitialEvent(events)
    if (pick) setEventId(pick.id)
  }, [events, eventId])

  const [state, setState] = useState<State | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null) // which action is running
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async (id: string) => {
    if (!id) return
    setLoading(true)
    try {
      const res = await fetch(`/api/bukku/state?event_id=${id}`, { cache: 'no-store' })
      setState(await res.json())
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (eventId) load(eventId) }, [eventId, load])

  async function act(key: string, url: string, payload: object, confirmText: string) {
    if (!window.confirm(`${confirmText}\n\nThis writes to your REAL Bukku books. Continue?`)) return
    setBusy(key)
    setMsg(null)
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await res.json()
      if (!res.ok && res.status !== 207) {
        setMsg({ ok: false, text: data.error ? `${data.error}${data.details ? ' — ' + data.details : ''}` : `Failed (${res.status})` })
      } else {
        const ref = data.bukku_invoice_number || data.bukku_bill_number || data.bukku_bill_id || data.bukku_income_id || 'OK'
        setMsg({ ok: true, text: data.idempotent ? 'Already synced ✓' : `✅ Pushed to Bukku (${ref})` })
        await load(eventId)
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const conn = state?.connection
  const connLive = !!conn?.enabled && !!conn?.is_production

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Bukku</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Push event finances into your accounting books.</p>
        </div>
        {events.length > 0 && (
          <select value={eventId} onChange={e => setEventId(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-xs">
            {events.map(e => <option key={e.id} value={e.id}>{e.name}{e.is_active ? ' • active' : ''}</option>)}
          </select>
        )}
      </div>

      {/* Connection status */}
      <div className="bg-[#111] border border-zinc-800 rounded-xl p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={`w-2.5 h-2.5 rounded-full ${connLive ? 'bg-emerald-400' : conn?.enabled ? 'bg-amber-400' : 'bg-zinc-600'}`} />
          <div className="text-sm">
            <div className="font-medium">
              {connLive ? 'Connected — production books' : conn?.enabled ? 'Connected — staging' : 'Not connected'}
            </div>
            <div className="text-xs text-zinc-500">{conn ? `${conn.subdomain ?? '—'} · ${conn.base_url}` : 'Checking…'}</div>
          </div>
        </div>
        <Link href="/invoice" className="text-xs border border-zinc-700 text-zinc-300 hover:border-amber-500/50 hover:text-amber-400 px-3 py-1.5 rounded-lg whitespace-nowrap">
          Client invoices →
        </Link>
      </div>

      {msg && (
        <div className={`text-sm font-medium rounded-lg px-3 py-2 border ${msg.ok ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-red-400 border-red-500/30 bg-red-500/10'}`}>
          {msg.text}
        </div>
      )}

      {loading && !state && <div className="text-zinc-500 text-center py-10">Loading…</div>}

      {state && !state.event && <div className="text-zinc-500 text-center py-10">No event selected.</div>}

      {state?.event && (
        <>
          {/* Ticket revenue */}
          <Section title="Ticket revenue" subtitle={`${state.event.paid_count} paid attendee${state.event.paid_count === 1 ? '' : 's'}`}>
            <Row
              label={state.event.name}
              detail={rm(state.event.ticket_total)}
              synced={!!state.event.bukku_income_id}
              disabled={state.event.ticket_total <= 0}
              busy={busy === 'ticket'}
              onPush={() => act('ticket', '/api/bukku/sync', { event_id: state.event!.id },
                `Book ${rm(state.event!.ticket_total)} of ticket revenue for "${state.event!.name}" as a cash sale.`)}
            />
          </Section>

          {/* Affiliate payouts */}
          <Section title="Affiliate payouts" subtitle="Commissions → supplier bills">
            {state.affiliates.length === 0 && <Empty>No affiliate commissions for this event.</Empty>}
            {state.affiliates.map(a => (
              <Row key={a.affiliate_id}
                label={`@${a.handle}${a.name ? ` · ${a.name}` : ''}`}
                detail={`${rm(a.commission)} · ${a.buyers} buyer${a.buyers === 1 ? '' : 's'}`}
                synced={!!a.bukku_bill_id}
                disabled={!a.paid}
                disabledHint={!a.paid ? 'Mark paid first' : undefined}
                busy={busy === `aff-${a.affiliate_id}`}
                onPush={() => act(`aff-${a.affiliate_id}`, '/api/bukku/payout', { event_id: state.event!.id, affiliate_id: a.affiliate_id },
                  `Create a Bukku bill of ${rm(a.commission)} to @${a.handle}.`)}
              />
            ))}
          </Section>

          {/* Expenses */}
          <Section title="Event expenses" subtitle="Costs → purchase bills by category">
            {state.expenses.length === 0 && <Empty>No expenses logged for this event.</Empty>}
            {state.expenses.map(x => (
              <Row key={x.id}
                label={x.description}
                detail={`${rm(x.amount)} · ${x.category}`}
                synced={!!x.bukku_bill_id}
                disabled={x.amount <= 0}
                busy={busy === `exp-${x.id}`}
                onPush={() => act(`exp-${x.id}`, '/api/bukku/expense', { expense_id: x.id },
                  `Create a Bukku bill of ${rm(x.amount)} for "${x.description}" (${x.category}).`)}
              />
            ))}
          </Section>
        </>
      )}
    </div>
  )
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#111] border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800">
        <h2 className="font-semibold text-sm">{title}</h2>
        {subtitle && <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="divide-y divide-zinc-800/70">{children}</div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-5 text-xs text-zinc-600 text-center">{children}</div>
}

function Row({ label, detail, synced, disabled, disabledHint, busy, onPush }: {
  label: string; detail: string; synced: boolean; disabled?: boolean; disabledHint?: string; busy?: boolean; onPush: () => void
}) {
  return (
    <div className="px-4 py-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm truncate">{label}</div>
        <div className="text-xs text-zinc-500 mt-0.5">{detail}</div>
      </div>
      {synced ? (
        <span className="text-xs font-semibold text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 rounded-lg whitespace-nowrap">✓ Synced</span>
      ) : (
        <button onClick={onPush} disabled={disabled || busy}
          title={disabled ? disabledHint : undefined}
          className="text-xs font-semibold whitespace-nowrap px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-amber-500/50 text-amber-400 hover:bg-amber-500/10">
          {busy ? '⏳ Pushing…' : disabled && disabledHint ? disabledHint : '📒 Push to Bukku'}
        </button>
      )}
    </div>
  )
}
