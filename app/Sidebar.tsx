'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import SignOutButton from './SignOutButton'
import { useRevenueHidden } from '@/lib/useRevenueHidden'
import { useTheme } from '@/lib/useTheme'
import { resolveInitialEvent, storeEventId, pickActiveEvent } from '@/lib/event'
import { useCachedFetch } from '@/lib/useCachedFetch'
import type { Event } from '@/lib/supabase'

interface SidebarProps {
  userEmail: string | undefined
  isAdmin: boolean
  pendingCount: number
}

type Item = { href: string; label: string; icon: React.ReactNode }

// ── Inline monochrome icons (currentColor, 18px, stroke 1.8) ──────────────────
const I = (d: React.ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
)
const icons = {
  dashboard: I(<><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>),
  events: I(<><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>),
  leads: I(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>),
  insights: I(<><path d="M3 3v18h18" /><rect x="7" y="12" width="3" height="6" /><rect x="12" y="8" width="3" height="10" /><rect x="17" y="5" width="3" height="13" /></>),
  checklist: I(<><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>),
  team: I(<><path d="M12 3l1.9 4.6L19 9l-4 3.4L16.2 18 12 15.3 7.8 18 9 12.4 5 9l5.1-1.4z" /></>),
  floorplan: I(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 9v12M15 3v6" /></>),
  briefing: I(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></>),
  venue: I(<><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>),
  attendees: I(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>),
  activity: I(<path d="M22 12h-4l-3 9L9 3l-3 9H2" />),
  revenue: I(<><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>),
  affiliates: I(<><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></>),
  creators: I(<><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="3.5" /><circle cx="17.5" cy="6.5" r="1" /></>),
  payout: I(<><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" /><path d="M4 6v12a2 2 0 0 0 2 2h14v-4" /><path d="M18 12a2 2 0 0 0 0 4h4v-4z" /></>),
  payment: I(<><rect x="1" y="4" width="22" height="16" rx="2" /><path d="M1 10h22" /></>),
  invoice: I(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></>),
  monthend: I(<><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4" /></>),
  bukku: I(<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /><path d="M9 7h7M9 11h5" /></>),
  admin: I(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />),
  pipeline: I(<path d="M3 4h18l-7 8v6l-4 2v-8z" />),
  finance: I(<><path d="M21.21 15.89A10 10 0 1 1 8 2.83" /><path d="M22 12A10 10 0 0 0 12 2v10z" /></>),
  claims: I(<><path d="M5 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1z" /><path d="M9 8h6M9 12h5" /></>),
  deposits: I(<><rect x="2" y="6" width="20" height="13" rx="2" /><circle cx="12" cy="12.5" r="3" /><path d="M6 6V4h14a2 2 0 0 1 2 2v9" /></>),
  reports: I(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h2M8 17h2M14 13h2M14 17h2" /></>),
  commandcenter: I(<><path d="M3 5h18l-7 8.5V19l-4 2v-7.5z" /></>),
}

export default function Sidebar({ userEmail, isAdmin, pendingCount }: SidebarProps) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [hidden, toggleRevenue] = useRevenueHidden()
  const [theme, toggleTheme] = useTheme()

  // Event switcher — cached so the sidebar paints instantly on every load
  const { data: eventsData } = useCachedFetch<Event[]>('events', '/api/events')
  const events = eventsData ?? []
  const [eventId, setEventId] = useState('')
  useEffect(() => {
    if (!events.length) return
    const pick = resolveInitialEvent(events)
    if (pick && !eventId) setEventId(pick.id)
  }, [events, eventId])

  // Badge the *computed* active event (date-driven), not the raw is_active flag,
  // so "• active" always reflects the event the app actually defaults to.
  const activeId = events.length ? pickActiveEvent(events)?.id : undefined

  const dashboard: Item = { href: '/', label: 'Dashboard', icon: icons.dashboard }
  const commandCenter: Item = { href: '/command-center', label: 'Command Center', icon: icons.commandcenter }
  const groups: { id: string; title: string; items: Item[] }[] = [
    ...(isAdmin ? [{
      id: 'creators', title: 'Creators', items: [
        { href: '/creators', label: 'Scorecard', icon: icons.creators },
        { href: '/creators/insights', label: 'Insights', icon: icons.insights },
      ],
    }] : []),
    {
      id: 'pre', title: 'Pre-Event', items: [
        { href: '/events', label: 'Events', icon: icons.events },
        { href: '/venues', label: 'Venues', icon: icons.venue },
        ...(isAdmin ? [{ href: '/leads', label: 'Leads', icon: icons.leads }] : []),
        { href: '/insights', label: 'Insights', icon: icons.insights },
        { href: '/checklist', label: 'Checklist', icon: icons.checklist },
        { href: '/team', label: 'Claude Intern', icon: icons.team },
        ...(isAdmin ? [{ href: '/team-profiles', label: 'Team Profiles', icon: icons.team }] : []),
        { href: '/floorplan', label: 'Floor Plan', icon: icons.floorplan },
        { href: '/briefing', label: 'Briefing', icon: icons.briefing },
      ],
    },
    {
      id: 'during', title: 'During Event', items: [
        { href: '/attendees', label: 'Attendees', icon: icons.attendees },
        { href: '/attendees?type=facilitator', label: 'Facilitators', icon: icons.team },
      ],
    },
    ...(isAdmin ? [{
      id: 'post', title: 'Post-Event', items: [
        { href: '/pipeline', label: 'Pipeline', icon: icons.pipeline },
        { href: '/revenue', label: 'Revenue', icon: icons.revenue },
        { href: '/affiliates', label: 'Affiliates', icon: icons.affiliates },
        { href: '/payment-template', label: 'Payment', icon: icons.payment },
      ],
    }] : []),
    ...(isAdmin ? [{
      id: 'finance', title: 'Finance', items: [
        { href: '/finance', label: 'Finance', icon: icons.finance },
        { href: '/finance/reports', label: 'Reports', icon: icons.reports },
        { href: '/invoice', label: 'Invoice', icon: icons.invoice },
        { href: '/payout', label: 'Payout', icon: icons.payout },
        { href: '/claims', label: 'Claims', icon: icons.claims },
        { href: '/deposits', label: 'Deposits', icon: icons.deposits },
        { href: '/bukku', label: 'Bukku', icon: icons.bukku },
        { href: '/month-end', label: 'Month-End', icon: icons.monthend },
      ],
    }] : []),
  ]

  // Which group contains the current page → auto-expand it
  const activeGroup = groups.find(g => g.items.some(i => i.href === pathname))?.id
  // User overrides per group; default = open (discoverable). The group of the
  // current page is forced open. No effect needed — purely derived.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const isOpen = (id: string) => id === activeGroup ? true : (overrides[id] ?? true)
  const toggleGroup = (id: string) => setOverrides(o => ({ ...o, [id]: !isOpen(id) }))

  const isActive = (href: string) => href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/')

  const renderLink = (item: Item) => {
    const active = isActive(item.href)
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileOpen(false)}
        className={`group relative flex items-center gap-3 rounded-xl px-3 min-h-[44px] text-sm transition-all duration-150 ${active ? '' : 'theme-muted'}`}
        style={active ? { background: 'var(--active)', color: 'var(--foreground)' } : undefined}
      >
        {active && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[2.5px] rounded-full"
            style={{ background: 'linear-gradient(to bottom, #D4684A, #f59e0b)', boxShadow: '0 0 10px 1px rgba(212,104,74,0.6)' }} />
        )}
        <span className={active ? 'text-amber-500' : 'theme-faint'}>{item.icon}</span>
        <span className="truncate">{item.label}</span>
      </Link>
    )
  }

  const chevron = (o: boolean) => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      className={`transition-transform duration-200 ${o ? 'rotate-90' : ''}`}><path d="M9 18l6-6-6-6" /></svg>
  )

  const SidebarBody = (
    <div className="flex flex-col h-full">
      {/* Header: logo + event switcher */}
      <div className="px-4 pt-5 pb-4">
        <Link href="/" onClick={() => setMobileOpen(false)} className="flex items-center gap-2.5 mb-4">
          <Image src="/claude-logo.jpg" alt="Claude Malaysia" width={30} height={30} className="rounded-lg" />
          <div className="leading-tight">
            <div className="text-sm font-bold theme-text">Claude Malaysia</div>
            <div className="text-[10px] text-amber-500 font-medium tracking-wide">EVENTOPS</div>
          </div>
        </Link>
        {events.length > 0 && (
          <div className="relative">
            <select
              value={eventId}
              onChange={e => { setEventId(e.target.value); storeEventId(e.target.value); window.location.reload() }}
              className="theme-surface-2 theme-text theme-border w-full appearance-none border rounded-lg pl-3 pr-8 py-2 text-xs focus:outline-none focus:border-amber-500/50 cursor-pointer">
              {events.map(e => (
                <option key={e.id} value={e.id} className="bg-zinc-900">{e.name}{e.id === activeId ? ' • active' : ''}</option>
              ))}
            </select>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"><path d="M6 9l6 6 6-6" /></svg>
          </div>
        )}
      </div>

      {/* Nav (scrollable) */}
      <nav className="flex-1 overflow-y-auto px-3 pb-2 space-y-1
        [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {renderLink(dashboard)}
        {isAdmin && renderLink(commandCenter)}
        {groups.map(g => (
          <div key={g.id} className="pt-3">
            <button
              onClick={() => toggleGroup(g.id)}
              className="theme-faint w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest transition-colors">
              <span>{g.title}</span>
              {chevron(isOpen(g.id))}
            </button>
            {isOpen(g.id) && (
              <div className="mt-1 space-y-0.5">
                {g.items.map(i => renderLink(i))}
              </div>
            )}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="theme-border border-t px-3 py-3 space-y-1">
        {isAdmin && (
          <Link href="/admin" onClick={() => setMobileOpen(false)}
            className={`flex items-center justify-between gap-3 rounded-xl px-3 min-h-[40px] text-sm transition-all ${isActive('/admin') ? '' : 'theme-muted'}`}
            style={isActive('/admin') ? { background: 'var(--active)', color: 'var(--foreground)' } : undefined}>
            <span className="flex items-center gap-3"><span className="theme-faint">{icons.admin}</span>Admin</span>
            {pendingCount > 0 && (
              <span className="bg-amber-500 text-black text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">{pendingCount}</span>
            )}
          </Link>
        )}
        <button
          onClick={toggleRevenue}
          className="theme-muted w-full flex items-center justify-between gap-3 rounded-xl px-3 min-h-[40px] text-sm transition-all">
          <span className="flex items-center gap-3">
            <span className="theme-faint">
              {hidden
                ? I(<><path d="M17.94 17.94A10 10 0 0 1 12 20c-7 0-11-8-11-8a18 18 0 0 1 5.06-5.94M9.9 4.24A10 10 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></>)
                : I(<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>)}
            </span>
            Revenue
          </span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${hidden ? 'bg-zinc-700/60 text-zinc-300' : 'bg-amber-500/15 text-amber-400'}`}>
            {hidden ? 'Hidden' : 'Shown'}
          </span>
        </button>
        <button
          onClick={toggleTheme}
          className="theme-muted w-full flex items-center justify-between gap-3 rounded-xl px-3 min-h-[40px] text-sm transition-all">
          <span className="flex items-center gap-3">
            <span className="theme-faint">
              {theme === 'light'
                ? I(<circle cx="12" cy="12" r="5" />)  /* sun */
                : I(<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />)  /* moon */}
            </span>
            Appearance
          </span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">
            {theme === 'light' ? 'Light' : 'Dark'}
          </span>
        </button>
        <div className="flex items-center justify-between gap-2 pt-2 px-1">
          {userEmail && (
            <Link href="/profile" onClick={() => setMobileOpen(false)} className="theme-faint text-[11px] hover:text-amber-500 truncate">{userEmail}</Link>
          )}
          <SignOutButton />
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop sidebar — fixed glass rail */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 z-40 flex-col theme-border border-r"
        style={{ background: 'var(--sidebar-bg)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}>
        {SidebarBody}
      </aside>

      {/* Mobile top bar */}
      <div className="no-print lg:hidden sticky top-0 z-40 flex items-center gap-3 px-4 h-14 theme-border border-b"
        style={{ background: 'var(--sidebar-bg)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}>
        <button onClick={() => setMobileOpen(true)} aria-label="Open menu"
          className="theme-text flex flex-col gap-1.5 p-2 -ml-2 rounded-lg">
          <span className="block w-5 h-0.5 rounded" style={{ background: 'currentColor' }} />
          <span className="block w-5 h-0.5 rounded" style={{ background: 'currentColor' }} />
          <span className="block w-5 h-0.5 rounded" style={{ background: 'currentColor' }} />
        </button>
        <Image src="/claude-logo.jpg" alt="Claude Malaysia" width={26} height={26} className="rounded-md" />
        <span className="text-sm font-bold theme-text">Claude Malaysia</span>
      </div>

      {/* Mobile drawer + scrim */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[82vw] max-w-xs flex flex-col theme-border border-r animate-[slidein_0.2s_ease]"
            style={{ background: 'var(--sidebar-bg)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>
            {SidebarBody}
          </aside>
        </div>
      )}
    </>
  )
}
