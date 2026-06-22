'use client'
import { useCallback, useEffect, useState } from 'react'
import ReportLayout, { type ReportFilters } from '@/components/finance/ReportLayout'
import type { PLPayload } from './types'

const fmt = (n: number) =>
  `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function pct(part: number, whole: number): string {
  if (!whole) return '—'
  return ((part / whole) * 100).toFixed(2)
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
  const expenseTotal = data?.expense.total ?? 0
  const grossPct = pct(incomeTotal, incomeTotal)

  return (
    <ReportLayout title="Profit & Loss" subtitle={data?.scope_label} onFilters={onFilters}>
      {loading && !data ? (
        <p className="text-center text-zinc-500 text-sm py-8">Loading…</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
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
            {data?.income.lines.map(l => (
              <tr key={`i-${l.code}-${l.name}`}>
                <td className="py-1 text-sky-400">{l.code}</td>
                <td className="py-1 text-sky-400">{l.name}</td>
                <td className="py-1 text-right text-zinc-200 font-mono whitespace-nowrap">{fmt(l.amount)}</td>
                <td className="py-1 text-right text-zinc-500">{pct(l.amount, incomeTotal)}</td>
              </tr>
            ))}
            {data?.income.lines.length === 0 && (
              <tr><td colSpan={4} className="py-1 text-zinc-600 text-xs">No income in this period.</td></tr>
            )}
            <tr className="border-t border-zinc-800">
              <td colSpan={2} className="py-2 font-semibold text-zinc-100">TOTAL</td>
              <td className="py-2 text-right font-semibold text-zinc-100 font-mono whitespace-nowrap">{fmt(incomeTotal)}</td>
              <td className="py-2 text-right text-zinc-400">{incomeTotal ? '100.00' : '—'}</td>
            </tr>

            {/* GROSS PROFIT (same as Income since EventOps has no Cost of Sales) */}
            <tr>
              <td colSpan={2} className="pt-3 py-1.5 font-semibold text-zinc-100">GROSS PROFIT</td>
              <td className="pt-3 py-1.5 text-right font-semibold text-zinc-100 font-mono whitespace-nowrap">{fmt(incomeTotal)}</td>
              <td className="pt-3 py-1.5 text-right text-zinc-400">{grossPct}</td>
            </tr>

            {/* EXPENSES */}
            <tr><td colSpan={4} className="pt-4 pb-1.5 font-semibold text-zinc-100">LESS: EXPENSES</td></tr>
            {data?.expense.lines.map(l => (
              <tr key={`e-${l.code}-${l.name}`}>
                <td className="py-1 text-sky-400">{l.code}</td>
                <td className="py-1 text-sky-400">{l.name}</td>
                <td className="py-1 text-right text-zinc-200 font-mono whitespace-nowrap">{fmt(l.amount)}</td>
                <td className="py-1 text-right text-zinc-500">{pct(l.amount, incomeTotal)}</td>
              </tr>
            ))}
            {data?.expense.lines.length === 0 && (
              <tr><td colSpan={4} className="py-1 text-zinc-600 text-xs">No expenses in this period.</td></tr>
            )}
            <tr className="border-t border-zinc-800">
              <td colSpan={2} className="py-2 font-semibold text-zinc-100">TOTAL</td>
              <td className="py-2 text-right font-semibold text-zinc-100 font-mono whitespace-nowrap">{fmt(expenseTotal)}</td>
              <td className="py-2 text-right text-zinc-400">{pct(expenseTotal, incomeTotal)}</td>
            </tr>

            {/* NET PROFIT */}
            <tr className="border-t-2 border-zinc-700">
              <td colSpan={2} className="py-3 font-semibold text-zinc-100">NET PROFIT</td>
              <td className={`py-3 text-right font-semibold font-mono whitespace-nowrap ${(data?.net ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {fmt(data?.net ?? 0)}
              </td>
              <td className="py-3 text-right text-zinc-400">{pct(data?.net ?? 0, incomeTotal)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </ReportLayout>
  )
}
