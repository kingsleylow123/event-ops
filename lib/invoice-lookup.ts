// Look up an attendee from Supabase by partial name match.
// Used by Jarvis when generating invoices on demand.

// Service-role client: `attendees` has RLS enabled with no anon policy, so the
// public anon client returns ZERO rows here — every invoice lookup would falsely
// report "no attendee matching". This is a server-only, admin-gated path.
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { TICKET_LABELS, type TicketType } from '@/lib/supabase'

export type AttendeeMatch = {
  id: string
  name: string
  ticket_type: TicketType
  payment_amount: number
  payment_status: string
  notes: string | null
  ticket_label: string
}

export async function findAttendeesByName(query: string, eventId?: string): Promise<AttendeeMatch[]> {
  const q = query.trim()
  if (!q) return []

  let sb = supabase
    .from('attendees')
    .select('id, name, ticket_type, payment_amount, payment_status, notes, event_id')
    .ilike('name', `%${q}%`)
    .order('created_at', { ascending: false })

  if (eventId) sb = sb.eq('event_id', eventId)

  const { data, error } = await sb
  if (error) { console.error('[invoice-lookup] attendees query failed', error); return [] }
  if (!data) return []

  return data.map(a => ({
    id: a.id as string,
    name: a.name as string,
    ticket_type: a.ticket_type as TicketType,
    payment_amount: Number(a.payment_amount ?? 0),
    payment_status: a.payment_status as string,
    notes: (a.notes as string | null) ?? null,
    ticket_label: TICKET_LABELS[a.ticket_type as TicketType] ?? String(a.ticket_type),
  }))
}
