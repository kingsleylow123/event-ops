'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import PasswordInput from '../PasswordInput'

function LoginForm() {
  const router = useRouter()
  const search = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const err = search.get('error')
    if (err === 'unauthorized') {
      setMessage({ kind: 'error', text: 'This email is not authorised. Contact the admin.' })
    } else if (err === 'rejected') {
      setMessage({ kind: 'error', text: 'Your account request was rejected by the admin.' })
    } else if (err === 'pending') {
      setMessage({ kind: 'info', text: 'Your account is awaiting admin approval.' })
    }
  }, [search])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    const supabase = createSupabaseBrowserClient()

    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      })
      if (error) {
        setMessage({ kind: 'error', text: error.message })
      } else {
        setMessage({
          kind: 'info',
          text: 'Check your email and click the confirmation link to finish creating your account.',
        })
      }
      setLoading(false)
      return
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setMessage({ kind: 'error', text: error.message })
      setLoading(false)
      return
    }
    const next = search.get('next') || '/'
    router.push(next)
    router.refresh()
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-[#111] border border-zinc-800 rounded-xl p-6">
        <h1 className="text-xl font-bold mb-1 text-amber-400">EventOps</h1>
        <p className="text-sm text-zinc-500 mb-6">
          {mode === 'signin' ? 'Sign in to continue' : 'Create your account'}
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input required type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="Email" autoComplete="email"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
          <PasswordInput
            value={password} onChange={setPassword}
            placeholder="Password" required minLength={6}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
          {message && (
            <p className={`text-xs ${message.kind === 'error' ? 'text-red-400' : 'text-emerald-400'}`}>
              {message.text}
            </p>
          )}
          <button disabled={loading} type="submit"
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold py-2 rounded-lg text-sm">
            {loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <button onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMessage(null) }}
          className="text-xs text-zinc-500 hover:text-amber-400 mt-4 w-full text-center">
          {mode === 'signin' ? "First time? Create your account" : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="text-zinc-500 mt-20 text-center">Loading…</div>}>
      <LoginForm />
    </Suspense>
  )
}
