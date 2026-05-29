'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import PasswordInput from '../PasswordInput'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setMessage({ kind: 'error', text: 'Passwords do not match.' })
      return
    }
    if (password.length < 6) {
      setMessage({ kind: 'error', text: 'Password must be at least 6 characters.' })
      return
    }
    setLoading(true)
    setMessage(null)
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setMessage({ kind: 'error', text: error.message })
      setLoading(false)
      return
    }
    setMessage({ kind: 'info', text: 'Password updated! Redirecting to sign in…' })
    setTimeout(() => router.push('/login'), 2000)
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-[#111] border border-zinc-800 rounded-xl p-6">
        <h1 className="text-xl font-bold mb-1 text-amber-400">EventOps</h1>
        <p className="text-sm text-zinc-500 mb-6">Set your new password</p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <PasswordInput
            value={password} onChange={setPassword}
            placeholder="New password" required minLength={6}
            autoComplete="new-password" />
          <PasswordInput
            value={confirm} onChange={setConfirm}
            placeholder="Confirm new password" required minLength={6}
            autoComplete="new-password" />
          {message && (
            <p className={`text-xs ${message.kind === 'error' ? 'text-red-400' : 'text-emerald-400'}`}>
              {message.text}
            </p>
          )}
          <button disabled={loading} type="submit"
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold py-2 rounded-lg text-sm">
            {loading ? 'Saving…' : 'Set new password'}
          </button>
        </form>
      </div>
    </div>
  )
}
