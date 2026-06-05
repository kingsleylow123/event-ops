// Standard Operating Procedure (SOP) checklist template for Claude Malaysia
// workshops. One source of truth → loaded into any event's checklist via the
// "Load SOP template" button / POST /api/checklist?action=seed-sop.
//
// dueOffsetDays: days RELATIVE to the event date (negative = before the event,
// positive = after). null = no due date. The seeder computes the real date.

export interface SopItem {
  category: string
  item: string
  pic: string | null            // PIC name (phone auto-fills from team roster if known)
  dueOffsetDays: number | null
  notes: string | null
}

export const SOP_TEMPLATE: SopItem[] = [
  // ── Pre-Event Comms ──────────────────────────────────────────────────────
  { category: 'Pre-Event Comms', item: 'Send pre-event survey to paid participants WhatsApp group', pic: 'Kingsley', dueOffsetDays: -7, notes: 'Gather workshop data. Survey link: /survey?event=<eventId>' },
  { category: 'Pre-Event Comms', item: 'Seed Telegram Jarvis system screenshot in paid participants group', pic: 'Kingsley', dueOffsetDays: -5, notes: 'Show off the AI ops bot to build anticipation.' },
  { category: 'Pre-Event Comms', item: 'Huda sends final guestlist for Kingsley to check (confirm food)', pic: 'Huda', dueOffsetDays: -2, notes: 'Final headcount drives the F&B order.' },

  // ── Facilitator ──────────────────────────────────────────────────────────
  { category: 'Facilitator', item: 'Confirm HRDC trainers for the event', pic: 'Kingsley', dueOffsetDays: -7, notes: null },
  { category: 'Facilitator', item: 'Confirm 2 fireside speakers for the event', pic: 'Kingsley', dueOffsetDays: -7, notes: null },
  { category: 'Facilitator', item: 'Confirm closer for the event', pic: 'Kingsley', dueOffsetDays: -7, notes: null },
  { category: 'Facilitator', item: 'Get each facilitator to add their 1 slide', pic: 'Kingsley', dueOffsetDays: -3, notes: 'How-to: https://www.loom.com/share/3d0a096d42a84086a4d0b01fc0098bc1 · Template: https://gamma.app/docs/Claude-Malaysia--0n7zbidml21eqix · Every attending faci shares what they built — 3 mins to shine.' },

  // ── Media / UGC Creator ──────────────────────────────────────────────────
  { category: 'Media / UGC Creator', item: 'Confirm UGC creators for the event', pic: 'Kingsley', dueOffsetDays: -7, notes: null },

  // ── AV/Video ──────────────────────────────────────────────────────────────
  { category: 'AV/Video', item: 'Confirm videographer for the event', pic: 'Kingsley', dueOffsetDays: -7, notes: null },
  { category: 'AV/Video', item: 'Ensure GitHub course runner is ready', pic: 'Kingsley', dueOffsetDays: -1, notes: null },

  // ── Sales/Upsell ───────────────────────────────────────────────────────────
  { category: 'Sales/Upsell', item: 'Ensure upsell slides are ready', pic: 'Kingsley', dueOffsetDays: -1, notes: null },
  { category: 'Sales/Upsell', item: 'Create Stripe link for upsell', pic: 'Huda', dueOffsetDays: -1, notes: null },

  // ── Venue (Huda) ────────────────────────────────────────────────────────────
  { category: 'Venue', item: 'Update floor plan and assign facilitators to tables', pic: 'Huda', dueOffsetDays: -2, notes: 'Use the Floor Plan page.' },
  { category: 'Venue', item: 'Liaise with venue — PIC phone, presenter laptop AV, music AV, projector/TV, table & chair setup, wifi password, light switch location', pic: 'Huda', dueOffsetDays: -2, notes: null },
  { category: 'Venue', item: 'Confirm printing with Kingsley', pic: 'Huda', dueOffsetDays: -2, notes: null },

  // ── Post-Event ───────────────────────────────────────────────────────────────
  { category: 'Post-Event', item: 'Ensure creators post their videos within 3 days (ManyChat + affiliate link)', pic: 'Kingsley', dueOffsetDays: 3, notes: null },
  { category: 'Post-Event', item: 'Ask for post-event feedback', pic: 'Kingsley', dueOffsetDays: 2, notes: null },
  { category: 'Post-Event', item: 'Customise the upsell message based on their workshop data', pic: 'Kingsley', dueOffsetDays: 1, notes: null },
]
