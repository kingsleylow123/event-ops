// Venue partner directory — "Room Rental Only" catalogue the event manager
// browses to pick a space for a workshop. Static + curated (the list changes
// slowly); photos live in /public/venues. Add a venue by appending here and
// dropping its photo at the `photo` path. When a venue is picked, its label is
// written to the event's `venue` field via PATCH /api/events.

export type VenueStatus = 'available' | 'tbc'
export type VenueLayout = 'classroom' | 'theater'

export interface Venue {
  id: string
  name: string
  area?: string
  room?: string
  capacity?: number
  layout?: VenueLayout    // seating setting — matters for workshops
  priceRM?: number
  priceNote?: string      // e.g. "+ RM100 for 75\" TV transport", "Free / TBD"
  picName?: string
  picPhone?: string
  notes?: string          // e.g. "Hybrid: Physical + Zoom + Recording"
  photo?: string          // /venues/<id>.jpg — omit to render a placeholder
  status: VenueStatus
}

// The string written to event.venue when this venue is selected.
export function venueLabel(v: Venue): string {
  return v.room ? `${v.name} — ${v.room}` : v.name
}

export const VENUES: Venue[] = [
  {
    id: 'co3',
    name: 'CO3',
    area: 'Puchong',
    room: 'Red Dot Room',
    capacity: 40,
    layout: 'classroom',
    priceRM: 500,
    picName: 'David Lai',
    picPhone: '+60 12-311 2639',
    photo: '/venues/co3.jpg',
    status: 'available',
  },
  {
    id: 'hspace',
    name: 'Hspace',
    area: 'Bandar Utama',
    room: 'Event Room',
    capacity: 50,
    layout: 'classroom',
    priceRM: 1120,
    photo: '/venues/hspace.jpg',
    status: 'available',
  },
  {
    id: 'pavillion-synergy',
    name: 'Meet@ Pavillion Damansara',
    area: 'Damansara',
    room: 'Synergy Room (big)',
    capacity: 40,
    layout: 'classroom',
    priceRM: 1900,
    picName: 'Duncan Tsen',
    picPhone: '+60 14-910 5314',
    notes: 'Hybrid: Physical + Zoom + Recording',
    status: 'available',
    // photo reassigned to Wisma Cosway — add a Pavillion photo at /venues/pavillion-synergy.jpg to restore
  },
  {
    id: 'pavillion-nexus',
    name: 'Meet@ Pavillion Damansara',
    area: 'Damansara',
    room: 'Nexus Boardroom (small)',
    capacity: 18,
    layout: 'classroom',
    priceRM: 1800,
    picName: 'Duncan Tsen',
    picPhone: '+60 14-910 5314',
    status: 'available',
    // photo: '/venues/pavillion-nexus.jpg',
  },
  {
    id: 'wisma-cosway',
    name: 'Wisma Cosway',
    area: 'Kuala Lumpur',
    room: 'Event Room',
    capacity: 40,
    layout: 'classroom',
    priceRM: 700,
    priceNote: '+ RM100 for 75" TV transport',
    picName: 'CP',
    picPhone: '+60 12-301 5808',
    photo: '/venues/wisma-cosway.jpg',
    status: 'available',
  },
  {
    id: 'mhaus-d2',
    name: 'Mhaus D2',
    room: 'Event Space',
    capacity: 50,
    layout: 'theater',
    priceNote: 'Free / TBD',
    picName: 'Deric',
    picPhone: '+60 16-478 1282',
    status: 'available',
    // photo reassigned to Hspace — add a Mhaus photo at /venues/mhaus-d2.jpg to restore
  },
  {
    id: 'kamin-suma',
    name: 'Kamin — Suma College',
    status: 'tbc',
  },
  {
    id: 'leo-ultimate',
    name: 'Leo — Ultimate Event Space',
    status: 'tbc',
  },
  {
    id: 'iconik',
    name: 'iconik, Icon City',
    area: 'Petaling Jaya',
    status: 'tbc',
  },
  {
    id: 'apu',
    name: 'APU University',
    area: 'Bukit Jalil',
    status: 'tbc',
  },
  {
    id: 'sunway-uni',
    name: 'Sunway University',
    area: 'Bandar Sunway',
    status: 'tbc',
  },
  {
    id: 'michael-tp',
    name: 'Michael — TP contacts',
    notes: 'Lead — venue contacts via Michael',
    status: 'tbc',
  },
]
