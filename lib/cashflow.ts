// Shared contract for the Cashflow Sankey (/cashflow + /api/cashflow).
// Pure types + builder only — safe to import on both server and client.
//
// Flow shape: income sources (depth 0) → Total Revenue (depth 1) →
// expense categories + Net Profit (depth 2). Cash basis — the caller passes
// only money that actually moved. On a loss window a "Reserves / prior cash"
// source (depth 0) funds the shortfall so inflow == outflow and every outflow
// ribbon still has revenue to draw from.

import { r2, type Row } from '@/lib/finance'

export type SankeyDepth = 0 | 1 | 2
export type SankeyKind = 'income' | 'revenue' | 'expense' | 'net' | 'reserve'

export type SankeyNode = {
  id: string
  label: string
  value: number
  depth: SankeyDepth
  kind: SankeyKind
}

export type SankeyLink = {
  source: string // node id
  target: string // node id
  value: number
}

export type CashflowPeriod = 'all' | 'month' | '30' | '90'

export type CashflowData = {
  scope: string // 'all' | event id
  scope_label: string
  period: CashflowPeriod
  nodes: SankeyNode[]
  links: SankeyLink[]
  totals: { in: number; out: number; net: number }
}

export const REVENUE_ID = 'revenue'
export const NET_ID = 'net'
export const RESERVE_ID = 'reserve'

// Build Sankey nodes + links from grouped income & expense line items.
export function buildSankey(incomeRows: Row[], expenseRows: Row[]): {
  nodes: SankeyNode[]
  links: SankeyLink[]
  totals: { in: number; out: number; net: number }
} {
  const income = (incomeRows ?? []).filter(r => r.amount > 0)
  const expense = (expenseRows ?? []).filter(r => r.amount > 0)

  const totalIn = r2(income.reduce((s, r) => s + r.amount, 0))
  const totalOut = r2(expense.reduce((s, r) => s + r.amount, 0))
  const net = r2(totalIn - totalOut)

  const nodes: SankeyNode[] = []
  const links: SankeyLink[] = []

  // depth-0 income sources → revenue
  income.forEach((r, i) => {
    const id = `in:${i}:${r.category}`
    nodes.push({ id, label: r.category, value: r.amount, depth: 0, kind: 'income' })
    links.push({ source: id, target: REVENUE_ID, value: r.amount })
  })

  // Loss window: a reserves source funds the gap so the central node can still
  // cover every outflow ribbon. Kept out of the income total deliberately.
  const shortfall = net < 0 ? r2(-net) : 0
  if (shortfall > 0) {
    nodes.push({ id: RESERVE_ID, label: 'Reserves / prior cash', value: shortfall, depth: 0, kind: 'reserve' })
    links.push({ source: RESERVE_ID, target: REVENUE_ID, value: shortfall })
  }

  // depth-1 central node — sized to whatever flows through it
  const throughput = r2(totalIn + shortfall)
  nodes.push({ id: REVENUE_ID, label: 'Total Revenue', value: throughput, depth: 1, kind: 'revenue' })

  // depth-2 expense categories
  expense.forEach((r, i) => {
    const id = `out:${i}:${r.category}`
    nodes.push({ id, label: r.category, value: r.amount, depth: 2, kind: 'expense' })
    links.push({ source: REVENUE_ID, target: id, value: r.amount })
  })

  // depth-2 net profit (only when positive — a loss is shown via reserves instead)
  if (net > 0) {
    nodes.push({ id: NET_ID, label: 'Net Profit', value: net, depth: 2, kind: 'net' })
    links.push({ source: REVENUE_ID, target: NET_ID, value: net })
  }

  return { nodes, links, totals: { in: totalIn, out: totalOut, net } }
}
