import { rm, type AgingBuckets } from '@/lib/finance'

// ── Internal helpers ─────────────────────────────────────────────────────────

// Build a linear scale from a value-domain [min,max] onto a pixel-range [a,b].
// Always returns a finite number even when the domain collapses (min === max),
// in which case everything maps to the midpoint of the range.
function makeScale(min: number, max: number, a: number, b: number) {
  const span = max - min
  return (v: number) => {
    if (!Number.isFinite(v)) return (a + b) / 2
    if (span === 0) return (a + b) / 2
    return a + ((v - min) / span) * (b - a)
  }
}

// Pick ~`count` evenly-spaced indices across a list of length `n` (inclusive of
// first and last). Returns [] for an empty list, [0] for a single item.
function tickIndices(n: number, count: number): number[] {
  if (n <= 0) return []
  if (n === 1) return [0]
  const k = Math.min(count, n)
  const out: number[] = []
  for (let i = 0; i < k; i++) {
    out.push(Math.round((i * (n - 1)) / (k - 1)))
  }
  // de-dupe in case of rounding collisions
  return [...new Set(out)]
}

// Round a value-domain outward to "nice" numbers so tick labels read cleanly.
function niceDomain(min: number, max: number): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1]
  if (min === max) {
    // Flat data → give the baseline a little breathing room.
    if (min === 0) return [0, 1]
    return min > 0 ? [0, min] : [min, 0]
  }
  return [min, max]
}

const AXIS = '#71717a' // zinc-500
const GRID = 'rgba(113,113,122,0.18)'
const EMPTY = '#27272a' // zinc-800

const PAD = { top: 12, right: 12, bottom: 22, left: 12 }

