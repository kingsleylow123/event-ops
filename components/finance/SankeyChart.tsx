'use client'
import { useRef, useState, type MouseEvent } from 'react'
import { rm } from '@/lib/finance'
import { INCOME_PIE, EXPENSE_PIE } from '@/components/finance/Charts'
import type { CashflowData, SankeyNode } from '@/lib/cashflow'

// Distinct accents for the non-category nodes.
const NET_COLOR = '#10b981'      // emerald-500 — what's left
const REVENUE_COLOR = '#0ea5e9'  // sky-500 — the central pool
const RESERVE_COLOR = '#a16207'  // amber-700 — money pulled from reserves (loss)

type Pos = { x: number; y: number; h: number }

// Push a sorted list of desired label centres apart so neighbours keep at least
// `min` px of separation, kept within [top, bottom]. Prevents the long tail of
// small categories from overlapping into an unreadable stack.
function spreadLabels(centers: number[], min: number, top: number, bottom: number): number[] {
  const n = centers.length
  const y = [...centers]
  for (let i = 1; i < n; i++) if (y[i] < y[i - 1] + min) y[i] = y[i - 1] + min
  if (n > 0 && y[n - 1] > bottom) {
    y[n - 1] = bottom
    for (let i = n - 2; i >= 0; i--) if (y[i] > y[i + 1] - min) y[i] = y[i + 1] - min
  }
  if (n > 0 && y[0] < top) {
    y[0] = top
    for (let i = 1; i < n; i++) if (y[i] < y[i - 1] + min) y[i] = y[i - 1] + min
  }
  return y
}

