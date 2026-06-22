'use client'
import { useCallback, useState } from 'react'
import ReportLayout, { type ReportFilters } from '@/components/finance/ReportLayout'

export default function StubReport({ title }: { title: string }) {
  const [, setFilters] = useState<ReportFilters | null>(null)
  const onFilters = useCallback((f: ReportFilters) => setFilters(f), [])

  return (
    <ReportLayout title={title} subtitle="EventOps" onFilters={onFilters}>
      <div className="text-center py-12 space-y-2">
        <p className="text-zinc-400 text-sm">Coming soon.</p>
        <p className="text-zinc-600 text-xs">P&amp;L is live — the rest land next.</p>
      </div>
    </ReportLayout>
  )
}
