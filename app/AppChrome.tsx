'use client'
import { usePathname } from 'next/navigation'
import Sidebar from './Sidebar'

// Marketing routes render full-bleed (no app sidebar / no padded container) even
// for logged-in admins, so the public page looks like a standalone site rather
// than an internal tool. Public (logged-out) visitors never hit this — the root
// layout already renders a bare <main> for them.
const isFullBleed = (pathname: string) => pathname === '/events'

export default function AppChrome({
  userEmail,
  isAdmin,
  pendingCount,
  children,
}: {
  userEmail: string | undefined
  isAdmin: boolean
  pendingCount: number
  children: React.ReactNode
}) {
  const pathname = usePathname()

  if (isFullBleed(pathname)) return <>{children}</>

  return (
    <>
      <Sidebar userEmail={userEmail} isAdmin={isAdmin} pendingCount={pendingCount} />
      <main className="lg:pl-64">
        <div className="p-3 sm:p-6 max-w-7xl mx-auto">{children}</div>
      </main>
    </>
  )
}
