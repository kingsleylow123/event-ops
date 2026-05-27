'use client'
import { useState } from 'react'
import Link from 'next/link'
import SignOutButton from './SignOutButton'

interface MobileNavProps {
  userEmail: string | undefined
  isAdmin: boolean
  pendingCount: number
}

export default function MobileNav({ userEmail, isAdmin, pendingCount }: MobileNavProps) {
  const [open, setOpen] = useState(false)

  const links = [
    { href: '/', label: 'Dashboard' },
    { href: '/attendees', label: 'Attendees' },
    { href: '/checklist', label: 'Checklist' },
    { href: '/events', label: 'Events' },
    { href: '/floorplan', label: 'Floor Plan' },
    { href: '/revenue', label: 'Revenue' },
    { href: '/meetings', label: 'Activity' },
    { href: '/team', label: 'Claude Intern' },
    ...(isAdmin ? [{ href: '/admin', label: 'Admin', badge: pendingCount }] : []),
  ]

  return (
    <>
      {/* Desktop nav links */}
      <div className="hidden lg:flex items-center gap-6 flex-1">
        {links.map(l => (
          <Link key={l.href} href={l.href} className="text-sm text-zinc-400 hover:text-white transition-colors flex items-center gap-1">
            {l.label}
            {l.badge != null && l.badge > 0 && (
              <span className="bg-amber-500 text-black text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                {l.badge}
              </span>
            )}
          </Link>
        ))}
        <div className="ml-auto flex items-center gap-3">
          {userEmail && (
            <Link href="/profile" className="text-xs text-zinc-500 hover:text-amber-400">{userEmail}</Link>
          )}
          <SignOutButton />
        </div>
      </div>

      {/* Mobile hamburger button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="lg:hidden ml-auto flex flex-col gap-1.5 p-2 rounded-lg hover:bg-zinc-800 transition-colors"
        aria-label={open ? 'Close menu' : 'Open menu'}
      >
        <span className={`block w-5 h-0.5 bg-white transition-all duration-200 ${open ? 'rotate-45 translate-y-2' : ''}`} />
        <span className={`block w-5 h-0.5 bg-white transition-all duration-200 ${open ? 'opacity-0' : ''}`} />
        <span className={`block w-5 h-0.5 bg-white transition-all duration-200 ${open ? '-rotate-45 -translate-y-2' : ''}`} />
      </button>

      {/* Mobile dropdown */}
      {open && (
        <div className="lg:hidden absolute top-full left-0 right-0 bg-[#111] border-b border-zinc-800 z-50 py-3 px-4 flex flex-col gap-1">
          {links.map(l => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="flex items-center justify-between text-sm text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition-colors rounded-lg px-3 py-2.5"
            >
              <span>{l.label}</span>
              {l.badge != null && l.badge > 0 && (
                <span className="bg-amber-500 text-black text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                  {l.badge}
                </span>
              )}
            </Link>
          ))}
          <div className="border-t border-zinc-800 mt-2 pt-2 flex items-center justify-between gap-3">
            {userEmail && (
              <Link href="/profile" onClick={() => setOpen(false)} className="text-xs text-zinc-500 hover:text-amber-400 truncate">
                {userEmail}
              </Link>
            )}
            <SignOutButton />
          </div>
        </div>
      )}
    </>
  )
}
