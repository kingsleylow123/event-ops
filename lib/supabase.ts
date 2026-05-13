import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type TicketType = 'free_general' | 'free_vip' | 'early_bird_general' | 'early_bird_vip' | 'standard_general' | 'standard_vip'
export type PaymentMethod = 'stripe' | 'bank_transfer' | 'free'
export type PaymentStatus = 'paid' | 'pending' | 'free'
export type ChecklistStatus = 'pending' | 'in_progress' | 'done'

export const TICKET_LABELS: Record<TicketType, string> = {
  free_general: 'Free General',
  free_vip: 'Free VIP',
  early_bird_general: 'Early Bird General',
  early_bird_vip: 'Early Bird VIP',
  standard_general: 'Standard General',
  standard_vip: 'Standard VIP',
}

export const TICKET_PRICES: Record<TicketType, number> = {
  free_general: 0,
  free_vip: 0,
  early_bird_general: 97,
  early_bird_vip: 297,
  standard_general: 159,
  standard_vip: 397,
}

export const CHECKLIST_CATEGORIES = ['Venue', 'Facilitator', 'Media / UGC Creator', 'AV/Video', 'Logistics']

export interface Event {
  id: string
  name: string
  date: string | null
  venue: string | null
  capacity: number | null
  is_active: boolean
  created_at: string
}

export interface Attendee {
  id: string
  event_id: string
  name: string
  phone: string | null
  email: string | null
  ticket_type: TicketType
  payment_method: PaymentMethod
  payment_amount: number
  payment_status: PaymentStatus
  stripe_session_id: string | null
  attendance_confirmed: boolean
  notes: string | null
  created_at: string
}

export interface ChecklistItem {
  id: string
  event_id: string
  category: string
  item: string
  pic_name: string | null
  pic_phone: string | null
  status: ChecklistStatus
  due_date: string | null
  notes: string | null
  created_at: string
}

export function toWhatsApp(phone: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('60')) return `https://wa.me/${digits}`
  if (digits.startsWith('0')) return `https://wa.me/6${digits}`
  return `https://wa.me/60${digits}`
}
