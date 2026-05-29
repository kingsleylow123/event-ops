'use client'
import { useEffect, useState } from 'react'
import type { UserApproval } from '@/lib/auth/admin'

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-900/40 text-yellow-400 border border-yellow-800',
  approved: 'bg-green-900/40 text-green-400 border border-green-800',
  rejected: 'bg-red-900/40 text-red-400 border border-red-800',
}

export default function AdminPage() {
  const [approvals, setApprovals] = useState<UserApproval[]>([])
  const [admin, setAdmin] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actingOn, setActingOn] = useState<string | null>(null)

  async function load() {
    setError('')
    const res = await fetch('/api/admin/approvals', { cache: 'no-store' })
    if (res.status === 403) {
      setError('You are not authorised to view this page.')
      setLoading(false)
      return
    }
    const data = await res.json()
    if (data.error) setError(data.error)
    else {
      setApprovals(data.approvals)
      setAdmin(data.admin)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function act(email: string, action: 'approve' | 'reject' | 'reset') {
    setActingOn(email + action)
    const res = await fetch('/api/admin/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, action }),
    })
    if (res.ok) await load()
    else {
      const data = await res.json()
      setError(data.error ?? 'Failed')
    }
    setActingOn(null)
  }

  if (loading) return <div className="text-zinc-500 mt-20 text-center">Loading…</div>
  if (error) return <div className="text-red-400 mt-20 text-center">{error}</div>

  const pending = approvals.filter(a => a.status === 'pending')
  const decided = approvals.filter(a => a.status !== 'pending')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Admin · User Approvals</h1>
        <p className="text-sm text-zinc-500 mt-1">Signed in as {admin}</p>
      </div>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">
          Pending ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-zinc-600 italic">No pending requests.</p>
        ) : (
          <div className="space-y-2">
            {pending.map(a => (
              <div key={a.email} className="bg-[#111] border border-zinc-800 rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-white font-medium">{a.email}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Requested {new Date(a.requested_at).toLocaleString('en-MY')}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={actingOn === a.email + 'approve'}
                    onClick={() => act(a.email, 'approve')}
                    className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-semibold text-xs px-3 py-1.5 rounded-lg">
                    {actingOn === a.email + 'approve' ? '…' : 'Approve'}
                  </button>
                  <button
                    disabled={actingOn === a.email + 'reject'}
                    onClick={() => act(a.email, 'reject')}
                    className="border border-red-500/50 text-red-400 hover:bg-red-500/10 disabled:opacity-50 text-xs px-3 py-1.5 rounded-lg">
                    {actingOn === a.email + 'reject' ? '…' : 'Reject'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">
          Decided ({decided.length})
        </h2>
        {decided.length === 0 ? (
          <p className="text-sm text-zinc-600 italic">No decisions yet.</p>
        ) : (
          <div className="space-y-2">
            {decided.map(a => (
              <div key={a.email} className="bg-[#111] border border-zinc-800 rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-white font-medium">{a.email}</p>
                    {a.is_admin && <span className="text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full">Admin</span>}
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[a.status]}`}>{a.status}</span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {a.decided_at ? `Decided ${new Date(a.decided_at).toLocaleString('en-MY')} by ${a.decided_by ?? '?'}` : '—'}
                  </p>
                </div>
                {!a.is_admin && (
                  <button
                    disabled={actingOn === a.email + 'reset'}
                    onClick={() => act(a.email, 'reset')}
                    className="text-xs text-zinc-500 hover:text-amber-400 disabled:opacity-50 border border-zinc-700 hover:border-amber-500/50 px-3 py-1.5 rounded-lg">
                    Reset to pending
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
