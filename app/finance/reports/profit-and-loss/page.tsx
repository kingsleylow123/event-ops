'use client'
import { useCallback, useEffect, useState } from 'react'
import ReportLayout, { type ReportFilters } from '@/components/finance/ReportLayout'
import type { PLPayload, PLSection } from './types'

const fmt = (n: number) =>
  `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function pct(part: number, whole: number): string {
  if (!whole) return '—'
  return ((part / whole) * 100).toFixed(2)
}

function fmtRange(from: string, to: string, lifetime: boolean): string {
  if (lifetime) return 'All time'
  const d = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`
  return `${d(from)} – ${d(to)}`
}

const todayDisplay = () => {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-MY', { month: 'short' })} ${d.getFullYear()}`
}

export default function ProfitAndLossPage() {
  const [data, setData] = useState<PLPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState<ReportFilters | null>(null)

  const onFilters = useCallback((f: ReportFilters) => setFilters(f), [])

  useEffect(() => {
    if (!filters) return
    const ctrl = new AbortController()
    let ignore = false
    setLoading(true)
    ;(async () => {
      try {
        const qs = new URLSearchParams({
          event_id: filters.scope,
          from: filters.from,
          to: filters.to,
          ...(filters.lifetime ? { lifetime: '1' } : {}),
        })
        const res = await fetch(
          `/api/finance/reports/profit-and-loss?${qs}`,
          { cache: 'no-store', signal: ctrl.signal },
        )
        if (!ignore && res.ok) setData(await res.json())
      } catch {
        // keep prior data on abort/error
      } finally {
        if (!ignore) setLoading(false)
      }
    })()
    return () => { ignore = true; ctrl.abort() }
  }, [filters])

  const incomeTotal = data?.income.total ?? 0
  const cosTotal    = data?.cost_of_sales.total ?? 0
  const grossProfit = data?.gross_profit ?? 0
  const opexTotal   = data?.operating_expense.total ?? 0
  const net         = data?.net ?? 0

  const renderSection = (section: PLSection | undefined, keyPrefix: string) => {
    if (!section) return null
    if (section.lines.length === 0) {
      return <tr><td colSpan={4} className="py-1 text-zinc-600 text-xs">No items in this period.</td></tr>
    }
    return section.lines.map(l => (
      <tr key={`${keyPrefix}-${l.code}-${l.name}`}>
        <td className="py-1 text-sky-400">{l.code}</td>
        <td className="py-1 text-sky-400">{l.name}</td>
        <td className="py-1 text-right text-zinc-200 font-mono whitespace-nowrap">{fmt(l.amount)}</td>
        <td className="py-1 text-right text-zinc-500 no-print">{pct(l.amount, incomeTotal)}</td>
      </tr>
    ))
  }

  return (
    <ReportLayout title="Profit & Loss" subtitle={data?.scope_label} onFilters={onFilters}>
      <div className="no-print flex justify-end mb-2">
        <button onClick={() => window.print()} disabled={!data}
          className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-amber-400 hover:border-amber-500 disabled:opacity-50">
          Print PDF
        </button>
      </div>

      {/* Print-only branded header */}
      <div className="print-only" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: '12px', borderBottom: '0.5px solid #d4d4d8' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/claude-logo.jpg" alt="Claude Malaysia" width={32} height={32} style={{ borderRadius: '8px', display: 'block' }} />
            <div>
              <p style={{ margin: 0, fontSize: '14px', fontWeight: 500 }}>Claude Malaysia</p>
              <p className="print-amber" style={{ margin: '2px 0 0', fontSize: '9px', fontWeight: 500, letterSpacing: '0.08em' }}>EVENTOPS</p>
            </div>
          </div>
          <div className="print-muted" style={{ textAlign: 'right', fontSize: '10px', lineHeight: 1.4 }}>
            <p style={{ margin: 0 }}>Generated {todayDisplay()}</p>
            <p style={{ margin: '2px 0 0' }}>All figures in MYR (RM)</p>
          </div>
        </div>
        <div style={{ textAlign: 'center', padding: '14px 0 2px' }}>
          <p style={{ margin: 0, fontSize: '16px', fontWeight: 500 }}>Profit &amp; Loss Statement</p>
          <p style={{ margin: '4px 0 0', fontSize: '12px' }}>{data?.scope_label ?? ''}</p>
          <p className="print-muted" style={{ margin: '2px 0 0', fontSize: '10px' }}>
            {data ? fmtRange(data.from, data.to, !!filters?.lifetime) : ''} · Accrual basis
          </p>
        </div>
      </div>

      {loading && !data ? (
        <p className="text-center text-zinc-500 text-sm py-8">Loading…</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="no-print">
            <tr className="border-b border-zinc-800 text-zinc-400">
              <th className="text-left py-2 font-medium w-16"></th>
              <th className="text-left py-2 font-medium"></th>
              <th className="text-right py-2 font-medium whitespace-nowrap">
                {filters?.lifetime ? 'All time' : data ? `${data.from} → ${data.to}` : ''}
              </th>
              <th className="text-right py-2 font-medium w-16">%</th>
            </tr>
          </thead>
          <tbody>
            {/* INCOME */}
            <tr><td colSpan={4} className="pt-4 pb-1.5 font-semibold text-zinc-100">INCOME</td></tr>
            {renderSection(data?.income, 'i')}
            <tr className="border-t border-zinc-800">
              <td colSpan={2} className="py-2 font-semibold text-zinc-100">Total income</td>
              <td className="py-2 text-right font-semibold text-zinc-100 font-mono whitespace-nowrap">{fmt(incomeTotal)}</td>
              <td className="py-2 text-right text-zinc-400 no-print">{incomeTotal ? '100.00' : '—'}</td>
            </tr>

            {/* COST OF SALES */}
            <tr><td colSpan={4} className="pt-4 pb-1.5 font-semibold text-zinc-100">LESS: COST OF SALES</td></tr>
            {renderSection(data?.cost_of_sales, 'c')}
            <tr className="border-t border-zinc-800">
              <td colSpan={2} className="py-2 font-semibold text-zinc-100">Total cost of sales</td>
              <td className="py-2 text-right font-semibold text-zinc-100 font-mono whitespace-nowrap">{fmt(cosTotal)}</td>
              <td className="py-2 text-right text-zinc-400 no-print">{pct(cosTotal, incomeTotal)}</td>
            </tr>

            {/* GROSS PROFIT */}
            <tr>
              <td colSpan={2} className="pt-3 py-1.5 font-semibold text-zinc-100">GROSS PROFIT</td>
              <td className="pt-3 py-1.5 text-right font-semibold text-zinc-100 font-mono whitespace-nowrap">{fmt(grossProfit)}</td>
              <td className="pt-3 py-1.5 text-right text-zinc-400 no-print">{pct(grossProfit, incomeTotal)}</td>
            </tr>

            {/* OPERATING EXPENSES */}
            <tr><td colSpan={4} className="pt-4 pb-1.5 font-semibold text-zinc-100">LESS: OPERATING EXPENSES</td></tr>
            {renderSection(data?.operating_expense, 'o')}
            <tr className="border-t border-zinc-800">
              <td colSpan={2} className="py-2 font-semibold text-zinc-100">Total operating expenses</td>
              <td className="py-2 text-right font-semibold text-zinc-100 font-mono whitespace-nowrap">{fmt(opexTotal)}</td>
              <td className="py-2 text-right text-zinc-400 no-print">{pct(opexTotal, incomeTotal)}</td>
            </tr>

            {/* NET PROFIT */}
            <tr className="border-t-2 border-zinc-700 print-net">
              <td colSpan={2} className="py-3 font-semibold text-zinc-100">NET PROFIT</td>
              <td className={`py-3 text-right font-semibold font-mono whitespace-nowrap ${net >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {fmt(net)}
              </td>
              <td className="py-3 text-right text-zinc-400 no-print">{pct(net, incomeTotal)}</td>
            </tr>
          </tbody>
        </table>
      )}

      {/* Print-only signature block */}
      <div className="print-only print-keep" style={{ marginTop: '22px', paddingTop: '12px', borderTop: '0.5px dashed #d4d4d8', display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
        <div>
          <p className="print-muted" style={{ margin: 0 }}>Prepared by</p>
          <p style={{ margin: '18px 0 0' }}>_______________________</p>
          <p style={{ margin: '2px 0 0', fontWeight: 500 }}>Huda</p>
          <p className="print-muted" style={{ margin: '1px 0 0' }}>Finance, Claude Malaysia</p>
          <p className="print-muted" style={{ margin: '6px 0 0' }}>Date: ____________</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p className="print-muted" style={{ margin: 0 }}>Approved by</p>
          <p style={{ margin: '18px 0 0' }}>_______________________</p>
          <p style={{ margin: '2px 0 0', fontWeight: 500 }}>Kingsley Low</p>
          <p className="print-muted" style={{ margin: '1px 0 0' }}>Founder, Claude Malaysia</p>
          <p className="print-muted" style={{ margin: '6px 0 0' }}>Date: ____________</p>
        </div>
      </div>
    </ReportLayout>
  )
}
