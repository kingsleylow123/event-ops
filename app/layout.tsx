import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import './globals.css'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { isAdminEmail } from '@/lib/auth/admin'
import AppChrome from './AppChrome'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Meta (Facebook) Pixel — traffic tracking + future retargeting.
// Same pixel as the public survey tool (claudemalaysia.com) so audiences unify.
const FB_PIXEL_ID = '3618851711751697'

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
        <Script id="fb-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${FB_PIXEL_ID}');
fbq('track', 'PageView');`}
        </Script>
        <noscript>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            height="1"
            width="1"
            style={{ display: 'none' }}
            src={`https://www.facebook.com/tr?id=${FB_PIXEL_ID}&ev=PageView&noscript=1`}
            alt=""
          />
        </noscript>
      </body>
    </html>
  )
}
