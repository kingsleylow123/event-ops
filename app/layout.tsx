import type { Metadata } from 'next'
import './globals.css'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { isAdminEmail } from '@/lib/auth/admin'
import Sidebar from './Sidebar'

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
        {user ? (
          <>
            <Sidebar userEmail={user.email} isAdmin={admin} pendingCount={pendingCount} />
            <main className="lg:pl-64">
              <div className="p-3 sm:p-6 max-w-7xl mx-auto">{children}</div>
            </main>
          </>
        ) : (
          <main>{children}</main>
        )}
      </body>
    </html>
  )
}