// Pure-SVG Sankey for cash flow: income sources → Total Revenue → costs + net.
// Uniform vertical scale (one px-per-unit across all columns) so a flow of value
// v is the same thickness on both ends and across the diagram. Respects the
// revenue-hidden toggle via rm(value, hidden).
export function SankeyChart({ data, hidden = false }: { data: CashflowData; hidden?: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hoverNode, setHoverNode] = useState<string | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number; node: SankeyNode } | null>(null)

  const nodes = data?.nodes ?? []
  const links = data?.links ?? []

  if (!nodes.length || !nodes.some(n => n.value > 0)) {
    return <p className="text-sm text-zinc-500 py-10 text-center">No cash movement in this period.</p>
  }

  // ── Geometry ───────────────────────────────────────────────────────────────
  const W = 1000
  const PADX = 184          // room for side labels
  const NODE_W = 16
  const GAP = 12
  const TOP = 46            // room for the centred "Total Revenue" label
  const BOTTOM = 26

  const cols: SankeyNode[][] = [[], [], []]
  for (const n of nodes) cols[n.depth].push(n)

  const colSum = (c: SankeyNode[]) => c.reduce((s, n) => s + n.value, 0)
  const T = Math.max(colSum(cols[0]), colSum(cols[1]), colSum(cols[2]), 1)
  const maxNodes = Math.max(cols[0].length, cols[1].length, cols[2].length, 1)

  const H = Math.max(300, maxNodes * 50 + TOP + BOTTOM)
  const plotH = H - TOP - BOTTOM
  const pxPerUnit = (plotH - (maxNodes - 1) * GAP) / T

  const colX = [PADX, (W - NODE_W) / 2, W - PADX - NODE_W]

  // Lay out each column's nodes, vertically centred within the plot area.
  const pos: Record<string, Pos> = {}
  cols.forEach((c, ci) => {
    const stackH = colSum(c) * pxPerUnit + Math.max(0, c.length - 1) * GAP
    let y = TOP + (plotH - stackH) / 2
    for (const n of c) {
      const h = Math.max(2, n.value * pxPerUnit)
      pos[n.id] = { x: colX[ci], y, h }
      y += h + GAP
    }
  })

  // Colour per node.
  const colorOf: Record<string, string> = {}
  let inc = 0, exp = 0
  for (const n of nodes) {
    if (n.kind === 'income') colorOf[n.id] = INCOME_PIE[inc++ % INCOME_PIE.length]
    else if (n.kind === 'expense') colorOf[n.id] = EXPENSE_PIE[exp++ % EXPENSE_PIE.length]
    else if (n.kind === 'net') colorOf[n.id] = NET_COLOR
    else if (n.kind === 'reserve') colorOf[n.id] = RESERVE_COLOR
    else colorOf[n.id] = REVENUE_COLOR
  }

  // ── Link ribbons: stack along each node's edge in link order. ───────────────
  const srcRun: Record<string, number> = {}
  const tgtRun: Record<string, number> = {}
  for (const n of nodes) { srcRun[n.id] = pos[n.id].y; tgtRun[n.id] = pos[n.id].y }

  const ribbons = links.map((lk, i) => {
    const s = pos[lk.source]; const t = pos[lk.target]
    const h = Math.max(1, lk.value * pxPerUnit)
    const sTop = srcRun[lk.source]; srcRun[lk.source] += h
    const tTop = tgtRun[lk.target]; tgtRun[lk.target] += h
    const sx = s.x + NODE_W
    const tx = t.x
    const sB = sTop + h, tB = tTop + h
    const mx = (sx + tx) / 2
    const d = `M ${sx} ${sTop} C ${mx} ${sTop} ${mx} ${tTop} ${tx} ${tTop} L ${tx} ${tB} C ${mx} ${tB} ${mx} ${sB} ${sx} ${sB} Z`
    // colour by the non-revenue endpoint so each flow reads as its category
    const colorKey = lk.source === 'revenue' ? lk.target : lk.source
    return { d, color: colorOf[colorKey] ?? REVENUE_COLOR, source: lk.source, target: lk.target, key: i }
  })

  // De-collide side-column labels (depth 0 left, depth 2 right) and remember
  // each label's resolved y so we can draw a connector when it's displaced.
  const LABEL_MIN = 28
  const labelY: Record<string, number> = {}
  for (const depth of [0, 2] as const) {
    const c = cols[depth]
    const centers = c.map(n => pos[n.id].y + pos[n.id].h / 2)
    const spread = spreadLabels(centers, LABEL_MIN, TOP + 6, H - BOTTOM - 6)
    c.forEach((n, i) => { labelY[n.id] = spread[i] })
  }

  const connected = (lk: { source: string; target: string }) =>
    !hoverNode || lk.source === hoverNode || lk.target === hoverNode

  function onMove(e: MouseEvent) {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    setTip(prev => (prev ? { ...prev, x: e.clientX - rect.left, y: e.clientY - rect.top } : prev))
  }

  return (
    <div ref={wrapRef} className="relative" onMouseMove={onMove}
      onMouseLeave={() => { setHoverNode(null); setTip(null) }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ height: 'auto' }}
        preserveAspectRatio="xMidYMid meet" role="img" aria-label="Cash flow Sankey diagram">
        {/* ribbons (behind nodes) */}
        {ribbons.map(r => (
          <path key={r.key} d={r.d} fill={r.color} fillOpacity={connected(r) ? 0.42 : 0.07} stroke="none" />
        ))}

        {/* nodes + labels */}
        {nodes.map(n => {
          const p = pos[n.id]
          const isLeft = n.depth === 0
          const isCenter = n.depth === 1
          const dim = hoverNode && hoverNode !== n.id ? 0.4 : 1
          const cy = p.y + p.h / 2
          const lx = isLeft ? p.x - 8 : p.x + NODE_W + 8
          const ly = labelY[n.id] ?? cy
          return (
            <g key={n.id} opacity={dim} style={{ cursor: 'default' }}
              onMouseEnter={() => { setHoverNode(n.id); setTip({ x: 0, y: 0, node: n }) }}>
              {/* connector when the label was nudged off its node centre */}
              {!isCenter && Math.abs(ly - cy) > 1.5 && (
                <path
                  d={`M ${isLeft ? p.x : p.x + NODE_W} ${cy} L ${lx} ${ly - 4}`}
                  stroke="#3f3f46" strokeWidth={1} fill="none"
                />
              )}
              <rect x={p.x} y={p.y} width={NODE_W} height={p.h} rx={2.5} fill={colorOf[n.id]} />
              {isCenter ? (
                <text x={W / 2} y={18} textAnchor="middle" fill="#e4e4e7" fontSize={13} fontWeight={600}>
                  {n.label}
                  <tspan x={W / 2} dy={16} fill="#a1a1aa" fontSize={11} fontWeight={400}>{rm(n.value, hidden)}</tspan>
                </text>
              ) : (
                <text x={lx} y={ly - 4} textAnchor={isLeft ? 'end' : 'start'} fill="#d4d4d8" fontSize={12}>
                  {n.label}
                  <tspan x={lx} dy={14} fill="#a1a1aa" fontSize={11}>{rm(n.value, hidden)}</tspan>
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {tip && hoverNode && (
        <div className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900/95 px-2 py-1 text-[11px] leading-tight text-white shadow-lg"
          style={{ left: tip.x, top: tip.y - 8 }}>
          <span className="text-zinc-400">{tip.node.label}</span>{' '}
          <span className="font-semibold">{rm(tip.node.value, hidden)}</span>
        </div>
      )}
    </div>
  )
}

export default SankeyChart
