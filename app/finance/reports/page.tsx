'use client'
import Link from 'next/link'

type Report = { slug: string; title: string }
type Section = { title: string; reports: Report[] }

const SECTIONS: Section[] = [
  {
    title: 'Financial Reports',
    reports: [
      { slug: 'profit-and-loss', title: 'Profit & Loss' },
      { slug: 'cash-flow', title: 'Cash Flow Statement' },
    ],
  },
  {
    title: 'Aging Reports',
    reports: [
      { slug: 'aged-receivables-summary', title: 'Aged Receivables Summary' },
      { slug: 'aged-receivables-detail', title: 'Aged Receivables Detail' },
      { slug: 'aged-payables-summary', title: 'Aged Payables Summary' },
      { slug: 'aged-payables-detail', title: 'Aged Payables Detail' },
    ],
  },
  {
    title: 'Sales Reports',
    reports: [
      { slug: 'invoice-summary', title: 'Invoice Summary' },
      { slug: 'sales-payment-summary', title: 'Sales Payment Summary' },
      { slug: 'sales-summary-by-customer', title: 'Sales Summary by Customer' },
    ],
  },
  {
    title: 'Purchase Reports',
    reports: [
      { slug: 'bill-summary', title: 'Bill Summary' },
      { slug: 'purchase-payment-summary', title: 'Purchase Payment Summary' },
      { slug: 'purchase-summary-by-supplier', title: 'Purchase Summary by Supplier' },
    ],
  },
]

const HEADING = 'text-sky-400 font-semibold text-sm'

function ReportCard({ slug, title }: Report) {
  return (
    <Link
      href={`/finance/reports/${slug}`}
      className="flex items-center gap-3 bg-[#111] border border-zinc-800 hover:border-sky-500 rounded-xl p-3.5 transition-colors group"
    >
      <span className="text-sky-500">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M8 13h8M8 17h6" />
        </svg>
      </span>
      <span className="text-zinc-200 text-sm group-hover:text-white">{title}</span>
    </Link>
  )
}

export default function ReportsCatalogPage() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-zinc-500">
          <Link href="/finance" className="hover:text-zinc-300">Finance</Link> / All Reports
        </p>
        <h1 className="text-xl font-bold mt-1">All Reports</h1>
        <p className="text-sm text-zinc-400">Empower your business decisions with financial reports.</p>
      </div>

      {SECTIONS.map(section => (
        <div key={section.title} className="bg-[#0f0f0f] border border-zinc-900 rounded-xl p-4">
          <h2 className={`${HEADING} mb-3`}>
            {section.title} ({section.reports.length})
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {section.reports.map(r => <ReportCard key={r.slug} {...r} />)}
          </div>
        </div>
      ))}
    </div>
  )
}
