'use client'
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import PasswordInput from '../PasswordInput'

type Status = 'pending' | 'approved' | 'rejected'

interface ProfileInfo {
  email: string
  status: Status | 'unknown'
  is_admin: boolean
  created_at: string | null
}

export default function ProfilePage() {
  const [info, setInfo] = useState<ProfileInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    (async () => {
      const supabase = createSupabaseBrowserClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      const { data: approval } = await supabase
        .from('user_approvals')
        .select('status, is_admin')
        .eq('email', (user.email ?? '').toLowerCase())
        .maybeSingle()
      setInfo({
        email: user.email ?? '',
        status: (approval?.status as Status) ?? 'unknown',
        is_admin: approval?.is_admin ?? false,
        created_at: user.created_at,
      })
      setLoading(false)
    })()
  }, [])

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)

    if (newPassword.length < 6) {
      setMessage({ kind: 'error', text: 'New password must be at least 6 characters.' })
      return
    }
    if (newPassword !== confirmPassword) {
      setMessage({ kind: 'error', text: "New passwords don't match." })
      return
    }
    if (!info?.email) return

    setSaving(true)
    const supabase = createSupabaseBrowserClient()

    // Verify current password by attempting a sign-in (Supabase JS has no checkPassword API).
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: info.email,
      password: currentPassword,
    })
    if (signInError) {
      setMessage({ kind: 'error', text: 'Current password is incorrect.' })
      setSaving(false)
      return
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
    if (updateError) {
      setMessage({ kind: 'error', text: updateError.message })
      setSaving(false)
      return
    }

    setMessage({ kind: 'info', text: 'Password updated.' })
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setSaving(false)
  }

  if (loading) return <div className="text-zinc-500 mt-20 text-center">Loading…</div>
  if (!info) return <div className="text-zinc-500 mt-20 text-center">Not signed in.</div>

  const STATUS_COLORS: Record<string, string> = {
    pending: 'bg-yellow-900/40 text-yellow-400 border border-yellow-800',
    approved: 'bg-green-900/40 text-green-400 border border-green-800',
    rejected: 'bg-red-900/40 text-red-400 border border-red-800',
    unknown: 'bg-zinc-800 text-zinc-400 border border-zinc-700',
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold">Profile</h1>
        <p className="text-sm text-zinc-500 mt-1">Your account details and password</p>
      </div>

      <section className="bg-[#111] border border-zinc-800 rounded-xl p-5 space-y-3">
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-0.5">Email</p>
          <p className="text-white">{info.email}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[info.status]}`}>{info.status}</span>
          {info.is_admin && <span className="text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full">Admin</span>}
        </div>
        {info.created_at && (
          <p className="text-xs text-zinc-500">Joined {new Date(info.created_at).toLocaleDateString('en-MY', { dateStyle: 'medium' })}</p>
        )}
      </section>

      <section className="bg-[#111] border border-zinc-800 rounded-xl p-5">
        <h2 className="font-semibold mb-3">Change password</h2>
        <form onSubmit={changePassword} className="space-y-3">
          <PasswordInput value={currentPassword} onChange={setCurrentPassword}
            placeholder="Current password" required autoComplete="current-password" />
          <PasswordInput value={newPassword} onChange={setNewPassword}
            placeholder="New password (min 6 chars)" required minLength={6} autoComplete="new-password" />
          <PasswordInput value={confirmPassword} onChange={setConfirmPassword}
            placeholder="Confirm new password" required minLength={6} autoComplete="new-password" />
          {message && (
            <p className={`text-xs ${message.kind === 'error' ? 'text-red-400' : 'text-emerald-400'}`}>{message.text}</p>
          )}
          <button disabled={saving} type="submit"
            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold px-4 py-2 rounded-lg text-sm">
            {saving ? 'Saving…' : 'Update password'}
          </button>
        </form>
      </section>
    </div>
  )
}
