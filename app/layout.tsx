import type { Metadata } from 'next'
import './globals.css'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { isAdminEmail } from '@/lib/auth/admin'
import MobileNav from './MobileNav'

export const dynamic = 'force-dynamic'
export const revalidate = 0

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
        <nav className="relative border-b border-zinc-800 bg-[#111] px-4 sm:px-6 py-4 flex items-center gap-4 lg:gap-6">
          <span className="text-lg font-bold text-amber-400 flex-shrink-0">EventOps</span>
          {user && (
            <MobileNav
              userEmail={user.email}
              isAdmin={admin}
              pendingCount={pendingCount}
            />
          )}
        </nav>
        <main className="p-3 sm:p-6 max-w-7xl mx-auto">{children}</main>
      </body>
    </html>
  )
}
