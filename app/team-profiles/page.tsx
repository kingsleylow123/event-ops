'use client'
import { Fragment, useEffect, useMemo, useState } from 'react'

type Profile = {
  id: string
  full_name: string
  phone: string
  email: string
  instagram_url: string
  github_username: string
  telegram_username: string
  telegram_id: string
  bank_account_name: string
  bank_name: string
  bank_account_number: string
  company_name: string | null
  portfolio_url: string | null
  created_at: string
}

function fmtDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-MY', { day: '2-digit', month: 'short' })
}

function fmtDateLong(iso: string): string {
  return new Date(iso).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function TeamProfilesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/team-survey', { cache: 'no-store' })
      .then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}))
          throw new Error(d.error ?? `HTTP ${r.status}`)
        }
        return r.json()
      })
      .then((d: { profiles: Profile[] }) => setProfiles(d.profiles))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const totals = useMemo(() => {
    const now = Date.now()
    const WEEK = 7 * 24 * 60 * 60 * 1000
    return {
      total: profiles.length,
      this_week: profiles.filter(p => now - new Date(p.created_at).getTime() < WEEK).length,
      with_company: profiles.filter(p => p.company_name).length,
    }
  }, [profiles])

  const q = query.trim().toLowerCase()
  const filtered = !q
    ? profiles
    : profiles.filter(p =>
        [p.full_name, p.email, p.phone, p.bank_name, p.telegram_username, p.github_username, p.company_name ?? '']
          .join(' ')
          .toLowerCase()
          .includes(q),
      )

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(c => (c === key ? null : c)), 1200)
  }

  function copyBank(p: Profile) {
    const text = `${p.bank_account_name}\n${p.bank_name}\n${p.bank_account_number}`
    copy(text, `bank-${p.id}`)
  }

  if (loading) return <div className="text-zinc-500 text-center py-12">Loading…</div>

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">👥 Team Profiles</h1>
          <p className="text-xs text-zinc-500">
            Submissions from{' '}
            <a href="/team-survey" target="_blank" className="text-amber-400 hover:underline">
              /team-survey
            </a>{' '}
            — payroll, comms and contact details
          </p>
        </div>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search name, email, bank, handle…"
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm w-full sm:w-72 focus:outline-none focus:border-amber-500/50"
        />
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-[#111] border border-red-900/40 rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      {/* Totals strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-[#111] border border-zinc-800 rounded-xl p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Total profiles</p>
          <p className="text-2xl font-bold">{totals.total}</p>
        </div>
        <div className="bg-[#111] border border-amber-500/40 rounded-xl p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Last 7 days</p>
          <p className="text-2xl font-bold text-amber-400">{totals.this_week}</p>
        </div>
        <div className="bg-[#111] border border-zinc-800 rounded-xl p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">With company</p>
          <p className="text-2xl font-bold text-zinc-400">{totals.with_company}</p>
        </div>
      </div>

      {/* Profiles table */}
      {filtered.length === 0 ? (
        <div className="text-zinc-500 text-sm bg-[#111] border border-zinc-800 rounded-xl p-5">
          {profiles.length === 0
            ? <>No submissions yet. Share the link <a href="/team-survey" target="_blank" className="text-amber-400 hover:underline">/team-survey</a> with your team.</>
            : 'No matches for your search.'}
        </div>
      ) : (
        <div className="bg-[#111] border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
                  <th className="px-4 py-3 w-6"></th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Handles</th>
                  <th className="px-4 py-3">Bank Details</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const isOpen = expanded.has(p.id)
                  return (
                    <Fragment key={p.id}>
                      <tr className="border-b border-zinc-900 hover:bg-zinc-900/40">
                        <td className="px-4 py-3 align-top">
                          <button
                            onClick={() => toggleExpand(p.id)}
                            title={isOpen ? 'Hide details' : 'Show details'}
                            className="text-zinc-500 hover:text-amber-400 text-sm"
                          >
                            {isOpen ? '▾' : '▸'}
                          </button>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="font-semibold text-white flex items-center gap-2 flex-wrap">
                            {p.full_name}
                            {p.company_name && (
                              <span className="text-[10px] bg-amber-500/15 text-amber-300 px-1.5 py-0.5 rounded">
                                {p.company_name}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-zinc-500">
                            Submitted {fmtDateShort(p.created_at)}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top text-xs">
                          <div className="text-zinc-300">{p.phone}</div>
                          <div className="text-zinc-500 truncate max-w-[200px]" title={p.email}>{p.email}</div>
                        </td>
                        <td className="px-4 py-3 align-top text-xs">
                          <div className="space-y-1 leading-tight">
                            <div>
                              <span className="text-zinc-500 mr-1">Instagram</span>
                              <a href={p.instagram_url} target="_blank" rel="noopener noreferrer" className="text-zinc-200 hover:text-amber-400">
                                open ↗
                              </a>
                            </div>
                            <div>
                              <span className="text-zinc-500 mr-1">GitHub</span>
                              <a href={`https://github.com/${p.github_username}`} target="_blank" rel="noopener noreferrer" className="text-zinc-200 hover:text-amber-400">
                                @{p.github_username}
                              </a>
                            </div>
                            <div>
                              <span className="text-zinc-500 mr-1">Telegram</span>
                              <span className="text-zinc-200">{p.telegram_username}</span>
                              <span className="text-zinc-600 mx-1">·</span>
                              <span className="text-zinc-400 tabular-nums">{p.telegram_id}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top text-xs">
                          <div className="leading-tight">
                            <div className="text-zinc-300 font-medium">{p.bank_name}</div>
                            <div className="text-zinc-400 tabular-nums">{p.bank_account_number}</div>
                            <div className="text-zinc-500">{p.bank_account_name}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top text-right">
                          <button
                            onClick={() => copyBank(p)}
                            className="text-xs text-zinc-400 hover:text-amber-400 border border-zinc-700 hover:border-amber-500/40 rounded px-2 py-1 transition"
                            title="Copy bank details"
                          >
                            {copied === `bank-${p.id}` ? '✓ Copied' : '📋 Bank'}
                          </button>
                        </td>
                      </tr>

                      {isOpen && (
                        <tr className="border-b border-zinc-900 bg-zinc-950/50">
                          <td></td>
                          <td colSpan={5} className="px-4 py-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-xs">
                              <DetailRow label="Full name" value={p.full_name} onCopy={() => copy(p.full_name, `name-${p.id}`)} copied={copied === `name-${p.id}`} />
                              <DetailRow label="Phone" value={p.phone} onCopy={() => copy(p.phone, `phone-${p.id}`)} copied={copied === `phone-${p.id}`} />
                              <DetailRow label="Email" value={p.email} onCopy={() => copy(p.email, `email-${p.id}`)} copied={copied === `email-${p.id}`} link={`mailto:${p.email}`} />
                              <DetailRow label="Instagram" value={p.instagram_url} link={p.instagram_url} />
                              <DetailRow label="GitHub" value={p.github_username} link={`https://github.com/${p.github_username}`} />
                              <DetailRow label="Telegram username" value={p.telegram_username} />
                              <DetailRow label="Telegram ID" value={p.telegram_id} onCopy={() => copy(p.telegram_id, `tg-${p.id}`)} copied={copied === `tg-${p.id}`} />
                              <DetailRow label="Account holder" value={p.bank_account_name} />
                              <DetailRow label="Bank" value={p.bank_name} />
                              <DetailRow label="Account number" value={p.bank_account_number} onCopy={() => copy(p.bank_account_number, `acc-${p.id}`)} copied={copied === `acc-${p.id}`} />
                              {p.portfolio_url && <DetailRow label="Portfolio" value={p.portfolio_url} link={p.portfolio_url} />}
                              <DetailRow label="Submitted" value={fmtDateLong(p.created_at)} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function DetailRow({
  label, value, link, onCopy, copied,
}: {
  label: string
  value: string
  link?: string
  onCopy?: () => void
  copied?: boolean
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-0.5 flex items-center gap-2">
        <span>{label}</span>
        {onCopy && (
          <button
            type="button"
            onClick={onCopy}
            className="text-[10px] text-zinc-600 hover:text-amber-400"
          >
            {copied ? '✓' : 'copy'}
          </button>
        )}
      </div>
      {link ? (
        <a href={link} target="_blank" rel="noopener noreferrer" className="block truncate text-zinc-200 hover:text-amber-400">
          {value}
        </a>
      ) : (
        <span className="block truncate text-zinc-200">{value}</span>
      )}
    </div>
  )
}
