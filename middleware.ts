import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const PUBLIC_PATHS = ['/login', '/auth/callback', '/pending', '/reset-password', '/api/notify-signup', '/checkin', '/api/checkin', '/meeting-checkin', '/api/meeting-checkin', '/survey', '/api/survey', '/briefing', '/api/telegram', '/api/affiliates/cron', '/start', '/api/prep']

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: cookiesToSet => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()
  const pathname = request.nextUrl.pathname
  const onPublic = isPublicPath(pathname)

  // Not logged in → redirect to /login (unless already on a public path)
  if (!user && !onPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  // Logged in: check approval status from DB
  if (user) {
    const { data: approval } = await supabase
      .from('user_approvals')
      .select('status, is_admin')
      .eq('email', (user.email ?? '').toLowerCase())
      .maybeSingle()

    const status = approval?.status

    // Not approved → bounce to /pending (or login if rejected)
    if (status !== 'approved') {
      if (pathname === '/pending' || pathname === '/login') {
        return response
      }
      const url = request.nextUrl.clone()
      url.pathname = status === 'rejected' ? '/login' : '/pending'
      url.search = ''
      if (status === 'rejected') url.searchParams.set('error', 'rejected')
      return NextResponse.redirect(url)
    }

    // Pass is_admin to downstream via response header
    response.headers.set('x-is-admin', approval?.is_admin ? '1' : '0')

    // Approved + on /login → bounce to home (or `next`)
    if (pathname === '/login') {
      const url = request.nextUrl.clone()
      url.pathname = request.nextUrl.searchParams.get('next') || '/'
      url.search = ''
      return NextResponse.redirect(url)
    }

    // Approved + on /pending → bounce to home
    if (pathname === '/pending') {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      url.search = ''
      return NextResponse.redirect(url)
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|html)$).*)'],
}