// Compact axis number, e.g. 12.3k / -4.2k / 980.
function fmtAxis(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const abs = Math.abs(n)
  if (abs >= 1000) {
    const k = n / 1000
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`
  }
  return abs >= 1 || n === 0 ? n.toFixed(0) : n.toFixed(1)
}

// ── 1. AreaLineChart ─────────────────────────────────────────────────────────

export function AreaLineChart({
  points,
  height = 180,
  color = '#22c55e',
  label,
}: {
  points: { label: string; value: number }[]
  height?: number
  color?: string
  label?: string
}) {
  const W = 600
  const H = height
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x0 = PAD.left
  const y0 = PAD.top

  const values = points.map((p) => p.value)
  const rawMax = values.length ? Math.max(0, ...values) : 0
  const rawMin = values.length ? Math.min(0, ...values) : 0
  const [dMin, dMax] = niceDomain(rawMin, rawMax)

  const sx = makeScale(0, Math.max(points.length - 1, 1), x0, x0 + plotW)
  const sy = makeScale(dMin, dMax, y0 + plotH, y0)
  const baseY = sy(0)

  const gridYs = [0, 0.25, 0.5, 0.75, 1].map((t) => y0 + plotH * t)
  const xticks = tickIndices(points.length, 6)

  const linePts = points.map((p, i) => `${sx(i)},${sy(p.value)}`)
  const linePath = linePts.length ? `M ${linePts.join(' L ')}` : ''
  const areaPath =
    linePts.length > 1
      ? `M ${sx(0)},${baseY} L ${linePts.join(' L ')} L ${sx(points.length - 1)},${baseY} Z`
      : ''

  const gradId = `area-grad-${color.replace(/[^a-z0-9]/gi, '')}`

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      preserveAspectRatio="none"
      role="img"
      aria-label={label ?? 'Area chart'}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* gridlines */}
      {gridYs.map((gy, i) => (
        <line key={i} x1={x0} y1={gy} x2={x0 + plotW} y2={gy} stroke={GRID} strokeWidth={1} />
      ))}
      {/* zero baseline */}
      <line x1={x0} y1={baseY} x2={x0 + plotW} y2={baseY} stroke={AXIS} strokeWidth={1} strokeOpacity={0.5} />

      {areaPath && <path d={areaPath} fill={`url(#${gradId})`} />}
      {linePath && <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
      {/* lone datum: a zero-length path is invisible, so draw a marker */}
      {points.length === 1 && <circle cx={sx(0)} cy={sy(points[0].value)} r={2.5} fill={color} />}

      {/* x-axis labels */}
      {xticks.map((idx) => (
        <text
          key={points[idx]?.label ?? idx}
          x={sx(idx)}
          y={H - 6}
          fill={AXIS}
          fontSize={10}
          textAnchor={idx === 0 ? 'start' : idx === points.length - 1 ? 'end' : 'middle'}
        >
          {points[idx]?.label ?? ''}
        </text>
      ))}
    </svg>
  )
}

// ── 2. ComboBarLine ──────────────────────────────────────────────────────────

export function ComboBarLine({
  points,
  height = 180,
  barColor = '#3b82f6',
  lineColor = '#84cc16',
}: {
  points: { label: string; bar: number; line: number }[]
  height?: number
  barColor?: string
  lineColor?: string
}) {
  const W = 600
  const H = height
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x0 = PAD.left
  const y0 = PAD.top

  const all = points.flatMap((p) => [p.bar, p.line])
  const rawMax = all.length ? Math.max(0, ...all) : 0
  const rawMin = all.length ? Math.min(0, ...all) : 0
  const [dMin, dMax] = niceDomain(rawMin, rawMax)

  const sy = makeScale(dMin, dMax, y0 + plotH, y0)
  const baseY = sy(0)

  const n = points.length
  const slot = n > 0 ? plotW / n : plotW
  const barW = Math.max(2, slot * 0.6)
  const cx = (i: number) => x0 + slot * i + slot / 2

  const gridYs = [0, 0.25, 0.5, 0.75, 1].map((t) => y0 + plotH * t)
  const xticks = tickIndices(n, 6)

  const linePts = points.map((p, i) => `${cx(i)},${sy(p.line)}`)
  const linePath = linePts.length ? `M ${linePts.join(' L ')}` : ''

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label="Combo bar and line chart">
      {/* gridlines */}
      {gridYs.map((gy, i) => (
        <line key={i} x1={x0} y1={gy} x2={x0 + plotW} y2={gy} stroke={GRID} strokeWidth={1} />
      ))}
      {/* zero baseline */}
      <line x1={x0} y1={baseY} x2={x0 + plotW} y2={baseY} stroke={AXIS} strokeWidth={1} strokeOpacity={0.5} />

      {/* bars */}
      {points.map((p, i) => {
        const yVal = sy(p.bar)
        const top = Math.min(yVal, baseY)
        const h = Math.max(0, Math.abs(yVal - baseY))
        return <rect key={points[i]?.label ?? i} x={cx(i) - barW / 2} y={top} width={barW} height={h} fill={barColor} rx={1.5} opacity={0.85} />
      })}

      {/* line */}
      {linePath && <path d={linePath} fill="none" stroke={lineColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
      {/* lone datum: a zero-length path is invisible, so draw a marker */}
      {points.length === 1 && <circle cx={cx(0)} cy={sy(points[0].line)} r={2.5} fill={lineColor} />}

      {/* x-axis labels */}
      {xticks.map((idx) => (
        <text
          key={points[idx]?.label ?? idx}
          x={cx(idx)}
          y={H - 6}
          fill={AXIS}
          fontSize={10}
          textAnchor={idx === 0 ? 'start' : idx === n - 1 ? 'end' : 'middle'}
        >
          {points[idx]?.label ?? ''}
        </text>
      ))}
    </svg>
  )
}

// ── 3. CashflowChart ─────────────────────────────────────────────────────────

export function CashflowChart({
  points,
  height = 200,
  mode = 'history',
  hidden = false,
}: {
  points: { label: string; flow: number; balance: number }[]
  height?: number
  mode?: 'history' | 'forecast'
  hidden?: boolean
}) {
  const W = 600
  const H = height
  // Wider side padding to fit dual y-axis labels.
  const pad = { top: 12, right: 46, bottom: 22, left: 46 }
  const plotW = W - pad.left - pad.right
  const plotH = H - pad.top - pad.bottom
  const x0 = pad.left
  const y0 = pad.top

  const flows = points.map((p) => p.flow)
  const balances = points.map((p) => p.balance)

  // Guarantee a non-zero span so the drawn line (via makeScale) and the manually
  // interpolated tick labels (fMax-(fMax-fMin)*t / bMax-(bMax-bMin)*t below) share
  // one real scale. On a degenerate domain makeScale returns the range midpoint for
  // every point while the ticks all read the same value — so labels and geometry
  // diverge. Expanding a flat domain to straddle the value keeps them in agreement.
  const nonZeroSpan = ([min, max]: [number, number]): [number, number] => {
    if (min !== max) return [min, max]
    if (min === 0) return [0, 1]
    return min > 0 ? [0, min] : [min, 0]
  }

  const [fMin, fMax] = nonZeroSpan(
    niceDomain(
      flows.length ? Math.min(0, ...flows) : 0,
      flows.length ? Math.max(0, ...flows) : 0,
    ),
  )
  const [bMin, bMax] = nonZeroSpan(
    niceDomain(
      balances.length ? Math.min(0, ...balances) : 0,
      balances.length ? Math.max(0, ...balances) : 0,
    ),
  )

  const syFlow = makeScale(fMin, fMax, y0 + plotH, y0)
  const syBal = makeScale(bMin, bMax, y0 + plotH, y0)
  const baseY = syFlow(0)

  const n = points.length
  const slot = n > 0 ? plotW / n : plotW
  const barW = Math.max(2, slot * 0.55)
  const cx = (i: number) => x0 + slot * i + slot / 2

  const gridTs = [0, 0.25, 0.5, 0.75, 1]
  const gridYs = gridTs.map((t) => y0 + plotH * t)
  const xticks = tickIndices(n, 6)

  // tick values for each axis (top → bottom matches gridYs order)
  const leftTicks = gridTs.map((t) => fMax - (fMax - fMin) * t)
  const rightTicks = gridTs.map((t) => bMax - (bMax - bMin) * t)

  const flowColor = '#22c55e'
  const balColor = '#3b82f6'

  const linePts = points.map((p, i) => `${cx(i)},${syBal(p.balance)}`)
  const linePath = linePts.length ? `M ${linePts.join(' L ')}` : ''

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label="Cashflow chart">
      {/* gridlines + dual y tick labels */}
      {gridYs.map((gy, i) => (
        <g key={i}>
          <line x1={x0} y1={gy} x2={x0 + plotW} y2={gy} stroke={GRID} strokeWidth={1} />
          <text x={x0 - 4} y={gy + 3} fill={AXIS} fontSize={9} textAnchor="end">
            {hidden ? '•••' : fmtAxis(leftTicks[i])}
          </text>
          <text x={x0 + plotW + 4} y={gy + 3} fill={AXIS} fontSize={9} textAnchor="start">
            {hidden ? '•••' : fmtAxis(rightTicks[i])}
          </text>
        </g>
      ))}
      {/* zero baseline (flow axis) */}
      <line x1={x0} y1={baseY} x2={x0 + plotW} y2={baseY} stroke={AXIS} strokeWidth={1} strokeOpacity={0.5} />

      {/* flow bars */}
      {points.map((p, i) => {
        const yVal = syFlow(p.flow)
        const top = Math.min(yVal, baseY)
        const h = Math.max(0, Math.abs(yVal - baseY))
        return <rect key={points[i]?.label ?? i} x={cx(i) - barW / 2} y={top} width={barW} height={h} fill={flowColor} rx={1.5} opacity={0.8} />
      })}

      {/* balance line (dashed in forecast mode) */}
      {linePath && (
        <path
          d={linePath}
          fill="none"
          stroke={balColor}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray={mode === 'forecast' ? '5 4' : undefined}
        />
      )}
      {/* lone datum: a zero-length path is invisible, so draw a marker */}
      {points.length === 1 && <circle cx={cx(0)} cy={syBal(points[0].balance)} r={2.5} fill={balColor} />}

      {/* x-axis labels */}
      {xticks.map((idx) => (
        <text
          key={points[idx]?.label ?? idx}
          x={cx(idx)}
          y={H - 6}
          fill={AXIS}
          fontSize={10}
          textAnchor={idx === 0 ? 'start' : idx === n - 1 ? 'end' : 'middle'}
        >
          {points[idx]?.label ?? ''}
        </text>
      ))}
    </svg>
  )
}

// ── 4. AgingBar ──────────────────────────────────────────────────────────────

const AGING_ORDER: { key: keyof AgingBuckets; color: string }[] = [
  { key: 'upcoming', color: '#93c5fd' },
  { key: 'd1_30', color: '#3b82f6' },
  { key: 'd31_60', color: '#1d4ed8' },
  { key: 'd61_90', color: '#1e3a8a' },
  { key: 'd91_plus', color: '#0f172a' },
]

export function AgingBar({ buckets }: { buckets: AgingBuckets }) {
  const W = 600
  const H = 28
  const r = 4

  const segs = AGING_ORDER.map(({ key, color }) => ({
    value: Math.max(0, Number(buckets?.[key]) || 0),
    color,
  }))
  const total = segs.reduce((s, x) => s + x.value, 0)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label="Aging breakdown bar">
      {total <= 0 ? (
        <rect x={0} y={0} width={W} height={H} rx={r} fill={EMPTY} />
      ) : (
        (() => {
          let cursor = 0
          return segs
            .filter((s) => s.value > 0)
            .map((s) => {
              const w = (s.value / total) * W
              const x = cursor
              cursor += w
              return <rect key={s.color} x={x} y={0} width={Math.max(w, 0.5)} height={H} fill={s.color} />
            })
        })()
      )}
    </svg>
  )
}

// ── 5. BreakdownBars ─────────────────────────────────────────────────────────

export function BreakdownBars({
  rows,
  color = '#3b82f6',
  hidden = false,
}: {
  rows: { category: string; amount: number }[]
  color?: string
  hidden?: boolean
}) {
  if (!rows || rows.length === 0) {
    return <p className="text-sm text-zinc-500">Nothing yet.</p>
  }

  const max = Math.max(0, ...rows.map((r) => Math.abs(r.amount) || 0))

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => {
        const pct = max > 0 ? Math.min(100, (Math.abs(row.amount) / max) * 100) : 0
        return (
          <div key={row.category} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate text-zinc-300">{row.category}</span>
              <span className="shrink-0 tabular-nums text-zinc-400">{rm(row.amount, hidden)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── 6. BreakdownPie ──────────────────────────────────────────────────────────

const PIE_PALETTE = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899', '#64748b']
// Income leans green, expenses lean red/warm — so the two pies are never confused,
// and multi-category pies get distinct colors per slice instead of all-blue.
export const INCOME_PIE = ['#22c55e', '#0ea5e9', '#84cc16', '#14b8a6', '#a3e635', '#2dd4bf']
export const EXPENSE_PIE = ['#ef4444', '#f59e0b', '#f97316', '#ec4899', '#8b5cf6', '#64748b']

export function BreakdownPie({
  rows,
  hidden = false,
  palette = PIE_PALETTE,
}: {
  rows: { category: string; amount: number }[]
  hidden?: boolean
  palette?: string[]
}) {
  const slices = (rows ?? []).filter((r) => Math.abs(r.amount) > 0)
  const total = slices.reduce((s, r) => s + Math.abs(r.amount), 0)

  if (slices.length === 0 || total <= 0) {
    return (
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 120 120" width="120" height="120" className="shrink-0">
          <circle cx="60" cy="60" r="54" fill="#27272a" />
        </svg>
        <p className="text-sm text-zinc-500">Nothing yet.</p>
      </div>
    )
  }

  const cx = 60, cy = 60, r = 54
  const rad = (deg: number) => (deg * Math.PI) / 180

  // Precompute cumulative angles (start at top, sweep clockwise). Force the
  // final slice to close exactly at 270° so float drift never leaves a gap.
  let acc = -90
  const withAngles = slices.map((row, i) => {
    const start = acc
    const end = i === slices.length - 1 ? 270 : acc + (Math.abs(row.amount) / total) * 360
    acc = end
    return { ...row, color: palette[i % palette.length], start, end }
  })

  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 120 120" width="120" height="120" className="shrink-0">
        {withAngles.length === 1 ? (
          <circle cx={cx} cy={cy} r={r} fill={withAngles[0].color} />
        ) : (
          withAngles.map((s) => {
            const large = s.end - s.start > 180 ? 1 : 0
            const x0 = cx + r * Math.cos(rad(s.start)), y0 = cy + r * Math.sin(rad(s.start))
            const x1 = cx + r * Math.cos(rad(s.end)), y1 = cy + r * Math.sin(rad(s.end))
            const d = `M ${cx} ${cy} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`
            return <path key={s.category} d={d} fill={s.color} />
          })
        )}
      </svg>
      <ul className="flex flex-1 flex-col gap-1.5">
        {withAngles.map((s) => (
          <li key={s.category} className="flex min-w-0 items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} />
            <span className="truncate text-zinc-300">{s.category}</span>
            <span className="ml-auto shrink-0 tabular-nums text-zinc-500">{rm(s.amount, hidden)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Sparkline ──────────────────────────────────────────────────────────────────
// Tiny inline trend line (no axes/labels) for per-row "is this creator heating up?".
export function Sparkline({
  values,
  color = '#f59e0b',
  width = 88,
  height = 24,
}: {
  values: number[]
  color?: string
  width?: number
  height?: number
}) {
  const n = values.length
  if (!n) return <svg width={width} height={height} aria-hidden />
  const max = Math.max(1, ...values)
  const pad = 2
  const xAt = (i: number) => (n === 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (n - 1))
  const yAt = (v: number) => height - pad - (v / max) * (height - 2 * pad)
  const pts = values.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ')
  const lastV = values[n - 1]
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
      <circle cx={xAt(n - 1)} cy={yAt(lastV)} r={2} fill={lastV > 0 ? color : '#3f3f46'} />
    </svg>
  )
}
