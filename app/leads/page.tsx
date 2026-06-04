'use client'
import { useEffect, useState, useCallback } from 'react'
import { peekCache, mutateCache } from '@/lib/useCachedFetch'

interface Lead {
  id: string
  name: string | null
  phone: string | null
  country_code: string | null
  owner: string
  affiliate_handle: string | null
  sources: string[]
  last_message_at: string | null
}
interface Summary {
  total: number
  affiliate: number
  kingsley: number
  byHandle: Record<string, number>
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [owner, setOwner] = useState('')
  const [handle, setHandle] = useState('')
  const [q, setQ] = useState('')
  const [importing, setImporting] = useState(false)
  const [msg, setMsg] = useState('')
  const [page, setPage] = useState(0) // 100 rows/page

  const PAGE_SIZE = 100

  const load = useCallback(() => {
    const p = new URLSearchParams()
    if (owner) p.set('owner', owner)
    if (handle) p.set('handle', handle)
    if (q) p.set('q', q)
    const cacheKey = `leads:${owner}:${handle}:${q}`
    const cached = peekCache<{ leads: Lead[]; summary: Summary }>(cacheKey)
    if (cached) { setLeads(cached.leads || []); setSummary(cached.summary || null); setLoading(false) }
    else setLoading(true)
    fetch(`/api/leads?${p.toString()}`)
      .then(r => r.json())
      .then(d => {
        setLeads(d.leads || []); setSummary(d.summary || null)
        mutateCache(cacheKey, () => ({ leads: d.leads || [], summary: d.summary || null }))
      })
      .catch(() => { if (!cached) { setLeads([]); setSummary(null) } })
      .finally(() => setLoading(false))
  }, [owner, handle, q])

  useEffect(() => {
    setPage(0) // reset to first page on any filter/search change
    const t = setTimeout(load, q ? 300 : 0) // debounce search
    return () => clearTimeout(t)
  }, [load, q])

  // Slice the current page for rendering (filters/search already applied server-side).
  const pageCount = Math.max(1, Math.ceil(leads.length / PAGE_SIZE))
  const pageLeads = leads.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  async function runImport() {
    setImporting(true); setMsg('')
    try {
      const res = await fetch('/api/leads?action=import', { method: 'POST' })
      const d = await res.json()
      setMsg(res.ok ? `✅ Imported/updated ${d.upserted} leads from seed.` : `⚠️ ${d.error || 'Import failed'}`)
      load()
    } catch {
      setMsg('⚠️ Import failed')
    } finally {
      setImporting(false)
    }
  }

  function copyCsv() {
    const lines = [['Name', 'Phone', 'Owner', 'Affiliate', 'Sources', 'Last message'].join(',')]
    for (const l of leads) {
      lines.push([
        `"${(l.name || '').replace(/"/g, '""')}"`, l.phone || '',
        l.owner, l.affiliate_handle || '', (l.sources || []).join('|'),
        l.last_message_at || '',
      ].join(','))
    }
    navigator.clipboard.writeText(lines.join('\n'))
    setMsg(`📋 Copied ${leads.length} leads to clipboard (CSV).`)
  }

  const topHandles = summary
    ? Object.entries(summary.byHandle).sort((a, b) => b[1] - a[1])
    : []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Leads</h1>
          <p className="text-sm text-zinc-400">Master CRM — tagged by affiliate or Kingsley</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={runImport} disabled={importing}
            className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg border border-zinc-700">
            {importing ? 'Importing…' : '🔄 Re-import seed'}
          </button>
          <button onClick={copyCsv}
            className="bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm px-4 py-2 rounded-lg">
            📋 Copy CSV
          </button>
        </div>
      </div>

      {msg && <div className="text-sm text-zinc-300 bg-[#111] border border-zinc-800 rounded-lg px-4 py-2">{msg}</div>}

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-3 gap-3">
          <button onClick={() => { setOwner(''); setHandle('') }}
            className={`bg-[#111] border rounded-xl p-4 text-left ${!owner ? 'border-amber-500' : 'border-zinc-800'}`}>
            <div className="text-xs text-zinc-500">Total leads</div>
            <div className="text-2xl font-bold">{summary.total.toLocaleString()}</div>
          </button>
          <button onClick={() => { setOwner('affiliate'); setHandle('') }}
            className={`bg-[#111] border rounded-xl p-4 text-left ${owner === 'affiliate' ? 'border-amber-500' : 'border-zinc-800'}`}>
            <div className="text-xs text-zinc-500">Affiliate-tagged</div>
            <div className="text-2xl font-bold text-amber-400">{summary.affiliate.toLocaleString()}</div>
          </button>
          <button onClick={() => { setOwner('kingsley'); setHandle('') }}
            className={`bg-[#111] border rounded-xl p-4 text-left ${owner === 'kingsley' ? 'border-amber-500' : 'border-zinc-800'}`}>
            <div className="text-xs text-zinc-500">Kingsley&apos;s leads</div>
            <div className="text-2xl font-bold text-blue-400">{summary.kingsley.toLocaleString()}</div>
          </button>
        </div>
      )}

      {/* Affiliate filter chips */}
      {topHandles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {topHandles.map(([h, n]) => (
            <button key={h}
              onClick={() => { setHandle(handle === h ? '' : h); setOwner('') }}
              className={`text-xs px-3 py-1.5 rounded-full border ${handle === h ? 'bg-amber-500 text-black border-amber-500 font-semibold' : 'bg-zinc-900 text-zinc-300 border-zinc-700 hover:border-zinc-500'}`}>
              {h} <span className="opacity-60">{n}</span>
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or phone…"
        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />

      {/* Table */}
      <div className="bg-[#111] border border-zinc-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-800">
          <h2 className="font-semibold text-sm">
            {loading ? 'Loading…' : `${leads.length.toLocaleString()} total`}
            {(owner || handle || q) && <span className="text-zinc-500 font-normal"> (filtered)</span>}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#111]">
              <tr className="text-left text-zinc-500 text-xs border-b border-zinc-900">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Phone</th>
                <th className="px-4 py-2">Owner</th>
                <th className="px-4 py-2">Affiliate</th>
                <th className="px-4 py-2">Sources</th>
              </tr>
            </thead>
            <tbody>
              {pageLeads.map(l => (
                <tr key={l.id} className="border-b border-zinc-900 hover:bg-zinc-900/30">
                  <td className="px-4 py-2.5 font-medium text-white whitespace-nowrap">{l.name || <span className="text-zinc-600">—</span>}</td>
                  <td className="px-4 py-2.5 text-zinc-300 whitespace-nowrap">{l.phone || '—'}</td>
                  <td className="px-4 py-2.5">
                    {l.owner === 'affiliate'
                      ? <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">affiliate</span>
                      : <span className="text-[10px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded">Kingsley</span>}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-400 whitespace-nowrap">{l.affiliate_handle || '—'}</td>
                  <td className="px-4 py-2.5 text-zinc-500 text-xs">{(l.sources || []).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        {leads.length > PAGE_SIZE && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-800 text-sm">
            <span className="text-zinc-500">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, leads.length)} of {leads.length.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 disabled:opacity-40 hover:bg-zinc-800">
                ← Prev
              </button>
              <span className="text-zinc-400">{page + 1} / {pageCount}</span>
              <button
                onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
                className="px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 disabled:opacity-40 hover:bg-zinc-800">
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
