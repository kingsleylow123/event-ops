import { createClient } from '@supabase/supabase-js'
import { normPhone } from '@/lib/format'

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
export type PaymentStatus = 'paid' | 'pending' | 'free' | 'refunded'
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
  super_early_bird_general: 297,
  super_early_bird_vip: 547,
  early_bird_general: 347,
  early_bird_vip: 597,
  standard_general: 397,
  standard_vip: 647,
}

export const CHECKLIST_CATEGORIES = ['Pre-Event Comms', 'Facilitator', 'Media / UGC Creator', 'AV/Video', 'Sales/Upsell', 'Venue', 'Logistics', 'Post-Event']

export const EXPENSE_CATEGORIES = [
  'Venue',
  'F&B',
  'Speaker fees',
  'Marketing',
  'Equipment / AV',
  'Content',
  'Logistics',
  'Other',
] as const

export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number]

export interface Expense {
  id: string
  event_id: string
  description: string
  amount: number
  category: ExpenseCategory | string
  notes: string | null
  created_at: string
}

export interface MeetingAttendee {
  name: string
  attended: boolean
  notes: string | null
}

export type MeetingCategory = 'facilitator' | 'content_creator' | 'videographer' | 'mixed'

export interface Meeting {
  id: string
  title: string
  meeting_date: string
  event_id: string | null
  notes: string | null
  attendance: MeetingAttendee[]
  meeting_category: MeetingCategory
  created_at: string
}

export interface ContentPost {
  id: string
  person_name: string
  post_date: string  // YYYY-MM-DD
  notes: string | null
  created_at: string
}

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

export type FloorPlanSectionType = 'vip' | 'general' | 'creator' | 'overflow' | 'camera' | 'other' | 'spacer'

export interface FloorPlanSection {
  id: string
  label: string
  type: FloorPlanSectionType
  pax: number
  note?: string | null
  orientation?: 'portrait' | 'landscape'
}

// One day's plan — sections + speaker + roles. A 1-day event uses the legacy
// top-level fields on FloorPlan; multi-day events store an array of these on
// `days` (each fully independent: own sections, speaker, videographer, etc.).
export interface FloorPlanDay {
  label?: string
  stage_speaker?: string | null
  speaker_needs?: string[]
  sections: FloorPlanSection[]
  registration?: string | null
  main_door?: string | null
  fnb?: string | null
  videographer?: string | null
  facilitators?: { id: string; name: string; role?: string | null }[]
  columns?: 2 | 3
}

export interface FloorPlan extends FloorPlanDay {
  // Optional multi-day plans. Absent on legacy/single-day events — in that case
  // the top-level FloorPlanDay fields ARE Day 1's plan.
  days?: FloorPlanDay[]
}

export interface Event {
  id: string
  name: string
  date: string | null
  venue: string | null
  capacity: number | null
  is_active: boolean
  format?: string // 'workshop' (default) | 'webinar' — drives the survey variant
  config?: Record<string, string> // per-event links/videos/venue copy (see lib/event-config.ts)
  pricing_tier?: string // active sales tier for /register: super_early_bird | early_bird | standard
  team: TeamMember[]
  floor_plan?: FloorPlan
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
  // attendance_confirmed = (day1_attended OR day2_attended), kept in sync by a
  // DB trigger. Single-day events still write to attendance_confirmed directly.
  attendance_confirmed: boolean
  day1_attended: boolean
  day2_attended: boolean
  notes: string | null
  paid_at: string | null
  created_at: string
  is_facilitator: boolean
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
  // normPhone strips the 60 country code + leading zeros; we re-prepend 60 for
  // the wa.me link. Identical output to the old inline logic, single source now.
  const local = normPhone(phone)
  if (!local) return null
  return `https://wa.me/60${local}`
}
