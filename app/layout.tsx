import type { Metadata } from 'next'
import './globals.css'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'EventOps',
  description: 'Event attendee & payment tracking',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#0a0a0a] text-white">
        <nav className="border-b border-zinc-800 bg-[#111] px-6 py-4 flex items-center gap-8">
          <span className="text-lg font-bold text-amber-400">EventOps</span>
          <Link href="/" className="text-sm text-zinc-400 hover:text-white transition-colors">Dashboard</Link>
          <Link href="/attendees" className="text-sm text-zinc-400 hover:text-white transition-colors">Attendees</Link>
          <Link href="/checklist" className="text-sm text-zinc-400 hover:text-white transition-colors">Checklist</Link>
          <Link href="/events" className="text-sm text-zinc-400 hover:text-white transition-colors">Events</Link>
        </nav>
        <main className="p-6 max-w-7xl mx-auto">{children}</main>
      </body>
    </html>
  )
}
