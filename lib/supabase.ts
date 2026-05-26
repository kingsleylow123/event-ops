import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type TicketType =
  | 'free_general'
  | 'free_vip'
  | 'super_early_bird_general'
  | 'super_early_bird_vip'
  | 'early_bird_general'
  | 'early_bird_vip'
  | 'standard_general'
  | 'standard_vip'
export type PaymentMethod = 'stripe' | 'bank_transfer' | 'free'
export type PaymentStatus = 'paid' | 'pending' | 'free'
export type ChecklistStatus = 'pending' | 'in_progress' | 'done'

export const TICKET_LABELS: Record<TicketType, string> = {
  free_general: 'Free General',
  free_vip: 'Free VIP',
  super_early_bird_general: 'Super Early Bird General',
  super_early_bird_vip: 'Super Early Bird VIP',
  early_bird_general: 'Early Bird General',
  early_bird_vip: 'Early Bird VIP',
  standard_general: 'Public General',
  standard_vip: 'Public VIP',
}

export const TICKET_PRICES: Record<TicketType, number> = {
  free_general: 0,
  free_vip: 0,
  super_early_bird_general: 249,
  super_early_bird_vip: 497,
  early_bird_general: 297,
  early_bird_vip: 597,
  standard_general: 347,
  standard_vip: 697,
}

export const CHECKLIST_CATEGORIES = ['Venue', 'Facilitator', 'Media / UGC Creator', 'AV/Video', 'Logistics']

export type TeamRole = 'speaker' | 'facilitator' | 'content_creator' | 'videographer'

export interface TeamMember {
  role: TeamRole
  name: string
  phone: string | null
}

export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  speaker: 'Speaker',
  facilitator: 'Facilitator',
  content_creator: 'Content Creator',
  videographer: 'Videographer',
}

export const TEAM_ROLE_ICONS: Record<TeamRole, string> = {
  speaker: '🎤',
  facilitator: '🧑‍🏫',
  content_creator: '📸',
  videographer: '🎥',
}

export interface Event {
  id: string
  name: string
  date: string | null
  venue: string | null
  capacity: number | null
  is_active: boolean
  team: TeamMember[]
  // Legacy single-member columns — kept for back-compat, no longer used by UI
  host_name: string | null
  host_phone: string | null
  facilitator_name: string | null
  facilitator_phone: string | null
  content_creator_name: string | null
  content_creator_phone: string | null
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
  paid_at: string | null
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
