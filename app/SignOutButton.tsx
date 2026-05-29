'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

export default function SignOutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  return (
    <button
      disabled={pending}
      onClick={async () => {
        setPending(true)
        const supabase = createSupabaseBrowserClient()
        await supabase.auth.signOut()
        router.push('/login')
        router.refresh()
      }}
      className="text-xs text-zinc-400 hover:text-amber-400 disabled:opacity-50"
    >
      Sign out
    </button>
  )
}
