import type { Metadata, Viewport } from 'next'
import './globals.css'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { isAdminEmail } from '@/lib/auth/admin'
import AppChrome from './AppChrome'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata: Metadata = {
  title: 'EventOps',
  description: 'Event attendee & payment tracking',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
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
    // The inline theme script below sets data-theme on <html> before React
    // hydrates, which would otherwise trip a hydration mismatch (and, downstream,
    // the "script tag while rendering" warning). suppressHydrationWarning is the
    // standard, safe fix for pre-paint theme scripts — visuals/behaviour unchanged.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply saved theme before paint to avoid a flash of the wrong theme. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.dataset.theme=localStorage.getItem('eventops_theme')==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}`,
          }}
        />
      </head>
      <body className="min-h-screen theme-bg theme-text">
        {user ? (
          <AppChrome userEmail={user.email} isAdmin={admin} pendingCount={pendingCount}>
            {children}
          </AppChrome>
        ) : (
          <main>{children}</main>
        )}
      </body>
    </html>
  )
}
