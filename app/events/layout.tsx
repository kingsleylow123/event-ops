import type { Metadata } from 'next'
import { Fraunces, Hanken_Grotesk, IBM_Plex_Mono } from 'next/font/google'

// Editorial serif display + warm grotesk body + mono micro-labels — the Claude /
// Anthropic "warm paper" voice, scoped to the public events page only.
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  style: ['normal', 'italic'],
  display: 'swap',
})
const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-hanken',
  display: 'swap',
})
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Events — Claude Malaysia',
  description:
    'Hands-on Claude AI workshops and community events across Malaysia. Find the next workshop, see what you’ll build, and claim your seat before the early-bird seats run out.',
  openGraph: {
    title: 'Events — Claude Malaysia',
    description:
      'Hands-on AI workshops and community nights across Malaysia. See the next one and reserve your seat.',
    images: ['/claude-logo.jpg'],
    type: 'website',
  },
}

export default function EventsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${fraunces.variable} ${hanken.variable} ${plexMono.variable}`}>
      {children}
    </div>
  )
}
