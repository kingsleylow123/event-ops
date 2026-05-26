import type { Metadata } from 'next'
import './globals.css'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { isAdminEmail } from '@/lib/auth/admin'
import SignOutButton from './SignOutButton'

export const metadata: Metadata = {
  title: 'EventOps',
  description: 'Event attendee & payment tracking',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = isAdminEmail(user?.email)

  let pendingCount = 0
  if (admin) {
    const { count } = await supabase
      .from('user_approvals')
      .select('email', { count: 'exact', head: true })
      .eq('status', 'pending')
    pendingCount = count ?? 0
  }

  return (
    <html lang="en">
      <body className="min-h-screen bg-[#0a0a0a] text-white">
        <nav className="border-b border-zinc-800 bg-[#111] px-6 py-4 flex items-center gap-8 flex-wrap">
          <span className="text-lg font-bold text-amber-400">EventOps</span>
          {user && (
            <>
              <Link href="/" className="text-sm text-zinc-400 hover:text-white transition-colors">Dashboard</Link>
              <Link href="/attendees" className="text-sm text-zinc-400 hover:text-white transition-colors">Attendees</Link>
              <Link href="/checklist" className="text-sm text-zinc-400 hover:text-white transition-colors">Checklist</Link>
              <Link href="/events" className="text-sm text-zinc-400 hover:text-white transition-colors">Events</Link>
              <Link href="/revenue" className="text-sm text-zinc-400 hover:text-white transition-colors">Revenue</Link>
              <Link href="/activity" className="text-sm text-zinc-400 hover:text-white transition-colors">Activity</Link>
              <Link href="/meetings" className="text-sm text-zinc-400 hover:text-white transition-colors">Meetings</Link>
              <Link href="/team" className="text-sm text-zinc-400 hover:text-white transition-colors">Claude Intern</Link>
              {admin && (
                <Link href="/admin" className="text-sm text-zinc-400 hover:text-white transition-colors flex items-center gap-1">
                  Admin
                  {pendingCount > 0 && (
                    <span className="bg-amber-500 text-black text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                      {pendingCount}
                    </span>
                  )}
                </Link>
              )}
              <div className="ml-auto flex items-center gap-3">
                <Link href="/profile" className="text-xs text-zinc-500 hover:text-amber-400">{user.email}</Link>
                <SignOutButton />
              </div>
            </>
          )}
        </nav>
        <main className="p-6 max-w-7xl mx-auto">{children}</main>
      </body>
    </html>
  )
}
